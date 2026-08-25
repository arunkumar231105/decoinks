/**
 * Portal artwork sync — idempotent pipeline.
 *
 * For every order folder in Nextcloud (PO/<customer>/ORD<NN>-<DD-MM-YY>/) that
 * carries a CURATED final-artwork set, this:
 *   1. creates one artwork per file (fetched from Nextcloud, stored in MinIO),
 *   2. links it to the order + its purchase order (po_artworks) + quotation,
 *   3. sets order_items_dtf.artwork_image (position match) so the customer
 *      portal shows a preview.
 *
 * Reliable sources only (never mockups/references/aggregate):
 *   a) final_files2.0/*.{png,jpg,...}      (curated, human-approved)
 *   b) final_files/AW<NN>_FINAL.<img>      (numbered convention)
 * Orders with neither are skipped (logged) — no guessing.
 *
 * Idempotent: an order whose PO already has po_artworks is skipped, so the job
 * is safe to run on a schedule. New folders attach on the next run; nothing is
 * ever double-attached.
 *
 * Run:  node scripts/portal-artwork-sync.js            (attach new, set images)
 *       node scripts/portal-artwork-sync.js --images   (only refresh line images)
 */
const path = require('path')
const { query } = require('../src/config/db')
const artworkSvc = require('../src/modules/artworks/artworks.service')

const NC_URL  = (process.env.NEXTCLOUD_URL || '').replace(/\/+$/, '')
const NC_USER = process.env.NEXTCLOUD_USER
const NC_PASS = process.env.NEXTCLOUD_APP_PASSWORD
const NC_ROOT = `${NC_URL}/remote.php/dav/files/${NC_USER}`
const AUTH = 'Basic ' + Buffer.from(`${NC_USER}:${NC_PASS}`).toString('base64')
const UPLOADED_BY = process.env.PORTAL_SYNC_USER || 'a26a3675-82b0-4854-aae5-562a03dbe254'

const IMG_EXT = ['png', 'jpg', 'jpeg', 'webp', 'gif']
const ALL_EXT = [...IMG_EXT, 'pdf', 'ai']
const MIME = { png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg', gif:'image/gif', webp:'image/webp', pdf:'application/pdf', ai:'application/postscript' }
const AWFIN = /(?:^|\/)(?:[A-Za-z_]*)AW0*(\d+)_?FINAL\.[a-z]+$/i

const log = (...a) => console.log(new Date().toISOString(), ...a)
const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '')
const ext = f => (path.extname(f).slice(1) || '').toLowerCase()

async function propfindTree() {
  const res = await fetch(`${NC_ROOT}/PO/`, { method: 'PROPFIND', headers: { Authorization: AUTH, Depth: 'infinity' } })
  if (!res.ok) throw new Error(`PROPFIND ${res.status}`)
  const xml = await res.text()
  const hrefs = [...xml.matchAll(/<d:href>([^<]+)<\/d:href>/gi)].map(m => decodeURIComponent(m[1]))
  const prefix = `/remote.php/dav/files/${NC_USER}/PO/`
  return hrefs.filter(h => h.startsWith(prefix) && !h.endsWith('/')).map(h => h.slice(prefix.length)) // "<cust>/<ORD..>/..."
}

/** File sits DIRECTLY in <folder> (no nested subfolder like "New folder/"). */
function directIn(f, folder) {
  return new RegExp('/' + folder.replace(/\./g, '\\.') + '/[^/]+$', 'i').test(f)
}

/**
 * Pick the curated final-artwork set for one order folder, best source first:
 *   1. final_files2.0/*        (human-curated)
 *   2. final_files/AW<NN>_FINAL (numbered convention)
 *   3. final_files/*           (the finals folder — top level only)
 * Mockups/, reference_files/, Gangsheets/ and nested subfolders are never used.
 */
function pickSource(folderFiles) {
  const img = f => IMG_EXT.includes(ext(f))
  const ff2 = folderFiles.filter(f => directIn(f, 'final_files2.0') && img(f))
  if (ff2.length) return { kind: 'final_files2.0', files: ff2.sort() }
  const awfin = folderFiles.filter(f => directIn(f, 'final_files') && AWFIN.test(f))
  if (awfin.length) return { kind: 'AWxx_FINAL', files: awfin.sort((a, b) => (+a.match(AWFIN)[1]) - (+b.match(AWFIN)[1])) }
  const ff = folderFiles.filter(f => directIn(f, 'final_files') && img(f))
  if (ff.length) return { kind: 'final_files', files: ff.sort() }
  return null
}

async function fetchBuf(relPath) {
  const res = await fetch(`${NC_ROOT}/PO/${encodeURI(relPath)}`, { headers: { Authorization: AUTH } })
  if (!res.ok) throw new Error(`GET ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  if (!buf.length) throw new Error('empty file')
  return buf
}

/** Set order_items_dtf.artwork_image by position for every attached order (fills NULLs only). */
async function refreshLineImages() {
  const { rowCount } = await query(`
    WITH done AS (SELECT DISTINCT poo.order_id FROM po_artworks pa JOIN po_orders poo ON poo.po_id = pa.po_id),
    items AS (SELECT id, order_id, row_number() OVER (PARTITION BY order_id ORDER BY sort_order, id) rn
                FROM order_items_dtf WHERE order_id IN (SELECT order_id FROM done)),
    arts AS (SELECT id, order_id, file_url, row_number() OVER (PARTITION BY order_id ORDER BY created_at, id) rn
               FROM artworks WHERE order_id IN (SELECT order_id FROM done) AND lower(file_type) = ANY($1))
    UPDATE order_items_dtf d SET artwork_image = a.file_url
    FROM items i JOIN arts a ON a.order_id = i.order_id AND a.rn = i.rn
    WHERE d.id = i.id AND (d.artwork_image IS NULL OR d.artwork_image = '')`, [IMG_EXT])
  return rowCount
}

async function main() {
  const imagesOnly = process.argv.includes('--images')
  if (imagesOnly) { const n = await refreshLineImages(); log(`line images set: ${n}`); process.exit(0) }

  // 1. Orders (with folder-matching keys) that still need artwork.
  const { rows: orders } = await query(`
    SELECT o.id AS order_id, o.order_number, to_char(o.order_date,'DD-MM-YY') AS odate,
           o.quotation_id, c.name AS customer,
           row_number() OVER (PARTITION BY o.customer_id ORDER BY o.order_date, o.created_at) AS seq,
           po.id AS po_id, po.po_number,
           EXISTS (SELECT 1 FROM po_artworks pa WHERE pa.po_id = po.id) AS attached
      FROM orders o
      JOIN customers c ON c.id = o.customer_id AND c.deleted_at IS NULL
      LEFT JOIN po_orders poo ON poo.order_id = o.id
      LEFT JOIN purchase_orders po ON po.id = poo.po_id AND po.deleted_at IS NULL
     WHERE o.deleted_at IS NULL AND o.order_type::text = 'dtf'`)

  // 2. Nextcloud tree → group files by "<customer>/<orderFolder>".
  const tree = await propfindTree()
  const byFolder = new Map()   // key "cust||ordFolder" -> [relPaths]
  for (const rel of tree) {
    const parts = rel.split('/')
    if (parts.length < 3) continue
    const key = `${parts[0]}||${parts[1]}`
    if (!byFolder.has(key)) byFolder.set(key, [])
    byFolder.get(key).push(rel)
  }

  // 3. Index folders by normalized customer + ORD number and + date, for matching.
  const folderIndex = []   // { custNorm, ordNo, date, key, files }
  for (const [key, files] of byFolder) {
    const [cust, folder] = key.split('||')
    const m = folder.match(/^ORD0*(\d+)-(\d{2}-\d{2}-\d{2})/i)
    folderIndex.push({ custNorm: norm(cust), ordNo: m ? +m[1] : null, date: m ? m[2] : null, key, files })
  }

  let created = 0, ordersDone = 0, skippedNoSrc = 0, skippedAttached = 0, failed = 0
  for (const o of orders) {
    if (!o.po_id) continue
    if (o.attached) { skippedAttached++; continue }
    const cN = norm(o.customer)
    // Match folder by customer + (date OR seq).
    const f = folderIndex.find(x => x.custNorm === cN && x.date === o.odate)
          || folderIndex.find(x => x.custNorm === cN && x.ordNo === Number(o.seq))
    if (!f) { skippedNoSrc++; continue }
    const src = pickSource(f.files)
    if (!src) { skippedNoSrc++; continue }

    let sort = 0, okAny = false
    for (const rel of src.files) {
      const fname = rel.split('/').pop()
      try {
        const buffer = await fetchBuf(rel)
        const art = await artworkSvc.create({
          name: fname.replace(/\.[^.]+$/, ''),
          order_id: o.order_id, quotation_id: o.quotation_id || null,
          status: 'Approved', uploaded_by: UPLOADED_BY,
          notes: `Portal sync from Nextcloud: PO/${rel}`,
          file: { buffer, originalname: fname, mimetype: MIME[ext(fname)] || 'application/octet-stream', size: buffer.length },
        })
        await query(`INSERT INTO po_artworks (po_id, artwork_id, sort_order) VALUES ($1,$2,$3)
                     ON CONFLICT (po_id, artwork_id) DO NOTHING`, [o.po_id, art.id, sort++])
        created++; okAny = true
      } catch (e) { failed++; log(`  FAIL ${o.order_number} ${fname}: ${e.message}`) }
    }
    if (okAny) { ordersDone++; log(`attached ${o.order_number} (${o.customer}) <- ${src.kind} x${src.files.length}`) }
  }

  const imgSet = await refreshLineImages()
  log(`DONE: orders_attached=${ordersDone} artworks_created=${created} line_images_set=${imgSet} ` +
      `skipped_no_source=${skippedNoSrc} skipped_already=${skippedAttached} failed=${failed}`)
  process.exit(0)
}

main().catch(e => { log('FATAL', e); process.exit(1) })
