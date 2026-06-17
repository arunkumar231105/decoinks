const { ZodError } = require('zod')
const logger = require('../utils/logger')

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  logger.error({ err, url: req.url, method: req.method }, 'Unhandled error')

  // Zod validation
  if (err instanceof ZodError) {
    return res.status(422).json({
      success: false,
      message: 'Validation failed',
      details: err.errors.map((e) => ({ field: e.path.join('.'), message: e.message })),
    })
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
    return res.status(401).json({ success: false, message: 'Invalid or expired token' })
  }

  // PostgreSQL unique constraint violation
  if (err.code === '23505') {
    return res.status(409).json({
      success: false,
      message: 'A record with this value already exists',
      detail: err.detail,
    })
  }

  // PostgreSQL foreign key violation
  if (err.code === '23503') {
    return res.status(409).json({
      success: false,
      message: 'Referenced record does not exist',
      detail: err.detail,
    })
  }

  // Multer file size
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ success: false, message: 'File too large' })
  }

  const statusCode = err.statusCode || err.status || 500
  // Always expose the message — it helps diagnose production issues and
  // app-level error messages are never sensitive (DB credentials are not in err.message).
  const message = err.message || 'Internal server error'

  const body = { success: false, message }
  if (process.env.NODE_ENV !== 'production') {
    body.stack = err.stack
  }
  // In production include pg error code if present (safe diagnostic info)
  if (err.code) body.code = err.code

  return res.status(statusCode).json(body)
}

module.exports = errorHandler
