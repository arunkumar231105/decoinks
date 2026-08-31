// ── Google Drive artwork picker ─────────────────────────────────────────────
//
// A side panel that shows the pictures in the customer's Google Drive folder
// (DECOINKS_ORDERS/<customer>/…). Tiles are dragged straight onto an order
// line's artwork cell, which is what the shop used to do by downloading the
// file from Drive and uploading it again by hand.
//
// The panel only reads. Dropping a tile is what copies the picture into the
// CRM's own storage — see the drop handler on the order page.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { FileImage, FolderOpen, RefreshCw, Search, X } from 'lucide-react'
import { api } from '../services/api'
import '../styles/drive-picker.css'

// Drag payload type. A custom MIME keeps an artwork tile distinguishable from
// a file dragged in off the desktop, which the same cell also accepts.
export const DRIVE_DRAG_TYPE = 'application/x-decoinks-drive-file'

export interface DriveFile {
  id: string
  name: string
  mime_type: string | null
  size: number
  folder: string
  width: number | null
  height: number | null
  thumbnail_url: string
}

interface DriveListing {
  matched: boolean
  customer_folder: { id: string; name: string } | null
  folders: Array<{ name: string; count: number }>
  files: DriveFile[]
  total: number
  truncated: boolean
}

const PAGE_SIZE = 60

function fileSize(bytes = 0) {
  if (!bytes) return ''
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

// Thumbnails come through the API (Drive credentials stay on the server), so
// they cannot be an <img src> — the bytes are fetched with the session's auth
// header and turned into an object URL.
//
// Fetching starts only when the tile is actually scrolled into view: a
// customer folder holds hundreds of artworks, and generating every preview up
// front would pull hundreds of megabytes through the server for nothing.
function DriveThumb({ file }: { file: DriveFile }) {
  const holder = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  const [src, setSrc] = useState('')
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const node = holder.current
    if (!node || visible) return
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        setVisible(true)
        observer.disconnect()
      }
    }, { rootMargin: '200px' })
    observer.observe(node)
    return () => observer.disconnect()
  }, [visible])

  useEffect(() => {
    if (!visible) return
    let objectUrl = ''
    let cancelled = false
    api.get(`/drive/thumb?id=${encodeURIComponent(file.id)}&w=320`, { responseType: 'blob' })
      .then(response => {
        if (cancelled) return
        objectUrl = URL.createObjectURL(response.data)
        setSrc(objectUrl)
      })
      .catch(() => { if (!cancelled) setFailed(true) })
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [visible, file.id])

  return (
    <div className="dap-thumb" ref={holder}>
      {src && !failed
        ? <img src={src} alt={file.name} draggable={false} onError={() => setFailed(true)} />
        : <span className="dap-thumb-fallback"><FileImage size={18} />{failed && <small>no preview</small>}</span>}
    </div>
  )
}

export function DriveArtworkPicker({
  open, customerName, onClose,
}: {
  open: boolean
  customerName: string
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [folder, setFolder] = useState('')
  // Set when the customer has no folder of their own name and one is picked by
  // hand — a Drive folder spelled differently from the CRM customer.
  const [folderId, setFolderId] = useState('')
  const [folderPickerOpen, setFolderPickerOpen] = useState(false)
  const [customerSearch, setCustomerSearch] = useState('')
  const [limit, setLimit] = useState(PAGE_SIZE)
  const [refreshing, setRefreshing] = useState(false)

  // A different customer on the order means a different folder: drop the
  // manual override and any folder tab that belonged to the previous one.
  useEffect(() => {
    setFolderId('')
    setFolder('')
    setSearch('')
    setLimit(PAGE_SIZE)
  }, [customerName])

  const params = useMemo(() => ({
    customer: customerName || undefined,
    folder_id: folderId || undefined,
    folder: folder || undefined,
    search: search.trim() || undefined,
    limit,
  }), [customerName, folderId, folder, search, limit])

  const { data, isLoading, isError, error } = useQuery<DriveListing>({
    queryKey: ['drive-files', params],
    queryFn: () => api.get('/drive/files', { params }).then(r => r.data.data),
    enabled: open && Boolean(customerName || folderId),
    staleTime: 60_000,
  })

  const { data: driveCustomers } = useQuery<{ rows: Array<{ id: string; name: string }> }>({
    queryKey: ['drive-customers', customerSearch],
    queryFn: () => api.get('/drive/customers', { params: { search: customerSearch || undefined } }).then(r => r.data.data),
    enabled: open && folderPickerOpen,
    staleTime: 5 * 60_000,
  })

  const refresh = async () => {
    setRefreshing(true)
    try {
      await api.post('/drive/refresh')
      await queryClient.invalidateQueries({ queryKey: ['drive-files'] })
      await queryClient.invalidateQueries({ queryKey: ['drive-customers'] })
    } finally {
      setRefreshing(false)
    }
  }

  if (!open) return null

  const listing = data
  const files = listing?.files ?? []
  const apiMessage = (error as any)?.response?.data?.message

  return (
    <aside className="dap-panel" aria-label="Google Drive artworks">
      <header className="dap-head">
        <div className="dap-title">
          <strong>Drive Artworks</strong>
          <small>{listing?.customer_folder?.name || customerName || 'No customer selected'}</small>
        </div>
        <div className="dap-head-actions">
          <button type="button" className="dap-icon-btn" onClick={refresh} disabled={refreshing} title="Reload from Drive">
            <RefreshCw size={14} className={refreshing ? 'dap-spin' : ''} />
          </button>
          <button type="button" className="dap-icon-btn" onClick={onClose} title="Close"><X size={15} /></button>
        </div>
      </header>

      <div className="dap-tools">
        <label className="dap-search">
          <Search size={13} />
          <input
            value={search}
            placeholder="Search file name…"
            onChange={event => { setSearch(event.target.value); setLimit(PAGE_SIZE) }}
          />
        </label>
        <button type="button" className="dap-link-btn" onClick={() => setFolderPickerOpen(value => !value)}>
          <FolderOpen size={13} /> {folderPickerOpen ? 'Hide folders' : 'Other folder'}
        </button>
      </div>

      {folderPickerOpen && (
        <div className="dap-folder-picker">
          <input
            value={customerSearch}
            placeholder="Find a Drive folder…"
            onChange={event => setCustomerSearch(event.target.value)}
          />
          <ul>
            {(driveCustomers?.rows ?? []).slice(0, 40).map(row => (
              <li key={row.id}>
                <button
                  type="button"
                  className={row.id === (listing?.customer_folder?.id || '') ? 'active' : ''}
                  onClick={() => {
                    setFolderId(row.id)
                    setFolder('')
                    setLimit(PAGE_SIZE)
                    setFolderPickerOpen(false)
                  }}
                >{row.name}</button>
              </li>
            ))}
            {driveCustomers && !driveCustomers.rows.length && <li className="dap-empty-row">No folder matches that name</li>}
          </ul>
        </div>
      )}

      {Boolean(listing?.folders?.length) && (
        <div className="dap-tabs">
          <button type="button" className={!folder ? 'active' : ''} onClick={() => { setFolder(''); setLimit(PAGE_SIZE) }}>
            All <span>{listing?.folders.reduce((sum, row) => sum + row.count, 0)}</span>
          </button>
          {listing!.folders.map(row => (
            <button
              key={row.name}
              type="button"
              className={folder === row.name ? 'active' : ''}
              onClick={() => { setFolder(row.name); setLimit(PAGE_SIZE) }}
            >{row.name === '(root)' ? 'Loose files' : row.name} <span>{row.count}</span></button>
          ))}
        </div>
      )}

      <div className="dap-body">
        {isLoading && <p className="dap-note">Loading Drive folder…</p>}

        {isError && (
          <p className="dap-note dap-error">
            {apiMessage || 'Google Drive could not be reached.'}
          </p>
        )}

        {!isLoading && !isError && !customerName && !folderId && (
          <p className="dap-note">Pick the customer on the order first, or choose a Drive folder above.</p>
        )}

        {!isLoading && !isError && listing && !listing.matched && (
          <p className="dap-note">
            No Drive folder named “{customerName}”. Use <strong>Other folder</strong> to pick it by hand.
          </p>
        )}

        {!isLoading && listing?.matched && !files.length && (
          <p className="dap-note">Nothing here{search ? ` for “${search}”` : ''}.</p>
        )}

        {Boolean(files.length) && (
          <>
            <ul className="dap-grid">
              {files.map(file => (
                <li
                  key={file.id}
                  className="dap-tile"
                  draggable
                  onDragStart={event => {
                    const payload = JSON.stringify({ id: file.id, name: file.name, mime_type: file.mime_type })
                    event.dataTransfer.setData(DRIVE_DRAG_TYPE, payload)
                    event.dataTransfer.setData('text/plain', file.name)
                    event.dataTransfer.effectAllowed = 'copy'
                  }}
                  title={`${file.name}\n${file.folder === '(root)' ? '' : file.folder + ' · '}${fileSize(file.size)}`}
                >
                  <DriveThumb file={file} />
                  <span className="dap-tile-name">{file.name}</span>
                  <span className="dap-tile-meta">
                    {file.width && file.height ? `${file.width}×${file.height}` : fileSize(file.size)}
                  </span>
                </li>
              ))}
            </ul>

            {listing && listing.total > files.length && (
              <button type="button" className="dap-more" onClick={() => setLimit(value => value + PAGE_SIZE)}>
                Show more ({files.length} of {listing.total})
              </button>
            )}
            {listing?.truncated && (
              <p className="dap-note dap-muted">This folder holds more files than the picker lists — search to narrow it down.</p>
            )}
          </>
        )}
      </div>

      <footer className="dap-foot">Drag a picture onto an artwork box in the table.</footer>
    </aside>
  )
}

export default DriveArtworkPicker
