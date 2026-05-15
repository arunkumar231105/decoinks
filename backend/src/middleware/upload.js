const multer = require('multer')
const path = require('path')
const { v4: uuidv4 } = require('uuid')
const fs = require('fs')

function getStorage(subfolder) {
  const uploadDir = path.join(process.env.UPLOAD_DIR || 'uploads', subfolder)
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true })
  }

  return multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase()
      cb(null, `${uuidv4()}${ext}`)
    },
  })
}

const allowedMimes = (process.env.ALLOWED_MIME_TYPES || 'image/jpeg,image/png,image/webp,image/svg+xml,application/pdf').split(',')
const maxSizeBytes = (parseInt(process.env.MAX_FILE_SIZE_MB || '10', 10)) * 1024 * 1024

function fileFilter(_req, file, cb) {
  if (allowedMimes.includes(file.mimetype)) {
    cb(null, true)
  } else {
    cb(new Error(`File type ${file.mimetype} not allowed`), false)
  }
}

const uploadArtwork = multer({
  storage: getStorage('artworks'),
  fileFilter,
  limits: { fileSize: maxSizeBytes },
}).single('file')

const uploadAttachment = multer({
  storage: getStorage('attachments'),
  fileFilter,
  limits: { fileSize: maxSizeBytes },
}).single('file')

module.exports = { uploadArtwork, uploadAttachment }
