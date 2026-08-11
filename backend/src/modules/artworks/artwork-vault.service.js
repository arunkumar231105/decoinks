const { query, getClient } = require('../../config/db')
const nextcloud = require('../nextcloud/nextcloud.service')
const { getConfig } = require('../../config/nextcloud')
const logger = require('../../utils/logger')

let syncPromise = null
let lastSyncAt = 0

// ── Artwork file naming standard ────────────────────────────────────────────
// AW-<CLIENT>-<NNNN>-<TYPE>.<ext>, e.g. AW-GJ001-0042-FNLA.png. The type code
// in the filename is authoritative; folder position is only the fallback for
// the legacy files that pre-date the standard.
//
//   SRC   source    — raw file the customer sent, untouched
//   REF   reference — inspiration / sample / "make it like this"
//   WRK   work      — our working draft (what Design Studio saves)
//   FNL   final     — sent for sign-off, NOT yet approved
//   FNLA  approved  — the version the customer approved; only this goes to production
//   GS    gangsheet — print-ready sheet
//   MU    mockup    — design placed on a garment for preview
//
// FNLA is listed before FNL so the longer code wins the alternation.
const TYPE_CODES = 'FNLA|SRC|REF|WRK|MOCK|OUT|FNL|GS|MU'
const NAMED_CODE = new RegExp(`(AW-[A-Z0-9]+-[0-9]{4})-(${TYPE_CODES})(?:[^A-Z]|$)`, 'i')

// Only these reach production. FNL is deliberately excluded: per the shop's
// standard a final is "sent for sign-off, not yet approved" — it becomes the
// production master only once the customer approves it and it is saved as FNLA.
const PRODUCTION_CODES = new Set(['FNLA', 'GS'])

function inferLifecycle(path, fileName = '') {
  const fullPath = String(path || '')
  if (/(^|\/)(documents?|invoices?|quotes?)(\/|$)/i.test(fullPath)) return null
  const name = String(fileName || fullPath.split('/').pop() || '')
  const named = name.match(NAMED_CODE)
  if (named) return named[2].toUpperCase()
  if (/(^|\/)(references?|refs?)(\/|$)/i.test(fullPath)) return 'SRC'
  if (/(^|\/)(artworks?|working|versions?)(\/|$)/i.test(fullPath)) return 'WRK'
  if (/(^|\/)(mockups?)(\/|$)/i.test(fullPath)) return 'MOCK'
  if (/(^|\/)(sent|outgoing)(\/|$)/i.test(fullPath)) return 'OUT'
  // A "Gangsheets" folder holds gang sheets, which is GS under the standard —
  // not FNL. 131 of the 135 files previously typed FNL live in one; they keep
  // exactly the same asset type and production flag under the accurate code.
  if (/(^|\/)gangsheets?(\/|$)/i.test(fullPath)) return 'GS'
  if (/(^|\/)(finals?|production)(\/|$)/i.test(fullPath)) return 'FNL'
  return 'WRK'
}

function inferArtworkCode(fileName) {
  const match = String(fileName || '').match(NAMED_CODE)
  return match ? match[1].toUpperCase() : null
}

function inferType(path, fileName = '') {
  return ({
    SRC: 'reference', REF: 'reference', WRK: 'artwork', MOCK: 'mockup', MU: 'mockup',
    OUT: 'sent', FNL: 'artwork', FNLA: 'artwork', GS: 'gangsheet',
  })[inferLifecycle(path, fileName)] || null
}

function inferStatus(lifecycle) {
  return ({
    SRC: 'Source Received', REF: 'Reference Received', WRK: 'In Design',
    MOCK: 'Mockup Ready', MU: 'Mockup Ready', OUT: 'Sent to Customer',
    FNL: 'Pending Approval', FNLA: 'Approved', GS: 'Production Ready',
  })[lifecycle] || 'In Design'
}

function inferOrderType(path) {
  const text = String(path).toLowerCase()
  if (/gang[ _-]?sheets?/.test(text)) return 'gangsheet'
  if (/(^|[/ _-])(dtf|transfers?)([/ _-]|$)/.test(text)) return 'dtf'
  if (/apparel|custom[ _-]?(shirts?|hoodies?)|t[ _-]?shirts?/.test(text)) return 'apparel'
  return null
}

// Studio saves number their versions inside the type code — AW-X-0001-WRK02.png
// is version 2 — so re-indexing a file straight from Nextcloud recovers the same
// version the save recorded instead of resetting every file to 1.
function inferVersion(name) {
  const staged = String(name).match(new RegExp(`-(?:${TYPE_CODES})([0-9]{1,3})(?:[^0-9]|$)`, 'i'))
  if (staged) return Math.max(1, Number(staged[1]))
  const match = String(name).match(/(?:^|[^a-z0-9])v(?:ersion)?[ _-]?(\d+)(?:[^0-9]|$)/i)
  return match ? Math.max(1, Number(match[1])) : 1
}

// Preview/download URLs are keyed to a file's current identity so a saved
// revision (new etag + version) busts the browser's 5-minute preview cache
// instead of showing the stale image.
function cacheBust(row) {
  const stamp = row.etag
    || (row.source_modified_at ? new Date(row.source_modified_at).getTime() : null)
    || (row.updated_at ? new Date(row.updated_at).getTime() : null)
    || row.version_no
    || ''
  return encodeURIComponent(String(stamp))
}

function indexRecord(file) {
  const lifecycle_code = inferLifecycle(file.path, file.name)
  if (!lifecycle_code || !file.path || !file.name) return null
  return {
    path: file.path, parent_path: file.path.split('/').slice(0, -1).join('/'), file_name: file.name,
    mime_type: file.mime_type || null, file_size_bytes: file.size || 0, etag: file.etag || null,
    file_id: file.fileid || null, asset_type: inferType(file.path, file.name),
    artwork_code: inferArtworkCode(file.name), lifecycle_code,
    naming_convention_valid: Boolean(inferArtworkCode(file.name)), status: inferStatus(lifecycle_code),
    production_ready: PRODUCTION_CODES.has(lifecycle_code), order_type: inferOrderType(file.path),
    version_no: inferVersion(file.name), modified_at: file.modified || null,
  }
}

async function upsertIndexed(client, files) {
  const indexed = files.map(indexRecord).filter(Boolean)
  if (!indexed.length) return 0
  await client.query(`INSERT INTO artwork_vault_assets
    (source,source_key,path,parent_path,file_name,mime_type,file_size_bytes,etag,nextcloud_file_id,
     asset_type,artwork_code,lifecycle_code,naming_convention_valid,status,production_ready,
     order_type,version_no,is_cover,source_modified_at,last_seen_at,updated_at)
    SELECT 'nextcloud',x.path,x.path,x.parent_path,x.file_name,x.mime_type,x.file_size_bytes,x.etag,x.file_id,
      x.asset_type,x.artwork_code,x.lifecycle_code,x.naming_convention_valid,x.status,x.production_ready,
      x.order_type,x.version_no,FALSE,x.modified_at,NOW(),NOW()
    FROM jsonb_to_recordset($1::jsonb) AS x(path text,parent_path text,file_name text,mime_type text,
      file_size_bytes bigint,etag text,file_id text,asset_type text,artwork_code text,lifecycle_code text,
      naming_convention_valid boolean,status text,production_ready boolean,order_type text,version_no int,modified_at timestamptz)
    ON CONFLICT (source,source_key) DO UPDATE SET
      path=EXCLUDED.path,parent_path=EXCLUDED.parent_path,file_name=EXCLUDED.file_name,
      mime_type=EXCLUDED.mime_type,file_size_bytes=EXCLUDED.file_size_bytes,etag=EXCLUDED.etag,
      nextcloud_file_id=EXCLUDED.nextcloud_file_id,asset_type=EXCLUDED.asset_type,
      artwork_code=EXCLUDED.artwork_code,lifecycle_code=EXCLUDED.lifecycle_code,
      naming_convention_valid=EXCLUDED.naming_convention_valid,
      status=CASE WHEN artwork_vault_assets.lifecycle_code IS DISTINCT FROM EXCLUDED.lifecycle_code
        AND artwork_vault_assets.status<>'Archived' THEN EXCLUDED.status ELSE artwork_vault_assets.status END,
      production_ready=CASE WHEN artwork_vault_assets.lifecycle_code IS DISTINCT FROM EXCLUDED.lifecycle_code
        THEN EXCLUDED.production_ready ELSE artwork_vault_assets.production_ready END,
      order_type=EXCLUDED.order_type,version_no=GREATEST(artwork_vault_assets.version_no,EXCLUDED.version_no),
      source_modified_at=EXCLUDED.source_modified_at,last_seen_at=NOW(),
      updated_at=CASE WHEN artwork_vault_assets.etag IS DISTINCT FROM EXCLUDED.etag THEN NOW() ELSE artwork_vault_assets.updated_at END`,
    [JSON.stringify(indexed)])
  return indexed.length
}

// Nextcloud reports a node as "/<user-id>/files/<rel path>" in webhook payloads
// and as the WebDAV href elsewhere — and the user id is not always the login we
// authenticate with (we sign in as adil@technocas.com, the id is "adil"). Both
// shapes have to reduce to the same vault-relative path or the event is dropped.
function normalizeEventPath(rawPath) {
  const cfg = getConfig()
  let path = String(rawPath || '')
  try { path = decodeURIComponent(path) } catch { /* keep raw */ }
  const davPrefix = `/remote.php/dav/files/${cfg.user}/`
  if (path.includes(davPrefix)) path = path.slice(path.indexOf(davPrefix) + davPrefix.length)
  else path = path.replace(/^.*?\/remote\.php\/dav\/files\/[^/]+\//, '')
       .replace(/^\/[^/]+\/files\//, '')       // "/adil/files/Leads 2.0/x.png"
  return path.replace(/^\/+|\/+$/g, '')
}

// A path only belongs to the vault when it sits under a watched root; anything
// else on the bot user's drive is ignored rather than indexed as artwork.
function isWatched(path) {
  const roots = getConfig().watchFolders
  if (!roots.length) return true
  return roots.some(root => path === root || path.startsWith(`${root}/`))
}

// Link folders to known CRM entities without inventing data. `paths` scopes the
// work to the handful of files a live event touched; omit it for a full pass.
// Every clause is additive — an existing link is never overwritten — so running
// this per delta batch is equivalent to running it over the whole table.
async function linkEntities(client, paths = null) {
  const scope = paths ? ' AND a.path = ANY($1)' : ''
  const args = paths ? [paths] : []
  if (paths && !paths.length) return
  await client.query(`UPDATE artwork_vault_assets a SET lead_id=l.id
    FROM leads l WHERE a.lead_id IS NULL AND (a.path ILIKE '%'||l.lead_number||'%' OR (length(l.customer_name)>3 AND replace(a.path,'_',' ') ILIKE '%'||l.customer_name||'%'))${scope}`, args)
  await client.query(`UPDATE artwork_vault_assets a SET customer_id=c.id
    FROM customers c WHERE a.customer_id IS NULL AND (a.path ILIKE '%'||c.customer_number||'%' OR (length(c.name)>3 AND replace(a.path,'_',' ') ILIKE '%'||c.name||'%'))${scope}`, args)
  await client.query(`UPDATE artwork_vault_assets a SET lead_id=c.lead_id
    FROM customers c WHERE a.customer_id=c.id AND c.lead_id IS NOT NULL AND a.lead_id IS DISTINCT FROM c.lead_id${scope}`, args)
  await client.query(`UPDATE artwork_vault_assets a SET order_id=o.id
    FROM orders o WHERE a.order_id IS NULL AND a.path ILIKE '%'||o.order_number||'%'${scope}`, args)
  await client.query(`UPDATE artwork_vault_assets a SET sales_agent_id=o.assigned_to
    FROM orders o WHERE a.order_id=o.id AND a.sales_agent_id IS NULL AND o.assigned_to IS NOT NULL${scope}`, args)
  await client.query(`UPDATE artwork_vault_assets a SET sales_agent_id=l.assigned_to
    FROM leads l WHERE a.lead_id=l.id AND a.sales_agent_id IS NULL AND l.assigned_to IS NOT NULL${scope}`, args)
}

async function syncEvent(event = {}) {
  const path = normalizeEventPath(event.path || event.node?.path || event.file?.path || '')
  if (!path) return { accepted: false, reason: 'path_missing' }
  if (!isWatched(path)) return { accepted: true, indexed: 0, skipped: 'unwatched' }
  const parent = path.split('/').slice(0, -1).join('/')
  const entries = await nextcloud.listFolder(parent)
  const file = entries.find(entry => entry.path === path)
  // Do not delete on an incomplete delete/rename event; the existing row is
  // retained for history and a later full reconciliation can resolve it.
  if (!file || file.is_dir) return { accepted: true, indexed: 0, retained: true }
  const client = await getClient()
  try {
    await client.query('BEGIN')
    const indexed = await upsertIndexed(client, [file])
    // A file that arrives live must reach its customer/lead immediately, or it
    // is invisible to every entity filter until the next full sync.
    if (indexed) await linkEntities(client, [file.path])
    await client.query('COMMIT')
    lastSyncAt = Date.now()
    return { accepted: true, indexed }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally { client.release() }
}

async function sync({ force = false, folders = null } = {}) {
  const cfg = getConfig()
  if (!cfg.configured) return { configured: false, synced: 0, total: 0 }
  if (!force && Date.now() - lastSyncAt < 300000) return { configured: true, cached: true }
  if (syncPromise) return syncPromise

  syncPromise = (async () => {
    const scanDepth = Math.max(1, Math.min(8, Number(process.env.NEXTCLOUD_SCAN_MAX_DEPTH) || 4))
    const files = await nextcloud.scanWatched(scanDepth, folders)
    const client = await getClient()
    try {
      await client.query('BEGIN')
      const indexed = files.map(indexRecord).filter(Boolean)
      for (let start = 0; start < indexed.length; start += 500) {
        const chunk = indexed.slice(start, start + 500)
        await client.query(`INSERT INTO artwork_vault_assets
          (source,source_key,path,parent_path,file_name,mime_type,file_size_bytes,etag,nextcloud_file_id,
           asset_type,artwork_code,lifecycle_code,naming_convention_valid,status,production_ready,
           order_type,version_no,is_cover,source_modified_at,last_seen_at,updated_at)
          SELECT 'nextcloud',x.path,x.path,x.parent_path,x.file_name,x.mime_type,x.file_size_bytes,x.etag,x.file_id,
                 x.asset_type,x.artwork_code,x.lifecycle_code,x.naming_convention_valid,x.status,x.production_ready,
                 x.order_type,x.version_no,FALSE,x.modified_at,NOW(),NOW()
          FROM jsonb_to_recordset($1::jsonb) AS x(path text,parent_path text,file_name text,mime_type text,
            file_size_bytes bigint,etag text,file_id text,asset_type text,artwork_code text,lifecycle_code text,
            naming_convention_valid boolean,status text,production_ready boolean,order_type text,version_no int,modified_at timestamptz)
          ON CONFLICT (source,source_key) DO UPDATE SET
            path=EXCLUDED.path,parent_path=EXCLUDED.parent_path,file_name=EXCLUDED.file_name,
            mime_type=EXCLUDED.mime_type,file_size_bytes=EXCLUDED.file_size_bytes,etag=EXCLUDED.etag,
            nextcloud_file_id=EXCLUDED.nextcloud_file_id,asset_type=EXCLUDED.asset_type,
            artwork_code=EXCLUDED.artwork_code,lifecycle_code=EXCLUDED.lifecycle_code,
            naming_convention_valid=EXCLUDED.naming_convention_valid,
            status=CASE WHEN artwork_vault_assets.lifecycle_code IS DISTINCT FROM EXCLUDED.lifecycle_code
                          AND artwork_vault_assets.status<>'Archived' THEN EXCLUDED.status ELSE artwork_vault_assets.status END,
            production_ready=CASE WHEN artwork_vault_assets.lifecycle_code IS DISTINCT FROM EXCLUDED.lifecycle_code
                                  THEN EXCLUDED.production_ready ELSE artwork_vault_assets.production_ready END,
            order_type=EXCLUDED.order_type,
            version_no=GREATEST(artwork_vault_assets.version_no,EXCLUDED.version_no),source_modified_at=EXCLUDED.source_modified_at,last_seen_at=NOW(),
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
      if (files.length && process.env.NEXTCLOUD_PRUNE_MISSING === 'true') {
        await client.query(`DELETE FROM artwork_vault_assets WHERE source='nextcloud' AND last_seen_at < NOW() - INTERVAL '5 minutes'`)
      }
      await linkEntities(client)
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

// ── Live change watcher ─────────────────────────────────────────────────────
// The vault has to feel live without a Sync button. Nextcloud's registered
// webhooks are not delivered on this deployment, and re-walking 5 800 files is
// far too expensive to repeat every few seconds — so the watcher asks Nextcloud
// one WebDAV SEARCH per watched root: "every file modified after <cursor>".
// Typical answer is zero to a handful of rows, which we upsert and link. When a
// webhook does arrive it takes the same path through syncEvent and is instant.
const DELTA_INTERVAL_MS = Math.max(2000, Number(process.env.NEXTCLOUD_DELTA_POLL_MS) || 4000)
const DELTA_OVERLAP_MS = 120000   // re-ask a little history; mtime has 1s granularity
const DELTA_BATCH = 400

let deltaCursor = 0        // newest source mtime we have already indexed (ms)
let deltaTimer = null
let deltaBusy = false
let lastDeltaAt = 0
let lastDeltaError = null
// The overlap window deliberately re-reads the last two minutes, so most ticks
// return files we just indexed. Remembering their etags turns those into a no-op
// instead of a pointless write + entity-link pass every few seconds.
let seenEtags = new Map()

async function initialCursor() {
  const { rows } = await query(`SELECT EXTRACT(EPOCH FROM MAX(source_modified_at))*1000 AS newest FROM artwork_vault_assets WHERE source='nextcloud'`)
  // A cold index gets a one-hour tail so a restart cannot silently skip files
  // that landed while the process was down.
  return Number(rows[0]?.newest) || Date.now() - 3600000
}

async function pollDelta() {
  const cfg = getConfig()
  if (!cfg.configured || deltaBusy) return { skipped: true }
  deltaBusy = true
  try {
    if (!deltaCursor) deltaCursor = await initialCursor()
    const roots = cfg.watchFolders.length ? cfg.watchFolders : ['']
    const since = new Date(Math.max(0, deltaCursor - DELTA_OVERLAP_MS))
    const found = []
    for (const root of roots) {
      const entries = await nextcloud.searchModifiedSince(root, since, DELTA_BATCH)
      for (const entry of entries) if (isWatched(entry.path)) found.push(entry)
    }
    // Advance the cursor over everything the window returned, changed or not.
    // Results are ascending, so a batch that hits the cap resumes exactly where
    // it stopped on the next tick instead of skipping the remainder.
    const newest = found.reduce((max, file) => {
      const stamp = file.modified ? new Date(file.modified).getTime() : 0
      return Number.isFinite(stamp) && stamp > max ? stamp : max
    }, 0)

    const changed = found.filter(file => seenEtags.get(file.path) !== (file.etag || ''))
    seenEtags = new Map(found.map(file => [file.path, file.etag || '']))
    if (newest > deltaCursor) deltaCursor = newest
    lastDeltaAt = Date.now()
    lastDeltaError = null
    if (!changed.length) return { changed: 0 }

    const client = await getClient()
    let indexed = 0
    try {
      await client.query('BEGIN')
      indexed = await upsertIndexed(client, changed)
      await linkEntities(client, changed.map(file => file.path))
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      seenEtags = new Map()   // failed batch must be retried, not remembered
      throw error
    } finally { client.release() }

    if (indexed) logger.info({ indexed, cursor: new Date(deltaCursor).toISOString() }, 'Artwork vault delta indexed')
    return { changed: indexed }
  } catch (error) {
    lastDeltaError = error.message
    logger.warn({ err: error.message }, 'Artwork vault delta poll failed')
    return { error: error.message }
  } finally { deltaBusy = false }
}

function startWatcher() {
  if (deltaTimer || process.env.NEXTCLOUD_DELTA_WATCH === 'false') return false
  if (!getConfig().configured) return false
  deltaTimer = setInterval(() => { pollDelta().catch(() => {}) }, DELTA_INTERVAL_MS)
  if (typeof deltaTimer.unref === 'function') deltaTimer.unref()
  logger.info({ every_ms: DELTA_INTERVAL_MS }, 'Artwork vault live watcher started')
  return true
}

// A change cursor small enough for a client to poll every couple of seconds.
// `updated_at` only moves when a file's etag actually changed, so an unchanged
// vault returns a stable value and the client never refetches the real list.
async function revision(filters = {}) {
  const params = []
  const where = buildWhere(filters, params)
  const { rows } = await query(`SELECT
      COALESCE(EXTRACT(EPOCH FROM MAX(a.updated_at))*1000,0)::bigint AS revision,
      COUNT(*)::int AS total
    FROM artwork_vault_assets a
    LEFT JOIN leads l ON l.id=a.lead_id LEFT JOIN customers c ON c.id=a.customer_id
    LEFT JOIN orders o ON o.id=a.order_id
    LEFT JOIN users sa ON sa.id=a.sales_agent_id LEFT JOIN users d ON d.id=a.designer_id
    ${where}`, params)
  return {
    revision: String(rows[0].revision),
    total: rows[0].total,
    watching: Boolean(deltaTimer),
    last_delta_at: lastDeltaAt ? new Date(lastDeltaAt).toISOString() : null,
    last_error: lastDeltaError,
  }
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

// Vault paths are "<root>/<customer folder>/<sub folder…>/<file>". The root is
// the watched top level — "Leads 2.0" or "PO" — which are separate worlds with
// their own folder conventions and are never mixed in one view.
const ROOT_EXPR = `split_part(a.path,'/',1)`

// The tab a designer clicks is the first sub-folder inside the customer folder.
// Files sitting directly in the customer folder group under "(root)".
const RAW_FOLDER_EXPR = `COALESCE(NULLIF(split_part(regexp_replace(a.parent_path,'^[^/]+/[^/]+/?',''),'/',1),''),'(root)')`

// The same folder is spelled three ways across the vault — "Artworks",
// "Artwork" and "ARTWORKS" — which produced three separate tabs for one thing.
// Case and plural are folded onto the canonical names the CRM creates; any
// folder outside that set (reference_files, final_files, order folders) keeps
// its real name, because those genuinely are different folders.
const CANONICAL_FOLDERS = [
  ['^artworks?$', 'Artworks'],
  ['^references?$', 'references'],
  ['^mock-?ups?$', 'Mockups'],
  ['^gang-?sheets?$', 'Gangsheets'],
  ['^documents?$', 'Documents'],
  ['^combos?$', 'Combos'],
]
const FOLDER_EXPR = `CASE ${CANONICAL_FOLDERS
  .map(([pattern, label]) => `WHEN ${RAW_FOLDER_EXPR} ~* '${pattern}' THEN '${label}'`)
  .join(' ')} ELSE ${RAW_FOLDER_EXPR} END`

// Which entity a file belongs to, and what to call it. Kept identical in the
// facet query and the filter so a tab's count always matches what it opens.
const ENTITY_KEY_EXPR = `COALESCE('c:'||a.customer_id::text,'l:'||a.lead_id::text,'p:'||split_part(a.path,'/',1)||'/'||split_part(a.path,'/',2))`
const ENTITY_NAME_EXPR = `COALESCE(c.name,l.customer_name,NULLIF(split_part(a.path,'/',2),''),'Unlinked')`

function buildWhere(filters, params) {
  const clauses = []
  const add = (value, sql) => { params.push(value); clauses.push(sql(params.length)) }
  if (filters.search) add(`%${filters.search}%`, n => `(a.file_name ILIKE $${n} OR a.path ILIKE $${n}
    OR COALESCE(a.artwork_code,'') ILIKE $${n} OR COALESCE(a.lifecycle_code,'') ILIKE $${n}
    OR ('ART-' || LPAD(a.asset_number::text,6,'0')) ILIKE $${n}
    OR COALESCE(l.display_number,'') ILIKE $${n} OR COALESCE(l.lead_number,'') ILIKE $${n} OR COALESCE(c.name,'') ILIKE $${n}
    OR a.asset_type ILIKE $${n} OR a.status ILIKE $${n} OR COALESCE(a.order_type,'') ILIKE $${n})`)
  if (filters.type) add(filters.type, n => `a.asset_type=$${n}`)
  if (filters.order_type) add(filters.order_type, n => `COALESCE(a.order_type,o.order_type::text)=$${n}`)
  if (filters.status) add(filters.status, n => `a.status=$${n}`)
  if (filters.agent) add(filters.agent, n => `a.sales_agent_id=$${n}`)
  if (filters.designer) add(filters.designer, n => `a.designer_id=$${n}`)
  if (filters.entity) add(filters.entity, n => `(a.lead_id=$${n}::uuid OR a.customer_id=$${n}::uuid)`)
  if (filters.lifecycle) add(String(filters.lifecycle).toUpperCase(), n => `a.lifecycle_code=$${n}`)
  if (filters.root) add(filters.root, n => `${ROOT_EXPR}=$${n}`)
  if (filters.folder) add(filters.folder, n => `${FOLDER_EXPR}=$${n}`)
  // One customer can own several roots (a "Leads 2.0" folder and a "PO" folder),
  // so the picker keys on the linked entity and falls back to the folder prefix
  // for files no lead or customer claims yet. Prefix matching uses strpos, not
  // LIKE: real folder names contain underscores, which LIKE treats as wildcards.
  if (filters.entity_key) {
    const key = String(filters.entity_key)
    if (key.startsWith('c:')) add(key.slice(2), n => `a.customer_id=$${n}::uuid`)
    else if (key.startsWith('l:')) add(key.slice(2), n => `a.lead_id=$${n}::uuid`)
    else if (key.startsWith('p:')) add(`${key.slice(2)}/`, n => `(a.customer_id IS NULL AND a.lead_id IS NULL AND strpos(a.path,$${n})=1)`)
  }
  if (filters.entity_search) add(`%${filters.entity_search}%`, n => `(COALESCE(c.name,l.customer_name,'') ILIKE $${n} OR COALESCE(l.lead_number,'') ILIKE $${n})`)
  if (filters.agent_search) add(`%${filters.agent_search}%`, n => `COALESCE(sa.name,'') ILIKE $${n}`)
  if (filters.designer_search) add(`%${filters.designer_search}%`, n => `COALESCE(d.name,'') ILIKE $${n}`)
  if (filters.from) add(filters.from, n => `COALESCE(a.source_modified_at,a.created_at) >= $${n}::date`)
  if (filters.to) add(filters.to, n => `COALESCE(a.source_modified_at,a.created_at) < ($${n}::date + INTERVAL '1 day')`)
  if (filters.qa === 'yes') clauses.push('a.qa_approved=TRUE')
  if (filters.qa === 'no') clauses.push('a.qa_approved=FALSE')
  if (filters.ready === 'yes') clauses.push('a.production_ready=TRUE')
  if (filters.ready === 'no') clauses.push('a.production_ready=FALSE')
  // Post Production = what may actually be printed. That is the production flag
  // itself, not one hard-coded lifecycle code: it covers the approved masters
  // (FNLA), gang sheets (GS), files a lead marked ready by hand, and the legacy
  // FNL rows that pre-date the naming standard.
  if (filters.scope === 'post_production') clauses.push(`a.production_ready=TRUE
    AND a.status<>'Archived'
    AND NOT EXISTS (
      SELECT 1
      FROM artwork_vault_assets newer
      WHERE newer.production_ready=TRUE
        AND newer.status<>'Archived'
        AND (
          (a.artwork_code IS NOT NULL AND newer.artwork_code=a.artwork_code)
          OR (a.artwork_code IS NULL AND newer.artwork_code IS NULL AND newer.parent_path=a.parent_path)
        )
        AND (
          COALESCE(newer.version_no,1) > COALESCE(a.version_no,1)
          OR (
            COALESCE(newer.version_no,1) = COALESCE(a.version_no,1)
            AND COALESCE(newer.source_modified_at,newer.created_at) > COALESCE(a.source_modified_at,a.created_at)
          )
          OR (
            COALESCE(newer.version_no,1) = COALESCE(a.version_no,1)
            AND COALESCE(newer.source_modified_at,newer.created_at) = COALESCE(a.source_modified_at,a.created_at)
            AND newer.id::text > a.id::text
          )
        )
    )`)
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
  const { rows } = await query(`SELECT a.*,${FOLDER_EXPR} AS folder,${ENTITY_KEY_EXPR} AS entity_key,
        COALESCE(l.display_number,l.lead_number) AS lead_number,COALESCE(c.name,l.customer_name) AS entity_name,c.customer_number,
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
    thumbnail_url: `/api/nextcloud/preview?path=${encodeURIComponent(row.path)}&w=320&h=240&v=${cacheBust(row)}`,
    download_url: `/api/nextcloud/download?path=${encodeURIComponent(row.path)}&v=${cacheBust(row)}`,
  } : { ...row, thumbnail_url: row.path, download_url: row.path })
  return { rows: hydrated, total: totalResult.rows[0].total, page, limit }
}

// A customer's folder tabs must show every folder that customer actually has,
// including the empty ones — the index only knows about files, so an empty
// Mockups folder would silently vanish from the tab strip. Nextcloud is asked
// directly for the real directory listing; if it is unreachable the tabs simply
// fall back to the folders that do contain files.
async function customerFolderNames(filters) {
  const params = []
  const where = buildWhere(filters, params)
  const { rows } = await query(`SELECT DISTINCT split_part(a.path,'/',1)||'/'||split_part(a.path,'/',2) AS base
    FROM artwork_vault_assets a
    LEFT JOIN leads l ON l.id=a.lead_id LEFT JOIN customers c ON c.id=a.customer_id
    LEFT JOIN orders o ON o.id=a.order_id
    LEFT JOIN users sa ON sa.id=a.sales_agent_id LEFT JOIN users d ON d.id=a.designer_id
    ${where}`, params)
  const names = new Set()
  await Promise.all(rows.slice(0, 8).map(async ({ base }) => {
    try {
      for (const entry of await nextcloud.listFolder(base)) if (entry.is_dir) names.add(entry.name)
    } catch (error) {
      logger.warn({ err: error.message, base }, 'Artwork vault: folder listing skipped')
    }
  }))
  return [...names]
}

function canonicalFolder(name) {
  for (const [pattern, label] of CANONICAL_FOLDERS) if (new RegExp(pattern, 'i').test(name)) return label
  return name
}

// Facets drive the source tabs, the customer picker and the folder tabs. Each
// one deliberately drops the filter it is offering choices for — otherwise
// picking a customer would leave a picker containing only that customer.
async function facets(filters = {}) {
  const { entity_key, folder, lifecycle, root, ...base } = filters
  const withFilters = async (extra, select, groupOrder) => {
    const params = []
    const where = buildWhere({ ...base, ...extra }, params)
    const { rows } = await query(`SELECT ${select},COUNT(*)::int AS files
      FROM artwork_vault_assets a
      LEFT JOIN leads l ON l.id=a.lead_id LEFT JOIN customers c ON c.id=a.customer_id
      LEFT JOIN orders o ON o.id=a.order_id
      LEFT JOIN users sa ON sa.id=a.sales_agent_id LEFT JOIN users d ON d.id=a.designer_id
      ${where} ${groupOrder}`, params)
    return rows
  }
  const [roots, customers, folders, lifecycles, realFolders] = await Promise.all([
    withFilters({ entity_key, folder, lifecycle }, `${ROOT_EXPR} AS key`, 'GROUP BY 1 ORDER BY 1'),
    withFilters({ root, folder, lifecycle },
      `${ENTITY_KEY_EXPR} AS key,${ENTITY_NAME_EXPR} AS name,MAX(COALESCE(c.customer_number,l.lead_number)) AS reference`,
      'GROUP BY 1,2 ORDER BY 2'),
    withFilters({ root, entity_key, lifecycle }, `${FOLDER_EXPR} AS key`, 'GROUP BY 1 ORDER BY 1'),
    withFilters({ root, entity_key, folder }, `COALESCE(a.lifecycle_code,'—') AS key`, 'GROUP BY 1 ORDER BY 1'),
    entity_key ? customerFolderNames({ ...base, root, entity_key }) : Promise.resolve([]),
  ])

  // Merge the live directory listing in at zero so an empty folder is still a
  // tab the designer can click and drop work into.
  const counted = new Map(folders.map(row => [row.key, row]))
  for (const name of realFolders) {
    const key = canonicalFolder(name)
    if (!counted.has(key)) counted.set(key, { key, files: 0 })
  }
  const merged = [...counted.values()].sort((a, b) => a.key.localeCompare(b.key))
  return { roots, customers, folders: merged, lifecycles }
}

async function stats(filters = {}) {
  await ensureIndexed().catch(() => {})
  const params = []
  const where = buildWhere(filters, params)
  const { rows } = await query(`SELECT
    COUNT(*)::int AS total_assets,
    COUNT(*) FILTER (WHERE a.asset_type='artwork')::int AS artworks,
    COUNT(*) FILTER (WHERE a.asset_type='mockup')::int AS mockups,
    COUNT(*) FILTER (WHERE a.asset_type='gangsheet')::int AS gangsheets,
    COUNT(*) FILTER (WHERE a.asset_type='artwork' AND a.production_ready)::int AS ready_artwork,
    COUNT(*) FILTER (WHERE a.asset_type='gangsheet' AND a.production_ready)::int AS ready_gangsheet,
    COUNT(*) FILTER (WHERE a.status='Archived')::int AS archived,
    COUNT(*) FILTER (WHERE a.asset_type='artwork' AND NOT a.production_ready AND a.status<>'Archived')::int AS artwork_pending,
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
  const siblings = await query(`SELECT id,file_name,asset_type,lifecycle_code,artwork_code,version_no,is_cover,path,source
    FROM artwork_vault_assets WHERE parent_path=$1 ORDER BY is_cover DESC,source_modified_at,file_name`, [rows[0].parent_path])
  const family = rows[0].artwork_code ? await query(`SELECT id,file_name,asset_type,lifecycle_code,artwork_code,version_no,is_cover,path,source,source_modified_at,status
    FROM artwork_vault_assets WHERE artwork_code=$1
    ORDER BY CASE lifecycle_code WHEN 'SRC' THEN 1 WHEN 'WRK' THEN 2 WHEN 'MOCK' THEN 3 WHEN 'OUT' THEN 4 WHEN 'FNL' THEN 5 ELSE 6 END,
             version_no,source_modified_at,file_name`, [rows[0].artwork_code]) : { rows: [] }
  const hydrate = (row, width = 700, height = 500) => row.source === 'nextcloud' ? {
    ...row,
    thumbnail_url: `/api/nextcloud/preview?path=${encodeURIComponent(row.path)}&w=${width}&h=${height}&v=${cacheBust(row)}`,
    download_url: `/api/nextcloud/download?path=${encodeURIComponent(row.path)}&v=${cacheBust(row)}`,
  } : { ...row, thumbnail_url: row.path, download_url: row.path }
  // Design Studio round-trip history — the bytes each save replaced, newest first.
  // These stay visible in the drawer even though the live asset now shows the
  // latest version.
  const revisions = await query(`SELECT id,version_no,file_name,mime_type,file_size_bytes,storage_path,source_app,created_at
    FROM artwork_vault_revisions WHERE asset_id=$1 ORDER BY version_no DESC,created_at DESC`, [rows[0].id])
  return {
    ...hydrate(rows[0]),
    folder_files: siblings.rows.map(row => hydrate(row, 180, 140)),
    family_files: family.rows.map(row => hydrate(row, 180, 140)),
    revisions: revisions.rows.map(row => ({ ...row, thumbnail_url: row.storage_path, download_url: row.storage_path })),
  }
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

async function linkAsset(id, { artwork_id = null, artwork_version_id = null } = {}) {
  if (!artwork_id && artwork_version_id) {
    const version = await query(`SELECT artwork_id FROM artwork_versions WHERE id=$1`, [artwork_version_id])
    if (!version.rows[0]) throw Object.assign(new Error('Artwork version not found'), { statusCode: 404 })
    artwork_id = version.rows[0].artwork_id
  }
  const { rows } = await query(`UPDATE artwork_vault_assets
    SET artwork_id=$2, artwork_version_id=$3, updated_at=NOW()
    WHERE id=$1 RETURNING *`, [id, artwork_id, artwork_version_id])
  if (!rows[0]) throw Object.assign(new Error('Vault asset not found'), { statusCode: 404 })
  return rows[0]
}

module.exports = {
  inferLifecycle, inferArtworkCode, inferType, inferStatus, inferOrderType, inferVersion,
  sync, syncEvent, pollDelta, startWatcher, revision, list, facets, stats, detail,
  setCover, bulkUpdate, linkAsset,
}
