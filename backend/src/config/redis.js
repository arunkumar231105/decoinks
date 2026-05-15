const Redis = require('ioredis')
const logger = require('../utils/logger')

let client

function getRedisClient() {
  if (client) return client

  client = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
    maxRetriesPerRequest: 3,
    lazyConnect: true,
    enableReadyCheck: false,
  })

  client.on('connect', () => logger.info('Redis connected'))
  client.on('error', (err) => logger.warn({ err }, 'Redis connection error – cache disabled'))
  client.on('close', () => logger.warn('Redis connection closed'))

  return client
}

async function cacheGet(key) {
  try {
    const val = await getRedisClient().get(key)
    return val ? JSON.parse(val) : null
  } catch {
    return null
  }
}

async function cacheSet(key, value, ttlSeconds = 60) {
  try {
    await getRedisClient().set(key, JSON.stringify(value), 'EX', ttlSeconds)
  } catch {
    // silent – cache is best-effort
  }
}

async function cacheDel(...keys) {
  try {
    if (keys.length) await getRedisClient().del(...keys)
  } catch {
    // silent
  }
}

module.exports = { getRedisClient, cacheGet, cacheSet, cacheDel }
