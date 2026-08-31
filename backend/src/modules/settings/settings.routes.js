const { Router } = require('express')
const { verifyToken, requireRole } = require('../../middleware/auth')
const db = require('../../config/db')

const router = Router()
router.use(verifyToken)

// Settings holds the shop's own credentials alongside its preferences — the
// Meta page access token, which can post as the page and read its messages, and
// the app secret. This route handed both to anybody with a login: every
// salesperson, every viewer. The page still needs the rest of the settings to
// render, so the secrets are withheld rather than the whole thing.
//
// Withheld, not omitted: the key comes back as null so the settings screen can
// still show that a token is configured without being told what it is. Admins
// and Managers — the roles that may write these — read them in full.
//
// `stripe_publishable_key` is deliberately absent: it is designed to be handed
// to a browser and the pay page needs it, so withholding it would be theatre.
// The secret key and the webhook signing secret are the ones that must not
// leave this box.
const SECRET_KEYS = new Set([
  'meta_page_token', 'meta_app_secret', 'meta_verify_token',
  'shippo_api_key', 'shippo_token', 'nextcloud_password', 'smtp_password',
  'stripe_secret_key', 'stripe_webhook_secret',
])
const PRIVILEGED = new Set(['Admin', 'Manager'])

router.get('/', async (req, res, next) => {
  try {
    const { rows } = await db.query('SELECT key, value FROM settings ORDER BY key')
    const maySeeSecrets = PRIVILEGED.has(req.user?.role)
    const obj = {}
    rows.forEach(r => {
      obj[r.key] = (!maySeeSecrets && SECRET_KEYS.has(r.key)) ? null : r.value
    })
    res.json({ settings: obj })
  } catch (err) { next(err) }
})

router.put('/', requireRole('Admin', 'Manager'), async (req, res, next) => {
  try {
    const updates = req.body
    for (const [key, value] of Object.entries(updates)) {
      await db.query(
        `INSERT INTO settings (key, value, updated_by, updated_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (key) DO UPDATE SET value = $2, updated_by = $3, updated_at = NOW()`,
        [key, value === null ? null : String(value), req.user.id]
      )
    }
    // The Stripe client caches its keys for a minute. Without this, an Admin
    // who pastes a corrected key would keep seeing the old key's failures for
    // up to that long and reasonably conclude the new one was wrong too.
    if (Object.keys(updates).some(k => k.startsWith('stripe_'))) {
      require('../stripe/stripe.client').invalidate()
    }

    const { rows } = await db.query('SELECT key, value FROM settings ORDER BY key')
    const obj = {}
    rows.forEach(r => { obj[r.key] = r.value })
    res.json({ success: true, settings: obj })
  } catch (err) { next(err) }
})

module.exports = router
