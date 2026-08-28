const { query, pool } = require('../../config/db')

/**
 * Refunds — money going back.
 *
 * A refund is its own transaction. It never edits the payment it reverses:
 * the original stays exactly as the bank recorded it, and the refund sits
 * beside it pointing back at both the payment and the claim that justified it.
 * That way the ledger keeps both halves and neither can be lost by editing.
 */

const REFUND_SELECT = `
  SELECT r.*,
         COALESCE(NULLIF(c.company_name,''), c.name) AS customer_name, c.customer_number,
         o.order_number, i.invoice_number, i.total AS invoice_total,
         p.payment_number, p.amount AS payment_amount, p.payment_method AS original_method,
         cl.claim_number, cl.claimed_amount, cl.approved_amount AS claim_approved_amount,
         u.name AS processed_by_name
    FROM refunds r
    LEFT JOIN customers c  ON c.id = r.customer_id
    LEFT JOIN orders    o  ON o.id = r.order_id
    LEFT JOIN invoices  i  ON i.id = r.invoice_id
    LEFT JOIN payments  p  ON p.id = r.payment_id
    LEFT JOIN claims    cl ON cl.id = r.claim_id
    LEFT JOIN users     u  ON u.id = r.processed_by`

async function nextRefundNumber(client = null) {
  const run = client ? client.query.bind(client) : query
  const { rows } = await run(
    `SELECT 'REF-2026-' || lpad(
       (COALESCE(MAX(NULLIF(split_part(refund_number,'-',3),'')::INT), 0) + 1)::text, 4, '0') AS n
       FROM refunds WHERE refund_number LIKE 'REF-2026-%'`)
  return rows[0].n
}

async function list({ page = 1, limit = 20, claim_id = '', status = '' } = {}) {
  const where = ['r.deleted_at IS NULL']
  const params = []
  if (claim_id) { params.push(claim_id); where.push(`r.claim_id = $${params.length}`) }
  if (status)   { params.push(status);   where.push(`r.status = $${params.length}`) }
  const total = (await query(
    `SELECT COUNT(*)::INT AS n FROM refunds r WHERE ${where.join(' AND ')}`, params)).rows[0].n
  params.push(limit, (page - 1) * limit)
  const { rows } = await query(
    `${REFUND_SELECT} WHERE ${where.join(' AND ')}
      ORDER BY r.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params)
  return { rows, total }
}

async function getById(id) {
  return (await query(`${REFUND_SELECT} WHERE r.id = $1 AND r.deleted_at IS NULL`, [id])).rows[0] ?? null
}

/**
 * Raise a refund against an approved claim. The claim supplies the customer,
 * order and invoice, and the payment that settled that order is found rather
 * than asked for — a refund with no payment behind it has nothing to reverse.
 */
async function createFromClaim(claimId, data, actorId) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const claim = (await client.query(
      `SELECT id, customer_id, order_id, invoice_id, status, approved_amount, claim_number
         FROM claims WHERE id = $1 AND deleted_at IS NULL`, [claimId])).rows[0]
    if (!claim) { const e = new Error('Claim not found'); e.status = 404; throw e }
    if (claim.status !== 'Approved') {
      const e = new Error(`${claim.claim_number} is ${claim.status}. Only an approved claim can be refunded.`)
      e.status = 409; throw e
    }

    const amount = Number(data.amount ?? claim.approved_amount ?? 0)
    if (!(amount > 0)) { const e = new Error('A refund needs an amount above zero'); e.status = 422; throw e }
    if (claim.approved_amount != null && amount > Number(claim.approved_amount) + 0.005) {
      const e = new Error(`Approved amount is $${Number(claim.approved_amount).toFixed(2)}; a refund cannot exceed it.`)
      e.status = 422; throw e
    }

    // The payment that settled this order. Not edited — only pointed at.
    let paymentId = data.payment_id ?? null
    if (!paymentId && claim.order_id) {
      paymentId = (await client.query(
        `SELECT id FROM payments WHERE order_id = $1 LIMIT 1`, [claim.order_id])).rows[0]?.id ?? null
    }

    const number = await nextRefundNumber(client)
    const { rows } = await client.query(
      `INSERT INTO refunds (refund_number, claim_id, customer_id, order_id, invoice_id, payment_id,
                            amount, refund_method, status, reference_no, notes, processed_by, processed_at)
       -- $9 is both the stored status and a value compared against a literal;
       -- cast it once so Postgres is not left inferring two types for one
       -- parameter.
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::text,$10,$11,$12,
               CASE WHEN $9::text = 'Completed' THEN NOW() ELSE NULL END)
       RETURNING id`,
      [number, claim.id, claim.customer_id, claim.order_id, claim.invoice_id, paymentId,
       amount, data.refund_method ?? null, data.status ?? 'Pending',
       data.reference_no ?? null, data.notes ?? null, actorId])

    // A refund raised against a claim moves the claim on, and the move is
    // written to the history like every other.
    if ((data.status ?? 'Pending') === 'Completed') {
      await client.query(`UPDATE claims SET status = 'Refunded', updated_at = NOW() WHERE id = $1`, [claim.id])
      await client.query(
        `INSERT INTO claim_status_history (claim_id, status, changed_by, notes)
         VALUES ($1,'Refunded',$2,$3)`, [claim.id, actorId, `${number} — $${amount.toFixed(2)}`])
    }

    await client.query('COMMIT')
    return getById(rows[0].id)
  } catch (e) { await client.query('ROLLBACK'); throw e } finally { client.release() }
}

async function update(id, data, actorId) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const current = (await client.query(
      `SELECT id, claim_id, status, refund_number, amount FROM refunds WHERE id = $1 AND deleted_at IS NULL`,
      [id])).rows[0]
    if (!current) { const e = new Error('Refund not found'); e.status = 404; throw e }

    const allowed = ['amount', 'refund_method', 'status', 'reference_no', 'notes']
    const sets = []; const params = []
    for (const f of allowed) {
      if (data[f] === undefined) continue
      params.push(data[f]); sets.push(`${f} = $${params.length}`)
    }
    if (data.status === 'Completed' && current.status !== 'Completed') {
      params.push(actorId); sets.push(`processed_by = $${params.length}`)
      sets.push('processed_at = NOW()')
    }
    if (sets.length) {
      params.push(id)
      await client.query(`UPDATE refunds SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${params.length}`, params)
    }
    if (data.status === 'Completed' && current.status !== 'Completed' && current.claim_id) {
      await client.query(`UPDATE claims SET status = 'Refunded', updated_at = NOW() WHERE id = $1`, [current.claim_id])
      await client.query(
        `INSERT INTO claim_status_history (claim_id, status, changed_by, notes)
         VALUES ($1,'Refunded',$2,$3)`,
        [current.claim_id, actorId, `${current.refund_number} — $${Number(data.amount ?? current.amount).toFixed(2)}`])
    }
    await client.query('COMMIT')
    return getById(id)
  } catch (e) { await client.query('ROLLBACK'); throw e } finally { client.release() }
}

async function remove(id) {
  await query(`UPDATE refunds SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1`, [id])
  return true
}

module.exports = { list, getById, createFromClaim, update, remove, nextRefundNumber }
