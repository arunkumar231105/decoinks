import { ChangeEvent, MouseEvent, useEffect, useMemo, useRef, useState } from 'react'
import {
  Archive,
  Check,
  ChevronDown,
  Clock,
  Copy,
  Download,
  Edit3,
  Eye,
  Folder,
  Grid3x3,
  List,
  MessageCircle,
  MoreHorizontal,
  Plus,
  RefreshCw,
  RotateCcw,
  Send,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import { Menu, MenuItem } from '@mui/material'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import toast from '../utils/toast'
import { cn } from '../utils/cn'
import { api } from '../services/api'

type ArtworkStatus = 'Draft' | 'Pending Approval' | 'Changes Requested' | 'Approved' | 'Archived'
type ArtworkLocation = 'Front' | 'Back' | 'Sleeve' | 'Pocket'
type CommentTag = 'Feedback' | 'Change Request' | 'Approval Note'
type TabFilter = 'All Artworks' | ArtworkStatus

interface ArtworkComment {
  id: string
  text: string
  by: string
  date: string
  tag?: CommentTag
}

interface VersionEntry {
  id: string
  version: number
  uploadedBy: string
  uploadedDate: string
  fileName: string
  status: ArtworkStatus
  changeNotes: string
}

interface ArtworkFolder {
  id: string
  name: string
}

interface Artwork {
  id: string
  filename: string
  status: ArtworkStatus
  previousStatus?: ArtworkStatus
  location: ArtworkLocation
  size: string
  type: string
  dimensions: string
  uploaded: string
  uploadedBy: string
  version: number
  updatedAgo: string
  thumb: string
  fileUrl: string | null
  leadNo: string
  orderNo: string
  folderId: string
  versions: VersionEntry[]
  comments: ArtworkComment[]
}

interface ActivityEntry {
  id: string
  action: string
  user: string
  artworkName: string
  timestamp: string
  avatar: string
  color: string
}

interface FileValidationResult {
  valid: boolean
  messages: string[]
  warnings: string[]
  fileType: string
}

const uid = () => Math.random().toString(36).slice(2, 9)
const nowStamp = () => new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
const currentUser = 'Arun Kumar'
const allowedFileTypes = ['PNG', 'JPG', 'JPEG', 'PDF', 'AI', 'PSD']
const maxArtworkFileSize = 100 * 1024 * 1024

const STATUS_STYLES: Record<ArtworkStatus, string> = {
  Draft: 'aw-status-draft',
  'Pending Approval': 'aw-status-pending',
  'Changes Requested': 'aw-status-changes',
  Approved: 'aw-status-approved',
  Archived: 'aw-status-archived',
}

const THUMB_COLORS: Record<string, [string, string]> = {
  tiger: ['#f97316', '#ef4444'],
  vibes: ['#10b981', '#f59e0b'],
  skull: ['#6b7280', '#111827'],
  smiley: ['#fbbf24', '#f59e0b'],
  kind: ['#ec4899', '#8b5cf6'],
  cali: ['#f97316', '#f59e0b'],
  game: ['#3b82f6', '#1d4ed8'],
  xface: ['#6b7280', '#374151'],
  mountain: ['#10b981', '#065f46'],
  positive: ['#8b5cf6', '#7c3aed'],
  grow: ['#22c55e', '#15803d'],
  wild2: ['#f97316', '#ef4444'],
  upload: ['#0d9488', '#2563eb'],
}


function ArtworkThumb({ thumb, filename, fileUrl }: { thumb: string; filename: string; fileUrl?: string | null }) {
  const [failed, setFailed] = useState(false)
  const ext = (filename.split('.').pop() ?? '').toLowerCase()
  const isImage = /^(png|jpe?g|webp|gif|svg)$/.test(ext) ||
    /\.(png|jpe?g|webp|gif|svg)(\?|$)/i.test(fileUrl ?? '')

  // Render the real uploaded image when we have a URL and it's a viewable type
  if (fileUrl && isImage && !failed) {
    return (
      <div className="aw-thumb" style={{ background: '#f1f5f9' }}>
        <img
          src={fileUrl}
          alt={filename}
          loading="lazy"
          onError={() => setFailed(true)}
          style={{ width: '100%', height: '100%', objectFit: 'contain' }}
        />
      </div>
    )
  }

  // Fallback: coloured tile with initials (non-image files, or a broken URL)
  const [c1, c2] = THUMB_COLORS[thumb] ?? THUMB_COLORS.upload
  const initials = filename.split(/[_\s.]/).slice(0, 2).map(w => w[0]?.toUpperCase()).join('')
  return (
    <div className="aw-thumb" style={{ background: `linear-gradient(135deg, ${c1} 0%, ${c2} 100%)` }}>
      <span className="aw-thumb-text">{initials || (ext ? ext.toUpperCase() : 'FILE')}</span>
    </div>
  )
}

function validateArtworkFile(file: File): FileValidationResult {
  const fileType = file.name.split('.').pop()?.toUpperCase() ?? ''
  const messages: string[] = []
  const warnings: string[] = []

  if (!allowedFileTypes.includes(fileType)) {
    messages.push('Unsupported file type. Upload PNG, JPG, JPEG, PDF, AI, or PSD.')
  }

  if (file.size > maxArtworkFileSize) {
    messages.push('File is larger than the 100MB artwork upload limit.')
  }

  if (fileType !== 'PDF' && fileType !== 'AI' && fileType !== 'PSD') {
    warnings.push('Image dimensions will be checked after preview loads. Use at least 300 DPI for print.')
  }

  return { valid: messages.length === 0, messages, warnings, fileType }
}

function createVersion(artwork: Artwork, status: ArtworkStatus, notes: string): VersionEntry {
  return {
    id: uid(),
    version: artwork.version,
    uploadedBy: currentUser,
    uploadedDate: nowStamp(),
    fileName: artwork.filename,
    status,
    changeNotes: notes,
  }
}

function filterArtworks(artworks: Artwork[], filters: {
  tabFilter: TabFilter
  query: string
  leadNo: string
  orderNo: string
  folderId: string
}) {
  const q = filters.query.trim().toLowerCase()
  return artworks.filter(artwork => {
    const tabMatch = filters.tabFilter === 'All Artworks' || artwork.status === filters.tabFilter
    const folderMatch = filters.folderId === 'all' || artwork.folderId === filters.folderId
    const leadMatch = !filters.leadNo || artwork.leadNo.toLowerCase().includes(filters.leadNo.toLowerCase())
    const orderMatch = !filters.orderNo || artwork.orderNo.toLowerCase().includes(filters.orderNo.toLowerCase())
    const searchText = [
      artwork.filename,
      artwork.status,
      artwork.leadNo,
      artwork.orderNo,
      artwork.folderId,
      artwork.uploadedBy,
      artwork.location,
      artwork.type,
    ].join(' ').toLowerCase()

    return tabMatch && folderMatch && leadMatch && orderMatch && (!q || searchText.includes(q))
  })
}

function prepareArtworkDownload(artworks: Artwork[]) {
  return {
    mode: artworks.length === 1 ? 'file' : 'zip',
    fileName: artworks.length === 1 ? artworks[0].filename : `artworks-${Date.now()}.zip`,
  }
}

export function ArtworkLibraryPage() {
  const uploadInputRef = useRef<HTMLInputElement | null>(null)
  const [leadNo, setLeadNo] = useState('')
  const [orderNo, setOrderNo] = useState('')
  const [artworkCategory, setArtworkCategory] = useState('Apparel')
  const [artworkNiche, setArtworkNiche] = useState('')
  const [artworkType, setArtworkType] = useState('custom')
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const [tabFilter, setTabFilter] = useState<TabFilter>('All Artworks')
  const [folderFilter, setFolderFilter] = useState('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [sendMenuAnchor, setSendMenuAnchor] = useState<HTMLElement | null>(null)
  const [cardMenuAnchor, setCardMenuAnchor] = useState<HTMLElement | null>(null)
  const [folderMenuAnchor, setFolderMenuAnchor] = useState<HTMLElement | null>(null)
  const [moveMenuAnchor, setMoveMenuAnchor] = useState<HTMLElement | null>(null)
  const [menuArtworkId, setMenuArtworkId] = useState<string | null>(null)
  const [activeArtworkId, setActiveArtworkId] = useState('')
  const [artworks, setArtworks] = useState<Artwork[]>([])
  const [folders, setFolders] = useState<ArtworkFolder[]>([])
  const [activities, setActivities] = useState<ActivityEntry[]>([])
  const [uploading, setUploading] = useState(false)
  const queryClient = useQueryClient()
  const { data: leadMatches = [] } = useQuery<any[]>({
    queryKey: ['artwork-lead-match', leadNo],
    queryFn: () => api.get('/leads/list', { params: { search: leadNo, limit: 20 } }).then(r => r.data.data?.rows ?? []),
    enabled: leadNo.trim().length > 2,
  })

  const { data: artworkApiData } = useQuery({
    queryKey: ['artworks'],
    // The vault shows everything — without a limit the API returns only 10,
    // which made older artworks "disappear" as new ones were uploaded.
    queryFn: () => api.get('/artworks', { params: { limit: 1000 } }).then(r => {
      const rows = r.data.data?.rows ?? r.data.data ?? []
      return rows.map((a: any): Artwork => ({
        id: a.id,
        filename: a.name ?? a.filename ?? 'untitled',
        status: a.status ?? 'Draft',
        previousStatus: undefined,
        location: a.location ?? 'Front',
        size: a.size ?? '',
        type: (a.file_type ?? a.filename ?? '').split('.').pop()?.toUpperCase() ?? 'FILE',
        dimensions: a.dimensions ?? '',
        uploaded: a.created_at ? new Date(a.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '',
        uploadedBy: a.uploader_name ?? a.uploaded_by ?? 'Staff',
        version: a.version ?? 1,
        updatedAgo: a.updated_at ? new Date(a.updated_at).toLocaleDateString() : '',
        thumb: a.thumb ?? 'upload',
        fileUrl: a.thumbnail_url ?? a.file_url ?? null,
        leadNo: a.lead_no ?? a.leadNo ?? '',
        orderNo: a.order_no ?? a.orderNo ?? '',
        folderId: a.folder_id ?? a.folderId ?? 'fld-root',
        versions: a.versions ?? [],
        comments: a.comments ?? [],
      }))
    }),
  })

  useEffect(() => {
    if (artworkApiData && artworkApiData.length > 0) {
      setArtworks(artworkApiData)
      setActiveArtworkId(prev => prev || artworkApiData[0].id)
    }
  }, [artworkApiData])
  const [newComment, setNewComment] = useState('')
  const [newCommentTag, setNewCommentTag] = useState<CommentTag>('Feedback')
  const [uploadMessages, setUploadMessages] = useState<string[]>([])

  const activeArtwork = artworks.find(a => a.id === activeArtworkId) ?? artworks[0]
  const activeFolder = folders.find(folder => folder.id === activeArtwork?.folderId)
  const menuArtwork = artworks.find(a => a.id === menuArtworkId)

  const counts = useMemo(() => ({
    all: artworks.length,
    pending: artworks.filter(a => a.status === 'Pending Approval').length,
    changes: artworks.filter(a => a.status === 'Changes Requested').length,
    approved: artworks.filter(a => a.status === 'Approved').length,
    archived: artworks.filter(a => a.status === 'Archived').length,
  }), [artworks])

  const displayed = useMemo(
    () => filterArtworks(artworks, { tabFilter, query: searchQuery, leadNo, orderNo, folderId: folderFilter }),
    [artworks, tabFilter, searchQuery, leadNo, orderNo, folderFilter],
  )

  const selectedArtworks = useMemo(() => artworks.filter(artwork => selected.has(artwork.id)), [artworks, selected])
  const allSelected = displayed.length > 0 && displayed.every(a => selected.has(a.id))

  const logActivity = (action: string, artworkName: string, user = currentUser) => {
    setActivities(prev => [{
      id: uid(),
      action,
      user,
      artworkName,
      timestamp: 'just now',
      avatar: user.split(' ').map(part => part[0]).join('').slice(0, 2).toUpperCase(),
      color: user === currentUser ? '#0D9488' : '#2563EB',
    }, ...prev])
  }

  const updateArtworkStatus = (ids: string[], status: ArtworkStatus, notes: string) => {
    setArtworks(prev => prev.map(artwork => {
      if (!ids.includes(artwork.id)) return artwork
      const commentTag: CommentTag = status === 'Changes Requested' ? 'Change Request' : status === 'Approved' ? 'Approval Note' : 'Feedback'
      const nextArtwork = {
        ...artwork,
        previousStatus: status === 'Archived' ? artwork.status : artwork.previousStatus,
        status,
        updatedAgo: 'just now',
        versions: [createVersion({ ...artwork, status }, status, notes), ...artwork.versions],
        comments: notes
          ? [{ id: uid(), text: notes, by: currentUser, date: nowStamp(), tag: commentTag }, ...artwork.comments]
          : artwork.comments,
      }
      logActivity(status === 'Pending Approval' ? 'sent for approval' : status === 'Changes Requested' ? 'requested changes' : status === 'Approved' ? 'approved artwork' : 'archived artwork', artwork.filename)
      return nextArtwork
    }))
    // Persist each status change to the API
    ids.forEach(id => {
      api.patch(`/artworks/${id}/status`, { status }).catch(() => {})
    })
  }

  const requestChanges = (ids: string[]) => {
    const reason = window.prompt('Reason for requesting changes?')
    if (!reason?.trim()) return
    updateArtworkStatus(ids, 'Changes Requested', reason.trim())
  }

  const restoreArtwork = (id: string) => {
    const artwork = artworks.find(item => item.id === id)
    if (!artwork) return
    const nextStatus = artwork.previousStatus && artwork.previousStatus !== 'Archived' ? artwork.previousStatus : 'Draft'
    updateArtworkStatus([id], nextStatus, 'Restored from archived.')
    logActivity('restored artwork', artwork.filename)
  }

  const renameArtwork = (id: string) => {
    const artwork = artworks.find(item => item.id === id)
    if (!artwork) return
    const name = window.prompt('Rename artwork', artwork.filename)
    if (!name?.trim()) return
    setArtworks(prev => prev.map(item => item.id === id ? { ...item, filename: name.trim(), updatedAgo: 'just now' } : item))
    logActivity('renamed artwork', name.trim())
  }

  const duplicateArtwork = (id: string) => {
    const artwork = artworks.find(item => item.id === id)
    if (!artwork) return
    const duplicate = { ...artwork, id: uid(), filename: artwork.filename.replace('.', '_copy.'), status: 'Draft' as ArtworkStatus, version: 1, updatedAgo: 'just now' }
    setArtworks(prev => [duplicate, ...prev])
    setActiveArtworkId(duplicate.id)
    logActivity('duplicated artwork', duplicate.filename)
  }

  const deleteArtwork = async (id: string) => {
    const artwork = artworks.find(item => item.id === id)
    if (!artwork || !window.confirm(`Delete ${artwork.filename}? This permanently removes the file.`)) return
    try {
      // Backend hard-deletes the DB row AND the MinIO object.
      await api.delete(`/artworks/${id}`)
      setArtworks(prev => prev.filter(item => item.id !== id))
      setSelected(prev => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
      if (activeArtworkId === id) setActiveArtworkId(artworks.find(item => item.id !== id)?.id ?? '')
      logActivity('deleted artwork', artwork.filename)
      toast.success('Artwork deleted')
      // Re-sync with the server so the list reflects what was actually removed.
      queryClient.invalidateQueries({ queryKey: ['artworks'] })
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? 'Failed to delete artwork')
    }
  }

  // Bulk delete — hard-removes each selected artwork from DB + MinIO.
  const deleteSelectedArtworks = async () => {
    const ids = [...selected]
    if (!ids.length) return
    if (!window.confirm(`Delete ${ids.length} artwork${ids.length > 1 ? 's' : ''}? This permanently removes the files.`)) return
    let ok = 0
    for (const id of ids) {
      try { await api.delete(`/artworks/${id}`); ok++ }
      catch { /* keep going; report the tally below */ }
    }
    setSelected(new Set())
    if (ok > 0) {
      toast.success(`Deleted ${ok} artwork${ok > 1 ? 's' : ''}`)
      queryClient.invalidateQueries({ queryKey: ['artworks'] })
    }
    if (ok < ids.length) toast.error(`${ids.length - ok} could not be deleted`)
  }

  const moveArtworksToFolder = (ids: string[], folderId: string) => {
    const folder = folders.find(item => item.id === folderId)
    if (!folder) return
    setArtworks(prev => prev.map(artwork => ids.includes(artwork.id) ? { ...artwork, folderId, updatedAgo: 'just now' } : artwork))
    ids.forEach(id => {
      const artwork = artworks.find(item => item.id === id)
      if (artwork) logActivity(`moved to folder ${folder.name}`, artwork.filename)
    })
    setMoveMenuAnchor(null)
    setCardMenuAnchor(null)
  }

  const createFolder = () => {
    const name = window.prompt('Folder name')
    if (!name?.trim()) return
    const folder = { id: uid(), name: name.trim() }
    setFolders(prev => [...prev, folder])
    setFolderFilter(folder.id)
  }

  const renameFolder = () => {
    if (folderFilter === 'all') return
    const folder = folders.find(item => item.id === folderFilter)
    if (!folder) return
    const name = window.prompt('Rename folder', folder.name)
    if (!name?.trim()) return
    setFolders(prev => prev.map(item => item.id === folder.id ? { ...item, name: name.trim() } : item))
  }

  const deleteFolder = () => {
    if (folderFilter === 'all') return
    const folder = folders.find(item => item.id === folderFilter)
    if (!folder || !window.confirm(`Delete folder "${folder.name}"? Artworks will move to All Production Artworks.`)) return
    setFolders(prev => prev.filter(item => item.id !== folder.id))
    setArtworks(prev => prev.map(artwork => artwork.folderId === folder.id ? { ...artwork, folderId: 'fld-root' } : artwork))
    setFolderFilter('all')
  }

  const downloadArtworks = (items: Artwork[]) => {
    if (items.length === 0) return
    const prepared = prepareArtworkDownload(items)
    items.forEach(item => logActivity(prepared.mode === 'zip' ? 'prepared bulk ZIP download' : 'downloaded artwork', item.filename))
    toast.info(`Download ready: ${prepared.fileName}`)
  }

  const uploadArtworkFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    const messages: string[] = []
    const valid: File[] = []

    files.forEach(file => {
      const validation = validateArtworkFile(file)
      if (!validation.valid) {
        messages.push(`${file.name}: ${validation.messages.join(' ')}`)
        return
      }
      messages.push(...validation.warnings.map(warning => `${file.name}: ${warning}`))
      valid.push(file)
    })

    if (!valid.length) { setUploadMessages(messages); return }

    // Actually upload each file to the server so it is stored in the artwork
    // vault (MinIO + DB) and survives a refresh — not just kept in memory.
    setUploading(true)
    let uploaded = 0
    for (const file of valid) {
      try {
        const fd = new FormData()
        fd.append('file', file)
        fd.append('name', file.name.replace(/\.[^.]+$/, ''))
        const linkedLead = leadMatches.find((l: any) => l.lead_number.toLowerCase() === leadNo.trim().toLowerCase())
        if (linkedLead) fd.append('lead_id', linkedLead.id)
        fd.append('artwork_category', artworkCategory)
        if (artworkNiche.trim()) fd.append('artwork_micro_niche', artworkNiche.trim())
        fd.append('artwork_type', artworkType)
        await api.post('/artworks', fd, { headers: { 'Content-Type': 'multipart/form-data' } })
        uploaded++
        logActivity('uploaded artwork', file.name)
      } catch (err: any) {
        messages.push(`${file.name}: upload failed${err?.response?.data?.message ? ` — ${err.response.data.message}` : ''}`)
      }
    }
    setUploading(false)

    if (uploaded > 0) {
      messages.unshift(`${uploaded} artwork${uploaded > 1 ? 's' : ''} uploaded to the library.`)
      // Refetch from the server so the new artworks appear from the DB
      await queryClient.invalidateQueries({ queryKey: ['artworks'] })
    }
    setUploadMessages(messages)
  }

  const uploadNewVersion = (id: string) => {
    const artwork = artworks.find(item => item.id === id)
    if (!artwork) return
    const notes = window.prompt('New version notes', 'Updated print file uploaded.')
    if (!notes?.trim()) return
    setArtworks(prev => prev.map(item => {
      if (item.id !== id) return item
      const nextVersion = item.version + 1
      const uploaded = nowStamp()
      return {
        ...item,
        version: nextVersion,
        uploaded,
        uploadedBy: currentUser,
        updatedAgo: 'just now',
        versions: [{
          id: uid(),
          version: nextVersion,
          uploadedBy: currentUser,
          uploadedDate: uploaded,
          fileName: item.filename,
          status: item.status,
          changeNotes: notes.trim(),
        }, ...item.versions],
      }
    }))
    logActivity('uploaded new version', artwork.filename)
  }

  const addComment = () => {
    if (!activeArtwork || !newComment.trim()) return
    const comment: ArtworkComment = { id: uid(), text: newComment.trim(), by: currentUser, date: nowStamp(), tag: newCommentTag }
    setArtworks(prev => prev.map(artwork => artwork.id === activeArtwork.id ? { ...artwork, comments: [comment, ...artwork.comments] } : artwork))
    logActivity('commented on artwork', activeArtwork.filename)
    setNewComment('')
  }

  const generateGangsheet = () => {
    selectedArtworks.forEach(artwork => logActivity('generated gangsheet', artwork.filename))
    toast.info(`Gangsheet prepared for ${selectedArtworks.length || 0} artwork(s).`)
  }

  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleAll = () => {
    if (allSelected) setSelected(new Set())
    else setSelected(new Set(displayed.map(a => a.id)))
  }

  const clearSelection = () => setSelected(new Set())

  const openCardMenu = (event: MouseEvent<HTMLElement>, id: string) => {
    event.stopPropagation()
    setMenuArtworkId(id)
    setCardMenuAnchor(event.currentTarget)
  }

  const TABS: { label: string; count: number; filter: TabFilter }[] = [
    { label: 'All Artworks', count: counts.all, filter: 'All Artworks' },
    { label: 'Pending Approval', count: counts.pending, filter: 'Pending Approval' },
    { label: 'Changes Requested', count: counts.changes, filter: 'Changes Requested' },
    { label: 'Approved', count: counts.approved, filter: 'Approved' },
    { label: 'Archived', count: counts.archived, filter: 'Archived' },
  ]

  return (
    <div className="aw-page">
      <input ref={uploadInputRef} type="file" multiple hidden accept=".png,.jpg,.jpeg,.pdf,.ai,.psd" onChange={uploadArtworkFiles} />

      <div className="aw-header">
        <div className="aw-header-left">
          <div className="aw-filter-row">
            <div className="aw-filter-field">
              <label>Lead No.</label>
              <div className="aw-filter-select">
                <input value={leadNo} onChange={e => setLeadNo(e.target.value)} className="aw-filter-input" />
                <button className="aw-clear-btn" onClick={() => setLeadNo('')}><X size={12} /></button>
                <ChevronDown size={12} />
              </div>
            </div>
            <div className="aw-filter-field"><label>Artwork Category</label><div className="aw-filter-select"><input value={artworkCategory} onChange={e=>setArtworkCategory(e.target.value)} className="aw-filter-input" placeholder="Apparel / Logo / Sports" /></div></div>
            <div className="aw-filter-field"><label>Micro-niche</label><div className="aw-filter-select"><input value={artworkNiche} onChange={e=>setArtworkNiche(e.target.value)} className="aw-filter-input" placeholder="Church / Birthday / Football" /></div></div>
            <div className="aw-filter-field"><label>Artwork Type</label><div className="aw-filter-select"><select value={artworkType} onChange={e=>setArtworkType(e.target.value)} className="aw-filter-input">{['custom','template','logo','photo'].map(x=><option key={x}>{x}</option>)}</select></div></div>
            <div className="aw-filter-field">
              <label>Search</label>
              <div className="aw-filter-select">
                <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="aw-filter-input" placeholder="Name, status, lead, order, folder, uploader" />
                {searchQuery && <button className="aw-clear-btn" onClick={() => setSearchQuery('')}><X size={12} /></button>}
              </div>
            </div>
            <button className="aw-apply-btn" onClick={() => toast.success('Filters applied')}>Apply</button>
          </div>
          {(leadNo || orderNo) && (
            <p className="aw-filter-hint">
              Showing artworks for Lead: <button className="aw-link" onClick={() => toast.success('Lead filter active')}>{leadNo}</button>
              {orderNo && <> | Order: <button className="aw-link" onClick={() => toast.success('Order filter active')}>{orderNo}</button></>}
            </p>
          )}
          <div className="aw-folder-row">
            <button className={cn('aw-folder-chip', folderFilter === 'all' && 'aw-folder-chip-active')} onClick={() => setFolderFilter('all')}>
              <Folder size={13} /> All Folders
            </button>
            {folders.map(folder => (
              <button key={folder.id} className={cn('aw-folder-chip', folderFilter === folder.id && 'aw-folder-chip-active')} onClick={() => setFolderFilter(folder.id)}>
                <Folder size={13} /> {folder.name}
              </button>
            ))}
            {folderFilter !== 'all' && (
              <button className="aw-folder-menu-btn" onClick={e => setFolderMenuAnchor(e.currentTarget)}>
                <MoreHorizontal size={14} />
              </button>
            )}
          </div>
        </div>
        <div className="aw-header-actions">
          <button className="lb-action-btn lb-action-primary aw-upload-btn" onClick={() => uploadInputRef.current?.click()} disabled={uploading}>
            <Upload size={14} /> {uploading ? 'Uploading…' : 'Upload Artwork'}
          </button>
          <button className="lb-action-btn aw-folder-btn" onClick={createFolder}>
            <Plus size={14} /> New Folder
          </button>
        </div>
      </div>

      {uploadMessages.length > 0 && (
        <div className="aw-upload-messages">
          {uploadMessages.map(message => <span key={message}>{message}</span>)}
        </div>
      )}

      <div className="aw-stats">
        {[
          { icon: <Grid3x3 size={18} />, label: 'Total Artworks', value: counts.all, cls: 'aw-stat-total' },
          { icon: <Clock size={18} />, label: 'Pending Approval', value: counts.pending, cls: 'aw-stat-pending' },
          { icon: <RefreshCw size={18} />, label: 'Changes Requested', value: counts.changes, cls: 'aw-stat-changes' },
          { icon: <Check size={18} />, label: 'Approved', value: counts.approved, cls: 'aw-stat-approved' },
          { icon: <Archive size={18} />, label: 'Archived', value: counts.archived, cls: 'aw-stat-archived' },
        ].map(stat => (
          <div key={stat.label} className={cn('aw-stat', stat.cls)}>
            <span className="aw-stat-icon">{stat.icon}</span>
            <div>
              <span className="aw-stat-label">{stat.label}</span>
              <strong className="aw-stat-value">{stat.value}</strong>
            </div>
          </div>
        ))}
      </div>

      {selected.size > 0 && (
        <div className="aw-bulk-bar">
          <label className="aw-bulk-check"><input type="checkbox" checked={allSelected} onChange={toggleAll} /></label>
          <span className="aw-bulk-count">{selected.size} selected</span>
          <button className="aw-bulk-clear" onClick={clearSelection}>Clear</button>
          <div className="aw-bulk-send-group">
            <button className="aw-bulk-btn aw-bulk-primary" onClick={e => setSendMenuAnchor(e.currentTarget)}>
              <Send size={13} /> Send for Approval <ChevronDown size={12} />
            </button>
            <Menu anchorEl={sendMenuAnchor} open={Boolean(sendMenuAnchor)} onClose={() => setSendMenuAnchor(null)}>
              <MenuItem onClick={() => { updateArtworkStatus([...selected], 'Pending Approval', 'Sent via Facebook for approval.'); setSendMenuAnchor(null) }}>
                <MessageCircle size={14} style={{ marginRight: 8, color: '#7c3aed' }} /> Send via Facebook (FB)
              </MenuItem>
              <MenuItem onClick={() => { updateArtworkStatus([...selected], 'Pending Approval', 'Sent via email for approval.'); setSendMenuAnchor(null) }}>
                <Send size={14} style={{ marginRight: 8, color: '#2563eb' }} /> Send via Email
              </MenuItem>
              <MenuItem onClick={() => { updateArtworkStatus([...selected], 'Pending Approval', 'Sent via Facebook and email for approval.'); setSendMenuAnchor(null) }}>
                <Send size={14} style={{ marginRight: 8, color: '#059669' }} /> Send via Both
              </MenuItem>
            </Menu>
          </div>
          <button className="aw-bulk-btn aw-bulk-approve" onClick={() => updateArtworkStatus([...selected], 'Approved', 'Bulk marked as approved.')}>
            <Check size={13} /> Mark as Approved
          </button>
          <button className="aw-bulk-btn aw-bulk-changes" onClick={() => requestChanges([...selected])}>
            <RefreshCw size={13} /> Request Changes
          </button>
          <button className="aw-bulk-btn aw-bulk-archive" onClick={() => updateArtworkStatus([...selected], 'Archived', 'Bulk archived.')}>
            <Archive size={13} /> Archive
          </button>
          <button className="aw-bulk-btn aw-bulk-gangsheet" onClick={generateGangsheet}>
            <Grid3x3 size={13} /> Generate Gangsheet
          </button>
          <button className="aw-bulk-btn" onClick={() => downloadArtworks(selectedArtworks)}>
            <Download size={13} /> Bulk Download
          </button>
          <button className="aw-bulk-btn" onClick={e => setMoveMenuAnchor(e.currentTarget)}>
            <Folder size={13} /> Move to Folder
          </button>
          <button className="aw-bulk-btn" style={{ color: '#dc2626' }} onClick={deleteSelectedArtworks}>
            <Trash2 size={13} /> Delete
          </button>
        </div>
      )}

      <div className="aw-body">
        <div className="aw-content">
          <div className="aw-tabs-bar">
            <div className="aw-tabs">
              {TABS.map(t => (
                <button key={t.label} className={cn('aw-tab', tabFilter === t.filter && 'aw-tab-active')} onClick={() => setTabFilter(t.filter)}>
                  {t.label} <span className="aw-tab-count">{t.count}</span>
                </button>
              ))}
            </div>
            <div className="aw-tabs-right">
              <span className="aw-sort-label">Sort by:</span>
              <select className="aw-sort-select"><option>Latest Update</option><option>Name</option><option>Status</option></select>
              <div className="aw-view-toggle">
                <button className={cn('aw-view-btn', viewMode === 'grid' && 'aw-view-btn-active')} onClick={() => setViewMode('grid')}><Grid3x3 size={15} /></button>
                <button className={cn('aw-view-btn', viewMode === 'list' && 'aw-view-btn-active')} onClick={() => setViewMode('list')}><List size={15} /></button>
              </div>
            </div>
          </div>

          <div className={cn('aw-grid', viewMode === 'list' && 'aw-list-view')}>
            {displayed.map(artwork => (
              <div key={artwork.id} className={cn('aw-card', selected.has(artwork.id) && 'aw-card-selected', activeArtwork?.id === artwork.id && 'aw-card-active')} onClick={() => setActiveArtworkId(artwork.id)}>
                <div className="aw-card-top">
                  <label className="aw-card-check" onClick={e => e.stopPropagation()}>
                    <input type="checkbox" checked={selected.has(artwork.id)} onChange={() => toggleSelect(artwork.id)} />
                  </label>
                  <span className="aw-version-badge">v{artwork.version}</span>
                </div>
                <ArtworkThumb thumb={artwork.thumb} filename={artwork.filename} fileUrl={artwork.fileUrl} />
                <div className="aw-card-body">
                  <p className="aw-card-name">{artwork.filename}</p>
                  <span className={cn('aw-status-badge', STATUS_STYLES[artwork.status])}>{artwork.status}</span>
                  <div className="aw-card-meta">
                    <span>{artwork.location}</span><span>|</span><span>{artwork.size}</span><span>|</span><span>{artwork.type}</span>
                  </div>
                  <div className="aw-card-updated"><Clock size={11} /><span>Updated: {artwork.updatedAgo}</span></div>
                </div>
                <div className="aw-card-footer" onClick={e => e.stopPropagation()}>
                  <button className="aw-preview-btn" onClick={() => setActiveArtworkId(artwork.id)}><Eye size={12} /> Preview</button>
                  <button className="aw-more-btn" onClick={e => openCardMenu(e, artwork.id)}><MoreHorizontal size={14} /></button>
                </div>
              </div>
            ))}
            <button className="aw-upload-card" onClick={() => uploadInputRef.current?.click()}>
              <Plus size={28} />
              <span>Add Artwork</span>
              <small>Upload or drag &amp; drop<br />PNG, JPG, PDF, AI, PSD<br />Max 100MB</small>
            </button>
          </div>

          <div className="aw-pagination">
            <span>Showing 1 to {displayed.length} of {displayed.length} artworks</span>
            <div className="aw-pag-controls">
              <button className="aw-pag-btn" disabled><ChevronDown size={12} style={{ transform: 'rotate(90deg)' }} /></button>
              <button className="aw-pag-btn aw-pag-active">1</button>
              <button className="aw-pag-btn" disabled><ChevronDown size={12} style={{ transform: 'rotate(-90deg)' }} /></button>
            </div>
            <select className="aw-per-page-select"><option>20 / page</option><option>50 / page</option><option>100 / page</option></select>
          </div>
        </div>

        {activeArtwork && (
          <aside className="aw-sidebar">
            <div className="aw-sidebar-preview"><ArtworkThumb thumb={activeArtwork.thumb} filename={activeArtwork.filename} fileUrl={activeArtwork.fileUrl} /></div>
            <div className="aw-sidebar-card">
              <div className="aw-sidebar-title-row">
                <span className="aw-sidebar-filename">{activeArtwork.filename}</span>
                <span className="aw-version-badge aw-version-lg">v{activeArtwork.version}</span>
                <span className={cn('aw-status-badge', STATUS_STYLES[activeArtwork.status])}>{activeArtwork.status}</span>
              </div>
              <div className="aw-meta-list">
                {[
                  ['Location', activeArtwork.location],
                  ['Size', activeArtwork.size],
                  ['Type', activeArtwork.type],
                  ['Dimensions', activeArtwork.dimensions],
                  ['Uploaded', activeArtwork.uploaded],
                  ['By', activeArtwork.uploadedBy],
                  ['Lead No.', activeArtwork.leadNo],
                  ['Order No.', activeArtwork.orderNo],
                  ['Folder', activeFolder?.name ?? 'Unfiled'],
                ].map(([label, value]) => (
                  <div key={label} className="aw-meta-row"><span className="aw-meta-label">{label}</span><span className="aw-meta-value">{value}</span></div>
                ))}
              </div>
              <div className="aw-sidebar-actions">
                <button className="lb-action-btn aw-preview-full-btn" onClick={() => setActiveArtworkId(activeArtwork.id)}><Eye size={13} /> Preview</button>
                <button className="lb-action-btn aw-download-btn" onClick={() => downloadArtworks([activeArtwork])}><Download size={13} /> Download</button>
                <button className="lb-action-btn" onClick={() => uploadNewVersion(activeArtwork.id)}><Upload size={13} /> New Version</button>
              </div>
            </div>

            <div className="aw-sidebar-card">
              <div className="aw-sidebar-section-header"><span>Comments / Feedback</span></div>
              <div className="aw-comment-form">
                <textarea value={newComment} onChange={e => setNewComment(e.target.value)} placeholder="Add feedback, change request, or approval note..." />
                <div>
                  <select value={newCommentTag} onChange={e => setNewCommentTag(e.target.value as CommentTag)}>
                    <option>Feedback</option><option>Change Request</option><option>Approval Note</option>
                  </select>
                  <button className="aw-bulk-btn aw-bulk-primary" onClick={addComment}>Add Comment</button>
                </div>
              </div>
              <div className="aw-comment-list">
                {activeArtwork.comments.map(comment => (
                  <div key={comment.id} className="aw-comment-row">
                    <div><strong>{comment.by}</strong><span>{comment.date}</span></div>
                    {comment.tag && <em>{comment.tag}</em>}
                    <p>{comment.text}</p>
                  </div>
                ))}
                {activeArtwork.comments.length === 0 && <p className="aw-empty-note">No comments yet.</p>}
              </div>
            </div>

            <div className="aw-sidebar-card">
              <div className="aw-sidebar-section-header"><span>Version History</span><button className="aw-view-all-btn" onClick={() => toast.success('Showing all versions')}>View All</button></div>
              <div className="aw-version-list">
                {activeArtwork.versions.map(v => (
                  <div key={v.id} className="aw-version-row">
                    <div className="aw-version-left">
                      <span className="aw-version-num">v{v.version}</span>
                      <div><span className="aw-version-date">{v.uploadedDate}</span><span className="aw-version-by">by {v.uploadedBy}</span><small>{v.fileName} - {v.changeNotes}</small></div>
                    </div>
                    <span className={cn('aw-status-badge aw-status-sm', STATUS_STYLES[v.status])}>{v.status}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="aw-sidebar-card">
              <div className="aw-sidebar-section-header"><span>Recent Activity</span><button className="aw-view-all-btn" onClick={() => toast.success('Showing all activity')}>View All</button></div>
              <div className="aw-activity-list">
                {activities.slice(0, 8).map(activity => (
                  <div key={activity.id} className="aw-activity-row">
                    <div className="aw-activity-avatar" style={{ background: activity.color }}>{activity.avatar}</div>
                    <div className="aw-activity-text"><span>{activity.user} {activity.action}: {activity.artworkName}</span><span className="aw-activity-ago">{activity.timestamp}</span></div>
                  </div>
                ))}
              </div>
            </div>
          </aside>
        )}
      </div>

      <Menu anchorEl={cardMenuAnchor} open={Boolean(cardMenuAnchor)} onClose={() => setCardMenuAnchor(null)}>
        <MenuItem onClick={() => { if (menuArtwork) setActiveArtworkId(menuArtwork.id); setCardMenuAnchor(null) }}><Eye size={14} /> Preview</MenuItem>
        <MenuItem onClick={() => { if (menuArtworkId) renameArtwork(menuArtworkId); setCardMenuAnchor(null) }}><Edit3 size={14} /> Rename</MenuItem>
        <MenuItem onClick={() => { if (menuArtwork) downloadArtworks([menuArtwork]); setCardMenuAnchor(null) }}><Download size={14} /> Download</MenuItem>
        <MenuItem onClick={() => { if (menuArtworkId) duplicateArtwork(menuArtworkId); setCardMenuAnchor(null) }}><Copy size={14} /> Duplicate</MenuItem>
        <MenuItem onClick={e => setMoveMenuAnchor(e.currentTarget)}><Folder size={14} /> Move to Folder</MenuItem>
        <MenuItem onClick={() => { if (menuArtworkId) requestChanges([menuArtworkId]); setCardMenuAnchor(null) }}><RefreshCw size={14} /> Request Changes</MenuItem>
        <MenuItem onClick={() => { if (menuArtworkId) updateArtworkStatus([menuArtworkId], 'Approved', 'Marked as approved.'); setCardMenuAnchor(null) }}><Check size={14} /> Mark as Approved</MenuItem>
        {menuArtwork?.status === 'Archived' ? (
          <MenuItem onClick={() => { if (menuArtworkId) restoreArtwork(menuArtworkId); setCardMenuAnchor(null) }}><RotateCcw size={14} /> Restore</MenuItem>
        ) : (
          <MenuItem onClick={() => { if (menuArtworkId) updateArtworkStatus([menuArtworkId], 'Archived', 'Archived from artwork library.'); setCardMenuAnchor(null) }}><Archive size={14} /> Archive</MenuItem>
        )}
        <MenuItem onClick={() => { if (menuArtworkId) deleteArtwork(menuArtworkId); setCardMenuAnchor(null) }}><Trash2 size={14} /> Delete</MenuItem>
      </Menu>

      <Menu anchorEl={moveMenuAnchor} open={Boolean(moveMenuAnchor)} onClose={() => setMoveMenuAnchor(null)}>
        {folders.map(folder => (
          <MenuItem key={folder.id} onClick={() => moveArtworksToFolder(menuArtworkId ? [menuArtworkId] : [...selected], folder.id)}>
            <Folder size={14} /> {folder.name}
          </MenuItem>
        ))}
      </Menu>

      <Menu anchorEl={folderMenuAnchor} open={Boolean(folderMenuAnchor)} onClose={() => setFolderMenuAnchor(null)}>
        <MenuItem onClick={() => { renameFolder(); setFolderMenuAnchor(null) }}><Edit3 size={14} /> Rename Folder</MenuItem>
        <MenuItem onClick={() => { deleteFolder(); setFolderMenuAnchor(null) }}><Trash2 size={14} /> Delete Folder</MenuItem>
      </Menu>
    </div>
  )
}
