/**
 * PayPal, as a second way to pay the same link.
 *
 * Stripe cannot offer PayPal here: Stripe's PayPal is for merchants in Europe
 * and the UK, and this is a US account — asking Stripe for it returns
 * `available: false` and a real intent never lists it. So PayPal is integrated
 * directly, and the pay page offers both.
 *
 * Credentials live in `settings` beside the Stripe ones, for the same reasons:
 * the environment route would mean editing the protected docker-compose.yml and
 * a container rebuild every time a key is rotated or the shop moves from
 * sandbox to live.
 *
 *   paypal_client_id   sandbox or live, per paypal_mode
 *   paypal_secret
 *   paypal_mode        'sandbox' while building, 'live' once real
 *   paypal_webhook_id  set after the webhook is registered
 */

const db = require('../../config/db')

const HOSTS = {
  sandbox: 'https://api-m.sandbox.paypal.com',
  live: 'https://api-m.paypal.com',
}

const CACHE_TTL_MS = 60_000
let settingsCache = { at: 0 }
// PayPal tokens last nine hours; refreshed a minute early rather than on expiry
// so a request never races the boundary.
let tokenCache = { token: null, expiresAt: 0, key: null }

async function readSettings() {
  if (Date.now() - settingsCache.at < CACHE_TTL_MS) return settingsCache
  const { rows } = await db.query(
    `SELECT key, value FROM settings
      WHERE key IN ('paypal_client_id','paypal_secret','paypal_mode','paypal_webhook_id')`)
  const byKey = Object.fromEntries(rows.map(r => [r.key, (r.value || '').trim() || null]))
  settingsCache = {
    at: Date.now(),
    clientId: byKey.paypal_client_id || null,
    secret: byKey.paypal_secret || null,
    mode: byKey.paypal_mode === 'live' ? 'live' : 'sandbox',
    webhookId: byKey.paypal_webhook_id || null,
  }
  return settingsCache
}

function invalidate() {
  settingsCache = { at: 0 }
  tokenCache = { token: null, expiresAt: 0, key: null }
}

function configError(what) {
  return Object.assign(
    new Error(`PayPal is not configured: ${what} is missing. An Admin can add it under Settings.`),
    { statusCode: 503 })
}

async function accessToken() {
  const { clientId, secret, mode } = await readSettings()
  if (!clientId) throw configError('the client ID')
  if (!secret) throw configError('the secret')

  const key = `${mode}:${clientId}`
  if (tokenCache.token && tokenCache.key === key && Date.now() < tokenCache.expiresAt) {
    return tokenCache.token
  }

  const res = await fetch(`${HOSTS[mode]}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${clientId}:${secret}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  })
  const body = await res.json().catch(() => null)
  if (!res.ok || !body?.access_token) {
    throw Object.assign(
      new Error(`PayPal rejected these credentials: ${body?.error_description || res.status}`),
      { statusCode: 502 })
  }

  tokenCache = {
    token: body.access_token,
    key,
    expiresAt: Date.now() + Math.max(0, (Number(body.expires_in) || 0) - 60) * 1000,
  }
  return tokenCache.token
}

/** A PayPal REST call, with the token handled and errors made readable. */
async function api(path, { method = 'GET', body, headers = {} } = {}) {
  const { mode } = await readSettings()
  const res = await fetch(`${HOSTS[mode]}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${await accessToken()}`,
      'Content-Type': 'application/json',
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  const parsed = text ? JSON.parse(text) : null
  if (!res.ok) {
    const detail = parsed?.details?.[0]?.description || parsed?.message || res.statusText
    throw Object.assign(new Error(`PayPal: ${detail}`), { statusCode: res.status, paypal: parsed })
  }
  return parsed
}

/** What the pay page may know: the client id is public by design. */
async function getPublicConfig() {
  const { clientId, mode } = await readSettings()
  return {
    enabled: Boolean(clientId),
    clientId: clientId || null,
    sandbox: mode === 'sandbox',
  }
}

async function getStatus() {
  const { clientId, secret, mode, webhookId } = await readSettings()
  return {
    configured: Boolean(clientId && secret),
    mode,
    hasWebhookId: Boolean(webhookId),
  }
}

module.exports = { api, accessToken, getPublicConfig, getStatus, readSettings, invalidate, HOSTS }
