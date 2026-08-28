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

// Design Studio round-trip saves are print-resolution PNGs and routinely exceed
// the 10 MB upload ceiling, so they get their own, larger limit.
const studioMaxBytes = parseInt(process.env.STUDIO_MAX_FILE_SIZE_MB || '60', 10) * 1024 * 1024
const uploadStudioArtwork = multer({ storage: multer.memoryStorage(), fileFilter, limits: { fileSize: studioMaxBytes } }).single('file')

// Claim evidence is whatever proves the complaint: a photograph of the damage,
// the courier's PDF, a video of the box being opened. Larger, and wider than
// the artwork filter allows.
const claimMimes = [
  'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic',
  'application/pdf',
  'video/mp4', 'video/quicktime', 'video/webm',
]
const claimMaxBytes = parseInt(process.env.CLAIM_MAX_FILE_SIZE_MB || '20', 10) * 1024 * 1024
const uploadClaimFile = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: claimMaxBytes },
  fileFilter: (_req, file, cb) => claimMimes.includes(file.mimetype)
    ? cb(null, true)
    : cb(new Error(`${file.mimetype} is not accepted. Use an image, a PDF or a video.`), false),
}).single('file')

module.exports = { uploadArtwork, uploadAttachment, uploadStudioArtwork, uploadClaimFile }
