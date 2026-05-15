const { Pool } = require('pg')
const logger = require('../utils/logger')

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
})

pool.on('error', (err) => {
  logger.error({ err }, 'Unexpected PostgreSQL pool error')
})

pool.on('connect', () => {
  logger.debug('New PostgreSQL client connected')
})

async function query(text, params) {
  const start = Date.now()
  const res = await pool.query(text, params)
  const duration = Date.now() - start
  logger.debug({ query: text, duration, rows: res.rowCount }, 'DB query executed')
  return res
}

async function getClient() {
  const client = await pool.connect()
  const originalQuery = client.query.bind(client)
  const release = client.release.bind(client)

  const timeout = setTimeout(() => {
    logger.error('A client has been checked out for more than 5 seconds')
  }, 5000)

  client.release = () => {
    clearTimeout(timeout)
    client.query = originalQuery
    client.release = release
    return release()
  }

  client.query = async (text, params) => {
    const res = await originalQuery(text, params)
    return res
  }

  return client
}

module.exports = { pool, query, getClient }
