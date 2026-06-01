const jwt = require('jsonwebtoken')
const { error } = require('../utils/response')

function verifyToken(req, res, next) {
  const authHeader = req.headers.authorization
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return error(res, 'No token provided', 401)
  }

  const token = authHeader.split(' ')[1]
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET)
    req.user = { id: decoded.id, email: decoded.email, role: decoded.role }
    next()
  } catch (err) {
    if (err.name === 'TokenExpiredError') return error(res, 'Token expired', 401)
    return error(res, 'Invalid token', 401)
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return error(res, 'Unauthorized', 401)
    if (!roles.includes(req.user.role)) {
      return error(res, 'Insufficient permissions', 403)
    }
    next()
  }
}

function requireSupplier(req, res, next) {
  if (req.user?.role !== 'supplier') {
    return res.status(403).json({ error: 'Supplier access only' })
  }
  next()
}

module.exports = { verifyToken, requireRole, requireSupplier }
