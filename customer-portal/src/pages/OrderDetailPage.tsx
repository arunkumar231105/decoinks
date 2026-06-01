import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Download, ZoomIn, ZoomOut, Maximize2, RefreshCw } from 'lucide-react'
import api from '../services/api'
import { cn } from '../utils/cn'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Artwork { id: string; artwork_number: string; name: string; file_url: string; thumbnail_url: string | null; width: number; height: number; position: string }
interface ApparelItem { id: string; item: string; brand?: string; color: string; qty: number; artwork_no?: string; front_image?: string; back_image?: string }
interface GangsheetItem { id: string; gangsheet_number?: string; width: number; height: number; efficiency?: number; qty: number; front_image?: string }
interface DtfItem { id: string; artwork_name: string; size?: string; qty: number; unit_price: number; artwork_image?: string }

interface Order {
  id: string; order_number: string; status: string; order_type: string
  order_date: string; due_date: string | null; notes: string | null
  purchase_order_number: string | null; vendor_name?: string | null
  contact_name: string | null; contact_email: string | null; contact_phone: string | null
  shipping_name: string | null; shipping_address: string | null
  items: (ApparelItem | GangsheetItem | DtfItem)[]
  artworks: Artwork[]
}

// ─── Config ───────────────────────────────────────────────────────────────────

const STATUS_BADGE: Record<string, string> = {
  'In Production': 'bg-blue-50 text-blue-700',
  Shipped:         'bg-orange-50 text-orange-700',
  Completed:       'bg-green-50 text-green-700',
  'On Hold':       'bg-yellow-50 text-yellow-700',
  Cancelled:       'bg-red-50 text-red-700',
  Confirmed:       'bg-emerald-50 text-emerald-700',
}

const fmt     = (d: string | null) => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'
const THUMB   = (src?: string | null) => src
  ? <img src={src} alt="" className="w-10 h-10 object-contain bg-gray-900 rounded" />
  : <div className="w-10 h-10 bg-gray-100 rounded flex items-center justify-center text-[9px] text-gray-400">None</div>

// ─── Items tables ─────────────────────────────────────────────────────────────

function ApparelTable({ items }: { items: ApparelItem[] }) {
  return (
    <table className="w-full">
      <thead>
        <tr className="border-b border-gray-100 bg-gray-50">
          {['#', 'Item', 'Brand', 'Color', 'Qty', 'Artwork No', 'Front', 'Back', 'Sleeve', 'Label'].map((h) => (
            <th key={h} className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500">{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {items.length === 0 ? (
          <tr><td colSpan={10} className="text-center py-8 text-sm text-gray-400">No items</td></tr>
        ) : items.map((item, idx) => (
          <tr key={item.id} className="border-b border-gray-50 hover:bg-gray-50">
            <td className="px-3 py-3 text-sm text-gray-500">{idx + 1}</td>
            <td className="px-3 py-3 text-sm text-gray-900">{item.item}</td>
            <td className="px-3 py-3 text-sm text-gray-600">{item.brand ?? '—'}</td>
            <td className="px-3 py-3 text-sm text-gray-600">{item.color}</td>
            <td className="px-3 py-3 text-sm font-medium text-gray-900">{item.qty}</td>
            <td className="px-3 py-3 text-sm text-gray-600">{item.artwork_no ?? '—'}</td>
            <td className="px-3 py-3">{THUMB(item.front_image)}</td>
            <td className="px-3 py-3">{THUMB(item.back_image)}</td>
            <td className="px-3 py-3">{THUMB(null)}</td>
            <td className="px-3 py-3">{THUMB(null)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function GangsheetTable({ items }: { items: GangsheetItem[] }) {
  return (
    <table className="w-full">
      <thead>
        <tr className="border-b border-gray-100 bg-gray-50">
          {['#', 'Gangsheet No', 'Width', 'Height', 'Efficiency', 'Qty', 'Preview'].map((h) => (
            <th key={h} className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500">{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {items.length === 0 ? (
          <tr><td colSpan={7} className="text-center py-8 text-sm text-gray-400">No items</td></tr>
        ) : items.map((item, idx) => (
          <tr key={item.id} className="border-b border-gray-50 hover:bg-gray-50">
            <td className="px-4 py-3 text-sm text-gray-500">{idx + 1}</td>
            <td className="px-4 py-3 text-sm font-medium text-accent">{item.gangsheet_number ?? `GS-${idx + 1}`}</td>
            <td className="px-4 py-3 text-sm text-gray-700">{item.width} in</td>
            <td className="px-4 py-3 text-sm text-gray-700">{item.height} in</td>
            <td className="px-4 py-3 text-sm text-gray-700">{item.efficiency != null ? `${item.efficiency}%` : '—'}</td>
            <td className="px-4 py-3 text-sm font-medium text-gray-900">{item.qty}</td>
            <td className="px-4 py-3">{THUMB(item.front_image)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function DtfTable({ items }: { items: DtfItem[] }) {
  return (
    <table className="w-full">
      <thead>
        <tr className="border-b border-gray-100 bg-gray-50">
          {['#', 'Artwork Name', 'Size', 'Qty', 'Unit Price', 'Preview'].map((h) => (
            <th key={h} className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500">{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {items.length === 0 ? (
          <tr><td colSpan={6} className="text-center py-8 text-sm text-gray-400">No items</td></tr>
        ) : items.map((item, idx) => (
          <tr key={item.id} className="border-b border-gray-50 hover:bg-gray-50">
            <td className="px-4 py-3 text-sm text-gray-500">{idx + 1}</td>
            <td className="px-4 py-3 text-sm text-gray-900">{item.artwork_name}</td>
            <td className="px-4 py-3 text-sm text-gray-600">{item.size ?? '—'}</td>
            <td className="px-4 py-3 text-sm font-medium text-gray-900">{item.qty}</td>
            <td className="px-4 py-3 text-sm text-gray-700">${item.unit_price?.toFixed(2) ?? '—'}</td>
            <td className="px-4 py-3">{THUMB(item.artwork_image)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function OrderDetailPage() {
  const { id }  = useParams()
  const [zoom, setZoom]           = useState(100)
  const [activeArtwork, setActiveArtwork] = useState(0)
  const [activeTab, setActiveTab] = useState<'items' | 'gangsheets'>('items')
  const [lightbox, setLightbox]   = useState(false)

  const { data, isLoading } = useQuery<Order>({
    queryKey: ['order', id],
    queryFn:  () => api.get(`/orders/${id}`).then((r) => r.data.order),
    enabled:  !!id,
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin w-8 h-8 border-2 border-accent border-t-transparent rounded-full" />
      </div>
    )
  }

  if (!data) {
    return (
      <div className="text-center py-16 text-gray-500">
        <p className="text-lg font-medium">Order not found</p>
        <Link to="/orders" className="text-accent hover:underline text-sm mt-2 inline-block">← Back to Orders</Link>
      </div>
    )
  }

  const o = data
  const currentArtwork = o.artworks?.[activeArtwork] ?? null

  const isGangsheet = o.order_type === 'gangsheet'
  const isApparel   = o.order_type === 'apparel'
  const isDtf       = o.order_type === 'dtf'

  return (
    <>
      <div className="space-y-5">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <Link to="/orders" className="hover:text-gray-700">Orders</Link>
          <span>/</span>
          <span className="text-gray-900 font-medium">{o.order_number}</span>
        </div>

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">Order Details</h2>
            <p className="text-sm text-gray-500 mt-1">View order items, artwork and current status.</p>
          </div>
          <div className="flex items-center gap-2">
            <button className="btn-secondary flex items-center gap-2 text-sm" onClick={() => window.print()}>
              <Download size={14} /> Preview Purchase Order in English
            </button>
            <button className="btn-secondary flex items-center gap-2 text-sm" onClick={() => window.print()}>
              <Download size={14} /> 中文预览
            </button>
            <Link to={`/orders/${o.id}/status-updates`} className="btn-primary flex items-center gap-2 text-sm">
              Submit Status Update
            </Link>
            <Link to="/orders" className="btn-secondary flex items-center gap-2 text-sm">
              <ArrowLeft size={14} /> Back to Orders
            </Link>
          </div>
        </div>

        {/* Info strip */}
        <div className="card">
          <div className="grid grid-cols-6 gap-4 text-sm">
            {[
              { label: 'Purchase Order',     value: o.purchase_order_number ?? '—' },
              { label: 'Order ID',           value: o.order_number },
              { label: 'Order Date',         value: fmt(o.order_date) },
              { label: 'Due Date',           value: fmt(o.due_date) },
              { label: 'Order Type',         value: o.order_type },
              { label: 'Vendor / Fulfillment', value: o.vendor_name ?? 'Decoinks Printshop' },
            ].map(({ label, value }) => (
              <div key={label}>
                <p className="text-xs text-gray-500 font-medium mb-0.5">{label}</p>
                <p className="font-semibold text-gray-900 capitalize">{value}</p>
              </div>
            ))}
          </div>
          <div className="mt-3 pt-3 border-t border-gray-100 flex items-center gap-3">
            <span className="text-xs text-gray-500">Status</span>
            <span className={cn('badge', STATUS_BADGE[o.status] ?? 'bg-gray-100 text-gray-600')}>{o.status}</span>
          </div>
        </div>

        {/* Main content + Artwork panel */}
        <div className="grid grid-cols-3 gap-5">
          {/* Left — items (2/3) */}
          <div className="col-span-2 space-y-5">

            {/* ── Section 1/2: Order Items with tabs ── */}
            <div className="card p-0 overflow-hidden">
              {/* Section header */}
              <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-6 h-6 bg-accent text-white rounded-full text-xs font-bold flex items-center justify-center">1</span>
                  <h3 className="font-semibold text-gray-900">Order Items</h3>
                </div>
                <span className="text-xs text-gray-500">{o.items?.length ?? 0} item{o.items?.length !== 1 ? 's' : ''}</span>
              </div>

              {/* Tabs — shown for gangsheet (has both items + gangsheet view) */}
              {isGangsheet && (
                <div className="flex border-b border-gray-100">
                  {(['items', 'gangsheets'] as const).map((tab) => (
                    <button
                      key={tab}
                      onClick={() => setActiveTab(tab)}
                      className={cn(
                        'px-5 py-2.5 text-sm font-medium capitalize transition-colors',
                        activeTab === tab
                          ? 'border-b-2 border-accent text-accent'
                          : 'text-gray-500 hover:text-gray-700',
                      )}
                    >
                      {tab === 'items' ? 'Items' : 'Gangsheets'}
                    </button>
                  ))}
                </div>
              )}

              <div className="overflow-x-auto">
                {isApparel && <ApparelTable items={o.items as ApparelItem[]} />}
                {isGangsheet && <GangsheetTable items={o.items as GangsheetItem[]} />}
                {isDtf && <DtfTable items={o.items as DtfItem[]} />}
              </div>
            </div>

            {/* ── Section 4: Shipping Information ── */}
            <div className="card">
              <div className="flex items-center gap-2 mb-4">
                <span className="w-6 h-6 bg-accent text-white rounded-full text-xs font-bold flex items-center justify-center">4</span>
                <h3 className="font-semibold text-gray-900">Shipping Information</h3>
              </div>
              <div className="grid grid-cols-2 gap-6 text-sm">
                <div>
                  <p className="font-medium text-gray-700 mb-2">Contact</p>
                  <p className="text-gray-600">{o.contact_name ?? '—'}</p>
                  <p className="text-gray-600">{o.contact_email ?? '—'}</p>
                  <p className="text-gray-600">{o.contact_phone ?? '—'}</p>
                </div>
                <div>
                  <p className="font-medium text-gray-700 mb-2">Ship To</p>
                  <p className="text-gray-600">{o.shipping_name ?? '—'}</p>
                  <p className="text-gray-600">{o.shipping_address ?? '—'}</p>
                </div>
              </div>
            </div>

            {/* ── Section 5: Special Instructions ── */}
            {o.notes && (
              <div className="card">
                <div className="flex items-center gap-2 mb-3">
                  <span className="w-6 h-6 bg-accent text-white rounded-full text-xs font-bold flex items-center justify-center">5</span>
                  <h3 className="font-semibold text-gray-900">Special Instructions</h3>
                </div>
                <p className="text-sm text-gray-600 whitespace-pre-line">{o.notes}</p>
              </div>
            )}
          </div>

          {/* Right — Artwork Preview (1/3) */}
          <div className="space-y-4">
            {/* ── Section 3: Artwork Preview ── */}
            <div className="card h-fit sticky top-20">
              <div className="flex items-center gap-2 mb-3">
                <span className="w-6 h-6 bg-accent text-white rounded-full text-xs font-bold flex items-center justify-center">3</span>
                <h3 className="font-semibold text-gray-900">Artwork Preview</h3>
              </div>

              {/* Zoom + action controls */}
              <div className="flex items-center gap-1.5 mb-3">
                <button onClick={() => setZoom((z) => Math.max(30, z - 10))} className="p-1.5 rounded border border-gray-200 hover:bg-gray-50" title="Zoom out">
                  <ZoomOut size={13} />
                </button>
                <span className="text-xs text-gray-600 w-10 text-center font-mono">{zoom}%</span>
                <button onClick={() => setZoom((z) => Math.min(200, z + 10))} className="p-1.5 rounded border border-gray-200 hover:bg-gray-50" title="Zoom in">
                  <ZoomIn size={13} />
                </button>
                <button onClick={() => setZoom(100)} className="p-1.5 rounded border border-gray-200 hover:bg-gray-50 ml-1" title="Reset zoom">
                  <RefreshCw size={13} />
                </button>
                <button onClick={() => setLightbox(true)} className="p-1.5 rounded border border-gray-200 hover:bg-gray-50" title="Fullscreen">
                  <Maximize2 size={13} />
                </button>
                {currentArtwork?.file_url && (
                  <a
                    href={currentArtwork.file_url}
                    download
                    className="ml-auto p-1.5 rounded border border-gray-200 hover:bg-gray-50 flex items-center gap-1 text-xs text-gray-600"
                  >
                    <Download size={12} /> Download
                  </a>
                )}
              </div>

              {/* Canvas */}
              <div className="bg-gray-900 rounded-lg overflow-hidden flex items-center justify-center" style={{ height: 200 }}>
                {currentArtwork?.file_url ? (
                  <img
                    src={currentArtwork.file_url}
                    alt={currentArtwork.name}
                    style={{ transform: `scale(${zoom / 100})`, transition: 'transform 0.2s', maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
                  />
                ) : (
                  <span className="text-white/30 text-sm">No artwork</span>
                )}
              </div>

              {/* Artwork metadata */}
              {currentArtwork && (
                <div className="mt-3 space-y-1.5 text-xs text-gray-600">
                  <div className="flex justify-between"><span className="text-gray-400">Code</span><span className="font-medium">{currentArtwork.artwork_number}</span></div>
                  <div className="flex justify-between"><span className="text-gray-400">Name</span><span className="font-medium truncate ml-2">{currentArtwork.name}</span></div>
                  <div className="flex justify-between"><span className="text-gray-400">Position</span><span className="font-medium">{currentArtwork.position ?? '—'}</span></div>
                  <div className="flex justify-between"><span className="text-gray-400">Dimensions</span><span className="font-medium">{currentArtwork.width}×{currentArtwork.height} in</span></div>
                </div>
              )}

              {/* Artwork thumbnails strip */}
              {o.artworks?.length > 1 && (
                <div className="mt-3 flex gap-2 flex-wrap">
                  {o.artworks.map((aw, i) => (
                    <button
                      key={aw.id}
                      onClick={() => setActiveArtwork(i)}
                      className={cn('w-12 h-12 rounded border-2 overflow-hidden bg-gray-900 flex-shrink-0', i === activeArtwork ? 'border-accent' : 'border-gray-200')}
                    >
                      {aw.thumbnail_url
                        ? <img src={aw.thumbnail_url} alt={aw.name} className="w-full h-full object-contain" />
                        : <span className="text-[9px] text-white/40">AW</span>
                      }
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Lightbox */}
      {lightbox && currentArtwork?.file_url && (
        <div
          className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center p-8"
          onClick={() => setLightbox(false)}
        >
          <div className="relative max-w-5xl max-h-full" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => setLightbox(false)} className="absolute -top-10 right-0 text-white hover:text-gray-300 text-sm">
              ✕ Close
            </button>
            <img src={currentArtwork.file_url} alt={currentArtwork.name} className="max-w-full max-h-[85vh] object-contain rounded-lg" />
            <p className="text-white text-center text-sm mt-3">{currentArtwork.name} — {currentArtwork.artwork_number}</p>
          </div>
        </div>
      )}
    </>
  )
}
