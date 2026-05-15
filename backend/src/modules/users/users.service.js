const bcrypt = require('bcryptjs')
const { query, getClient } = require('../../config/db')

const SAFE_FIELDS = 'id, name, email, role, phone, avatar_url, is_active, last_login, created_at, updated_at'

async function list({ page = 1, limit = 10, search = '' }) {
  const offset = (page - 1) * limit
  const params = []
  let where = 'WHERE 1=1'

  if (search) {
    params.push(`%${search}%`)
    where += ` AND (name ILIKE $${params.length} OR email ILIKE $${params.length})`
  }

  const countRes = await query(`SELECT COUNT(*) FROM users ${where}`, params)
  const total = parseInt(countRes.rows[0].count, 10)

  params.push(limit, offset)
  const { rows } = await query(
    `SELECT ${SAFE_FIELDS} FROM users ${where}
     ORDER BY created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  )
  return { rows, total }
}

async function getById(id) {
  const { rows } = await query(
    `SELECT ${SAFE_FIELDS} FROM users WHERE id = $1`,
    [id]
  )
  if (!rows[0]) throw Object.assign(new Error('User not found'), { statusCode: 404 })
  return rows[0]
}

async function create({ name, email, password, role, phone }, actorId) {
  const hash = await bcrypt.hash(password, 10)
  const client = await getClient()
  try {
    await client.query('BEGIN')

    const { rows } = await client.query(
      `INSERT INTO users (name, email, password, role, phone)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING ${SAFE_FIELDS}`,
      [name, email.toLowerCase().trim(), hash, role, phone || null]
    )
    const user = rows[0]

    await client.query(
      `INSERT INTO activity_logs (user_id, entity_type, entity_id, action, description)
       VALUES ($1, 'user', $2, 'created', $3)`,
      [actorId, user.id, `Created user ${user.name} (${user.email}) with role ${user.role}`]
    )

    await client.query('COMMIT')
    return user
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

async function update(id, { name, role, phone, avatar_url, is_active }, actorId) {
  const client = await getClient()
  try {
    await client.query('BEGIN')

    const { rows } = await client.query(
      `UPDATE users
       SET name       = COALESCE($1, name),
           role       = COALESCE($2, role),
           phone      = COALESCE($3, phone),
           avatar_url = COALESCE($4, avatar_url),
           is_active  = COALESCE($5, is_active),
           updated_at = NOW()
       WHERE id = $6
       RETURNING ${SAFE_FIELDS}`,
      [name, role, phone, avatar_url, is_active, id]
    )
    if (!rows[0]) throw Object.assign(new Error('User not found'), { statusCode: 404 })
    const user = rows[0]

    await client.query(
      `INSERT INTO activity_logs (user_id, entity_type, entity_id, action, description)
       VALUES ($1, 'user', $2, 'updated', $3)`,
      [actorId, user.id, `Updated user ${user.name} (${user.email})`]
    )

    await client.query('COMMIT')
    return user
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

async function deactivate(id) {
  const { rows } = await query(
    `UPDATE users SET is_active = FALSE, updated_at = NOW()
     WHERE id = $1 RETURNING id`,
    [id]
  )
  if (!rows[0]) throw Object.assign(new Error('User not found'), { statusCode: 404 })
}

async function resetPassword(id, newPassword) {
  const hash = await bcrypt.hash(newPassword, 10)
  const { rows } = await query(
    `UPDATE users SET password = $1, updated_at = NOW() WHERE id = $2 RETURNING id`,
    [hash, id]
  )
  if (!rows[0]) throw Object.assign(new Error('User not found'), { statusCode: 404 })
}

module.exports = { list, getById, create, update, deactivate, resetPassword }
