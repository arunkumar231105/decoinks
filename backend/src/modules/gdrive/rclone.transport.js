// ── Drive access through the server's rclone remote ─────────────────────────
//
// `rclone rcd --rc-serve` puts two things on a local port: a JSON API for
// listing a remote, and a plain GET that streams an object's bytes. That is
// everything the artwork picker needs, and it reuses the Drive authorisation
// the shop's copy scripts already run on.
//
// A "ref" in this transport is the object's path inside the remote, e.g.
// "DECOINKS_ORDERS/Kyle Morris/order1_280426/front.png". Refs come back to us
// from the browser, so every one of them is checked against the configured
// root before it is used.

const { getConfig, DriveError, toDriveError } = require('../../config/gdrive')

function authHeader(cfg) {
  if (!cfg.rcloneUser) return {}
  return { Authorization: 'Basic ' + Buffer.from(`${cfg.rcloneUser}:${cfg.rclonePass}`).toString('base64') }
}

async function rcRequest(path, body) {
  const cfg = getConfig()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs)
  try {
    const res = await fetch(`${cfg.rcloneUrl}/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader(cfg) },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    const text = await res.text()
    if (!res.ok) {
      let message = `rclone returned ${res.status}`
      try { message = JSON.parse(text).error || message } catch { /* keep the status */ }
      const notFound = /directory not found|object not found/i.test(message)
      throw new DriveError(notFound ? 'Not found in Google Drive' : `Google Drive listing failed: ${message}`,
        notFound ? 404 : (res.status === 401 ? 401 : 502))
    }
    return JSON.parse(text)
  } catch (err) {
    if (err.name === 'AbortError') throw new DriveError('Google Drive request timed out', 504, err)
    throw toDriveError(err, 'Could not reach the Drive bridge (rclone)')
  } finally {
    clearTimeout(timer)
  }
}

// Path segments are encoded one by one so spaces and "#" survive but the
// folder separators do not get escaped away.
function encodePath(path) {
  return String(path).split('/').map(encodeURIComponent).join('/')
}

// Everything the browser sends is a path. Keep it inside the root folder and
// free of traversal, so a crafted ref cannot read another part of the drive.
function assertInsideRoot(ref) {
  const cfg = getConfig()
  const clean = String(ref || '').replace(/^\/+/, '')
  if (!clean || clean.includes('..')) throw new DriveError('Invalid Drive path', 400)
  if (clean !== cfg.rootFolderName && !clean.startsWith(`${cfg.rootFolderName}/`)) {
    throw new DriveError('That file is outside the artwork folder', 403)
  }
  return clean
}

function mapEntry(entry) {
  return {
    ref: entry.Path,
    name: entry.Name,
    is_dir: Boolean(entry.IsDir),
    mime_type: entry.IsDir ? null : (entry.MimeType || null),
    size: Number(entry.Size) || 0,
    modified_at: entry.ModTime || null,
    drive_id: entry.ID || null,
    width: null,
    height: null,
  }
}

async function resolveRoot() {
  return getConfig().rootFolderName
}

// Direct sub-folders of a folder — the customer list.
async function listFolders(ref) {
  const cfg = getConfig()
  const data = await rcRequest('operations/list', {
    fs: cfg.rcloneRemote,
    remote: assertInsideRoot(ref),
    opt: { dirsOnly: true },
  })
  return (data.list || []).map(mapEntry)
}

// Every file under a folder, in one call. rclone walks the tree server-side,
// which is the whole reason this transport is cheap: one request returns a
// customer's several hundred artworks instead of a request per sub-folder.
async function walk(ref) {
  const cfg = getConfig()
  const base = assertInsideRoot(ref)
  const data = await rcRequest('operations/list', {
    fs: cfg.rcloneRemote,
    remote: base,
    opt: { recurse: true, filesOnly: true },
  })
  return (data.list || []).map(entry => {
    const mapped = mapEntry(entry)
    // Path is relative to the remote root, so the sub-folder a file sits in is
    // the first segment after the folder being walked.
    const relative = mapped.ref.startsWith(`${base}/`) ? mapped.ref.slice(base.length + 1) : mapped.name
    const parts = relative.split('/')
    mapped.folder = parts.length > 1 ? parts[0] : '(root)'
    return mapped
  })
}

async function getMeta(ref) {
  const cfg = getConfig()
  const clean = assertInsideRoot(ref)
  const parent = clean.split('/').slice(0, -1).join('/')
  const data = await rcRequest('operations/list', { fs: cfg.rcloneRemote, remote: parent, opt: { filesOnly: true } })
  const found = (data.list || []).find(entry => entry.Path === clean)
  if (!found) throw new DriveError('Not found in Google Drive', 404)
  return mapEntry(found)
}

// Bytes come straight off the bridge. The name is the path's last segment and
// the mime comes back on the response, so a download costs one request — no
// metadata listing first, which on a folder of several hundred artworks was
// the slowest part of showing a single thumbnail.
async function download(ref) {
  const cfg = getConfig()
  const clean = assertInsideRoot(ref)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs * 3)   // bytes, not metadata
  try {
    const res = await fetch(`${cfg.rcloneUrl}/[${cfg.rcloneRemote}]/${encodePath(clean)}`, {
      headers: authHeader(cfg),
      signal: controller.signal,
    })
    if (!res.ok) throw new DriveError(`Google Drive returned ${res.status} for this file`, res.status === 404 ? 404 : 502)
    const buffer = Buffer.from(await res.arrayBuffer())
    return {
      buffer,
      mime: res.headers.get('content-type') || 'application/octet-stream',
      name: clean.split('/').pop(),
      size: buffer.length,
    }
  } catch (err) {
    if (err.name === 'AbortError') throw new DriveError('Downloading the Drive file timed out', 504, err)
    throw toDriveError(err, 'Could not download the Drive file')
  } finally {
    clearTimeout(timer)
  }
}

// rclone cannot hand out Google's own thumbnails, so the service resizes the
// original itself. Returning null is how it is told to do that.
async function nativeThumbnail() {
  return null
}

async function ping() {
  const cfg = getConfig()
  const data = await rcRequest('core/version', {})
  return { bridge: 'rclone', version: data.version || null, remote: cfg.rcloneRemote }
}

module.exports = { resolveRoot, listFolders, walk, getMeta, download, nativeThumbnail, ping }
