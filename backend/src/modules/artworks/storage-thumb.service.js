const sharp = require('sharp')

// Print layouts embed the artwork straight from object storage, at whatever
// resolution it was uploaded. The vault averages ~6 MB an image, so a ten-line
// sales order printed to PDF came out at 30-40 MB — unusable to email.
//
// This serves the same image resized to something a print cell can actually
// show. The bytes come from MinIO over its own public URL, so nothing here
// touches the storage client or its bucket policy.

// MINIO_PUBLIC_URL is the browser-facing prefix ("/storage"), which this
// process cannot fetch. Read the bytes over the internal endpoint instead.
const ORIGIN = `http://${process.env.MINIO_HOST || 'minio'}:${process.env.MINIO_PORT || 9000}`
const BUCKET     = process.env.MINIO_BUCKET || 'decoinks'
const TIMEOUT_MS = Number(process.env.THUMB_TIMEOUT_MS) || 10000
const MAX_WIDTH  = 1600

// The caller hands us the path the record stores, e.g.
// "/storage/decoinks/artworks/<uuid>.png". Only that shape is accepted: no
// absolute URLs, no traversal, nothing outside this bucket.
function resolveKey(src) {
  const raw = String(src || '').trim()
  if (!raw) throw Object.assign(new Error('An image path is required'), { statusCode: 400 })
  if (/^[a-z]+:\/\//i.test(raw)) throw Object.assign(new Error('Only stored image paths are allowed'), { statusCode: 400 })
  const cleaned = raw.replace(/^\/+/, '').replace(/^storage\//, '')
  if (cleaned.includes('..')) throw Object.assign(new Error('Invalid image path'), { statusCode: 400 })
  const prefix = `${BUCKET}/`
  const key = cleaned.startsWith(prefix) ? cleaned.slice(prefix.length) : cleaned
  if (!key || key.includes('..')) throw Object.assign(new Error('Invalid image path'), { statusCode: 400 })
  return key
}

async function thumbnail(src, width) {
  const key = resolveKey(src)
  const w = Math.min(Math.max(Number(width) || 480, 32), MAX_WIDTH)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  let res
  try {
    res = await fetch(`${ORIGIN}/${BUCKET}/${key}`, { signal: controller.signal })
  } catch (e) {
    throw Object.assign(new Error(e.name === 'AbortError' ? 'Image fetch timed out' : 'Could not reach image storage'),
      { statusCode: 504 })
  } finally { clearTimeout(timer) }

  if (!res.ok) {
    throw Object.assign(new Error(res.status === 404 ? 'Image not found' : `Image storage returned ${res.status}`),
      { statusCode: res.status === 404 ? 404 : 502 })
  }

  const original = Buffer.from(await res.arrayBuffer())
  try {
    // withoutEnlargement: a small source stays as it is rather than being blown
    // up to the requested width and gaining bytes for nothing.
    const buffer = await sharp(original)
      .rotate()
      .resize({ width: w, withoutEnlargement: true })
      .webp({ quality: 78 })
      .toBuffer()
    // If the resize somehow produced more bytes than the original (already-tiny
    // images, mostly), send the original instead.
    if (buffer.length < original.length) {
      return { buffer, mime: 'image/webp', key }
    }
  } catch { /* not an image sharp can read — fall through to the original */ }

  return { buffer: original, mime: res.headers.get('content-type') || 'application/octet-stream', key }
}

module.exports = { thumbnail, resolveKey }
