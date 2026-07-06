const bcrypt   = require('bcryptjs')
const jwt      = require('jsonwebtoken')
const crypto   = require('crypto')
const { query, getClient } = require('../../config/db')

const ACCESS_EXPIRES   = process.env.JWT_ACCESS_EXPIRES_IN || '8h'
const REFRESH_EXPIRES_MS = 30 * 24 * 60 * 60 * 1000  // 30 days
const COOKIE_NAME      = 'decoinks_rt'

// ── Helpers ───────────────────────────────────────────────────────────────────

function hashToken(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex')
}

function generateRefreshToken() {
  return crypto.randomBytes(64).toString('hex')
}

function signAccessToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: ACCESS_EXPIRES }
  )
}

async function storeRefreshToken(client, userId, rawToken, ip, userAgent) {
  const expiresAt = new Date(Date.now() + REFRESH_EXPIRES_MS)
  await client.query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, hashToken(rawToken), expiresAt, ip || null, userAgent || null]
  )
}

// ── Login ─────────────────────────────────────────────────────────────────────

async function login(email, password, ip, userAgent) {
  const { rows } = await query(
    `SELECT id, name, email, password, role, is_active, avatar_url
     FROM users WHERE email = $1 LIMIT 1`,
    [email.toLowerCase().trim()]
  )
  const user = rows[0]
  if (!user)         throw Object.assign(new Error('Invalid email or password'), { statusCode: 401 })
  if (!user.is_active) throw Object.assign(new Error('Account is deactivated'),   { statusCode: 403 })

  const valid = await bcrypt.compare(password, user.password)
  if (!valid) throw Object.assign(new Error('Invalid email or password'), { statusCode: 401 })

  const accessToken  = signAccessToken(user)
  const refreshToken = generateRefreshToken()

  const client = await getClient()
  try {
    await client.query('BEGIN')
    await storeRefreshToken(client, user.id, refreshToken, ip, userAgent)
    await client.query(`UPDATE users SET last_login = NOW() WHERE id = $1`, [user.id])
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }

  return {
    accessToken,
    refreshToken,
    user: { id: user.id, name: user.name, email: user.email, role: user.role, avatar_url: user.avatar_url },
  }
}

// ── Refresh (with rotation) ───────────────────────────────────────────────────

async function refresh(rawToken, ip, userAgent) {
  if (!rawToken) {
    throw Object.assign(new Error('No refresh token provided'), { statusCode: 401 })
  }

  const hash = hashToken(rawToken)
  const { rows } = await query(
    `SELECT rt.id, rt.user_id, rt.expires_at, rt.revoked_at,
            u.id AS uid, u.name, u.email, u.role, u.is_active, u.avatar_url, u.phone
     FROM refresh_tokens rt
     JOIN users u ON u.id = rt.user_id
     WHERE rt.token_hash = $1
     LIMIT 1`,
    [hash]
  )
  const record = rows[0]

  if (!record)            throw Object.assign(new Error('Invalid refresh token'),          { statusCode: 401 })
  if (record.revoked_at)  throw Object.assign(new Error('Refresh token has been revoked'), { statusCode: 401 })
  if (new Date(record.expires_at) < new Date()) {
    throw Object.assign(new Error('Refresh token expired'), { statusCode: 401 })
  }
  if (!record.is_active)  throw Object.assign(new Error('Account is deactivated'),        { statusCode: 403 })

  const newAccessToken = signAccessToken({ id: record.uid, email: record.email, role: record.role })

  // No rotation — reuse the same refresh token so multiple tabs can refresh
  // simultaneously without revoking each other's tokens.
  // Token is only invalidated on explicit logout or expiry.
  // Return the user too so the client can skip a separate /auth/me round-trip.
  const user = {
    id: record.uid, name: record.name, email: record.email,
    role: record.role, avatar_url: record.avatar_url, phone: record.phone,
    is_active: record.is_active,
  }
  return { accessToken: newAccessToken, refreshToken: rawToken, user }
}

// ── Logout (single device) ────────────────────────────────────────────────────

async function logout(rawToken) {
  if (!rawToken) return  // cookie absent — no-op
  await query(
    `UPDATE refresh_tokens SET revoked_at = NOW()
     WHERE token_hash = $1 AND revoked_at IS NULL`,
    [hashToken(rawToken)]
  ).catch(() => {})  // never let logout throw
}

// ── Logout everywhere (all devices) ──────────────────────────────────────────

async function revokeAll(userId) {
  await query(
    `UPDATE refresh_tokens SET revoked_at = NOW()
     WHERE user_id = $1 AND revoked_at IS NULL`,
    [userId]
  )
  await query(
    `INSERT INTO activity_logs (user_id, entity_type, entity_id, action, description)
     VALUES ($1, 'user', $1, 'revoke_all_tokens', 'All refresh tokens revoked (logout everywhere)')`,
    [userId]
  ).catch(() => {})
}

// ── Misc ──────────────────────────────────────────────────────────────────────

async function getMe(userId) {
  const { rows } = await query(
    `SELECT id, name, email, role, avatar_url, phone, is_active, last_login, created_at
     FROM users WHERE id = $1`,
    [userId]
  )
  if (!rows[0]) throw Object.assign(new Error('User not found'), { statusCode: 404 })
  return rows[0]
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
  const accessToken  = signAccessToken(user)
  const refreshToken = generateRefreshToken()
  const client = await getClient()
  try {
    await client.query('BEGIN')
    await storeRefreshToken(client, user.id, refreshToken, null, null)
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
  return { accessToken, refreshToken, user }
}

async function changePassword(userId, currentPassword, newPassword) {
  const { rows } = await query(`SELECT id, password FROM users WHERE id = $1`, [userId])
  const user = rows[0]
  if (!user) throw Object.assign(new Error('User not found'), { statusCode: 404 })
  const valid = await bcrypt.compare(currentPassword, user.password)
  if (!valid) throw Object.assign(new Error('Current password is incorrect'), { statusCode: 401 })
  const hashed = await bcrypt.hash(newPassword, 10)
  await query(`UPDATE users SET password = $1, updated_at = NOW() WHERE id = $2`, [hashed, userId])
}

module.exports = {
  COOKIE_NAME,
  login, refresh, logout, revokeAll,
  getMe, setupStatus, setup, changePassword,
}
