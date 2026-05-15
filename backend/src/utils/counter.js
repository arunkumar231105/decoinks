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

module.exports = { getNextNumber }
