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
const { query, getClient } = require('../../config/db')
const nextcloud = require('../nextcloud/nextcloud.service')
const storage = require('../../config/storage')
const logger = require('../../utils/logger')

const TOKEN_TTL_SECONDS = 7200
const AUDIENCE = 'decoinks-design-studio'
const ISSUER = 'decoinks-printshop'
const PURPOSE = 'design-studio-artwork'

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
  const { rows } = await runner(`SELECT id,source,path,file_name,mime_type,file_size_bytes,etag,version_no
    FROM artwork_vault_assets WHERE id=$1${lock}`, [assetId])
  if (!rows[0]) throw Object.assign(new Error('Vault asset not found'), { statusCode: 404 })
  return rows[0]
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

// Persist an edited artwork. The live row keeps its UUID + path; the bytes it is
// replacing are snapshotted so every prior version stays visible in the drawer.
async function saveEditedArtwork(token, file, userId = null) {
  const { asset_id, user_id } = verifyToken(token)
  const savedBy = userId || user_id || null
  if (!file || !file.buffer || !file.buffer.length) {
    throw Object.assign(new Error('Edited artwork file is required'), { statusCode: 400 })
  }
  const mime = file.mimetype || 'image/png'
  const client = await getClient()
  try {
    await client.query('BEGIN')
    const asset = await loadAsset(asset_id, client)
    const currentVersion = asset.version_no || 0

    // 1) Snapshot the bytes we are about to replace into MinIO + revisions.
    //    A snapshot failure is logged but must not block forward progress; the
    //    overwrite below is what the customer is waiting on.
    try {
      const previous = await readAssetBytes(asset)
      const snapshotUrl = await storage.uploadFile(previous.buffer, asset.file_name, previous.mime, 'artwork-revisions')
      await client.query(`INSERT INTO artwork_vault_revisions
        (asset_id,version_no,storage_path,file_name,mime_type,file_size_bytes,etag,saved_by,source_app)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'design-studio')
        ON CONFLICT (asset_id,version_no) DO NOTHING`,
        [asset.id, currentVersion, snapshotUrl, asset.file_name, previous.mime, previous.buffer.length, asset.etag, savedBy])
    } catch (snapErr) {
      logger.warn(`Studio save: could not snapshot V${currentVersion} of ${asset.id}: ${snapErr.message}`)
    }

    // 2) Overwrite the live file in place, keeping the stable path.
    let newEtag = asset.etag
    if (asset.source === 'nextcloud') {
      const put = await nextcloud.putFileAtPath(asset.path, file.buffer, mime)
      newEtag = put.etag || null
    } else {
      const url = await storage.uploadFile(file.buffer, asset.file_name, mime, 'artwork-live')
      await client.query(`UPDATE artwork_vault_assets SET path=$2 WHERE id=$1`, [asset.id, url])
    }

    // 3) Bump the live version + refresh metadata.
    const nextVersion = currentVersion + 1
    const updated = await client.query(`UPDATE artwork_vault_assets
      SET version_no=$2,file_size_bytes=$3,mime_type=$4,etag=$5,source_modified_at=NOW(),updated_at=NOW()
      WHERE id=$1 RETURNING version_no`, [asset.id, nextVersion, file.buffer.length, mime, newEtag])

    await client.query('COMMIT')
    return { version_no: updated.rows[0].version_no, revision_created: currentVersion }
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
}

module.exports = { issueToken, verifyToken, issueTokenForAsset, assetPayload, assetContent, saveEditedArtwork }
