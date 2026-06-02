import { useRef, useState, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from '../utils/toast'
import { Upload, Trash2, Zap, Loader2, ImageIcon, ExternalLink } from 'lucide-react'
import { api } from '../services/api'
import { cn } from '../utils/cn'

const LOCATIONS = ['Front', 'Back', 'Left Sleeve', 'Right Sleeve', 'Left Chest', 'Right Chest', 'Hood', 'Hem', 'Other']

interface Artwork {
  id: string
  artwork_no: string
  name: string
  file_url: string | null
  file_type: string | null
  status: string
  width_inches: number | null
  height_inches: number | null
  location_on_product: string | null
  created_at: string
}

interface GangsheetStatus {
  status: 'none' | 'pending' | 'generating' | 'ready' | 'error'
  url: string | null
  generatedAt: string | null
}

interface Props {
  orderId: string
}

export default function ArtworkUploader({ orderId }: Props) {
  const queryClient  = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging]   = useState(false)
  const [uploading, setUploading] = useState(false)

  // â”€â”€ Artworks list â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const { data: artworkData } = useQuery<{ artworks: Artwork[] }>({
    queryKey: ['order-artworks', orderId],
    queryFn: () => api.get(`/orders/${orderId}/artworks`).then(r => r.data),
  })
  const artworks = artworkData?.artworks ?? []

  // â”€â”€ Gangsheet status (polls while generating) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const { data: gsData } = useQuery<GangsheetStatus>({
    queryKey: ['gangsheet-status', orderId],
    queryFn:  () => api.get(`/orders/${orderId}/gangsheet/status`).then(r => r.data),
    refetchInterval: (q) => {
      const s = q.state.data?.status
      return s === 'generating' || s === 'pending' ? 2000 : false
    },
  })
  const gsStatus = gsData?.status ?? 'none'

  // â”€â”€ Delete artwork â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const deleteMutation = useMutation({
    mutationFn: (artworkId: string) => api.delete(`/orders/${orderId}/artworks/${artworkId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['order-artworks', orderId] })
      toast.success('Artwork removed')
    },
    onError: (err) => toast.apiError(err),
  })

  // â”€â”€ Generate gangsheet â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const generateMutation = useMutation({
    mutationFn: () => api.post(`/orders/${orderId}/gangsheet`),
    onSuccess: () => {
      toast.success('Gangsheet generation started')
      queryClient.invalidateQueries({ queryKey: ['gangsheet-status', orderId] })
    },
    onError: (err) => toast.apiError(err),
  })

  // â”€â”€ Upload handler â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const uploadFile = useCallback(async (file: File) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml', 'application/pdf']
    if (!allowed.includes(file.type)) {
      toast.error(`File type ${file.type} is not allowed`)
      return
    }
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('name', file.name.replace(/\.[^.]+$/, ''))
      await api.post(`/orders/${orderId}/artworks`, fd)
      queryClient.invalidateQueries({ queryKey: ['order-artworks', orderId] })
      toast.success('Artwork uploaded')
    } catch (err) {
      toast.apiError(err)
    } finally {
      setUploading(false)
    }
  }, [orderId, queryClient])

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    files.forEach(uploadFile)
    e.target.value = ''
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    Array.from(e.dataTransfer.files).forEach(uploadFile)
  }

  // â”€â”€ Thumbnail helper â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const thumbUrl = (aw: Artwork) => {
    if (!aw.file_url) return null
    const base = import.meta.env.VITE_BACKEND_URL ?? ''
    return `${base}/${aw.file_url}`
  }

  return (
    <div className="od-card">
      <div className="od-section-title-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <h3 className="od-section-title" style={{ margin: 0 }}>
          <ImageIcon size={15} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 6 }} />
          Artworks
          {artworks.length > 0 && (
            <span style={{ marginLeft: 8, fontSize: 12, fontWeight: 600, background: '#f3f4f6', color: '#6b7280', borderRadius: 10, padding: '1px 8px' }}>
              {artworks.length}
            </span>
          )}
        </h3>
        {artworks.length > 0 && (
          <button
            className={cn('btn-primary', 'flex items-center gap-2')}
            disabled={generateMutation.isPending || gsStatus === 'generating'}
            onClick={() => generateMutation.mutate()}
            style={{ fontSize: 12, padding: '6px 14px' }}
          >
            {gsStatus === 'generating' ? (
              <><Loader2 size={13} className="animate-spin" /> Generating...</>
            ) : (
              <><Zap size={13} /> Generate Gangsheet</>
            )}
          </button>
        )}
      </div>

      {/* Drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => fileInputRef.current?.click()}
        style={{
          border: `2px dashed ${dragging ? '#6366f1' : '#d1d5db'}`,
          borderRadius: 10,
          padding: '20px 16px',
          textAlign: 'center',
          cursor: 'pointer',
          background: dragging ? '#eef2ff' : '#fafafa',
          transition: 'all 0.15s',
          marginBottom: artworks.length > 0 ? 14 : 0,
        }}
      >
        <input ref={fileInputRef} type="file" multiple accept="image/*,application/pdf" style={{ display: 'none' }} onChange={onFileChange} />
        {uploading ? (
          <Loader2 size={22} className="animate-spin" style={{ margin: '0 auto', color: '#6366f1' }} />
        ) : (
          <>
            <Upload size={22} style={{ margin: '0 auto 6px', color: '#9ca3af' }} />
            <p style={{ fontSize: 13, color: '#6b7280', margin: 0 }}>
              Drop files here or <span style={{ color: '#6366f1', fontWeight: 600 }}>click to upload</span>
            </p>
            <p style={{ fontSize: 11, color: '#9ca3af', marginTop: 3 }}>PNG, JPG, WEBP, SVG, PDF - max 10 MB</p>
          </>
        )}
      </div>

      {/* Artwork thumbnails */}
      {artworks.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 10 }}>
          {artworks.map((aw) => {
            const src = thumbUrl(aw)
            return (
              <div
                key={aw.id}
                style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden', position: 'relative', background: '#f9fafb' }}
              >
                {src && aw.file_type !== 'pdf' ? (
                  <img src={src} alt={aw.name} style={{ width: '100%', height: 90, objectFit: 'contain', display: 'block' }} />
                ) : (
                  <div style={{ height: 90, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af' }}>
                    <ImageIcon size={28} />
                  </div>
                )}
                <div style={{ padding: '6px 8px' }}>
                  <p style={{ fontSize: 11, fontWeight: 600, color: '#374151', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={aw.name}>
                    {aw.name}
                  </p>
                  {aw.location_on_product && (
                    <p style={{ fontSize: 10, color: '#6b7280', margin: '2px 0 0' }}>{aw.location_on_product}</p>
                  )}
                  {aw.width_inches && aw.height_inches && (
                    <p style={{ fontSize: 10, color: '#9ca3af', margin: '1px 0 0' }}>{aw.width_inches}" Ã— {aw.height_inches}"</p>
                  )}
                </div>
                <button
                  onClick={() => deleteMutation.mutate(aw.id)}
                  disabled={deleteMutation.isPending}
                  style={{ position: 'absolute', top: 5, right: 5, background: 'rgba(255,255,255,0.85)', border: 'none', borderRadius: 6, padding: 4, cursor: 'pointer', display: 'flex', alignItems: 'center', color: '#ef4444' }}
                  title="Remove artwork"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            )
          })}
        </div>
      )}

      {/* Gangsheet result */}
      {gsStatus === 'ready' && gsData?.url && (
        <a
          href={`${import.meta.env.VITE_BACKEND_URL ?? ''}/${gsData.url}`}
          target="_blank"
          rel="noreferrer"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            marginTop: 14, padding: '7px 14px',
            background: '#f0fdf4', border: '1px solid #86efac',
            borderRadius: 8, fontSize: 13, fontWeight: 600, color: '#16a34a',
            textDecoration: 'none',
          }}
        >
          <ExternalLink size={13} /> View Gangsheet
        </a>
      )}
      {gsStatus === 'error' && (
        <p style={{ marginTop: 12, fontSize: 12, color: '#ef4444' }}>
          Gangsheet generation failed. Check artwork files and try again.
        </p>
      )}
    </div>
  )
}
