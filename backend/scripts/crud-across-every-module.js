/**
 * Create, read, update, delete — every module, over real HTTP.
 *
 * The point is not that the routes exist but that a change STICKS: each update
 * is read back and compared, because the bug that started this was an update
 * that reported success and changed nothing.
 *
 * Everything it creates, it deletes. Nothing pre-existing is touched.
 *
 * It talks to the API on localhost, past nginx and Authentik, with a token
 * minted from the same secret the app uses — so it tests the app's own routes,
 * validation and permissions, not the sign-in page.
 */
const jwt = require('jsonwebtoken')
const { query, pool } = require('../src/config/db')

const BASE = 'http://127.0.0.1:8000/api'
let TOKEN = ''

const call = async (method, path, body) => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  let data = null
  try { data = await res.json() } catch { /* empty body is fine on delete */ }
  return { status: res.status, data }
}

const results = []
const record = (mod, step, ok, detail) => { results.push({ mod, step, ok, detail }); return ok }

async function crud(mod, { path, make, change, verify, cleanup }) {
  let id = null
  try {
    const c = await call('POST', path, make())
    const created = c.data?.data ?? c.data
    id = created?.id
    // Zod reports which field it rejected; without that a 422 says nothing.
    const why = c.data?.details?.length
      ? c.data.details.map(d => `${d.field || d.path}: ${d.message}`).join('; ')
      : (c.data?.message || '')
    if (!record(mod, 'CREATE', c.status < 300 && !!id, `${c.status} ${why}`)) return

    const r = await call('GET', `${path}/${id}`)
    record(mod, 'READ', r.status === 200, String(r.status))

    const patch = change()
    const u = await call('PUT', `${path}/${id}`, patch)
    const uOk = u.status < 300
    record(mod, 'UPDATE', uOk, `${u.status}${u.data?.message && !uOk ? ' ' + u.data.message : ''}`)

    // The real test: read it back and see whether the change survived.
    if (uOk) {
      const after = await call('GET', `${path}/${id}`)
      const row = after.data?.data ?? after.data
      const [field, want] = verify(patch)
      const got = row?.[field]
      const stuck = got != null && String(got).trim() === String(want).trim()
      record(mod, 'UPDATE STICKS', stuck, stuck ? `${field}=${got}` : `${field}: bheja "${want}", mila "${got}"`)
    }

    const d = await call('DELETE', `${path}/${id}`)
    const dOk = d.status < 300
    record(mod, 'DELETE', dOk, String(d.status))
    if (dOk) id = null
  } catch (e) {
    record(mod, 'ERROR', false, e.message)
  } finally {
    if (id && cleanup) await cleanup(id)
  }
}

async function main() {
  const admin = (await query(
    `SELECT id, email, role FROM users WHERE role = 'Admin' LIMIT 1`)).rows[0]
  if (!admin) throw new Error('koi Admin user nahi mila')
  TOKEN = jwt.sign({ id: admin.id, email: admin.email, role: admin.role }, process.env.JWT_SECRET, { expiresIn: '15m' })

  const cust = (await query(
    `SELECT id FROM customers WHERE deleted_at IS NULL ORDER BY created_at LIMIT 1`)).rows[0]
  const supp = (await query(`SELECT id FROM suppliers WHERE deleted_at IS NULL LIMIT 1`)).rows[0]
  const stamp = String(admin.id).slice(0, 8)
  const tag = n => `CRUDTEST-${stamp}-${n}`

  const drop = table => async id => { await query(`DELETE FROM ${table} WHERE id = $1`, [id]) }

  await crud('customers', {
    path: '/customers',
    make: () => ({ name: tag('cust'), customer_type: 'individual', status: 'active' }),
    change: () => ({ name: tag('cust-updated') }),
    verify: p => ['name', p.name],
    cleanup: drop('customers'),
  })

  await crud('leads', {
    path: '/leads',
    make: () => ({ customer_name: tag('lead'), status: 'new', source: 'Walk-in' }),
    change: () => ({ customer_name: tag('lead-updated') }),
    verify: p => ['customer_name', p.customer_name],
    cleanup: drop('leads'),
  })

  {
    const list = await call('GET', '/products?page=1&limit=1')
    record('products', 'READ', list.status === 200, `${list.status} — BlankTex se aate hain, yahan banaye nahi ja sakte`)
  }

  await crud('suppliers', {
    path: '/suppliers',
    make: () => ({ name: tag('supp') }),
    change: () => ({ name: tag('supp-updated') }),
    verify: p => ['name', p.name],
    cleanup: drop('suppliers'),
  })

  if (cust) {
    await crud('quotations', {
      path: '/quotations',
      make: () => ({ customer_id: cust.id, quote_type: 'dtf', notes: tag('quote'),
                     items: [{ description: tag('line'), qty: 1, unit_price: 10 }] }),
      change: () => ({ notes: tag('quote-updated') }),
      verify: p => ['notes', p.notes],
      cleanup: drop('quotations'),
    })

    await crud('orders', {
      path: '/orders',
      make: () => ({ customer_id: cust.id, order_type: 'dtf', notes: tag('order'),
                     subtotal: 10, total: 10,
                     items: [{ artwork_name: tag('art'), description: tag('line'),
                               qty: 1, unit_price: 10, amount: 10 }] }),
      change: () => ({ notes: tag('order-updated') }),
      verify: p => ['notes', p.notes],
      cleanup: drop('orders'),
    })

    await crud('invoices', {
      path: '/invoices',
      make: () => ({ customer_id: cust.id, notes: tag('inv'), subtotal: 10, total: 10,
                     items: [{ description: tag('line'), qty: 1, unit_price: 10, amount: 10 }] }),
      change: () => ({ notes: tag('inv-updated') }),
      verify: p => ['notes', p.notes],
      cleanup: drop('invoices'),
    })

    await crud('payments', {
      path: '/payments',
      make: () => ({ customer_id: cust.id, amount: 1, payment_method: 'other', payment_date: '2026-08-25' }),
      change: () => ({ amount: 2 }),
      verify: p => ['amount', p.amount],
      cleanup: drop('payments'),
    })
  }

  if (supp) {
    await crud('purchase-orders', {
      path: '/purchase-orders',
      make: () => ({ supplier_id: supp.id, notes: tag('po') }),
      change: () => ({ notes: tag('po-updated') }),
      verify: p => ['notes', p.notes],
      cleanup: drop('purchase_orders'),
    })
  }

  await crud('shipments', {
    path: '/shipments',
    make: () => ({ carrier: 'UPS', tracking_number: tag('trk') }),
    change: () => ({ carrier: 'FedEx' }),
    verify: p => ['carrier', p.carrier],
    cleanup: drop('shipments'),
  })

  // ── report ──
  const mods = [...new Set(results.map(r => r.mod))]
  console.log('\nmodule           CREATE  READ  UPDATE  STICKS  DELETE')
  console.log('-'.repeat(58))
  for (const m of mods) {
    const at = s => { const r = results.find(x => x.mod === m && x.step === s); return r ? (r.ok ? '  ok  ' : ' FAIL ') : '  —   ' }
    console.log(`${m.padEnd(16)} ${at('CREATE')} ${at('READ').trim().padStart(4)}  ${at('UPDATE')}  ${at('UPDATE STICKS')}  ${at('DELETE')}`)
  }
  const bad = results.filter(r => !r.ok)
  if (bad.length) {
    console.log('\nJO NAKAAM HUE:')
    for (const b of bad) console.log(`  ${b.mod.padEnd(16)} ${b.step.padEnd(14)} ${b.detail}`)
  }
  console.log(`\n${results.length} checks — ${results.length - bad.length} theek, ${bad.length} nakaam\n`)
  await pool.end()
}

main().catch(e => { console.error(e); process.exit(1) })
