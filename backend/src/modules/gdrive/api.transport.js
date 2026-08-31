// ── Drive access through Google's own API ───────────────────────────────────
//
// The direct path: an OAuth client of the shop's own plus a refresh token.
// Preferred over the rclone bridge once such a client exists, because it needs
// no local daemon and Google serves the thumbnails itself.
//
// A "ref" in this transport is a Drive file id.

const { google } = require('googleapis')
const { getConfig, DriveError, toDriveError } = require('../../config/gdrive')

const FOLDER_MIME = 'application/vnd.google-apps.folder'
const FILE_FIELDS = 'id,name,mimeType,size,modifiedTime,thumbnailLink,imageMediaMetadata(width,height)'

// Walking the tree is bounded: Drive has no recursive query, so a folder per
// request is the only option, and one oversized customer must not turn opening
// the panel into a hundred round trips.
const MAX_DEPTH = 3
const MAX_FOLDERS = 80

let cachedClient = null
let cachedKey = ''

function authClient() {
  const cfg = getConfig()
  if (!cfg.clientId || !cfg.clientSecret || !cfg.refreshToken) {
    throw new DriveError('Google Drive API credentials are not configured', 503)
  }
  const key = `${cfg.clientId}:${cfg.refreshToken.slice(-12)}`
  if (!cachedClient || cachedKey !== key) {
    const client = new google.auth.OAuth2(cfg.clientId, cfg.clientSecret)
    client.setCredentials({ refresh_token: cfg.refreshToken })
    cachedClient = client
    cachedKey = key
  }
  return cachedClient
}

function drive() {
  return google.drive({ version: 'v3', auth: authClient(), timeout: getConfig().timeoutMs })
}

function mapFile(file) {
  return {
    ref: file.id,
    name: file.name,
    is_dir: file.mimeType === FOLDER_MIME,
    mime_type: file.mimeType === FOLDER_MIME ? null : (file.mimeType || null),
    size: Number(file.size) || 0,
    modified_at: file.modifiedTime || null,
    drive_id: file.id,
    width: file.imageMediaMetadata?.width || null,
    height: file.imageMediaMetadata?.height || null,
  }
}

async function listChildren(parentRef, { foldersOnly = false } = {}) {
  const clauses = [`'${parentRef}' in parents`, 'trashed = false']
  if (foldersOnly) clauses.push(`mimeType = '${FOLDER_MIME}'`)
  const out = []
  let pageToken
  do {
    let page
    try {
      page = await drive().files.list({
        q: clauses.join(' and '),
        fields: `nextPageToken, files(${FILE_FIELDS})`,
        pageSize: 1000,
        orderBy: 'folder,name',
        pageToken,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      })
    } catch (err) {
      throw toDriveError(err, 'Could not list a Google Drive folder')
    }
    out.push(...(page.data.files || []))
    pageToken = page.data.nextPageToken
  } while (pageToken && out.length < 5000)
  return out.map(mapFile)
}

async function resolveRoot() {
  const cfg = getConfig()
  if (cfg.rootFolderId) return cfg.rootFolderId
  try {
    const res = await drive().files.list({
      q: `name = '${cfg.rootFolderName.replace(/'/g, "\\'")}' and mimeType = '${FOLDER_MIME}' and trashed = false`,
      fields: 'files(id,name)',
      pageSize: 10,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    })
    const folder = (res.data.files || [])[0]
    if (!folder) throw new DriveError(`Drive folder "${cfg.rootFolderName}" was not found`, 404)
    return folder.id
  } catch (err) {
    throw toDriveError(err, 'Could not find the Drive root folder')
  }
}

async function listFolders(ref) {
  return listChildren(ref, { foldersOnly: true })
}

// Breadth-first walk, tagging each file with the top-level sub-folder it came
// from so the picker can offer folder tabs.
async function walk(ref) {
  const files = []
  const queue = [{ ref, depth: 1, top: '(root)' }]
  let visited = 0

  while (queue.length && visited < MAX_FOLDERS) {
    const current = queue.shift()
    visited += 1
    const children = await listChildren(current.ref)
    for (const child of children) {
      if (child.is_dir) {
        const top = current.depth === 1 ? child.name : current.top
        if (current.depth < MAX_DEPTH) queue.push({ ref: child.ref, depth: current.depth + 1, top })
        continue
      }
      files.push({ ...child, folder: current.depth === 1 ? '(root)' : current.top })
    }
  }
  return files
}

async function getMeta(ref) {
  try {
    const res = await drive().files.get({ fileId: ref, fields: FILE_FIELDS, supportsAllDrives: true })
    return mapFile(res.data)
  } catch (err) {
    throw toDriveError(err, 'Could not read the Drive file')
  }
}

async function download(ref) {
  const meta = await getMeta(ref)
  try {
    const res = await drive().files.get(
      { fileId: ref, alt: 'media', supportsAllDrives: true },
      { responseType: 'arraybuffer' },
    )
    return { buffer: Buffer.from(res.data), mime: meta.mime_type || 'application/octet-stream', name: meta.name, size: meta.size }
  } catch (err) {
    throw toDriveError(err, 'Could not download the Drive file')
  }
}

// Google keeps a thumbnail for most artwork formats, which is far cheaper than
// pulling a 30 MB source through the API to resize it here.
async function nativeThumbnail(ref, width = 320) {
  let meta
  try {
    const res = await drive().files.get({ fileId: ref, fields: 'thumbnailLink', supportsAllDrives: true })
    meta = res.data
  } catch (err) {
    throw toDriveError(err, 'Could not read the Drive thumbnail')
  }
  if (!meta.thumbnailLink) return null
  const size = Math.min(Math.max(Number(width) || 320, 64), 1024)
  const url = meta.thumbnailLink.replace(/=s\d+(-c)?$/, '') + `=s${size}`
  const { token } = await authClient().getAccessToken()
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) return null
  return { buffer: Buffer.from(await res.arrayBuffer()), mime: res.headers.get('content-type') || 'image/jpeg' }
}

async function ping() {
  const { token } = await authClient().getAccessToken()
  if (!token) throw new DriveError('Google Drive did not return an access token', 401)
  return { bridge: 'api' }
}

module.exports = { resolveRoot, listFolders, walk, getMeta, download, nativeThumbnail, ping }
