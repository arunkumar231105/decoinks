// ── Design Studio round-trip service ─────────────────────────────────────────
// Bridges a PrintShop vault asset to the Design Studio editor and back:
//   1. issueTokenForAsset — mint a short-lived handoff token for one asset.
//   2. assetPayload / assetContent — serve metadata + live bytes to the editor.
//   3. saveEditedArtwork — snapshot the outgoing bytes into artwork_vault_revisions,
//      overwrite the live file in place (stable path + UUID), and bump the version.
//
// Tokens are HS256 and interchangeable with the ones the Design Studio bridge
// mints (api/central-artwork.php), so the shared secret must match. PrintShop's
// JWT_SECRET already equals Design Studio's PRINTSHOP_JWT_SECRET, so we accept
// either name.

const jwt = require('jsonwebtoken')
const sharp = require('sharp')
const pathUtil = require('node:path')
const logger = require('../../utils/logger')
const { getRedisClient } = require('../../config/redis')
const { query, getClient } = require('../../config/db')
const nextcloud = require('../nextcloud/nextcloud.service')
const storage = require('../../config/storage')

const TOKEN_TTL_SECONDS = 7200
const AUDIENCE = 'decoinks-design-studio'
const ISSUER = 'decoinks-printshop'
const PURPOSE = 'design-studio-artwork'
const VAULT_PURPOSE = 'design-studio-vault'

function studioSecret() {
  const secret = process.env.PRINTSHOP_JWT_SECRET || process.env.JWT_SECRET
  if (!secret) throw Object.assign(new Error('Design Studio secret is not configured'), { statusCode: 500 })
  return secret
}

function issueToken(assetId, userId = null) {
  return jwt.sign(
    { purpose: PURPOSE, asset_id: assetId, user_id: userId },
    studioSecret(),
    { algorithm: 'HS256', expiresIn: TOKEN_TTL_SECONDS, audience: AUDIENCE, issuer: ISSUER },
  )
}

function issueVaultToken(userId = null) {
  return jwt.sign(
    { purpose: VAULT_PURPOSE, user_id: userId }, studioSecret(),
    { algorithm: 'HS256', expiresIn: TOKEN_TTL_SECONDS, audience: AUDIENCE, issuer: ISSUER },
  )
}

function verifyVaultToken(token) {
  if (!token) throw Object.assign(new Error('Design Studio vault token is required'), { statusCode: 401 })
  try {
    const decoded = jwt.verify(token, studioSecret(), { algorithms: ['HS256'], audience: AUDIENCE, issuer: ISSUER })
    if (decoded.purpose !== VAULT_PURPOSE) throw new Error('purpose')
    return decoded
  } catch {
    throw Object.assign(new Error('Design Studio vault token is invalid or expired'), { statusCode: 401 })
  }
}

// ── Design Studio vault ─────────────────────────────────────────────────────
// The studio shows the same vault PrintShop does, so it reads the same
// artwork-vault service — one index, one truth. What it must not do is ship the
// whole index: an unpaginated payload was 8.4 MB per request. The studio asks
// for one page, server-side filtered, and only the columns a card renders.
const STUDIO_PAGE_LIMIT = 60

function studioRow(row) {
  return {
    id: row.id,
    file_name: row.file_name,
    path: row.path,
    folder: row.folder,
    entity_key: row.entity_key,
    entity_name: row.entity_name,
    lead_number: row.lead_number,
    customer_number: row.customer_number,
    asset_type: row.asset_type,
    lifecycle_code: row.lifecycle_code,
    artwork_code: row.artwork_code,
    asset_number: row.asset_number,
    naming_convention_valid: row.naming_convention_valid,
    version_no: row.version_no,
    status: row.status,
    mime_type: row.mime_type,
    file_size_bytes: Number(row.file_size_bytes) || 0,
    production_ready: row.production_ready,
    qa_approved: row.qa_approved,
    source_modified_at: row.source_modified_at,
    // Thumbnails are cached by the browser, so the URL has to change when the
    // bytes do — otherwise a saved revision keeps showing the old image.
    preview_key: row.etag || (row.source_modified_at ? new Date(row.source_modified_at).getTime() : row.version_no) || '',
  }
}

// `export` and `refresh` are honoured by vault.list() — the first lifts the page
// cap to 10 000 rows, the second forces a full Nextcloud re-walk. Neither may be
// reachable from a studio query string; the watcher owns freshness.
function studioFilters(filters = {}) {
  const { export: _export, refresh: _refresh, limit: _limit, ...safe } = filters
  return safe
}

async function vaultPayload(token, filters = {}) {
  verifyVaultToken(token)
  const vault = require('./artwork-vault.service')
  const limit = Math.min(STUDIO_PAGE_LIMIT, Math.max(12, Number(filters.limit) || STUDIO_PAGE_LIMIT))
  const result = await vault.list({ ...studioFilters(filters), limit })
  return { rows: result.rows.map(studioRow), total: result.total, page: result.page, limit: result.limit }
}

async function vaultFacets(token, filters = {}) {
  verifyVaultToken(token)
  return require('./artwork-vault.service').facets(studioFilters(filters))
}

async function vaultRevision(token, filters = {}) {
  verifyVaultToken(token)
  return require('./artwork-vault.service').revision(studioFilters(filters))
}

// ── Grid thumbnails ─────────────────────────────────────────────────────────
// Nextcloud's preview endpoint ignores the size we ask for and hands back
// whatever it already has cached — often 200 KB+, which made one page of 60
// cards a ~5.7 MB download. Every preview is therefore re-encoded to the size
// the card actually renders and cached, so the grid costs a few hundred KB and
// a repeat view costs one Redis lookup.
const THUMB_TTL_SECONDS = 7 * 24 * 3600
const THUMB_QUALITY = 70

function thumbCacheKey(asset, width, height) {
  // The etag is in the key, so new bytes are a new entry: nothing to invalidate.
  return `av:thumb:${asset.id}:${asset.etag || asset.version_no || 0}:${width}x${height}`
}

// A grid of 60 tiles asks for 60 thumbnails at once. Nextcloud's preview
// generator falls over under that, and decoding 60 large images at the same
// time is a memory spike we do not need — so cold renders queue through a small
// gate. Cache hits never touch it.
const RENDER_LIMIT = Math.max(1, Number(process.env.ARTWORK_THUMB_CONCURRENCY) || 4)
let renderActive = 0
const renderQueue = []

function acquireRenderSlot() {
  if (renderActive < RENDER_LIMIT) { renderActive++; return Promise.resolve() }
  return new Promise(resolve => renderQueue.push(resolve))
}

function releaseRenderSlot() {
  const next = renderQueue.shift()
  if (next) next()
  else renderActive--
}

async function readPreviewSource(asset, width, height) {
  if (asset.source !== 'nextcloud') {
    const res = await fetch(asset.path)
    if (!res.ok) throw Object.assign(new Error('Preview is unavailable'), { statusCode: 502 })
    return { buffer: Buffer.from(await res.arrayBuffer()), mime: res.headers.get('content-type') || 'image/png' }
  }
  // Ask Nextcloud, not the raw file: it is the only thing that can rasterise
  // the .ai / .psd / .pdf artwork the shop stores.
  const res = await nextcloud.getPreview(asset.path, { width, height })
  if (!res.ok) throw Object.assign(new Error('Preview is unavailable'), { statusCode: 502 })
  return { buffer: Buffer.from(await res.arrayBuffer()), mime: res.headers.get('content-type') || 'image/png' }
}

// A thumbnail is authorised by the vault token the listing already used: seeing
// a preview of a file you can see in the list grants nothing extra. Full bytes
// still require a per-asset handoff token.
async function assetPreview(token, assetId, { width = 320, height = 240 } = {}) {
  verifyVaultToken(token)
  if (!assetId) throw Object.assign(new Error('Asset id is required'), { statusCode: 400 })
  const asset = await loadAsset(assetId)
  const key = thumbCacheKey(asset, width, height)

  let redis = null
  try { redis = getRedisClient() } catch { /* cache is best-effort */ }
  if (redis) {
    try {
      const hit = await redis.getBuffer(key)
      if (hit && hit.length) return { buffer: hit, mime: 'image/webp', etag: key, cached: true }
    } catch { /* fall through to a live render */ }
  }

  await acquireRenderSlot()
  let buffer
  let mime
  try {
    // Another request may have rendered this exact tile while we queued.
    if (redis) {
      try {
        const hit = await redis.getBuffer(key)
        if (hit && hit.length) return { buffer: hit, mime: 'image/webp', etag: key, cached: true }
      } catch { /* fall through */ }
    }
    const source = await readPreviewSource(asset, width, height)
    buffer = source.buffer
    mime = source.mime
    try {
      buffer = await sharp(source.buffer, { failOn: 'none' })
        .rotate()                  // honour EXIF — customer reference photos are phone shots
        .resize(width, height, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: THUMB_QUALITY })
        .toBuffer()
      mime = 'image/webp'
    } catch (error) {
      // An exotic format sharp cannot decode still gets shown, just unoptimised.
      logger.warn({ err: error.message, path: asset.path }, 'Artwork thumbnail: serving unoptimised preview')
    }
  } finally {
    releaseRenderSlot()
  }

  if (redis && mime === 'image/webp') {
    redis.set(key, buffer, 'EX', THUMB_TTL_SECONDS).catch(() => {})
  }
  return { buffer, mime, etag: key, cached: false }
}

// Exchange the broad vault token for a token scoped to the single asset the
// designer actually opened. Minting one per row (5 800 signatures per refresh)
// is what made the old bridge unusable.
async function handoffToken(token, assetId) {
  const { user_id } = verifyVaultToken(token)
  const asset = await loadAsset(assetId)
  return { token: issueToken(asset.id, user_id || null), file_name: asset.file_name, id: asset.id }
}

function verifyToken(token) {
  if (!token) throw Object.assign(new Error('Artwork handoff token is required'), { statusCode: 401 })
  let decoded
  try {
    decoded = jwt.verify(token, studioSecret(), { algorithms: ['HS256'], audience: AUDIENCE, issuer: ISSUER })
  } catch {
    throw Object.assign(new Error('Artwork handoff token is invalid or expired'), { statusCode: 401 })
  }
  if (decoded.purpose !== PURPOSE || !decoded.asset_id) {
    throw Object.assign(new Error('Artwork handoff token is invalid'), { statusCode: 401 })
  }
  return decoded
}

async function loadAsset(assetId, client = null) {
  const runner = client ? client.query.bind(client) : query
  const lock = client ? ' FOR UPDATE' : ''
  const { rows } = await runner(`SELECT id,source,path,parent_path,file_name,mime_type,file_size_bytes,etag,version_no,
      nextcloud_file_id,asset_type,artwork_code,lifecycle_code,naming_convention_valid,lead_id,customer_id,
      order_id,sales_agent_id,designer_id,sender_name,artwork_id,artwork_version_id
    FROM artwork_vault_assets WHERE id=$1${lock}`, [assetId])
  if (!rows[0]) throw Object.assign(new Error('Vault asset not found'), { statusCode: 404 })
  return rows[0]
}

function fileExtension(fileName, mime) {
  const ext = pathUtil.extname(String(fileName || '')).replace(/^\./, '').toLowerCase()
  if (ext && /^[a-z0-9]{1,8}$/.test(ext)) return ext
  const byMime = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/postscript': 'ai', 'application/pdf': 'pdf' }
  return byMime[String(mime || '').toLowerCase()] || 'png'
}

// The customer's folder is everything above the first stage folder in the path.
function customerFolder(assetPath) {
  const parts = String(assetPath || '').split('/').filter(Boolean)
  const marker = parts.findIndex(part => /^(references?|refs?|artworks?|working|versions?|mockups?|sent|outgoing|gangsheets?|finals?|production|combos?|documents?)$/i.test(part))
  return (marker > 0 ? parts.slice(0, marker) : parts.slice(0, -1)).join('/')
}

// ── Where each studio tool saves ────────────────────────────────────────────
// A design keeps its number as it moves between tools; only the type code and
// its version change. Editing artwork gives WRK01, WRK02…, a mockup of the same
// design gives MU01, MU02…, a gang sheet gives GS01, GS02…  Every save writes a
// NEW file, so no save can ever destroy the one before it.
const SAVE_KINDS = {
  WRK: { code: 'WRK', folder: 'Artworks', match: '^artworks?$', label: 'working artwork' },
  MU: { code: 'MU', folder: 'Mockups', match: '^mock-?ups?$', label: 'mockup' },
  GS: { code: 'GS', folder: 'Gangsheets', match: '^gang-?sheets?$', label: 'gang sheet' },
}

function saveKind(value) {
  const kind = SAVE_KINDS[String(value || 'WRK').toUpperCase()]
  if (!kind) throw Object.assign(new Error('Unknown save type — expected WRK, MU or GS'), { statusCode: 400 })
  return kind
}

// Stage folders are spelled inconsistently across the vault ("Artworks",
// "Artwork", "ARTWORKS"), so reuse whichever one this customer already has
// rather than creating a second folder beside it.
// Prefix matching is done with strpos/substr rather than LIKE or a built regex:
// folder names contain both underscores (a LIKE wildcard) and dots (a regex
// wildcard), so "Leads 2.0/260601_Gaspar_Erosa" cannot be used as a pattern.
async function stageFolder(client, base, kind) {
  const { rows } = await client.query(`SELECT split_part(substr(parent_path,length($1::text)+2),'/',1) AS folder,COUNT(*)::int AS files
    FROM artwork_vault_assets
    WHERE source='nextcloud' AND strpos(parent_path,$1::text||'/')=1
      AND split_part(substr(parent_path,length($1::text)+2),'/',1) ~* $2
    GROUP BY 1 ORDER BY files DESC LIMIT 1`, [base, kind.match])
  return `${base}/${rows[0]?.folder || kind.folder}`
}

// AW-<CLIENT>-<NNNN>-<TYPE>: the client segment is assigned by the design team,
// not by us, so adopt the code this customer's existing files already use rather
// than minting a competing one. Only a customer with no coded file at all gets a
// derived code, and that code is checked for collisions before it is used.
async function resolveClientCode(client, asset, base) {
  if (asset.artwork_code) {
    const segment = String(asset.artwork_code).split('-')[1]
    if (segment) return segment.toUpperCase()
  }
  const existing = await client.query(`SELECT split_part(artwork_code,'-',2) AS code,COUNT(*)::int AS files
    FROM artwork_vault_assets
    WHERE source='nextcloud' AND artwork_code IS NOT NULL
      AND (strpos(path,$1::text||'/')=1 OR ($2::uuid IS NOT NULL AND customer_id=$2::uuid) OR ($3::uuid IS NOT NULL AND lead_id=$3::uuid))
    GROUP BY 1 ORDER BY files DESC LIMIT 1`, [base, asset.customer_id, asset.lead_id])
  if (existing.rows[0]?.code) return String(existing.rows[0].code).toUpperCase()

  const { rows: named } = await client.query(`SELECT COALESCE(c.name,l.customer_name) AS name
    FROM artwork_vault_assets a LEFT JOIN customers c ON c.id=a.customer_id LEFT JOIN leads l ON l.id=a.lead_id
    WHERE a.id=$1`, [asset.id])
  const source = named[0]?.name || base.split('/').pop() || ''
  const letters = source.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3).padEnd(3, 'X') || 'GEN'
  const taken = await client.query(`SELECT DISTINCT split_part(artwork_code,'-',2) AS code
    FROM artwork_vault_assets WHERE artwork_code LIKE $1`, [`AW-${letters}%`])
  const used = new Set(taken.rows.map(row => String(row.code).toUpperCase()))
  for (let n = 1; n < 100; n++) {
    const candidate = `${letters}${String(n).padStart(2, '0')}`
    if (!used.has(candidate)) return candidate
  }
  throw Object.assign(new Error(`No free client code remains for ${letters}`), { statusCode: 409 })
}

// The piece number identifies the design, not the stage: this shop's files
// already pair AW-GER01-0003-SRC with AW-GER01-0003-OUT, and the standard says
// "don't renumber a piece when only its stage changes". So a number is only
// minted for a file that has none — the next one free across every stage, so it
// can never collide with an existing source or sent file.
async function nextPieceNumber(client, clientCode) {
  const { rows } = await client.query(`SELECT COALESCE(MAX(NULLIF(split_part(artwork_code,'-',3),'')::int),0) AS highest
    FROM artwork_vault_assets
    WHERE artwork_code LIKE $1 AND split_part(artwork_code,'-',3) ~ '^[0-9]{4}$'`, [`AW-${clientCode}-%`])
  return String(Number(rows[0].highest) + 1).padStart(4, '0')
}

// The next version number for this design at this stage. Numbering never
// reuses: the highest version ever recorded wins, even if an older file was
// deleted, so two saves can never point at the same name. A legacy unnumbered
// file (…-WRK.png) counts as version 1.
function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')
}

async function nextVersionNumber(client, code, kindCode) {
  const prefix = `${escapeRegex(code)}\\-${escapeRegex(kindCode)}`
  const { rows } = await client.query(`SELECT COALESCE(MAX(
      COALESCE(NULLIF(substring(file_name from $1), '')::int, 1)), 0) AS highest
    FROM artwork_vault_assets
    WHERE source='nextcloud' AND file_name ~ $2`,
  [`^${prefix}([0-9]+)`, `^${prefix}[0-9]*\\.`])
  return Number(rows[0].highest) + 1
}

// Reserve the exact path this save will be written to. The design keeps its
// AW-<CLIENT>-<NNNN> code; only the stage code and version change. The
// extension comes from the file being uploaded, never from the source asset —
// exporting a PNG gang sheet out of a .ai source must not produce a ".ai".
async function allocateVersionedFile(client, asset, kind, upload) {
  const base = customerFolder(asset.path)
  const folder = await stageFolder(client, base, kind)
  const ext = fileExtension(upload.originalname, upload.mimetype)
  const code = asset.artwork_code
    ? asset.artwork_code.toUpperCase()
    : await (async () => {
      const clientCode = await resolveClientCode(client, asset, base)
      return `AW-${clientCode}-${await nextPieceNumber(client, clientCode)}`
    })()

  let version = await nextVersionNumber(client, code, kind.code)
  for (let attempt = 0; attempt < 200; attempt++, version++) {
    const fileName = `${code}-${kind.code}${String(version).padStart(2, '0')}.${ext}`
    const path = `${folder}/${fileName}`
    const taken = await client.query(`SELECT 1 FROM artwork_vault_assets WHERE source='nextcloud' AND path=$1`, [path])
    if (!taken.rows.length) return { folder, path, fileName, code, version }
  }
  throw Object.assign(new Error(`Could not allocate a ${kind.label} filename`), { statusCode: 409 })
}

// Fetch the current live bytes for an asset regardless of backing store.
async function readAssetBytes(asset) {
  if (asset.source === 'nextcloud') {
    const res = await nextcloud.downloadFile(asset.path)
    if (!res.ok) throw Object.assign(new Error('Artwork content is unavailable'), { statusCode: 502 })
    return { buffer: Buffer.from(await res.arrayBuffer()), mime: res.headers.get('content-type') || asset.mime_type || 'application/octet-stream' }
  }
  const res = await fetch(asset.path)
  if (!res.ok) throw Object.assign(new Error('Artwork content is unavailable'), { statusCode: 502 })
  return { buffer: Buffer.from(await res.arrayBuffer()), mime: res.headers.get('content-type') || asset.mime_type || 'application/octet-stream' }
}

async function issueTokenForAsset(assetId, userId = null) {
  const asset = await loadAsset(assetId) // throws 404 if the asset is gone
  return issueToken(asset.id, userId)
}

// Metadata the Design Studio bridge caches and shows in the vault.
async function assetPayload(token) {
  const { asset_id } = verifyToken(token)
  const asset = await loadAsset(asset_id)
  return {
    id: asset.id,
    file_name: asset.file_name,
    version_no: asset.version_no || 0,
    mime_type: asset.mime_type || null,
    file_size_bytes: Number(asset.file_size_bytes) || 0,
  }
}

async function assetContent(token) {
  const { asset_id } = verifyToken(token)
  const asset = await loadAsset(asset_id)
  const { buffer, mime } = await readAssetBytes(asset)
  return { buffer, mime, file_name: asset.file_name }
}

// Persist work from a studio tool as the next version of its stage.
//
// Nothing in the vault is ever overwritten: every save lands on a fresh
// AW-<CLIENT>-<NNNN>-<STAGE><VV> file, so a designer can always go back to any
// earlier version and a mis-click can never destroy finished work. The stage
// comes from the tool doing the saving — the editor writes WRK, the mockup
// writes MU, the gang sheet writes GS — while the design's own number stays put.
async function saveEditedArtwork(token, file, userId = null, kindValue = 'WRK') {
  const { asset_id, user_id } = verifyToken(token)
  const savedBy = userId || user_id || null
  const kind = saveKind(kindValue)
  if (!file || !file.buffer || !file.buffer.length) {
    throw Object.assign(new Error(`A ${kind.label} file is required`), { statusCode: 400 })
  }
  const mime = file.mimetype || 'image/png'
  const vault = require('./artwork-vault.service')
  const client = await getClient()
  try {
    await client.query('BEGIN')
    const asset = await loadAsset(asset_id, client)

    // Assets that live in MinIO rather than Nextcloud have no customer folder
    // to version into; they keep the original replace-in-place behaviour.
    if (asset.source !== 'nextcloud') {
      const url = await storage.uploadFile(file.buffer, asset.file_name, mime, 'artwork-live')
      await client.query(`UPDATE artwork_vault_assets SET path=$2,file_size_bytes=$3,mime_type=$4,source_modified_at=NOW(),updated_at=NOW() WHERE id=$1`,
        [asset.id, url, file.buffer.length, mime])
      await client.query('COMMIT')
      return {
        asset_id: asset.id, path: url, file_name: asset.file_name,
        version_no: (asset.version_no || 0) + 1, created_new_file: false,
        lifecycle_code: kind.code, stage: kind.code, studio_token: issueToken(asset.id, savedBy),
      }
    }

    // Reserve a name, then claim it atomically. If another save took the same
    // number in between, Nextcloud refuses the write and we move to the next
    // one rather than clobbering their file.
    let allocated
    let put
    for (let attempt = 0; attempt < 25; attempt++) {
      allocated = await allocateVersionedFile(client, asset, kind, file)
      await nextcloud.ensureFolder(allocated.folder)
      put = await nextcloud.putFileIfAbsent(allocated.path, file.buffer, mime)
      if (!put.taken) break
      logger.warn({ path: allocated.path }, 'Artwork save: version name already taken, retrying')
      put = null
    }
    if (!put) throw Object.assign(new Error(`Could not reserve a ${kind.label} version`), { statusCode: 409 })

    const inserted = await client.query(`INSERT INTO artwork_vault_assets
      (source,source_key,path,parent_path,file_name,mime_type,file_size_bytes,etag,nextcloud_file_id,
       asset_type,artwork_code,lifecycle_code,naming_convention_valid,status,production_ready,version_no,
       is_cover,qa_approved,lead_id,customer_id,order_id,sales_agent_id,designer_id,sender_name,
       artwork_id,artwork_version_id,source_modified_at,last_seen_at,updated_at)
      -- $1 feeds source_key (varchar) and path (text); without the cast Postgres
      -- cannot deduce one type for the parameter and rejects the statement (42P08).
      VALUES ('nextcloud',$1::text,$1::text,$2,$3,$4,$5,$6,NULL,$7,$8,$9,TRUE,$10,$11,$12,FALSE,FALSE,
              $13,$14,$15,$16,$17,$18,$19,$20,NOW(),NOW(),NOW()) RETURNING id`,
    [allocated.path, allocated.folder, allocated.fileName, mime, file.buffer.length, put.etag || null,
      vault.inferType(allocated.path, allocated.fileName), allocated.code, kind.code,
      vault.inferStatus(kind.code), kind.code === 'GS', allocated.version,
      asset.lead_id, asset.customer_id, asset.order_id, asset.sales_agent_id,
      asset.designer_id, asset.sender_name, asset.artwork_id, asset.artwork_version_id])

    await client.query('COMMIT')
    return {
      asset_id: inserted.rows[0].id,
      path: allocated.path,
      file_name: allocated.fileName,
      version_no: allocated.version,
      created_new_file: true,
      lifecycle_code: kind.code,
      stage: kind.code,
      studio_token: issueToken(inserted.rows[0].id, savedBy),
    }
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
}

module.exports = {
  issueToken, verifyToken, issueVaultToken, issueTokenForAsset,
  vaultPayload, vaultFacets, vaultRevision, assetPreview, handoffToken,
  assetPayload, assetContent, saveEditedArtwork,
}
