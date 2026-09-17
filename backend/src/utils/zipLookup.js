// US ZIP code → city and state, for filling a customer's address as it is typed.
//
// Only the five digits leave this server — never a name or a street — and each
// answer is remembered, so a ZIP is looked up once per process. A lookup that
// fails or is slow returns null and the form keeps what the address itself said.
const logger = require('./logger')

const cache = new Map()
const MAX_CACHED = 5000
const TIMEOUT_MS = 3000

async function lookupUsZip(zip) {
  const five = String(zip ?? '').trim().slice(0, 5)
  if (!/^\d{5}$/.test(five)) return null
  if (cache.has(five)) return cache.get(five)

  let found = null
  try {
    const res = await fetch(`https://api.zippopotam.us/us/${five}`, { signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (res.ok) {
      const body = await res.json()
      const place = body?.places?.[0]
      if (place) {
        found = {
          zip: five,
          city: place['place name'],
          state: place['state abbreviation'],
          state_name: place.state,
          // Some ZIPs serve several towns; the form matches whichever was typed.
          cities: [...new Set(body.places.map(p => p['place name']).filter(Boolean))],
        }
      }
    } else if (res.status !== 404) {
      return null // not an answer about the ZIP; don't remember it
    }
  } catch (err) {
    logger.warn({ zip: five, err: err.message }, 'ZIP lookup unavailable')
    return null
  }

  if (cache.size >= MAX_CACHED) cache.delete(cache.keys().next().value)
  cache.set(five, found)
  return found
}

module.exports = { lookupUsZip }
