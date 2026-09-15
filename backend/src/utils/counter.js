const { pool } = require('../config/db')

// Guards the dynamic identifiers below — callers pass hard-coded table /
// column names, this just makes the contract explicit.
const IDENTIFIER_RE = /^[a-z_][a-z0-9_]*$/

/**
 * The numbers a series hands out must read 1..N with nothing missing — that is
 * how this shop audits its book. So a new record takes the LOWEST free number
 * rather than one past the highest: delete PO-2026-0120 and the next purchase
 * order is 0120 again, not 0121.
 *
 * A number is free when no live record holds it. A soft-deleted record still
 * holding one hands it back here: its own number is parked as
 * "D-PO-2026-0120-4f9a", so the deleted row stays readable and the number
 * returns to the pool. Two callers can never pick the same number — each holds
 * the series' advisory lock for the whole transaction.
 */

// Does this table mark rows deleted, or remove them outright — and how much
// room does its number column have? A parked number has to fit: customers'
// column is VARCHAR(20) and "D-CUST-2026-0118-4f9a" is 21 characters.
const tableFacts = new Map()
async function factsFor(client, table, column) {
  const key = `${table}.${column}`
  if (tableFacts.has(key)) return tableFacts.get(key)
  const { rows } = await client.query(
    `SELECT column_name, character_maximum_length FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1
        AND column_name IN ('deleted_at', $2)`, [table, column])
  const facts = {
    deletedColumn: rows.some(r => r.column_name === 'deleted_at') ? 'deleted_at' : null,
    width: rows.find(r => r.column_name === column)?.character_maximum_length ?? null,
  }
  tableFacts.set(key, facts)
  return facts
}

/**
 * The lowest number of a series that no live record holds. Any deleted record
 * holding it has its number parked, so nothing collides when it is reused.
 *
 * `pattern` matches the series' own numbers — a parked "D-…" number does not
 * match, which is exactly why it counts as free. The number itself is always
 * the last dash-separated part, whether the text reads PO-2026-0042 or RFA-0042.
 */
async function lowestFreeNumber(client, { table, column, pattern }) {
  const { deletedColumn, width } = await factsFor(client, table, column)
  const alive = deletedColumn ? `AND ${deletedColumn} IS NULL` : ''
  const { rows } = await client.query(
    `SELECT CAST(REGEXP_REPLACE(${column}, '^.*-', '') AS INTEGER) AS n
       FROM ${table} WHERE ${column} ~ $1 ${alive}`, [pattern])
  const taken = new Set(rows.map(r => Number(r.n)))
  let value = 1
  while (taken.has(value)) value++

  if (deletedColumn) {
    // The id fragment keeps two deleted rows of the same number apart; the
    // whole is trimmed to what the column can hold.
    const parked = `'D-' || ${column} || '-' || LEFT(REPLACE(id::text, '-', ''), 4)`
    await client.query(
      `UPDATE ${table}
          SET ${column} = ${width ? `LEFT(${parked}, ${width})` : parked}
        WHERE ${column} ~ $1
          AND CAST(REGEXP_REPLACE(${column}, '^.*-', '') AS INTEGER) = $2
          AND ${deletedColumn} IS NOT NULL`, [pattern, value])
  }
  return value
}

/**
 * The counters table is no longer what hands numbers out, but it is still a
 * truthful record of the highest one issued, so anything reading it is right.
 */
async function rememberHighWater(client, scope, value) {
  await client.query(
    `INSERT INTO counters (scope, last_value) VALUES ($1, $2)
     ON CONFLICT (scope) DO UPDATE SET last_value = GREATEST(counters.last_value, EXCLUDED.last_value),
                                       updated_at = NOW()`,
    [scope, value])
}

/**
 * Generates the next sequential number in format PREFIX-YYYY-NNNN.
 * Safe under concurrency: a per-scope advisory lock serialises callers,
 * and the counters table remembers the high-water mark across deletes.
 * @param {string} prefix   e.g. 'ORD', 'LEAD', 'QT', 'INV', 'SHP', 'PO', 'AW'
 * @param {string} table    table name holding existing numbers (seed source)
 * @param {string} column   column holding the number e.g. 'order_number'
 * @returns {Promise<string>}
 */
async function getNextNumber(prefix, table, column) {
  if (!IDENTIFIER_RE.test(table) || !IDENTIFIER_RE.test(column)) {
    throw new Error(`Invalid identifier: ${table}.${column}`)
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const year = new Date().getFullYear()
    const scope = `${prefix}-${year}`

    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [scope])

    const value = await lowestFreeNumber(client, {
      table, column, pattern: `^${scope}-[0-9]+$`,
    })
    await rememberHighWater(client, scope, value)

    await client.query('COMMIT')
    return `${scope}-${String(value).padStart(4, '0')}`
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

/**
 * Cleans a customer name into a three-letter uppercase code for invoice numbers:
 * the first letter of the given name plus the first two of the family name.
 * e.g. "Hector Garcia" -> "HGA", "Robert Farrar" -> "RFA", "Maria Garcia" -> "MGA".
 * A single-word name uses its own first three letters - "Jenny" -> "JEN".
 *
 * Three letters rather than the whole name because the number is read aloud and
 * typed onto paperwork; HECTORGARCIA-0004 is not a document number, it is a
 * sentence. Checked against the 78 customers on file, this rule leaves 74 codes
 * distinct, where taking the first three letters of the full name collides three
 * times as often (Carol Johnson Garlin and Carrie Trenk would both be CAR).
 *
 * A shared code is not a correctness problem - the sequence behind it is shared,
 * so the numbers stay unique - but it does make two customers read alike, which
 * is why the more distinctive rule is used.
 */
function buildInvoicePrefix(customerName) {
  if (!customerName || !customerName.trim()) return 'CUST'
  const words = customerName
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')  // strip accent marks
    .replace(/[^A-Z0-9 ]/g, '')       // keep only alphanumeric + space
    .split(/\s+/)
    .filter(Boolean)
  if (!words.length) return 'CUST'
  const code = words.length > 1
    ? words[0][0] + words[words.length - 1].slice(0, 2)
    : words[0].slice(0, 3)
  // Pad a one- or two-letter name so every code is the same width.
  return code.padEnd(3, 'X').slice(0, 3)
}

/**
 * Generates the next sequential invoice number for a given customer.
 * Format: XYZ-NNNN  e.g. HGA-0001 for Hector Garcia
 * Seeded from MAX of existing numbers (not COUNT), so deleting an
 * invoice can never produce a duplicate number.
 */
async function getNextInvoiceNumber(customerName) {
  const prefix = buildInvoicePrefix(customerName)
  // One scope for the whole book. The letters name the customer; the number is
  // the invoice's place in the sequence, whoever it is for. Counting per
  // customer instead made the list read VCA-0001, ATA-0003, JJU-0006 down the
  // page — three letters that mean something followed by a number that means
  // nothing to anyone reading the list in date order.
  const scope = 'INV'

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [scope])

    const value = await lowestFreeNumber(client, {
      table: 'invoices', column: 'invoice_number', pattern: '^[A-Z]{3}-[0-9]+$',
    })
    await rememberHighWater(client, scope, value)

    await client.query('COMMIT')
    return `${prefix}-${String(value).padStart(4, '0')}`
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

module.exports = { getNextNumber, getNextInvoiceNumber, buildInvoicePrefix }
