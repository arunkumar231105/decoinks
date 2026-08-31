const { Router } = require('express')
const { verifyToken } = require('../../middleware/auth')
const { uploadArtwork, uploadClaimFile } = require('../../middleware/upload')
const { uploadFile } = require('../../config/storage')
const { readArtworkDimensions } = require('../../utils/artworkDimensions')

const router = Router()
router.use(verifyToken)

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


// POST /api/upload/claim-file — evidence for a claim. Not put through sharp:
// a PDF or a video has no dimensions to read, and re-encoding a photograph of
// damage would be the wrong thing to do to it.
router.post('/claim-file', (req, res) => {
  uploadClaimFile(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message })
    if (!req.file) return res.status(400).json({ error: 'No file provided' })
    try {
      const url = await uploadFile(req.file.buffer, req.file.originalname, req.file.mimetype, 'claim-evidence')
      const kind = req.file.mimetype.startsWith('image/') ? 'image'
                 : req.file.mimetype.startsWith('video/') ? 'video' : 'document'
      res.json({
        url,
        file_name: req.file.originalname,
        file_type: kind,
        mime_type: req.file.mimetype,
        file_size: req.file.size,
      })
    } catch (e) {
      res.status(500).json({ error: e.message })
    }
  })
})

module.exports = router
