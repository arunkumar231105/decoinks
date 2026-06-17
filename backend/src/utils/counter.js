const { pool } = require('../config/db')

/**
 * Generates the next sequential number in format PREFIX-YYYY-NNNN
 * Uses pg_try_advisory_xact_lock to prevent race conditions.
 * @param {string} prefix   e.g. 'ORD', 'LEAD', 'QT', 'INV', 'SHP', 'PO', 'AW'
 * @param {string} table    table name
 * @param {string} column   column holding the number e.g. 'order_number'
 * @returns {Promise<string>}
 */
async function getNextNumber(prefix, table, column) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    // advisory lock keyed on hash of prefix so concurrent prefixes don't block each other
    const lockKey = hashCode(prefix)
    await client.query('SELECT pg_advisory_xact_lock($1)', [lockKey])

    const year = new Date().getFullYear()
    const pattern = `${prefix}-${year}-%`

    const { rows } = await client.query(
      `SELECT COALESCE(
         MAX(CAST(SPLIT_PART(${column}, '-', 3) AS INTEGER)),
         0
       ) AS max_seq
       FROM ${table}
       WHERE ${column} LIKE $1`,
      [pattern]
    )

    const next = (rows[0].max_seq || 0) + 1
    const padded = String(next).padStart(4, '0')
    const result = `${prefix}-${year}-${padded}`

    await client.query('COMMIT')
    return result
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

function hashCode(str) {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash |= 0
  }
  return Math.abs(hash) % 2147483647
}

/**
 * Cleans a customer name into a short uppercase prefix for invoice numbers.
 * e.g. "John Smith" → "JOHNSMITH", "María García" → "MARIAGARCIA"
 */
function buildInvoicePrefix(customerName) {
  if (!customerName || !customerName.trim()) return 'CUST'
  const cleaned = customerName
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')  // strip accent marks
    .replace(/[^A-Z0-9 ]/g, '')       // keep only alphanumeric + space
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)                       // at most 2 words
    .join('')
    .slice(0, 12)                      // max 12 chars
  return cleaned || 'CUST'
}

/**
 * Generates the next sequential invoice number for a given customer.
 * Format: CUSTOMERNAME-NNNN  e.g. JOHNSMITH-0001
 */
async function getNextInvoiceNumber(customerName) {
  const prefix = buildInvoicePrefix(customerName)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const lockKey = hashCode('INV:' + prefix)
    await client.query('SELECT pg_advisory_xact_lock($1)', [lockKey])

    const { rows } = await client.query(
      `SELECT COUNT(*) AS cnt FROM invoices WHERE invoice_number LIKE $1`,
      [prefix + '-%']
    )
    const next = parseInt(rows[0].cnt, 10) + 1
    const result = `${prefix}-${String(next).padStart(4, '0')}`

    await client.query('COMMIT')
    return result
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

module.exports = { getNextNumber, getNextInvoiceNumber }
