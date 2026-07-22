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
    const idx = href.indexOf(davRootPath)
    if (idx !== -1) rel = href.slice(idx + davRootPath.length)
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
async function scanWatched(maxDepth = 4) {
  const cfg = getConfig()
  const roots = cfg.watchFolders.length ? cfg.watchFolders : ['']
  const files = []
  const walk = async (path, depth) => {
    let entries
    try { entries = await listFolder(path) }
    catch (err) { logger.warn({ err: err.message, path }, 'Nextcloud scan: folder skipped'); return }
    for (const e of entries) {
      if (e.is_dir) { if (depth < maxDepth) await walk(e.path, depth + 1) }
      else files.push(e)
    }
  }
  for (const root of roots) await walk(root, 0)
  return files
}

// Streams a file's bytes (returns the raw fetch Response for piping).
async function downloadFile(relPath) {
  const cfg = getConfig()
  return ncRequest(cfg, 'GET', davUrl(cfg, relPath), { raw: true })
}

// Nextcloud preview (thumbnail) endpoint — proxied so the browser never needs
// Nextcloud credentials. Falls back to the raw file on preview failure.
async function getPreview(relPath, { width = 300, height = 300 } = {}) {
  const cfg = getConfig()
  const enc = encodeURIComponent(`/${relPath.replace(/^\/+/, '')}`)
  const url = `${cfg.baseUrl}/index.php/core/preview.png?file=${enc}&x=${width}&y=${height}&a=1&mode=cover`
  const res = await ncRequest(cfg, 'GET', url, { raw: true })
  if (res.ok && (res.headers.get('content-type') || '').startsWith('image/')) return res
  return downloadFile(relPath) // preview unavailable → serve the original
}

module.exports = { testConnection, listFolder, scanWatched, downloadFile, getPreview }
