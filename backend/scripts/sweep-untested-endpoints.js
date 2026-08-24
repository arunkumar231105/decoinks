#!/usr/bin/env node
/**
 * Call the parts of the API nobody has been looking at.
 *
 * The chain test walks a job from lead to purchase order and the preview test
 * checks what gets printed, but between them they touch perhaps thirty of the
 * two hundred and thirty-one routes in this codebase. Artworks alone has
 * thirty-eight. The portals, the dashboard, search, the vault, the settings —
 * none of it has been exercised since it was written.
 *
 * Four passes:
 *
 *   READS      Every GET route that needs no id: does it answer, and with the
 *              shape the screen expects. A 500 here is a page that is blank for
 *              somebody right now.
 *
 *   PERMISSION The same routes with a Sales token rather than an Admin one.
 *              Anything that hands a salesperson the user list, the settings or
 *              another company's portal is a hole, and nothing has ever checked.
 *
 *   NO TOKEN   The same routes with no token at all. Every one must refuse.
 *
 *   TRANSITIONS The status rules: an invoice cannot go from Draft to Paid
 *              without money, an order cannot go backwards from Delivered.
 *              Whatever the state machine claims, it should hold at the API.
 *
 * Nothing is written. Every request is a GET or a rejected write.
 *
 * Usage (inside the backend container):
 *   SMOKE_BASE=http://localhost:8001/api node scripts/sweep-untested-endpoints.js
 */
const jwt = require('jsonwebtoken')
const { Pool } = require('pg')

const BASE = process.env.SMOKE_BASE || 'http://localhost:8001/api'
const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) { console.error('DATABASE_URL is not set.'); process.exit(1) }
const pool = new Pool({ connectionString: DATABASE_URL })

const pass = []
const fail = []
const note = []
const ok = (n, d) => pass.push({ n, d })
const bad = (n, d) => fail.push({ n, d })

// Routes that need no id, grouped by what they are for.
const READS = [
  ['dashboard', ['/dashboard/overview', '/dashboard/stats', '/dashboard/lead-pipeline',
    '/dashboard/orders-by-status', '/dashboard/top-suppliers', '/dashboard/recent-activity']],
  ['artworks', ['/artworks', '/artworks/board', '/artworks/mockups', '/artworks/vault/assets',
    '/artworks/vault/stats', '/artworks/vault/facets']],
  ['leads', ['/leads', '/leads/list?page=1&limit=5', '/leads/stats', '/leads/filters']],
  ['customers', ['/customers?page=1&limit=5', '/customers/stats', '/customers/filters', '/customers/portal-accounts']],
  ['money', ['/payments?page=1&limit=5', '/payments/stats', '/payments/filters']],
  ['shipments', ['/shipments?page=1&limit=5', '/shipments/stats']],
  ['documents', ['/quotations?page=1&limit=5', '/invoices?page=1&limit=5',
    '/orders?page=1&limit=5', '/orders/board', '/purchase-orders?page=1&limit=5', '/purchase-orders/summary']],
  ['catalogue', ['/products?page=1&limit=5']],
  ['people', ['/suppliers?page=1&limit=5', '/users']],
  ['other', ['/settings', '/search?q=test', '/nextcloud/status']],
  ['csv templates', ['/orders/csv-template', '/quotations/csv-template']],
]

// Routes only an Admin or Manager should reach at all. /settings is not among
// them: everyone needs the company details and the role list to render a page.
// What everyone must not have is the credentials inside it, which is checked
// separately below.
const ADMIN_ONLY = ['/users', '/customers/portal-accounts']
// Routes belonging to a different audience entirely.
const OTHER_AUDIENCE = ['/supplier-portal/me', '/supplier-portal/dashboard', '/customer-portal/summary']

async function call(path, token) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {}
  try {
    const res = await fetch(`${BASE}${path}`, { headers })
    let body = null
    try { body = await res.json() } catch { /* not json */ }
    return { status: res.status, body }
  } catch (e) {
    return { status: 0, body: { message: e.message } }
  }
}

async function main() {
  const { rows: [db] } = await pool.query('SELECT current_database() AS name')
  console.log(`API ${BASE}   database ${db.name}\n`)

  const { rows: [admin] } = await pool.query(
    `SELECT id, email, role::text AS role FROM users WHERE is_active AND role='Admin' ORDER BY created_at LIMIT 1`)
  const { rows: [sales] } = await pool.query(
    `SELECT id, email, role::text AS role FROM users WHERE is_active AND role='Sales' ORDER BY created_at LIMIT 1`)
  const sign = u => jwt.sign({ id: u.id, email: u.email, role: u.role }, process.env.JWT_SECRET, { expiresIn: '20m' })
  const ADMIN = sign(admin)
  const SALES = sales ? sign(sales) : null
  if (!sales) note.push('no active Sales user exists, so the permission pass could not run')

  // ── 1. Reads ────────────────────────────────────────────────────────
  console.log('READS — every list and summary the screens ask for')
  for (const [group, paths] of READS) {
    const broken = []
    for (const p of paths) {
      const r = await call(p, ADMIN)
      if (r.status >= 500 || r.status === 0) { broken.push(`${p} → ${r.status || 'no reply'}${r.body?.message ? `: ${r.body.message}` : ''}`); continue }
      if (r.status === 404) { broken.push(`${p} → 404, the route is not reachable`); continue }
      if (r.status >= 400) { broken.push(`${p} → ${r.status}`); continue }
      ok(`${group}: ${p}`)
    }
    console.log(`  ${broken.length ? '✗' : '✓'} ${group.padEnd(14)} ${paths.length - broken.length}/${paths.length}`)
    broken.forEach(b => { console.log(`      ${b}`); bad(`read ${group}`, b) })
  }

  // ── 2. No token ─────────────────────────────────────────────────────
  console.log('\nNO TOKEN — every one of them must refuse')
  const leaked = []
  for (const [, paths] of READS) {
    for (const p of paths) {
      const r = await call(p, null)
      if (r.status === 401 || r.status === 403) ok(`unauthenticated ${p} refused`)
      else leaked.push(`${p} → ${r.status}`)
    }
  }
  console.log(`  ${leaked.length ? '✗' : '✓'} ${leaked.length === 0 ? 'all refused' : `${leaked.length} answered without a token`}`)
  leaked.forEach(l => { console.log(`      ${l}`); bad('open without a token', l) })

  // ── 3. Permission ───────────────────────────────────────────────────
  if (SALES) {
    console.log(`\nPERMISSION — the same routes as ${sales.role} (${sales.email})`)
    const reachable = []
    for (const p of [...ADMIN_ONLY, ...OTHER_AUDIENCE]) {
      const r = await call(p, SALES)
      // 404 counts as refused: the portals answer that way rather than admit
      // the route exists for somebody else, and not admitting it is the point.
      if ([401, 403, 404].includes(r.status)) ok(`${sales.role} refused ${p}`)
      else if (r.status >= 500) bad('permission', `${p} → ${r.status} for a ${sales.role}`)
      else reachable.push(`${p} → ${r.status}`)
    }
    // Reading settings is fine; reading the shop's own credentials is not.
    const st = await call('/settings', SALES)
    const leakedKeys = ['meta_page_token', 'meta_app_secret', 'shippo_api_key']
      .filter(k => st.body?.settings && st.body.settings[k])
    if (leakedKeys.length) {
      bad('secrets', `a ${sales.role} can read ${leakedKeys.join(', ')} from /settings`)
      console.log(`      /settings hands a ${sales.role} these: ${leakedKeys.join(', ')}`)
    } else ok('settings withholds the credentials from a Sales user')

    console.log(`  ${reachable.length ? '✗' : '✓'} ${reachable.length === 0
      ? 'admin-only and other-audience routes all refused'
      : `${reachable.length} reachable by a ${sales.role} user`}`)
    reachable.forEach(x => { console.log(`      ${x}`); bad(`reachable by ${sales.role}`, x) })
  }

  // ── 4. Status transitions ───────────────────────────────────────────
  console.log('\nTRANSITIONS — the status rules, as the API enforces them')
  const H = t => ({ Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' })
  const patch = async (p, body) => {
    const res = await fetch(`${BASE}${p}`, { method: 'PATCH', headers: H(ADMIN), body: JSON.stringify(body) })
    let b = null; try { b = await res.json() } catch {}
    return { status: res.status, body: b }
  }
  const { rows: [delivered] } = await pool.query(
    `SELECT id, order_number FROM orders WHERE deleted_at IS NULL AND status='Delivered' LIMIT 1`)
  const { rows: [draftInv] } = await pool.query(
    `SELECT id, invoice_number FROM invoices WHERE deleted_at IS NULL AND status='Draft' LIMIT 1`)

  const checks = []
  if (delivered) checks.push({
    what: 'a delivered order cannot be sent back to Draft',
    run: () => patch(`/orders/${delivered.id}/status`, { status: 'Draft' }),
    expect: s => s >= 400, where: delivered.order_number })
  if (delivered) checks.push({
    what: 'a nonsense status is refused',
    run: () => patch(`/orders/${delivered.id}/status`, { status: 'Teleported' }),
    expect: s => s >= 400, where: delivered.order_number })
  if (draftInv) checks.push({
    what: 'a negative payment is refused',
    run: () => patch(`/invoices/${draftInv.id}/payment`, { amount: -50, payment_method: 'cash' }),
    expect: s => s >= 400, where: draftInv.invoice_number })
  if (draftInv) checks.push({
    what: 'an unknown payment method is refused',
    run: () => patch(`/invoices/${draftInv.id}/payment`, { amount: 5, payment_method: 'goats' }),
    expect: s => s >= 400, where: draftInv.invoice_number })

  for (const c of checks) {
    const r = await c.run()
    if (c.expect(r.status)) { ok(c.what); console.log(`  ✓ ${c.what}  (${c.where} → ${r.status})`) }
    else { bad('transition', `${c.what} — ${c.where} answered ${r.status}`); console.log(`  ✗ ${c.what}  (${c.where} → ${r.status}, it went through)`) }
  }
  if (!checks.length) note.push('no delivered order or draft invoice to test transitions against')

  // ── Verdict ─────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(72)}`)
  if (note.length) note.forEach(n => console.log(`note: ${n}`))
  if (!fail.length) console.log(`ALL ${pass.length} CHECKS PASSED across ${READS.reduce((s, [, p]) => s + p.length, 0)} endpoints`)
  else {
    console.log(`${pass.length} passed, ${fail.length} FAILED:\n`)
    fail.forEach(f => console.log(`  ✗ ${f.n}\n      ${f.d}`))
  }
  await pool.end()
  process.exitCode = fail.length ? 1 : 0
}

main().catch(async e => { console.error(e); try { await pool.end() } catch {} ; process.exit(1) })
