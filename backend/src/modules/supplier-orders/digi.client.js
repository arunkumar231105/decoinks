/**
 * DIGI (tshirt.riin.com) — the read side of its order API.
 *
 * The same account and signing BlankTex uses (BlankTex/backend/src/supplier.js):
 * every call is a POST whose `sign` is MD5(body + '::' + secretKey), and HTTP is
 * always 200, so `successful` is the only success flag. Only read endpoints are
 * reachable from here — Printshop never places, changes or closes a DIGI order.
 * Field reference: /root/dg-api-docs/DG_DIGI_API_Fields.xlsx.
 */
const crypto = require('crypto')

const READ_ENDPOINTS = new Set(['queryOrderInfo', 'queryOrderStatus', 'queryOrderDelivery', 'queryShipAddress'])
const TIMEOUT_MS = 30000

const config = () => ({
  secretKey: process.env.DIGI_API_SECRET_KEY || '',
  baseUrl: String(process.env.DIGI_API_BASE_URL || 'https://tshirt.riin.com').replace(/\/$/, ''),
})

const isConfigured = () => Boolean(config().secretKey)

async function call(endpoint, body) {
  if (!READ_ENDPOINTS.has(endpoint)) throw new Error(`DIGI endpoint not allowed from Printshop: ${endpoint}`)
  const { secretKey, baseUrl } = config()
  if (!secretKey) throw Object.assign(new Error('DIGI API is not configured (DIGI_API_SECRET_KEY)'), { status: 503 })
  const text = JSON.stringify(body)
  const sign = crypto.createHash('md5').update(`${text}::${secretKey}`).digest('hex')
  let res
  try {
    res = await fetch(`${baseUrl}/trade/api/interface/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', secretKey, sign },
      body: text,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (err) {
    throw Object.assign(new Error(`DIGI ${endpoint}: ${err.name === 'TimeoutError' ? 'timed out' : err.message}`), { status: 502 })
  }
  const data = await res.json().catch(() => null)
  if (!data) throw Object.assign(new Error(`DIGI ${endpoint}: HTTP ${res.status}, no JSON`), { status: 502 })
  if (data.successful === false || data.success === false) {
    throw Object.assign(new Error(`DIGI ${endpoint}: ${data.message || data.errorCode || 'failed'}`), { status: 502 })
  }
  return data.data
}

module.exports = { isConfigured, call }
