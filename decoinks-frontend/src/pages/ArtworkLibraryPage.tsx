import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Archive, CheckCircle2, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight,
  Clock3, Download, ExternalLink, FileImage, FolderOpen, Grid3X3, Image as ImageIcon,
  Images, Mail, MessageCircle, MoreHorizontal, PackageCheck, Palette, RefreshCw, Search, ShieldCheck,
  SlidersHorizontal, Upload, X,
} from 'lucide-react'
import toast from '../utils/toast'
import { api } from '../services/api'
import { cn } from '../utils/cn'

type AssetType = 'reference' | 'artwork' | 'version' | 'mockup' | 'gangsheet'

interface VaultAsset {
  id: string
  file_name: string
  path: string
  parent_path: string
  mime_type?: string | null
  file_size_bytes: number
  asset_type: AssetType
  status: string
  version_no: number
  is_cover: boolean
  qa_approved: boolean
  production_ready: boolean
  source_modified_at?: string | null
  created_at: string
  lead_number?: string | null
  customer_number?: string | null
  entity_name?: string | null
  sender_name?: string | null
  sales_agent_name?: string | null
  designer_name?: string | null
  order_type?: 'apparel' | 'gangsheet' | 'dtf' | null
  contact_email?: string | null
  contact_whatsapp?: string | null
  contact_facebook?: string | null
  folder_file_count?: number
  thumbnail_url?: string | null
  download_url?: string | null
  folder_files?: Array<Pick<VaultAsset, 'id' | 'file_name' | 'asset_type' | 'is_cover' | 'thumbnail_url'>>
}

interface VaultStats {
  total_assets: number
  artworks: number
  mockups: number
  gangsheets: number
  ready_artwork: number
  ready_gangsheet: number
  archived: number
  artwork_pending: number
  gangsheet_pending: number
}

const EMPTY_STATS: VaultStats = {
  total_assets: 0, artworks: 0, mockups: 0, gangsheets: 0, ready_artwork: 0,
  ready_gangsheet: 0, archived: 0, artwork_pending: 0, gangsheet_pending: 0,
}

const tabs: Array<{ label: string; value: '' | AssetType }> = [
  { label: 'All Assets', value: '' },
  { label: 'Reference Files', value: 'reference' },
  { label: 'Artwork Assets', value: 'artwork' },
  { label: 'Versions', value: 'version' },
  { label: 'Mockups', value: 'mockup' },
  { label: 'Gangsheets', value: 'gangsheet' },
]

const typeLabels: Record<AssetType, string> = {
  reference: 'Reference', artwork: 'Artwork', version: 'Version', mockup: 'Mockup', gangsheet: 'Gangsheet',
}

function apiAssetUrl(url?: string | null) {
  if (!url) return ''
  return url.startsWith('/api/') ? url.slice(4) : url
}

function formatDate(value?: string | null) {
  if (!value) return '—'
  return new Date(value).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function fileSize(bytes = 0) {
  if (!bytes) return '—'
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function useAuthenticatedPreview(url: string, enabled: boolean) {
  return useQuery<string>({
    queryKey: ['vault-preview', url],
    queryFn: async () => {
      const response = await api.get(apiAssetUrl(url), { responseType: 'blob' })
      return URL.createObjectURL(response.data)
    },
    enabled: Boolean(url && enabled),
    staleTime: 10 * 60 * 1000,
    retry: 1,
  }).data
}

async function downloadAsset(url: string, fileName: string, open = false) {
  const response = await api.get(apiAssetUrl(url), { responseType: 'blob' })
  const blobUrl = URL.createObjectURL(response.data)
  if (open) window.open(blobUrl, '_blank', 'noopener,noreferrer')
  else {
    const link = document.createElement('a')
    link.href = blobUrl
    link.download = fileName
    link.click()
  }
  window.setTimeout(() => URL.revokeObjectURL(blobUrl), 60000)
}

function AssetPreview({ asset, className = '' }: { asset: VaultAsset; className?: string }) {
  const [failed, setFailed] = useState(false)
  const preview = apiAssetUrl(asset.thumbnail_url)
  const imageLike = /image\//i.test(asset.mime_type || '') || /\.(png|jpe?g|webp|gif|svg|tiff?)$/i.test(asset.file_name)
  const authenticatedPreview = useAuthenticatedPreview(preview, imageLike && !failed)
  if (authenticatedPreview && imageLike && !failed) {
    return <img className={className} src={authenticatedPreview} alt={asset.file_name} loading="lazy" onError={() => setFailed(true)} />
  }
  return <span className={cn('av-file-fallback', className)}><FileImage size={20} /><small>{asset.file_name.split('.').pop()?.toUpperCase() || 'FILE'}</small></span>
}

function MetricCard({ icon, label, value, tone }: { icon: ReactNode; label: string; value: number; tone: string }) {
  return (
    <div className="av-metric">
      <span className={cn('av-metric-icon', `av-tone-${tone}`)}>{icon}</span>
      <span><small>{label}</small><strong>{Number(value || 0).toLocaleString()}</strong></span>
    </div>
  )
}

function DetailRow({ label, value }: { label: string; value?: ReactNode }) {
  return <div className="av-detail-row"><span>{label}</span><strong>{value || '—'}</strong></div>
}

function ArtworkDetails({ id, onClose, onSelect }: { id: string; onClose: () => void; onSelect: (id: string) => void }) {
  const queryClient = useQueryClient()
  const [showAllFiles, setShowAllFiles] = useState(false)
  const { data, isLoading } = useQuery<VaultAsset>({
    queryKey: ['artwork-vault-detail', id],
    queryFn: () => api.get(`/artworks/vault/assets/${id}`).then(r => r.data.data),
  })
  const coverMutation = useMutation({
    mutationFn: (assetId: string) => api.patch(`/artworks/vault/assets/${assetId}/cover`),
    onSuccess: () => {
      toast.success('Folder cover updated')
      queryClient.invalidateQueries({ queryKey: ['artwork-vault-detail', id] })
      queryClient.invalidateQueries({ queryKey: ['artwork-vault-assets'] })
    },
  })

  useEffect(() => {
    const close = (event: KeyboardEvent) => event.key === 'Escape' && onClose()
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [onClose])

  if (isLoading || !data) return <aside className="av-drawer"><div className="av-drawer-loading">Loading asset…</div></aside>
  const files = data.folder_files ?? []
  return (
    <aside className="av-drawer" aria-label="Artwork details">
      <header className="av-drawer-head">
        <div><span>Artwork Details</span><strong>{data.file_name}</strong></div>
        <button aria-label="Close details" onClick={onClose}><X size={20} /></button>
      </header>
      <div className="av-drawer-scroll">
        <div className="av-hero-preview"><AssetPreview asset={data} /></div>
        <div className="av-detail-title">
          <div><strong>{data.file_name}</strong><span>{data.entity_name || 'Unlinked asset'}</span></div>
          <span className={cn('av-type-pill', `av-type-${data.asset_type}`)}>{typeLabels[data.asset_type]}</span>
        </div>
        <div className="av-detail-badges">
          <span className="av-status-pill">{data.status || 'In Design'}</span>
          {data.qa_approved && <span className="av-ready-pill"><ShieldCheck size={13} /> QA Approved</span>}
          {data.production_ready && <span className="av-ready-pill"><CheckCircle2 size={13} /> Ready</span>}
        </div>
        <div className="av-drawer-actions">
          <button onClick={() => downloadAsset(data.download_url || '', data.file_name).catch(() => toast.error('Download failed'))}><Download size={17} /> Download</button>
          <button onClick={() => downloadAsset(data.download_url || '', data.file_name, true).catch(() => toast.error('Preview failed'))}><ExternalLink size={17} /> Open</button>
          <a className={!data.contact_email ? 'is-disabled' : ''} href={data.contact_email ? `mailto:${data.contact_email}` : undefined} title={data.contact_email ? `Email ${data.contact_email}` : 'No email available'} aria-disabled={!data.contact_email}><Mail size={17} /></a>
          <a className={!data.contact_whatsapp ? 'is-disabled' : ''} href={data.contact_whatsapp ? `https://wa.me/${data.contact_whatsapp.replace(/\D/g, '')}` : undefined} target="_blank" rel="noreferrer" title={data.contact_whatsapp ? 'Open WhatsApp' : 'No WhatsApp number available'} aria-disabled={!data.contact_whatsapp}><MessageCircle size={17} /></a>
          <button aria-label="More actions"><MoreHorizontal size={18} /></button>
        </div>

        <section className="av-detail-section">
          <h3>Information</h3>
          <DetailRow label="Type" value={typeLabels[data.asset_type]} />
          <DetailRow label="Order Type" value={data.order_type ? data.order_type.toUpperCase() : undefined} />
          <DetailRow label="Status" value={data.status} />
          <DetailRow label="Current Version" value={`V${data.version_no || 1}`} />
          <DetailRow label="Lead ID" value={data.lead_number} />
          <DetailRow label="Customer" value={data.entity_name} />
          <DetailRow label="Customer ID" value={data.customer_number} />
          <DetailRow label="Sales Agent" value={data.sales_agent_name} />
          <DetailRow label="Designer" value={data.designer_name} />
          <DetailRow label="Created" value={formatDate(data.source_modified_at || data.created_at)} />
          <DetailRow label="File Size" value={fileSize(data.file_size_bytes)} />
          <DetailRow label="Folder" value={data.parent_path || 'Root'} />
        </section>

        <section className="av-detail-section">
          <div className="av-section-heading"><h3>Folder Files</h3><span>{files.length}</span></div>
          <div className="av-folder-gallery">
            {files.slice(0, showAllFiles ? files.length : 36).map(file => (
              <button key={file.id} className={cn('av-folder-file', file.id === data.id && 'is-active')} onClick={() => file.id !== data.id && onSelect(file.id)}>
                <AssetPreview asset={{ ...data, ...file }} />
                <span>{file.file_name}</span>
                {file.is_cover && <small>Cover</small>}
                {!file.is_cover && <em onClick={event => { event.stopPropagation(); coverMutation.mutate(file.id) }}>Set cover</em>}
              </button>
            ))}
          </div>
          {files.length > 36 && <button className="av-show-files" onClick={() => setShowAllFiles(!showAllFiles)}>{showAllFiles ? 'Show fewer files' : `Show all ${files.length} files`}</button>}
        </section>
      </div>
    </aside>
  )
}

export function ArtworkLibraryPage() {
  const queryClient = useQueryClient()
  const importRef = useRef<HTMLInputElement | null>(null)
  const newArtworkRef = useRef<HTMLInputElement | null>(null)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [type, setType] = useState<'' | AssetType>('')
  const [status, setStatus] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(20)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [activeId, setActiveId] = useState('')
  const [showMore, setShowMore] = useState(false)
  const [qa, setQa] = useState('')
  const [ready, setReady] = useState('')
  const [orderType, setOrderType] = useState('')
  const [entitySearch, setEntitySearch] = useState('')
  const [agentSearch, setAgentSearch] = useState('')
  const [designerSearch, setDesignerSearch] = useState('')
  const [period, setPeriod] = useState('All Time')
  const [connected, setConnected] = useState<boolean | null>(null)

  useEffect(() => { const timer = window.setTimeout(() => { setDebouncedSearch(search); setPage(1) }, 300); return () => window.clearTimeout(timer) }, [search])
  useEffect(() => { api.get('/nextcloud/status').then(r => setConnected(Boolean(r.data.data?.ok))).catch(() => setConnected(false)) }, [])

  const params = useMemo(() => ({ page, limit, search: debouncedSearch || undefined, type: type || undefined, order_type: orderType || undefined, status: status || undefined, from: from || undefined, to: to || undefined, qa: qa || undefined, ready: ready || undefined, entity_search: entitySearch || undefined, agent_search: agentSearch || undefined, designer_search: designerSearch || undefined }), [page, limit, debouncedSearch, type, orderType, status, from, to, qa, ready, entitySearch, agentSearch, designerSearch])
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['artwork-vault-assets', params],
    queryFn: () => api.get('/artworks/vault/assets', { params }).then(r => r.data.data),
    refetchInterval: 30000,
  })
  const { data: stats = EMPTY_STATS } = useQuery<VaultStats>({
    queryKey: ['artwork-vault-stats', { from, to }],
    queryFn: () => api.get('/artworks/vault/stats', { params: { from: from || undefined, to: to || undefined } }).then(r => r.data.data),
    refetchInterval: 30000,
  })
  const rows: VaultAsset[] = data?.rows ?? []
  const total = Number(data?.total || 0)
  const totalPages = Math.max(1, Number(data?.totalPages || 1))
  const allSelected = rows.length > 0 && rows.every(row => selected.has(row.id))

  const syncMutation = useMutation({
    mutationFn: () => api.post('/artworks/vault/sync'),
    onSuccess: result => {
      const synced = result.data.data?.synced ?? 0
      toast.success(`Nextcloud synchronized · ${synced} files indexed`)
      queryClient.invalidateQueries({ queryKey: ['artwork-vault-assets'] })
      queryClient.invalidateQueries({ queryKey: ['artwork-vault-stats'] })
    },
    onError: (error: any) => toast.error(error?.response?.data?.message || 'Nextcloud sync failed'),
  })

  const uploadMutation = useMutation({
    mutationFn: async (files: File[]) => {
      let uploaded = 0
      for (const file of files) {
        const form = new FormData()
        form.append('file', file)
        form.append('folder', 'Unsorted')
        await api.post('/nextcloud/upload', form, { headers: { 'Content-Type': 'multipart/form-data' } })
        uploaded++
      }
      return uploaded
    },
    onSuccess: uploaded => {
      toast.success(`${uploaded} file${uploaded === 1 ? '' : 's'} imported to Artwork Vault`)
      queryClient.invalidateQueries({ queryKey: ['artwork-vault-assets'] })
      queryClient.invalidateQueries({ queryKey: ['artwork-vault-stats'] })
    },
    onError: (error: any) => toast.error(error?.response?.data?.message || 'File import failed'),
  })

  const bulkMutation = useMutation({
    mutationFn: (changes: { status: string }) => api.patch('/artworks/vault/assets/bulk', { ids: Array.from(selected), ...changes }),
    onSuccess: result => {
      toast.success(`${result.data.data?.updated || selected.size} artwork folder${selected.size === 1 ? '' : 's'} updated`)
      setSelected(new Set())
      queryClient.invalidateQueries({ queryKey: ['artwork-vault-assets'] })
      queryClient.invalidateQueries({ queryKey: ['artwork-vault-stats'] })
    },
    onError: (error: any) => toast.error(error?.response?.data?.message || 'Bulk update failed'),
  })

  const chooseBulkStatus = () => {
    const statusChoice = window.prompt('Set status: In Design, Pending Approval, Changes Requested, Approved, or Archived')?.trim()
    if (statusChoice) bulkMutation.mutate({ status: statusChoice })
  }

  const handleFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || [])
    event.target.value = ''
    if (files.length) uploadMutation.mutate(files)
  }

  const exportCsv = async () => {
    try {
      const response = await api.get('/artworks/vault/export', { params: { ...params, page: undefined, limit: undefined }, responseType: 'blob' })
      const url = URL.createObjectURL(response.data)
      const link = document.createElement('a')
      link.href = url
      link.download = `artwork-vault-${new Date().toISOString().slice(0, 10)}.csv`
      link.click()
      URL.revokeObjectURL(url)
    } catch { toast.error('Artwork export failed') }
  }

  const applyPeriod = (next: string) => {
    const today = new Date()
    const iso = (date: Date) => date.toISOString().slice(0, 10)
    setPeriod(next)
    if (next === 'All Time') { setFrom(''); setTo('') }
    else if (next === 'Daily') { setFrom(iso(today)); setTo(iso(today)) }
    else if (next === 'Weekly') { const start = new Date(today); start.setDate(today.getDate() - 6); setFrom(iso(start)); setTo(iso(today)) }
    else { const start = new Date(today.getFullYear(), today.getMonth(), 1); setFrom(iso(start)); setTo(iso(today)) }
    setPage(1)
  }

  const resetFilters = () => { setSearch(''); setDebouncedSearch(''); setType(''); setOrderType(''); setStatus(''); setFrom(''); setTo(''); setQa(''); setReady(''); setEntitySearch(''); setAgentSearch(''); setDesignerSearch(''); setPeriod('All Time'); setPage(1) }
  const toggle = (id: string) => setSelected(previous => { const next = new Set(previous); next.has(id) ? next.delete(id) : next.add(id); return next })
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(rows.map(row => row.id)))
  const rangeStart = total ? (page - 1) * limit + 1 : 0
  const rangeEnd = Math.min(total, page * limit)

  const metrics = [
    { label: 'Total Assets', value: stats.total_assets, icon: <FolderOpen size={20} />, tone: 'blue' },
    { label: 'Artworks', value: stats.artworks, icon: <Palette size={20} />, tone: 'violet' },
    { label: 'Total Mockups', value: stats.mockups, icon: <ImageIcon size={20} />, tone: 'blue' },
    { label: 'Gangsheets', value: stats.gangsheets, icon: <Grid3X3 size={20} />, tone: 'orange' },
    { label: 'Ready Artwork', value: stats.ready_artwork, icon: <ShieldCheck size={20} />, tone: 'green' },
    { label: 'Ready Gangsheet', value: stats.ready_gangsheet, icon: <PackageCheck size={20} />, tone: 'green' },
    { label: 'Archived', value: stats.archived, icon: <Archive size={20} />, tone: 'slate' },
    { label: 'Artwork Pending', value: stats.artwork_pending, icon: <Clock3 size={20} />, tone: 'orange' },
    { label: 'Gangsheet Pending', value: stats.gangsheet_pending, icon: <Clock3 size={20} />, tone: 'orange' },
  ]

  return (
    <div className="av-page">
      <input ref={importRef} type="file" multiple hidden onChange={handleFiles} />
      <input ref={newArtworkRef} type="file" hidden accept="image/*,.pdf,.ai,.psd,.eps" onChange={handleFiles} />
      <div className="av-commandbar">
        <label className="av-search"><Search size={19} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search artwork by name, ID, lead, customer, type or status…" />{search && <button onClick={() => setSearch('')}><X size={16} /></button>}</label>
        <span className={cn('av-cloud-state', connected ? 'is-online' : 'is-offline')}><span />{connected === null ? 'Checking cloud' : connected ? 'Nextcloud live' : 'Nextcloud not configured'}</span>
        <button className="av-btn" onClick={() => syncMutation.mutate()} disabled={syncMutation.isPending}><RefreshCw size={17} className={syncMutation.isPending ? 'spin' : ''} /> Sync</button>
        <button className="av-btn" onClick={exportCsv}><Download size={17} /> Export</button>
        <button className="av-btn" onClick={() => importRef.current?.click()} disabled={uploadMutation.isPending}><Upload size={17} /> Import Files</button>
        <button className="av-btn av-btn-primary" onClick={() => newArtworkRef.current?.click()} disabled={uploadMutation.isPending}><ImageIcon size={17} /> New Artwork</button>
      </div>

      <div className="av-periodbar">
        {['Daily', 'Weekly', 'Monthly', 'All Time'].map(option => <button key={option} className={period === option ? 'is-active' : ''} onClick={() => applyPeriod(option)}>{option}</button>)}
        <span>Live data from Nextcloud and production records</span>
      </div>

      <div className="av-metrics">{metrics.map(metric => <MetricCard key={metric.label} {...metric} />)}</div>

      <div className="av-filter-card">
        <select value={orderType} onChange={event => { setOrderType(event.target.value); setPage(1) }} aria-label="Order type"><option value="">All Order Types</option><option value="apparel">Custom Apparel</option><option value="dtf">DTF Transfers</option><option value="gangsheet">Gangsheet</option></select>
        <select value={type} onChange={event => { setType(event.target.value as '' | AssetType); setPage(1) }} aria-label="Asset type"><option value="">All Types</option>{Object.entries(typeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
        <select value={status} onChange={event => { setStatus(event.target.value); setPage(1) }} aria-label="Status"><option value="">All Statuses</option><option>In Design</option><option>Pending Approval</option><option>Changes Requested</option><option>Approved</option><option>Archived</option></select>
        <label><span>Date from</span><input type="date" value={from} onChange={event => { setFrom(event.target.value); setPage(1) }} /></label>
        <label><span>Date to</span><input type="date" value={to} onChange={event => { setTo(event.target.value); setPage(1) }} /></label>
        <button className={cn('av-btn', showMore && 'is-active')} onClick={() => setShowMore(!showMore)}><SlidersHorizontal size={17} /> More Filters</button>
        <button className="av-btn" onClick={resetFilters}><RefreshCw size={16} /> Clear Filters</button>
        {showMore && <div className="av-advanced-filters"><label><span>Lead / Customer</span><input value={entitySearch} onChange={event => { setEntitySearch(event.target.value); setPage(1) }} placeholder="Search name or lead ID" /></label><label><span>Sales Agent</span><input value={agentSearch} onChange={event => { setAgentSearch(event.target.value); setPage(1) }} placeholder="Search agent" /></label><label><span>Designer</span><input value={designerSearch} onChange={event => { setDesignerSearch(event.target.value); setPage(1) }} placeholder="Search designer" /></label><label><span>QA Approved</span><select value={qa} onChange={event => { setQa(event.target.value); setPage(1) }}><option value="">All</option><option value="yes">Yes</option><option value="no">No</option></select></label><label><span>Production Ready</span><select value={ready} onChange={event => { setReady(event.target.value); setPage(1) }}><option value="">All</option><option value="yes">Yes</option><option value="no">No</option></select></label></div>}
      </div>

      <div className="av-tabs">{tabs.map(tab => <button key={tab.label} className={type === tab.value ? 'is-active' : ''} onClick={() => { setType(tab.value); setPage(1) }}>{tab.label}{tab.value && <span>{tab.value === 'artwork' ? stats.artworks : tab.value === 'mockup' ? stats.mockups : tab.value === 'gangsheet' ? stats.gangsheets : ''}</span>}</button>)}</div>

      {selected.size > 0 && <div className="av-selection"><strong>{selected.size} selected</strong><button onClick={chooseBulkStatus} disabled={bulkMutation.isPending}>Bulk Update</button><button onClick={() => bulkMutation.mutate({ status: 'Archived' })} disabled={bulkMutation.isPending}>Move to Archive</button><button onClick={() => setSelected(new Set())}>Clear</button></div>}

      <div className="av-table-card">
        <div className="av-table-scroll">
          <table className="av-table">
            <thead><tr>
              <th><input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Select page" /></th>
              <th>Date Created</th><th>Lead / Customer</th><th>Asset ID</th><th>Thumbnail</th><th>Lead ID</th><th>Order Type</th><th>Type</th><th>Sender</th><th>Sales Agent</th><th>Designer</th><th>Status</th><th>Latest Version</th><th>QA Approved</th><th>Production Ready</th><th>Actions</th>
            </tr></thead>
            <tbody>
              {isLoading && Array.from({ length: 8 }).map((_, index) => <tr key={index} className="av-skeleton-row"><td colSpan={16}><span /></td></tr>)}
              {!isLoading && isError && <tr><td colSpan={16}><div className="av-empty"><strong>Artwork data could not be loaded</strong><button onClick={() => refetch()}>Retry</button></div></td></tr>}
              {!isLoading && !isError && rows.length === 0 && <tr><td colSpan={16}><div className="av-empty"><Images size={34} /><strong>No artwork assets found</strong><span>{connected === false ? 'Connect Nextcloud on the backend, then sync the vault.' : 'No files match the selected filters.'}</span><button onClick={resetFilters}>Clear filters</button></div></td></tr>}
              {rows.map(asset => (
                <tr key={asset.id} className={cn(activeId === asset.id && 'is-active')} onClick={() => setActiveId(asset.id)}>
                  <td onClick={event => event.stopPropagation()}><input type="checkbox" checked={selected.has(asset.id)} onChange={() => toggle(asset.id)} /></td>
                  <td>{formatDate(asset.source_modified_at || asset.created_at)}</td>
                  <td><div className="av-entity"><span>{(asset.entity_name || 'U')[0].toUpperCase()}</span><strong>{asset.entity_name || 'Unlinked'}</strong></div></td>
                  <td><strong className="av-link">{asset.customer_number || asset.id.slice(0, 8).toUpperCase()}</strong></td>
                  <td><div className="av-table-thumb"><AssetPreview asset={asset} />{Number(asset.folder_file_count) > 1 && <small>+{Number(asset.folder_file_count) - 1}</small>}</div></td>
                  <td><span className="av-link">{asset.lead_number || '—'}</span></td>
                  <td>{asset.order_type ? asset.order_type.toUpperCase() : '—'}</td>
                  <td><span className={cn('av-type-pill', `av-type-${asset.asset_type}`)}>{typeLabels[asset.asset_type]}</span></td>
                  <td>{asset.sender_name || '—'}</td><td>{asset.sales_agent_name || '—'}</td><td>{asset.designer_name || '—'}</td>
                  <td><span className="av-status-pill">{asset.status || 'In Design'}</span></td>
                  <td>V{asset.version_no || 1}</td>
                  <td><span className={asset.qa_approved ? 'av-yes' : 'av-no'}>{asset.qa_approved ? 'Yes' : 'No'}</span></td>
                  <td><span className={asset.production_ready ? 'av-yes' : 'av-no'}>{asset.production_ready ? 'Yes' : 'No'}</span></td>
                  <td><button className="av-icon-btn" aria-label={`Actions for ${asset.file_name}`}><MoreHorizontal size={18} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <footer className="av-pagination">
          <span>Showing <strong>{rangeStart}</strong> to <strong>{rangeEnd}</strong> of <strong>{total}</strong> asset folders</span>
          <div><label>Rows per page <select value={limit} onChange={event => { setLimit(Number(event.target.value)); setPage(1) }}><option>10</option><option>20</option><option>50</option><option>100</option></select></label><button disabled={page <= 1} onClick={() => setPage(1)}><ChevronsLeft size={17} /></button><button disabled={page <= 1} onClick={() => setPage(page - 1)}><ChevronLeft size={17} /></button><strong>{page}</strong><span>of {totalPages}</span><button disabled={page >= totalPages} onClick={() => setPage(page + 1)}><ChevronRight size={17} /></button><button disabled={page >= totalPages} onClick={() => setPage(totalPages)}><ChevronsRight size={17} /></button></div>
        </footer>
      </div>
      {activeId && <ArtworkDetails id={activeId} onClose={() => setActiveId('')} onSelect={setActiveId} />}
    </div>
  )
}
