const svc = require('./nextcloud.service')
const { getConfig } = require('../../config/nextcloud')
const logger = require('../../utils/logger')
const { success } = require('../../utils/response')

// Health / connection test — surfaces exactly why a connection fails so the
// integration can be verified without guesswork.
async function status(req, res, next) {
  try {
    const result = await svc.testConnection()
    return res.status(result.ok ? 200 : (result.configured ? 502 : 200)).json({ success: result.ok, data: result })
  } catch (err) {
    // A failed test is information, not a crash — report it as data.
    return res.status(200).json({
      success: false,
      data: { configured: getConfig().configured, ok: false, status: err.statusCode || 502, message: err.message },
    })
  }
}

async function listFolder(req, res, next) {
  try {
    const entries = await svc.listFolder(req.query.path || '')
    return success(res, { path: req.query.path || '', entries })
  } catch (err) { next(err) }
}

async function scan(req, res, next) {
  try {
    const files = await svc.scanWatched(Number(req.query.depth) || 4)
    return success(res, { count: files.length, files })
  } catch (err) { next(err) }
}

// Streams a Nextcloud file's bytes through the API so the browser never holds
// Nextcloud credentials.
async function download(req, res, next) {
  try {
    const relPath = req.query.path
    if (!relPath) return res.status(400).json({ success: false, message: 'path is required' })
    const ncRes = await svc.downloadFile(relPath)
    res.setHeader('Content-Type', ncRes.headers.get('content-type') || 'application/octet-stream')
    const len = ncRes.headers.get('content-length')
    if (len) res.setHeader('Content-Length', len)
    const buf = Buffer.from(await ncRes.arrayBuffer())
    return res.send(buf)
  } catch (err) { next(err) }
}

async function preview(req, res, next) {
  try {
    const relPath = req.query.path
    if (!relPath) return res.status(400).json({ success: false, message: 'path is required' })
    const ncRes = await svc.getPreview(relPath, {
      width: Number(req.query.w) || 300,
      height: Number(req.query.h) || 300,
    })
    res.setHeader('Content-Type', ncRes.headers.get('content-type') || 'image/png')
    res.setHeader('Cache-Control', 'private, max-age=300')
    const buf = Buffer.from(await ncRes.arrayBuffer())
    return res.send(buf)
  } catch (err) { next(err) }
}

async function upload(req, res, next) {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'Choose a file to upload' })
    const uploaded = await svc.uploadFile(req.file, req.body?.folder || 'Unsorted')
    const vault = require('../artworks/artwork-vault.service')
    const sync = await vault.sync({ force: true })
    return success(res, { ...uploaded, sync }, 'File uploaded to Nextcloud')
  } catch (err) { next(err) }
}

// Receives Nextcloud file events. Authenticated by a shared secret (NOT JWT),
// because Nextcloud — not a logged-in user — is the caller. UI/DB sync wiring
// is added in the next phase; for now the event is validated and logged.
async function webhook(req, res, next) {
  try {
    const cfg = getConfig()
    const provided = req.get('x-webhook-secret') || req.query.secret
    if (!cfg.webhookSecret || provided !== cfg.webhookSecret) {
      return res.status(401).json({ success: false, message: 'Invalid webhook secret' })
    }
    logger.info({ event: req.body?.event, path: req.body?.node?.path || req.body?.path }, 'Nextcloud webhook received')
    // Keep the searchable vault index current. The full scan is de-duplicated
    // by the vault service, so webhook bursts cannot start parallel scans.
    const vault = require('../artworks/artwork-vault.service')
    await vault.sync({ force: true })
    return res.status(200).json({ success: true })
  } catch (err) { next(err) }
}

module.exports = { status, listFolder, scan, download, upload, preview, webhook }
