/**
 * Naqsha: PO vault ki artwork files ko un ke sales order se jorna.
 *
 * YEH SIRF DEKHTA HAI. Na database mein kuch likhta hai, na Nextcloud mein.
 * Maqsad sirf yeh batana hai ke kaun si file kis order ki hai aur us par kitna
 * bharosa kiya ja sakta hai.
 *
 * VAULT KA DHAANCHA. `PO/` ke neeche teen shaklein milti hain:
 *   PO/<Customer>/ORD01-27-04-26/final_files2.0/AW01_FINAL.png   ← order ke saath
 *   PO/<Customer>/order 01/final_files/...                        ← order ke saath
 *   PO/<Customer>/final_files/...                                 ← flat, order ka nishan nahi
 *
 * ORD<NN>-<DD-MM-YY> mein tareekh us order ki hai, is liye yehi sab se pukhta
 * nishani hai. Flat folder sirf customer batata hai.
 *
 * KAUN SI FILE. Wahi tarteeb jo portal-artwork-sync.js istemal karti hai:
 *     1. final_files2.0/*        (haath se chuni hui)
 *     2. final_files/AW<NN>_FINAL
 *     3. final_files/*
 * Mockups, reference_files aur Gangsheets kabhi nahi — wo customer ka bheja
 * hua maal ya production ka gang sheet hai, order ka artwork nahi.
 *
 * Sirf woh files jo browser dikha sakta hai (png/jpg/jpeg/webp) — preview isi
 * ke liye chahiye. .ai aur .pdf chhor diye jate hain.
 *
 * BHAROSE KE TEEN DARJE:
 *   PUKHTA    ORD folder ki tareekh us customer ke theek ek order se milti hai
 *   DARMIYANA flat folder, aur us customer ka sirf ek hi DTF order hai
 *   KAMZOR    flat folder magar customer ke kai orders — kis ka hai, tay nahi
 *
 * Sirf un orders ko dekha jata hai jin ki DTF line par abhi artwork nahi.
 */
const fs = require('fs')
const path = require('path')
const { query, pool } = require('../src/config/db')

const OUT = path.join(__dirname, 'data', 'artwork-map.tsv')
const IMG = /\.(png|jpe?g|webp)$/i
const AWFIN = /AW\s*0*(\d+)[ _-]*FINAL/i
const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '')

/** Ek order folder ke files mein se woh set chunna jo asal artwork hai. */
function pickFiles(files) {
  const img = files.filter(f => IMG.test(f.file_name))
  const inDir = (f, dir) => new RegExp('/' + dir.replace(/\./g, '\\.') + '(/1x)?$', 'i').test(f.parent_path)

  const ff2 = img.filter(f => inDir(f, 'final_files2.0'))
  if (ff2.length) return { kind: 'final_files2.0', files: ff2 }

  const awfin = img.filter(f => inDir(f, 'final_files') && AWFIN.test(f.file_name))
  if (awfin.length) return { kind: 'AWxx_FINAL', files: awfin.sort((a, b) => (+a.file_name.match(AWFIN)[1]) - (+b.file_name.match(AWFIN)[1])) }

  const ff = img.filter(f => inDir(f, 'final_files'))
  if (ff.length) return { kind: 'final_files', files: ff }

  return null
}

async function main() {
  // Jin orders ko artwork chahiye
  const need = (await query(`
    SELECT o.id, o.order_number, o.order_date::date AS d, c.name AS customer,
           COUNT(di.id) AS lines, COUNT(di.id) FILTER (WHERE COALESCE(di.artwork_image,'')<>'') AS have
      FROM orders o JOIN customers c ON c.id=o.customer_id JOIN order_items_dtf di ON di.order_id=o.id
     WHERE o.deleted_at IS NULL
     GROUP BY 1,2,3,4 HAVING COUNT(di.id) FILTER (WHERE COALESCE(di.artwork_image,'')<>'') < COUNT(di.id)
     ORDER BY o.order_date`)).rows

  // Har customer ke saare DTF orders — flat folder ke faisle ke liye
  const allDtf = (await query(`
    SELECT o.id, o.order_number, o.order_date::date AS d, c.name AS customer
      FROM orders o JOIN customers c ON c.id=o.customer_id
     WHERE o.deleted_at IS NULL AND EXISTS (SELECT 1 FROM order_items_dtf x WHERE x.order_id=o.id)`)).rows
  const byCustomer = new Map()
  for (const o of allDtf) {
    const k = norm(o.customer)
    if (!byCustomer.has(k)) byCustomer.set(k, [])
    byCustomer.get(k).push(o)
  }

  const assets = (await query(`
    SELECT id, path, parent_path, file_name, mime_type, file_size_bytes, nextcloud_file_id,
           SPLIT_PART(parent_path,'/',2) AS vault_customer, SPLIT_PART(parent_path,'/',3) AS lvl3
      FROM artwork_vault_assets
     WHERE parent_path LIKE 'PO/%' AND asset_type='artwork'`)).rows

  // Folder ke hisaab se jama karna
  const folders = new Map()
  for (const a of assets) {
    const isOrderDir = /^ORD\d{2}-\d{2}-\d{2}-\d{2}$/.test(a.lvl3) || /^order ?\d+$/i.test(a.lvl3)
    const key = `${a.vault_customer}||${isOrderDir ? a.lvl3 : ''}`
    if (!folders.has(key)) folders.set(key, { customer: a.vault_customer, orderDir: isOrderDir ? a.lvl3 : null, files: [] })
    folders.get(key).files.push(a)
  }

  const rows = []
  for (const f of folders.values()) {
    const picked = pickFiles(f.files)
    if (!picked) continue
    const candidates = byCustomer.get(norm(f.customer)) || []
    let order = null, confidence = null, why = ''

    if (f.orderDir && /^ORD\d{2}-\d{2}-\d{2}-\d{2}$/.test(f.orderDir)) {
      const [, dd, mm, yy] = f.orderDir.match(/^ORD\d{2}-(\d{2})-(\d{2})-(\d{2})$/)
      const iso = `20${yy}-${mm}-${dd}`
      const hit = candidates.filter(c => String(c.d) === iso)
      if (hit.length === 1) { order = hit[0]; confidence = 'PUKHTA'; why = `${f.orderDir} ki tareekh ${iso} order se milti hai` }
      else if (hit.length > 1) { confidence = 'KAMZOR'; why = `${iso} par is customer ke ${hit.length} orders hain` }
      else { confidence = 'KAMZOR'; why = `${iso} par is customer ka koi order nahi` }
    } else if (candidates.length === 1) {
      order = candidates[0]; confidence = 'DARMIYANA'; why = 'flat folder, magar customer ka sirf ek DTF order hai'
    } else if (candidates.length === 0) {
      confidence = 'KAMZOR'; why = `vault ka naam "${f.customer}" kisi customer se nahi milta`
    } else {
      confidence = 'KAMZOR'; why = `flat folder, magar customer ke ${candidates.length} DTF orders hain`
    }

    const needsIt = order ? need.find(n => String(n.id) === String(order.id)) : null
    rows.push({
      confidence, customer: f.customer, orderDir: f.orderDir || '(flat)',
      order_number: order ? order.order_number : '', order_id: order ? order.id : '',
      order_date: order ? String(order.d) : '', needs: needsIt ? 'haan' : (order ? 'nahi — pehle se laga hai' : ''),
      kind: picked.kind, n_files: picked.files.length, why,
      files: picked.files.map(x => x.file_name).join(' | '),
      paths: picked.files.map(x => x.path).join(' | '),
    })
  }

  const order = { PUKHTA: 0, DARMIYANA: 1, KAMZOR: 2 }
  rows.sort((a, b) => order[a.confidence] - order[b.confidence] || a.customer.localeCompare(b.customer))

  console.log(`\nJin orders ko artwork chahiye: ${need.length}`)
  console.log(`PO vault ke artwork folders: ${folders.size}\n`)
  console.log('DARJA       ORDER          TAREEKH     CHAHIYE?  FILES  KISM             CUSTOMER / FOLDER')
  console.log('-'.repeat(112))
  for (const r of rows) {
    console.log(
      `${r.confidence.padEnd(11)} ${(r.order_number || '—').padEnd(14)} ${(r.order_date || '—').padEnd(11)} ` +
      `${(r.needs || '—').padEnd(9)} ${String(r.n_files).padStart(5)}  ${r.kind.padEnd(16)} ${r.customer}/${r.orderDir}`)
  }

  const tally = {}
  for (const r of rows) {
    const k = `${r.confidence} / ${r.needs === 'haan' ? 'chahiye' : r.needs ? 'pehle se hai' : 'order nahi mila'}`
    tally[k] = (tally[k] || 0) + 1
  }
  console.log('\nGINTI:')
  for (const [k, v] of Object.entries(tally).sort()) console.log(`  ${k}: ${v}`)

  const attachable = rows.filter(r => r.needs === 'haan')
  console.log(`\nAbhi attach ho sakte hain: ${attachable.length} orders, ` +
              `${attachable.reduce((s, r) => s + r.n_files, 0)} files`)

  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  const cols = ['confidence','customer','orderDir','order_number','order_id','order_date','needs','kind','n_files','why','files','paths']
  fs.writeFileSync(OUT, [cols.join('\t'), ...rows.map(r => cols.map(c => String(r[c] ?? '').replace(/\t/g, ' ')).join('\t'))].join('\n'))
  console.log(`\nPoora naqsha: ${OUT}\n`)
  await pool.end()
}

main().catch(err => { console.error(err); process.exit(1) })
