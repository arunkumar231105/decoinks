'use strict'

const { query } = require('../../config/db')

async function list({ entity_type } = {}) {
  const params = []
  let where = 'WHERE is_active = true'
  if (entity_type) {
    params.push(entity_type)
    where += ` AND entity_type = $${params.length}`
  }
  const { rows } = await query(
    `SELECT * FROM custom_fields ${where} ORDER BY entity_type, display_order, field_label`,
    params
  )
  return rows
}

async function getById(id) {
  const { rows } = await query(`SELECT * FROM custom_fields WHERE id = $1`, [id])
  if (!rows[0]) throw Object.assign(new Error('Custom field not found'), { statusCode: 404 })
  return rows[0]
}

async function create({ entity_type, field_key, field_label, field_type, is_required, default_value, options, display_order }) {
  const { rows } = await query(
    `INSERT INTO custom_fields
       (entity_type, field_key, field_label, field_type, is_required, default_value, options, display_order)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      entity_type,
      field_key,
      field_label.trim(),
      field_type,
      is_required ?? false,
      default_value ?? null,
      options ? JSON.stringify(options) : null,
      display_order ?? 0,
    ]
  )
  return rows[0]
}

async function update(id, { field_label, field_type, is_required, default_value, options, display_order, is_active }) {
  await getById(id)  // 404 if not found

  const sets = []
  const params = []

  const add = (col, val) => { params.push(val); sets.push(`${col} = $${params.length}`) }

  if (field_label    !== undefined) add('field_label',    field_label.trim())
  if (field_type     !== undefined) add('field_type',     field_type)
  if (is_required    !== undefined) add('is_required',    is_required)
  if (default_value  !== undefined) add('default_value',  default_value ?? null)
  if (options        !== undefined) add('options',        options ? JSON.stringify(options) : null)
  if (display_order  !== undefined) add('display_order',  display_order)
  if (is_active      !== undefined) add('is_active',      is_active)

  if (!sets.length) throw Object.assign(new Error('No fields to update'), { statusCode: 400 })

  sets.push('updated_at = NOW()')
  params.push(id)

  const { rows } = await query(
    `UPDATE custom_fields SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
    params
  )
  return rows[0]
}

async function remove(id) {
  const { rows } = await query(
    `UPDATE custom_fields SET is_active = false, updated_at = NOW() WHERE id = $1 RETURNING id`,
    [id]
  )
  if (!rows[0]) throw Object.assign(new Error('Custom field not found'), { statusCode: 404 })
}

// ── Custom field value storage ─────────────────────────────────────────────────

/**
 * Returns all custom field values for a given entity instance.
 * Result shape: { [fieldKey]: value }
 */
async function getValues(entityType, entityId) {
  const { rows } = await query(
    `SELECT cf.field_key, cfv.value
     FROM custom_field_values cfv
     JOIN custom_fields cf ON cf.id = cfv.field_id
     WHERE cfv.entity_type = $1 AND cfv.entity_id = $2`,
    [entityType, entityId]
  )
  return Object.fromEntries(rows.map(r => [r.field_key, r.value]))
}

/**
 * Upserts custom field values for a given entity instance.
 * Validates that select/multiselect values are within the allowed options.
 * @param {string} entityType
 * @param {string} entityId
 * @param {Record<string,string>} data  — { [fieldKey]: value }
 */
async function setValues(entityType, entityId, data) {
  const fieldKeys = Object.keys(data)
  if (!fieldKeys.length) return {}

  // Load field definitions for this entity
  const { rows: fields } = await query(
    `SELECT id, field_key, field_type, options, is_required
     FROM custom_fields
     WHERE entity_type = $1 AND field_key = ANY($2) AND is_active = TRUE`,
    [entityType, fieldKeys]
  )

  const unknownKeys = fieldKeys.filter(k => !fields.find(f => f.field_key === k))
  if (unknownKeys.length) {
    const err = new Error(`Unknown custom field key(s): ${unknownKeys.join(', ')}`)
    err.statusCode = 422
    throw err
  }

  // Validate select / multiselect values
  const SELECT_TYPES = new Set(['select', 'multiselect'])
  for (const field of fields) {
    const value = data[field.field_key]
    if (value == null || value === '') continue

    if (SELECT_TYPES.has(field.field_type)) {
      const opts = Array.isArray(field.options)
        ? field.options
        : (typeof field.options === 'string' ? JSON.parse(field.options) : [])

      if (!opts.includes(value)) {
        const err = new Error(
          `'${value}' is not a valid option for field '${field.field_key}'. Allowed: ${opts.join(', ')}`
        )
        err.statusCode = 422
        throw err
      }
    }
  }

  // Upsert each value
  for (const field of fields) {
    const value = data[field.field_key]
    await query(
      `INSERT INTO custom_field_values (entity_type, entity_id, field_id, value, updated_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (entity_type, entity_id, field_id)
       DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [entityType, entityId, field.id, value ?? null]
    )
  }

  return getValues(entityType, entityId)
}

module.exports = { list, getById, create, update, remove, getValues, setValues }
