/**
 * Notifications — the bell in Printshop's header and push to phones (owner,
 * 19 Sep 2026). Migration 154.
 *
 * Events are found by watching what the rest of Printshop already records,
 * never by changing the code that records it (payments in particular stay
 * untouched):
 *   payment_received   a payment row (Zelle, Stripe, PayPal, by hand)
 *   digi_shipped       a DIGI order the sync sees shipped
 *   delivered          a parcel the courier delivered (shipments, DIGI orders)
 *   stuck              a label no courier has scanned 3+ days after it was made
 *   claim              a new claim
 * The watcher runs every minute (scripts/notify-watch.js, host cron). Each
 * event carries a dedupe key, so it lands once per person however often the
 * watcher runs, and only events after the watcher's first run count — turning
 * it on never floods anyone with history.
 */
const db = require('../../config/db')
const webpush = require('web-push')

const STUCK_DAYS = 3
let vapidReady = null
function pushReady() {
  if (vapidReady !== null) return vapidReady
  const { VAPID_PUBLIC_KEY: pub, VAPID_PRIVATE_KEY: priv, VAPID_SUBJECT: subject } = process.env
  vapidReady = Boolean(pub && priv)
  if (vapidReady) webpush.setVapidDetails(subject || 'https://printshop.decoinkssuite.com', pub, priv)
  return vapidReady
}
const publicKey = () => process.env.VAPID_PUBLIC_KEY || null

const money = (n) => `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const SUCCESS_PAYMENT = `LOWER(COALESCE(p.status::text, '')) IN ('completed', 'received', 'paid', 'succeeded')`

// ── What happened since the watcher started ─────────────────────────────────
async function since() {
  const { rows } = await db.query(`SELECT value FROM notification_state WHERE key = 'watch_since'`)
  if (rows[0]?.value) return rows[0].value
  const { rows: now } = await db.query(
    `INSERT INTO notification_state (key, value) VALUES ('watch_since', NOW()::text)
     ON CONFLICT (key) DO UPDATE SET value = notification_state.value RETURNING value`)
  return now[0].value
}

async function findEvents(from) {
  const events = []
  const { rows: payments } = await db.query(
    `SELECT p.id, p.amount, p.customer_name, COALESCE(NULLIF(p.paid_via, ''), p.payment_method::text) AS via,
            p.payment_number, i.invoice_number
       FROM payments p LEFT JOIN invoices i ON i.id = p.invoice_id
      WHERE p.created_at > $1 AND ${SUCCESS_PAYMENT}
      ORDER BY p.created_at LIMIT 50`, [from])
  for (const p of payments) {
    events.push({
      type: 'payment_received', key: `payment:${p.id}`,
      title: `Payment received — ${money(p.amount)}`,
      body: [p.customer_name, p.via, p.invoice_number].filter(Boolean).join(' · '),
      link: `/payments/${p.id}`,
    })
  }

  const { rows: shipped } = await db.query(
    `SELECT d.order_no, d.consignee_name, d.courier, d.tracking_number, po.po_number
       FROM digi_orders d LEFT JOIN purchase_orders po ON po.id = d.po_id
      WHERE d.order_status = 12 AND COALESCE(d.shipping_time, d.synced_at) > $1
      ORDER BY d.shipping_time LIMIT 50`, [from])
  for (const d of shipped) {
    events.push({
      type: 'digi_shipped', key: `digi_shipped:${d.order_no}`,
      title: `DIGI shipped ${d.po_number || d.order_no}`,
      body: [d.consignee_name, [d.courier, d.tracking_number].filter(Boolean).join(' ')].filter(Boolean).join(' · '),
      link: '/supplier-management',
    })
  }

  // Delivered: a shipment, or a DIGI order Printshop has no shipment for. Keyed
  // by tracking number, so one parcel is one notification.
  const { rows: delivered } = await db.query(
    `SELECT DISTINCT ON (tn) tn, who, carrier, link FROM (
       SELECT BTRIM(s.tracking_number) tn, COALESCE(s.customer_name, s.recipient_name) who, s.carrier, '/shipments' link,
              (SELECT MAX((e->>'status_date')::timestamptz) FROM jsonb_array_elements(
                 CASE WHEN jsonb_typeof(s.tracking_history) = 'array' THEN s.tracking_history ELSE '[]' END) e
                WHERE UPPER(e->>'status') = 'DELIVERED') AS at
         FROM shipments s
        WHERE s.deleted_at IS NULL AND UPPER(COALESCE(s.tracking_status, '')) = 'DELIVERED' AND NULLIF(BTRIM(s.tracking_number), '') IS NOT NULL
       UNION ALL
       SELECT BTRIM(d.tracking_number), d.consignee_name, d.courier, '/supplier-management', d.courier_delivered_at
         FROM digi_orders d
        WHERE d.courier_delivered_at IS NOT NULL AND NULLIF(BTRIM(d.tracking_number), '') IS NOT NULL
     ) x WHERE at > $1 ORDER BY tn, at LIMIT 50`, [from])
  for (const d of delivered) {
    events.push({
      type: 'delivered', key: `delivered:${d.tn}`,
      title: `Delivered — ${d.who || d.tn}`,
      body: [d.carrier, d.tn].filter(Boolean).join(' '),
      link: d.link,
    })
  }

  // Stuck: a label made STUCK_DAYS ago that no courier has scanned. Only labels
  // that pass that mark after the watcher started.
  const { rows: stuck } = await db.query(
    `SELECT DISTINCT ON (tn) tn, who, carrier, link, made FROM (
       SELECT BTRIM(s.tracking_number) tn, COALESCE(s.customer_name, s.recipient_name) who, s.carrier, '/shipments' link,
              COALESCE(s.ship_date::timestamptz, s.created_at) made
         FROM shipments s
        WHERE s.deleted_at IS NULL AND UPPER(COALESCE(s.tracking_status, '')) = 'PRE_TRANSIT'
          AND NULLIF(BTRIM(s.tracking_number), '') IS NOT NULL
       UNION ALL
       SELECT BTRIM(d.tracking_number), d.consignee_name, d.courier, '/supplier-management',
              COALESCE(d.label_created_on::timestamptz, d.pre_shipping_time, d.shipping_time)
         FROM digi_orders d
        WHERE UPPER(COALESCE(d.courier_status, '')) = 'PRE_TRANSIT' AND COALESCE(d.order_status, 0) NOT IN (13, 15)
          AND NULLIF(BTRIM(d.tracking_number), '') IS NOT NULL
     ) x
     WHERE made IS NOT NULL AND made + INTERVAL '${STUCK_DAYS} days' <= NOW() AND made + INTERVAL '${STUCK_DAYS} days' > $1
     ORDER BY tn, made LIMIT 50`, [from])
  for (const s of stuck) {
    events.push({
      type: 'stuck', key: `stuck:${s.tn}`,
      title: `Not scanned for ${STUCK_DAYS}+ days — ${s.who || s.tn}`,
      body: `${[s.carrier, s.tn].filter(Boolean).join(' ')} · label made, no courier scan yet`,
      link: s.link,
    })
  }

  const { rows: claims } = await db.query(
    `SELECT c.id, c.claim_number, c.claim_category, cu.name AS customer
       FROM claims c LEFT JOIN customers cu ON cu.id = c.customer_id
      WHERE c.deleted_at IS NULL AND c.created_at > $1 ORDER BY c.created_at LIMIT 50`, [from])
  for (const c of claims) {
    events.push({
      type: 'claim', key: `claim:${c.id}`,
      title: `New claim ${c.claim_number || ''}`.trim(),
      body: [c.customer, c.claim_category].filter(Boolean).join(' · '),
      link: `/claims/${c.id}`,
    })
  }
  return events
}

// ── Delivering ───────────────────────────────────────────────────────────────
// One row per active person; a push to each of their devices for the rows
// that are new. A device the push service no longer knows is forgotten.
async function deliver(event, userIds = null) {
  const { rows } = await db.query(
    `INSERT INTO notifications (user_id, type, title, body, link, dedupe_key)
     SELECT u.id, $1, $2, $3, $4, $5 FROM users u
      WHERE u.is_active AND ($6::uuid[] IS NULL OR u.id = ANY($6::uuid[]))
     ON CONFLICT (user_id, dedupe_key) DO NOTHING
     RETURNING id, user_id`,
    [event.type, event.title, event.body || null, event.link || null, event.key, userIds])
  if (!rows.length || !pushReady()) return rows.length
  const { rows: subs } = await db.query(
    `SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ANY($1::uuid[])`,
    [[...new Set(rows.map(r => r.user_id))]])
  const payload = JSON.stringify({ title: event.title, body: event.body || '', url: event.link || '/dashboard', tag: event.key, type: event.type })
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 60 * 60 * 24 })
      await db.query(`UPDATE push_subscriptions SET last_used_at = NOW() WHERE id = $1`, [s.id])
    } catch (err) {
      if (err.statusCode === 404 || err.statusCode === 410) {
        console.warn('[notify] push device gone, forgotten', err.statusCode, String(err.body || '').slice(0, 120))
        await db.query(`DELETE FROM push_subscriptions WHERE id = $1`, [s.id])
      }
      else console.error('[notify] push failed', err.statusCode || '', String(err.body || err.message).slice(0, 200))
    }
  }))
  return rows.length
}

async function watch({ log = console.log } = {}) {
  const from = await since()
  const events = await findEvents(from)
  let delivered = 0
  for (const e of events) delivered += await deliver(e)
  // Keep a quarter of history.
  await db.query(`DELETE FROM notifications WHERE created_at < NOW() - INTERVAL '90 days'`)
  log(`[notify] since ${from}: ${events.length} events, ${delivered} new notifications`)
  return { events: events.length, delivered }
}

// ── For the bell ─────────────────────────────────────────────────────────────
async function list(userId, limit = 30) {
  const { rows } = await db.query(
    `SELECT id, type, title, body, link, created_at, read_at FROM notifications
      WHERE user_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2`, [userId, Math.min(100, Math.max(1, limit))])
  const { rows: c } = await db.query(`SELECT COUNT(*)::int n FROM notifications WHERE user_id = $1 AND read_at IS NULL`, [userId])
  return { rows, unread: c[0].n }
}
async function markRead(userId, id) {
  await db.query(`UPDATE notifications SET read_at = NOW() WHERE user_id = $1 AND id = $2 AND read_at IS NULL`, [userId, id])
}
async function markAllRead(userId) {
  await db.query(`UPDATE notifications SET read_at = NOW() WHERE user_id = $1 AND read_at IS NULL`, [userId])
}

async function subscribe(userId, sub, userAgent) {
  const endpoint = String(sub?.endpoint || '')
  const p256dh = String(sub?.keys?.p256dh || ''), auth = String(sub?.keys?.auth || '')
  if (!/^https:\/\//.test(endpoint) || endpoint.length > 1000 || !p256dh || !auth || p256dh.length > 200 || auth.length > 100) {
    throw Object.assign(new Error('That is not a push subscription'), { status: 400 })
  }
  await db.query(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth,
       user_agent = EXCLUDED.user_agent`,
    [userId, endpoint, p256dh, auth, String(userAgent || '').slice(0, 300)])
}
async function unsubscribe(userId, endpoint) {
  await db.query(`DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2`, [userId, String(endpoint || '')])
}

// A test the person sends themselves from the bell.
async function test(userId) {
  return deliver({
    type: 'test', key: `test:${Date.now()}`,
    title: 'Printshop notifications are on',
    body: 'Payments, DIGI shipping, deliveries, stuck parcels and claims will show up here.',
    link: '/dashboard',
  }, [userId])
}

module.exports = { watch, list, markRead, markAllRead, subscribe, unsubscribe, test, publicKey, pushReady }
