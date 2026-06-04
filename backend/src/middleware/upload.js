const multer = require('multer')

const allowedMimes = (process.env.ALLOWED_MIME_TYPES || 'image/jpeg,image/png,image/webp,image/svg+xml,application/pdf').split(',')
const maxSizeBytes = parseInt(process.env.MAX_FILE_SIZE_MB || '10', 10) * 1024 * 1024

function fileFilter(_req, file, cb) {
  if (allowedMimes.includes(file.mimetype)) cb(null, true)
  else cb(new Error(`File type ${file.mimetype} not allowed`), false)
}

// Memory storage — file.buffer available in route handler, uploaded to MinIO there
const opts = { storage: multer.memoryStorage(), fileFilter, limits: { fileSize: maxSizeBytes } }

const uploadArtwork    = multer(opts).single('file')
const uploadAttachment = multer(opts).single('file')

module.exports = { uploadArtwork, uploadAttachment }
