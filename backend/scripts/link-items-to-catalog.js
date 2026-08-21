#!/usr/bin/env node
/**
 * Enrich apparel line-items on quotations, invoices and sales orders with a real
 * BlankTex catalog reference. For every apparel line whose description can be
 * resolved to a single BlankTex style, this fills the (previously NULL) catalog
 * stub columns:
 *   catalog_style_id -> blanktex.styles(style_id)
 *   catalog_color_id -> blanktex.style_colors(style_color_id)   (when the line's colour resolves)
 *   catalog_size_id  -> blanktex.style_sizes(style_size_id)     (when the line's size resolves)
 *   catalog_sku      -> blanktex.style_color_sizes.sku_code     (only when style+colour+size all resolve)
 * and, ONLY when the row's unit_price is 0, the catalog list price (see note).
 *
 * Source of truth: the `blanktex.*` schema that lives inside decoinks_db (the
 * same schema the catalog_* FKs already reference), not the separate BlankTex app.
 *
 * Match heuristic (style -> colour -> size -> SKU):
 *   1. Classify the line. DTF / gangsheet / aggregate / artwork lines are NOT
 *      blank apparel and are skipped (reported separately, never as failures).
 *   2. Style: parse garment type (hard gate), GSM, fabric, gender and brand from
 *      the description, score every catalog style, and take the single best
 *      candidate. Ties / no candidate -> the row is left UNTOUCHED and logged.
 *      Owner-confirmed defaults: brand = DIGI when none is stated (all customer
 *      apparel here is DIGI); fabric = 100% Cotton when none is stated (the house
 *      blank). These defaults are transparent in the dry-run mapping table below.
 *   3. Colour / size: normalised (e.g. 2XL->XXL, "Dark Blue"->"Navy Blue") and
 *      resolved against THAT style's own variants. A multi-valued colours/sizes
 *      cell (comma list) is left unresolved — a single line can't pick one SKU.
 *
 * Safety (this is a Constitution §6 data-fix script, not a migration):
 *   - Fill-only. Never overwrites a row that already has a catalog_style_id or a
 *     non-zero unit_price. Manually-entered data always wins.
 *   - Idempotent: a re-run is a no-op on already-linked rows.
 *   - Never touches payments, shipments, customers, or any table other than the
 *     three item tables. Never deletes. Never invents a match.
 *   - Dry-run by default; --apply is gated and writes inside one transaction.
 *
 * NOTE on price: blanktex.supplier_sku_prices is currently empty (the catalog
 * carries no prices), so the unit_price backfill resolves nothing and updates 0
 * rows by design. The code path is kept so it starts working the day prices land.
 * We never fabricate a price and never recompute `amount`.
 *
 * Usage:
 *   node backend/scripts/link-items-to-catalog.js            (dry-run)
 *   node backend/scripts/link-items-to-catalog.js --apply    (writes; take the backup first)
 *
 * Backup before --apply (owner rule):
 *   pg_dump "$DATABASE_URL" -t order_items_apparel -t quotation_items -t invoice_items -Fc \
 *     > scratchpad/item-tables-backup.dump
 */
const fs = require('fs')
const path = require('path')
const { Pool } = require('pg')

const APPLY = process.argv.includes('--apply')
const DATABASE_URL = process.env.DATABASE_URL
  || 'postgresql://postgres:decoinks_pass@localhost:5435/decoinks_db'
const UNMATCHED_TSV = process.env.UNMATCHED_TSV
  || path.join(process.cwd(), 'scratchpad', 'unmatched-items.tsv')

// Owner-confirmed defaults (see docblock).
const DEFAULT_BRAND = 'DIGI'
const DEFAULT_FABRIC = '100% cotton'

// The three item tables and where their free-text / colour / size live. Note the
// shapes differ: only order_items_apparel has singular item/color/size columns.
const TABLES = [
  { table: 'order_items_apparel', parent: 'orders',     fk: 'order_id',
    textCols: ['item'],               colorCol: 'color',  sizeCol: 'size',  typeCol: null,           brandCol: 'brand' },
  { table: 'quotation_items',     parent: 'quotations', fk: 'quotation_id',
    textCols: ['description'],        colorCol: 'colors', sizeCol: 'sizes', typeCol: 'product_type', brandCol: 'brand' },
  { table: 'invoice_items',       parent: 'invoices',   fk: 'invoice_id',
    textCols: ['description'],        colorCol: 'colors', sizeCol: 'sizes', typeCol: null,           brandCol: 'brand' },
]

// -------------------------------------------------------------------------- //
// Normalisation helpers
// -------------------------------------------------------------------------- //
const lc = (s) => (s == null ? '' : String(s)).toLowerCase().trim()

// A line is not blank apparel if it looks like DTF / gangsheet / an artwork row.
function isNonApparel(text) {
  return /\bdtf\b|transfer|gang\s*sheet|gangsheet|aggregate|^aw#|artwork details|\bvinyl\b|\bdecal\b/i.test(text)
}

// Garment type is the hard gate — a line only competes against styles of the
// same garment type. Order matters: check multi-word types before "t-shirt".
const GARMENT_RULES = [
  [/long\s*sleeve.*(t-?shirt|tee)/, 'Long Sleeve T-Shirt'],
  [/(hoodie|hooded)/,               'Hoodie'],
  [/sweat\s*shirt|crewneck/,        'Sweatshirt'],
  [/sweat\s*pant/,                  'Sweatpants'],
  [/tank\s*top|tank/,               'Tank Top'],
  [/crop/,                          'Crop T-Shirt'],
  [/\bshort(s)?\b/,                 'Shorts'],
  [/\bcap\b|baseball cap/,          'Baseball Cap'],
  [/bodysuit|onesie/,               'Long Sleeve Bodysuit'],
  [/underwear/,                     'Underwear'],
  [/t-?shirt|tee\b/,                'T-Shirt'],
]
function garmentType(text) {
  const t = lc(text)
  for (const [re, type] of GARMENT_RULES) if (re.test(t)) return type
  return null
}

function extractGsm(text) {
  const m = /(\d{2,3})\s*g(sm)?\b/i.exec(text)
  return m ? parseInt(m[1], 10) : null
}

function statedFabric(text) {
  const t = lc(text)
  if (/100\s*%?\s*cotton/.test(t)) return '100% cotton'
  if (/poly.*cotton|cotton.*poly|blend|spandex|polyester/.test(t)) return 'blend'
  if (/\bcotton\b/.test(t)) return 'cotton'
  return null
}

function statedGender(text) {
  const t = lc(text)
  if (/\bwomen'?s?\b|\bladies\b|\bfemale\b/.test(t)) return 'Women'
  if (/\bmen'?s?\b|\bmale\b/.test(t)) return 'Men'
  if (/\byouth\b|\bkids?\b|\bboys?\b|\bgirls?\b/.test(t)) return 'Youth'
  if (/\btoddler\b/.test(t)) return 'Toddler'
  if (/\binfant\b|\bbaby\b/.test(t)) return 'Infant'
  if (/\bunisex\b|\badult\b/.test(t)) return 'Unisex'
  return null
}

function detectBrand(text, brandCol) {
  const t = lc(text) + ' ' + lc(brandCol)
  if (/gildan|g5000|18000|18500|5000b|c1717/.test(t)) return 'Gildan'
  // "Smart Blanks", "Decoinks LLC" etc. are not catalog brands -> house default.
  return DEFAULT_BRAND
}

// Descriptor tokens that, when present in a style name but NOT in the line, mean
// the style is a fancier/other variant than a plain line asked for.
const DESCRIPTOR_TOKENS = ['washed', 'vintage', 'premium', 'streetwear', 'snow',
  'dirty', 'plus size', 'crop', 'v-neck', 'stretch', 'fleece', 'colored', 'heavyweight']

const SIZE_ALIASES = {
  '2XL': 'XXL', '3XL': 'XXXL', '4XL': 'XXXXL', '5XL': 'XXXXXL',
  'XXL': 'XXL', 'XXXL': 'XXXL', 'XXXXL': 'XXXXL', 'XXXXXL': 'XXXXXL',
  'SM': 'S', 'MED': 'M', 'MEDIUM': 'M', 'LG': 'L', 'XLARGE': 'XL', 'SMALL': 'S', 'LARGE': 'L',
}
function normalizeSize(raw) {
  let s = lc(raw).toUpperCase().replace(/[\s.]/g, '')
  s = s.replace(/^(\d)X$/, '$1XL') // "2X" -> "2XL"
  return SIZE_ALIASES[s] || s
}

const COLOR_ALIASES = {
  'dark blue': 'navy blue', 'navy': 'navy blue', 'gray': 'grey', 'dark grey': 'grey',
  'off white': 'white', 'off-white': 'white',
}
function normalizeColor(raw) {
  const c = lc(raw)
  return COLOR_ALIASES[c] || c
}

// -------------------------------------------------------------------------- //
// Style scoring — returns a number, or null if the garment type doesn't match.
// -------------------------------------------------------------------------- //
function scoreStyle(parsed, style) {
  if (!parsed.garment || style.garment_type_norm !== lc(parsed.garment)) return null

  let score = 0
  // Brand (owner default DIGI when none stated).
  if (lc(style.brand_name) === lc(parsed.brand)) score += 3

  // GSM.
  if (parsed.gsm != null && style.gsm != null) {
    const d = Math.abs(parsed.gsm - style.gsm)
    score += d === 0 ? 4 : d <= 15 ? 2 : -2
  }

  // Fabric (default 100% cotton when the line doesn't say — the house blank).
  const fabric = parsed.fabric || DEFAULT_FABRIC
  const styleIs100 = /100\s*%?\s*cotton/.test(style.fabric_norm)
  const styleIsBlend = /poly|blend|spandex/.test(style.fabric_norm)
  if (fabric === '100% cotton') score += styleIs100 ? (parsed.fabric ? 3 : 2) : styleIsBlend ? -2 : 0
  else if (fabric === 'blend')  score += styleIsBlend ? 3 : styleIs100 ? -1 : 0
  else if (fabric === 'cotton') score += /cotton/.test(style.fabric_norm) ? 1 : 0

  // Gender — soft. Unisex fits anyone; a hard mismatch is penalised.
  if (parsed.gender) {
    if (lc(style.gender) === lc(parsed.gender)) score += 2
    else if (lc(style.gender) === 'unisex') score += 1
    else score -= 3
  } else if (lc(style.gender) === 'unisex') score += 1

  // Prefer the plain style over fancier variants the line didn't ask for.
  for (const tok of DESCRIPTOR_TOKENS) {
    if (style.name_norm.includes(tok) && !parsed.textNorm.includes(tok)) score -= 1
  }
  return score
}

// Best style for a parsed line: unique winner required. Deterministic tiebreak
// (lower GSM = the base weight) avoids coin-flips; a genuine tie -> unmatched.
function bestStyle(parsed, styles) {
  const scored = []
  for (const s of styles) {
    const sc = scoreStyle(parsed, s)
    if (sc != null) scored.push({ style: s, score: sc })
  }
  if (!scored.length) return { style: null, reason: 'no style of this garment type' }
  scored.sort((a, b) => b.score - a.score || (a.style.gsm || 999) - (b.style.gsm || 999))
  const [top, second] = scored
  if (top.score < 3) return { style: null, reason: `low confidence (best score ${top.score})` }
  if (second && second.score === top.score && (top.style.gsm || 999) === (second.style.gsm || 999)) {
    return { style: null, reason: `ambiguous (${top.style.style_no} vs ${second.style.style_no} both score ${top.score})` }
  }
  return { style: top.style, score: top.score, runnerUp: second ? `${second.style.style_no}:${second.score}` : '—' }
}

// -------------------------------------------------------------------------- //
function parseLine(text, brandCol) {
  return {
    text,
    textNorm: lc(text),
    garment: garmentType(text),
    gsm: extractGsm(text),
    fabric: statedFabric(text),
    gender: statedGender(text),
    brand: detectBrand(text, brandCol),
  }
}

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL })
  const client = await pool.connect()
  try {
    // ---- load the catalog (styles + per-style colours/sizes + SKU index) ----
    const styles = (await client.query(`
      SELECT s.style_id, s.style_no, s.style_name, b.brand_name,
             s.garment_type, s.fabric_composition, s.fabric_weight_gsm::float gsm, s.gender
        FROM blanktex.styles s JOIN blanktex.brands b ON b.brand_id = s.brand_id
       WHERE s.active AND NOT s.discontinued`)).rows
      .map(s => ({ ...s,
        garment_type_norm: lc(s.garment_type),
        fabric_norm: lc(s.fabric_composition),
        name_norm: lc(s.style_name) }))

    const colorsByStyle = new Map()
    for (const c of (await client.query(
      `SELECT style_id, style_color_id, display_name FROM blanktex.style_colors WHERE active AND NOT discontinued`)).rows) {
      if (!colorsByStyle.has(c.style_id)) colorsByStyle.set(c.style_id, [])
      colorsByStyle.get(c.style_id).push({ id: c.style_color_id, norm: normalizeColor(c.display_name) })
    }
    const sizesByStyle = new Map()
    for (const z of (await client.query(
      `SELECT style_id, style_size_id, size_code, size_name FROM blanktex.style_sizes WHERE active AND NOT discontinued`)).rows) {
      if (!sizesByStyle.has(z.style_id)) sizesByStyle.set(z.style_id, [])
      sizesByStyle.get(z.style_id).push({ id: z.style_size_id, norm: normalizeSize(z.size_code), nameNorm: normalizeSize(z.size_name) })
    }
    const skuByTriple = new Map() // style|color|size -> { sku_code, sku_id }
    for (const v of (await client.query(
      `SELECT style_id, style_color_id, style_size_id, sku_code, sku_id
         FROM blanktex.style_color_sizes WHERE active AND NOT discontinued`)).rows) {
      skuByTriple.set(`${v.style_id}|${v.style_color_id}|${v.style_size_id}`, { sku_code: v.sku_code, sku_id: v.sku_id })
    }
    const priceBySku = new Map() // sku_id -> price (currently empty by design)
    for (const p of (await client.query(
      `SELECT sku_id, cost_price::float price FROM blanktex.supplier_sku_prices
        WHERE active AND preferred_supplier`)).rows) {
      priceBySku.set(p.sku_id, p.price)
    }

    const resolveColor = (styleId, raw) => {
      if (!raw || raw.includes(',')) return null                 // empty or multi-valued
      const want = normalizeColor(raw)
      return (colorsByStyle.get(styleId) || []).find(c => c.norm === want) || null
    }
    const resolveSize = (styleId, raw) => {
      if (!raw || raw.includes(',')) return null
      const want = normalizeSize(raw)
      return (sizesByStyle.get(styleId) || []).find(z => z.norm === want || z.nameNorm === want) || null
    }

    // ---- walk the three tables ----
    const summary = {}
    const preview = []
    const unmatched = []            // { table, id, text, color, size, reason }
    const mappingSeen = new Map()   // distinct text -> chosen style (dry-run review aid)
    const plan = []                 // rows to update on --apply

    for (const cfg of TABLES) {
      const textSel = cfg.textCols[0]
      const rows = (await client.query(`
        SELECT it.id, it.${textSel} AS text, it.${cfg.colorCol} AS color, it.${cfg.sizeCol} AS size,
               it.${cfg.brandCol} AS brandcol, ${cfg.typeCol ? `it.${cfg.typeCol}` : 'NULL'} AS ptype,
               it.catalog_style_id, COALESCE(it.unit_price, 0) AS unit_price, it.qty
          FROM ${cfg.table} it
          JOIN ${cfg.parent} p ON p.id = it.${cfg.fk}
         WHERE p.deleted_at IS NULL`)).rows

      const s = summary[cfg.table] = { total: rows.length, alreadyLinked: 0, notApparel: 0, matched: 0, updated: 0, unmatched: 0, priced: 0 }

      for (const r of rows) {
        if (r.catalog_style_id) { s.alreadyLinked++; continue }   // idempotent: leave linked rows

        const blob = `${r.text || ''} ${r.ptype || ''}`.trim()
        if (isNonApparel(blob) || !garmentType(blob)) {
          s.notApparel++
          continue                                                // DTF/artwork/etc. — not a failure
        }

        const parsed = parseLine(blob, r.brandcol)
        const pick = bestStyle(parsed, styles)
        if (!pick.style) {
          s.unmatched++
          unmatched.push({ table: cfg.table, id: r.id, text: r.text, color: r.color, size: r.size, reason: pick.reason })
          continue
        }

        const st = pick.style
        const color = resolveColor(st.style_id, r.color)
        const size = resolveSize(st.style_id, r.size)
        let sku = null, price = null
        if (color && size) {
          const hit = skuByTriple.get(`${st.style_id}|${color.id}|${size.id}`)
          if (hit) { sku = hit.sku_code; if (r.unit_price === 0 && priceBySku.has(hit.sku_id)) price = priceBySku.get(hit.sku_id) }
        }

        s.matched++; s.updated++
        if (price != null) s.priced++
        plan.push({ table: cfg.table, id: r.id,
          style_id: st.style_id, color_id: color?.id || null, size_id: size?.id || null, sku, price })

        if (!mappingSeen.has(blob)) {
          mappingSeen.set(blob, `${st.brand_name} ${st.style_no} — ${st.style_name}  [score ${pick.score}, runner-up ${pick.runnerUp}]`)
        }
        if (preview.length < 10) {
          preview.push(`  ${cfg.table.replace(/_/g, ' ').padEnd(20)} ${(r.text || '').slice(0, 34).padEnd(34)} -> ${st.brand_name} ${st.style_no}  ${(color ? color.norm : '·').padEnd(10)} ${(size ? size.norm : '·').padEnd(6)} ${sku || '(no sku)'}`)
        }
      }
    }

    // ---- report ----
    let totMatched = 0, totUpdated = 0, totUnmatched = 0, totSkip = 0, totLinked = 0, totPriced = 0
    console.log(`\n=== ${APPLY ? 'APPLY' : 'DRY RUN'} — link items to BlankTex catalog ===\n`)
    for (const cfg of TABLES) {
      const s = summary[cfg.table]
      totMatched += s.matched; totUpdated += s.updated; totUnmatched += s.unmatched
      totSkip += s.notApparel; totLinked += s.alreadyLinked; totPriced += s.priced
      console.log(`${cfg.table.padEnd(22)} total ${String(s.total).padStart(4)} | matched ${String(s.matched).padStart(3)} | unmatched ${String(s.unmatched).padStart(3)} | not-apparel ${String(s.notApparel).padStart(3)} | already-linked ${String(s.alreadyLinked).padStart(3)}`)
    }
    console.log(`\n${totMatched} rows matched, ${totUpdated} rows ${APPLY ? 'updated' : 'to update'}, ${totUnmatched} unmatched  ` +
                `(also ${totSkip} non-apparel skipped, ${totLinked} already linked, ${totPriced} priced from catalog)`)

    console.log(`\nDistinct description -> chosen style (please sanity-check):`)
    for (const [text, style] of mappingSeen) console.log(`  "${text.slice(0, 52)}"  ->  ${style}`)

    console.log(`\nPreview (first ${preview.length} matches):`)
    preview.forEach(p => console.log(p))

    // ---- unmatched report file ----
    fs.mkdirSync(path.dirname(UNMATCHED_TSV), { recursive: true })
    const tsv = ['table\tid\tdescription\tcolor\tsize\treason',
      ...unmatched.map(u => `${u.table}\t${u.id}\t${(u.text || '').replace(/\t/g, ' ')}\t${u.color || ''}\t${u.size || ''}\t${u.reason}`)].join('\n')
    fs.writeFileSync(UNMATCHED_TSV, tsv + '\n')
    console.log(`\nUnmatched apparel rows (${unmatched.length}) written to ${UNMATCHED_TSV}`)

    if (!APPLY) {
      console.log('\nDRY RUN — nothing written. Re-run with --apply (after the pg_dump backup) to persist.')
      return
    }

    // ---- apply: one transaction, guarded UPDATEs (double idempotency) ----
    await client.query('BEGIN')
    for (const u of plan) {
      if (u.price != null) {
        await client.query(
          `UPDATE ${u.table} SET catalog_style_id=$1, catalog_color_id=$2, catalog_size_id=$3, catalog_sku=$4, unit_price=$5
             WHERE id=$6 AND catalog_style_id IS NULL AND COALESCE(unit_price,0)=0`,
          [u.style_id, u.color_id, u.size_id, u.sku, u.price, u.id])
      } else {
        await client.query(
          `UPDATE ${u.table} SET catalog_style_id=$1, catalog_color_id=$2, catalog_size_id=$3, catalog_sku=$4
             WHERE id=$5 AND catalog_style_id IS NULL`,
          [u.style_id, u.color_id, u.size_id, u.sku, u.id])
      }
    }
    await client.query('COMMIT')
    console.log(`\nApplied: ${plan.length} rows linked to the catalog.`)
  } catch (err) {
    if (APPLY) { try { await client.query('ROLLBACK') } catch { /* not in tx */ } }
    throw err
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch(err => { console.error(err); process.exit(1) })
