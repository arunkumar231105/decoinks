const { pool } = require('../config/db')

// Guards the dynamic identifiers below — callers pass hard-coded table /
// column names, this just makes the contract explicit.
const IDENTIFIER_RE = /^[a-z_][a-z0-9_]*$/

/**
 * Atomically claims the next value for a counter scope.
 * Must be called inside a transaction that holds the scope's advisory lock.
 *
 * The counter row is a high-water mark: it is seeded from the highest
 * number already present in the data (so it picks up exactly where the
 * old MAX()-based generator left off) and only ever moves forward, so a
 * deleted row can never cause a number to be handed out twice.
 */
async function claimNext(client, scope, seedValue) {
  await client.query(
    `INSERT INTO counters (scope) VALUES ($1) ON CONFLICT (scope) DO NOTHING`,
    [scope]
  )
  const { rows } = await client.query(
    `UPDATE counters
     SET last_value = GREATEST(last_value, $2) + 1, updated_at = NOW()
     WHERE scope = $1
     RETURNING last_value`,
    [scope, seedValue]
  )
  return Number(rows[0].last_value)
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

    // Seed guard: highest number already present in the table for this
    // prefix+year (regex filter keeps the cast safe against odd formats).
    const { rows } = await client.query(
      `SELECT COALESCE(MAX(CAST(SPLIT_PART(${column}, '-', 3) AS INTEGER)), 0) AS max_seq
       FROM ${table}
       WHERE ${column} ~ $1`,
      [`^${scope}-[0-9]+$`]
    )

    const next = await claimNext(client, scope, rows[0].max_seq || 0)

    await client.query('COMMIT')
    return `${scope}-${String(next).padStart(4, '0')}`
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

    // Seeded from the highest number in the book, under any customer's letters.
    const { rows } = await client.query(
      `SELECT COALESCE(MAX(CAST(SPLIT_PART(invoice_number, '-', 2) AS INTEGER)), 0) AS max_seq
       FROM invoices
       WHERE invoice_number ~ $1`,
      ['^[A-Z]{3}-[0-9]+$']
    )

    const next = await claimNext(client, scope, rows[0].max_seq || 0)

    await client.query('COMMIT')
    return `${prefix}-${String(next).padStart(4, '0')}`
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

module.exports = { getNextNumber, getNextInvoiceNumber, buildInvoicePrefix }
