// Artwork in object storage averages several megabytes an image. A print layout
// that embeds the originals turned a ten-line sales order into a 30–40 MB PDF,
// which is too big to email. The backend can hand back a resized copy of the
// same object, so the printed page carries a picture sized for the cell it sits
// in rather than the full press-ready file.
//
// Only paths served out of our own storage are rewritten. A data:/blob: URL, an
// absolute link to somewhere else, or an empty value is returned untouched.
const STORAGE_PREFIX = '/storage/'

export function storageThumb(src: string | null | undefined, width = 480): string {
  const value = String(src ?? '').trim()
  if (!value) return ''
  if (/^(data|blob):/i.test(value)) return value
  const path = value.startsWith(STORAGE_PREFIX)
    ? value
    : (() => {
        try { const u = new URL(value, window.location.origin); return u.pathname.startsWith(STORAGE_PREFIX) ? u.pathname : '' }
        catch { return '' }
      })()
  if (!path) return value
  return `/api/artworks/storage-thumb?src=${encodeURIComponent(path)}&w=${width}`
}
