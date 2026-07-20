const { Router } = require('express')
const { verifyToken } = require('../../middleware/auth')
const { uploadArtwork } = require('../../middleware/upload')
const { uploadFile } = require('../../config/storage')
const sharp = require('sharp')

const router = Router()
router.use(verifyToken)

const DEFAULT_PRINT_DPI = 300

function formatInches(value) {
  return Number(value.toFixed(2)).toString()
}

async function readArtworkDimensions(buffer) {
  try {
    const metadata = await sharp(buffer).metadata()
    if (!metadata.width || !metadata.height) return null

    const embeddedDpi = Number(metadata.density)
    const dpi = Number.isFinite(embeddedDpi) && embeddedDpi > 0 ? embeddedDpi : DEFAULT_PRINT_DPI
    const widthInches = metadata.width / dpi
    const heightInches = metadata.height / dpi

    return {
      width_px: metadata.width,
      height_px: metadata.height,
      dpi,
      dpi_source: embeddedDpi > 0 ? 'embedded' : 'default_300',
      width_inches: Number(widthInches.toFixed(2)),
      height_inches: Number(heightInches.toFixed(2)),
      artwork_size: `${formatInches(widthInches)} x ${formatInches(heightInches)} in`,
    }
  } catch {
    return null
  }
}

// POST /api/upload/image  — generic image upload, returns { url }
router.post('/image', (req, res) => {
  uploadArtwork(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message })
    if (!req.file) return res.status(400).json({ error: 'No file provided' })
    try {
      const dimensions = await readArtworkDimensions(req.file.buffer)
      const url = await uploadFile(req.file.buffer, req.file.originalname, req.file.mimetype, 'item-images')
      res.json({ url, dimensions })
    } catch (e) {
      res.status(500).json({ error: e.message })
    }
  })
})

module.exports = router
