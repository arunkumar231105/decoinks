#!/usr/bin/env node
/**
 * Does the preview show the document?
 *
 * The four print pages — quotation, invoice, sales order, purchase order — do
 * not simply display the record. They fetch it, then work out the figures they
 * print: which subtotal to trust, whether to re-add the lines, what the balance
 * is once an invoice is paid. That arithmetic is where a preview drifts from
 * the document it is supposed to show, and it is invisible from the API tests
 * because the API is not the thing that is wrong.
 *
 * This mirrors each page's arithmetic exactly, from the same endpoints the page
 * calls, and checks the answer against the document. Two passes:
 *
 *   SWEEP    every live quotation, invoice, order and purchase order in the
 *            database. Real records, real edits, real history.
 *   CHAIN    a document created here, previewed, edited, previewed again —
 *            because "the preview updates when I change something" is a
 *            different question from "the preview is right", and paid invoices
 *            must show nothing due.
 *
 * The formulas below are copied from the pages. Where a page falls back
 * (subtotal ?? re-added lines) the fallback is copied too, so a difference here
 * is a difference the shop would see on paper.
 *
 * Usage (inside the backend container):
 *   SMOKE_BASE=http://localhost:8001/api node scripts/preview-parity-test.js
 *   ... --limit=25    sweep only the first 25 of each kind
 *   ... --no-chain    sweep only; creates nothing, spends no document numbers
 */
const jwt = require('jsonwebtoken')
const { Pool } = require('pg')

const BASE = process.env.SMOKE_BASE || 'http://localhost:8001/api'
const LIMIT = Number((process.argv.find(a => a.startsWith('--limit=')) || '').split('=')[1]) || 0
const pool = new Pool({ connectionString: process.env.DATABASE_URL })

let TOKEN
const fails = []
let passed = 0

const num = v => Number(v ?? 0) || 0
const cents = v => Math.round(num(v) * 100)
const money = v => `$${num(v).toFixed(2)}`

async function get(path) {
  const res = await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${TOKEN}` } })
  if (!res.ok) return null
  const body = await res.json().catch(() => null)
  return body?.data ?? body
}

function check(label, ok, detail) {
  if (ok) passed++
  else fails.push({ label, detail })
  return ok
}

// ── QuotePrintPage ──────────────────────────────────────────────────────────
// Items Total = subtotal; then discount, rush, shipping; Total = quote.total.
function previewQuote(q) {
  const items = Array.isArray(q.items) ? q.items : []
  return {
    itemsTotal: num(q.subtotal),
    discount:   num(q.discount_amt),
    rush:       num(q.rush_services),
    shipping:   num(q.estimated_shipping),
    total:      num(q.total),
    totalQty:   items.reduce((s, i) => s + num(i.qty), 0),
    lineCount:  items.length,
  }
}

// ── InvoicePrintPage ────────────────────────────────────────────────────────
// itemsOnly prefers the stored subtotal and falls back to re-adding the lines.
// TOTAL DUE is zero once the invoice is Paid.
function previewInvoice(inv) {
  const items = Array.isArray(inv.items) ? inv.items : []
  const calculatedItemsTotal = items.reduce(
    (sum, item) => sum + (num(item.amount) || num(item.qty) * num(item.unit_price) || 0), 0)
  const itemsOnly = Math.max(0, num(inv.subtotal)) || calculatedItemsTotal
  const isPaid = inv.status === 'Paid'
  const balanceDue = isPaid
    ? 0
    : Math.max(0, inv.balance_due == null
      ? num(inv.total) - num(inv.amount_paid)
      : num(inv.balance_due))
  return {
    itemsOnly, isPaid, balanceDue,
    shipping: num(inv.shipping_charges),
    rushServices: num(inv.rush_services),
    rushCharges: num(inv.rush_charges),
    tax: num(inv.tax_amt),
    total: num(inv.total),
    totalQty: items.reduce((s, i) => s + num(i.qty), 0),
    lineCount: items.length,
  }
}

// ── OrderPrintPage ──────────────────────────────────────────────────────────
function previewOrder(order, invoice) {
  const items = [].concat(order.items || [], order.line_items || [])
  const itemsTotal = items.reduce((s, i) => s + num(i.amount), 0)
  const subtotalAmt = num(order.subtotal) || itemsTotal
  const isPaid = order.payment_status === 'Paid' || invoice?.status === 'Paid'
  const amountPaid = isPaid ? num(order.total) : (invoice ? num(invoice.amount_paid) : 0)
  const balanceDue = isPaid
    ? 0
    : Math.max(0, invoice ? num(invoice.balance_due) : num(order.total) - amountPaid)
  return {
    subtotalAmt, isPaid, amountPaid, balanceDue,
    shipping: num(order.shipping_charges),
    total: num(order.total),
    totalQty: items.reduce((s, i) => s + num(i.qty), 0),
    lineCount: items.length,
  }
}

// ── PurchaseOrderPrintPage ──────────────────────────────────────────────────
function previewPo(po) {
  const items = Array.isArray(po.items) ? po.items : []
  return {
    totalQty: items.reduce((s, it) => s + num(it.qty_ordered), 0),
    lineCount: items.length,
    total: num(po.grand_total ?? po.total),
  }
}

// ════════════════════════════════════════════════════════════════════════════
async function sweep() {
  console.log('SWEEP — every live document, previewed and compared\n')

  const cap = LIMIT ? ` LIMIT ${LIMIT}` : ''
  const { rows: quotes } = await pool.query(
    `SELECT id, quote_number FROM quotations WHERE deleted_at IS NULL ORDER BY quote_number${cap}`)
  let bad = 0
  for (const row of quotes) {
    const q = await get(`/quotations/${row.id}`)
    if (!q) { check(`quote ${row.quote_number} loads`, false, 'the preview could not fetch it'); bad++; continue }
    const doc = q.quotation ?? q
    const p = previewQuote(doc)
    // What the summary column adds up to must be the total it prints.
    const adds = p.itemsTotal - p.discount + p.rush + p.shipping
    if (!check(`quote ${row.quote_number} summary adds up`,
      Math.abs(cents(adds) - cents(p.total)) <= 1,
      `items ${money(p.itemsTotal)} − disc ${money(p.discount)} + rush ${money(p.rush)} + ship ${money(p.shipping)} ` +
      `= ${money(adds)}, printed total ${money(p.total)}`)) bad++
  }
  console.log(`  quotations       ${quotes.length - bad}/${quotes.length} summaries add up`)

  const { rows: invoices } = await pool.query(
    `SELECT id, invoice_number FROM invoices WHERE deleted_at IS NULL ORDER BY invoice_number${cap}`)
  let ibad = 0, paidChecked = 0
  for (const row of invoices) {
    const raw = await get(`/invoices/${row.id}`)
    if (!raw) { check(`invoice ${row.invoice_number} loads`, false, 'the preview could not fetch it'); ibad++; continue }
    const inv = raw.invoice ?? raw
    const p = previewInvoice(inv)
    const adds = p.itemsOnly - num(inv.discount_amt) + p.tax + p.shipping + p.rushCharges
    let ok = check(`invoice ${row.invoice_number} summary adds up`,
      Math.abs(cents(adds) - cents(p.total)) <= 1,
      `items ${money(p.itemsOnly)} − disc ${money(inv.discount_amt)} + tax ${money(p.tax)} ` +
      `+ ship ${money(p.shipping)} + rush ${money(p.rushCharges)} = ${money(adds)}, printed total ${money(p.total)}`)
    if (p.isPaid) {
      paidChecked++
      ok = check(`invoice ${row.invoice_number} is Paid so nothing is due`,
        p.balanceDue === 0, `preview would print TOTAL DUE ${money(p.balanceDue)}`) && ok
      ok = check(`invoice ${row.invoice_number} Paid but its ledger disagrees`,
        cents(inv.balance_due) === 0,
        `stored balance_due is ${money(inv.balance_due)} while the status says Paid`) && ok
    }
    if (!ok) ibad++
  }
  console.log(`  invoices         ${invoices.length - ibad}/${invoices.length} correct   (${paidChecked} of them Paid)`)

  const { rows: orders } = await pool.query(
    `SELECT id, order_number FROM orders WHERE deleted_at IS NULL ORDER BY order_number${cap}`)
  let obad = 0
  for (const row of orders) {
    const raw = await get(`/orders/${row.id}`)
    if (!raw) { check(`order ${row.order_number} loads`, false, 'the preview could not fetch it'); obad++; continue }
    const order = raw.order ?? raw
    const invoice = order.invoice_id ? await get(`/invoices/${order.invoice_id}`) : null
    const p = previewOrder(order, invoice?.invoice ?? invoice)
    const adds = p.subtotalAmt + p.shipping + num(order.rush_services) - num(order.discount_amt) + num(order.tax_amt)
    let ok = check(`order ${row.order_number} summary adds up`,
      Math.abs(cents(adds) - cents(p.total)) <= 1,
      `subtotal ${money(p.subtotalAmt)} + ship ${money(p.shipping)} + rush ${money(order.rush_services)} ` +
      `= ${money(adds)}, printed total ${money(p.total)}`)
    if (p.isPaid) {
      ok = check(`order ${row.order_number} is paid so nothing is due`,
        p.balanceDue === 0, `preview would print TOTAL DUE ${money(p.balanceDue)}`) && ok
    }
    if (!ok) obad++
  }
  console.log(`  sales orders     ${orders.length - obad}/${orders.length} correct`)

  const { rows: pos } = await pool.query(
    `SELECT id, po_number FROM purchase_orders WHERE deleted_at IS NULL ORDER BY po_number${cap}`)
  let pbad = 0
  for (const row of pos) {
    const raw = await get(`/purchase-orders/${row.id}`)
    if (!raw) { check(`PO ${row.po_number} loads`, false, 'the preview could not fetch it'); pbad++; continue }
    const po = raw.po ?? raw.purchase_order ?? raw
    const p = previewPo(po)
    const { rows: [stored] } = await pool.query(
      `SELECT COALESCE(SUM(qty_ordered),0)::int AS qty, count(*)::int AS lines
         FROM purchase_order_items WHERE po_id = $1`, [row.id])
    if (!check(`PO ${row.po_number} previews every line`,
      p.lineCount === stored.lines && p.totalQty === stored.qty,
      `preview shows ${p.lineCount} lines / ${p.totalQty} pcs, the PO holds ${stored.lines} / ${stored.qty}`)) pbad++
  }
  console.log(`  purchase orders  ${pos.length - pbad}/${pos.length} correct`)
}

// ════════════════════════════════════════════════════════════════════════════
async function chain() {
  console.log('\nCHAIN — preview, edit, preview again\n')
  const stamp = Date.now().toString().slice(-6)
  const H = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }
  const post = async (p, b) => (await fetch(`${BASE}${p}`, { method: 'POST', headers: H, body: JSON.stringify(b || {}) })).json()
  const put = async (p, b) => (await fetch(`${BASE}${p}`, { method: 'PUT', headers: H, body: JSON.stringify(b) })).json()
  const patch = async (p, b) => (await fetch(`${BASE}${p}`, { method: 'PATCH', headers: H, body: JSON.stringify(b) })).json()
  const del = p => fetch(`${BASE}${p}`, { method: 'DELETE', headers: H })

  const { rows: [cust] } = await pool.query(
    `SELECT id FROM customers WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 1`)
  const { rows: [sup] } = await pool.query(
    `SELECT id FROM suppliers WHERE deleted_at IS NULL ORDER BY created_at LIMIT 1`)

  const made = { q: null, i: null, o: null, p: null }
  try {
    // 54 transfers at 2.037 is 109.998 — the case that used to print 109.96.
    const q1 = await post('/quotations', {
      customer_id: cust.id, supplier_id: sup?.id, order_type: 'dtf',
      customer_name: `Preview Test ${stamp}`, billing_email: `pv${stamp}@example.test`,
      shipping_address: '1 Preview Road, Springfield, IL 62704',
      items: [{ description: 'AW#01', qty: 54, unit_price: 2.037 }],
      estimated_shipping: 15, rush_services: 0,
    })
    made.q = (q1.data ?? q1).id

    let doc = (await get(`/quotations/${made.q}`))
    let p = previewQuote(doc.quotation ?? doc)
    check('quote preview items total is the quoted figure, not the re-added lines',
      cents(p.itemsTotal) === cents(110), `preview shows ${money(p.itemsTotal)}, quoted $110.00`)
    check('quote preview summary adds up',
      cents(p.itemsTotal - p.discount + p.rush + p.shipping) === cents(p.total),
      `${money(p.itemsTotal)} + ${money(p.shipping)} vs printed ${money(p.total)}`)
    check('quote preview total is 125.00', cents(p.total) === cents(125), `preview shows ${money(p.total)}`)

    // ── Edit it: the preview must follow ────────────────────────────────────
    await put(`/quotations/${made.q}`, {
      items: [{ description: 'AW#01', qty: 54, unit_price: 2.037 },
              { description: 'AW#02', qty: 10, unit_price: 3.00 }],
      estimated_shipping: 25,
    })
    doc = await get(`/quotations/${made.q}`)
    const p2 = previewQuote(doc.quotation ?? doc)
    check('quote preview shows the edited lines', p2.lineCount === 2, `preview shows ${p2.lineCount} line(s)`)
    check('quote preview items total moved with the edit',
      cents(p2.itemsTotal) === cents(140), `preview shows ${money(p2.itemsTotal)}, expected $140.00`)
    check('quote preview total moved with the edit',
      cents(p2.total) === cents(165), `preview shows ${money(p2.total)}, expected $165.00`)
    check('quote preview summary still adds up',
      cents(p2.itemsTotal - p2.discount + p2.rush + p2.shipping) === cents(p2.total),
      `${money(p2.itemsTotal)} + ${money(p2.shipping)} vs ${money(p2.total)}`)

    // ── Invoice ─────────────────────────────────────────────────────────────
    const inv = await post(`/quotations/${made.q}/convert-to-invoice`)
    made.i = (inv.data ?? inv).id ?? (inv.data ?? inv).invoice?.id
    let iraw = await get(`/invoices/${made.i}`)
    let ip = previewInvoice(iraw.invoice ?? iraw)
    check('invoice preview carries the quoted items total',
      cents(ip.itemsOnly) === cents(140), `preview shows ${money(ip.itemsOnly)}`)
    check('invoice preview total matches the invoice',
      cents(ip.total) === cents(165), `preview shows ${money(ip.total)}`)
    check('unpaid invoice previews the full amount due',
      cents(ip.balanceDue) === cents(165), `preview shows TOTAL DUE ${money(ip.balanceDue)}`)

    // ── Pay it: the preview must show nothing due ───────────────────────────
    await patch(`/invoices/${made.i}/payment`, { amount: 80, payment_method: 'bank_transfer' })
    iraw = await get(`/invoices/${made.i}`)
    ip = previewInvoice(iraw.invoice ?? iraw)
    check('part-paid invoice previews the remaining balance',
      cents(ip.balanceDue) === cents(85), `preview shows TOTAL DUE ${money(ip.balanceDue)}, expected $85.00`)

    await patch(`/invoices/${made.i}/payment`, { amount: 85, payment_method: 'bank_transfer' })
    iraw = await get(`/invoices/${made.i}`)
    const invoiceDoc = iraw.invoice ?? iraw
    ip = previewInvoice(invoiceDoc)
    check('paid invoice previews TOTAL DUE 0.00', cents(ip.balanceDue) === 0,
      `preview shows ${money(ip.balanceDue)}`)
    check('paid invoice still previews its full total', cents(ip.total) === cents(165),
      `preview shows ${money(ip.total)}`)

    // ── Order and purchase order ────────────────────────────────────────────
    const ord = await post(`/invoices/${made.i}/convert-to-order`, { order_type: 'dtf' })
    made.o = (ord.data ?? ord).id ?? (ord.data ?? ord).order?.id
    const oraw = await get(`/orders/${made.o}`)
    const orderDoc = oraw.order ?? oraw
    const op = previewOrder(orderDoc, invoiceDoc)
    check('order preview total matches the order', cents(op.total) === cents(165),
      `preview shows ${money(op.total)}`)
    check('order preview shows nothing due on a paid job', cents(op.balanceDue) === 0,
      `preview shows ${money(op.balanceDue)}`)
    check('order preview shows the amount paid', cents(op.amountPaid) === cents(165),
      `preview shows ${money(op.amountPaid)}`)
    check('order preview shows every line', op.lineCount === 2, `preview shows ${op.lineCount} line(s)`)

    const poRes = await post(`/orders/${made.o}/convert-to-po`)
    made.p = (poRes.data ?? poRes).id ?? (poRes.data ?? poRes).po?.id
    const praw = await get(`/purchase-orders/${made.p}`)
    const pp = previewPo(praw.po ?? praw.purchase_order ?? praw)
    check('PO preview shows every line', pp.lineCount === 2, `preview shows ${pp.lineCount} line(s)`)
    check('PO preview quantity matches the order', pp.totalQty === 64,
      `preview shows ${pp.totalQty} pcs, the order has 64`)
  } finally {
    for (const [k, path] of [['p', '/purchase-orders'], ['o', '/orders'], ['i', '/invoices'], ['q', '/quotations']]) {
      if (made[k]) await del(`${path}/${made[k]}`).catch(() => {})
    }
  }
}

async function main() {
  const { rows: [user] } = await pool.query(
    `SELECT id, email, role::text AS role FROM users WHERE is_active AND role = 'Admin' ORDER BY created_at LIMIT 1`)
  TOKEN = jwt.sign({ id: user.id, email: user.email, role: user.role }, process.env.JWT_SECRET, { expiresIn: '30m' })
  const { rows: [db] } = await pool.query('SELECT current_database() AS name')
  console.log(`API ${BASE}   database ${db.name}\n`)

  await sweep()
  // --no-chain leaves the database untouched: the chain section creates a
  // document at each stage, and on production that spends document numbers
  // the shop keeps in an unbroken sequence.
  if (!process.argv.includes('--no-chain')) await chain()
  else console.log('\nCHAIN — skipped (--no-chain): nothing was created.')

  console.log(`\n${'─'.repeat(74)}`)
  if (!fails.length) console.log(`ALL ${passed} PREVIEW CHECKS PASSED`)
  else {
    console.log(`${passed} passed, ${fails.length} FAILED:\n`)
    const shown = fails.slice(0, 20)
    shown.forEach(f => console.log(`  ✗ ${f.label}\n      ${f.detail}`))
    if (fails.length > shown.length) console.log(`  … and ${fails.length - shown.length} more of the same kind`)
  }
  await pool.end()
  process.exitCode = fails.length ? 1 : 0
}

main().catch(async e => { console.error(e); try { await pool.end() } catch {} ; process.exit(1) })
