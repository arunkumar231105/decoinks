const { Router } = require('express')
const { verifyToken } = require('../../middleware/auth')
const { uploadArtwork } = require('../../middleware/upload')
const { uploadFile } = require('../../config/storage')

const router = Router()
router.use(verifyToken)

// POST /api/upload/image  — generic image upload, returns { url }
router.post('/image', (req, res) => {
  uploadArtwork(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message })
    if (!req.file) return res.status(400).json({ error: 'No file provided' })
    try {
      const url = await uploadFile(req.file.buffer, req.file.originalname, req.file.mimetype, 'item-images')
      res.json({ url })
    } catch (e) {
      res.status(500).json({ error: e.message })
    }
  })
})

module.exports = router
