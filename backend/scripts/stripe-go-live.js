/**
 * Move Stripe from test keys to live keys.
 *
 * Live is not simply a different key. The webhook endpoint, its signing secret,
 * the Apple Pay domain registration and the payment-method display settings all
 * live per-mode, so each has to be created again on the live side or the first
 * real customer meets a payment that succeeds at Stripe and is never recorded
 * here.
 *
 * The test keys are kept under `stripe_*_test_backup` so the switch is
 * reversible: nothing about test mode is destroyed by going live.
 *
 * Usage:  LIVE_PK=pk_live_... LIVE_SK=sk_live_... node scripts/stripe-go-live.js [--apply]
 */

const db = require('../src/config/db')
const Stripe = require('stripe')

const APPLY = process.argv.includes('--apply')
const API_VERSION = '2026-08-26.dahlia'
const WEBHOOK_URL = 'https://payments.decoinks.com/api/stripe/webhook'
const PAY_DOMAINS = ['payments.decoinks.com', 'customer.decoinkssuite.com']
const EVENTS = ['payment_intent.succeeded', 'payment_intent.payment_failed', 'charge.refunded', 'charge.updated']
const WANT_METHODS = ['card', 'apple_pay', 'google_pay', 'link', 'us_bank_account',
                      'cashapp', 'amazon_pay', 'klarna', 'affirm', 'afterpay_clearpay']

const pk = process.env.LIVE_PK
const sk = process.env.LIVE_SK
const say = (k, v) => console.log(`  ${String(k).padEnd(26)} ${v}`)

async function setSetting(key, value) {
  await db.query(
    `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`, [key, value])
}

async function main() {
  if (!/^pk_live_/.test(pk || '') || !/^sk_live_/.test(sk || '')) {
    throw new Error('LIVE_PK and LIVE_SK must be pk_live_… and sk_live_… — refusing to install anything else')
  }

  const stripe = new Stripe(sk, { apiVersion: API_VERSION })

  console.log(`\n${APPLY ? 'GOING LIVE' : 'DRY RUN — nothing will be written'}\n${'='.repeat(62)}`)

  /* ── 1. The account must actually be able to take money ───────────────── */
  const acct = await stripe.accounts.retrieve()
  say('account', acct.id)
  say('charges_enabled', acct.charges_enabled)
  say('payouts_enabled', acct.payouts_enabled)
  if (!acct.charges_enabled) throw new Error('This account cannot take live charges yet.')

  /* ── 2. What exists on the live side today ────────────────────────────── */
  const hooks = await stripe.webhookEndpoints.list({ limit: 100 })
  const ours = hooks.data.filter(h => h.url === WEBHOOK_URL)
  say('live webhooks at our URL', ours.length)

  const apple = await stripe.applePayDomains.list({ limit: 50 })
  say('live Apple Pay domains', apple.data.map(d => d.domain_name).join(', ') || '(none)')

  const conf = (await stripe.paymentMethodConfigurations.list({ limit: 1 })).data[0]
  const on = Object.entries(conf).filter(([, v]) => v && typeof v === 'object' && v.display_preference?.value === 'on').map(([k]) => k)
  say('live methods enabled', on.sort().join(', ') || '(none)')

  if (!APPLY) {
    console.log('\nWith --apply this will:')
    console.log('  · back up the test keys, then install the live keys')
    console.log(`  · create a live webhook at ${WEBHOOK_URL} and store its signing secret`)
    console.log(`  · register Apple Pay for: ${PAY_DOMAINS.join(', ')}`)
    console.log(`  · switch on: ${WANT_METHODS.join(', ')}`)
    return
  }

  /* ── 3. Keep the test keys, so this is reversible ─────────────────────── */
  const { rows: old } = await db.query(
    `SELECT key, value FROM settings WHERE key IN
       ('stripe_secret_key','stripe_publishable_key','stripe_webhook_secret')`)
  for (const r of old) {
    if (/_test_/.test(r.value || '')) await setSetting(`${r.key}_test_backup`, r.value)
  }
  console.log(`\n  backed up ${old.filter(r => /_test_/.test(r.value || '')).length} test key(s)`)

  /* ── 4. Live webhook, with its own signing secret ─────────────────────── */
  for (const h of ours) {
    await stripe.webhookEndpoints.del(h.id)
    console.log(`  removed stale live webhook ${h.id}`)
  }
  const hook = await stripe.webhookEndpoints.create({
    url: WEBHOOK_URL,
    enabled_events: EVENTS,
    description: 'Decoinks Printshop OS — live customer payments',
  })
  say('live webhook', `${hook.id} (${hook.status})`)

  /* ── 5. Apple Pay, per domain, on the live side ───────────────────────── */
  for (const domain of PAY_DOMAINS) {
    if (apple.data.some(d => d.domain_name === domain)) { say('apple pay', `${domain} already registered`); continue }
    try {
      await stripe.applePayDomains.create({ domain_name: domain })
      say('apple pay registered', domain)
    } catch (e) { say('apple pay FAILED', `${domain} — ${e.message}`) }
  }

  /* ── 6. Payment methods ───────────────────────────────────────────────── */
  const patch = {}
  for (const m of WANT_METHODS) patch[m] = { display_preference: { preference: 'on' } }
  const updated = await stripe.paymentMethodConfigurations.update(conf.id, patch)
  const nowOn = Object.entries(updated).filter(([, v]) => v && typeof v === 'object' && v.display_preference?.value === 'on').map(([k]) => k)
  say('methods now on', nowOn.sort().join(', '))

  /* ── 7. Install the keys LAST ─────────────────────────────────────────── */
  // Last on purpose: until this line the application is still on test keys, so
  // a failure anywhere above leaves a working test setup rather than a live one
  // with no webhook secret — which would take real money and record none of it.
  await setSetting('stripe_publishable_key', pk)
  await setSetting('stripe_secret_key', sk)
  await setSetting('stripe_webhook_secret', hook.secret)
  console.log('\n  live keys installed')

  /* ── 8. Prove it ──────────────────────────────────────────────────────── */
  const { rows: check } = await db.query(
    `SELECT key, left(value, 8) AS starts FROM settings WHERE key LIKE 'stripe_%' ORDER BY key`)
  console.log('')
  console.table(check)
}

main()
  .catch(e => { console.error('\nERROR:', e.message); process.exitCode = 1 })
  .finally(() => process.exit(process.exitCode ?? 0))
