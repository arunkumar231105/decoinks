/**
 * Gangsheet generation service.
 *
 * Canvas: 22" × 24" at 300 DPI → 6600 × 7200 pixels (white background).
 * Layout: shelf bin-packing (tallest artwork first, left-to-right per shelf).
 * Execution: always runs as a fire-and-forget background job; callers get
 *            202 immediately, then poll GET /orders/:id/gangsheet/status.
 */

const path  = require('path')
const fs    = require('fs')
const { query } = require('../../config/db')

// sharp is a native module; load it defensively so a missing platform binary
// doesn't crash the whole backend — only gangsheet endpoints degrade to 503.
let sharp = null
try {
  sharp = require('sharp')
} catch (e) {
  console.warn('[gangsheet] sharp failed to load — gangsheet generation unavailable:', e.message)
}

const DPI        = 300
const CANVAS_W   = 22 * DPI   // 6600 px
const CANVAS_H   = 24 * DPI   // 7200 px
const MARGIN_PX  = Math.round(0.25 * DPI)  // 75 px gutter between artworks
const OUTPUT_DIR = path.join(process.env.UPLOAD_DIR || 'uploads', 'gangsheets')

// ── helpers ────────────────────────────────────────────────────────────────────

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

/**
 * Shelf bin-packing.
 * @param {Array<{w:number,h:number}>} sizes - pixel dimensions, tallest-first sorted
 * @returns {Array<{x:number,y:number,w:number,h:number}>}
 */
function packShelves(sizes) {
  const placements = []
  let shelfX = MARGIN_PX
  let shelfY = MARGIN_PX
  let shelfH = 0  // tallest item on current shelf

  for (const { w, h } of sizes) {
    if (shelfX + w + MARGIN_PX > CANVAS_W) {
      // Start a new shelf
      shelfX  = MARGIN_PX
      shelfY += shelfH + MARGIN_PX
      shelfH  = 0
    }
    if (shelfY + h + MARGIN_PX > CANVAS_H) {
      // Canvas full — skip remaining artworks
      break
    }
    placements.push({ x: shelfX, y: shelfY, w, h })
    shelfX += w + MARGIN_PX
    if (h > shelfH) shelfH = h
  }
  return placements
}

// ── main export ────────────────────────────────────────────────────────────────

/**
 * Generates a gangsheet for the given order.
 * Sets gangsheet_status = 'generating', generates in background,
 * then sets status to 'ready' (or 'error').
 * Returns immediately with { jobStarted: true }.
 */
async function generateGangsheet(orderId, requestedBy) {
  if (!sharp) {
    const err = new Error('Image processing is unavailable — sharp native module could not be loaded')
    err.statusCode = 503
    throw err
  }

  // Fetch artworks attached to this order
  const { rows: artworks } = await query(
    `SELECT id, file_url, width_inches, height_inches, name
     FROM artworks
     WHERE order_id = $1 AND file_url IS NOT NULL
     ORDER BY height_inches DESC NULLS LAST, created_at`,
    [orderId]
  )

  if (artworks.length === 0) {
    throw Object.assign(new Error('No artworks attached to this order'), { statusCode: 400 })
  }

  // Mark order as generating (non-blocking for caller)
  await query(
    `UPDATE orders SET gangsheet_status = 'generating' WHERE id = $1`,
    [orderId]
  )

  // Fire and forget
  _runGeneration(orderId, artworks).catch(() => {})

  return { jobStarted: true, artworkCount: artworks.length }
}

async function _runGeneration(orderId, artworks) {
  try {
    ensureDir(OUTPUT_DIR)

    // Build pixel sizes for each artwork
    const sized = await Promise.all(artworks.map(async (aw) => {
      const filePath = _resolveFilePath(aw.file_url)
      let w, h

      if (aw.width_inches && aw.height_inches) {
        w = Math.round(aw.width_inches  * DPI)
        h = Math.round(aw.height_inches * DPI)
      } else {
        // Read actual image dimensions as fallback
        try {
          const meta = await sharp(filePath).metadata()
          w = meta.width  || DPI
          h = meta.height || DPI
        } catch {
          w = DPI; h = DPI  // 1" × 1" default for unreadable files
        }
      }
      return { ...aw, filePath, w, h }
    }))

    // Sort tallest first (already sorted by SQL, but re-sort after dimension resolution)
    sized.sort((a, b) => b.h - a.h)

    const placements = packShelves(sized.map(s => ({ w: s.w, h: s.h })))

    // Build sharp composite layers
    const composites = []
    for (let i = 0; i < placements.length; i++) {
      const { x, y, w, h } = placements[i]
      const aw = sized[i]

      try {
        const resizedBuf = await sharp(aw.filePath)
          .resize(w, h, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
          .png()
          .toBuffer()
        composites.push({ input: resizedBuf, left: x, top: y })
      } catch {
        // Skip unprocessable artwork rather than aborting the whole sheet
      }
    }

    if (composites.length === 0) {
      throw new Error('No artworks could be processed')
    }

    const outputFilename = `gangsheet_${orderId}_${Date.now()}.png`
    const outputPath = path.join(OUTPUT_DIR, outputFilename)

    await sharp({
      create: { width: CANVAS_W, height: CANVAS_H, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } },
    })
      .composite(composites)
      .png({ compressionLevel: 6 })
      .toFile(outputPath)

    const gangsheetUrl = `uploads/gangsheets/${outputFilename}`

    await query(
      `UPDATE orders
       SET gangsheet_status = 'ready',
           gangsheet_url = $1,
           gangsheet_generated_at = NOW()
       WHERE id = $2`,
      [gangsheetUrl, orderId]
    )
  } catch (err) {
    await query(
      `UPDATE orders SET gangsheet_status = 'error' WHERE id = $1`,
      [orderId]
    ).catch(() => {})
  }
}

function _resolveFilePath(fileUrl) {
  if (!fileUrl) return null
  // Strip leading slash if present; resolve relative to process.cwd()
  const relative = fileUrl.replace(/^\//, '')
  return path.resolve(process.cwd(), relative)
}

/**
 * Returns the current gangsheet generation status for an order.
 */
async function getGangsheetStatus(orderId) {
  const { rows } = await query(
    `SELECT gangsheet_status, gangsheet_url, gangsheet_generated_at FROM orders WHERE id = $1`,
    [orderId]
  )
  if (!rows[0]) throw Object.assign(new Error('Order not found'), { statusCode: 404 })
  return {
    status:       rows[0].gangsheet_status ?? 'none',
    url:          rows[0].gangsheet_url ?? null,
    generatedAt:  rows[0].gangsheet_generated_at ?? null,
  }
}

module.exports = { generateGangsheet, getGangsheetStatus }
