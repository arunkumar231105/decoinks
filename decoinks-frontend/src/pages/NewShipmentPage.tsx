import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation } from '@tanstack/react-query'
import toast from '../utils/toast'
import { ChevronRight, MapPin, RefreshCw } from 'lucide-react'
import { api } from '../services/api'

// ─── Shippo tracking preview shape (returned by /shipments/track-preview) ─────

interface Scan {
  status?: string | null
  substatus?: string | null
  status_details?: string | null
  status_date?: string | null
  location?: { city?: string | null; state?: string | null; zip?: string | null } | null
}
interface TrackPreview {
  carrier?: string
  tracking_status?: string
  status_details?: string
  substatus?: string
  service_type?: string
  estimated_delivery?: string
  original_eta?: string
  delivered_date?: string
  last_scan_city?: string
  last_scan_state?: string
  address_from_city?: string
  address_from_state?: string
  address_from_postal_code?: string
  ship_to_city?: string
  ship_to_state?: string
  ship_to_postal_code?: string
  tracking_history?: Scan[]
}

const fmtLoc = (c?: string | null, s?: string | null, z?: string | null) =>
  [c, s, z].filter(Boolean).join(', ') || '—'

// ─── Combobox for Purchase Orders (optional link) ────────────────────────────

interface PoRow {
  id: string
  po_number: string
  vendor_name?: string | null
  customer_name?: string | null
}

function PoCombobox({ onSelect }: { onSelect: (po: PoRow | null, text: string) => void }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  const { data: pos = [] } = useQuery({
    queryKey: ['pos-list-for-shipment'],
    queryFn: () => api.get('/purchase-orders', { params: { limit: 100 } }).then(r => r.data.data.rows),
  })

  const filtered = pos.filter((p: PoRow) =>
    p.po_number.toLowerCase().includes(text.toLowerCase()) ||
    (p.customer_name ?? p.vendor_name ?? '').toLowerCase().includes(text.toLowerCase())
  )

  useEffect(() => {
    const handler = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div className="no-customer-wrap" ref={ref} style={{ position: 'relative' }}>
      <input
        className="al-input"
        value={text}
        placeholder="Type or select a purchase order (optional)..."
        onChange={e => { setText(e.target.value); onSelect(null, e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
      />
      {open && filtered.length > 0 && (
        <div className="no-customer-suggestions">
          {filtered.slice(0, 8).map((p: PoRow) => (
            <div
              key={p.id}
              className="no-customer-suggestion-item"
              onMouseDown={() => { setText(p.po_number); onSelect(p, p.po_number); setOpen(false) }}
            >
              <span className="no-cust-name">{p.po_number}</span>
              {(p.customer_name ?? p.vendor_name) && <span className="no-cust-email">{p.customer_name ?? p.vendor_name}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Main Component ─────────────────────────────────────────────────────────

export function NewShipmentPage() {
  const navigate = useNavigate()

  const [trackingNumber, setTrackingNumber] = useState('')
  const [poId, setPoId] = useState('')
  const [preview, setPreview] = useState<TrackPreview | null>(null)

  const fetchMutation = useMutation({
    mutationFn: () => api.post('/shipments/track-preview', {
      tracking_number: trackingNumber.trim(),
    }).then(r => r.data.data as TrackPreview),
    onSuccess: (data) => {
      setPreview(data)
      toast.success(`Tracking found: ${data.tracking_status ?? 'no status yet'}`)
    },
    onError: (err: any) => { setPreview(null); toast.error(err.response?.data?.message ?? 'No tracking found') },
  })

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await api.post('/shipments', {
        carrier: preview?.carrier ?? null,
        tracking_number: trackingNumber.trim(),
        service_type: preview?.service_type ?? null,
        po_id: poId || null,
        status: 'In Transit',
      })
      const id = res.data.data.id
      // Best-effort: pull full live tracking (status, addresses, timeline) onto the row.
      await api.post(`/shipments/${id}/track`).catch(() => {})
      return id
    },
    onSuccess: () => { toast.success('Shipment saved'); navigate('/shipments') },
    onError: (err: any) => toast.error(err.response?.data?.message ?? 'Failed to save shipment'),
  })

  const canFetch = trackingNumber.trim().length > 0 && !fetchMutation.isPending
  const history = Array.isArray(preview?.tracking_history) ? preview!.tracking_history : []

  return (
    <div className="ns-page">

      {/* ── HEADER ── */}
      <div className="ns-header">
        <div>
          <div className="ns-breadcrumb">
            <span onClick={() => navigate('/shipments')} style={{ cursor: 'pointer' }}>Shipments</span>
            <ChevronRight size={13} />
            <strong>New Shipment</strong>
          </div>
          <h2 className="ns-page-title">New Shipment</h2>
        </div>
        <div className="ns-header-actions">
          <button className="lb-action-btn" onClick={() => navigate(-1)}>Cancel</button>
          <button className="lb-action-btn lb-action-primary ns-save-btn" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || !trackingNumber.trim()}>
            {saveMutation.isPending ? 'Saving...' : 'Save Shipment'}
          </button>
        </div>
      </div>

      {/* ── CONTENT ── */}
      <div className="ns-content">

        {/* SECTION 1 — Track a Shipment */}
        <div className="al-panel al-section">
          <div className="al-section-header">
            <span className="al-section-num">1</span>
            <h4>Track a Shipment</h4>
          </div>
          <div className="ns-section-body">
            <div className="al-field">
              <label>Tracking ID</label>
              <div style={{ display: 'flex', gap: 10 }}>
                <input
                  type="text" className="al-input" value={trackingNumber} style={{ flex: 1 }}
                  onChange={e => { setTrackingNumber(e.target.value); setPreview(null) }}
                  placeholder="Paste tracking number — carrier is auto-detected"
                  onKeyDown={e => { if (e.key === 'Enter' && canFetch) fetchMutation.mutate() }}
                />
                <button className="lb-action-btn lb-action-primary" onClick={() => fetchMutation.mutate()} disabled={!canFetch} style={{ gap: 6, whiteSpace: 'nowrap' }}>
                  <RefreshCw size={14} /> {fetchMutation.isPending ? 'Fetching…' : 'Fetch from Shippo'}
                </button>
              </div>
            </div>

            {/* Live preview */}
            {preview && (
              <div style={{ marginTop: 18, borderTop: '1px solid #eef2f7', paddingTop: 16 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 24px' }}>
                  {[
                    ['Carrier', preview.carrier ?? '—'],
                    ['Status', preview.tracking_status ?? '—'],
                    ['Details', preview.status_details ?? '—'],
                    ['Sub-status', preview.substatus ?? '—'],
                    ['Service', preview.service_type ?? '—'],
                    ['From', fmtLoc(preview.address_from_city, preview.address_from_state, preview.address_from_postal_code)],
                    ['Ship To', fmtLoc(preview.ship_to_city, preview.ship_to_state, preview.ship_to_postal_code)],
                    ['Last Scan', fmtLoc(preview.last_scan_city, preview.last_scan_state)],
                    ['Original ETA', preview.original_eta ?? '—'],
                    ['Estimated Delivery', preview.estimated_delivery ?? '—'],
                    ['Delivered', preview.delivered_date ?? '—'],
                  ].map(([label, val]) => (
                    <div key={label} style={{ display: 'flex', gap: 8, fontSize: 13 }}>
                      <span style={{ color: '#64748b', minWidth: 130 }}>{label}</span>
                      <span style={{ fontWeight: 500, wordBreak: 'break-word' }}>{val}</span>
                    </div>
                  ))}
                </div>

                {history.length > 0 && (
                  <>
                    <h4 style={{ margin: '18px 0 10px', fontSize: 13, fontWeight: 700 }}>Tracking Timeline</h4>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                      {history.slice().reverse().map((h, i) => (
                        <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                          <MapPin size={15} style={{ color: '#0ea5e9', marginTop: 2, flexShrink: 0 }} />
                          <div style={{ fontSize: 13 }}>
                            <div style={{ fontWeight: 600 }}>{h.status ?? '—'}{h.substatus ? ` · ${h.substatus}` : ''}</div>
                            {h.status_details && <div style={{ color: '#475569' }}>{h.status_details}</div>}
                            <div style={{ color: '#94a3b8' }}>
                              {fmtLoc(h.location?.city, h.location?.state, h.location?.zip)}
                              {h.status_date ? ` — ${new Date(h.status_date).toLocaleString()}` : ''}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        {/* SECTION 2 — Link to Purchase Order (optional) */}
        <div className="al-panel al-section">
          <div className="al-section-header">
            <span className="al-section-num">2</span>
            <h4>Link to Purchase Order <span style={{ color: '#94a3b8', fontWeight: 400 }}>(optional)</span></h4>
          </div>
          <div className="ns-section-body">
            <div className="al-field">
              <label>Purchase Order</label>
              <PoCombobox onSelect={po => setPoId(po?.id ?? '')} />
            </div>
          </div>
        </div>

      </div>{/* end ns-content */}

      {/* ── BOTTOM BAR ── */}
      <div className="al-bottom-bar">
        <div className="al-bottom-left" />
        <div className="al-bottom-center" />
        <div className="al-bottom-right">
          <button className="lb-action-btn" onClick={() => navigate(-1)}>Cancel</button>
          <button className="lb-action-btn lb-action-primary ns-save-btn" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || !trackingNumber.trim()}>
            {saveMutation.isPending ? 'Saving...' : 'Create Shipment'}
          </button>
        </div>
      </div>

    </div>
  )
}
