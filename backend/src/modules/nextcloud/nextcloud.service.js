// ── Nextcloud service ────────────────────────────────────────────────────────
// High-level operations built on the WebDAV request wrapper: connection test,
// directory listing (PROPFIND), file download, and thumbnail preview. All the
// "strong connectivity" concerns (auth, timeout, retry) live in config/nextcloud.

const { getConfig, davUrl, ncRequest, NextcloudError } = require('../../config/nextcloud')
const logger = require('../../utils/logger')

// WebDAV PROPFIND XML is predictable; a focused parser avoids an XML dependency.
function unescapeXml(s) {
  return String(s)
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
}

function tag(block, name) {
  // matches <d:name>...</d:name> or <name>...</name> regardless of prefix
  const m = block.match(new RegExp(`<[^>]*${name}[^>]*>([\\s\\S]*?)</[^>]*${name}>`, 'i'))
  return m ? unescapeXml(m[1].trim()) : null
}

// Nextcloud answers a SEARCH with hrefs keyed to the *user id* (".../files/adil/…")
// even when we authenticate with the e-mail alias, so an exact-prefix match is
// not always possible. This is the generic fallback.
const DAV_FILES_PREFIX = /^.*?\/remote\.php\/dav\/files\/[^/]+\//

function parsePropfind(xml, davRootPath) {
  const entries = []
  const responseBlocks = xml.match(/<[^>]*:response[\s>][\s\S]*?<\/[^>]*:response>/gi) || []
  for (const block of responseBlocks) {
    const hrefRaw = tag(block, 'href')
    if (!hrefRaw) continue
    let href = hrefRaw
    try { href = decodeURIComponent(hrefRaw) } catch { /* keep raw */ }

    const isCollection = /<[^>]*:collection\s*\/?>/i.test(block)
    // Path relative to the bot user's WebDAV root
    let rel = href
    const idx = davRootPath ? href.indexOf(davRootPath) : -1
    if (idx !== -1) rel = href.slice(idx + davRootPath.length)
    else if (DAV_FILES_PREFIX.test(href)) rel = href.replace(DAV_FILES_PREFIX, '')
    rel = rel.replace(/^\/+|\/+$/g, '')

    const name = rel.split('/').filter(Boolean).pop() || rel
    entries.push({
      path: rel,
      name,
      is_dir: isCollection,
      etag: (tag(block, 'getetag') || '').replace(/"/g, '') || null,
      size: Number(tag(block, 'getcontentlength')) || 0,
      mime_type: tag(block, 'getcontenttype') || null,
      modified: tag(block, 'getlastmodified') || null,
      fileid: tag(block, 'fileid') || null,
    })
  }
  return entries
}

const PROPFIND_BODY = `<?xml version="1.0"?>
<d:propfind xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns">
  <d:prop>
    <d:getlastmodified/>
    <d:getetag/>
    <d:getcontenttype/>
    <d:getcontentlength/>
    <d:resourcetype/>
    <oc:fileid/>
  </d:prop>
</d:propfind>`

// Verifies the credentials + reachability by PROPFIND-ing the user root.
async function testConnection() {
  const cfg = getConfig()
  if (!cfg.configured) {
    return { configured: false, ok: false, message: 'Set NEXTCLOUD_URL, NEXTCLOUD_USER and NEXTCLOUD_APP_PASSWORD in the backend .env' }
  }
  const started = Date.now()
  const res = await ncRequest(cfg, 'PROPFIND', davUrl(cfg, ''), {
    headers: { Depth: '0', 'Content-Type': 'application/xml' },
    body: PROPFIND_BODY,
  })
  const ok = res.status === 207 || res.status === 200
  return {
    configured: true,
    ok,
    status: res.status,
    latency_ms: Date.now() - started,
    base_url: cfg.baseUrl,
    user: cfg.user,
    watch_folders: cfg.watchFolders,
    secure: cfg.baseUrl.startsWith('https://'),
    message: ok ? 'Connected to Nextcloud' : `Unexpected status ${res.status}`,
  }
}

// Lists one folder (Depth: 1). The folder itself is the first PROPFIND entry
// and is dropped, so only children are returned.
async function listFolder(relPath = '') {
  const cfg = getConfig()
  const res = await ncRequest(cfg, 'PROPFIND', davUrl(cfg, relPath), {
    headers: { Depth: '1', 'Content-Type': 'application/xml' },
    body: PROPFIND_BODY,
  })
  if (res.status !== 207 && res.status !== 200) {
    throw new NextcloudError(`Listing failed with status ${res.status}`, 502)
  }
  // Decode the root path: hrefs come back decoded (e.g. "@" not "%40"), so the
  // prefix we strip must be decoded too, otherwise usernames with special
  // characters break relative-path resolution.
  let davRootPath = new URL(cfg.davRoot).pathname
  try { davRootPath = decodeURIComponent(davRootPath) } catch { /* keep as-is */ }
  const target = relPath.replace(/^\/+|\/+$/g, '')
  return parsePropfind(res.text, davRootPath)
    .filter(e => e.path !== target) // drop the folder itself
}

// Recursively walk the watched folders, returning every file (not dirs).
async function scanWatched(maxDepth = 4, rootsOverride = null) {
  const cfg = getConfig()
  const roots = Array.isArray(rootsOverride) && rootsOverride.length
    ? rootsOverride
    : (cfg.watchFolders.length ? cfg.watchFolders : [''])
  const files = []
  let directories = roots
  // Process one depth at a time with bounded concurrency. This avoids the old
  // serial walk (too slow for real vaults) without flooding Nextcloud.
  for (let depth = 0; depth <= maxDepth && directories.length; depth++) {
    const next = []
    let cursor = 0
    const worker = async () => {
      while (cursor < directories.length) {
        const path = directories[cursor++]
        let entries
        try { entries = await listFolder(path) }
        catch (err) { logger.warn({ err: err.message, path }, 'Nextcloud scan: folder skipped'); continue }
        for (const entry of entries) {
          if (entry.is_dir) next.push(entry.path)
          else files.push(entry)
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(8, directories.length) }, worker))
    directories = next
  }
  return files
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

// ── Change feed ─────────────────────────────────────────────────────────────
// Nextcloud's webhook_listeners app is registered on this server but its
// callbacks never reach us (verified: a WebDAV PUT produces no delivery), so
// push alone cannot be trusted. WebDAV SEARCH gives the same information as a
// pull: every file under a root modified after a cursor, newest first, in ONE
// request. That is what makes the vault feel live without re-walking 5 800
// files. Webhooks still short-circuit this when they do arrive.
async function searchModifiedSince(relRoot, since, limit = 500) {
  const cfg = getConfig()
  const scope = ['/files', cfg.user, String(relRoot || '').replace(/^\/+|\/+$/g, '')]
    .filter(Boolean).join('/')
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<d:searchrequest xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns">
  <d:basicsearch>
    <d:select><d:prop><d:getlastmodified/><d:getetag/><d:getcontenttype/><d:getcontentlength/><d:resourcetype/><oc:fileid/></d:prop></d:select>
    <d:from><d:scope><d:href>${escapeXml(scope)}</d:href><d:depth>infinity</d:depth></d:scope></d:from>
    <d:where><d:gt><d:prop><d:getlastmodified/></d:prop><d:literal>${escapeXml(new Date(since).toISOString().replace(/\.\d{3}Z$/, 'Z'))}</d:literal></d:gt></d:where>
    <d:orderby><d:order><d:prop><d:getlastmodified/></d:prop><d:ascending/></d:order></d:orderby>
    <d:limit><d:nresults>${Math.max(1, Math.min(2000, Number(limit) || 500))}</d:nresults></d:limit>
  </d:basicsearch>
</d:searchrequest>`
  const res = await ncRequest(cfg, 'SEARCH', `${cfg.baseUrl}/remote.php/dav/`, {
    headers: { 'Content-Type': 'text/xml; charset=utf-8' },
    body,
  })
  if (res.status !== 207 && res.status !== 200) {
    throw new NextcloudError(`Change search failed with status ${res.status}`, 502)
  }
  // Directories carry a propagated mtime too; only real files are indexable.
  return parsePropfind(res.text, '').filter(entry => !entry.is_dir && entry.path)
}

// Streams a file's bytes (returns the raw fetch Response for piping).
async function downloadFile(relPath) {
  const cfg = getConfig()
  return ncRequest(cfg, 'GET', davUrl(cfg, relPath), { raw: true })
}

// Uploads a file into the first watched root so it is immediately visible to
// the same sync/index pipeline. PUT is atomic from the vault's perspective.
async function uploadFile(file, folder = 'Unsorted') {
  const cfg = getConfig()
  const root = cfg.watchFolders[0] || ''
  const safeFolder = String(folder || 'Unsorted').replace(/(^\/+|\/+?$|\.\.)/g, '')
  const safeName = String(file.originalname || 'upload').replace(/[\\/\0]/g, '_')
  const relPath = [root, safeFolder, safeName].filter(Boolean).join('/')
  // Ensure the destination collection exists; 405 means it already exists.
  const collection = [root, safeFolder].filter(Boolean).join('/')
  if (collection) {
    const mk = await ncRequest(cfg, 'MKCOL', davUrl(cfg, collection), { raw: true })
    if (![201, 405].includes(mk.status)) throw new NextcloudError(`Could not create upload folder (${mk.status})`, 502)
  }
  const result = await ncRequest(cfg, 'PUT', davUrl(cfg, relPath), {
    headers: { 'Content-Type': file.mimetype || 'application/octet-stream', 'Content-Length': String(file.buffer.length) },
    body: file.buffer,
    raw: true,
  })
  if (![200, 201, 204].includes(result.status)) throw new NextcloudError(`Upload failed with status ${result.status}`, 502)
  return { path: relPath, name: safeName }
}

// Overwrites an existing file in place at its exact vault path. The Design
// Studio round-trip uses this so an edited asset keeps its stable path and
// identity (unlike uploadFile, which mints a new location).
async function putFileAtPath(relPath, buffer, mimetype = 'application/octet-stream') {
  const cfg = getConfig()
  const result = await ncRequest(cfg, 'PUT', davUrl(cfg, relPath), {
    headers: { 'Content-Type': mimetype, 'Content-Length': String(buffer.length) },
    body: buffer,
    raw: true,
  })
  if (![200, 201, 204].includes(result.status)) throw new NextcloudError(`Overwrite failed with status ${result.status}`, 502)
  return { path: relPath, etag: (result.headers.get('etag') || '').replace(/"/g, '') || null }
}

// Create a file only if that exact path is still free. WebDAV's If-None-Match:*
// makes this atomic, so two designers saving a new version at the same moment
// cannot silently overwrite each other — the loser gets 412 and takes the next
// number instead.
async function putFileIfAbsent(relPath, buffer, mimetype = 'application/octet-stream') {
  const cfg = getConfig()
  const result = await ncRequest(cfg, 'PUT', davUrl(cfg, relPath), {
    headers: { 'Content-Type': mimetype, 'Content-Length': String(buffer.length), 'If-None-Match': '*' },
    body: buffer,
    raw: true,
  })
  if (result.status === 412) return { taken: true }
  if (![200, 201, 204].includes(result.status)) throw new NextcloudError(`Upload failed with status ${result.status}`, 502)
  return { taken: false, path: relPath, etag: (result.headers.get('etag') || '').replace(/"/g, '') || null }
}

async function ensureFolder(relPath) {
  const cfg = getConfig()
  const parts = String(relPath || '').replace(/^\/+|\/+$/g, '').split('/').filter(Boolean)
  let current = ''
  for (const part of parts) {
    current = current ? `${current}/${part}` : part
    const result = await ncRequest(cfg, 'MKCOL', davUrl(cfg, current), { raw: true })
    if (![201, 405].includes(result.status)) throw new NextcloudError(`Could not create folder (${result.status})`, 502)
  }
  return current
}

// Nextcloud preview (thumbnail) endpoint — proxied so the browser never needs
// Nextcloud credentials. Falls back to the raw file on preview failure.
//
// Retries are disabled here on purpose. Nextcloud's preview generator answers
// 500 when several thumbnails are requested at once, and the generic retry
// ladder turned that into a 30-second wait per tile. A failed preview is not
// worth waiting for: dropping straight to the original file is both faster and
// always succeeds.
async function getPreview(relPath, { width = 300, height = 300 } = {}) {
  const cfg = getConfig()
  const enc = encodeURIComponent(`/${relPath.replace(/^\/+/, '')}`)
  const url = `${cfg.baseUrl}/index.php/core/preview.png?file=${enc}&x=${width}&y=${height}&a=1&mode=cover`
  try {
    const res = await ncRequest({ ...cfg, retries: 0, timeoutMs: Math.min(cfg.timeoutMs, 10000) }, 'GET', url, { raw: true })
    if (res.ok && (res.headers.get('content-type') || '').startsWith('image/')) return res
  } catch (err) {
    logger.warn({ err: err.message, path: relPath }, 'Nextcloud preview unavailable — serving the original file')
  }
  return downloadFile(relPath)
}

module.exports = { testConnection, listFolder, scanWatched, searchModifiedSince, downloadFile, uploadFile, putFileAtPath, putFileIfAbsent, ensureFolder, getPreview }
