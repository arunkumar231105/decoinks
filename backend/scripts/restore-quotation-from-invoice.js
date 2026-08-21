#!/usr/bin/env node
/**
 * Rebuild a quotation that was deleted outright, from the invoice it produced.
 *
 * Quotation deletes are normally soft — the row keeps its data behind
 * deleted_at and can be brought straight back. Hector Garcia's quotation is not
 * there under any number, deleted or otherwise, and the newest database dump on
 * this box predates it, so there is nothing to un-delete.
 *
 * What did survive is the invoice raised from it, carrying the same customer,
 * the same address, the same ten lines and the same money. This rebuilds the
 * quotation from that invoice and links the two back together.
 *
 * Everything written here is copied from the invoice — nothing is invented. The
 * quotation's own fields that the invoice cannot know (valid_until, internal
 * notes) are left empty rather than guessed, and the note on the record says
 * plainly that it was reconstructed and from what.
 *
 * Refuses to run if the invoice already has a quotation, so it cannot create a
 * second one.
 *
 * Usage:
 *   node backend/scripts/restore-quotation-from-invoice.js <INVOICE-NUMBER>            (dry-run)
 *   node backend/scripts/restore-quotation-from-invoice.js <INVOICE-NUMBER> --apply
 */
const { Pool } = require('pg')

const APPLY = process.argv.includes('--apply')
const invoiceNumber = process.argv.slice(2).find(a => !a.startsWith('--'))
const DATABASE_URL = process.env.DATABASE_URL ||
  'postgresql://postgres:decoinks_pass@localhost:5435/decoinks_db'

async function main() {
  if (!invoiceNumber) throw new Error('Pass the invoice number to rebuild from')
  const pool = new Pool({ connectionString: DATABASE_URL })
  const client = await pool.connect()
  try {
    const { rows: [inv] } = await client.query(
      `SELECT * FROM invoices WHERE invoice_number = $1 AND deleted_at IS NULL`, [invoiceNumber])
    if (!inv) throw new Error(`${invoiceNumber} not found`)
    if (inv.quote_id) {
      const { rows: [q] } = await client.query(`SELECT quote_number FROM quotations WHERE id = $1`, [inv.quote_id])
      throw new Error(`${invoiceNumber} already points at ${q ? q.quote_number : 'a quotation'} — nothing to rebuild`)
    }

    const { rows: items } = await client.query(
      `SELECT description, qty, unit_price, amount, sort_order, sizes, colors, artwork_count,
              front_image, back_image, artwork_image, artwork_no
         FROM invoice_items WHERE invoice_id = $1 ORDER BY sort_order, created_at`, [inv.id])

    const { rows: [seq] } = await client.query(
      `SELECT COALESCE(MAX(CAST(SPLIT_PART(quote_number,'-',3) AS int)), 0) + 1 AS n
         FROM quotations WHERE quote_number ~ '^Q-2026-[0-9]{4}$'`)
    const quoteNumber = `Q-2026-${String(seq.n).padStart(4, '0')}`

    const shipping = Number(inv.shipping_charges || 0)
    console.log(`Rebuilding from ${invoiceNumber}`)
    console.log(`  customer   ${inv.customer_name}`)
    console.log(`  address    ${String(inv.shipping_address || '').replace(/\n/g, ' / ')}`)
    console.log(`  money      goods $${inv.subtotal} + shipping $${shipping} = $${inv.total}`)
    console.log(`  lines      ${items.length}`)
    console.log(`  new number ${quoteNumber}  (status Approved — the invoice already exists)`)

    if (!APPLY) {
      console.log('\nDRY RUN — nothing written. Re-run with --apply to commit.')
      return
    }

    await client.query('BEGIN')
    const { rows: [quote] } = await client.query(
      `INSERT INTO quotations
         (quote_number, status, customer_id, customer_name, billing_email, contact_number,
          billing_address, shipping_address, order_type, currency,
          subtotal, discount_pct, discount_amt, tax_pct, tax_amt, total,
          estimated_shipping, shipping_amount, rush_services, quote_estimate,
          payment_terms, payment_method, revision_number, sent_at, approved_at, entry_date, due_date,
          created_by, notes)
       VALUES ($1,'Approved',$2,$3,$4,$5,$6,$7,$8,$9,
               $10,$11,$12,$13,$14,$15,
               $16,$16,$17,$15,
               $18,$19,1,$20::date::timestamptz,$20::date::timestamptz,CURRENT_DATE,$20::date,
               $21,$22)
       RETURNING id, quote_number`,
      [quoteNumber, inv.customer_id, inv.customer_name, inv.billing_email, inv.contact_number,
       inv.billing_address, inv.shipping_address, inv.order_type, inv.currency || 'USD',
       inv.subtotal, inv.discount_pct || 0, inv.discount_amt || 0, inv.tax_pct || 0, inv.tax_amt || 0, inv.total,
       shipping, inv.rush_services || 0,
       inv.payment_terms, inv.payment_method, inv.issue_date,
       inv.created_by,
       `Rebuilt from ${invoiceNumber} after the original quotation was deleted outright. ` +
       `Customer, address, lines and money are copied from that invoice.`])

    for (const [i, it] of items.entries()) {
      await client.query(
        `INSERT INTO quotation_items
           (quotation_id, description, qty, unit_price, amount, sort_order, sizes, colors,
            artwork_count, front_image, back_image, artwork_image, artwork_no)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        // invoice_items.qty is numeric, quotation_items.qty is an integer.
        [quote.id, it.description, Math.round(Number(it.qty)), it.unit_price, it.amount, it.sort_order ?? i,
         it.sizes, it.colors, it.artwork_count === null ? null : Math.round(Number(it.artwork_count)),
         it.front_image, it.back_image, it.artwork_image, it.artwork_no])
    }

    await client.query(`UPDATE invoices SET quote_id = $1, updated_at = NOW() WHERE id = $2`, [quote.id, inv.id])
    await client.query('COMMIT')
    console.log(`\nRebuilt ${quote.quote_number} with ${items.length} line(s), and ${invoiceNumber} now points at it.`)
  } catch (err) {
    if (APPLY) { try { await client.query('ROLLBACK') } catch { /* no tx */ } }
    throw err
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch(err => { console.error(err.message); process.exit(1) })
