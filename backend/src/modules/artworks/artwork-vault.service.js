const { query, getClient } = require('../../config/db')
const nextcloud = require('../nextcloud/nextcloud.service')
const { getConfig } = require('../../config/nextcloud')

let syncPromise = null
let lastSyncAt = 0

function inferType(path) {
  const parts = String(path).toLowerCase().split('/').filter(Boolean)
  const text = parts.join(' ')
  if (/\bgang[ -]?sheets?\b/.test(text)) return 'gangsheet'
  if (/\bmock[ -]?ups?\b/.test(text)) return 'mockup'
  if (parts.some(part => /^versions?$/.test(part))) return 'version'
  if (/\breferences?\b|\brefs?\b/.test(text)) return 'reference'
  return 'artwork'
}

function inferOrderType(path) {
  const text = String(path).toLowerCase()
  if (/gang[ _-]?sheets?/.test(text)) return 'gangsheet'
  if (/(^|[/ _-])(dtf|transfers?)([/ _-]|$)/.test(text)) return 'dtf'
  if (/apparel|custom[ _-]?(shirts?|hoodies?)|t[ _-]?shirts?/.test(text)) return 'apparel'
  return null
}

function inferVersion(name) {
  const match = String(name).match(/(?:^|[^a-z0-9])v(?:ersion)?[ _-]?(\d+)(?:[^0-9]|$)/i)
  return match ? Math.max(1, Number(match[1])) : 1
}

async function sync({ force = false } = {}) {
  const cfg = getConfig()
  if (!cfg.configured) return { configured: false, synced: 0, total: 0 }
  if (!force && Date.now() - lastSyncAt < 300000) return { configured: true, cached: true }
  if (syncPromise) return syncPromise

  syncPromise = (async () => {
    const files = await nextcloud.scanWatched(8)
    const client = await getClient()
    try {
      await client.query('BEGIN')
      const indexed = files.filter(file => file.path && file.name).map(file => ({
        path: file.path,
        parent_path: file.path.split('/').slice(0, -1).join('/'),
        file_name: file.name,
        mime_type: file.mime_type || null,
        file_size_bytes: file.size || 0,
        etag: file.etag || null,
        file_id: file.fileid || null,
        asset_type: inferType(file.path),
        order_type: inferOrderType(file.path),
        version_no: inferVersion(file.name),
        modified_at: file.modified || null,
      }))
      for (let start = 0; start < indexed.length; start += 500) {
        const chunk = indexed.slice(start, start + 500)
        await client.query(`INSERT INTO artwork_vault_assets
          (source,source_key,path,parent_path,file_name,mime_type,file_size_bytes,etag,nextcloud_file_id,
           asset_type,order_type,version_no,is_cover,source_modified_at,last_seen_at,updated_at)
          SELECT 'nextcloud',x.path,x.path,x.parent_path,x.file_name,x.mime_type,x.file_size_bytes,x.etag,x.file_id,
                 x.asset_type,x.order_type,x.version_no,FALSE,x.modified_at,NOW(),NOW()
          FROM jsonb_to_recordset($1::jsonb) AS x(path text,parent_path text,file_name text,mime_type text,
            file_size_bytes bigint,etag text,file_id text,asset_type text,order_type text,version_no int,modified_at timestamptz)
          ON CONFLICT (source,source_key) DO UPDATE SET
            path=EXCLUDED.path,parent_path=EXCLUDED.parent_path,file_name=EXCLUDED.file_name,
            mime_type=EXCLUDED.mime_type,file_size_bytes=EXCLUDED.file_size_bytes,etag=EXCLUDED.etag,
            nextcloud_file_id=EXCLUDED.nextcloud_file_id,asset_type=EXCLUDED.asset_type,order_type=EXCLUDED.order_type,
            version_no=EXCLUDED.version_no,source_modified_at=EXCLUDED.source_modified_at,last_seen_at=NOW(),
            updated_at=CASE WHEN artwork_vault_assets.etag IS DISTINCT FROM EXCLUDED.etag THEN NOW() ELSE artwork_vault_assets.updated_at END`,
          [JSON.stringify(chunk)])
      }
      // Prefer explicit cover-style filenames only for folders without a
      // manually selected cover; otherwise the user's choice stays stable.
      await client.query(`WITH choices AS (
        SELECT DISTINCT ON (parent_path) id,parent_path FROM artwork_vault_assets
        WHERE source='nextcloud' AND file_name ~* '(^|[ _.-])(cover|thumbnail|thumb|main|primary)([ _.-]|$)'
        ORDER BY parent_path,source_modified_at NULLS LAST,file_name
      ) UPDATE artwork_vault_assets a SET is_cover=TRUE FROM choices c
        WHERE a.id=c.id AND NOT EXISTS (SELECT 1 FROM artwork_vault_assets e WHERE e.source=a.source AND e.parent_path=a.parent_path AND e.is_cover)`)
      // Marking missing files by deletion keeps the index true to Nextcloud.
      if (files.length) {
        await client.query(`DELETE FROM artwork_vault_assets WHERE source='nextcloud' AND last_seen_at < NOW() - INTERVAL '5 minutes'`)
      }
      // Link folders to known CRM entities without inventing data.
      await client.query(`UPDATE artwork_vault_assets a SET lead_id=l.id
        FROM leads l WHERE a.lead_id IS NULL AND (a.path ILIKE '%'||l.lead_number||'%' OR (length(l.customer_name)>3 AND replace(a.path,'_',' ') ILIKE '%'||l.customer_name||'%'))`)
      await client.query(`UPDATE artwork_vault_assets a SET customer_id=c.id
        FROM customers c WHERE a.customer_id IS NULL AND (a.path ILIKE '%'||c.customer_number||'%' OR (length(c.name)>3 AND replace(a.path,'_',' ') ILIKE '%'||c.name||'%'))`)
      await client.query(`UPDATE artwork_vault_assets a SET lead_id=c.lead_id
        FROM customers c WHERE a.customer_id=c.id AND c.lead_id IS NOT NULL AND a.lead_id IS DISTINCT FROM c.lead_id`)
      await client.query(`UPDATE artwork_vault_assets a SET order_id=o.id
        FROM orders o WHERE a.order_id IS NULL AND a.path ILIKE '%'||o.order_number||'%'`)
      await client.query(`UPDATE artwork_vault_assets a SET sales_agent_id=o.assigned_to
        FROM orders o WHERE a.order_id=o.id AND a.sales_agent_id IS NULL AND o.assigned_to IS NOT NULL`)
      await client.query(`UPDATE artwork_vault_assets a SET sales_agent_id=l.assigned_to
        FROM leads l WHERE a.lead_id=l.id AND a.sales_agent_id IS NULL AND l.assigned_to IS NOT NULL`)
      await client.query('COMMIT')
      lastSyncAt = Date.now()
      return { configured: true, synced: files.length, total: files.length }
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally { client.release() }
  })().finally(() => { syncPromise = null })
  return syncPromise
}

async function ensureIndexed() {
  const { rows } = await query(`SELECT COUNT(*)::int total,MAX(last_seen_at) last_seen FROM artwork_vault_assets`)
  if (!rows[0].total) return sync({ force: true })
  if (!lastSyncAt && rows[0].last_seen) lastSyncAt = new Date(rows[0].last_seen).getTime()
  // Webhooks provide immediate updates. This bounded five-minute fallback runs
  // in the background and never blocks the table from rendering cached data.
  if (Date.now() - lastSyncAt >= 300000) sync().catch(() => {})
  return { configured: getConfig().configured, cached: true, total: rows[0].total }
}

function buildWhere(filters, params) {
  const clauses = []
  const add = (value, sql) => { params.push(value); clauses.push(sql(params.length)) }
  if (filters.search) add(`%${filters.search}%`, n => `(a.file_name ILIKE $${n} OR a.path ILIKE $${n}
    OR ('ART-' || LPAD(a.asset_number::text,6,'0')) ILIKE $${n}
    OR COALESCE(l.display_number,'') ILIKE $${n} OR COALESCE(l.lead_number,'') ILIKE $${n} OR COALESCE(c.name,'') ILIKE $${n}
    OR a.asset_type ILIKE $${n} OR a.status ILIKE $${n} OR COALESCE(a.order_type,'') ILIKE $${n})`)
  if (filters.type) add(filters.type, n => `a.asset_type=$${n}`)
  if (filters.order_type) add(filters.order_type, n => `COALESCE(a.order_type,o.order_type::text)=$${n}`)
  if (filters.status) add(filters.status, n => `a.status=$${n}`)
  if (filters.agent) add(filters.agent, n => `a.sales_agent_id=$${n}`)
  if (filters.designer) add(filters.designer, n => `a.designer_id=$${n}`)
  if (filters.entity) add(filters.entity, n => `(a.lead_id=$${n}::uuid OR a.customer_id=$${n}::uuid)`)
  if (filters.entity_search) add(`%${filters.entity_search}%`, n => `(COALESCE(c.name,l.customer_name,'') ILIKE $${n} OR COALESCE(l.lead_number,'') ILIKE $${n})`)
  if (filters.agent_search) add(`%${filters.agent_search}%`, n => `COALESCE(sa.name,'') ILIKE $${n}`)
  if (filters.designer_search) add(`%${filters.designer_search}%`, n => `COALESCE(d.name,'') ILIKE $${n}`)
  if (filters.from) add(filters.from, n => `COALESCE(a.source_modified_at,a.created_at) >= $${n}::date`)
  if (filters.to) add(filters.to, n => `COALESCE(a.source_modified_at,a.created_at) < ($${n}::date + INTERVAL '1 day')`)
  if (filters.qa === 'yes') clauses.push('a.qa_approved=TRUE')
  if (filters.qa === 'no') clauses.push('a.qa_approved=FALSE')
  if (filters.ready === 'yes') clauses.push('a.production_ready=TRUE')
  if (filters.ready === 'no') clauses.push('a.production_ready=FALSE')
  return clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
}

async function list(filters = {}) {
  if (filters.refresh === 'true') await sync({ force: true }).catch(() => {})
  else await ensureIndexed().catch(() => {})
  const page = Math.max(1, Number(filters.page) || 1)
  const limit = filters.export ? 10000 : Math.min(100, Math.max(10, Number(filters.limit) || 20))
  const params = []
  const where = buildWhere(filters, params)
  const totalResult = await query(`SELECT COUNT(*)::int total FROM artwork_vault_assets a
    LEFT JOIN leads l ON l.id=a.lead_id LEFT JOIN customers c ON c.id=a.customer_id
    LEFT JOIN orders o ON o.id=a.order_id LEFT JOIN users sa ON sa.id=a.sales_agent_id LEFT JOIN users d ON d.id=a.designer_id
    ${where}`, params)
  params.push(limit, (page - 1) * limit)
  const { rows } = await query(`SELECT a.*,COALESCE(l.display_number,l.lead_number) AS lead_number,COALESCE(c.name,l.customer_name) AS entity_name,c.customer_number,
        COALESCE(a.order_type,o.order_type::text) AS order_type,sa.name AS sales_agent_name,d.name AS designer_name,
        CASE WHEN a.file_name ~* '(^|[ _.-])front([ _.-]|$)' THEN 'Front'
             WHEN a.file_name ~* '(^|[ _.-])back([ _.-]|$)' THEN 'Back'
             WHEN a.asset_type='reference' THEN 'Reference' ELSE NULL END AS role_location
      FROM artwork_vault_assets a
      LEFT JOIN leads l ON l.id=a.lead_id LEFT JOIN customers c ON c.id=a.customer_id
      LEFT JOIN orders o ON o.id=a.order_id
      LEFT JOIN users sa ON sa.id=a.sales_agent_id LEFT JOIN users d ON d.id=a.designer_id
      ${where}
    ORDER BY COALESCE(a.source_modified_at,a.created_at) DESC,a.file_name
    LIMIT $${params.length - 1} OFFSET $${params.length}`, params)
  const hydrated = rows.map(row => row.source === 'nextcloud' ? {
    ...row,
    thumbnail_url: `/api/nextcloud/preview?path=${encodeURIComponent(row.path)}&w=320&h=240`,
    download_url: `/api/nextcloud/download?path=${encodeURIComponent(row.path)}`,
  } : { ...row, thumbnail_url: row.path, download_url: row.path })
  return { rows: hydrated, total: totalResult.rows[0].total, page, limit }
}

async function stats(filters = {}) {
  await ensureIndexed().catch(() => {})
  const params = []
  const where = buildWhere(filters, params)
  const { rows } = await query(`SELECT
    COUNT(*)::int AS total_assets,
    COUNT(*) FILTER (WHERE a.asset_type IN ('artwork','version'))::int AS artworks,
    COUNT(*) FILTER (WHERE a.asset_type='mockup')::int AS mockups,
    COUNT(*) FILTER (WHERE a.asset_type='gangsheet')::int AS gangsheets,
    COUNT(*) FILTER (WHERE a.asset_type IN ('artwork','version') AND a.production_ready)::int AS ready_artwork,
    COUNT(*) FILTER (WHERE a.asset_type='gangsheet' AND a.production_ready)::int AS ready_gangsheet,
    COUNT(*) FILTER (WHERE a.status='Archived')::int AS archived,
    COUNT(*) FILTER (WHERE a.asset_type IN ('artwork','version') AND NOT a.production_ready AND a.status<>'Archived')::int AS artwork_pending,
    COUNT(*) FILTER (WHERE a.asset_type='gangsheet' AND NOT a.production_ready AND a.status<>'Archived')::int AS gangsheet_pending
    FROM artwork_vault_assets a LEFT JOIN leads l ON l.id=a.lead_id LEFT JOIN customers c ON c.id=a.customer_id
    LEFT JOIN orders o ON o.id=a.order_id LEFT JOIN users sa ON sa.id=a.sales_agent_id LEFT JOIN users d ON d.id=a.designer_id
    ${where}`, params)
  return rows[0]
}

async function detail(id) {
  const { rows } = await query(`SELECT a.*,COALESCE(l.display_number,l.lead_number) AS lead_number,COALESCE(c.name,l.customer_name) entity_name,c.customer_number,
    sa.name sales_agent_name,d.name designer_name,COALESCE(a.order_type,o.order_type::text) order_type,
    CASE WHEN a.file_name ~* '(^|[ _.-])front([ _.-]|$)' THEN 'Front'
         WHEN a.file_name ~* '(^|[ _.-])back([ _.-]|$)' THEN 'Back'
         WHEN a.asset_type='reference' THEN 'Reference' ELSE NULL END role_location,
    COALESCE(c.email,l.email) contact_email,COALESCE(c.whatsapp,l.whatsapp) contact_whatsapp,
    COALESCE(c.facebook_id,l.facebook_id) contact_facebook
    FROM artwork_vault_assets a LEFT JOIN leads l ON l.id=a.lead_id LEFT JOIN customers c ON c.id=a.customer_id
    LEFT JOIN orders o ON o.id=a.order_id LEFT JOIN users sa ON sa.id=a.sales_agent_id LEFT JOIN users d ON d.id=a.designer_id WHERE a.id=$1`, [id])
  if (!rows[0]) throw Object.assign(new Error('Vault asset not found'), { statusCode: 404 })
  const siblings = await query(`SELECT id,file_name,asset_type,is_cover,path,source
    FROM artwork_vault_assets WHERE parent_path=$1 ORDER BY is_cover DESC,source_modified_at,file_name`, [rows[0].parent_path])
  const hydrate = (row, width = 700, height = 500) => row.source === 'nextcloud' ? {
    ...row,
    thumbnail_url: `/api/nextcloud/preview?path=${encodeURIComponent(row.path)}&w=${width}&h=${height}`,
    download_url: `/api/nextcloud/download?path=${encodeURIComponent(row.path)}`,
  } : { ...row, thumbnail_url: row.path, download_url: row.path }
  return { ...hydrate(rows[0]), folder_files: siblings.rows.map(row => hydrate(row, 180, 140)) }
}

async function setCover(id) {
  const client = await getClient()
  try {
    await client.query('BEGIN')
    const found = await client.query(`SELECT source,parent_path FROM artwork_vault_assets WHERE id=$1 FOR UPDATE`, [id])
    if (!found.rows[0]) throw Object.assign(new Error('Vault asset not found'), { statusCode: 404 })
    await client.query(`UPDATE artwork_vault_assets SET is_cover=FALSE WHERE source=$1 AND parent_path=$2`, [found.rows[0].source, found.rows[0].parent_path])
    const result = await client.query(`UPDATE artwork_vault_assets SET is_cover=TRUE,updated_at=NOW() WHERE id=$1 RETURNING *`, [id])
    await client.query('COMMIT')
    return result.rows[0]
  } catch (e) { await client.query('ROLLBACK'); throw e } finally { client.release() }
}

async function bulkUpdate(ids, changes = {}) {
  if (!Array.isArray(ids) || !ids.length) throw Object.assign(new Error('Select at least one asset'), { statusCode: 400 })
  const allowedStatuses = ['In Design', 'Pending Approval', 'Changes Requested', 'Approved', 'Archived']
  const sets = []
  const params = [ids]
  if (changes.status !== undefined) {
    if (!allowedStatuses.includes(changes.status)) throw Object.assign(new Error('Invalid artwork status'), { statusCode: 400 })
    params.push(changes.status); sets.push(`status=$${params.length}`)
  }
  for (const key of ['qa_approved', 'production_ready']) {
    if (changes[key] !== undefined) { params.push(Boolean(changes[key])); sets.push(`${key}=$${params.length}`) }
  }
  if (!sets.length) throw Object.assign(new Error('No supported changes provided'), { statusCode: 400 })
  const { rows } = await query(`UPDATE artwork_vault_assets SET ${sets.join(',')},updated_at=NOW()
    WHERE id=ANY($1::uuid[]) RETURNING id`, params)
  return { updated: rows.length }
}

module.exports = { inferType, inferOrderType, sync, list, stats, detail, setCover, bulkUpdate }
