const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const { query } = require('../../config/db')

async function login(email, password) {
  const { rows } = await query(
    `SELECT id, name, email, password, role, is_active, avatar_url
     FROM users
     WHERE email = $1
     LIMIT 1`,
    [email.toLowerCase().trim()]
  )

  const user = rows[0]
  if (!user) throw Object.assign(new Error('Invalid email or password'), { statusCode: 401 })
  if (!user.is_active) throw Object.assign(new Error('Account is deactivated'), { statusCode: 403 })

  const valid = await bcrypt.compare(password, user.password)
  if (!valid) throw Object.assign(new Error('Invalid email or password'), { statusCode: 401 })

  const token = jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  )

  await query('UPDATE users SET last_login = NOW() WHERE id = $1', [user.id])

  return {
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      avatar_url: user.avatar_url,
    },
  }
}

async function getMe(userId) {
  const { rows } = await query(
    `SELECT id, name, email, role, avatar_url, phone, is_active, last_login, created_at
     FROM users
     WHERE id = $1`,
    [userId]
  )
  if (!rows[0]) throw Object.assign(new Error('User not found'), { statusCode: 404 })
  return rows[0]
}

async function refresh(token) {
  let decoded
  try {
    // Allow expired tokens — we re-validate against the DB before re-issuing
    decoded = jwt.verify(token, process.env.JWT_SECRET, { ignoreExpiration: true })
  } catch {
    throw Object.assign(new Error('Invalid token'), { statusCode: 401 })
  }

  const { rows } = await query(
    `SELECT id, name, email, role, is_active FROM users WHERE id = $1 LIMIT 1`,
    [decoded.id]
  )
  const user = rows[0]
  if (!user) throw Object.assign(new Error('User not found'), { statusCode: 401 })
  if (!user.is_active) throw Object.assign(new Error('Account is deactivated'), { statusCode: 403 })

  const newToken = jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  )

  return { token: newToken }
}

async function setupStatus() {
  const { rows } = await query(`SELECT COUNT(*) FROM users`)
  return { needed: parseInt(rows[0].count, 10) === 0 }
}

async function setup({ name, email, password }) {
  const { rows } = await query(`SELECT COUNT(*) FROM users`)
  if (parseInt(rows[0].count, 10) > 0) {
    throw Object.assign(new Error('Setup already complete. Use login instead.'), { statusCode: 409 })
  }

  const hash = await bcrypt.hash(password, 10)
  const result = await query(
    `INSERT INTO users (name, email, password, role)
     VALUES ($1, $2, $3, 'Admin')
     RETURNING id, name, email, role`,
    [name.trim(), email.toLowerCase().trim(), hash]
  )
  const user = result.rows[0]

  const token = jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  )

  return { token, user }
}

async function changePassword(userId, currentPassword, newPassword) {
  const { rows } = await query(
    `SELECT id, password FROM users WHERE id = $1`,
    [userId]
  )
  const user = rows[0]
  if (!user) throw Object.assign(new Error('User not found'), { statusCode: 404 })

  const valid = await bcrypt.compare(currentPassword, user.password)
  if (!valid) throw Object.assign(new Error('Current password is incorrect'), { statusCode: 401 })

  const hash = await bcrypt.hash(newPassword, 10)
  await query(`UPDATE users SET password = $1, updated_at = NOW() WHERE id = $2`, [hash, userId])
}

module.exports = { login, refresh, getMe, setupStatus, setup, changePassword }
