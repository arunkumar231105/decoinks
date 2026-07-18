import { useMemo, useState, useRef, useEffect } from 'react'
import { useNavigate, useParams, useLocation } from 'react-router-dom'
import { Menu, MenuItem } from '@mui/material'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from '../utils/toast'
import {
  ChevronDown,
  Copy,
  Edit3,
  ExternalLink,
  MessageCircle,
  MessageSquare,
  Package,
  Plus,
  Save,
  Send,
  Trash2,
  User2,
  X,
} from 'lucide-react'
import { cn } from '../utils/cn'
import { api } from '../services/api'
import { useAuthStore } from '../store/authStore'
import { copyText, printPanel } from '../utils/actions'
import ArtworkUploader from '../components/ArtworkUploader'

type QuoteStatus = 'Draft' | 'Sent' | 'Approved' | 'Rejected' | 'Expired'

interface ApparelItem {
  id: string
  description: string
  variant: string
  sizes: string
  qty: number
  quotedCost: number
  front_image?: string | null
  back_image?: string | null
  styleId?: string
  styleCode?: string
  brand?: string
  productImage?: string | null
  styleDescription?: string | null
  colorId?: string
  sizeId?: string
  sku?: string
  availableColors?: CatalogColor[]
  availableSizes?: CatalogSize[]
  availableVariants?: CatalogVariant[]
}

interface CatalogColor { style_color_id: string; display_name: string; color_name: string; hex_color: string | null }
interface CatalogSize { style_size_id: string; size_code: string; size_name: string }
interface CatalogVariant { sku_id: string; sku_code: string; style_color_id: string; style_size_id: string }
interface CatalogStyle {
  id: string; name: string; sku: string; brand: string; image_url: string | null
  description: string | null; total_colors: number; total_sizes: number; total_skus: number
  colors?: CatalogColor[]; sizes?: CatalogSize[]; variants?: CatalogVariant[]
  images?: Array<{ image_url: string; is_primary: boolean }>
}

interface GangsheetRow {
  id: string
  size: string
  noArtworks: number
  qtySheets: number
  quotedCost: number
  front_image?: string | null
  back_image?: string | null
}

interface TransferRow {
  id: string
  width: string
  height: string
  qty: number
  quotedCost: number
  artwork_image?: string | null
}

interface OtherCharge {
  key: 'artwork' | 'packaging' | 'shipping' | 'discount'
  label: string
  description: string
  enabled: boolean
  stdCost: number
  quotedCost: number
}

interface LeadItem {
  id: string
  description: string
  qty: number
  sizes: string
  colors: string
  artwork_count: number
  unit_price: number
  sort_order: number
}

interface ProductTotals {
  apparel: number
  gangsheet: number
  transfers: number
  leadItems: number
}

const uid = () => Math.random().toString(36).slice(2, 8)
const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const addDays = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00`)
  d.setDate(d.getDate() + days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const VARIANTS = ['Black - M', 'Black - L', 'Black - XL', 'White - M', 'White - L']
const GANGSHEET_SIZES = ['22" x 60"', '22" x 120"', '24" x 60"', '30" x 60"']
const APPAREL_SIZE_OPTIONS = [
  'XS',
  'S',
  'M',
  'L',
  'XL',
  '2XL',
  '3XL',
  'One Size',
  'S:10, M:20, L:15',
]

const parseTransferSize = (size: unknown): Pick<TransferRow, 'width' | 'height'> => {
  const match = String(size ?? '').match(/([\d.]+)\s*(?:"|in(?:ches)?)?\s*[x×]\s*([\d.]+)/i)
  return match ? { width: match[1], height: match[2] } : { width: '', height: '' }
}

const formatTransferSize = (width: string, height: string) => {
  const cleanWidth = width.trim()
  const cleanHeight = height.trim()
  if (cleanWidth && cleanHeight) return `${cleanWidth}" x ${cleanHeight}"`
  if (cleanWidth) return `${cleanWidth}" wide`
  if (cleanHeight) return `${cleanHeight}" high`
  return 'DTF Transfer'
}

const initialApparelItems: ApparelItem[] = []
const initialGangsheetRows: GangsheetRow[] = []
const initialTransferRows: TransferRow[] = []

const initialOtherCharges: OtherCharge[] = [
  { key: 'artwork', label: 'Artwork Services', description: 'Artwork setup & editing', enabled: false, stdCost: 0, quotedCost: 0 },
  { key: 'packaging', label: 'Packaging', description: 'Poly mailer + label', enabled: false, stdCost: 0, quotedCost: 0 },
  { key: 'shipping', label: 'Estimated Shipping', description: 'Shipping & handling', enabled: false, stdCost: 0, quotedCost: 0 },
  { key: 'discount', label: 'Discount', description: 'Special discount', enabled: false, stdCost: 0, quotedCost: 0 },
]

function calculateQuotationTotals({
  productTotals,
  otherCharges,
}: {
  productTotals: ProductTotals
  otherCharges: OtherCharge[]
}) {
  const itemsTotal = productTotals.apparel + productTotals.gangsheet + productTotals.transfers + productTotals.leadItems
  const enabled = otherCharges.filter(charge => charge.enabled)
  const shipping = enabled.find(charge => charge.key === 'shipping')?.quotedCost ?? 0
  const nonTaxCharges = enabled
    .filter(charge => !['shipping', 'discount'].includes(charge.key))
    .reduce((sum, charge) => sum + charge.quotedCost, 0)
  const discount = enabled.find(charge => charge.key === 'discount')?.quotedCost ?? 0
  const subtotal = itemsTotal + shipping + nonTaxCharges
  const finalTotal = +(Math.max(subtotal + discount, 0)).toFixed(2)

  return { itemsTotal, shipping, subtotal, discount, finalTotal }
}

function CustomerCombobox({ value, onChange }: { value: string; onChange: (text: string, id?: string, customer?: Record<string, any>) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const { data } = useQuery({
    queryKey: ['customers-suggest', value],
    // list endpoint wraps rows as { success, data: { rows, total } }
    queryFn: () => api.get(`/customers?limit=20&search=${encodeURIComponent(value)}`)
      .then(r => r.data.data?.rows ?? r.data.rows ?? []),
    enabled: value.length > 0,
  })
  useEffect(() => {
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <input
        className="nq-select"
        placeholder="Search customer name..."
        value={value}
        onChange={e => { onChange(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
      />
      {open && data && data.length > 0 && (
        <div className="nq-dropdown" style={{ position: 'absolute', zIndex: 50, width: '100%', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 6, boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
          {data.map((c: Record<string, any>) => (
            <button key={c.id} className="nq-dropdown-item" style={{ display: 'block', width: '100%', textAlign: 'left', padding: '6px 12px' }}
              onMouseDown={() => { onChange(c.name, c.id, c); setOpen(false) }}>
              <div style={{ fontWeight: 500 }}>{c.name}</div>
              {c.company && <div style={{ fontSize: 11, color: '#64748b' }}>{c.company}</div>}
              {c.email && <div style={{ fontSize: 11, color: '#94a3b8' }}>{c.email}</div>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function SupplierCombobox({ value, onChange }: { value: string; onChange: (text: string, id?: string) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const { data } = useQuery({
    queryKey: ['suppliers-suggest', value],
    queryFn: () => api.get(`/suppliers?limit=20&search=${encodeURIComponent(value)}`).then(r => r.data.data?.rows ?? []),
    enabled: value.length > 0,
  })
  useEffect(() => {
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <input
        className="nq-select"
        placeholder="Type supplier name..."
        value={value}
        onChange={e => { onChange(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
      />
      {open && data && data.length > 0 && (
        <div className="nq-dropdown" style={{ position: 'absolute', zIndex: 50, width: '100%', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 6, boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
          {data.map((c: { id: string; name: string; email?: string }) => (
            <button key={c.id} className="nq-dropdown-item" style={{ display: 'block', width: '100%', textAlign: 'left', padding: '6px 12px' }}
              onMouseDown={() => { onChange(c.name, c.id); setOpen(false) }}>
              <div style={{ fontWeight: 500 }}>{c.name}</div>
              {c.email && <div style={{ fontSize: 11, color: '#64748b' }}>{c.email}</div>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function QuoteHeader({
  status,
  quoteNumber,
  revisionNumber,
  quoteDate,
  setQuoteDate,
  validUntil,
  setValidUntil,
  agent,
  setAgent,
  leadNumber,
  customerName,
  source,
}: {
  status: QuoteStatus
  quoteNumber: string
  revisionNumber: number
  quoteDate: string
  setQuoteDate: (v: string) => void
  validUntil: string
  setValidUntil: (v: string) => void
  agent: string
  setAgent: (agent: string) => void
  leadNumber: string
  customerName: string
  source: string
}) {
  const navigate = useNavigate()
  return (
    <section className="nq-info-bar">
      <div className="nq-info-field">
        <label>Quote #</label>
        <div className="nq-quote-num"><input className="nq-input nq-input-readonly" value={quoteNumber || 'AUTO-GENERATED'} readOnly /></div>
      </div>
      <div className="nq-info-field"><label>Revision</label><input className="nq-input nq-input-readonly" value={`Rev ${Math.max(revisionNumber - 1, 0)}`} readOnly /></div>
      <div className="nq-info-field"><label>Status</label><div><span className="nq-badge nq-badge-draft">{status}</span></div></div>
      <div className="nq-info-field"><label>Lead #</label>{leadNumber ? <button type="button" className="nq-link-btn" onClick={() => navigate('/leads')}>{leadNumber}</button> : <span className="nq-muted">—</span>}</div>
      <div className="nq-info-field"><label>Customer</label><input className="nq-input nq-input-readonly" value={customerName || 'Not selected'} readOnly /></div>
      <div className="nq-info-field"><label>Quote Date</label><input className="nq-input" type="date" value={quoteDate} onChange={e => { setQuoteDate(e.target.value); setValidUntil(addDays(e.target.value, 7)) }} /></div>
      <div className="nq-info-field"><label>Valid Until</label><input className="nq-input" type="date" value={validUntil} onChange={e => setValidUntil(e.target.value)} /><span className="nq-validity-hint">7 days validity</span></div>
      <div className="nq-info-field"><label>Source</label><div className="nq-source-select"><MessageCircle size={14} className="nq-source-icon" /><input className="nq-input nq-input-readonly" placeholder="Source" value={source} readOnly /></div></div>
      <div className="nq-info-field">
        <label>Sales Agent</label>
        <input className="nq-input" placeholder="Agent name" value={agent} onChange={e => setAgent(e.target.value)} />
      </div>
    </section>
  )
}

function SupplierSection({
  billingAddress,
  setBillingAddress,
  shippingAddress,
  setShippingAddress,
  sameAsBilling,
  setSameAsBilling,
  customerId,
}: {
  billingAddress: string
  setBillingAddress: (v: string) => void
  shippingAddress: string
  setShippingAddress: (v: string) => void
  sameAsBilling: boolean
  setSameAsBilling: (same: boolean) => void
  customerId: string | null
}) {
  const navigate = useNavigate()
  return (
    <section className="nq-card">
      <div className="nq-card-heading"><div className="nq-section-num-icon">1</div><h3>Customer Addresses</h3>{customerId && <button type="button" className="lb-action-btn" style={{ marginLeft: 'auto' }} onClick={() => navigate(`/customers/${customerId}`)}>Edit Customer</button>}</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div className="nq-address-block">
          <div className="nq-address-header"><span className="nq-field-label">Billing Address</span></div>
          <select className="nq-select" value={billingAddress} disabled={!billingAddress} onChange={e => setBillingAddress(e.target.value)}><option value={billingAddress}>{billingAddress || 'Select a customer first'}</option></select>
        </div>
        <div className="nq-address-block">
          <div className="nq-address-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="nq-field-label">Shipping Address</span>
            <label className="nq-same-billing" style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, cursor: 'pointer', fontWeight: 500 }}>
              <input
                type="checkbox"
                checked={sameAsBilling}
                onChange={e => {
                  setSameAsBilling(e.target.checked)
                  if (e.target.checked) setShippingAddress(billingAddress)
                }}
              />
              Same as billing
            </label>
          </div>
          <select className="nq-select" value={sameAsBilling ? billingAddress : shippingAddress} disabled={sameAsBilling || !shippingAddress} onChange={e => setShippingAddress(e.target.value)}><option value={sameAsBilling ? billingAddress : shippingAddress}>{(sameAsBilling ? billingAddress : shippingAddress) || 'No shipping address in Customer Master'}</option></select>
        </div>
      </div>
    </section>
  )
}

type QuoteTab = 'apparel' | 'dtf' | 'gangsheet'

const QUOTE_TABS: { key: QuoteTab; icon: string; label: string; desc: string; color: string }[] = [
  { key: 'apparel',   icon: '👕', label: 'Custom Printed Apparel', desc: 'T-Shirts, Hoodies, Caps with DTF / screen prints',  color: '#0ea5e9' },
  { key: 'dtf',       icon: '🖨️', label: 'DTF Transfers',          desc: 'Gang-sheet cut heat transfers quoted by size & qty', color: '#f97316' },
  { key: 'gangsheet', icon: '📐', label: 'Gangsheet',              desc: 'Full gang sheets with multiple artwork designs',     color: '#8b5cf6' },
]

function QuoteTypeSelector({ activeTab, onChange, tabTotals, disabled = false }: {
  activeTab: QuoteTab
  onChange: (tab: QuoteTab) => void
  tabTotals: Record<QuoteTab, number>
  disabled?: boolean
}) {
  return (
    <section className="nq-card nq-type-selector-card">
      <div className="nq-type-selector-hd">
        <h3>Quote Type</h3>
        <span className="nq-type-hint">Select ONE — each type generates its own PDF layout</span>
      </div>
      <div className="nq-tab-cards">
        {QUOTE_TABS.map(tab => (
          <button
            key={tab.key}
            type="button"
            disabled={disabled && activeTab !== tab.key}
            className={cn('nq-tab-card', activeTab === tab.key && 'nq-tab-card-active')}
            style={activeTab === tab.key ? { borderColor: tab.color, '--tab-color': tab.color } as React.CSSProperties : undefined}
            onClick={() => onChange(tab.key)}
            title={disabled && activeTab !== tab.key ? 'Remove all items before changing quote type' : undefined}
          >
            <span className="nq-tab-icon">{tab.icon}</span>
            <div className="nq-tab-text">
              <strong>{tab.label}</strong>
              <span>{tab.desc}</span>
            </div>
            <div className="nq-tab-right">
              {activeTab === tab.key
                ? <span className="nq-tab-selected" style={{ background: tab.color }}>✓ Selected</span>
                : <span className="nq-tab-select-hint">Click to select</span>}
              {tabTotals[tab.key] > 0 && (
                <span className="nq-tab-total">${fmt(tabTotals[tab.key])}</span>
              )}
            </div>
          </button>
        ))}
      </div>
    </section>
  )
}

function OtherChargesSection({
  charges,
  toggleCharge,
  updateCharge,
}: {
  charges: OtherCharge[]
  toggleCharge: (key: OtherCharge['key']) => void
  updateCharge: (key: OtherCharge['key'], patch: Partial<OtherCharge>) => void
}) {
  return (
    <section className="nq-card">
      <div className="nq-other-header"><input type="checkbox" checked readOnly /><span className="nq-other-title">Other Charges</span><span className="nq-other-hint">(independent from product rows)</span></div>
      <div className="nq-other-grid">
        {charges.map(item => (
          <div key={item.key} className={cn('nq-other-item', item.enabled && 'nq-other-item-active')}>
            <label className="nq-other-item-check">
              <input type="checkbox" checked={item.enabled} onChange={() => toggleCharge(item.key)} />
              <div><strong className={cn(item.key === 'discount' && 'nq-discount-label')}>{item.label}{item.key === 'discount' && <Edit3 size={11} style={{ marginLeft: 4 }} />}</strong><span>{item.description}</span></div>
            </label>
            <div className="nq-other-costs">
              <div className="nq-other-cost-col"><span>STD Cost</span><div className="nq-money-input nq-money-sm"><span>$</span><input type="number" step={0.01} value={Math.abs(item.stdCost)} onChange={e => updateCharge(item.key, { stdCost: item.stdCost < 0 ? -Math.abs(+e.target.value) : +e.target.value })} /></div></div>
              <div className="nq-other-cost-col"><span>Quoted</span><div className={cn('nq-money-input nq-money-sm', item.key === 'discount' && 'nq-money-discount')}><span>{item.quotedCost < 0 ? '-$' : '$'}</span><input type="number" step={0.01} value={Math.abs(item.quotedCost)} onChange={e => updateCharge(item.key, { quotedCost: item.quotedCost < 0 ? -Math.abs(+e.target.value) : +e.target.value })} /></div></div>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

function NotesSection({ customerNotes, internalNotes, setCustomerNotes, setInternalNotes }: {
  customerNotes: string
  internalNotes: string
  setCustomerNotes: (value: string) => void
  setInternalNotes: (value: string) => void
}) {
  return (
    <section className="nq-card">
      <div className="nq-card-heading"><Package size={14} /><h3>Notes</h3></div>
      <div className="nq-notes-grid">
        <div className="nq-notes-col"><label>Customer Notes <small>(visible to customer)</small></label><textarea className="nq-textarea" rows={4} value={customerNotes} onChange={e => setCustomerNotes(e.target.value)} /></div>
        <div className="nq-notes-col"><label>Internal Notes <small>(visible to team only)</small></label><textarea className="nq-textarea" rows={4} value={internalNotes} onChange={e => setInternalNotes(e.target.value)} /></div>
      </div>
    </section>
  )
}

interface RevisionRow {
  id: string
  quote_number: string
  revision_number: number | null
  parent_quote_id: string | null
  status: string
  total: number | string
  created_at: string
}

function PreviousQuotesSection({ quoteId }: { quoteId?: string }) {
  const navigate = useNavigate()

  const { data: revisions = [] } = useQuery({
    queryKey: ['quote-revisions', quoteId],
    queryFn: () => api.get(`/quotations/${quoteId}/revisions`).then(r => r.data.data ?? []),
    enabled: !!quoteId,
  })

  // Nothing to show for a brand-new quote or a quote with no other revisions.
  if (!quoteId || (revisions as RevisionRow[]).length <= 1) return null

  const revLabel = (r: RevisionRow) =>
    !r.revision_number || r.revision_number <= 1 || !r.parent_quote_id
      ? 'Original'
      : `Rev. ${r.revision_number - 1}`

  const fmtDate = (d: string) =>
    new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

  const badgeClass = (s: string) =>
    s === 'Approved' ? 'nq-badge-approved'
    : s === 'Rejected' || s === 'Expired' ? 'nq-badge-rejected'
    : s === 'Sent' ? 'nq-badge-sent'
    : 'nq-badge-draft'

  return (
    <div className="nq-sidebar-card">
      <div className="nq-sidebar-card-header">
        <span>Previous / Revised Quotations</span>
        <button className="nq-link-btn" onClick={() => navigate('/quotes')}>View All</button>
      </div>
      <div className="nq-prev-quotes">
        {(revisions as RevisionRow[]).map(q => (
          <div key={q.id} className="nq-prev-quote-row">
            <div className="nq-prev-quote-id">
              <button
                className="nq-link-btn nq-qt-link"
                onClick={() => q.id !== quoteId && navigate(`/quotes/${q.id}`)}
                disabled={q.id === quoteId}
              >
                {q.quote_number} ({revLabel(q)})
              </button>
              <span className={`nq-badge ${badgeClass(q.status)}`}>{q.status}</span>
            </div>
            <div className="nq-prev-quote-meta">
              <span>{fmtDate(q.created_at)}</span>
              <span className="nq-prev-amount">${fmt(Number(q.total) || 0)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function PricingSummary({ totals }: { totals: ReturnType<typeof calculateQuotationTotals> }) {
  return (
    <div className="nq-sidebar-card">
      <div className="nq-sidebar-card-header"><span>Pricing Summary</span></div>
      <table className="nq-pricing-table">
        <tbody>
          <tr><td><label className="nq-pricing-check"><input type="checkbox" checked readOnly /> Items Total</label></td><td>${fmt(totals.itemsTotal)}</td></tr>
          <tr><td><label className="nq-pricing-check"><input type="checkbox" checked readOnly /> Shipping</label></td><td>${fmt(totals.shipping)}</td></tr>
          <tr className="nq-pricing-subtotal"><td><label className="nq-pricing-check"><input type="checkbox" checked readOnly /> Subtotal</label></td><td>${fmt(totals.subtotal)}</td></tr>
          <tr><td><label className="nq-pricing-check"><input type="checkbox" checked readOnly /> Discount</label></td><td className="nq-pricing-discount">${fmt(totals.discount)}</td></tr>
        </tbody>
        <tfoot><tr className="nq-pricing-total-row"><td>Total</td><td><strong className="nq-total-quoted">${fmt(totals.finalTotal)}</strong></td></tr></tfoot>
      </table>
    </div>
  )
}

function TermsSection({ paymentTerms, paymentMethod, productionTime, deliveryMethod, currency, setPaymentTerms, setPaymentMethod, setProductionTime, setDeliveryMethod, setCurrency }: {
  paymentTerms: string
  paymentMethod: string
  productionTime: string
  deliveryMethod: string
  currency: string
  setPaymentTerms: (value: string) => void
  setPaymentMethod: (value: string) => void
  setProductionTime: (value: string) => void
  setDeliveryMethod: (value: string) => void
  setCurrency: (value: string) => void
}) {
  return (
    <div className="nq-sidebar-card">
      <div className="nq-sidebar-card-header"><span>Payment Information</span></div>
      <div className="nq-terms-grid">
        <div className="nq-terms-field"><label>Payment Terms</label><select className="nq-select" value={paymentTerms} onChange={e => setPaymentTerms(e.target.value)}><option>Net 15</option><option>Net 30</option><option>Due on Receipt</option></select></div>
        <div className="nq-terms-field"><label>Payment Method</label><select className="nq-select" value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)}><option>Bank Transfer</option><option>Zelle</option><option>PayPal</option><option>Cash App</option><option>Credit Card</option><option>Cash</option><option>Check</option></select></div>
      </div>
    </div>
  )
}

function ActionBar({ status, setStatus, onSave, onConvert, onPreview, activeTab, saving, onSendToCustomer, onRequestApproval }: {
  status: QuoteStatus; setStatus: (status: QuoteStatus) => void
  onSave: () => void; onConvert: () => void
  onPreview: () => void; activeTab: QuoteTab
  saving?: boolean; onSendToCustomer: () => void; onRequestApproval: () => void
}) {
  const [moreAnchor, setMoreAnchor] = useState<null | HTMLElement>(null)
  const tab = QUOTE_TABS.find(t => t.key === activeTab)!
  const previewLabel = `${tab.icon} Preview ${tab.label} PDF`
  return (
    <div className="nq-bottom-bar">
      <div className="nq-bottom-left">
        <button className="lb-action-btn lb-action-primary" onClick={onSave} disabled={saving} style={{ gap: 6 }}>
          <Save size={14} /> {saving ? 'Saving...' : 'Save Quote'}
        </button>
        <button className="lb-action-btn" onClick={onPreview} title={`Preview ${tab.label} PDF`}>
          {previewLabel}
        </button>
      </div>
      <div className="nq-bottom-center">
        <button className="lb-action-btn lb-action-primary" onClick={onSendToCustomer} disabled={saving} style={{ gap: 6 }}>
          <Send size={13} /> Send to Customer
        </button>
      </div>
      <div className="nq-bottom-right">
        <button className="lb-action-btn" onClick={onRequestApproval} disabled={saving}>Request Approval</button>
        <button className="lb-action-btn nq-convert-btn" onClick={onConvert}>Convert to Invoice</button>
        <button className="lb-action-btn" onClick={e => setMoreAnchor(e.currentTarget)}>More Actions <ChevronDown size={13} /></button>
        <span className="nq-badge nq-badge-draft">{status}</span>
      </div>
      <Menu anchorEl={moreAnchor} open={Boolean(moreAnchor)} onClose={() => setMoreAnchor(null)}>
        <MenuItem onClick={() => { copyText(window.location.href, 'Quote link copied'); setMoreAnchor(null) }}>
          <Copy size={14} style={{ marginRight: 8 }} /> Copy Link
        </MenuItem>
        <MenuItem onClick={() => { onPreview(); setMoreAnchor(null) }}>
          <ExternalLink size={14} style={{ marginRight: 8 }} /> {previewLabel}
        </MenuItem>
      </Menu>
    </div>
  )
}

// ── Customer info section (auto-filled from lead) ──────────────────────────
// Compact read-only row for the selected-customer summary card
function SummaryItem({ label, value }: { label: string; value?: string }) {
  if (!value) return null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
      <span style={{ fontSize: 10.5, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</span>
      <span style={{ fontSize: 13, color: '#1e293b', overflow: 'hidden', textOverflow: 'ellipsis' }}>{value}</span>
    </div>
  )
}

function CustomerInfoSection({
  leadId, leadNumber, customerSource,
  customerId, customerText, onSelectCustomer, onClearCustomer,
  customerName, companyName, billingEmail, contactNumber,
  whatsapp, wechat, customerCategory,
  shippingCountry, shippingState, shippingCity, zipCode,
}: {
  leadId: string | null; leadNumber: string; customerSource: string
  customerId: string | null; customerText: string
  onSelectCustomer: (text: string, id?: string, customer?: Record<string, any>) => void
  onClearCustomer: () => void
  customerName: string
  companyName: string
  billingEmail: string
  contactNumber: string
  whatsapp: string
  wechat: string
  customerCategory: string
  shippingCountry: string
  shippingState: string
  shippingCity: string
  zipCode: string
}) {
  const navigate = useNavigate()
  const location = [shippingCity, shippingState, shippingCountry].filter(Boolean).join(', ')
  return (
    <section className="nq-card">
      <div className="nq-card-heading">
        <div className="nq-section-num-icon"><User2 size={14} /></div>
        <h3>Customer Information</h3>
        {leadId && <span className="nq-badge nq-badge-ai" style={{ marginLeft: 8 }}>Auto-Filled from Lead</span>}
        {customerId && !leadId && <span className="nq-badge nq-badge-active" style={{ marginLeft: 8 }}>Linked Customer</span>}
      </div>

      {leadId && (
        <div className="nq-locked-fields-row">
          <div className="nq-locked-field">
            <label>Reference Lead ID</label>
            <input className="nq-input nq-input-readonly" value={leadNumber || leadId} readOnly />
            <span className="nq-from-lead-hint">locked · from lead</span>
          </div>
          {customerSource && (
            <div className="nq-locked-field">
              <label>Customer Source</label>
              <input className="nq-input nq-input-readonly" value={customerSource} readOnly />
              <span className="nq-from-lead-hint">locked · from lead</span>
            </div>
          )}
        </div>
      )}

      {/* Customer selector — the only entry point; details live on the Customers record */}
      <div className="nq-cinfo-field nq-cinfo-field-wide">
        <label className="nq-field-label">Select Customer</label>
        <CustomerCombobox value={customerText} onChange={onSelectCustomer} />
        <span style={{ fontSize: 11, color: '#94a3b8', marginTop: 4, display: 'block' }}>
          Search a saved customer — their details fill in automatically.{' '}
          New customer?{' '}
          <button type="button" className="nq-link-btn" style={{ padding: 0, fontSize: 11 }}
            onClick={() => navigate('/customers')}>
            Create one in Customers
          </button>
        </span>
      </div>

      {customerId && (
        /* Linked customer — compact read-only summary; data flows to preview/print */
        <div style={{
          border: '1px solid var(--border-default, #e2e8f0)', borderRadius: 10,
          padding: '14px 16px', background: '#f8fafc', marginTop: 12,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
            <div style={{
              display: 'grid', gap: '12px 24px', flex: 1,
              gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
            }}>
              <SummaryItem label="Customer" value={customerName} />
              <SummaryItem label="Company" value={companyName} />
              <SummaryItem label="Billing Email" value={billingEmail} />
              <SummaryItem label="Contact" value={contactNumber} />
              <SummaryItem label="WhatsApp" value={whatsapp} />
              <SummaryItem label="WeChat" value={wechat} />
              <SummaryItem label="Category" value={customerCategory} />
              <SummaryItem label="Location" value={location} />
              <SummaryItem label="ZIP" value={zipCode} />
            </div>
            <button type="button" className="lb-action-btn" style={{ flexShrink: 0 }} onClick={onClearCustomer}>
              Change
            </button>
          </div>
        </div>
      )}
    </section>
  )
}

function CatalogStyleSearch({ onSelect }: { onSelect: (style: CatalogStyle) => void }) {
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false)
  const [loadingId, setLoadingId] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const { data: styles = [], isFetching } = useQuery<CatalogStyle[]>({
    queryKey: ['quotation-product-styles', search],
    queryFn: () => api.get('/products', { params: { page: 1, limit: 50, search: search || undefined, product_type: 'Apparel' } })
      .then(r => r.data.data?.rows ?? []),
  })

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  const choose = async (style: CatalogStyle) => {
    setLoadingId(style.id)
    try {
      const detail = (await api.get(`/products/${style.id}`)).data.data as CatalogStyle
      onSelect(detail)
      setSearch('')
      setOpen(false)
    } catch {
      toast.error('Could not load style colors and sizes')
    } finally {
      setLoadingId('')
    }
  }

  return (
    <div ref={ref} className="nq-style-search">
      <div className="nq-style-search-input">
        <Package size={15} />
        <input
          value={search}
          placeholder="Search style by name, brand, style code or SKU..."
          onFocus={() => setOpen(true)}
          onChange={event => { setSearch(event.target.value); setOpen(true) }}
        />
        {isFetching && <span className="nq-style-searching">Searching…</span>}
      </div>
      {open && (
        <div className="nq-style-results">
          <div className="nq-style-results-label">Available Product Styles ({styles.length})</div>
          {styles.map(style => (
            <button type="button" key={style.id} onMouseDown={() => choose(style)} disabled={loadingId === style.id}>
              {style.image_url
                ? <img src={style.image_url} alt="" />
                : <span className="nq-style-no-image"><Package size={17} /></span>}
              <span className="nq-style-result-main"><strong>{style.name}</strong><small>{style.brand} · Style {style.sku}</small></span>
              <span className="nq-style-result-counts">{style.total_colors} colors · {style.total_sizes} sizes · {style.total_skus} SKUs</span>
            </button>
          ))}
          {!isFetching && styles.length === 0 && <div className="nq-style-empty">No matching style found.</div>}
        </div>
      )}
    </div>
  )
}

// ── Item image upload cell ─────────────────────────────────────────────────
function ApparelSizePicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const isPreset = APPAREL_SIZE_OPTIONS.includes(value)
  const [isCustom, setIsCustom] = useState(Boolean(value) && !isPreset)

  useEffect(() => {
    if (value && !APPAREL_SIZE_OPTIONS.includes(value)) setIsCustom(true)
  }, [value])

  return (
    <div className="nq-size-picker">
      <select
        className="nq-table-input nq-size-select"
        aria-label="Select apparel size or size ratio"
        value={isCustom ? '__custom__' : value}
        onChange={event => {
          if (event.target.value === '__custom__') {
            setIsCustom(true)
            if (isPreset) onChange('')
            return
          }
          setIsCustom(false)
          onChange(event.target.value)
        }}
      >
        <option value="">Select</option>
        {APPAREL_SIZE_OPTIONS.map(option => <option key={option} value={option}>{option}</option>)}
        <option value="__custom__">Custom…</option>
      </select>
      {isCustom && (
        <input
          autoFocus
          className="nq-table-input nq-size-custom-input"
          aria-label="Custom apparel size ratio"
          placeholder="e.g. XS:5, S:10"
          value={value}
          onChange={event => onChange(event.target.value)}
        />
      )}
    </div>
  )
}

function ImageUploadCell({
  imageUrl, label, onUpload, onRemove, uploading,
}: {
  imageUrl?: string | null; label: string
  onUpload: (file: File) => void; onRemove: () => void; uploading?: boolean
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  return (
    <div className={`nq-img-cell${uploading ? ' nq-img-uploading' : ''}`}>
      <input ref={inputRef} type="file" accept="image/*" style={{ display: 'none' }}
        onChange={e => { const f = e.target.files?.[0]; if (f) { onUpload(f); e.target.value = '' } }} />
      {imageUrl ? (
        <div className="nq-img-thumb-wrap">
          <img src={imageUrl} className="nq-img-thumb" alt={label} />
          <button className="nq-img-remove" onClick={e => { e.stopPropagation(); onRemove() }}><X size={8} /></button>
        </div>
      ) : (
        <div className="nq-img-placeholder" onClick={() => inputRef.current?.click()}>
          <svg width="14" height="14" viewBox="0 0 20 20" fill="none">
            <rect width="20" height="20" rx="4" fill="#e2e8f0" />
            <path d="M4 14l4-4 3 3 2-2 3 3" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round" />
            <circle cx="7" cy="7" r="1.5" fill="#94a3b8" />
          </svg>
          <span>{label}</span>
        </div>
      )}
    </div>
  )
}

// ── Lead product interest items grid ──────────────────────────────────────
function LeadItemsSection({ items, setItems }: { items: LeadItem[]; setItems: (items: LeadItem[]) => void }) {
  const totalQty = items.reduce((sum, item) => sum + item.qty, 0)
  const totalArtworks = items.reduce((sum, item) => sum + item.artwork_count, 0)
  const sectionTotal = items.reduce((sum, item) => sum + item.qty * item.unit_price, 0)
  const updateItem = (id: string, patch: Partial<LeadItem>) =>
    setItems(items.map(item => (item.id === id ? { ...item, ...patch } : item)))
  const removeItem = (id: string) =>
    setItems(items.filter(item => item.id !== id))
  const addItem = () =>
    setItems([...items, { id: uid(), description: '', qty: 1, sizes: '', colors: '', artwork_count: 0, unit_price: 0, sort_order: items.length }])

  return (
    <section className="nq-card">
      <div className="nq-section-header">
        <span className="nq-section-num">★</span>
        <h3>Product Interest Items</h3>
        <span className="nq-badge nq-badge-ai">Auto-Filled from Lead</span>
      </div>
      <div className="nq-table-wrap">
        <table className="nq-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Item / Description</th>
              <th>Qty</th>
              <th>Sizes</th>
              <th>Colors</th>
              <th>Artwork #</th>
              <th>Unit Price</th>
              <th>Amount</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, idx) => (
              <tr key={item.id}>
                <td className="nq-td-num">{idx + 1}</td>
                <td><input className="nq-table-input" value={item.description} onChange={e => updateItem(item.id, { description: e.target.value })} placeholder="Item name..." /></td>
                <td><input className="nq-table-input" type="number" min={0} value={item.qty} onChange={e => updateItem(item.id, { qty: +e.target.value })} /></td>
                <td><input className="nq-table-input" value={item.sizes} onChange={e => updateItem(item.id, { sizes: e.target.value })} placeholder="S,M,L" /></td>
                <td><input className="nq-table-input" value={item.colors} onChange={e => updateItem(item.id, { colors: e.target.value })} placeholder="Black" /></td>
                <td><input className="nq-table-input" type="number" min={0} value={item.artwork_count} onChange={e => updateItem(item.id, { artwork_count: +e.target.value })} /></td>
                <td>
                  <div className="nq-money-input nq-money-quoted">
                    <span>$</span>
                    <input type="number" min={0} step={0.01} value={item.unit_price} onChange={e => updateItem(item.id, { unit_price: +e.target.value })} />
                  </div>
                </td>
                <td className="nq-td-total">${fmt(item.qty * item.unit_price)}</td>
                <td><button className="nq-icon-btn nq-delete-btn" onClick={() => removeItem(item.id)}><Trash2 size={14} /></button></td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr><td colSpan={9} style={{ textAlign: 'center', color: '#94a3b8', padding: '14px 0' }}>No items yet — click &ldquo;Add Item&rdquo; below.</td></tr>
            )}
          </tbody>
          <tfoot><tr className="live-summary-row">
            <td colSpan={2}><span className="live-summary-title">Items Summary</span></td>
            <td><div className="live-summary-stat"><span>Total Qty</span><strong>{totalQty}</strong></div></td>
            <td colSpan={2}></td>
            <td><div className="live-summary-stat"><span>Total Artworks</span><strong>{totalArtworks}</strong></div></td>
            <td></td>
            <td><div className="live-summary-stat live-summary-total"><span>Section Total</span><strong>${fmt(sectionTotal)}</strong></div></td>
            <td></td>
          </tr></tfoot>
        </table>
      </div>
      <button className="nq-add-row-btn" onClick={addItem}><Plus size={12} /> Add Item</button>
    </section>
  )
}

// ── CRM context snapshot (sidebar panel) ──────────────────────────────────
function CRMSnapshotPanel({ lead }: { lead: Record<string, unknown> | null }) {
  if (!lead) return null
  const fields: { label: string; value: string | null }[] = [
    { label: 'Last Customer Message',  value: (lead.last_message as string) || null },
    { label: 'Communication Channel',  value: (lead.communication_channel as string) || null },
    { label: 'Number of Messages',     value: lead.message_count != null ? String(lead.message_count) : null },
    { label: 'Attachments Count',      value: lead.attachment_count != null ? String(lead.attachment_count) : null },
    { label: 'Customer Intent',        value: (lead.customer_intent as string) || null },
    { label: 'Pending Questions',      value: (lead.pending_questions as string) || null },
  ].filter(f => f.value && f.value !== '0')

  if (fields.length === 0) return null

  return (
    <div className="nq-sidebar-card">
      <div className="nq-sidebar-card-header">
        <MessageSquare size={13} style={{ color: '#7c3aed' }} />
        <span>CRM Context Snapshot</span>
        <span className="nq-badge nq-badge-ai">From Lead</span>
      </div>
      <ul className="nq-crm-list">
        {fields.map(f => (
          <li key={f.label} className="nq-crm-item">
            <span className="nq-crm-label">{f.label}</span>
            <span className="nq-crm-value">{f.value}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function NewQuotationPage() {
  const navigate     = useNavigate()
  const queryClient  = useQueryClient()
  const location     = useLocation()
  const { id: quoteId } = useParams<{ id?: string }>()
  const { user } = useAuthStore()

  const fromCustomerId = (location.state as Record<string, unknown>)?.fromCustomerId as string | undefined

  // ── Base form state ──
  const [status, setStatus] = useState<QuoteStatus>('Draft')
  const [quoteDate, setQuoteDate] = useState(today())
  const [validUntil, setValidUntil] = useState(() => addDays(today(), 7))
  const [agent, setAgent] = useState(user?.name ?? '')
  const [supplierText, setSupplierText] = useState('')
  const [supplierId, setSupplierId] = useState('')
  const [billingAddress, setBillingAddress] = useState('')
  const [shippingAddress, setShippingAddress] = useState('')
  const [sameAsBilling, setSameAsBilling] = useState(false)
  const [activeTab, setActiveTab] = useState<QuoteTab>('apparel')
  const [apparelItems, setApparelItems] = useState<ApparelItem[]>(initialApparelItems)
  const [gangsheetRows, setGangsheetRows] = useState<GangsheetRow[]>(initialGangsheetRows)
  const [transferRows, setTransferRows] = useState<TransferRow[]>(initialTransferRows)
  const [otherCharges, setOtherCharges] = useState<OtherCharge[]>(initialOtherCharges)
  const [supplierNotes, setSupplierNotes] = useState('')
  const [internalNotes, setInternalNotes] = useState('')
  const [paymentTerms, setPaymentTerms] = useState('Due on Receipt')
  const [paymentMethod, setPaymentMethod] = useState('Bank Transfer')
  const [productionTime, setProductionTime] = useState('2 - 3 Business Days')
  const [deliveryMethod, setDeliveryMethod] = useState('Standard Shipping')
  const [currency, setCurrency] = useState('USD - US Dollar')

  // ── Customer link state ──
  const [customerId,       setCustomerId]       = useState<string | null>(null)
  const [customerText,     setCustomerText]     = useState('')

  // ── Lead intake / auto-fill state ──
  const [formInitialized, setFormInitialized] = useState(false)
  const [leadId,           setLeadId]           = useState<string | null>(null)
  const [leadNumber,       setLeadNumber]       = useState('')
  const [customerSource,   setCustomerSource]   = useState('')
  const [customerName,     setCustomerName]     = useState('')
  const [companyName,      setCompanyName]      = useState('')
  const [billingEmail,     setBillingEmail]     = useState('')
  const [contactNumber,    setContactNumber]    = useState('')
  const [whatsapp,         setWhatsapp]         = useState('')
  const [wechat,           setWechat]           = useState('')
  const [customerCategory, setCustomerCategory] = useState('')
  const [shippingCountry,  setShippingCountry]  = useState('')
  const [shippingState,    setShippingState]    = useState('')
  const [shippingCity,     setShippingCity]     = useState('')
  const [zipCode,          setZipCode]          = useState('')
  const [dueDate,          setDueDate]          = useState('')
  const [customerReqSummary, setCustomerReqSummary] = useState('')
  const [quoteEstimate,    setQuoteEstimate]    = useState('')
  const [leadItems,        setLeadItems]        = useState<LeadItem[]>([])

  // ── Remote data ──
  const { data: quotationData } = useQuery<Record<string, unknown>>({
    queryKey: ['quotation', quoteId],
    queryFn:  () => api.get(`/quotations/${quoteId}`).then(r => r.data.data),
    enabled:  !!quoteId,
  })

  const { data: leadData } = useQuery<Record<string, unknown>>({
    queryKey: ['lead', leadId],
    queryFn:  () => api.get(`/leads/${leadId}`).then(r => r.data.data),
    enabled:  !!leadId,
  })

  const { data: fromCustomerData } = useQuery<Record<string, unknown>>({
    queryKey: ['customer', fromCustomerId],
    queryFn:  () => api.get(`/customers/${fromCustomerId}`).then(r => r.data.data),
    enabled:  !!fromCustomerId && !quoteId,
  })

  // ── Auto-populate from customer when navigating via "Convert to Quote" ──
  useEffect(() => {
    if (!fromCustomerData || formInitialized) return
    const c = fromCustomerData as Record<string, any>
    setCustomerId(c.id as string)
    setCustomerText(c.name ?? '')
    setCustomerName(c.name ?? '')
    setCompanyName(c.company ?? '')
    setBillingEmail(c.email ?? '')
    setContactNumber(c.phone ?? '')
    setWhatsapp(c.whatsapp ?? '')
    if (c.lead_id) setLeadId(c.lead_id as string)

    // Address fields
    setShippingCountry(c.country ?? '')
    setShippingState(c.state ?? '')
    setShippingCity(c.city ?? '')
    setZipCode(c.zip ?? '')

    // Billing address: prefer stored billing_address, else build from address parts
    const builtAddress = [c.address_line1, c.city, c.state, c.zip, c.country].filter(Boolean).join(', ')
    const billingAddr = c.billing_address || builtAddress
    if (billingAddr) setBillingAddress(billingAddr)

    // Shipping address: if same_as_shipping is true, copy billing; else same built address
    if (c.same_as_shipping && billingAddr) {
      setShippingAddress(billingAddr)
      setSameAsBilling(true)
    } else if (builtAddress) {
      setShippingAddress(builtAddress)
    }
  }, [fromCustomerData, formInitialized])

  // Fills all customer fields from a full customer record (used by the
  // Customer Information selector). Fetches the complete row because the
  // /customers list only returns a few columns.
  async function fillFromCustomer(id: string) {
    try {
      const c = (await api.get(`/customers/${id}`)).data.data as Record<string, any>
      setCustomerName(c.name ?? '')
      setCompanyName(c.company ?? '')
      setBillingEmail(c.email ?? '')
      setContactNumber(c.phone ?? '')
      setWhatsapp(c.whatsapp ?? '')
      setShippingCountry(c.country ?? '')
      setShippingState(c.state ?? '')
      setShippingCity(c.city ?? '')
      setZipCode(c.zip ?? '')
      setLeadId(c.lead_id ?? null)
      setLeadNumber(c.lead_number ?? '')
      setCustomerSource(c.lead_source ?? c.source ?? '')
      const built = [c.address_line1, c.city, c.state, c.zip, c.country].filter(Boolean).join(', ')
      const billingAddr = c.billing_address || built
      if (billingAddr) setBillingAddress(billingAddr)
      if (c.same_as_shipping && billingAddr) { setShippingAddress(billingAddr); setSameAsBilling(true) }
      else if (built) setShippingAddress(built)
    } catch { /* keep whatever the user typed */ }
  }

  // Called by the customer combobox. When a saved customer is chosen (id set),
  // link it and auto-fill; when the user just types, only track the text.
  function handleSelectCustomer(text: string, id?: string) {
    setCustomerText(text)
    if (id) { setCustomerId(id); fillFromCustomer(id) }
    else if (!text) { setCustomerId(null) }
  }

  // "Change" — unlink the customer and clear the derived fields so the manual
  // form starts blank (quote-specific fields like req summary are untouched).
  function handleClearCustomer() {
    setCustomerId(null)
    setCustomerText('')
    setCustomerName(''); setCompanyName(''); setBillingEmail(''); setContactNumber('')
    setWhatsapp(''); setWechat('')
    setShippingCountry(''); setShippingState(''); setShippingCity(''); setZipCode('')
    setBillingAddress(''); setShippingAddress(''); setSameAsBilling(false)
    setLeadId(null); setLeadNumber(''); setCustomerSource('')
  }

  // ── Initialize form from quotation once loaded ──
  useEffect(() => {
    if (!quotationData || formInitialized) return
    const q = quotationData as Record<string, any>
    const savedQuoteDate = q.created_at ? String(q.created_at).slice(0, 10) : today()
    setQuoteDate(savedQuoteDate)
    setValidUntil(q.valid_until ? String(q.valid_until).slice(0, 10) : addDays(savedQuoteDate, 7))
    setLeadId(q.lead_id ?? null)
    if (q.customer_id) { setCustomerId(q.customer_id as string); setCustomerText(q.customer_name ?? '') }
    // When lead has customer name but no linked customer record, show name in main field
    if (!q.customer_id && !q.supplier_id && q.customer_name) { setSupplierText(q.customer_name) }
    setCustomerSource(q.customer_source ?? '')
    setCustomerName(q.customer_name ?? '')
    setCompanyName(q.company_name ?? '')
    setBillingEmail(q.billing_email ?? '')
    setContactNumber(q.contact_number ?? '')
    setWhatsapp(q.whatsapp ?? '')
    setWechat(q.wechat ?? '')
    setCustomerCategory(q.customer_category ?? '')
    setShippingCountry(q.shipping_country ?? '')
    setShippingState(q.shipping_state ?? '')
    setShippingCity(q.shipping_city ?? '')
    setZipCode(q.zip_code ?? '')
    setDueDate(q.due_date ?? '')
    setCustomerReqSummary(q.customer_requirement_summary ?? '')
    setQuoteEstimate(q.quote_estimate != null ? String(q.quote_estimate) : '')
    setBillingAddress(q.billing_address ?? '')
    setShippingAddress(q.shipping_address ?? '')
    if (q.internal_notes) setInternalNotes(q.internal_notes)
    const orderType = ((q.order_type as string) || 'apparel') as QuoteTab
    setActiveTab(orderType)

    if (Array.isArray(q.items) && q.items.length > 0) {
      if (orderType === 'apparel') {
        setApparelItems(q.items.map((item: Record<string, any>) => ({
          id:           item.id ?? uid(),
          description:  item.description ?? '',
          variant:      item.colors ?? '',
          sizes:        item.sizes ?? '',
          qty:          item.qty ?? 1,
          quotedCost:   item.unit_price ?? 0,
          front_image:  item.front_image ?? null,
          back_image:   item.back_image  ?? null,
          styleId:      item.catalog_style_id ?? undefined,
          colorId:      item.catalog_color_id ?? undefined,
          sizeId:       item.catalog_size_id ?? undefined,
          sku:          item.catalog_sku ?? undefined,
          styleCode:    item.model ?? undefined,
          brand:        item.brand ?? undefined,
        })))
      } else if (orderType === 'dtf') {
        setTransferRows(q.items.map((item: Record<string, any>) => ({
          id:            item.id ?? uid(),
          ...parseTransferSize(item.description),
          qty:           item.qty ?? 1,
          quotedCost:    item.unit_price ?? 0,
          artwork_image: item.artwork_image ?? item.front_image ?? null,
        })))
      } else if (orderType === 'gangsheet') {
        setGangsheetRows(q.items.map((item: Record<string, any>) => ({
          id:          item.id ?? uid(),
          size:        item.description ?? '22" x 60"',
          noArtworks:  item.artwork_count ?? 1,
          qtySheets:   item.qty ?? 1,
          quotedCost:  item.unit_price ?? 0,
          front_image: item.front_image ?? null,
          back_image:  item.back_image  ?? null,
        })))
      }
    }
    if (q.status) setStatus(q.status as QuoteStatus)

    // Restore other charges from saved values
    if (q.estimated_shipping > 0 || q.rush_services > 0 || q.discount_pct > 0) {
      setOtherCharges(prev => prev.map(charge => {
        if (charge.key === 'shipping' && q.estimated_shipping > 0)
          return { ...charge, enabled: true, quotedCost: Number(q.estimated_shipping) }
        if (charge.key === 'discount' && q.discount_pct > 0)
          return { ...charge, enabled: true, quotedCost: -Number(q.discount_amt || 0) }
        if (charge.key === 'artwork' && q.rush_services > 0)
          return { ...charge, enabled: true, quotedCost: Number(q.rush_services) }
        return charge
      }))
    }
    if (q.payment_terms) setPaymentTerms(q.payment_terms)
    if (q.payment_method) setPaymentMethod(q.payment_method)
    if (q.customer_notes) setSupplierNotes(q.customer_notes)

    setFormInitialized(true)
  }, [quotationData, formInitialized])

  // ── Fetch lead_number once leadId is known ──
  useEffect(() => {
    if (leadData) {
      const l = leadData as Record<string, any>
      setLeadNumber(l.lead_number ?? '')
    }
  }, [leadData])

  // Rehydrate Product Master choices when an existing quotation is opened.
  useEffect(() => {
    const missing = apparelItems.filter(item => item.styleId && !item.availableColors)
    if (!missing.length) return
    let cancelled = false
    Promise.all(missing.map(async item => {
      const style = (await api.get(`/products/${item.styleId}`)).data.data as CatalogStyle
      const color = style.colors?.find(value => value.display_name.toLowerCase() === item.variant.toLowerCase())
      const size = style.sizes?.find(value => value.size_name.toLowerCase() === item.sizes.toLowerCase())
      const variant = style.variants?.find(value => value.style_color_id === color?.style_color_id && value.style_size_id === size?.style_size_id)
      return { id: item.id, style, color, size, variant }
    })).then(hydrated => {
      if (cancelled) return
      setApparelItems(previous => previous.map(item => {
        const match = hydrated.find(value => value.id === item.id)
        if (!match) return item
        return { ...item, styleCode: match.style.sku, brand: match.style.brand,
          productImage: match.style.images?.[0]?.image_url ?? match.style.image_url,
          styleDescription: match.style.description, availableColors: match.style.colors ?? [],
          availableSizes: match.style.sizes ?? [], availableVariants: match.style.variants ?? [],
          colorId: match.color?.style_color_id, sizeId: match.size?.style_size_id,
          sku: match.variant?.sku_code ?? '' }
      }))
    }).catch(() => {})
    return () => { cancelled = true }
  }, [apparelItems])

  const navigateAfterSave = useRef<string | null>(null)

  const saveMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      quoteId ? api.put(`/quotations/${quoteId}`, data) : api.post('/quotations', data),
    onSuccess: (res: any) => {
      const q = res.data?.data
      toast.success(quoteId ? 'Quote updated successfully' : `Quote ${q?.quote_number ?? ''} saved!`)
      queryClient.invalidateQueries({ queryKey: ['quotations'] })
      if (quoteId) {
        queryClient.invalidateQueries({ queryKey: ['quotation', quoteId] })
        queryClient.invalidateQueries({ queryKey: ['quote-print', quoteId] })
      }
      // If preview was triggered, navigate to print page after save completes
      if (navigateAfterSave.current) {
        const path = navigateAfterSave.current
        navigateAfterSave.current = null
        navigate(path)
        return
      }
      if (!quoteId && q?.id) {
        // Stay on the edit page so artworks can be uploaded right away
        navigate(`/quotes/${q.id}`, { replace: true })
        return
      }
      navigate('/quotes')
    },
    onError: (err: any) => {
      navigateAfterSave.current = null
      toast.error(err.response?.data?.message ?? 'Could not save quote')
    },
  })

  const statusMutation = useMutation({
    mutationFn: ({ id, newStatus }: { id: string; newStatus: string }) =>
      api.patch(`/quotations/${id}/status`, { status: newStatus }),
    onSuccess: (_res, vars) => {
      toast.success(`Quote marked as ${vars.newStatus}`)
      queryClient.invalidateQueries({ queryKey: ['quotations'] })
      navigate('/quotes')
    },
    onError: (err: any) => toast.error(err.response?.data?.message ?? 'Could not update status'),
  })

  const handleSendToCustomer = () => {
    if (quoteId) {
      statusMutation.mutate({ id: quoteId, newStatus: 'Sent' })
    } else {
      toast.error('Save the quote first, then mark as Sent')
    }
  }

  const handleRequestApproval = () => {
    if (quoteId) {
      statusMutation.mutate({ id: quoteId, newStatus: 'Sent' })
    } else {
      toast.error('Save the quote first, then request approval')
    }
  }

  const apparelTotal   = useMemo(() => apparelItems.reduce((sum, item) => sum + item.qty * item.quotedCost, 0), [apparelItems])
  const apparelQty     = useMemo(() => apparelItems.reduce((sum, item) => sum + item.qty, 0), [apparelItems])
  const apparelArtwork = useMemo(() => apparelItems.reduce((sum, item) => sum + Number(Boolean(item.front_image)) + Number(Boolean(item.back_image)), 0), [apparelItems])
  const gangsheetTotal = useMemo(() => gangsheetRows.reduce((sum, row) => sum + row.qtySheets * row.quotedCost, 0), [gangsheetRows])
  const gangsheetQty   = useMemo(() => gangsheetRows.reduce((sum, row) => sum + row.qtySheets, 0), [gangsheetRows])
  const gangsheetArtwork = useMemo(() => gangsheetRows.reduce((sum, row) => sum + row.noArtworks, 0), [gangsheetRows])
  const transfersTotal = useMemo(() => transferRows.reduce((sum, row) => sum + row.qty * row.quotedCost, 0), [transferRows])
  const transfersQty   = useMemo(() => transferRows.reduce((sum, row) => sum + row.qty, 0), [transferRows])
  const activeTotal    = activeTab === 'apparel' ? apparelTotal : activeTab === 'dtf' ? transfersTotal : gangsheetTotal
  const totals = useMemo(() => calculateQuotationTotals({ productTotals: { apparel: activeTotal, gangsheet: 0, transfers: 0, leadItems: 0 }, otherCharges }), [activeTotal, otherCharges])

  const updateApparelItem = (id: string, patch: Partial<ApparelItem>) => setApparelItems(prev => prev.map(item => item.id === id ? { ...item, ...patch } : item))
  const addCatalogStyle = (style: CatalogStyle) => {
    setApparelItems(prev => [...prev, {
      id: uid(),
      description: style.name,
      variant: '', sizes: '', qty: 1, quotedCost: 0,
      front_image: null, back_image: null,
      styleId: style.id, styleCode: style.sku, brand: style.brand,
      productImage: style.images?.[0]?.image_url ?? style.image_url,
      styleDescription: style.description,
      availableColors: style.colors ?? [], availableSizes: style.sizes ?? [],
      availableVariants: style.variants ?? [],
    }])
  }
  const selectApparelColor = (item: ApparelItem, colorId: string) => {
    const color = item.availableColors?.find(value => value.style_color_id === colorId)
    const matchingSku = item.availableVariants?.find(value => value.style_color_id === colorId && value.style_size_id === item.sizeId)
    updateApparelItem(item.id, { colorId, variant: color?.display_name ?? '', sku: matchingSku?.sku_code ?? '' })
  }
  const selectApparelSize = (item: ApparelItem, sizeId: string) => {
    const size = item.availableSizes?.find(value => value.style_size_id === sizeId)
    const matchingSku = item.availableVariants?.find(value => value.style_size_id === sizeId && value.style_color_id === item.colorId)
    updateApparelItem(item.id, { sizeId, sizes: size?.size_name ?? '', sku: matchingSku?.sku_code ?? '' })
  }
  const updateGangsheetRow = (id: string, patch: Partial<GangsheetRow>) => setGangsheetRows(prev => prev.map(row => row.id === id ? { ...row, ...patch } : row))
  const updateTransferRow = (id: string, patch: Partial<TransferRow>) => setTransferRows(prev => prev.map(row => row.id === id ? { ...row, ...patch } : row))
  const toggleCharge = (key: OtherCharge['key']) => setOtherCharges(prev => prev.map(charge => charge.key === key ? { ...charge, enabled: !charge.enabled } : charge))
  const updateCharge = (key: OtherCharge['key'], patch: Partial<OtherCharge>) => setOtherCharges(prev => prev.map(charge => charge.key === key ? { ...charge, ...patch } : charge))

  const [uploadingImg, setUploadingImg] = useState<Record<string, boolean>>({})
  const uploadItemImage = async (
    rowId: string,
    field: 'front_image' | 'back_image' | 'artwork_image',
    file: File,
    updater: (id: string, patch: Record<string, string | null>) => void
  ) => {
    setUploadingImg(prev => ({ ...prev, [`${rowId}-${field}`]: true }))
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await api.post('/upload/image', form, { headers: { 'Content-Type': 'multipart/form-data' } })
      updater(rowId, { [field]: res.data.url })
    } catch {
      toast.error('Image upload failed')
    } finally {
      setUploadingImg(prev => ({ ...prev, [`${rowId}-${field}`]: false }))
    }
  }

  const handleSave = () => {
    let sortIdx = 0
    const allItems: Record<string, unknown>[] = []

    if (activeTab === 'apparel') {
      apparelItems.forEach(item => {
        const color = (item.variant || '').trim() || undefined
        allItems.push({
          description:   item.description || 'Apparel Item',
          qty:           item.qty,
          unit_price:    item.quotedCost,
          colors:        color,
          sizes:         item.sizes || undefined,
          artwork_count: Number(Boolean(item.front_image)) + Number(Boolean(item.back_image)),
          sort_order:    sortIdx++,
          front_image:   item.front_image || null,
          back_image:    item.back_image  || null,
          catalog_style_id: item.styleId || null,
          catalog_color_id: item.colorId || null,
          catalog_size_id:  item.sizeId || null,
          catalog_sku:      item.sku || null,
          brand:         item.brand || null,
          model:         item.styleCode || null,
        })
      })
    } else if (activeTab === 'dtf') {
      transferRows.forEach(row => {
        allItems.push({
          description:   formatTransferSize(row.width, row.height),
          qty:           row.qty,
          unit_price:    row.quotedCost,
          artwork_count: 1,
          sort_order:    sortIdx++,
          artwork_image: row.artwork_image || null,
        })
      })
    } else if (activeTab === 'gangsheet') {
      gangsheetRows.forEach(row => {
        allItems.push({
          description:   row.size || 'Gangsheet',
          qty:           row.qtySheets,
          unit_price:    row.quotedCost,
          artwork_count: row.noArtworks,
          sort_order:    sortIdx++,
          front_image:   row.front_image || null,
          back_image:    row.back_image  || null,
        })
      })
    }

    const discountCharge  = otherCharges.find(c => c.key === 'discount')
    const shippingCharge  = otherCharges.find(c => c.key === 'shipping')
    const artworkCharge   = otherCharges.find(c => c.key === 'artwork')
    const packagingCharge = otherCharges.find(c => c.key === 'packaging')
    const subtotalVal     = allItems.reduce((s, i) => s + Number(i.qty) * Number(i.unit_price), 0)
    const discountPct     = discountCharge?.enabled && subtotalVal > 0
      ? +((Math.abs(discountCharge.quotedCost) / subtotalVal) * 100).toFixed(4)
      : 0
    const estimatedShipping = shippingCharge?.enabled ? (shippingCharge.quotedCost || 0) : 0
    const rushServices = (artworkCharge?.enabled ? (artworkCharge.quotedCost || 0) : 0)
      + (packagingCharge?.enabled ? (packagingCharge.quotedCost || 0) : 0)

    saveMutation.mutate({
      order_type:                   activeTab,
      lead_id:                      leadId        || undefined,
      customer_id:                  customerId    || undefined,
      supplier_id:                  supplierId    || undefined,
      billing_address:              billingAddress || undefined,
      shipping_address:             sameAsBilling ? billingAddress : shippingAddress || undefined,
      internal_notes:               internalNotes || undefined,
      discount_pct:                 discountPct,
      items:                        allItems,
      estimated_shipping:           estimatedShipping,
      rush_services:                rushServices,
      payment_terms:                paymentTerms,
      payment_method:               paymentMethod || undefined,
      customer_notes:               supplierNotes || undefined,
      // Customer intake fields
      company_name:                 companyName       || undefined,
      customer_name:                customerName      || undefined,
      billing_email:                billingEmail      || undefined,
      contact_number:               contactNumber     || undefined,
      whatsapp:                     whatsapp          || undefined,
      wechat:                       wechat            || undefined,
      customer_category:            customerCategory  || undefined,
      customer_source:              customerSource    || undefined,
      shipping_country:             shippingCountry   || undefined,
      shipping_state:               shippingState     || undefined,
      shipping_city:                shippingCity      || undefined,
      zip_code:                     zipCode           || undefined,
      due_date:                     dueDate           || undefined,
      customer_requirement_summary: customerReqSummary || undefined,
      quote_estimate:               quoteEstimate ? +quoteEstimate : undefined,
      valid_until:                  validUntil || undefined,
    })
  }

  return (
    <div className="nq-page">
      <header className="nq-header">
        <div className="nq-header-left">
          <h1 className="nq-title">{quoteId ? 'Edit Quotation' : 'New Quotation'}</h1>
        </div>
        <div className="nq-header-actions">
          <button type="button" className="lb-action-btn" onClick={() => quoteId ? navigate(`/quotes/${quoteId}/print`) : toast.error('Save the quote first, then click Preview')}>Preview PDF</button>
          <button type="button" className="lb-action-btn" onClick={handleSendToCustomer}><Send size={13} /> Send to Customer</button>
          <button type="button" className="lb-action-btn">More Actions <ChevronDown size={12} /></button>
        </div>
      </header>

      <QuoteHeader
        status={status}
        quoteNumber={(quotationData as Record<string, any>)?.quote_number ?? ''}
        revisionNumber={Number((quotationData as Record<string, any>)?.revision_number ?? 1)}
        quoteDate={quoteDate} setQuoteDate={setQuoteDate} validUntil={validUntil} setValidUntil={setValidUntil}
        agent={agent} setAgent={setAgent} leadNumber={leadNumber} customerName={customerName} source={customerSource} />

      <div className="nq-body">
        <main className="nq-main">
          <CustomerInfoSection
            leadId={leadId} leadNumber={leadNumber} customerSource={customerSource}
            customerId={customerId} customerText={customerText}
            onSelectCustomer={handleSelectCustomer} onClearCustomer={handleClearCustomer}
            customerName={customerName}
            companyName={companyName}
            billingEmail={billingEmail}
            contactNumber={contactNumber}
            whatsapp={whatsapp}
            wechat={wechat}
            customerCategory={customerCategory}
            shippingCountry={shippingCountry}
            shippingState={shippingState}
            shippingCity={shippingCity}
            zipCode={zipCode}
          />

          <SupplierSection billingAddress={billingAddress} setBillingAddress={setBillingAddress} shippingAddress={shippingAddress} setShippingAddress={setShippingAddress} sameAsBilling={sameAsBilling} setSameAsBilling={setSameAsBilling} customerId={customerId} />

          {(leadId || leadItems.length > 0) && (
            <LeadItemsSection items={leadItems} setItems={setLeadItems} />
          )}

          {/* ── Quote Type Selector ── */}
          <QuoteTypeSelector
            activeTab={activeTab}
            onChange={setActiveTab}
            tabTotals={{ apparel: apparelTotal, dtf: transfersTotal, gangsheet: gangsheetTotal }}
            disabled={apparelItems.length + transferRows.length + gangsheetRows.length + leadItems.length > 0}
          />

          {/* ── Active Tab Content ── */}
          {activeTab === 'apparel' && (
            <section className="nq-card">
              <div className="nq-section-header">
                <div><span className="nq-tab-section-badge" style={{ background: '#e0f2fe', color: '#0369a1' }}>👕 Items / Products</span><p className="nq-items-hint">Select a Product Master style. Colors, sizes, SKU, description and preview fill automatically.</p></div>
              </div>
              <CatalogStyleSearch onSelect={addCatalogStyle} />
              <div className="nq-table-wrap"><table className="nq-table nq-apparel-table nq-catalog-items-table"><thead><tr><th>#</th><th>Product</th><th>Color</th><th>Size</th><th>SKU</th><th>Qty</th><th>Artwork</th><th>Unit Price</th><th>Amount</th><th></th></tr></thead><tbody>
                {apparelItems.map((item, idx) => (
                  <tr key={item.id}>
                    <td className="nq-td-num">{idx + 1}</td>
                    <td><div className="nq-quote-product"><div className="nq-quote-product-image">{item.productImage ? <img src={item.productImage} alt={item.description} /> : <Package size={20} />}</div><div><strong>{item.description || 'Legacy apparel item'}</strong><span>Brand: {item.brand || '—'}</span><span>Style: {item.styleCode || '—'}</span>{item.styleDescription && <small title={item.styleDescription}>{item.styleDescription}</small>}</div></div></td>
                    <td>{item.styleId ? <select className="nq-table-select" value={item.colorId ?? ''} onChange={e => selectApparelColor(item, e.target.value)}><option value="">Select color</option>{(item.availableColors ?? []).map(color => <option key={color.style_color_id} value={color.style_color_id}>{color.display_name}</option>)}</select> : <input className="nq-table-input" value={item.variant} onChange={e => updateApparelItem(item.id, { variant: e.target.value })} />}</td>
                    <td>{item.styleId ? <select className="nq-table-select" value={item.sizeId ?? ''} onChange={e => selectApparelSize(item, e.target.value)}><option value="">Select size</option>{(item.availableSizes ?? []).map(size => <option key={size.style_size_id} value={size.style_size_id}>{size.size_name}</option>)}</select> : <ApparelSizePicker value={item.sizes} onChange={sizes => updateApparelItem(item.id, { sizes })} />}</td>
                    <td><code className="nq-item-sku">{item.sku || (item.colorId && item.sizeId ? 'No SKU' : 'Select color + size')}</code></td>
                    <td><div className="nq-qty-input"><input className="nq-table-input" type="number" min={1} value={item.qty} onChange={e => updateApparelItem(item.id, { qty: +e.target.value })} /><span>pcs</span></div></td>
                    <td><div className="nq-artwork-pair"><ImageUploadCell imageUrl={item.front_image} label="Front" uploading={uploadingImg[`${item.id}-front_image`]} onUpload={f => uploadItemImage(item.id, 'front_image', f, updateApparelItem)} onRemove={() => updateApparelItem(item.id, { front_image: null })} /><ImageUploadCell imageUrl={item.back_image} label="Back" uploading={uploadingImg[`${item.id}-back_image`]} onUpload={f => uploadItemImage(item.id, 'back_image', f, updateApparelItem)} onRemove={() => updateApparelItem(item.id, { back_image: null })} /></div></td>
                    <td><div className="nq-money-input nq-money-quoted"><span>$</span><input type="number" value={item.quotedCost} onChange={e => updateApparelItem(item.id, { quotedCost: +e.target.value })} /></div></td>
                    <td className="nq-td-total">${fmt(item.qty * item.quotedCost)}</td>
                    <td><button className="nq-icon-btn nq-delete-btn" onClick={() => setApparelItems(prev => prev.filter(r => r.id !== item.id))}><Trash2 size={14} /></button></td>
                  </tr>
                ))}
                {apparelItems.length === 0 && <tr><td colSpan={10} style={{ textAlign: 'center', color: '#94a3b8', padding: '26px 0' }}>Search and select a Product Master style above.</td></tr>}
              </tbody><tfoot><tr className="live-summary-row">
                <td colSpan={5}><span className="live-summary-title">Apparel Summary</span></td>
                <td><div className="live-summary-stat"><span>Total Qty</span><strong>{apparelQty}</strong></div></td>
                <td><div className="live-summary-stat"><span>Artworks</span><strong>{apparelArtwork}</strong></div></td>
                <td></td>
                <td><div className="live-summary-stat live-summary-total"><span>Section Total</span><strong>${fmt(apparelTotal)}</strong></div></td>
                <td></td>
              </tr></tfoot></table></div>
            </section>
          )}

          {activeTab === 'dtf' && (
            <section className="nq-card">
              <div className="nq-section-header">
                <span className="nq-tab-section-badge" style={{ background: '#fff7ed', color: '#c2410c' }}>🖨️ DTF Transfers</span>
              </div>
              <div className="nq-table-wrap"><table className="nq-table"><thead><tr><th>#</th><th>Width (in)</th><th>Height (in)</th><th>Qty</th><th>Artwork</th><th>Unit Price (USD)</th><th>Total Amount (USD)</th><th></th></tr></thead><tbody>
                {transferRows.map((row, idx) => (
                  <tr key={row.id}>
                    <td className="nq-td-num">{idx + 1}</td>
                    <td><input className="nq-table-input nq-dimension-input" type="number" min="0" step="any" inputMode="decimal" placeholder="Width" aria-label={`Transfer ${idx + 1} width in inches`} value={row.width} onChange={e => updateTransferRow(row.id, { width: e.target.value })} /></td>
                    <td><input className="nq-table-input nq-dimension-input" type="number" min="0" step="any" inputMode="decimal" placeholder="Height" aria-label={`Transfer ${idx + 1} height in inches`} value={row.height} onChange={e => updateTransferRow(row.id, { height: e.target.value })} /></td>
                    <td><div className="nq-qty-input"><input className="nq-table-input" type="number" min={1} value={row.qty} onChange={e => updateTransferRow(row.id, { qty: +e.target.value })} /><span>pcs</span></div></td>
                    <td><ImageUploadCell imageUrl={row.artwork_image} label="Artwork" uploading={uploadingImg[`${row.id}-artwork_image`]} onUpload={f => uploadItemImage(row.id, 'artwork_image', f, updateTransferRow)} onRemove={() => updateTransferRow(row.id, { artwork_image: null })} /></td>
                    <td><div className="nq-money-input nq-money-quoted"><span>$</span><input type="number" value={row.quotedCost} onChange={e => updateTransferRow(row.id, { quotedCost: +e.target.value })} /></div></td>
                    <td className="nq-td-total">${fmt(row.qty * row.quotedCost)}</td>
                    <td><button className="nq-icon-btn nq-delete-btn" onClick={() => setTransferRows(prev => prev.filter(r => r.id !== row.id))}><Trash2 size={14} /></button></td>
                  </tr>
                ))}
                {transferRows.length === 0 && <tr><td colSpan={8} style={{ textAlign: 'center', color: '#94a3b8', padding: '18px 0' }}>No transfers yet — click "Add Transfer Row" below.</td></tr>}
              </tbody><tfoot><tr className="live-summary-row">
                <td colSpan={3}><span className="live-summary-title">DTF Summary</span></td>
                <td><div className="live-summary-stat"><span>Total Qty</span><strong>{transfersQty}</strong></div></td>
                <td><div className="live-summary-stat"><span>Total Artworks</span><strong>{transferRows.length}</strong></div></td>
                <td><div className="live-summary-stat live-summary-total"><span>Section Total</span><strong>${fmt(transfersTotal)}</strong></div></td>
                <td></td>
              </tr></tfoot></table></div>
              <button className="nq-add-row-btn" onClick={() => setTransferRows(prev => [...prev, { id: uid(), width: '', height: '', qty: 1, quotedCost: 0, artwork_image: null }])}><Plus size={12} /> Add Transfer Row</button>
            </section>
          )}

          {activeTab === 'gangsheet' && (
            <section className="nq-card">
              <div className="nq-section-header">
                <span className="nq-tab-section-badge" style={{ background: '#f5f3ff', color: '#6d28d9' }}>📐 Gangsheet</span>
              </div>
              <div className="nq-table-wrap"><table className="nq-table"><thead><tr><th>#</th><th>Gangsheet Size</th><th>No. of Artworks</th><th>Qty Sheets</th><th>Front Artwork</th><th>Back Artwork</th><th>Unit Price (USD)</th><th>Total Amount (USD)</th><th></th></tr></thead><tbody>
                {gangsheetRows.map((row, idx) => (
                  <tr key={row.id}>
                    <td className="nq-td-num">{idx + 1}</td>
                    <td>
                      {GANGSHEET_SIZES.includes(row.size) ? (
                        <select className="nq-table-select" value={row.size} onChange={e => updateGangsheetRow(row.id, { size: e.target.value === '__custom__' ? '' : e.target.value })}>
                          {GANGSHEET_SIZES.map(s => <option key={s} value={s}>{s}</option>)}
                          <option value="__custom__">Custom...</option>
                        </select>
                      ) : (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <input className="nq-table-input" style={{ width: 90 }} placeholder='e.g. 36" x 60"' value={row.size} onChange={e => updateGangsheetRow(row.id, { size: e.target.value })} autoFocus />
                          <button type="button" title="Back to list" onClick={() => updateGangsheetRow(row.id, { size: '22" x 60"' })} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8', fontSize: 13, lineHeight: 1 }}>✕</button>
                        </div>
                      )}
                    </td>
                    <td><input className="nq-table-input" type="number" value={row.noArtworks} onChange={e => updateGangsheetRow(row.id, { noArtworks: +e.target.value })} /></td>
                    <td><input className="nq-table-input" type="number" value={row.qtySheets} onChange={e => updateGangsheetRow(row.id, { qtySheets: +e.target.value })} /></td>
                    <td><ImageUploadCell imageUrl={row.front_image} label="Front" uploading={uploadingImg[`${row.id}-front_image`]} onUpload={f => uploadItemImage(row.id, 'front_image', f, updateGangsheetRow)} onRemove={() => updateGangsheetRow(row.id, { front_image: null })} /></td>
                    <td><ImageUploadCell imageUrl={row.back_image} label="Back" uploading={uploadingImg[`${row.id}-back_image`]} onUpload={f => uploadItemImage(row.id, 'back_image', f, updateGangsheetRow)} onRemove={() => updateGangsheetRow(row.id, { back_image: null })} /></td>
                    <td><div className="nq-money-input nq-money-quoted"><span>$</span><input type="number" value={row.quotedCost} onChange={e => updateGangsheetRow(row.id, { quotedCost: +e.target.value })} /></div></td>
                    <td className="nq-td-total">${fmt(row.qtySheets * row.quotedCost)}</td>
                    <td><button className="nq-icon-btn nq-delete-btn" onClick={() => setGangsheetRows(prev => prev.filter(r => r.id !== row.id))}><Trash2 size={14} /></button></td>
                  </tr>
                ))}
                {gangsheetRows.length === 0 && <tr><td colSpan={9} style={{ textAlign: 'center', color: '#94a3b8', padding: '18px 0' }}>No sheets yet — click "Add Gangsheet Row" below.</td></tr>}
              </tbody><tfoot><tr className="live-summary-row">
                <td colSpan={2}><span className="live-summary-title">Gangsheet Summary</span></td>
                <td><div className="live-summary-stat"><span>Total Artworks</span><strong>{gangsheetArtwork}</strong></div></td>
                <td><div className="live-summary-stat"><span>Total Sheets</span><strong>{gangsheetQty}</strong></div></td>
                <td colSpan={3}></td>
                <td><div className="live-summary-stat live-summary-total"><span>Section Total</span><strong>${fmt(gangsheetTotal)}</strong></div></td>
                <td></td>
              </tr></tfoot></table></div>
              <button className="nq-add-row-btn" onClick={() => setGangsheetRows(prev => [...prev, { id: uid(), size: '22" x 60"', noArtworks: 1, qtySheets: 1, quotedCost: 0, front_image: null, back_image: null }])}><Plus size={12} /> Add Gangsheet Row</button>
            </section>
          )}

          <OtherChargesSection charges={otherCharges} toggleCharge={toggleCharge} updateCharge={updateCharge} />
          <NotesSection customerNotes={supplierNotes} internalNotes={internalNotes} setCustomerNotes={setSupplierNotes} setInternalNotes={setInternalNotes} />
          <ArtworkUploader quotationId={quoteId} />
        </main>

        <aside className="nq-sidebar">
          <PricingSummary totals={totals} />
          <TermsSection paymentTerms={paymentTerms} paymentMethod={paymentMethod} productionTime={productionTime} deliveryMethod={deliveryMethod} currency={currency} setPaymentTerms={setPaymentTerms} setPaymentMethod={setPaymentMethod} setProductionTime={setProductionTime} setDeliveryMethod={setDeliveryMethod} setCurrency={setCurrency} />
        </aside>
      </div>

      <ActionBar
        status={status} setStatus={setStatus}
        onSave={handleSave} saving={saveMutation.isPending || statusMutation.isPending}
        onSendToCustomer={handleSendToCustomer}
        onRequestApproval={handleRequestApproval}
        onConvert={() => navigate('/invoices/new', { state: { fromQuoteId: quoteId } })}
        activeTab={activeTab}
        onPreview={() => {
          if (quoteId) {
            navigateAfterSave.current = `/quotes/${quoteId}/print`
            handleSave()
          } else {
            toast.error('Save the quote first, then click Preview')
          }
        }}
      />
    </div>
  )
}
