#!/usr/bin/env node
/**
 * For every payment that has no order on it, create a matching order so the
 * money is tied to a record. Amount, customer and date come from the payment
 * itself; the order is stamped Delivered / Paid because the customer already
 * paid.
 *
 * The new order number mirrors the payment number 1:1 so the pair is easy
 * to spot in the app:
 *   PAY-2026-0003 -> ORD-PAY-2026-0003
 *
 * Idempotent — a payment already carrying an order_id is left alone; an
 * order_number already in the table is not re-inserted.
 *
 * Usage:
 *   node backend/scripts/create-orders-for-orphan-payments.js            (dry-run)
 *   node backend/scripts/create-orders-for-orphan-payments.js --apply
 */
const { Pool } = require('pg')

const APPLY = process.argv.includes('--apply')
const DATABASE_URL = process.env.DATABASE_URL
  || 'postgresql://postgres:decoinks_pass@localhost:5435/decoinks_db'

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL })
  const client = await pool.connect()
  try {
    // Every unlinked payment. `customer_id` may already be set (the seeder
    // matched what it could by name); otherwise last-name lookup on the fly.
    const { rows: payments } = await client.query(`
      SELECT p.id, p.payment_number, p.payment_date, p.amount, p.fee_amount,
             p.customer_id, p.customer_name, p.received_from_name,
             p.transaction_id, p.payment_method
        FROM payments p
       WHERE p.order_id IS NULL
       ORDER BY p.payment_date, p.payment_number`)

    console.log(`Unlinked payments: ${payments.length}`)

    const plan = []
    for (const p of payments) {
      const orderNumber = `ORD-${p.payment_number}`   // e.g. ORD-PAY-2026-0003
      const exists = (await client.query(
        'SELECT id FROM orders WHERE order_number = $1', [orderNumber])).rows[0]
      if (exists) { console.log(`  skip ${orderNumber} — already exists`); continue }

      // If the seeder could not find a customer, one more chance — exact name
      // match against customers.name. Leaving customer_id null is also fine;
      // the order still records what happened.
      let customerId = p.customer_id
      if (!customerId && p.customer_name) {
        const c = (await client.query(
          'SELECT id FROM customers WHERE LOWER(name) = LOWER($1) AND deleted_at IS NULL LIMIT 1',
          [p.customer_name])).rows[0]
        if (c) customerId = c.id
      }

      plan.push({ payment: p, orderNumber, customerId })
    }

    console.log(`\nPlanned inserts: ${plan.length}`)
    for (const x of plan.slice(0, 10)) {
      console.log(`  ${x.orderNumber.padEnd(22)}  ${x.payment.payment_date.toISOString().slice(0,10)}  ${x.payment.customer_name.padEnd(22)}  $${Number(x.payment.amount).toFixed(2).padStart(8)}${x.customerId ? '' : '  (no customer)'}`)
    }
    if (plan.length > 10) console.log(`  … +${plan.length - 10} more`)

    if (!APPLY) { console.log('\nDRY RUN — re-run with --apply to insert.'); return }

    await client.query('BEGIN')
    for (const { payment, orderNumber, customerId } of plan) {
      // The order carries the same money the payment brought in. Status +
      // payment_status set to closed states because the customer paid.
      const { rows: [order] } = await client.query(`
        INSERT INTO orders (order_number, order_type, order_date, entry_date, customer_id,
                            shipping_name, total, subtotal,
                            status, payment_status, payment_method,
                            payment_date, amount_paid, payment_reference,
                            notes, created_at, updated_at)
        VALUES ($1, 'dtf', $2::date, $2::date, $3, $4, $5, $5,
                'Delivered', 'Paid', $6,
                $2::date, $5, $7,
                $8, NOW(), NOW())
        RETURNING id`,
        [orderNumber, payment.payment_date, customerId,
         payment.customer_name, Number(payment.amount), payment.payment_method,
         payment.transaction_id || null,
         `Auto-created from ${payment.payment_number} during payment/order reconciliation. Original sheet flagged "No PO match found".`])

      await client.query(
        `UPDATE payments SET order_id = $1, customer_id = COALESCE(customer_id, $2), updated_at = NOW()
          WHERE id = $3`,
        [order.id, customerId, payment.id])
    }
    await client.query('COMMIT')
    console.log(`\nCreated ${plan.length} orders and linked their payments.`)
  } catch (err) {
    if (APPLY) { try { await client.query('ROLLBACK') } catch { /* no tx */ } }
    throw err
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch(err => { console.error(err); process.exit(1) })
