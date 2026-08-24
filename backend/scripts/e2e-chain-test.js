#!/usr/bin/env node
/**
 * Walk the whole commercial chain the way a person does, and check what
 * arrives at each step.
 *
 *   lead → customer → quotation → invoice → sales order → purchase order
 *
 * The smoke test asks whether the endpoints answer. This asks whether the work
 * carries: that a customer's details reach the quote, that every line and every
 * figure reaches the invoice, that editing the quote and converting again
 * updates the invoice instead of leaving it stale, that marking an invoice paid
 * sticks, and that the order and the purchase order after it still describe the
 * same job.
 *
 * The chain runs once for each of the three quote types — apparel, dtf,
 * gangsheet — because they take different paths through the item tables and a
 * bug in one is invisible from the others.
 *
 * Every step is timed. The last section prints the slowest, because the shop
 * enters these one after another and waiting is the complaint.
 *
 * Everything it creates, it deletes. Run it against the sandbox.
 *
 * Usage (inside the backend container):
 *   SMOKE_BASE=http://localhost:8001/api node scripts/e2e-chain-test.js
 *   ... --keep    leave the records behind for inspection in the UI
 */
const jwt = require('jsonwebtoken')
const { Pool } = require('pg')

const BASE = process.env.SMOKE_BASE || 'http://localhost:8001/api'
const KEEP = process.argv.includes('--keep')
const pool = new Pool({ connectionString: process.env.DATABASE_URL })

let TOKEN
let SUPPLIER = null
const timings = []
const checks = { pass: 0, fail: [] }
const created = { leads: [], customers: [], quotations: [], invoices: [], orders: [], pos: [] }

const money = n => Number(n || 0).toFixed(2)
const unwrap = p => p?.data ?? p

async function call(method, path, body) {
  const t0 = process.hrtime.bigint()
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  const ms = Number(process.hrtime.bigint() - t0) / 1e6
  let payload = null
  try { payload = await res.json() } catch { /* non-JSON */ }
  timings.push({ label: `${method} ${path.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, ':id')}`, ms })
  return { status: res.status, payload, ms }
}

function check(name, ok, detail = '') {
  if (ok) { checks.pass++; console.log(`  ✓ ${name}`) }
  else { checks.fail.push({ name, detail }); console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`) }
  return ok
}

function same(name, a, b, fmt = v => String(v ?? '')) {
  return check(`${name} carried`, fmt(a) === fmt(b), `quote "${fmt(a)}" vs next "${fmt(b)}"`)
}

// ── The customer this run uses ──────────────────────────────────────────────
const stamp = Date.now().toString().slice(-6)
const BASE_PERSON = {
  customer_name: `E2E Test ${stamp}`,
  company_name: `E2E Print Co ${stamp}`,
  email: `e2e${stamp}@example.test`,
  phone: '+1 555 0100',
  whatsapp: '+1 555 0101',
  shipping_address: '742 Evergreen Terrace, Springfield, IL 62704, USA',
  billing_address: '742 Evergreen Terrace, Springfield, IL 62704, USA',
}

// ── The three shapes of quote ───────────────────────────────────────────────
const LINES = {
  apparel: [
    { description: 'Gildan 5000 Heavy Cotton Tee', qty: 24, unit_price: 8.75, sizes: 'L', colors: 'Black',
      brand: 'Gildan', model: '5000', category: 'T-Shirt', artwork_count: 1 },
    { description: 'Gildan 18500 Hoodie', qty: 12, unit_price: 22.4, sizes: 'XL', colors: 'Navy',
      brand: 'Gildan', model: '18500', category: 'Hoodie', artwork_count: 2 },
  ],
  dtf: [
    // 2.037 is the rate that used to round to 2.04 — it belongs in every run.
    { description: 'AW#01 — Left Chest', qty: 250, unit_price: 2.037, sizes: '4x3.5', artwork_count: 1 },
    { description: 'AW#02 — Full Back', qty: 100, unit_price: 3.125, sizes: '11.5x14', artwork_count: 1 },
  ],
  gangsheet: [
    { description: '22" x 60"', qty: 3, unit_price: 25, artwork_count: 4 },
    { description: '22" x 84"', qty: 2, unit_price: 35, artwork_count: 6 },
  ],
}

async function runChain(orderType) {
  // A unique person per chain: the customer email is unique in the database.
  // A unique person per chain: email, phone and company are each unique in the
  // database, so three chains sharing one identity collide on the second.
  const n = { apparel: 1, dtf: 2, gangsheet: 3 }[orderType]
  const PERSON = { ...BASE_PERSON,
    customer_name: `${BASE_PERSON.customer_name} ${orderType}`,
    company_name:  `${BASE_PERSON.company_name} ${orderType}`,
    email:    `e2e${stamp}.${orderType}@example.test`,
    phone:    `+1 555 01${n}0`,
    whatsapp: `+1 555 01${n}1`,
  }
  console.log(`\n${'━'.repeat(74)}\n  ${orderType.toUpperCase()}\n${'━'.repeat(74)}`)
  const items = LINES[orderType]
  const shipping = 45.5
  const rush = 20

  // ── 1. Lead ───────────────────────────────────────────────────────────────
  console.log('\nLead → customer')
  const lead = await call('POST', '/leads', {
    ...PERSON, source: 'Email', description: `${orderType} enquiry, e2e run`,
  })
  if (!check('lead created', lead.status < 400, `HTTP ${lead.status}: ${lead.payload?.message || ''}`)) return
  const leadId = unwrap(lead.payload)?.id
  created.leads.push(leadId)

  const conv = await call('POST', `/leads/${leadId}/convert-to-customer`)
  if (!check('lead converted to customer', conv.status < 400,
    `HTTP ${conv.status}: ${conv.payload?.message || ''}`)) return
  const customer = unwrap(conv.payload)?.customer ?? unwrap(conv.payload)
  const customerId = customer?.id
  created.customers.push(customerId)

  // The details the person typed on the lead must be on the customer.
  const cust = unwrap((await call('GET', `/customers/${customerId}`)).payload)
  const c = cust?.customer ?? cust
  check('customer keeps the name',    (c?.name || '').includes(`E2E Test ${stamp}`), `got "${c?.name}"`)
  check('customer keeps the email',   c?.email === PERSON.email, `got "${c?.email}"`)
  check('customer keeps the phone',   !!(c?.phone || c?.contact_number), `got "${c?.phone || c?.contact_number}"`)
  check('customer has an address',
    !!(c?.shipping_address || c?.billing_address || (c?.addresses || []).length),
    'no shipping or billing address reached the customer record')

  // ── 2. Quotation ──────────────────────────────────────────────────────────
  console.log('\nQuotation')
  const q = await call('POST', '/quotations', {
    customer_id: customerId, lead_id: leadId, order_type: orderType,
    supplier_id: SUPPLIER?.id,
    items, estimated_shipping: shipping, rush_services: rush, discount_pct: 0,
    customer_name: PERSON.customer_name, company_name: PERSON.company_name,
    billing_email: PERSON.email, contact_number: PERSON.phone,
    shipping_address: PERSON.shipping_address, billing_address: PERSON.billing_address,
    notes: `e2e ${orderType}`,
  })
  if (!check('quotation created', q.status < 400, `HTTP ${q.status}: ${JSON.stringify(q.payload?.errors || q.payload?.message || '')}`)) return
  const quoteId = unwrap(q.payload)?.id
  created.quotations.push(quoteId)

  const quote = unwrap((await call('GET', `/quotations/${quoteId}`)).payload)
  const qd = quote?.quotation ?? quote
  const qItems = qd?.items || []

  // The customer's details must be on the quote without anyone retyping them.
  check('quote carries the customer',  qd?.customer_id === customerId, `got ${qd?.customer_id}`)
  check('quote carries the email',     qd?.billing_email === PERSON.email, `got "${qd?.billing_email}"`)
  check('quote carries the address',   (qd?.shipping_address || '').includes('Evergreen'), `got "${qd?.shipping_address}"`)
  check('quote has every line',        qItems.length === items.length, `${qItems.length} of ${items.length}`)

  // The exact rate must survive. 2.037 must not become 2.04.
  const rateLine = qItems.find(x => Number(x.unit_price) > 2 && Number(x.unit_price) < 2.1)
  if (orderType === 'dtf') {
    check('rate 2.037 stored exactly', rateLine && Number(rateLine.unit_price) === 2.037,
      `stored ${rateLine?.unit_price}`)
  }

  const expected = items.reduce((s, i) => s + i.qty * i.unit_price, 0)
  check('quote subtotal is the sum of the lines',
    money(qd?.subtotal) === money(expected), `${money(qd?.subtotal)} vs ${money(expected)}`)
  check('quote total includes shipping and rush',
    money(qd?.total) === money(expected + shipping + rush),
    `${money(qd?.total)} vs ${money(expected + shipping + rush)}`)

  // ── 3. Edit the quote and save ────────────────────────────────────────────
  console.log('\nEdit the quotation')
  const editedItems = items.map((i, n) => n === 0 ? { ...i, qty: i.qty + 6 } : i)
  const upd = await call('PUT', `/quotations/${quoteId}`, {
    items: editedItems, estimated_shipping: shipping, rush_services: rush, notes: 'edited by e2e',
  })
  check('quotation edit saved', upd.status < 400, `HTTP ${upd.status}: ${upd.payload?.message || ''}`)

  const quote2 = unwrap((await call('GET', `/quotations/${quoteId}`)).payload)
  const qd2 = quote2?.quotation ?? quote2
  const newExpected = editedItems.reduce((s, i) => s + i.qty * i.unit_price, 0)
  check('edited quantity persisted',
    (qd2?.items || []).some(x => Number(x.qty) === editedItems[0].qty),
    `looking for qty ${editedItems[0].qty} in ${(qd2?.items || []).map(x => x.qty).join(', ')}`)
  check('edited quote recalculated its total',
    money(qd2?.total) === money(newExpected + shipping + rush),
    `${money(qd2?.total)} vs ${money(newExpected + shipping + rush)}`)
  check('quote notes edit persisted', qd2?.notes === 'edited by e2e', `got "${qd2?.notes}"`)

  // ── 4. Convert to invoice ─────────────────────────────────────────────────
  console.log('\nQuotation → invoice')
  const ci = await call('POST', `/quotations/${quoteId}/convert-to-invoice`)
  if (!check('converted to invoice', ci.status < 400, `HTTP ${ci.status}: ${ci.payload?.message || ''}`)) return
  const invoiceId = unwrap(ci.payload)?.id ?? unwrap(ci.payload)?.invoice?.id
  created.invoices.push(invoiceId)

  const inv = unwrap((await call('GET', `/invoices/${invoiceId}`)).payload)
  const iv = inv?.invoice ?? inv
  const iItems = iv?.items || []

  same('invoice customer', qd2?.customer_id, iv?.customer_id)
  same('invoice email', qd2?.billing_email, iv?.billing_email)
  same('invoice shipping address', qd2?.shipping_address, iv?.shipping_address)
  same('invoice order type', qd2?.order_type, iv?.order_type)
  check('invoice has every line', iItems.length === editedItems.length, `${iItems.length} of ${editedItems.length}`)
  same('invoice subtotal', qd2?.subtotal, iv?.subtotal, money)
  same('invoice shipping charge', qd2?.estimated_shipping ?? shipping, iv?.shipping_charges, money)
  same('invoice total', qd2?.total, iv?.total, money)
  if (orderType === 'dtf') {
    const r = iItems.find(x => Number(x.unit_price) > 2 && Number(x.unit_price) < 2.1)
    check('invoice keeps rate 2.037', r && Number(r.unit_price) === 2.037, `got ${r?.unit_price}`)
  }
  // Every line, one for one — description, quantity and money.
  const lineMismatch = editedItems.filter((src, n) => {
    const got = iItems[n]
    return !got || String(got.description).trim() !== String(src.description).trim() ||
      Number(got.qty) !== src.qty || money(got.unit_price) !== money(src.unit_price)
  })
  check('every invoice line matches the quote line', lineMismatch.length === 0,
    lineMismatch.map(m => m.description).join('; '))

  // ── 5. Edit the quote again, convert again — the invoice must follow ──────
  console.log('\nEdit the quotation again → convert again')
  const twiceItems = editedItems.map((i, n) => n === 0 ? { ...i, qty: i.qty + 10 } : i)
  await call('PUT', `/quotations/${quoteId}`, {
    items: twiceItems, estimated_shipping: shipping + 10, rush_services: rush,
  })
  const ci2 = await call('POST', `/quotations/${quoteId}/convert-to-invoice`)
  check('second conversion answered', ci2.status < 400, `HTTP ${ci2.status}: ${ci2.payload?.message || ''}`)
  const invoiceId2 = unwrap(ci2.payload)?.id ?? unwrap(ci2.payload)?.invoice?.id
  if (invoiceId2 && invoiceId2 !== invoiceId) created.invoices.push(invoiceId2)

  const inv2 = unwrap((await call('GET', `/invoices/${invoiceId2 || invoiceId}`)).payload)
  const iv2 = inv2?.invoice ?? inv2
  const twiceExpected = twiceItems.reduce((s, i) => s + i.qty * i.unit_price, 0)
  check('re-converted invoice shows the edited quantity',
    (iv2?.items || []).some(x => Number(x.qty) === twiceItems[0].qty),
    `looking for ${twiceItems[0].qty} in ${(iv2?.items || []).map(x => x.qty).join(', ')}`)
  check('re-converted invoice total is right',
    money(iv2?.total) === money(twiceExpected + shipping + 10 + rush),
    `${money(iv2?.total)} vs ${money(twiceExpected + shipping + 10 + rush)}`)
  check('re-converting did not leave two invoices for one quote',
    !invoiceId2 || invoiceId2 === invoiceId,
    `quote ${quoteId} now has invoices ${invoiceId} and ${invoiceId2}`)

  const liveInvoice = invoiceId2 || invoiceId

  // ── 6. Payment ────────────────────────────────────────────────────────────
  console.log('\nPayment')
  const total = Number(iv2?.total || 0)
  const half = Math.round(total / 2 * 100) / 100
  const part = await call('PATCH', `/invoices/${liveInvoice}/payment`, {
    amount: half, payment_method: 'bank_transfer', reference_no: `E2E-${stamp}`,
  })
  check('part payment accepted', part.status < 400, `HTTP ${part.status}: ${part.payload?.message || ''}`)
  const afterPart = unwrap((await call('GET', `/invoices/${liveInvoice}`)).payload)
  const ap = afterPart?.invoice ?? afterPart
  check('part payment shows as Partial',
    ['Partial', 'Partially Paid'].includes(ap?.status),
    `status is "${ap?.status}", balance ${money(ap?.balance_due)}`)

  const full = await call('PATCH', `/invoices/${liveInvoice}/payment`, {
    amount: Math.round((total - half) * 100) / 100, payment_method: 'bank_transfer',
  })
  check('full payment accepted', full.status < 400, `HTTP ${full.status}: ${full.payload?.message || ''}`)
  const afterFull = unwrap((await call('GET', `/invoices/${liveInvoice}`)).payload)
  const af = afterFull?.invoice ?? afterFull
  check('invoice marked Paid sticks', af?.status === 'Paid', `status is "${af?.status}"`)
  check('balance due is zero once paid', money(af?.balance_due) === '0.00', `balance ${money(af?.balance_due)}`)

  // ── 7. Invoice → sales order ──────────────────────────────────────────────
  console.log('\nInvoice → sales order')
  const co = await call('POST', `/invoices/${liveInvoice}/convert-to-order`, { order_type: orderType })
  if (!check('converted to sales order', co.status < 400, `HTTP ${co.status}: ${co.payload?.message || ''}`)) return
  const orderId = unwrap(co.payload)?.id ?? unwrap(co.payload)?.order?.id
  created.orders.push(orderId)

  const ord = unwrap((await call('GET', `/orders/${orderId}`)).payload)
  const od = ord?.order ?? ord
  const oItems = od?.items || od?.line_items || []
  same('order customer', af?.customer_id, od?.customer_id)
  same('order type', af?.order_type, od?.order_type)
  same('order total', af?.total, od?.total, money)
  same('order shipping charge', af?.shipping_charges, od?.shipping_charges, money)
  check('order has every line', oItems.length === twiceItems.length,
    `${oItems.length} of ${twiceItems.length}`)
  check('order shipping address filled', !!(od?.shipping_address || '').trim(),
    'the order has no shipping address')
  check('order date is not before the quote date',
    !od?.order_date || !qd2?.entry_date || new Date(od.order_date) >= new Date(qd2.entry_date),
    `order ${od?.order_date} vs quote ${qd2?.entry_date}`)
  check('order due date is not before the order date',
    !od?.due_date || !od?.order_date || new Date(od.due_date) >= new Date(od.order_date),
    `due ${od?.due_date} vs order ${od?.order_date}`)

  // ── 8. Sales order → purchase order ───────────────────────────────────────
  console.log('\nSales order → purchase order')
  const cp = await call('POST', `/orders/${orderId}/convert-to-po`)
  if (!check('converted to purchase order', cp.status < 400, `HTTP ${cp.status}: ${cp.payload?.message || ''}`)) return
  const poId = unwrap(cp.payload)?.id ?? unwrap(cp.payload)?.po?.id ?? unwrap(cp.payload)?.purchase_order?.id
  created.pos.push(poId)

  const po = unwrap((await call('GET', `/purchase-orders/${poId}`)).payload)
  const pd = po?.purchase_order ?? po?.po ?? po
  const pItems = pd?.items || pd?.line_items || []
  check('PO points back at the order', pd?.order_id === orderId, `got ${pd?.order_id}`)
  same('PO customer', od?.customer_id, pd?.customer_id)
  check('PO has every line', pItems.length === twiceItems.length, `${pItems.length} of ${twiceItems.length}`)
  // The supplier is chosen on the quote; it must survive all the way down.
  check('PO has the supplier chosen on the quote',
    !SUPPLIER || pd?.supplier_id === SUPPLIER.id || pd?.vendor_name === SUPPLIER.name,
    `quote had ${SUPPLIER?.name || 'none'}, PO has ${pd?.vendor_name || pd?.supplier_id || 'none'}`)
  const poQty = pItems.reduce((s, i) => s + Number(i.qty_ordered ?? i.qty ?? 0), 0)
  const srcQty = twiceItems.reduce((s, i) => s + i.qty, 0)
  check('PO quantities match the order', poQty === srcQty, `${poQty} vs ${srcQty}`)
}

async function cleanup() {
  if (KEEP) { console.log('\n--keep — records left in place.'); return }
  console.log('\nRemoving everything this run created')
  const order = [['pos', '/purchase-orders'], ['orders', '/orders'], ['invoices', '/invoices'],
    ['quotations', '/quotations'], ['customers', '/customers'], ['leads', '/leads']]
  for (const [key, path] of order) {
    for (const id of [...new Set(created[key])].filter(Boolean)) {
      const r = await call('DELETE', `${path}/${id}`)
      if (r.status >= 400) console.log(`  · ${path}/${id} → HTTP ${r.status} (left behind)`)
    }
  }
  // Nothing may survive under the test name.
  const { rows } = await pool.query(
    `SELECT (SELECT count(*) FROM customers WHERE name LIKE 'E2E Test%' AND deleted_at IS NULL)::int AS c,
            (SELECT count(*) FROM leads     WHERE customer_name LIKE 'E2E Test%' AND deleted_at IS NULL)::int AS l`)
  console.log(`  left behind: ${rows[0].c} customer(s), ${rows[0].l} lead(s)`)
}

async function main() {
  const { rows: [user] } = await pool.query(
    `SELECT id, email, role::text AS role FROM users WHERE is_active AND role = 'Admin' ORDER BY created_at LIMIT 1`)
  if (!user) throw new Error('no admin user to sign a token for')
  TOKEN = jwt.sign({ id: user.id, email: user.email, role: user.role }, process.env.JWT_SECRET, { expiresIn: '20m' })

  const { rows: [sup] } = await pool.query(
    `SELECT id, name FROM suppliers WHERE deleted_at IS NULL ORDER BY created_at LIMIT 1`)
  SUPPLIER = sup || null

  const { rows: [db] } = await pool.query('SELECT current_database() AS name')
  console.log(`API ${BASE}   database ${db.name}`)

  const started = Date.now()
  for (const t of ['apparel', 'dtf', 'gangsheet']) {
    try { await runChain(t) } catch (e) { check(`${t} chain ran to the end`, false, e.message) }
  }
  await cleanup()

  // ── How long each kind of call took ───────────────────────────────────────
  const byLabel = new Map()
  for (const t of timings) {
    const e = byLabel.get(t.label) || { n: 0, total: 0, max: 0 }
    e.n++; e.total += t.ms; e.max = Math.max(e.max, t.ms)
    byLabel.set(t.label, e)
  }
  const slow = [...byLabel.entries()].map(([label, e]) => ({ label, avg: e.total / e.n, max: e.max, n: e.n }))
    .sort((a, b) => b.avg - a.avg).slice(0, 12)
  console.log(`\n${'─'.repeat(74)}\nSlowest calls (average of ${timings.length} requests)`)
  for (const s of slow) {
    console.log(`  ${String(Math.round(s.avg)).padStart(5)} ms  max ${String(Math.round(s.max)).padStart(5)} ms  ×${String(s.n).padStart(2)}  ${s.label}`)
  }
  console.log(`\n  whole run: ${((Date.now() - started) / 1000).toFixed(1)} s`)

  console.log(`\n${'─'.repeat(74)}`)
  if (checks.fail.length === 0) {
    console.log(`ALL ${checks.pass} CHECKS PASSED`)
  } else {
    console.log(`${checks.pass} passed, ${checks.fail.length} FAILED:\n`)
    checks.fail.forEach(f => console.log(`  ✗ ${f.name}\n      ${f.detail}`))
  }
  await pool.end()
  process.exitCode = checks.fail.length ? 1 : 0
}

main().catch(async e => { console.error(e); try { await pool.end() } catch {} ; process.exit(1) })
