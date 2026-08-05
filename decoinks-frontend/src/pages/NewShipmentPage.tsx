import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation } from '@tanstack/react-query'
import toast from '../utils/toast'
import { ChevronRight, MapPin, RefreshCw } from 'lucide-react'
import { api } from '../services/api'
import { useFormDraft } from '../hooks/useFormDraft'
import { DraftBanner } from '../components/DraftBanner'

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

  // A parcel can carry several orders (combined billing). One empty row is
  // shown by default; single-order shipments just fill that row.
  const [orderIds, setOrderIds] = useState<string[]>([''])
  const setOrderAt = (i: number, id: string) =>
    setOrderIds(prev => prev.map((x, idx) => idx === i ? id : x))

  // Shipping cost + parcel weight — Shippo's /tracks endpoint does not return
  // these, so they are entered by hand (from the Shippo billing sheet).
  const [shippingCost, setShippingCost] = useState('')
  const [weightLbs, setWeightLbs] = useState('')
  const [isReturn, setIsReturn] = useState(false)

  // Load orders once so the user can pick which order(s) the parcel covers.
  const { data: ordersList = [] } = useQuery<Array<{ id: string; label: string }>>({
    queryKey: ['shipment-orders'],
    queryFn: () => api.get('/orders', { params: { page: 1, limit: 1000 } })
      .then(r => (r.data.data?.rows ?? r.data.data ?? []).map((o: Record<string, unknown>) => ({
        id: String(o.id),
        label: `${o.order_number} — ${o.shipping_name || o.customer_name || ''}`.trim(),
      }))),
  })

  // Draft persistence — survives refresh / hard refresh / redeploy.
  const { restored, clearDraft } = useFormDraft(
    'shipment:new',
    { trackingNumber, poId, orderIds, shippingCost, weightLbs, isReturn },
    saved => {
      if (typeof saved.trackingNumber === 'string') setTrackingNumber(saved.trackingNumber)
      if (typeof saved.poId === 'string') setPoId(saved.poId)
      if (Array.isArray(saved.orderIds)) setOrderIds(saved.orderIds as string[])
      if (typeof saved.shippingCost === 'string') setShippingCost(saved.shippingCost)
      if (typeof saved.weightLbs === 'string') setWeightLbs(saved.weightLbs)
      if (typeof saved.isReturn === 'boolean') setIsReturn(saved.isReturn)
    },
  )

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
      const cleanOrderIds = orderIds.filter(Boolean)
      const res = await api.post('/shipments', {
        carrier: preview?.carrier ?? null,
        tracking_number: trackingNumber.trim(),
        service_type: preview?.service_type ?? null,
        po_id: cleanOrderIds.length ? null : (poId || null),   // XOR — never both
        order_ids: cleanOrderIds,
        shipping_cost: shippingCost ? Number(shippingCost) : null,
        weight_lbs:    weightLbs    ? Number(weightLbs)    : null,
        is_return: isReturn,
        // Ship-to fields we already got from Shippo — persist so the list shows them
        ship_to_city: preview?.ship_to_city ?? null,
        ship_to_state: preview?.ship_to_state ?? null,
        ship_to_postal_code: preview?.ship_to_postal_code ?? null,
        tracking_status: preview?.tracking_status ?? null,
        status: preview?.tracking_status?.match(/deliver/i) ? 'Delivered' : 'In Transit',
      })
      const id = res.data.data.id
      // Best-effort: pull full live tracking (status, addresses, timeline) onto the row.
      await api.post(`/shipments/${id}/track`).catch(() => {})
      return id
    },
    onSuccess: () => { clearDraft(); toast.success('Shipment saved'); navigate('/shipments') },
    onError: (err: any) => toast.error(err.response?.data?.message ?? 'Failed to save shipment'),
  })

  const canFetch = trackingNumber.trim().length > 0 && !fetchMutation.isPending
  const history = Array.isArray(preview?.tracking_history) ? preview!.tracking_history : []

  return (
    <div className="ns-page">
      <DraftBanner show={restored} onDiscard={() => { clearDraft(); window.location.reload() }} />

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

        {/* SECTION 2 — Applied To (orders it covers) */}
        <div className="al-panel al-section">
          <div className="al-section-header">
            <span className="al-section-num">2</span>
            <h4>Applied To <span style={{ color: '#94a3b8', fontWeight: 400 }}>(orders this parcel covers)</span></h4>
          </div>
          <div className="ns-section-body">
            {orderIds.map((id, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 32px', gap: 8, marginBottom: 6 }}>
                <select className="al-input" value={id} onChange={e => setOrderAt(i, e.target.value)}>
                  <option value="">— Select order —</option>
                  {ordersList.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
                </select>
                <button type="button" aria-label="Remove"
                        onClick={() => setOrderIds(rows => rows.length > 1 ? rows.filter((_, idx) => idx !== i) : rows)}
                        style={{ border: '1px solid #e5e7eb', background: '#fff', borderRadius: 6, cursor: 'pointer', color: '#dc2626' }}>×</button>
              </div>
            ))}
            <button type="button" className="lb-action-btn" style={{ fontSize: 12, padding: '5px 10px' }}
                    onClick={() => setOrderIds(rows => [...rows, ''])}>
              + Add another order
            </button>
            <p style={{ fontSize: 11.5, color: '#6b7280', margin: '8px 0 0' }}>
              Combined-billing parcels (one label covering several orders) go here — leave blank and pick a PO below if this is a supplier shipment.
            </p>
          </div>
        </div>

        {/* SECTION 3 — Cost, weight, return */}
        <div className="al-panel al-section">
          <div className="al-section-header">
            <span className="al-section-num">3</span>
            <h4>Cost &amp; Weight <span style={{ color: '#94a3b8', fontWeight: 400 }}>(from Shippo billing)</span></h4>
          </div>
          <div className="ns-section-body">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div className="al-field">
                <label>Shipping Cost (USD)</label>
                <input type="number" step="0.01" className="al-input" value={shippingCost}
                       onChange={e => setShippingCost(e.target.value)} placeholder="0.00" />
              </div>
              <div className="al-field">
                <label>Weight (lbs)</label>
                <input type="number" step="0.01" className="al-input" value={weightLbs}
                       onChange={e => setWeightLbs(e.target.value)} placeholder="0.00" />
              </div>
            </div>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, marginTop: 10, cursor: 'pointer' }}>
              <input type="checkbox" checked={isReturn} onChange={e => setIsReturn(e.target.checked)} />
              Return / mistaken label (kept for the record, marked as not a customer shipment)
            </label>
          </div>
        </div>

        {/* SECTION 4 — Link to Purchase Order (only when no order is applied) */}
        {!orderIds.some(Boolean) && (
          <div className="al-panel al-section">
            <div className="al-section-header">
              <span className="al-section-num">4</span>
              <h4>Link to Purchase Order <span style={{ color: '#94a3b8', fontWeight: 400 }}>(optional)</span></h4>
            </div>
            <div className="ns-section-body">
              <div className="al-field">
                <label>Purchase Order</label>
                <PoCombobox onSelect={po => setPoId(po?.id ?? '')} />
              </div>
              <p style={{ fontSize: 11.5, color: '#6b7280', margin: '8px 0 0' }}>
                A shipment fulfils either an order or a PO — never both.
              </p>
            </div>
          </div>
        )}

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
