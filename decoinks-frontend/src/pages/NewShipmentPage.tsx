import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation } from '@tanstack/react-query'
import toast from '../utils/toast'
import { ChevronRight } from 'lucide-react'
import { api } from '../services/api'

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

// ─── Combobox for Purchase Orders ───────────────────────────────────────────

interface PoRow {
  id: string
  po_number: string
  vendor_name?: string | null
  customer_name?: string | null
  shipping_address?: string | null
}

function PoCombobox({ poText, onSelect }: {
  poText: string
  onSelect: (po: PoRow | null, text: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState(poText)
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
        className="ns-cell-select ns-order-select no-customer-input"
        value={text}
        placeholder="Type or select a purchase order..."
        onChange={e => { setText(e.target.value); onSelect(null, e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
      />
      {open && filtered.length > 0 && (
        <div className="no-customer-suggestions">
          {filtered.slice(0, 8).map((p: PoRow) => (
            <div
              key={p.id}
              className="no-customer-suggestion-item"
              onMouseDown={() => {
                setText(p.po_number)
                onSelect(p, p.po_number)
                setOpen(false)
              }}
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

  // Link
  const [orderId,   setOrderId]   = useState('')
  const [orderText, setOrderText] = useState('')
  const [poId,      setPoId]      = useState('')
  const [poText,    setPoText]    = useState('')
  const [shipSource, setShipSource] = useState('vendor')

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
      po_id:               poId || null,
      ship_source:         shipSource || null,
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
      estimated_delivery:  estDelivery || null,
      delivered_date:      deliveredDate || null,
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

  // When a PO is picked, link it and best-effort auto-fill customer + address.
  const applyPo = (po: PoRow | null, text: string) => {
    setPoId(po?.id ?? '')
    setPoText(text)
    if (po) {
      if (po.customer_name && !customerName) setCustomerName(po.customer_name)
      if (po.shipping_address && !address) setAddress(po.shipping_address)
    }
  }

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
          <span>Purchase Order</span>
          <PoCombobox poText={poText} onSelect={applyPo} />
        </div>
      </div>

      {/* ── CONTENT ── */}
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
              <div className="al-field">
                <label>Ship Source</label>
                <select className="al-input" value={shipSource} onChange={e => setShipSource(e.target.value)}>
                  <option value="vendor">Vendor ships directly</option>
                  <option value="self">We ship (self)</option>
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
          <div className="ns-section-body">
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

        {/* SECTION 3 — Delivery */}
        <div className="al-panel al-section">
          <div className="al-section-header">
            <span className="al-section-num">3</span>
            <h4>Delivery</h4>
          </div>
          <div className="ns-section-body">
            <div className="ns-fields-grid">
              <div className="al-field">
                <label>Estimated Delivery</label>
                <input type="date" className="al-input" value={estDelivery} onChange={e => setEstDelivery(e.target.value)} />
              </div>
              <div className="al-field">
                <label>Delivered Date</label>
                <input type="date" className="al-input" value={deliveredDate} onChange={e => setDeliveredDate(e.target.value)} />
              </div>
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
          <button className="lb-action-btn lb-action-primary ns-save-btn" onClick={handleSave} disabled={saveMutation.isPending}>
            {saveMutation.isPending ? 'Saving...' : 'Create Shipment'}
          </button>
        </div>
      </div>

    </div>
  )
}
