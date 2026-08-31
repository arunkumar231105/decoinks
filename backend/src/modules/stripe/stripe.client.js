/**
 * The Stripe client, and the shop's Stripe credentials.
 *
 * The keys live in `settings`, alongside the Meta app secret and the Nextcloud
 * password, rather than in the environment. Two reasons: the environment route
 * would mean editing docker-compose.yml, which this project protects, and it
 * would mean a container rebuild every time a key is rotated or the shop moves
 * from test keys to live ones. Settings can be changed from the admin screen
 * and take effect within a minute.
 *
 *   stripe_secret_key       sk_test_… while building, sk_live_… once live
 *   stripe_publishable_key  pk_test_… / pk_live_…  (safe to send to a browser)
 *   stripe_webhook_secret   whsec_…               (set after the endpoint exists)
 *
 * Nothing here decides what to charge. Amounts come from the invoice; this file
 * only knows how to talk to Stripe.
 */

const Stripe = require('stripe')
const db = require('../../config/db')

// Re-reading three settings rows on every request would put a query in front of
// every payment page load for values that change perhaps twice a year. Cached
// briefly instead, so a key rotation is picked up on its own without a restart.
const CACHE_TTL_MS = 60_000
let cache = { at: 0, secret: null, publishable: null, webhook: null }
let client = null
let clientKey = null

async function readSettings() {
  const now = Date.now()
  if (now - cache.at < CACHE_TTL_MS) return cache

  const { rows } = await db.query(
    `SELECT key, value FROM settings
      WHERE key IN ('stripe_secret_key', 'stripe_publishable_key', 'stripe_webhook_secret')`
  )
  const byKey = Object.fromEntries(rows.map(r => [r.key, (r.value || '').trim() || null]))

  cache = {
    at: now,
    secret: byKey.stripe_secret_key || null,
    publishable: byKey.stripe_publishable_key || null,
    webhook: byKey.stripe_webhook_secret || null,
  }
  return cache
}

/** Force the next read to go to the database. Called when settings are saved. */
function invalidate() {
  cache = { at: 0, secret: null, publishable: null, webhook: null }
}

function configError(what) {
  const err = new Error(
    `Stripe is not configured: ${what} is missing. An Admin can add it under Settings.`
  )
  err.statusCode = 503
  return err
}

/**
 * The Stripe SDK, built from the stored secret key.
 *
 * The instance is rebuilt only when the key itself changes, so rotating a key
 * swaps the client without a restart and without leaking the old one.
 */
async function getStripe() {
  const { secret } = await readSettings()
  if (!secret) throw configError('the secret key')

  if (!client || clientKey !== secret) {
    client = new Stripe(secret, {
      // Pinning the version means Stripe changing its API on their schedule
      // cannot change what our webhook receives on a random Tuesday.
      //
      // This must stay equal to the version the installed SDK was generated
      // against — `require('stripe/cjs/apiVersion')` in node_modules — or the
      // SDK's own types describe a different API than the one we are calling.
      // Check it when bumping the `stripe` dependency. SDK 22.6.0 ships:
      apiVersion: '2026-08-26.dahlia',
      appInfo: { name: 'Decoinks Printshop OS', url: 'https://decoinkssuite.com' },
      maxNetworkRetries: 2,
      timeout: 20_000,
    })
    clientKey = secret
  }
  return client
}

/** Whether the stored keys are test keys. Drives the "TEST MODE" banner. */
function isTestKey(key) {
  return typeof key === 'string' && /^(sk|pk|whsec)_test_/.test(key)
}

/**
 * What the pay page is allowed to know: the publishable key, which is designed
 * to be public, and whether we are in test mode. The secret key never appears
 * in any response.
 */
async function getPublicConfig() {
  const { publishable, secret } = await readSettings()
  if (!publishable) throw configError('the publishable key')
  return {
    publishableKey: publishable,
    testMode: isTestKey(publishable),
    // A publishable key from one account and a secret from another is a
    // configuration mistake that would otherwise only surface as a confusing
    // Stripe error at the moment a customer tries to pay.
    keysMismatched: Boolean(secret) && isTestKey(publishable) !== isTestKey(secret),
  }
}

/** The webhook signing secret. Absent until the endpoint is registered. */
async function getWebhookSecret() {
  const { webhook } = await readSettings()
  if (!webhook) throw configError('the webhook signing secret')
  return webhook
}

/** For the admin settings screen: is Stripe usable, and in which mode? */
async function getStatus() {
  const { secret, publishable, webhook } = await readSettings()
  return {
    configured: Boolean(secret && publishable),
    hasSecretKey: Boolean(secret),
    hasPublishableKey: Boolean(publishable),
    hasWebhookSecret: Boolean(webhook),
    testMode: isTestKey(secret),
    keysMismatched: Boolean(secret && publishable) && isTestKey(secret) !== isTestKey(publishable),
  }
}

module.exports = {
  getStripe,
  getPublicConfig,
  getWebhookSecret,
  getStatus,
  isTestKey,
  invalidate,
}
