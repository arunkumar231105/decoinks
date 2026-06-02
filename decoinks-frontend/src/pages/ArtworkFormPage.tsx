import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Avatar } from '@mui/material'
import {
  ArrowLeft,
  CheckCircle2,
  Download,
  Expand,
  ExternalLink,
  FileImage,
  MessageCircle,
  Minus,
  Pencil,
  Plus,
  Send,
  Trash2,
  Upload,
} from 'lucide-react'
import { cn } from '../utils/cn'
import { api } from '../services/api'
import toast from '../utils/toast'

type VersionStatus = 'Approved' | 'Revision Requested' | 'Sent for Approval' | 'Original'

interface ArtworkVersion {
  id: number
  status: VersionStatus
  time: string
  note: string
}

const VERSION_BADGE: Record<VersionStatus, string> = {
  Approved: 'af-badge-approved',
  'Revision Requested': 'af-badge-revision',
  'Sent for Approval': 'af-badge-sent',
  Original: 'af-badge-original',
}


function ArtworkPlaceholder() {
  return (
    <svg className="af-artwork-svg" viewBox="0 0 760 520" role="img" aria-label="Colorful STAY WILD skull artwork">
      <defs>
        <linearGradient id="afBg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fb7185" />
          <stop offset="0.35" stopColor="#f59e0b" />
          <stop offset="0.68" stopColor="#14b8a6" />
          <stop offset="1" stopColor="#2563eb" />
        </linearGradient>
        <radialGradient id="afGlow" cx="50%" cy="42%" r="60%">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.48" />
          <stop offset="0.58" stopColor="#ffffff" stopOpacity="0.06" />
          <stop offset="1" stopColor="#111827" stopOpacity="0.24" />
        </radialGradient>
      </defs>
      <rect width="760" height="520" rx="30" fill="url(#afBg)" />
      <rect width="760" height="520" rx="30" fill="url(#afGlow)" />
      <path d="M114 418 C188 362 224 320 204 238 C186 162 247 78 362 72 C486 66 578 143 568 261 C561 343 608 373 656 426 C550 396 466 429 380 432 C278 436 214 392 114 418Z" fill="#111827" opacity="0.22" />
      <path d="M216 250 C216 145 289 88 382 88 C475 88 544 149 544 250 C544 316 512 354 468 382 L448 432 L400 404 L380 440 L360 404 L312 432 L292 382 C246 354 216 316 216 250Z" fill="#f8fafc" />
      <path d="M248 244 C256 196 289 166 326 166 C355 166 374 187 374 218 C374 264 331 291 289 286 C262 283 243 270 248 244Z" fill="#0f172a" />
      <path d="M386 218 C386 187 405 166 434 166 C471 166 504 196 512 244 C517 270 498 283 471 286 C429 291 386 264 386 218Z" fill="#0f172a" />
      <path d="M354 302 L382 250 L410 302 C392 316 372 316 354 302Z" fill="#0f172a" />
      <path d="M306 346 C348 370 414 370 456 346" fill="none" stroke="#0f172a" strokeWidth="18" strokeLinecap="round" />
      <path d="M301 339 L312 377 M342 352 L346 390 M383 357 L383 399 M424 352 L420 390 M465 339 L454 377" stroke="#f8fafc" strokeWidth="8" strokeLinecap="round" />
      <path d="M172 126 L232 132 L198 181 Z" fill="#22d3ee" opacity="0.9" />
      <path d="M584 116 L633 172 L562 178 Z" fill="#facc15" opacity="0.9" />
      <path d="M124 292 L174 258 L184 326 Z" fill="#fb7185" opacity="0.9" />
      <path d="M588 304 L648 270 L638 344 Z" fill="#2dd4bf" opacity="0.9" />
      <text x="380" y="470" textAnchor="middle" fill="#ffffff" fontSize="58" fontWeight="900" fontFamily="Impact, Arial Black, sans-serif">
        STAY WILD
      </text>
    </svg>
  )
}

export function ArtworkFormPage() {
  const navigate = useNavigate()
  const { id } = useParams()
  const [activeVersion, setActiveVersion] = useState(0)
  const [zoom, setZoom] = useState(100)
  const [notes, setNotes] = useState('')

  const { data: artwork } = useQuery({
    queryKey: ['artwork', id],
    queryFn: () => api.get(`/artworks/${id}`).then(r => r.data.data ?? r.data),
    enabled: Boolean(id),
  })

  const versions: ArtworkVersion[] = artwork?.versions ?? []
  const timeline: { title: string; time: string; body: string; icon: typeof CheckCircle2; tone: string }[] = []

  const quoteNumber = artwork?.quote_number ?? '-'
  const customerName = artwork?.customer_name ?? '-'

  const adjustZoom = (amount: number) => {
    setZoom((current) => Math.min(150, Math.max(70, current + amount)))
  }

  return (
    <div className="artwork-form-page">
      <header className="af-header">
        <div className="af-heading-row">
          <div>
            <nav className="af-breadcrumb" aria-label="Breadcrumb">
              <span>Quotes</span>
              <span>/</span>
              <span>{quoteNumber}</span>
              <span>/</span>
              <strong>Artwork Form</strong>
            </nav>
            <h2>Artwork Form</h2>
          </div>
          <div className="af-header-actions">
            <button className="lb-action-btn" onClick={() => navigate(-1)}>
              <ArrowLeft size={14} />
              Back to Quote
            </button>
            <button className="lb-action-btn lb-action-primary" onClick={() => toast.success('Upload version flow opened')}>
              <Plus size={14} />
              Upload New Version
            </button>
          </div>
        </div>

        <div className="af-info-row">
          <div>
            <span>Quote #</span>
            <strong>{quoteNumber}</strong>
          </div>
          <div>
            <span>Customer</span>
            <strong>{customerName}</strong>
          </div>
          <div>
            <span>Product Type</span>
            <strong>{artwork?.product_type ?? '-'}</strong>
          </div>
          <div>
            <span>Uploaded</span>
            <strong>{artwork?.created_at ? new Date(artwork.created_at).toLocaleDateString() : '-'}</strong>
          </div>
          <div>
            <span>Uploaded By</span>
            <strong className="af-agent">
              <Avatar sx={{ width: 22, height: 22, fontSize: 9, bgcolor: '#0D9488' }}>
                {(artwork?.uploader_name ?? '?').slice(0, 2).toUpperCase()}
              </Avatar>
              {artwork?.uploader_name ?? '-'}
            </strong>
          </div>
        </div>
      </header>

      <div className="af-layout">
        <aside className="af-left af-panel">
          <div className="af-panel-title">
            <FileImage size={17} />
            <h3>Artwork Versions</h3>
          </div>

          <div className="af-version-list">
            {versions.map((version) => (
              <button
                key={version.id}
                className={cn('af-version-card', activeVersion === version.id && 'af-version-card-active')}
                onClick={() => setActiveVersion(version.id)}
              >
                <div className="af-version-top">
                  <strong>Version {version.id}</strong>
                  <span className={cn('af-status-badge', VERSION_BADGE[version.status])}>
                    {version.status}
                  </span>
                </div>
                <time>{version.time}</time>
                <p>{version.note}</p>
              </button>
            ))}
          </div>

          <button className="af-upload-version" onClick={() => toast.success('Upload version flow opened')}>
            <Plus size={14} />
            Upload New Version
          </button>
        </aside>

        <main className="af-center">
          <section className="af-panel af-preview-panel">
            <div className="af-panel-toolbar">
              <div>
                <h3>Artwork Preview</h3>
                <p>Version {activeVersion} preview</p>
              </div>
              <div className="af-zoom-controls">
                <button title="Zoom out" onClick={() => adjustZoom(-10)}>
                  <Minus size={15} />
                </button>
                <span>{zoom}%</span>
                <button title="Zoom in" onClick={() => adjustZoom(10)}>
                  <Plus size={15} />
                </button>
                <button title="Fit to screen" onClick={() => setZoom(100)}>
                  <ExternalLink size={15} />
                </button>
                <button title="Fullscreen" onClick={() => document.documentElement.requestFullscreen?.()}>
                  <Expand size={15} />
                </button>
              </div>
            </div>

            <div className="af-artwork-stage">
              <div className="af-artwork-scale" style={{ transform: `scale(${zoom / 100})` }}>
                <ArtworkPlaceholder />
              </div>
            </div>
          </section>

          <section className="af-details-grid">
            <div className="af-panel af-version-details">
              <h3>Version Details</h3>
              <div className="af-detail-list">
                <div>
                  <span>Version Name</span>
                  <strong>Version {activeVersion} - Customer Approved</strong>
                </div>
                <div>
                  <span>Uploaded By</span>
                  <strong>Maria Jose</strong>
                </div>
                <div>
                  <span>Uploaded On</span>
                  <strong>05/22/2024 02:45 PM</strong>
                </div>
                <div>
                  <span>File Name</span>
                  <strong>stay-wild-skull-v3.ai</strong>
                </div>
                <div>
                  <span>File Size</span>
                  <strong>18.6 MB</strong>
                </div>
              </div>
            </div>

            <div className="af-panel af-notes-card">
              <div className="af-notes-header">
                <h3>Designer Notes</h3>
                <span>{notes.length}/280</span>
              </div>
              <textarea
                value={notes}
                maxLength={280}
                onChange={(event) => setNotes(event.target.value)}
              />
            </div>
          </section>
        </main>

        <aside className="af-right">
          <section className="af-panel af-history-panel">
            <h3>Approval &amp; Chat History</h3>
            <div className="af-timeline">
              {timeline.map((item) => {
                const Icon = item.icon
                return (
                  <article className="af-timeline-item" key={item.title}>
                    <span className={cn('af-timeline-icon', `af-timeline-${item.tone}`)}>
                      <Icon size={14} />
                    </span>
                    <div>
                      <div className="af-timeline-title">
                        <strong>{item.title}</strong>
                        <time>{item.time}</time>
                      </div>
                      <p>{item.body}</p>
                    </div>
                  </article>
                )
              })}
            </div>
          </section>

          <section className="af-panel af-actions-panel">
            <h3>Actions</h3>
            <button className="af-action-button" onClick={() => toast.success('Designer opened')}>
              <Pencil size={15} />
              Edit in Designer
            </button>
            <button className="af-action-button af-action-primary" onClick={() => toast.success('Artwork sent for approval')}>
              <Send size={15} />
              Send for Approval
            </button>
            <button className="af-action-button af-action-messenger" onClick={() => toast.success('Messenger thread opened')}>
              <MessageCircle size={15} />
              View in Chat (Messenger)
            </button>
            <button className="af-action-button" onClick={() => toast.success('Artwork download started')}>
              <Download size={15} />
              Download Artwork
            </button>
            <button className="af-action-button af-action-danger" onClick={() => toast.success('Version deleted')}>
              <Trash2 size={15} />
              Delete Version
            </button>
          </section>
        </aside>
      </div>
    </div>
  )
}
