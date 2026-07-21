const { query, getClient } = require('../../config/db')
const { getNextNumber } = require('../../utils/counter')
const { validateTransition } = require('../../utils/stateMachine')

const STAGES = ['initiated', 'quotation', 'artwork', 'gangsheet', 'payment', 'confirmed']
const STAGE_META = {
  initiated:  { title: 'Initiated',          color: '#0D9488' },
  quotation:  { title: 'Quotation Process',  color: '#2563EB' },
  artwork:    { title: 'Artwork Approval',   color: '#F59E0B' },
  gangsheet:  { title: 'Gangsheet Approval', color: '#8B5CF6' },
  payment:    { title: 'Payment Process',    color: '#D97706' },
  confirmed:  { title: 'Order Confirmation', color: '#16A34A' },
}

async function getKanban() {
  const { rows } = await query(
    `SELECT
       l.*,
       u.name AS agent_name,
       SUBSTRING(u.name FROM 1 FOR 1) || SUBSTRING(u.name FROM POSITION(' ' IN u.name) + 1 FOR 1) AS agent_initials
     FROM leads l
     LEFT JOIN users u ON u.id = l.assigned_to
     WHERE l.deleted_at IS NULL
     ORDER BY l.stage, l.stage_position, l.created_at DESC`
  )

  const columns = STAGES.map((stageId) => ({
    id: stageId,
    title: STAGE_META[stageId].title,
    color: STAGE_META[stageId].color,
    leads: rows
      .filter((r) => r.stage === stageId)
      .map(formatLead),
  }))

  return { columns }
}

const LEAD_SORT_COLUMNS = {
  created_at: 'l.created_at',
  qualification_score: 'l.conversion_score',
  estimated_value: 'l.estimated_value',
  last_activity: 'last_activity_at',
  lead_number: 'l.display_number',
}

function buildListWhere(filters) {
  const conditions = ['l.deleted_at IS NULL']
  const params = []
  const add = (value, sql) => {
    params.push(value)
    conditions.push(sql(params.length))
  }

  if (filters.search) {
    add(`%${filters.search}%`, n => `(l.display_number ILIKE $${n} OR l.lead_number ILIKE $${n} OR l.supplier_name ILIKE $${n} OR l.customer_name ILIKE $${n} OR l.company_name ILIKE $${n} OR l.email ILIKE $${n} OR l.phone ILIKE $${n})`)
  }
  if (filters.stage) add(filters.stage, n => `l.stage = $${n}`)
  if (filters.status) add(filters.status, n => `l.status = $${n}`)
  if (filters.assigned_to) add(filters.assigned_to, n => `l.assigned_to = $${n}`)
  if (filters.source) add(filters.source, n => `l.source = $${n}`)
  if (filters.purchase_intent) add(filters.purchase_intent, n => `l.customer_intent ILIKE $${n}`)
  if (filters.temperature) add(filters.temperature, n => `l.urgency ILIKE $${n}`)
  if (filters.product_interest) {
    add(`%${filters.product_interest}%`, n => `(l.product_interest ILIKE $${n} OR EXISTS (SELECT 1 FROM lead_product_interest lpi_f WHERE lpi_f.lead_id = l.id AND lpi_f.product_type ILIKE $${n}))`)
  }
  if (filters.qualification === 'qualified') conditions.push('COALESCE(l.conversion_score, 0) >= 60')
  if (filters.qualification === 'developing') conditions.push('COALESCE(l.conversion_score, 0) BETWEEN 30 AND 59')
  if (filters.qualification === 'unqualified') conditions.push('COALESCE(l.conversion_score, 0) < 30')
  if (filters.date_from) add(filters.date_from, n => `l.created_at >= $${n}::date`)
  if (filters.date_to) add(filters.date_to, n => `l.created_at < ($${n}::date + INTERVAL '1 day')`)
  if (filters.active_only === 'true' || filters.active_only === true) conditions.push("l.stage <> 'confirmed' AND l.status <> 'Confirmed'")

  return { where: `WHERE ${conditions.join(' AND ')}`, params }
}

async function list({
  page = 1, limit = 10, search = '', stage = '', status = '', assigned_to = '',
  source = '', qualification = '', purchase_intent = '', product_interest = '',
  temperature = '', date_from = '', date_to = '', sort_by = 'created_at', sort_dir = 'desc', active_only = '',
}) {
  page = Math.max(1, Number(page) || 1)
  limit = Math.min(10000, Math.max(1, Number(limit) || 10))
  const offset = (page - 1) * limit
  const { where, params } = buildListWhere({ search, stage, status, assigned_to, source, qualification, purchase_intent, product_interest, temperature, date_from, date_to, active_only })
  const countRes = await query(
    `SELECT COUNT(*) FROM leads l ${where}`, params
  )
  const total = parseInt(countRes.rows[0].count, 10)

  const dataParams = [...params, limit, offset]
  const orderColumn = LEAD_SORT_COLUMNS[sort_by] || LEAD_SORT_COLUMNS.created_at
  const orderDirection = String(sort_dir).toLowerCase() === 'asc' ? 'ASC' : 'DESC'
  const { rows } = await query(
    `SELECT l.*, u.name AS agent_name,
       COALESCE(NULLIF(l.customer_name, ''), NULLIF(l.supplier_name, ''), NULLIF(l.company_name, ''), l.email, 'Unknown lead') AS display_name,
       COALESCE(l.product_interest, pi.product_types) AS product_interest_display,
       COALESCE(activity.last_activity_at, l.last_contact_at, l.updated_at, l.created_at) AS last_activity_at,
       activity.last_activity_description,
       COALESCE(l.next_action, next_task.title) AS next_action_display,
       COALESCE(l.next_followup_date, next_task.due_at) AS next_action_at
     FROM leads l
     LEFT JOIN users u ON u.id = l.assigned_to
     LEFT JOIN LATERAL (
       SELECT STRING_AGG(DISTINCT lpi.product_type, ', ') AS product_types
       FROM lead_product_interest lpi WHERE lpi.lead_id = l.id
     ) pi ON TRUE
     LEFT JOIN LATERAL (
       SELECT al.created_at AS last_activity_at, al.description AS last_activity_description
       FROM activity_logs al
       WHERE al.entity_type = 'lead' AND al.entity_id = l.id
       ORDER BY al.created_at DESC LIMIT 1
     ) activity ON TRUE
     LEFT JOIN LATERAL (
       SELECT t.title, t.due_at
       FROM tasks t WHERE t.lead_id = l.id AND COALESCE(t.status, '') NOT IN ('completed', 'Completed', 'cancelled', 'Cancelled')
       ORDER BY t.due_at NULLS LAST, t.created_at DESC LIMIT 1
     ) next_task ON TRUE
     ${where}
     ORDER BY ${orderColumn} ${orderDirection} NULLS LAST, l.id DESC
     LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
    dataParams
  )
  return { rows, total }
}

async function getStats() {
  const [totals, trend] = await Promise.all([
    query(`SELECT
       COUNT(*)::INT AS total_inquiries,
       COUNT(*) FILTER (WHERE l.stage <> 'confirmed' AND l.status NOT IN ('Confirmed'))::INT AS active_leads,
       COUNT(*) FILTER (WHERE l.auto_responded)::INT AS auto_responded,
       COUNT(*) FILTER (WHERE l.message_count > 0 OR l.last_contact_at IS NOT NULL)::INT AS engaged,
       COUNT(*) FILTER (WHERE l.qualified_at IS NOT NULL OR COALESCE(l.conversion_score, 0) >= 60)::INT AS qualified,
       COUNT(*) FILTER (WHERE EXISTS (
         SELECT 1 FROM quotations q WHERE q.lead_id = l.id AND (q.sent_at IS NOT NULL OR q.status <> 'Draft')
       ))::INT AS quotes_sent,
       COUNT(*) FILTER (WHERE l.stage = 'confirmed')::INT AS ready_to_order,
       COUNT(*) FILTER (WHERE l.stage = 'payment')::INT AS payment_pending,
       COUNT(*) FILTER (WHERE EXISTS (
         SELECT 1 FROM quotations q JOIN orders o ON o.quotation_id = q.id AND o.deleted_at IS NULL WHERE q.lead_id = l.id
       ))::INT AS orders_created,
       COALESCE(SUM(l.estimated_value) FILTER (WHERE l.stage <> 'confirmed'), 0)::NUMERIC AS revenue_pipeline,
       COUNT(*) FILTER (WHERE l.created_at >= date_trunc('month', CURRENT_DATE))::INT AS leads_this_month,
       COUNT(*) FILTER (WHERE l.created_at >= date_trunc('month', CURRENT_DATE) - INTERVAL '1 month' AND l.created_at < date_trunc('month', CURRENT_DATE))::INT AS leads_last_month
     FROM leads l WHERE l.deleted_at IS NULL`),
    query(`WITH weeks AS (
       SELECT generate_series(date_trunc('week', CURRENT_DATE) - INTERVAL '7 weeks', date_trunc('week', CURRENT_DATE), INTERVAL '1 week') AS week
     ) SELECT TO_CHAR(w.week, 'YYYY-MM-DD') AS week, COUNT(l.id)::INT AS value
       FROM weeks w LEFT JOIN leads l ON l.deleted_at IS NULL AND l.created_at >= w.week AND l.created_at < w.week + INTERVAL '1 week'
       GROUP BY w.week ORDER BY w.week`),
  ])
  return { ...totals.rows[0], lead_trend: trend.rows.map(row => row.value) }
}

async function getFilterOptions() {
  const [sources, products, intents, temperatures, agents] = await Promise.all([
    query(`SELECT DISTINCT source::TEXT AS value FROM leads WHERE deleted_at IS NULL ORDER BY value`),
    query(`SELECT DISTINCT product_type AS value FROM lead_product_interest WHERE product_type IS NOT NULL UNION SELECT DISTINCT product_interest FROM leads WHERE product_interest IS NOT NULL ORDER BY value`),
    query(`SELECT DISTINCT customer_intent AS value FROM leads WHERE deleted_at IS NULL AND customer_intent IS NOT NULL ORDER BY value`),
    query(`SELECT DISTINCT urgency AS value FROM leads WHERE deleted_at IS NULL AND urgency IS NOT NULL ORDER BY value`),
    query(`SELECT id AS value, name AS label FROM users WHERE is_active = TRUE ORDER BY name`),
  ])
  return { sources: sources.rows, products: products.rows, intents: intents.rows, temperatures: temperatures.rows, agents: agents.rows }
}

async function getById(id) {
  const { rows } = await query(
    `SELECT l.*, u.name AS agent_name, u.role AS agent_role
     FROM leads l
     LEFT JOIN users u ON u.id = l.assigned_to
     WHERE l.id = $1 AND l.deleted_at IS NULL`,
    [id]
  )
  if (!rows[0]) throw Object.assign(new Error('Lead not found'), { statusCode: 404 })

  const [comments, attachments, activity, productInterest, qualification, tasks] = await Promise.all([
    query(`SELECT lc.*, u.name AS user_name FROM lead_comments lc LEFT JOIN users u ON u.id = lc.user_id WHERE lc.lead_id = $1 ORDER BY lc.created_at`, [id]),
    query(`SELECT la.*, u.name AS uploaded_by_name FROM lead_attachments la LEFT JOIN users u ON u.id = la.uploaded_by WHERE la.lead_id = $1 ORDER BY la.created_at`, [id]),
    query(`SELECT al.*, u.name AS user_name FROM activity_logs al LEFT JOIN users u ON u.id = al.user_id WHERE al.entity_type = 'lead' AND al.entity_id = $1 ORDER BY al.created_at DESC LIMIT 20`, [id]),
    query(`SELECT * FROM lead_product_interest WHERE lead_id = $1 ORDER BY sort_order, created_at`, [id]),
    query(`SELECT * FROM lead_qualifications WHERE lead_id = $1`, [id]),
    query(`SELECT * FROM tasks WHERE lead_id = $1 ORDER BY due_at NULLS LAST, created_at DESC`, [id]),
  ])

  return {
    ...rows[0],
    comments: comments.rows,
    attachments: attachments.rows,
    activity: activity.rows,
    productInterest: productInterest.rows,
    qualification: qualification.rows[0] || null,
    tasks: tasks.rows,
  }
}

async function insertProductInterest(client, leadId, items) {
  for (let i = 0; i < items.length; i++) {
    const pi = items[i]
    await client.query(
      `INSERT INTO lead_product_interest
         (lead_id, product_type, qty, sizes, colors, artwork_count, notes, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        leadId,
        pi.product_type  || null,
        pi.qty           ?? null,
        pi.sizes         || null,
        pi.colors        || null,
        pi.artwork_count ?? 0,
        pi.notes         || null,
        pi.sort_order    ?? i,
      ]
    )
  }
}

async function create({
  customer_name, supplier_id, source, description, assigned_to, created_by,
  company_name, email, phone, whatsapp,
  country, state, city, zip, shipping_address, billing_address,
  buyer_type, internal_notes,
  instagram_id, facebook_id, priority, source_campaign, next_followup_date, last_contact_at,
  conversion_score, estimated_value, urgency, customer_intent, next_action,
  auto_responded, auto_responded_at, qualified_at,
  qualification,
  productInterest = [],
}) {
  const lead_number = await getNextNumber('LEAD', 'leads', 'lead_number')

  const client = await getClient()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query(
      `INSERT INTO leads
         (lead_number, supplier_id, customer_name, source, description, assigned_to,
          company_name, email, phone, whatsapp,
          country, state, city, zip, shipping_address, billing_address,
          buyer_type, internal_notes, instagram_id, facebook_id, priority,
          source_campaign, next_followup_date, last_contact_at, conversion_score,
          estimated_value, urgency, customer_intent, next_action, auto_responded,
          auto_responded_at, qualified_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32)
       RETURNING *`,
      [
        lead_number, supplier_id || null, customer_name || null, source, description || null, assigned_to || null,
        company_name || null, email || null, phone || null, whatsapp || null,
        country || null, state || null, city || null, zip || null,
        shipping_address || null, billing_address || null,
        buyer_type || null, internal_notes || null, instagram_id || null, facebook_id || null,
        priority || 'medium', source_campaign || null, next_followup_date || null, last_contact_at || null,
        conversion_score ?? null, estimated_value ?? null, urgency || null,
        customer_intent || null, next_action || null, !!auto_responded,
        auto_responded_at || null, qualified_at || null,
      ]
    )
    const lead = rows[0]
    await insertProductInterest(client, lead.id, productInterest)
    if (qualification) {
      await upsertQualification(client, lead.id, qualification)
    }
    await client.query('COMMIT')
    await logActivity(created_by, 'lead', lead.id, 'created', `Lead ${lead_number} created`)
    return getById(lead.id)
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

async function update(id, fields, actorId) {
  const SCALAR_FIELDS = [
    'customer_name', 'supplier_id', 'source', 'description', 'assigned_to', 'status', 'has_artwork',
    'company_name', 'email', 'phone', 'whatsapp',
    'country', 'state', 'city', 'zip', 'shipping_address', 'billing_address',
    'buyer_type', 'internal_notes',
    'instagram_id', 'facebook_id', 'priority', 'source_campaign', 'next_followup_date', 'last_contact_at',
    'conversion_score', 'estimated_value', 'urgency', 'customer_intent', 'next_action',
    'auto_responded', 'auto_responded_at', 'qualified_at',
  ]
  const sets = []
  const params = []
  for (const key of SCALAR_FIELDS) {
    if (fields[key] !== undefined) {
      params.push(fields[key])
      sets.push(`${key} = $${params.length}`)
    }
  }
  const hasProductInterest = Array.isArray(fields.productInterest)
  const hasQualification = fields.qualification && typeof fields.qualification === 'object'
  if (!sets.length && !hasProductInterest && !hasQualification) {
    throw Object.assign(new Error('No fields to update'), { statusCode: 400 })
  }

  const client = await getClient()
  try {
    await client.query('BEGIN')

    if (sets.length) {
      params.push(id)
      const { rows } = await client.query(
        `UPDATE leads SET ${sets.join(', ')}, updated_at = NOW()
         WHERE id = $${params.length} AND deleted_at IS NULL RETURNING id`,
        params
      )
      if (!rows[0]) throw Object.assign(new Error('Lead not found'), { statusCode: 404 })
    } else {
      const { rows } = await client.query(
        `SELECT id FROM leads WHERE id = $1 AND deleted_at IS NULL`, [id]
      )
      if (!rows[0]) throw Object.assign(new Error('Lead not found'), { statusCode: 404 })
    }

    if (hasProductInterest) {
      await client.query(`DELETE FROM lead_product_interest WHERE lead_id = $1`, [id])
      await insertProductInterest(client, id, fields.productInterest)
    }
    if (hasQualification) await upsertQualification(client, id, fields.qualification)

    await client.query('COMMIT')

    if (fields.status !== undefined) {
      await logActivity(actorId, 'lead', id, 'status_changed', `Status changed to ${fields.status}`)
    }
    return getById(id)
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

async function upsertQualification(client, leadId, q) {
  await client.query(
    `INSERT INTO lead_qualifications
       (lead_id,sizes_received,artwork_received,delivery_date_confirmed,
        shipping_address_confirmed,budget_confirmed,payment_method_pref,info_completeness_score)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (lead_id) DO UPDATE SET
       sizes_received=EXCLUDED.sizes_received, artwork_received=EXCLUDED.artwork_received,
       delivery_date_confirmed=EXCLUDED.delivery_date_confirmed,
       shipping_address_confirmed=EXCLUDED.shipping_address_confirmed,
       budget_confirmed=EXCLUDED.budget_confirmed,
       payment_method_pref=EXCLUDED.payment_method_pref,
       info_completeness_score=EXCLUDED.info_completeness_score, updated_at=NOW()`,
    [leadId, !!q.sizes_received, !!q.artwork_received, !!q.delivery_date_confirmed,
     !!q.shipping_address_confirmed, !!q.budget_confirmed, q.payment_method_pref || null,
     q.info_completeness_score || 0]
  )
}

async function move(id, { stage, position = 0, user_id }) {
  const { rows } = await query(
    `UPDATE leads SET stage = $1, stage_position = $2, updated_at = NOW()
     WHERE id = $3 AND deleted_at IS NULL RETURNING *`,
    [stage, position, id]
  )
  if (!rows[0]) throw Object.assign(new Error('Lead not found'), { statusCode: 404 })
  await logActivity(user_id, 'lead', id, 'stage_changed', `Moved to ${STAGE_META[stage]?.title || stage}`)
  return rows[0]
}

async function remove(id) {
  const client = await getClient()
  try {
    await client.query('BEGIN')
    // Unlink quotations (no CASCADE on quotations.lead_id FK)
    await client.query(`UPDATE quotations SET lead_id = NULL WHERE lead_id = $1`, [id])
    // lead_comments, lead_attachments, lead_product_interest all ON DELETE CASCADE
    const { rows } = await client.query(
      `DELETE FROM leads WHERE id = $1 RETURNING id`, [id]
    )
    if (!rows[0]) throw Object.assign(new Error('Lead not found'), { statusCode: 404 })
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

async function getComments(leadId) {
  const { rows } = await query(
    `SELECT lc.*, u.name AS user_name, u.role AS user_role
     FROM lead_comments lc
     LEFT JOIN users u ON u.id = lc.user_id
     WHERE lc.lead_id = $1
     ORDER BY lc.created_at ASC`,
    [leadId]
  )
  return rows
}

async function addComment(leadId, userId, body) {
  const client = await getClient()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query(
      `INSERT INTO lead_comments (lead_id, user_id, body) VALUES ($1,$2,$3) RETURNING *`,
      [leadId, userId, body]
    )
    await client.query(
      `UPDATE leads SET comment_count = comment_count + 1, updated_at = NOW() WHERE id = $1`,
      [leadId]
    )
    await client.query('COMMIT')
    return rows[0]
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

async function deleteComment(leadId, commentId) {
  const client = await getClient()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query(
      `DELETE FROM lead_comments WHERE id = $1 AND lead_id = $2 RETURNING id`,
      [commentId, leadId]
    )
    if (!rows[0]) throw Object.assign(new Error('Comment not found'), { statusCode: 404 })
    await client.query(
      `UPDATE leads SET comment_count = GREATEST(0, comment_count - 1), updated_at = NOW() WHERE id = $1`,
      [leadId]
    )
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

async function addAttachment(leadId, userId, { filename, storage_path, mime_type, size_bytes }) {
  const client = await getClient()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query(
      `INSERT INTO lead_attachments (lead_id, uploaded_by, filename, storage_path, mime_type, size_bytes)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [leadId, userId, filename, storage_path, mime_type, size_bytes]
    )
    await client.query(
      `UPDATE leads SET attachment_count = attachment_count + 1, updated_at = NOW() WHERE id = $1`,
      [leadId]
    )
    await client.query('COMMIT')
    return rows[0]
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

async function deleteAttachment(leadId, attachmentId) {
  const client = await getClient()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query(
      `DELETE FROM lead_attachments WHERE id = $1 AND lead_id = $2 RETURNING *`,
      [attachmentId, leadId]
    )
    if (!rows[0]) throw Object.assign(new Error('Attachment not found'), { statusCode: 404 })
    await client.query(
      `UPDATE leads SET attachment_count = GREATEST(0, attachment_count - 1), updated_at = NOW() WHERE id = $1`,
      [leadId]
    )
    await client.query('COMMIT')
    return rows[0]
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

async function logActivity(userId, entityType, entityId, action, description) {
  try {
    await query(
      `INSERT INTO activity_logs (user_id, entity_type, entity_id, action, description)
       VALUES ($1,$2,$3,$4,$5)`,
      [userId || null, entityType, entityId, action, description]
    )
  } catch { /* non-fatal */ }
}

function formatLead(r) {
  return {
    id: r.id,
    leadId: r.lead_number,
    customerName: r.customer_name ?? r.supplier_name ?? null,
    supplierName: r.supplier_name,
    source: r.source,
    description: r.description,
    timestamp: formatTimestamp(r.created_at),
    status: r.status,
    agentName: r.agent_name || 'Unassigned',
    agentInitials: r.agent_initials || 'U',
    commentCount: r.comment_count || 0,
    attachmentCount: r.attachment_count || 0,
    hasArtwork: r.has_artwork || false,
    stage: r.stage,
    customer_id: r.customer_id ?? null,
  }
}

function formatTimestamp(date) {
  if (!date) return ''
  const diff = Date.now() - new Date(date).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}d ago`
  return new Date(date).toLocaleDateString()
}

async function convertToQuote(leadId, createdBy) {
  const lead = await getById(leadId)

  const quotationsSvc = require('../quotations/quotations.service')

  const items = (lead.productInterest || []).map((pi, i) => ({
    description:   pi.product_type || 'Item',
    qty:           pi.qty          || 1,
    unit_price:    0,
    sizes:         pi.sizes        || null,
    colors:        pi.colors       || null,
    artwork_count: pi.artwork_count ?? 0,
    sort_order:    pi.sort_order   ?? i,
  }))

  const quotation = await quotationsSvc.create({
    lead_id:                      leadId,
    supplier_id:                  lead.supplier_id            || null,
    order_type:                   null,
    discount_pct:                 0,
    tax_pct:                      0,
    notes:                        null,
    items,
    created_by:                   createdBy,
    company_name:                 lead.company_name           || null,
    customer_name:                lead.customer_name || lead.supplier_name || null,
    billing_email:                lead.email                  || null,
    contact_number:               lead.phone                  || null,
    whatsapp:                     lead.whatsapp               || null,
    wechat:                       lead.wechat                 || null,
    customer_category:            lead.buyer_type             || null,
    customer_source:              lead.source                 || null,
    shipping_country:             lead.country                || null,
    shipping_state:               lead.state                  || null,
    shipping_city:                lead.city                   || null,
    zip_code:                     lead.zip                    || null,
    shipping_address:             lead.shipping_address       || null,
    billing_address:              lead.billing_address        || null,
    due_date:                     lead.delivery_date          || null,
    sales_agent_id:               lead.assigned_to            || null,
    internal_notes:               lead.internal_notes         || null,
    customer_requirement_summary: lead.last_message           || null,
    quote_estimate:               null,
  })

  await query(
    `UPDATE leads SET status = 'Quotation Generated', updated_at = NOW() WHERE id = $1`,
    [leadId]
  )
  await logActivity(createdBy, 'lead', leadId, 'converted', `Lead converted to quotation ${quotation.quote_number}`)

  return quotation
}

async function updateStatus(id, status, actor) {
  const actorId   = typeof actor === 'string' ? actor : actor.id
  const actorUser = typeof actor === 'string' ? null   : actor

  const { rows: cur } = await query(
    `SELECT status FROM leads WHERE id = $1 AND deleted_at IS NULL`, [id]
  )
  if (!cur[0]) throw Object.assign(new Error('Lead not found'), { statusCode: 404 })
  if (actorUser) validateTransition('lead', cur[0].status, status, actorUser)

  const { rows } = await query(
    `UPDATE leads SET status=$1, updated_at=NOW() WHERE id=$2 AND deleted_at IS NULL RETURNING *`,
    [status, id]
  )
  if (!rows[0]) throw Object.assign(new Error('Lead not found'), { statusCode: 404 })
  await logActivity(actorId, 'lead', id, 'status_changed', `Status changed to ${status}`)
  return rows[0]
}

module.exports = {
  getKanban, list, getStats, getFilterOptions, getById, create, update, updateStatus, convertToQuote, move, remove,
  getComments, addComment, deleteComment, addAttachment, deleteAttachment,
}
