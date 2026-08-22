#!/usr/bin/env node
/**
 * Exercise every read endpoint the app calls, plus the validation on the write
 * ones, and report what is broken.
 *
 * This is a black-box pass over the running API: it signs an admin token with
 * the server's own secret, walks the routes the UI uses, and records the status
 * and shape of each reply. Nothing is written — the only POSTs are deliberately
 * invalid payloads sent to confirm the endpoint rejects them, which is the
 * check that matters for "is validation missing".
 *
 * Usage (inside the backend container):
 *   node scripts/smoke-test-api.js
 */
const jwt = require('jsonwebtoken')
const { Pool } = require('pg')

const BASE = process.env.SMOKE_BASE || 'http://localhost:8000/api'
const pool = new Pool({ connectionString: process.env.DATABASE_URL })

const results = { pass: [], fail: [], warn: [] }
const rec = (bucket, name, detail) => results[bucket].push({ name, detail })

async function call(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  let payload = null
  try { payload = await res.json() } catch { /* non-JSON */ }
  return { status: res.status, payload }
}

let TOKEN

// A list endpoint should answer 200 and hand back rows in the documented shape.
async function checkList(name, path, { expectRows = true } = {}) {
  const { status, payload } = await call('GET', path)
  if (status !== 200) return rec('fail', name, `${path} → HTTP ${status}${payload?.message ? `: ${payload.message}` : ''}`)
  const data = payload?.data ?? payload
  const rows = Array.isArray(data) ? data : data?.rows
  if (expectRows && !Array.isArray(rows)) return rec('fail', name, `${path} → 200 but no rows array (keys: ${Object.keys(data || {}).join(', ') || 'none'})`)
  rec('pass', name, `${path} → ${Array.isArray(rows) ? `${rows.length} rows` : 'ok'}`)
  return rows
}

// A write endpoint must refuse an empty/invalid body rather than 500 or accept it.
async function checkRejects(name, path, body) {
  const { status, payload } = await call('POST', path, body)
  if (status >= 500) return rec('fail', name, `${path} → HTTP ${status} on invalid input (should be 4xx): ${payload?.message || ''}`)
  if (status < 400) {
    // The endpoint accepted rubbish. Take the record straight back out — a probe
    // must never leave a row behind in a live database.
    const created = payload?.data?.id ?? payload?.id
    let cleanup = 'could not identify the created row'
    if (created) {
      const del = await call('DELETE', `${path}/${created}`)
      cleanup = del.status < 400 ? `created row ${created} removed` : `created row ${created} COULD NOT BE REMOVED (HTTP ${del.status})`
    }
    return rec('fail', name, `${path} → accepted an invalid payload (HTTP ${status}) — validation missing; ${cleanup}`)
  }
  rec('pass', name, `${path} → rejected with ${status}`)
}

async function main() {
  const { rows: [user] } = await pool.query(
    `SELECT id, email, role::text AS role FROM users WHERE is_active AND role = 'Admin' ORDER BY created_at LIMIT 1`)
  if (!user) throw new Error('No active admin user to sign a test token for')
  TOKEN = jwt.sign({ id: user.id, email: user.email, role: user.role }, process.env.JWT_SECRET, { expiresIn: '10m' })

  // ── Lists the UI loads ────────────────────────────────────────────────────
  await checkList('leads',            '/leads/list?page=1&limit=5')   // '/leads' is the kanban board
  await checkList('customers',        '/customers?page=1&limit=5')
  await checkList('quotations',       '/quotations?page=1&limit=5')
  await checkList('invoices',         '/invoices?page=1&limit=5')
  await checkList('orders',           '/orders?page=1&limit=5')
  await checkList('purchase orders',  '/purchase-orders?page=1&limit=5')
  await checkList('shipments',        '/shipments?page=1&limit=5')
  await checkList('payments',         '/payments?page=1&limit=5')
  await checkList('suppliers',        '/suppliers?page=1&limit=5')
  await checkList('products',         '/products?page=1&limit=5')
  await checkList('artworks',         '/artworks?page=1&limit=5')
  await checkList('users',            '/users?page=1&limit=5')

  // ── Summary / stats panels ────────────────────────────────────────────────
  for (const [name, path] of [
    ['dashboard overview', '/dashboard/overview'],
    ['shipment stats',     '/shipments/stats'],
    ['customer stats',     '/customers/stats'],
    ['customer filters',   '/customers/filters'],
  ]) {
    const { status, payload } = await call('GET', path)
    if (status !== 200) rec('fail', name, `${path} → HTTP ${status}${payload?.message ? `: ${payload.message}` : ''}`)
    else rec('pass', name, `${path} → ok`)
  }

  // ── Detail pages: take a real id from each list and open it ───────────────
  const pairs = [
    ['quotation detail',     '/quotations', 'quotations'],
    ['invoice detail',       '/invoices',   'invoices'],
    ['order detail',         '/orders',     'orders'],
    ['purchase order detail','/purchase-orders', 'purchase_orders'],
    ['shipment detail',      '/shipments',  'shipments'],
    ['customer detail',      '/customers',  'customers'],
  ]
  for (const [name, base] of pairs) {
    const { payload } = await call('GET', `${base}?page=1&limit=1`)
    const row = (payload?.data?.rows ?? payload?.data ?? [])[0]
    if (!row?.id) { rec('warn', name, `${base} returned no row to open`); continue }
    const { status, payload: one } = await call('GET', `${base}/${row.id}`)
    if (status !== 200) rec('fail', name, `${base}/:id → HTTP ${status}${one?.message ? `: ${one.message}` : ''}`)
    else rec('pass', name, `${base}/:id → ok`)
  }

  // ── Validation on the write paths ─────────────────────────────────────────
  await checkRejects('quotation validation', '/quotations', {})
  await checkRejects('invoice validation',   '/invoices',   {})
  await checkRejects('order validation',     '/orders',     {})
  await checkRejects('customer validation',  '/customers',  {})
  await checkRejects('payment validation',   '/payments',   {})
  await checkRejects('shipment validation',  '/shipments',  {})

  // ── Report ────────────────────────────────────────────────────────────────
  const line = (r) => `  ${r.name.padEnd(24)} ${r.detail}`
  console.log(`PASS ${results.pass.length}   FAIL ${results.fail.length}   WARN ${results.warn.length}\n`)
  if (results.fail.length) { console.log('FAILURES'); results.fail.forEach(r => console.log(line(r))) }
  if (results.warn.length) { console.log('\nWARNINGS'); results.warn.forEach(r => console.log(line(r))) }
  console.log('\nPASSED'); results.pass.forEach(r => console.log(line(r)))
  await pool.end()
  process.exitCode = results.fail.length ? 1 : 0
}

main().catch(err => { console.error(err.message); process.exit(1) })
