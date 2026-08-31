// ── Google Drive artwork browser ────────────────────────────────────────────
//
// The shop keeps every customer's artwork in one Drive tree:
//
//   DECOINKS_ORDERS/
//     <Customer Name>/
//       _Artworks/            every artwork ever sent for that customer
//       order1_280426/        per-order folders (orderN_ddmmyy)
//
// This is the read side of that tree for the order screen's artwork picker:
// list the customer folders, list one customer's pictures, and hand over the
// bytes when a user drops one onto an order line.
//
// How it reaches Drive — rclone bridge or Google's API — is the transport's
// business (see config/gdrive.js). Everything here is transport-agnostic:
// caching, matching a CRM customer to a folder, filtering, and thumbnails.
//
// Two things keep it cheap enough to sit behind a UI panel:
//   1. Every listing is memoised for a few minutes (`CACHE_TTL_MS`) — the tree
//      changes rarely, but the panel is opened constantly.
//   2. A customer's pictures are fetched once as a whole and filtered in
//      memory, so typing in the search box costs no Drive calls at all.

const sharp = require('sharp')
const { getConfig, DriveError } = require('../../config/gdrive')
const logger = require('../../utils/logger')

const CACHE_TTL_MS = 3 * 60 * 1000
const MAX_FILES = 1000

// Thumbnails are generated from the original when the transport has none of
// its own. Above this size that decode is too expensive to do on request — the
// tile falls back to a file-type badge instead.
const MAX_THUMB_SOURCE_BYTES = 80 * 1024 * 1024
const THUMB_CACHE_MAX = 300

// Only formats sharp can decode are offered, because attaching an artwork runs
// it through the same size detection a manual upload does. The PSD/AI/PDF
// files sitting in the same folders cannot become an order-line thumbnail.
const ATTACHABLE_MIME = /^image\/(jpeg|jpg|png|webp|gif|tiff|svg\+xml|avif)$/i
const ATTACHABLE_EXT = /\.(jpe?g|png|webp|gif|tiff?|svg|avif)$/i

const cache = new Map()
const thumbCache = new Map()

function transport() {
  const cfg = getConfig()
  if (cfg.mode === 'rclone') return require('./rclone.transport')
  if (cfg.mode === 'api') return require('./api.transport')
  throw new DriveError('Google Drive is not configured on the server', 503)
}

async function cached(key, producer) {
  const hit = cache.get(key)
  if (hit && hit.expires > Date.now()) return hit.value
  const value = await producer()
  cache.set(key, { value, expires: Date.now() + CACHE_TTL_MS })
  return value
}

function clearCache() {
  cache.clear()
  thumbCache.clear()
}

// "Kyle  Morris." and "kyle_morris" must reach the same folder — Drive folder
// names were typed by hand, the CRM name comes from the customer record.
function normalizeName(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

function isAttachable(file) {
  return ATTACHABLE_MIME.test(file.mime_type || '') || ATTACHABLE_EXT.test(file.name || '')
}

function hydrate(file) {
  return {
    id: file.ref,
    name: file.name,
    mime_type: file.mime_type,
    size: file.size,
    modified_at: file.modified_at,
    folder: file.folder || '(root)',
    width: file.width,
    height: file.height,
    thumbnail_url: `/api/drive/thumb?id=${encodeURIComponent(file.ref)}`,
    download_url: `/api/drive/download?id=${encodeURIComponent(file.ref)}`,
  }
}

// Every customer folder under the root. `search` is applied in memory so the
// picker's type-ahead never hits Drive.
async function listCustomers({ search = '' } = {}) {
  const root = await cached('root', () => transport().resolveRoot())
  const folders = await cached(`customers:${root}`, async () => {
    const rows = await transport().listFolders(root)
    return rows
      .map(row => ({ id: row.ref, name: row.name, normalized: normalizeName(row.name) }))
      .sort((a, b) => a.name.localeCompare(b.name))
  })
  const term = normalizeName(search)
  return term ? folders.filter(row => row.normalized.includes(term)) : folders
}

// Match a CRM customer name to its Drive folder. Exact normalised name first,
// then containment — so "Kyle Morris" still finds "Kyle Morris (DTF)", while a
// two-letter fragment never matches half the shop.
async function findCustomerFolder(customerName) {
  const term = normalizeName(customerName)
  if (term.length < 3) return null
  const folders = await listCustomers()
  return folders.find(row => row.normalized === term)
      || folders.find(row => row.normalized.includes(term) || term.includes(row.normalized))
      || null
}

async function walkCustomer(folderId) {
  return cached(`files:${folderId}`, async () => {
    const files = (await transport().walk(folderId)).filter(isAttachable)
    files.sort((a, b) => String(b.modified_at || '').localeCompare(String(a.modified_at || '')))
    if (files.length > MAX_FILES) {
      logger.info({ folderId, found: files.length }, 'Drive picker: file cap reached, listing truncated')
      return { files: files.slice(0, MAX_FILES), truncated: true }
    }
    return { files, truncated: false }
  })
}

// One customer's pictures. Either `folderId` (the folder the user picked in
// the panel) or `customer` (the name on the order) identifies the folder.
async function listCustomerFiles({ folderId = '', customer = '', folder = '', search = '', limit = 120 } = {}) {
  const target = folderId
    ? { id: folderId, name: customer || '' }
    : await findCustomerFolder(customer)

  if (!target) {
    return { matched: false, customer_folder: null, folders: [], files: [], total: 0, truncated: false }
  }

  const walked = await walkCustomer(target.id)
  const term = String(search || '').trim().toLowerCase()

  let files = walked.files
  if (folder) files = files.filter(file => (file.folder || '(root)') === folder)
  if (term) files = files.filter(file => file.name.toLowerCase().includes(term))

  const folderCounts = new Map()
  for (const file of walked.files) {
    const key = file.folder || '(root)'
    folderCounts.set(key, (folderCounts.get(key) || 0) + 1)
  }

  return {
    matched: true,
    customer_folder: { id: target.id, name: target.name },
    folders: [...folderCounts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => (a.name === '(root)' ? -1 : b.name === '(root)' ? 1 : a.name.localeCompare(b.name))),
    files: files.slice(0, Math.min(Math.max(Number(limit) || 120, 1), 500)).map(hydrate),
    total: files.length,
    truncated: walked.truncated,
  }
}

// A file's details, preferring the listing already in hand. Asking the
// transport again means another folder listing, which on a customer with a few
// hundred artworks is by far the most expensive call in the module.
function cachedMeta(fileId) {
  for (const entry of cache.values()) {
    const files = entry.value?.files
    if (!Array.isArray(files)) continue
    const found = files.find(file => file.ref === fileId)
    if (found) return found
  }
  return null
}

async function getFile(fileId) {
  return cachedMeta(fileId) || transport().getMeta(fileId)
}

async function downloadFile(fileId) {
  return transport().download(fileId)
}

// Drive's own thumbnail where the transport has one; otherwise the original is
// resized here and the result kept in a small LRU, because the same tiles are
// re-rendered every time the panel is reopened.
async function thumbnail(fileId, width = 320) {
  const size = Math.min(Math.max(Number(width) || 320, 64), 1024)
  const key = `${fileId}:${size}`
  const hit = thumbCache.get(key)
  if (hit) {
    thumbCache.delete(key)          // refresh recency
    thumbCache.set(key, hit)
    return hit
  }

  const native = await transport().nativeThumbnail(fileId, size)
  if (native) return remember(key, native)

  const known = cachedMeta(fileId)
  if (known && known.size > MAX_THUMB_SOURCE_BYTES) {
    throw new DriveError('This file is too large to preview', 413)
  }

  const file = await transport().download(fileId)
  if (file.size > MAX_THUMB_SOURCE_BYTES) {
    throw new DriveError('This file is too large to preview', 413)
  }
  try {
    const buffer = await sharp(file.buffer)
      .rotate()
      .resize({ width: size, withoutEnlargement: true })
      .webp({ quality: 78 })
      .toBuffer()
    return remember(key, { buffer, mime: 'image/webp' })
  } catch (err) {
    logger.warn({ fileId, err: err.message }, 'Drive picker: could not resize preview, serving the original')
    return { buffer: file.buffer, mime: file.mime }
  }
}

function remember(key, value) {
  thumbCache.set(key, value)
  while (thumbCache.size > THUMB_CACHE_MAX) {
    thumbCache.delete(thumbCache.keys().next().value)
  }
  return value
}

async function status() {
  const cfg = getConfig()
  if (!cfg.configured) {
    return {
      configured: false,
      ok: false,
      mode: 'none',
      message: 'Set GOOGLE_DRIVE_RCLONE_URL (rclone bridge) or GOOGLE_DRIVE_CLIENT_ID/_SECRET/_REFRESH_TOKEN (Drive API)',
    }
  }
  try {
    const ping = await transport().ping()
    const customers = await listCustomers()
    return {
      configured: true,
      ok: true,
      mode: cfg.mode,
      root_folder: cfg.rootFolderName,
      customer_folders: customers.length,
      ...ping,
    }
  } catch (err) {
    return { configured: true, ok: false, mode: cfg.mode, status: err.statusCode || 502, message: err.message }
  }
}

module.exports = {
  listCustomers,
  findCustomerFolder,
  listCustomerFiles,
  getFile,
  downloadFile,
  thumbnail,
  isAttachable,
  status,
  clearCache,
  normalizeName,
}
