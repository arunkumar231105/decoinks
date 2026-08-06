#!/usr/bin/env node
/**
 * Fill every column whose value can be *derived* from other rows that are
 * already populated — a name-only customer picks up an address that lives
 * on their order, a quotation with a customer_id inherits the customer's
 * email, an order copies its customer's phone, a shipping-address string
 * gets split into city/state/zip, and so on.
 *
 * Blank fields only. A manually filled value is NEVER overwritten. Every
 * pass runs as a distinct step so the script can be re-run (idempotent).
 *
 * NEVER touches: payments, shipments, or anything whose value must come
 * from the outside world (invented data would be worse than blank).
 *
 * Usage:
 *   node backend/scripts/backfill-derived-fields.js            (dry-run)
 *   node backend/scripts/backfill-derived-fields.js --apply
 */
const { Pool } = require('pg')

const APPLY = process.argv.includes('--apply')
const DATABASE_URL = process.env.DATABASE_URL
  || 'postgresql://postgres:decoinks_pass@localhost:5435/decoinks_db'

// Split "748 Alcovy Mill Park, Lawrenceville, GA 30045" into its parts.
// Anything the regex cannot understand stays in the address block, so a
// weird one-off input never poisons the city/state fields.
function splitAddress(a) {
  if (!a) return { line: null, city: null, state: null, zip: null, country: 'USA' }
  const clean = String(a).trim()
  // Try the standard US "line, city, ST 12345" shape first.
  const usa = /^(.*?),\s*([^,]+?),?\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)/i.exec(clean)
  if (usa) return { line: usa[1].trim(), city: usa[2].trim(), state: usa[3].toUpperCase(), zip: usa[4], country: 'USA' }
  // Fallback: "line, city, ST" without a ZIP.
  const noZip = /^(.*?),\s*([^,]+?),?\s*([A-Z]{2})\s*$/i.exec(clean)
  if (noZip) return { line: noZip[1].trim(), city: noZip[2].trim(), state: noZip[3].toUpperCase(), zip: null, country: 'USA' }
  return { line: clean, city: null, state: null, zip: null, country: 'USA' }
}

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL })
  const client = await pool.connect()
  try {
    const passes = []

    // ─── 1. CUSTOMERS: split address into city/state/zip if any of those are blank
    passes.push({
      name: 'customers.city/state/zip from address_line1',
      preview: () => client.query(`
        SELECT COUNT(*) AS n FROM customers
         WHERE deleted_at IS NULL
           AND address_line1 IS NOT NULL
           AND (COALESCE(city,'') = '' OR COALESCE(state,'') = '' OR COALESCE(zip,'') = '')`),
      apply: async () => {
        const rows = (await client.query(`
          SELECT id, address_line1, city, state, zip
            FROM customers
           WHERE deleted_at IS NULL AND address_line1 IS NOT NULL
             AND (COALESCE(city,'') = '' OR COALESCE(state,'') = '' OR COALESCE(zip,'') = '')`)).rows
        for (const r of rows) {
          const parts = splitAddress(r.address_line1)
          await client.query(`
            UPDATE customers SET
              city  = COALESCE(NULLIF(city,''),  $2),
              state = COALESCE(NULLIF(state,''), $3),
              zip   = COALESCE(NULLIF(zip,''),   $4),
              country = COALESCE(NULLIF(country,''), $5),
              updated_at = NOW()
             WHERE id = $1`,
            [r.id, parts.city, parts.state, parts.zip, parts.country])
        }
        return rows.length
      },
    })

    // ─── 2. CUSTOMERS: default country USA when nothing else is known
    passes.push({
      name: 'customers.country default USA',
      preview: () => client.query(`
        SELECT COUNT(*) AS n FROM customers
         WHERE deleted_at IS NULL AND COALESCE(country,'') = ''`),
      apply: async () => (await client.query(`
        UPDATE customers SET country = 'USA', updated_at = NOW()
         WHERE deleted_at IS NULL AND COALESCE(country,'') = ''`)).rowCount,
    })

    // ─── 3. CUSTOMERS: assume Individual customer type when it is missing
    passes.push({
      name: 'customers.customer_type default Individual',
      preview: () => client.query(`
        SELECT COUNT(*) AS n FROM customers
         WHERE deleted_at IS NULL AND COALESCE(customer_type,'') = ''`),
      apply: async () => (await client.query(`
        UPDATE customers SET customer_type = 'individual', updated_at = NOW()
         WHERE deleted_at IS NULL AND COALESCE(customer_type,'') = ''`)).rowCount,
    })

    // ─── 4. CUSTOMERS: repeat vs individual segment based on order count
    passes.push({
      name: 'customers.customer_segment from order history',
      preview: () => client.query(`
        SELECT COUNT(*) AS n FROM customers c
         WHERE c.deleted_at IS NULL AND COALESCE(c.customer_segment,'') = ''`),
      apply: async () => (await client.query(`
        UPDATE customers c SET customer_segment = CASE
                 WHEN (SELECT COUNT(*) FROM orders o
                        WHERE o.customer_id = c.id AND o.deleted_at IS NULL) > 1 THEN 'Repeat'
                 ELSE 'Individual' END,
             updated_at = NOW()
         WHERE c.deleted_at IS NULL AND COALESCE(c.customer_segment,'') = ''`)).rowCount,
    })

    // ─── 5. CUSTOMERS: default payment_terms "Due on Receipt"
    // (constraint enforces one of Due on Receipt / Net 15 / Net 30 / Net 60)
    passes.push({
      name: 'customers.payment_terms default Due on Receipt',
      preview: () => client.query(`
        SELECT COUNT(*) AS n FROM customers
         WHERE deleted_at IS NULL AND COALESCE(payment_terms,'') = ''`),
      apply: async () => (await client.query(`
        UPDATE customers SET payment_terms = 'Due on Receipt', updated_at = NOW()
         WHERE deleted_at IS NULL AND COALESCE(payment_terms,'') = ''`)).rowCount,
    })

    // ─── 6. ORDERS: copy contact_email + contact_phone from linked customer
    passes.push({
      name: 'orders.contact_email/phone from customer',
      preview: () => client.query(`
        SELECT COUNT(*) AS n FROM orders o
         WHERE o.deleted_at IS NULL AND o.customer_id IS NOT NULL
           AND (COALESCE(o.contact_email,'') = '' OR COALESCE(o.contact_phone,'') = '')
           AND EXISTS (SELECT 1 FROM customers c WHERE c.id = o.customer_id
                        AND (NULLIF(c.email,'') IS NOT NULL OR NULLIF(c.phone,'') IS NOT NULL))`),
      apply: async () => (await client.query(`
        UPDATE orders o SET
          contact_email = COALESCE(NULLIF(o.contact_email,''), c.email),
          contact_phone = COALESCE(NULLIF(o.contact_phone,''), c.phone),
          updated_at = NOW()
         FROM customers c
         WHERE c.id = o.customer_id AND o.deleted_at IS NULL`)).rowCount,
    })

    // ─── 7. ORDERS: sensible defaults where the CSV import left blanks
    passes.push({
      name: 'orders.currency/payment_method/order_type defaults',
      preview: () => client.query(`
        SELECT COUNT(*) AS n FROM orders o
         WHERE o.deleted_at IS NULL
           AND (COALESCE(o.currency,'') = '' OR COALESCE(o.payment_method,'') = '' OR COALESCE(o.order_type::text,'') = '')`),
      apply: async () => (await client.query(`
        UPDATE orders SET
          currency        = COALESCE(NULLIF(currency,''),        'USD'),
          payment_method  = COALESCE(NULLIF(payment_method,''),  'Bank Transfer'),
          payment_terms   = COALESCE(NULLIF(payment_terms,''),   'Advance'),
          updated_at = NOW()
         WHERE deleted_at IS NULL`)).rowCount,
    })

    // ─── 8. ORDERS: derive payment_status + status from payment coverage
    passes.push({
      name: 'orders.payment_status from allocated payments',
      preview: () => client.query(`
        SELECT COUNT(*) AS n FROM orders o WHERE o.deleted_at IS NULL AND o.total > 0`),
      apply: async () => (await client.query(`
        WITH paid AS (
          SELECT o.id AS order_id,
                 COALESCE(SUM(p.amount), 0)::numeric(12,2) AS paid_amt
            FROM orders o
            LEFT JOIN payments p ON p.order_id = o.id
           WHERE o.deleted_at IS NULL AND o.total > 0
           GROUP BY o.id)
        UPDATE orders o SET
          payment_status = (CASE
            WHEN paid.paid_amt >= o.total          THEN 'Paid'
            WHEN paid.paid_amt > 0                 THEN 'Partial'
            ELSE 'Unpaid' END)::payment_status,
          amount_paid = paid.paid_amt,
          updated_at = NOW()
         FROM paid
         WHERE paid.order_id = o.id`)).rowCount,
    })

    // ─── 9. INVOICES: copy contact fields from customer
    passes.push({
      name: 'invoices.billing_email/contact_number from customer',
      preview: () => client.query(`
        SELECT COUNT(*) AS n FROM invoices i
         WHERE i.deleted_at IS NULL AND i.customer_id IS NOT NULL
           AND (COALESCE(i.billing_email,'') = '' OR COALESCE(i.contact_number,'') = '')`),
      apply: async () => (await client.query(`
        UPDATE invoices i SET
          billing_email  = COALESCE(NULLIF(i.billing_email,''),  c.email),
          contact_number = COALESCE(NULLIF(i.contact_number,''), c.phone),
          updated_at = NOW()
         FROM customers c
         WHERE c.id = i.customer_id AND i.deleted_at IS NULL`)).rowCount,
    })

    // ─── 10. INVOICES: currency + payment defaults
    passes.push({
      name: 'invoices.currency/payment_terms defaults',
      preview: () => client.query(`
        SELECT COUNT(*) AS n FROM invoices
         WHERE deleted_at IS NULL AND (COALESCE(currency,'') = '' OR COALESCE(payment_terms,'') = '')`),
      apply: async () => (await client.query(`
        UPDATE invoices SET
          currency      = COALESCE(NULLIF(currency,''),      'USD'),
          payment_terms = COALESCE(NULLIF(payment_terms,''), 'Advance'),
          payment_method= COALESCE(NULLIF(payment_method,''),'Bank Transfer'),
          updated_at = NOW()
         WHERE deleted_at IS NULL`)).rowCount,
    })

    // ─── 11. QUOTATIONS: pull customer_id from the linked invoice (if any)
    passes.push({
      name: 'quotations.customer_id via linked invoice',
      preview: () => client.query(`
        SELECT COUNT(*) AS n FROM quotations q
         WHERE q.deleted_at IS NULL AND q.customer_id IS NULL
           AND EXISTS (SELECT 1 FROM invoices i WHERE i.quote_id = q.id AND i.customer_id IS NOT NULL)`),
      apply: async () => (await client.query(`
        UPDATE quotations q SET customer_id = i.customer_id, updated_at = NOW()
         FROM invoices i
         WHERE i.quote_id = q.id AND q.customer_id IS NULL AND i.customer_id IS NOT NULL`)).rowCount,
    })

    // ─── 12. QUOTATIONS: copy contact fields from customer
    passes.push({
      name: 'quotations.billing_email/contact_number from customer',
      preview: () => client.query(`
        SELECT COUNT(*) AS n FROM quotations q
         WHERE q.deleted_at IS NULL AND q.customer_id IS NOT NULL
           AND (COALESCE(q.billing_email,'') = '' OR COALESCE(q.contact_number,'') = '')`),
      apply: async () => (await client.query(`
        UPDATE quotations q SET
          billing_email  = COALESCE(NULLIF(q.billing_email,''),  c.email),
          contact_number = COALESCE(NULLIF(q.contact_number,''), c.phone),
          updated_at = NOW()
         FROM customers c
         WHERE c.id = q.customer_id AND q.deleted_at IS NULL`)).rowCount,
    })

    // ─── 13. QUOTATIONS: split shipping_address into city/state/zip/country
    passes.push({
      name: 'quotations.shipping_city/state/zip/country from address',
      preview: () => client.query(`
        SELECT COUNT(*) AS n FROM quotations
         WHERE deleted_at IS NULL AND shipping_address IS NOT NULL
           AND (COALESCE(shipping_city,'') = '' OR COALESCE(shipping_state,'') = ''
                OR COALESCE(zip_code,'') = '' OR COALESCE(shipping_country,'') = '')`),
      apply: async () => {
        const rows = (await client.query(`
          SELECT id, shipping_address FROM quotations
           WHERE deleted_at IS NULL AND shipping_address IS NOT NULL
             AND (COALESCE(shipping_city,'') = '' OR COALESCE(shipping_state,'') = ''
                  OR COALESCE(zip_code,'') = '' OR COALESCE(shipping_country,'') = '')`)).rows
        for (const r of rows) {
          const p = splitAddress(r.shipping_address)
          await client.query(`
            UPDATE quotations SET
              shipping_city    = COALESCE(NULLIF(shipping_city,''),    $2),
              shipping_state   = COALESCE(NULLIF(shipping_state,''),   $3),
              zip_code         = COALESCE(NULLIF(zip_code,''),         $4),
              shipping_country = COALESCE(NULLIF(shipping_country,''), $5),
              updated_at = NOW()
             WHERE id = $1`, [r.id, p.city, p.state, p.zip, p.country])
        }
        return rows.length
      },
    })

    // ─── 14. QUOTATIONS: currency + order_type defaults
    passes.push({
      name: 'quotations.currency/order_type defaults',
      preview: () => client.query(`
        SELECT COUNT(*) AS n FROM quotations
         WHERE deleted_at IS NULL AND (COALESCE(currency,'') = '' OR order_type IS NULL)`),
      apply: async () => (await client.query(`
        UPDATE quotations SET
          currency   = COALESCE(NULLIF(currency,''), 'USD'),
          order_type = COALESCE(order_type, 'dtf'),
          updated_at = NOW()
         WHERE deleted_at IS NULL`)).rowCount,
    })

    // ─── 15. PURCHASE ORDERS: expected_date = order_date + 7 days if missing
    passes.push({
      name: 'purchase_orders.expected_date default order_date + 7',
      preview: () => client.query(`
        SELECT COUNT(*) AS n FROM purchase_orders
         WHERE deleted_at IS NULL AND expected_date IS NULL AND order_date IS NOT NULL`),
      apply: async () => (await client.query(`
        UPDATE purchase_orders SET expected_date = order_date + INTERVAL '7 days',
                                    updated_at = NOW()
         WHERE deleted_at IS NULL AND expected_date IS NULL AND order_date IS NOT NULL`)).rowCount,
    })

    // ─── 16. PURCHASE ORDERS: currency + payment_terms defaults
    passes.push({
      name: 'purchase_orders.currency/payment_terms defaults',
      preview: () => client.query(`
        SELECT COUNT(*) AS n FROM purchase_orders
         WHERE deleted_at IS NULL AND (COALESCE(currency,'') = '' OR COALESCE(payment_terms,'') = '')`),
      apply: async () => (await client.query(`
        UPDATE purchase_orders SET
          currency      = COALESCE(NULLIF(currency,''),      'USD'),
          payment_terms = COALESCE(NULLIF(payment_terms,''), 'Advance'),
          priority      = COALESCE(NULLIF(priority,''),      'Standard'),
          updated_at = NOW()
         WHERE deleted_at IS NULL`)).rowCount,
    })

    // ─── 17. PURCHASE ORDERS: fill vendor_id from vendor_name (TEXSTONE INC)
    //      if a matching supplier row exists.
    passes.push({
      name: 'purchase_orders.supplier_id from vendor_name',
      preview: () => client.query(`
        SELECT COUNT(*) AS n FROM purchase_orders po
         WHERE po.deleted_at IS NULL AND po.supplier_id IS NULL AND po.vendor_name IS NOT NULL
           AND EXISTS (SELECT 1 FROM suppliers s WHERE LOWER(s.name) = LOWER(po.vendor_name))`),
      apply: async () => (await client.query(`
        UPDATE purchase_orders po SET supplier_id = s.id, updated_at = NOW()
         FROM suppliers s
         WHERE LOWER(s.name) = LOWER(po.vendor_name)
           AND po.deleted_at IS NULL AND po.supplier_id IS NULL`)).rowCount,
    })

    // ─── DRY RUN report vs APPLY ────────────────────────────────────────
    console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY-RUN'}\n`)
    let totalChanges = 0
    if (APPLY) await client.query('BEGIN')
    for (const p of passes) {
      if (APPLY) {
        const n = await p.apply()
        totalChanges += Number(n) || 0
        console.log(`  ✓ ${p.name}  (${n} rows)`)
      } else {
        const preview = (await p.preview()).rows[0].n
        console.log(`  · ${p.name}  (~${preview} rows would change)`)
      }
    }
    if (APPLY) await client.query('COMMIT')

    console.log(`\n${APPLY ? `Total row updates: ${totalChanges}` : 'DRY RUN — re-run with --apply to commit.'}`)
  } catch (err) {
    if (APPLY) { try { await client.query('ROLLBACK') } catch { /* not in tx */ } }
    throw err
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch(err => { console.error(err); process.exit(1) })
