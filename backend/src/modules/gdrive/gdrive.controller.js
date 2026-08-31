const svc = require('./gdrive.service')
const { getConfig } = require('../../config/gdrive')
const { uploadFile } = require('../../config/storage')
const { readArtworkDimensions } = require('../../utils/artworkDimensions')
const { success } = require('../../utils/response')

// Attaching copies the picture out of Drive; anything larger than this is a
// working file, not an order-line artwork, and would stall the request.
const MAX_ATTACH_BYTES = 60 * 1024 * 1024

// Health / connection test — reports exactly why Drive is unreachable so the
// integration can be checked without guesswork. A failed test is information,
// not a crash, so it answers 200 with ok:false.
async function status(req, res) {
  const result = await svc.status()
  return res.status(200).json({ success: result.ok, data: result })
}

async function customers(req, res, next) {
  try {
    const rows = await svc.listCustomers({ search: req.query.search || '' })
    return success(res, { count: rows.length, rows: rows.map(({ id, name }) => ({ id, name })) })
  } catch (err) { next(err) }
}

// The panel's main call: one customer's pictures, with the folder tabs.
async function files(req, res, next) {
  try {
    const data = await svc.listCustomerFiles({
      folderId: req.query.folder_id || '',
      customer: req.query.customer || '',
      folder:   req.query.folder || '',
      search:   req.query.search || '',
      limit:    req.query.limit,
    })
    return success(res, data)
  } catch (err) { next(err) }
}

// Streams a Drive thumbnail through the API so the browser never holds a
// Drive token. Private cache only — these are customer artworks.
async function thumb(req, res, next) {
  try {
    if (!req.query.id) return res.status(400).json({ success: false, message: 'id is required' })
    const { buffer, mime } = await svc.thumbnail(req.query.id, req.query.w)
    res.setHeader('Content-Type', mime)
    res.setHeader('Cache-Control', 'private, max-age=300')
    return res.send(buffer)
  } catch (err) { next(err) }
}

async function download(req, res, next) {
  try {
    if (!req.query.id) return res.status(400).json({ success: false, message: 'id is required' })
    const file = await svc.downloadFile(req.query.id)
    res.setHeader('Content-Type', file.mime)
    res.setHeader('Content-Length', file.buffer.length)
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(file.name)}"`)
    return res.send(file.buffer)
  } catch (err) { next(err) }
}

// POST /api/drive/attach — the drop target's endpoint.
//
// Copies the Drive file into the CRM's own storage and answers with the exact
// same body as POST /api/upload/image ({ url, dimensions }), so an artwork
// dragged from Drive behaves like one uploaded from the desktop: the order
// keeps a stable public URL of its own and stays intact even if the Drive
// file is later moved, renamed, or unshared.
async function attach(req, res, next) {
  try {
    const fileId = req.body?.file_id
    if (!fileId) return res.status(400).json({ error: 'file_id is required' })

    const meta = await svc.getFile(fileId)
    if (!svc.isAttachable(meta)) {
      return res.status(400).json({ error: `${meta.name} is not an image the order line can display. Use JPG, PNG, WEBP, TIFF or SVG.` })
    }
    if (Number(meta.size) > MAX_ATTACH_BYTES) {
      return res.status(400).json({ error: `${meta.name} is larger than 60 MB.` })
    }

    const file = await svc.downloadFile(fileId)
    const dimensions = await readArtworkDimensions(file.buffer)
    const url = await uploadFile(file.buffer, file.name, file.mime, 'item-images')
    return res.json({ url, dimensions, file_name: file.name, source: 'google_drive', drive_file_id: fileId })
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ error: err.message })
    next(err)
  }
}

// Drive listings are memoised for a few minutes. This drops the cache so a
// picture added to Drive a moment ago shows up without waiting it out.
async function refresh(req, res, next) {
  try {
    svc.clearCache()
    return success(res, { cleared: true, root_folder: getConfig().rootFolderName }, 'Drive listing refreshed')
  } catch (err) { next(err) }
}

module.exports = { status, customers, files, thumb, download, attach, refresh }
