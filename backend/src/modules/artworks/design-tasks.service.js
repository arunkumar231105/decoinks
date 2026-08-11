const { query } = require('../../config/db')

const TASK_FIELDS = `
  dt.id, dt.task_no, dt.artwork_id, dt.assigned_to, dt.task_stage, dt.task_status,
  dt.priority, dt.current_artwork_version_id, dt.due_at, dt.started_at,
  dt.completed_at, dt.notes, dt.created_by, dt.created_at, dt.updated_at,
  a.artwork_no, a.name AS artwork_name,
  u.name AS assigned_to_name,
  av.version_no AS current_version_no
`

function notFound(message) {
  return Object.assign(new Error(message), { statusCode: 404 })
}

async function list({ status = '', stage = '', artwork_id = '', assigned_to = '' } = {}) {
  const conditions = []
  const params = []
  const add = (value, clause) => {
    if (value) { params.push(value); conditions.push(clause(params.length)) }
  }
  add(status, n => `dt.task_status = $${n}`)
  add(stage, n => `dt.task_stage = $${n}`)
  add(artwork_id, n => `dt.artwork_id = $${n}`)
  add(assigned_to, n => `dt.assigned_to = $${n}`)
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  const { rows } = await query(
    `SELECT ${TASK_FIELDS}
       FROM design_tasks dt
       JOIN artworks a ON a.id = dt.artwork_id
       LEFT JOIN users u ON u.id = dt.assigned_to
       LEFT JOIN artwork_versions av ON av.id = dt.current_artwork_version_id
       ${where}
      ORDER BY dt.created_at DESC`,
    params,
  )
  return rows
}

async function getById(id) {
  const { rows } = await query(
    `SELECT ${TASK_FIELDS}
       FROM design_tasks dt
       JOIN artworks a ON a.id = dt.artwork_id
       LEFT JOIN users u ON u.id = dt.assigned_to
       LEFT JOIN artwork_versions av ON av.id = dt.current_artwork_version_id
      WHERE dt.id = $1`,
    [id],
  )
  if (!rows[0]) throw notFound('Design task not found')
  return rows[0]
}

async function create({ artwork_id, assigned_to = null, task_stage = 'Design', task_status = 'Open', priority = 'Normal', current_artwork_version_id = null, due_at = null, notes = null, created_by = null }) {
  const { rows } = await query(
    `INSERT INTO design_tasks
      (task_no, artwork_id, assigned_to, task_stage, task_status, priority,
       current_artwork_version_id, due_at, notes, created_by)
     VALUES ('DST-' || LPAD(nextval('design_task_no_seq')::text, 6, '0'), $1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING id`,
    [artwork_id, assigned_to, task_stage, task_status, priority, current_artwork_version_id, due_at, notes, created_by],
  )
  return getById(rows[0].id)
}

async function update(id, fields = {}) {
  const allowed = ['assigned_to', 'task_stage', 'task_status', 'priority', 'current_artwork_version_id', 'due_at', 'started_at', 'completed_at', 'notes']
  const entries = allowed.filter(key => Object.prototype.hasOwnProperty.call(fields, key))
  if (!entries.length) return getById(id)
  const params = []
  const sets = entries.map((key) => {
    params.push(fields[key])
    return `${key} = $${params.length}`
  })
  params.push(id)
  const result = await query(
    `UPDATE design_tasks SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${params.length} RETURNING id`,
    params,
  )
  if (!result.rows[0]) throw notFound('Design task not found')
  return getById(result.rows[0].id)
}

module.exports = { list, getById, create, update }
