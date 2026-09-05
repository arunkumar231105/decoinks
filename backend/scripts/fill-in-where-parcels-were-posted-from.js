/**
 * Where each parcel was posted from.
 *
 * The shipments list shows a From alongside the Ship To, and it was blank on
 * thirty of them. The tracking API only reports an origin once the carrier has
 * scanned the parcel, so anything not yet collected had nothing to show — but
 * the label has carried the sender's address since the moment it was bought,
 * and the account can be asked for it.
 *
 * Reads only what is missing. Writes nothing else.
 *
 * Dry run by default. Pass --apply to write.
 */
const { query, pool } = require('../src/config/db')
const shippo = require('../src/utils/shippo')

async function main() {
  const apply = process.argv.includes('--apply')
  if (!shippo.isConfigured()) throw new Error('SHIPPO_API_KEY set nahi hai')

  const missing = new Map((await query(
    `SELECT id, BTRIM(tracking_number) AS tracking, shipment_number, customer_name
       FROM shipments
      WHERE deleted_at IS NULL AND address_from_city IS NULL
        AND NULLIF(BTRIM(tracking_number),'') IS NOT NULL`)).rows.map(r => [r.tracking, r]))

  console.log(`\n${apply ? 'LIKH RAHA HOON' : 'DRY RUN — kuch nahi likha jayega'}\n`)
  console.log(`  ${missing.size} shipments jinka 'From' khaali hai\n`)
  if (!missing.size) { await pool.end(); return }

  const found = []
  const transactions = await shippo.listTransactions({ results: 100 })
  for (const t of transactions) {
    const row = missing.get(String(t.tracking_number || '').trim())
    if (!row || !t.rate?.object_id) continue
    try {
      const sh = await shippo.shipmentBehindRate(t.rate.object_id)
      const from = sh?.address_from
      if (from?.city) found.push({ ...row, from })
    } catch { /* this one keeps its blank */ }
  }

  for (const f of found)
    console.log(`  ${f.shipment_number}  ${String(f.customer_name ?? '').padEnd(24)} <- ` +
                `${f.from.city}, ${f.from.state} ${f.from.zip}`)
  const noLabel = missing.size - found.length
  if (noLabel) console.log(`\n  ${noLabel} ka koi label Shippo par nahi mila — woh waise hi rahenge`)
  if (!apply) { console.log('\nLikhne ke liye --apply lagayein.\n'); await pool.end(); return }

  await query('BEGIN')
  try {
    for (const f of found)
      await query(
        `UPDATE shipments SET address_from_city = $2, address_from_state = $3,
                address_from_postal_code = $4, updated_at = NOW()
          WHERE id = $1 AND address_from_city IS NULL`,
        [f.id, f.from.city, f.from.state ?? null, f.from.zip ?? null])
    await query('COMMIT')
  } catch (e) { await query('ROLLBACK'); throw e }

  console.log(`\n${found.length} shipments ka 'From' bhar diya\n`)
  await pool.end()
}
main().catch(e => { console.error(e.message); process.exit(1) })
