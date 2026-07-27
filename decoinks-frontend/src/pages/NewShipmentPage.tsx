import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation } from '@tanstack/react-query'
import toast from '../utils/toast'
import { CalendarDays, ChevronDown, ChevronRight, Package } from 'lucide-react'
import { cn } from '../utils/cn'
import { api } from '../services/api'
import { useAuthStore } from '../store/authStore'

// ─── Constants ──────────────────────────────────────────────────────────────

const CARRIERS = ['USPS', 'UPS', 'FedEx', 'DHL', 'Local Courier']

// Service levels per carrier → maps to the shipments.service_type column
// (Shippo servicelevel.name).
const SERVICE_LEVELS: Record<string, string[]> = {
  USPS:            ['Priority Mail', 'First-Class Mail', 'USPS Retail Ground', 'Priority Mail Express'],
  UPS:             ['UPS Ground', 'UPS 2nd Day Air', 'UPS Next Day Air', 'UPS Standard'],
  FedEx:           ['FedEx Ground', 'FedEx 2Day', 'FedEx Standard Overnight', 'FedEx Priority Overnight'],
  DHL:             ['DHL Express Worldwide', 'DHL Express 12:00', 'DHL Economy Select'],
  'Local Courier': ['Same Day Delivery', 'Next Day Delivery'],
}

// Internal workflow statuses — must match the backend shipment_status enum.
const SHIPMENT_STATUSES = ['Pending', 'Label Created', 'Picked Up', 'In Transit', 'Delivered', 'Exception']
const TIMELINE_STEPS    = ['Pending', 'Label Created', 'Picked Up', 'In Transit', 'Delivered']

const today = () => new Date().toISOString().split('T')[0]

// ─── Combobox for Orders ────────────────────────────────────────────────────

interface OrderRow {
  id: string
  order_number: string
  supplier_name?: string | null
  customer_name?: string | null
  contact_name?: string | null
  shipping_name?: string | null
  shipping_address?: string | null
}

function OrderCombobox({ orderText, onSelect }: {
  orderText: string
  onSelect: (order: OrderRow | null, text: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState(orderText)
  const ref = useRef<HTMLDivElement>(null)

  const { data: orders = [] } = useQuery({
    queryKey: ['orders-list-for-shipment'],
    queryFn: () => api.get('/orders', { params: { limit: 100 } }).then(r => r.data.data.rows),
  })

  const filtered = orders.filter((o: OrderRow) =>
    o.order_number.toLowerCase().includes(text.toLowerCase()) ||
    (o.customer_name ?? o.supplier_name ?? '').toLowerCase().includes(text.toLowerCase())
  )

  useEffect(() => {
    const handler = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div className="no-customer-wrap" ref={ref} style={{ position: 'relative' }}>
      <input
        className="ns-cell-select ns-order-select no-customer-input"
        value={text}
        placeholder="Type or select an order..."
        onChange={e => { setText(e.target.value); onSelect(null, e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
      />
      {open && filtered.length > 0 && (
        <div className="no-customer-suggestions">
          {filtered.slice(0, 8).map((o: OrderRow) => (
            <div
              key={o.id}
              className="no-customer-suggestion-item"
              onMouseDown={() => {
                setText(o.order_number)
                onSelect(o, o.order_number)
                setOpen(false)
              }}
            >
              <span className="no-cust-name">{o.order_number}</span>
              {(o.customer_name ?? o.supplier_name) && <span className="no-cust-email">{o.customer_name ?? o.supplier_name}</span>}
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
  const { user } = useAuthStore()

  // Header / link
  const [orderId,   setOrderId]   = useState('')
  const [orderText, setOrderText] = useState('')
  const [agentName, setAgentName] = useState(user?.name ?? '')
  const [shipDate,  setShipDate]  = useState(today())

  // Carrier + tracking
  const [carrier,       setCarrier]       = useState('USPS')
  const [serviceType,   setServiceType]   = useState(SERVICE_LEVELS['USPS'][0])
  const [trackingNumber, setTrackingNumber] = useState('')
  const [shipStatus,    setShipStatus]    = useState('Pending')

  // Ship-to (delivery) address
  const [customerName, setCustomerName] = useState('')
  const [address,      setAddress]      = useState('')
  const [city,         setCity]         = useState('')
  const [stateVal,     setStateVal]     = useState('')
  const [postalCode,   setPostalCode]   = useState('')

  // Package / cost
  const [weight,   setWeight]   = useState('')
  const [estCost,  setEstCost]  = useState('')
  const [notes,    setNotes]    = useState('')

  // Delivery dates
  const [estDelivery,   setEstDelivery]   = useState('')
  const [deliveredDate, setDeliveredDate] = useState('')

  const saveMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => api.post('/shipments', data).then(r => r.data.data),
    onSuccess: () => {
      toast.success('Shipment created')
      navigate('/shipments')
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.message ?? 'Failed to create shipment')
    },
  })

  const handleSave = () => {
    saveMutation.mutate({
      order_id:            orderId || null,
      agent_name:          agentName.trim() || null,
      carrier:             carrier || null,
      service_type:        serviceType || null,
      tracking_number:     trackingNumber.trim() || null,
      status:              shipStatus,
      customer_name:       customerName.trim() || null,
      recipient_name:      customerName.trim() || null,
      address:             address.trim() || null,
      ship_to_city:        city.trim() || null,
      ship_to_state:       stateVal.trim() || null,
      ship_to_postal_code: postalCode.trim() || null,
      ship_date:           shipDate || null,
      estimated_delivery:  estDelivery || null,
      delivered_date:      deliveredDate || null,
      weight_lbs:          weight ? Number(weight) : null,
      shipping_cost:       estCost ? Number(estCost) : null,
      notes:               notes.trim() || null,
    })
  }

  const handleCarrierChange = (c: string) => {
    setCarrier(c)
    setServiceType(SERVICE_LEVELS[c]?.[0] ?? '')
  }

  // When an order is picked, best-effort auto-fill the ship-to identity.
  const applyOrder = (order: OrderRow | null, text: string) => {
    setOrderId(order?.id ?? '')
    setOrderText(text)
    if (order) {
      const name = order.customer_name ?? order.contact_name ?? order.shipping_name ?? order.supplier_name ?? ''
      if (name && !customerName) setCustomerName(name)
      if (order.shipping_address && !address) setAddress(order.shipping_address)
    }
  }

  const activeStep = TIMELINE_STEPS.findIndex(s => s.toLowerCase() === shipStatus.toLowerCase())

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
          <button className="lb-action-btn lb-action-primary ns-save-btn" onClick={handleSave} disabled={saveMutation.isPending}>
            {saveMutation.isPending ? 'Saving...' : 'Save Shipment'}
          </button>
        </div>
      </div>

      {/* ── TOP INFO CARD ── */}
      <div className="ns-info-card">
        <div className="ns-info-cell">
          <span>Shipment ID</span>
          <strong className="ns-id-val">AUTO-GENERATED</strong>
        </div>
        <div className="ns-info-cell">
          <span>Order</span>
          <OrderCombobox orderText={orderText} onSelect={applyOrder} />
        </div>
        <div className="ns-info-cell">
          <span>Ship Date</span>
          <div className="ns-date-wrap">
            <CalendarDays size={12} className="ns-date-icon" />
            <input type="date" className="ns-date-input" value={shipDate} onChange={e => setShipDate(e.target.value)} />
          </div>
        </div>
        <div className="ns-info-cell">
          <span>Sales Agent</span>
          <input className="ns-cell-select" value={agentName} placeholder="Type agent name..." onChange={e => setAgentName(e.target.value)} />
        </div>
      </div>

      {/* ── MAIN GRID ── */}
      <div className="ns-main-grid">

        {/* ═══ CONTENT ═══ */}
        <div className="ns-content">

          {/* SECTION 1 — Carrier & Tracking */}
          <div className="al-panel al-section">
            <div className="al-section-header">
              <span className="al-section-num">1</span>
              <h4>Carrier &amp; Tracking</h4>
            </div>
            <div className="ns-section-body">
              <div className="ns-fields-grid">
                <div className="al-field">
                  <label>Carrier</label>
                  <select className="al-input" value={carrier} onChange={e => handleCarrierChange(e.target.value)}>
                    {CARRIERS.map(c => <option key={c}>{c}</option>)}
                  </select>
                </div>
                <div className="al-field">
                  <label>Service Type</label>
                  <select className="al-input" value={serviceType} onChange={e => setServiceType(e.target.value)}>
                    {(SERVICE_LEVELS[carrier] ?? []).map(s => <option key={s}>{s}</option>)}
                  </select>
                </div>
                <div className="al-field">
                  <label>Tracking ID</label>
                  <input type="text" className="al-input" value={trackingNumber} onChange={e => setTrackingNumber(e.target.value)} placeholder="Enter tracking number" />
                </div>
                <div className="al-field">
                  <label>Status</label>
                  <select className="al-input" value={shipStatus} onChange={e => setShipStatus(e.target.value)}>
                    {SHIPMENT_STATUSES.map(s => <option key={s}>{s}</option>)}
                  </select>
                </div>
              </div>
            </div>
          </div>

          {/* SECTION 2 — Ship-To Address */}
          <div className="al-panel al-section">
            <div className="al-section-header">
              <span className="al-section-num">2</span>
              <h4>Ship-To Address</h4>
            </div>
            <div className="ns-address-grid">
              <div className="ns-address-block">
                <div className="ns-addr-heading">
                  <span className="ns-addr-label">From (Shipper)</span>
                  <span className="ns-default-badge">Default Address</span>
                </div>
                <div className="ns-addr-card">
                  <p className="ns-addr-name">Decoinks Print Shop</p>
                  <p>7450 NW 33rd St Suite 102</p>
                  <p>Miami, FL 33122</p>
                </div>
              </div>
              <div className="ns-address-block">
                <div className="ns-addr-heading">
                  <span className="ns-addr-label">To (Delivery Address)</span>
                </div>
                <div className="ns-section-body" style={{ paddingTop: 0 }}>
                  <div className="al-field">
                    <label>Customer Name</label>
                    <input className="al-input" value={customerName} onChange={e => setCustomerName(e.target.value)} placeholder="Recipient / customer name" />
                  </div>
                  <div className="al-field">
                    <label>Ship-To Address</label>
                    <textarea className="al-textarea" rows={2} value={address} onChange={e => setAddress(e.target.value)} placeholder="Street address..." />
                  </div>
                  <div className="ns-fields-grid">
                    <div className="al-field">
                      <label>City</label>
                      <input className="al-input" value={city} onChange={e => setCity(e.target.value)} placeholder="City" />
                    </div>
                    <div className="al-field">
                      <label>State</label>
                      <input className="al-input" value={stateVal} onChange={e => setStateVal(e.target.value)} placeholder="State" />
                    </div>
                    <div className="al-field">
                      <label>Postal Code</label>
                      <input className="al-input" value={postalCode} onChange={e => setPostalCode(e.target.value)} placeholder="ZIP / Postal" />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* SECTION 3 — Package, Cost & Delivery */}
          <div className="al-panel al-section">
            <div className="al-section-header">
              <span className="al-section-num">3</span>
              <h4>Package, Cost &amp; Delivery</h4>
            </div>
            <div className="ns-section-body">
              <div className="ns-fields-grid">
                <div className="al-field">
                  <label>Weight <span className="ns-unit">(lbs)</span></label>
                  <input type="number" className="al-input" min={0} step={0.01} value={weight} onChange={e => setWeight(e.target.value)} placeholder="0.00" />
                </div>
                <div className="al-field">
                  <label>Shipping Cost <span className="ns-unit">(USD)</span></label>
                  <div className="ns-cost-wrap">
                    <span className="ns-cost-prefix">$</span>
                    <input type="number" className="al-input ns-cost-input" min={0} step={0.01} value={estCost} onChange={e => setEstCost(e.target.value)} placeholder="0.00" />
                  </div>
                </div>
                <div className="al-field">
                  <label>Estimated Delivery</label>
                  <input type="date" className="al-input" value={estDelivery} onChange={e => setEstDelivery(e.target.value)} />
                </div>
                <div className="al-field">
                  <label>Delivered Date</label>
                  <input type="date" className="al-input" value={deliveredDate} onChange={e => setDeliveredDate(e.target.value)} />
                </div>
              </div>
              <div className="al-field ns-notes-field">
                <label>Notes <span className="al-optional">(optional)</span></label>
                <textarea className="al-textarea" rows={2} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Package contents or handling notes..." />
              </div>
            </div>
          </div>

        </div>{/* end ns-content */}

        {/* ═══ SIDEBAR ═══ */}
        <aside className="ns-sidebar">

          <div className="al-panel ns-sidebar-card">
            <h3 className="ns-sidebar-title">Shipment Summary</h3>
            <div className="ns-summary-rows">
              <div className="ns-summary-row"><span>Order</span><strong className="ns-teal">{orderText || '-'}</strong></div>
              <div className="ns-summary-row"><span>Customer</span><strong>{customerName || '-'}</strong></div>
              <div className="ns-summary-row"><span>Carrier</span><strong>{carrier || '-'}</strong></div>
              <div className="ns-summary-row"><span>Service</span><strong>{serviceType || '-'}</strong></div>
              <div className="ns-summary-row"><span>Tracking</span><strong>{trackingNumber || '-'}</strong></div>
              <div className="ns-summary-row"><span>Weight</span><strong>{weight ? `${weight} lbs` : '-'}</strong></div>
            </div>
            <div className="ns-summary-divider" />
            <div className="ns-summary-total">
              <span>Shipping Cost (USD)</span>
              <strong className="ns-total-val">{estCost ? `$${estCost}` : '-'}</strong>
            </div>
          </div>

          <div className="al-panel ns-sidebar-card ns-label-card">
            <h3 className="ns-sidebar-title">Live Tracking</h3>
            <div className="ns-label-placeholder">
              <div className="ns-label-icon-wrap"><Package size={28} /></div>
              <p>Auto-updated by Shippo</p>
              <span>Last-scan location, status and delivery date fill in automatically once the Shippo API is connected.</span>
            </div>
          </div>

          <div className="al-panel ns-sidebar-card">
            <h3 className="ns-sidebar-title">Shipment Status</h3>
            <div className="al-field">
              <label className="ns-field-label">Status</label>
              <div className="ns-status-wrap">
                <select
                  className={cn('ns-status-select', `ns-status-${shipStatus.toLowerCase().replace(/\s+/g, '-')}`)}
                  value={shipStatus}
                  onChange={e => setShipStatus(e.target.value)}
                >
                  {SHIPMENT_STATUSES.map(s => <option key={s}>{s}</option>)}
                </select>
                <ChevronDown size={13} className="ns-status-chevron" />
              </div>
            </div>

            <div className="ns-oimeline">
              {TIMELINE_STEPS.map((step, i) => {
                const isDone   = i < activeStep
                const isActive = i === activeStep
                return (
                  <div className="ns-step" key={step}>
                    <div className="ns-step-lefo">
                      <div className={cn('ns-step-doo', isDone && 'ns-step-doo-done', isActive && 'ns-step-doo-active')}>
                        {isDone && (
                          <svg width="8" height="8" viewBox="0 0 10 8" fill="none">
                            <path d="M1 4l3 3 5-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        )}
                      </div>
                      {i < TIMELINE_STEPS.length - 1 && (
                        <div className={cn('ns-step-line', isDone && 'ns-step-line-done')} />
                      )}
                    </div>
                    <div className="ns-step-body">
                      <span className={cn('ns-step-label', isActive && 'ns-step-label-active', isDone && 'ns-step-label-done')}>{step}</span>
                      {isActive && <span className="ns-step-sub">Current status</span>}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

        </aside>
      </div>

      {/* ── BOTTOM BAR ── */}
      <div className="al-bottom-bar">
        <div className="al-bottom-left" />
        <div className="al-bottom-center" />
        <div className="al-bottom-right">
          <button className="lb-action-btn" onClick={() => navigate(-1)}>Cancel</button>
          <button className="lb-action-btn lb-action-primary ns-save-btn" onClick={handleSave} disabled={saveMutation.isPending}>
            {saveMutation.isPending ? 'Saving...' : 'Create Shipment'}
          </button>
        </div>
      </div>

    </div>
  )
}
