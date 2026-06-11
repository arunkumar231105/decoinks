import { useMemo, useState, useRef, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Menu, MenuItem } from '@mui/material'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from '../utils/toast'
import {
  Bot,
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
  Shirt,
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
  name: string
  description: string
  brand: string
  model: string
  variant: string
  sizes: string
  qty: number
  printDetails: { location: string; size: string }[]
  stdCost: number
  quotedCost: number
  front_image?: string | null
  back_image?: string | null
}

interface GangsheetRow {
  id: string
  size: string
  noArtworks: number
  qtySheets: number
  stdCost: number
  quotedCost: number
  front_image?: string | null
}

interface TransferRow {
  id: string
  transferSize: string
  qty: number
  stdCost: number
  quotedCost: number
  artwork_image?: string | null
}

interface OtherCharge {
  key: 'artwork' | 'packaging' | 'shipping' | 'discount' | 'tax'
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
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`
}

const VARIANTS = ['Black - M', 'Black - L', 'Black - XL', 'White - M', 'White - L']
const PRINT_LOCATIONS = ['Front Print', 'Back Print', 'Left Chest', 'Right Sleeve', 'Back Neck']
const PRINT_SIZES = ['12x16', '10x12', '8x10', '4x4', '3x3']
const GANGSHEET_SIZES = ['22" x 60"', '22" x 120"', '24" x 60"', '30" x 60"']
const TRANSFER_SIZES = ['12" x 12"', '12" x 16"', '10" x 12"', '8" x 10"', '4" x 4"']

const initialApparelItems: ApparelItem[] = []
const initialGangsheetRows: GangsheetRow[] = []
const initialTransferRows: TransferRow[] = []

const initialOtherCharges: OtherCharge[] = [
  { key: 'artwork', label: 'Artwork Services', description: 'Artwork setup & editing', enabled: false, stdCost: 0, quotedCost: 0 },
  { key: 'packaging', label: 'Packaging', description: 'Poly mailer + label', enabled: false, stdCost: 0, quotedCost: 0 },
  { key: 'shipping', label: 'Estimated Shipping', description: 'Shipping & handling', enabled: false, stdCost: 0, quotedCost: 0 },
  { key: 'discount', label: 'Discount', description: 'Special discount', enabled: false, stdCost: 0, quotedCost: 0 },
  { key: 'tax', label: 'Tax', description: 'Tax is calculated from taxable amount', enabled: false, stdCost: 0, quotedCost: 0 },
]

function calculateQuotationTotals({
  productTotals,
  otherCharges,
  taxRate,
}: {
  productTotals: ProductTotals
  otherCharges: OtherCharge[]
  taxRate: number
}) {
  const itemsTotal = productTotals.apparel + productTotals.gangsheet + productTotals.transfers + productTotals.leadItems
  const enabled = otherCharges.filter(charge => charge.enabled)
  const shipping = enabled.find(charge => charge.key === 'shipping')?.quotedCost ?? 0
  const nonTaxCharges = enabled
    .filter(charge => !['shipping', 'discount', 'tax'].includes(charge.key))
    .reduce((sum, charge) => sum + charge.quotedCost, 0)
  const discount = enabled.find(charge => charge.key === 'discount')?.quotedCost ?? 0
  const subtotal = itemsTotal + shipping + nonTaxCharges
  const taxableAmount = Math.max(subtotal + discount, 0)
  const tax = enabled.some(charge => charge.key === 'tax') ? +(taxableAmount * taxRate).toFixed(2) : 0
  const finalTotal = +(taxableAmount + tax).toFixed(2)

  return { itemsTotal, shipping, subtotal, discount, tax, finalTotal }
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
  quoteDate,
  validUntil,
  setValidUntil,
  dueDate,
  setDueDate,
  agent,
  setAgent,
}: {
  status: QuoteStatus
  quoteDate: string
  validUntil: string
  setValidUntil: (v: string) => void
  dueDate: string
  setDueDate: (v: string) => void
  agent: string
  setAgent: (agent: string) => void
}) {
  return (
    <section className="nq-info-bar">
      <div className="nq-info-field">
        <label>Quote #</label>
        <div className="nq-quote-num">
          <input className="nq-input nq-input-readonly" value="AUTO-GENERATED" readOnly />
          <span className="nq-badge nq-badge-draft">{status}</span>
        </div>
      </div>
      <div className="nq-info-field"><label>Quote Date</label><input className="nq-input" value={quoteDate} readOnly /></div>
      <div className="nq-info-field"><label>Valid Until</label><input className="nq-input" type="date" value={validUntil} onChange={e => setValidUntil(e.target.value)} /><span className="nq-validity-hint">7 days validity</span></div>
      <div className="nq-info-field"><label>Due Date</label><input className="nq-input" type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} /></div>
      <div className="nq-info-field"><label>Source</label><div className="nq-source-select"><MessageCircle size={14} className="nq-source-icon" /><input className="nq-input" placeholder="Source (e.g. Email, Chatwoot)" value="" readOnly /></div></div>
      <div className="nq-info-field">
        <label>Sales Agent</label>
        <input className="nq-input" placeholder="Agent name" value={agent} onChange={e => setAgent(e.target.value)} />
      </div>
    </section>
  )
}

function SupplierSection({
  supplierText,
  setSupplierText,
  setSupplierId,
  billingAddress,
  setBillingAddress,
  shippingAddress,
  setShippingAddress,
  sameAsBilling,
  setSameAsBilling,
}: {
  supplierText: string
  setSupplierText: (v: string) => void
  setSupplierId: (id: string) => void
  billingAddress: string
  setBillingAddress: (v: string) => void
  shippingAddress: string
  setShippingAddress: (v: string) => void
  sameAsBilling: boolean
  setSameAsBilling: (same: boolean) => void
}) {
  return (
    <section className="nq-card">
      <div className="nq-card-heading"><div className="nq-section-num-icon">1</div><h3>Supplier Information</h3></div>
      <div className="nq-customer-grid">
        <div className="nq-customer-select-col">
          <label className="nq-field-label">Supplier <span className="nq-req">*</span></label>
          <SupplierCombobox value={supplierText} onChange={(text, id) => { setSupplierText(text); if (id) setSupplierId(id) }} />
        </div>
        <div className="nq-address-block">
          <div className="nq-address-header"><span className="nq-field-label">Billing Address</span></div>
          <textarea className="nq-textarea" rows={3} placeholder="Billing address..." value={billingAddress} onChange={e => setBillingAddress(e.target.value)} />
        </div>
        <div className="nq-address-block">
          <div className="nq-address-header">
            <span className="nq-field-label">Shipping Address</span>
            <label className="nq-same-billing"><input type="checkbox" checked={sameAsBilling} onChange={e => setSameAsBilling(e.target.checked)} /> Same as billing</label>
          </div>
          <textarea className="nq-textarea" rows={3} placeholder="Shipping address..." value={sameAsBilling ? billingAddress : shippingAddress} onChange={e => { if (!sameAsBilling) setShippingAddress(e.target.value) }} readOnly={sameAsBilling} />
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

function QuoteTypeSelector({ activeTab, onChange, tabTotals }: {
  activeTab: QuoteTab
  onChange: (tab: QuoteTab) => void
  tabTotals: Record<QuoteTab, number>
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
            className={cn('nq-tab-card', activeTab === tab.key && 'nq-tab-card-active')}
            style={activeTab === tab.key ? { borderColor: tab.color, '--tab-color': tab.color } as React.CSSProperties : undefined}
            onClick={() => onChange(tab.key)}
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

function AISection() {
  return (
    <div className="nq-sidebar-card">
      <div className="nq-sidebar-card-header"><Bot size={14} className="nq-ai-icon" /><span>AI Extracted from Chat</span><span className="nq-badge nq-badge-ai">Auto-Filled</span></div>
      <ul className="nq-ai-list">{[['Product', 'Hoodie'], ['Quantity', '50'], ['Print Type', 'DTF'], ['Locations', 'Front, Back'], ['Size', '12x16'], ['Urgency', 'Yes']].map(([label, value]) => <li key={label} className="nq-ai-item"><span className="nq-ai-check">âœ"</span><span className="nq-ai-label">{label}:</span><span className="nq-ai-value">{value}</span></li>)}</ul>
      <button className="nq-link-btn nq-ai-edit">Edit Extracted Data</button>
    </div>
  )
}

function PreviousQuotesSection() {
  return (
    <div className="nq-sidebar-card">
      <div className="nq-sidebar-card-header"><span>Previous / Revised Quotations</span><button className="nq-link-btn">View All</button></div>
      <div className="nq-prev-quotes">{[
        { id: 'QT-2026-0001 (Rev. 2)', status: 'Sent', date: 'May 1, 2026', amount: '$1,250.00' },
        { id: 'QT-2026-0001 (Rev. 1)', status: 'Sent', date: 'Apr 30, 2026', amount: '$1,180.00' },
        { id: 'QT-2026-0001 (Original)', status: 'Sent', date: 'Apr 28, 2026', amount: '$1,120.00' },
      ].map(q => <div key={q.id} className="nq-prev-quote-row"><div className="nq-prev-quote-id"><button className="nq-link-btn nq-qt-link">{q.id}</button><span className="nq-badge nq-badge-sent">{q.status}</span></div><div className="nq-prev-quote-meta"><span>{q.date}</span><span className="nq-prev-amount">{q.amount}</span></div></div>)}</div>
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
          <tr><td><label className="nq-pricing-check"><input type="checkbox" checked readOnly /> Tax</label></td><td>${fmt(totals.tax)}</td></tr>
        </tbody>
        <tfoot><tr className="nq-pricing-total-row"><td>Total</td><td><strong className="nq-total-quoted">${fmt(totals.finalTotal)}</strong></td></tr></tfoot>
      </table>
    </div>
  )
}

function TermsSection({ paymentTerms, productionTime, deliveryMethod, currency, setPaymentTerms, setProductionTime, setDeliveryMethod, setCurrency }: {
  paymentTerms: string
  productionTime: string
  deliveryMethod: string
  currency: string
  setPaymentTerms: (value: string) => void
  setProductionTime: (value: string) => void
  setDeliveryMethod: (value: string) => void
  setCurrency: (value: string) => void
}) {
  return (
    <div className="nq-sidebar-card">
      <div className="nq-sidebar-card-header"><span>Terms &amp; Conditions</span></div>
      <div className="nq-terms-grid">
        <div className="nq-terms-field"><label>Payment Terms</label><select className="nq-select" value={paymentTerms} onChange={e => setPaymentTerms(e.target.value)}><option>Net 15</option><option>Net 30</option><option>Due on Receipt</option></select></div>
        <div className="nq-terms-field"><label>Production Time</label><select className="nq-select" value={productionTime} onChange={e => setProductionTime(e.target.value)}><option>2 - 3 Business Days</option><option>3 - 5 Business Days</option><option>5 - 7 Business Days</option></select></div>
        <div className="nq-terms-field"><label>Delivery Method</label><select className="nq-select" value={deliveryMethod} onChange={e => setDeliveryMethod(e.target.value)}><option>Standard Shipping</option><option>Express Shipping</option><option>Local Pickup</option></select></div>
        <div className="nq-terms-field"><label>Currency</label><select className="nq-select" value={currency} onChange={e => setCurrency(e.target.value)}><option>USD - US Dollar</option><option>CAD - Canadian Dollar</option><option>GBP - Pound Sterling</option></select></div>
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
function CustomerInfoSection({
  leadId, leadNumber, customerSource,
  customerName, setCustomerName,
  companyName, setCompanyName,
  billingEmail, setBillingEmail,
  contactNumber, setContactNumber,
  whatsapp, setWhatsapp,
  wechat, setWechat,
  customerCategory, setCustomerCategory,
  shippingCountry, setShippingCountry,
  shippingState, setShippingState,
  shippingCity, setShippingCity,
  zipCode, setZipCode,
  customerReqSummary, setCustomerReqSummary,
  quoteEstimate, setQuoteEstimate,
}: {
  leadId: string | null; leadNumber: string; customerSource: string
  customerName: string; setCustomerName: (v: string) => void
  companyName: string; setCompanyName: (v: string) => void
  billingEmail: string; setBillingEmail: (v: string) => void
  contactNumber: string; setContactNumber: (v: string) => void
  whatsapp: string; setWhatsapp: (v: string) => void
  wechat: string; setWechat: (v: string) => void
  customerCategory: string; setCustomerCategory: (v: string) => void
  shippingCountry: string; setShippingCountry: (v: string) => void
  shippingState: string; setShippingState: (v: string) => void
  shippingCity: string; setShippingCity: (v: string) => void
  zipCode: string; setZipCode: (v: string) => void
  customerReqSummary: string; setCustomerReqSummary: (v: string) => void
  quoteEstimate: string; setQuoteEstimate: (v: string) => void
}) {
  return (
    <section className="nq-card">
      <div className="nq-card-heading">
        <div className="nq-section-num-icon"><User2 size={14} /></div>
        <h3>Customer Information</h3>
        {leadId && <span className="nq-badge nq-badge-ai" style={{ marginLeft: 8 }}>Auto-Filled from Lead</span>}
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

      <div className="nq-cinfo-grid">
        <div className="nq-cinfo-field">
          <label className="nq-field-label">Customer Name</label>
          <input className="nq-input" value={customerName} onChange={e => setCustomerName(e.target.value)} placeholder="Contact person..." />
        </div>
        <div className="nq-cinfo-field">
          <label className="nq-field-label">Company Name</label>
          <input className="nq-input" value={companyName} onChange={e => setCompanyName(e.target.value)} placeholder="Company..." />
        </div>
        <div className="nq-cinfo-field">
          <label className="nq-field-label">Billing Email</label>
          <input className="nq-input" type="email" value={billingEmail} onChange={e => setBillingEmail(e.target.value)} placeholder="billing@example.com" />
        </div>
        <div className="nq-cinfo-field">
          <label className="nq-field-label">Contact Number</label>
          <input className="nq-input" value={contactNumber} onChange={e => setContactNumber(e.target.value)} placeholder="+1-555-0000" />
        </div>
        <div className="nq-cinfo-field">
          <label className="nq-field-label">WhatsApp</label>
          <input className="nq-input" value={whatsapp} onChange={e => setWhatsapp(e.target.value)} placeholder="+1-555-0000" />
        </div>
        <div className="nq-cinfo-field">
          <label className="nq-field-label">WeChat</label>
          <input className="nq-input" value={wechat} onChange={e => setWechat(e.target.value)} placeholder="WeChat ID" />
        </div>
        <div className="nq-cinfo-field">
          <label className="nq-field-label">Customer Category</label>
          <select className="nq-select" value={customerCategory} onChange={e => setCustomerCategory(e.target.value)}>
            <option value="">— Select —</option>
            {['Wholesale', 'Retail', 'Reseller', 'Other'].map(t => <option key={t}>{t}</option>)}
          </select>
        </div>
        <div className="nq-cinfo-field">
          <label className="nq-field-label">Shipping Country</label>
          <input className="nq-input" value={shippingCountry} onChange={e => setShippingCountry(e.target.value)} placeholder="USA" />
        </div>
        <div className="nq-cinfo-field">
          <label className="nq-field-label">Shipping State</label>
          <input className="nq-input" value={shippingState} onChange={e => setShippingState(e.target.value)} placeholder="TX" />
        </div>
        <div className="nq-cinfo-field">
          <label className="nq-field-label">Shipping City</label>
          <input className="nq-input" value={shippingCity} onChange={e => setShippingCity(e.target.value)} placeholder="Dallas" />
        </div>
        <div className="nq-cinfo-field">
          <label className="nq-field-label">ZIP Code</label>
          <input className="nq-input" value={zipCode} onChange={e => setZipCode(e.target.value)} placeholder="75201" />
        </div>
        <div className="nq-cinfo-field nq-cinfo-field-wide">
          <label className="nq-field-label">Customer Requirement Summary</label>
          <textarea className="nq-textarea" rows={2} value={customerReqSummary} onChange={e => setCustomerReqSummary(e.target.value)} placeholder="Customer's requirements from lead conversation..." />
        </div>
        <div className="nq-cinfo-field">
          <label className="nq-field-label">Quote Estimate ($)</label>
          <div className="nq-money-input"><span>$</span><input type="number" min={0} step={0.01} value={quoteEstimate} onChange={e => setQuoteEstimate(e.target.value)} /></div>
        </div>
      </div>
    </section>
  )
}

// ── Item image upload cell ─────────────────────────────────────────────────
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
        <strong className="nq-section-total">Section Total: ${fmt(items.reduce((s, r) => s + r.qty * r.unit_price, 0))}</strong>
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
  const { id: quoteId } = useParams<{ id?: string }>()
  const { user } = useAuthStore()

  // ── Base form state ──
  const [status, setStatus] = useState<QuoteStatus>('Draft')
  const [quoteDate] = useState(today())
  const [validUntil, setValidUntil] = useState('')
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
  const [productionTime, setProductionTime] = useState('2 - 3 Business Days')
  const [deliveryMethod, setDeliveryMethod] = useState('Standard Shipping')
  const [currency, setCurrency] = useState('USD - US Dollar')

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

  // ── Initialize form from quotation once loaded ──
  useEffect(() => {
    if (!quotationData || formInitialized) return
    const q = quotationData as Record<string, any>
    setLeadId(q.lead_id ?? null)
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
          name:         (item.description ?? '').split('\n')[0],
          description:  (item.description ?? '').split('\n').slice(1).join('\n'),
          brand:        '',
          model:        '',
          variant:      item.colors ?? '',
          sizes:        item.sizes ?? '',
          qty:          item.qty ?? 1,
          printDetails: Array.from({ length: item.artwork_count ?? 0 }, () => ({ location: 'Front Print', size: '12x16' })),
          stdCost:      0,
          quotedCost:   item.unit_price ?? 0,
          front_image:  item.front_image ?? null,
          back_image:   item.back_image  ?? null,
        })))
      } else if (orderType === 'dtf') {
        setTransferRows(q.items.map((item: Record<string, any>) => ({
          id:            item.id ?? uid(),
          transferSize:  item.description ?? '12" x 12"',
          qty:           item.qty ?? 1,
          stdCost:       0,
          quotedCost:    item.unit_price ?? 0,
          artwork_image: item.artwork_image ?? null,
        })))
      } else if (orderType === 'gangsheet') {
        setGangsheetRows(q.items.map((item: Record<string, any>) => ({
          id:          item.id ?? uid(),
          size:        item.description ?? '22" x 60"',
          noArtworks:  item.artwork_count ?? 1,
          qtySheets:   item.qty ?? 1,
          stdCost:     0,
          quotedCost:  item.unit_price ?? 0,
          front_image: item.front_image ?? null,
        })))
      }
    }
    if (q.status) setStatus(q.status as QuoteStatus)

    // Restore other charges from saved values
    if (q.estimated_shipping > 0 || q.rush_services > 0 || q.discount_pct > 0 || q.tax_pct > 0) {
      setOtherCharges(prev => prev.map(charge => {
        if (charge.key === 'shipping' && q.estimated_shipping > 0)
          return { ...charge, enabled: true, quotedCost: Number(q.estimated_shipping) }
        if (charge.key === 'discount' && q.discount_pct > 0)
          return { ...charge, enabled: true, quotedCost: Number(q.discount_pct) }
        if (charge.key === 'tax' && q.tax_pct > 0)
          return { ...charge, enabled: true }
        if (charge.key === 'artwork' && q.rush_services > 0)
          return { ...charge, enabled: true, quotedCost: Number(q.rush_services) }
        return charge
      }))
    }
    if (q.payment_terms) setPaymentTerms(q.payment_terms)
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
  const gangsheetTotal = useMemo(() => gangsheetRows.reduce((sum, row) => sum + row.qtySheets * row.quotedCost, 0), [gangsheetRows])
  const transfersTotal = useMemo(() => transferRows.reduce((sum, row) => sum + row.qty * row.quotedCost, 0), [transferRows])
  const activeTotal    = activeTab === 'apparel' ? apparelTotal : activeTab === 'dtf' ? transfersTotal : gangsheetTotal
  const totals = useMemo(() => calculateQuotationTotals({ productTotals: { apparel: activeTotal, gangsheet: 0, transfers: 0, leadItems: 0 }, otherCharges, taxRate: 0.07 }), [activeTotal, otherCharges])

  const updateApparelItem = (id: string, patch: Partial<ApparelItem>) => setApparelItems(prev => prev.map(item => item.id === id ? { ...item, ...patch } : item))
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
        const brand = [item.brand, item.model].filter(Boolean).join(' | ')
        const fullDesc = [item.name || item.description, item.description && item.name !== item.description ? item.description : null, brand || null].filter(Boolean).join('\n')
        allItems.push({
          description:   fullDesc || 'Apparel Item',
          qty:           item.qty,
          unit_price:    item.quotedCost,
          colors:        color,
          sizes:         item.sizes || undefined,
          artwork_count: item.printDetails.length || 0,
          sort_order:    sortIdx++,
          front_image:   item.front_image || null,
          back_image:    item.back_image  || null,
        })
      })
    } else if (activeTab === 'dtf') {
      transferRows.forEach(row => {
        allItems.push({
          description:   row.transferSize || 'DTF Transfer',
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
        })
      })
    }

    const taxEnabled      = otherCharges.find(c => c.key === 'tax')?.enabled ?? false
    const taxPct          = taxEnabled ? 7 : 0
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
      supplier_id:                  supplierId    || undefined,
      billing_address:              billingAddress || undefined,
      shipping_address:             sameAsBilling ? billingAddress : shippingAddress || undefined,
      internal_notes:               internalNotes || undefined,
      discount_pct:                 discountPct,
      tax_pct:                      taxPct,
      items:                        allItems,
      estimated_shipping:           estimatedShipping,
      rush_services:                rushServices,
      payment_terms:                paymentTerms,
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
          <nav className="nq-breadcrumb">
            <button className="nq-breadcrumb-link" onClick={() => navigate('/quotes')}>Quotes</button>
            <span className="nq-breadcrumb-sep">›</span>
            <span className="nq-breadcrumb-current">{quoteId ? 'Edit Quotation' : 'New Quotation'}</span>
          </nav>
          <h1 className="nq-title">{quoteId ? 'Edit Quotation' : 'New Quotation'}</h1>
          <p className="nq-subtitle">
            {leadId ? `Auto-filled from lead ${leadNumber || leadId}` : 'Create, review and send quotation to customer'}
          </p>
        </div>
      </header>

      <QuoteHeader status={status} quoteDate={quoteDate} validUntil={validUntil} setValidUntil={setValidUntil} dueDate={dueDate} setDueDate={setDueDate} agent={agent} setAgent={setAgent} />

      <div className="nq-body">
        <main className="nq-main">
          <SupplierSection supplierText={supplierText} setSupplierText={setSupplierText} setSupplierId={setSupplierId} billingAddress={billingAddress} setBillingAddress={setBillingAddress} shippingAddress={shippingAddress} setShippingAddress={setShippingAddress} sameAsBilling={sameAsBilling} setSameAsBilling={setSameAsBilling} />

          <CustomerInfoSection
            leadId={leadId} leadNumber={leadNumber} customerSource={customerSource}
            customerName={customerName} setCustomerName={setCustomerName}
            companyName={companyName} setCompanyName={setCompanyName}
            billingEmail={billingEmail} setBillingEmail={setBillingEmail}
            contactNumber={contactNumber} setContactNumber={setContactNumber}
            whatsapp={whatsapp} setWhatsapp={setWhatsapp}
            wechat={wechat} setWechat={setWechat}
            customerCategory={customerCategory} setCustomerCategory={setCustomerCategory}
            shippingCountry={shippingCountry} setShippingCountry={setShippingCountry}
            shippingState={shippingState} setShippingState={setShippingState}
            shippingCity={shippingCity} setShippingCity={setShippingCity}
            zipCode={zipCode} setZipCode={setZipCode}
            customerReqSummary={customerReqSummary} setCustomerReqSummary={setCustomerReqSummary}
            quoteEstimate={quoteEstimate} setQuoteEstimate={setQuoteEstimate}
          />

          {(leadId || leadItems.length > 0) && (
            <LeadItemsSection items={leadItems} setItems={setLeadItems} />
          )}

          {/* ── Quote Type Selector ── */}
          <QuoteTypeSelector
            activeTab={activeTab}
            onChange={setActiveTab}
            tabTotals={{ apparel: apparelTotal, dtf: transfersTotal, gangsheet: gangsheetTotal }}
          />

          {/* ── Active Tab Content ── */}
          {activeTab === 'apparel' && (
            <section className="nq-card">
              <div className="nq-section-header">
                <span className="nq-tab-section-badge" style={{ background: '#e0f2fe', color: '#0369a1' }}>👕 Custom Printed Apparel</span>
                <strong className="nq-section-total">Section Total: ${fmt(apparelTotal)}</strong>
              </div>
              <div className="nq-table-wrap"><table className="nq-table"><thead><tr><th>#</th><th>Item / Description</th><th>Color</th><th>Size</th><th>Qty</th><th>FR Image</th><th>BK Image</th><th>Print Locations</th><th>STD Cost</th><th>Quoted</th><th>Total</th><th></th></tr></thead><tbody>
                {apparelItems.map((item, idx) => (
                  <tr key={item.id}>
                    <td className="nq-td-num">{idx + 1}</td>
                    <td><div className="nq-item-desc"><div className="nq-item-thumb"><Shirt size={18} /></div><div><input className="nq-table-input" placeholder="Item name (e.g. T-Shirt Premium)" value={item.name} onChange={e => updateApparelItem(item.id, { name: e.target.value })} /><input className="nq-table-input" placeholder="Brand | Model (e.g. Gildan | 18500)" value={item.description} onChange={e => updateApparelItem(item.id, { description: e.target.value })} /></div></div></td>
                    <td><input className="nq-table-input" placeholder="e.g. Black" value={item.variant} onChange={e => updateApparelItem(item.id, { variant: e.target.value })} /></td>
                    <td>
                      <select className="nq-table-select" value={item.sizes || ''} onChange={e => updateApparelItem(item.id, { sizes: e.target.value })}>
                        <option value="">Select Size</option>
                        {['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL', 'Custom'].map(s => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </select>
                    </td>
                    <td><div className="nq-qty-input"><input className="nq-table-input" type="number" min={1} value={item.qty} onChange={e => updateApparelItem(item.id, { qty: +e.target.value })} /><span>pcs</span></div></td>
                    <td><ImageUploadCell imageUrl={item.front_image} label="Front" uploading={uploadingImg[`${item.id}-front_image`]} onUpload={f => uploadItemImage(item.id, 'front_image', f, updateApparelItem)} onRemove={() => updateApparelItem(item.id, { front_image: null })} /></td>
                    <td><ImageUploadCell imageUrl={item.back_image} label="Back" uploading={uploadingImg[`${item.id}-back_image`]} onUpload={f => uploadItemImage(item.id, 'back_image', f, updateApparelItem)} onRemove={() => updateApparelItem(item.id, { back_image: null })} /></td>
                    <td><div className="nq-print-details"><span className="nq-print-method-badge">DTF Transfer</span>{item.printDetails.map((pd, pi) => (<div key={pi} className="nq-print-location-row"><span className="nq-print-dot" /><select className="nq-print-loc-select" value={pd.location} onChange={e => updateApparelItem(item.id, { printDetails: item.printDetails.map((row, i) => i === pi ? { ...row, location: e.target.value } : row) })}>{PRINT_LOCATIONS.map(l => <option key={l}>{l}</option>)}</select><select className="nq-print-size-select" value={pd.size} onChange={e => updateApparelItem(item.id, { printDetails: item.printDetails.map((row, i) => i === pi ? { ...row, size: e.target.value } : row) })}>{PRINT_SIZES.map(s => <option key={s}>{s}</option>)}</select><button className="nq-icon-btn" onClick={() => updateApparelItem(item.id, { printDetails: item.printDetails.filter((_, i) => i !== pi) })}><X size={10} /></button></div>))}<button className="nq-add-location-btn" onClick={() => updateApparelItem(item.id, { printDetails: [...item.printDetails, { location: 'Front Print', size: '12x16' }] })}><Plus size={11} /> Add Location</button></div></td>
                    <td><div className="nq-money-input"><span>$</span><input type="number" value={item.stdCost} onChange={e => updateApparelItem(item.id, { stdCost: +e.target.value })} /></div></td>
                    <td><div className="nq-money-input nq-money-quoted"><span>$</span><input type="number" value={item.quotedCost} onChange={e => updateApparelItem(item.id, { quotedCost: +e.target.value })} /></div></td>
                    <td className="nq-td-total">${fmt(item.qty * item.quotedCost)}</td>
                    <td><button className="nq-icon-btn nq-delete-btn" onClick={() => setApparelItems(prev => prev.filter(r => r.id !== item.id))}><Trash2 size={14} /></button></td>
                  </tr>
                ))}
                {apparelItems.length === 0 && <tr><td colSpan={12} style={{ textAlign: 'center', color: '#94a3b8', padding: '18px 0' }}>No items yet — click "Add Apparel Row" below.</td></tr>}
              </tbody></table></div>
              <button className="nq-add-row-btn" onClick={() => setApparelItems(prev => [...prev, { id: uid(), name: '', description: '', brand: '', model: '', variant: '', sizes: '', qty: 1, printDetails: [], stdCost: 0, quotedCost: 0, front_image: null, back_image: null }])}><Plus size={12} /> Add Apparel Row</button>
            </section>
          )}

          {activeTab === 'dtf' && (
            <section className="nq-card">
              <div className="nq-section-header">
                <span className="nq-tab-section-badge" style={{ background: '#fff7ed', color: '#c2410c' }}>🖨️ DTF Transfers</span>
                <strong className="nq-section-total">Section Total: ${fmt(transfersTotal)}</strong>
              </div>
              <div className="nq-table-wrap"><table className="nq-table"><thead><tr><th>#</th><th>Transfer Size</th><th>Qty</th><th>Artwork</th><th>STD Cost</th><th>Quoted</th><th>Total</th><th></th></tr></thead><tbody>
                {transferRows.map((row, idx) => (
                  <tr key={row.id}>
                    <td className="nq-td-num">{idx + 1}</td>
                    <td><select className="nq-table-select" value={row.transferSize} onChange={e => updateTransferRow(row.id, { transferSize: e.target.value })}>{TRANSFER_SIZES.map(size => <option key={size}>{size}</option>)}</select></td>
                    <td><div className="nq-qty-input"><input className="nq-table-input" type="number" min={1} value={row.qty} onChange={e => updateTransferRow(row.id, { qty: +e.target.value })} /><span>pcs</span></div></td>
                    <td><ImageUploadCell imageUrl={row.artwork_image} label="Art" uploading={uploadingImg[`${row.id}-artwork_image`]} onUpload={f => uploadItemImage(row.id, 'artwork_image', f, updateTransferRow)} onRemove={() => updateTransferRow(row.id, { artwork_image: null })} /></td>
                    <td><div className="nq-money-input"><span>$</span><input type="number" value={row.stdCost} onChange={e => updateTransferRow(row.id, { stdCost: +e.target.value })} /></div></td>
                    <td><div className="nq-money-input nq-money-quoted"><span>$</span><input type="number" value={row.quotedCost} onChange={e => updateTransferRow(row.id, { quotedCost: +e.target.value })} /></div></td>
                    <td className="nq-td-total">${fmt(row.qty * row.quotedCost)}</td>
                    <td><button className="nq-icon-btn nq-delete-btn" onClick={() => setTransferRows(prev => prev.filter(r => r.id !== row.id))}><Trash2 size={14} /></button></td>
                  </tr>
                ))}
                {transferRows.length === 0 && <tr><td colSpan={8} style={{ textAlign: 'center', color: '#94a3b8', padding: '18px 0' }}>No transfers yet — click "Add Transfer Row" below.</td></tr>}
              </tbody></table></div>
              <button className="nq-add-row-btn" onClick={() => setTransferRows(prev => [...prev, { id: uid(), transferSize: '12" x 12"', qty: 1, stdCost: 1.5, quotedCost: 2, artwork_image: null }])}><Plus size={12} /> Add Transfer Row</button>
            </section>
          )}

          {activeTab === 'gangsheet' && (
            <section className="nq-card">
              <div className="nq-section-header">
                <span className="nq-tab-section-badge" style={{ background: '#f5f3ff', color: '#6d28d9' }}>📐 Gangsheet</span>
                <strong className="nq-section-total">Section Total: ${fmt(gangsheetTotal)}</strong>
              </div>
              <div className="nq-table-wrap"><table className="nq-table"><thead><tr><th>#</th><th>Gangsheet Size</th><th>No. of Artworks</th><th>Qty Sheets</th><th>Preview</th><th>STD Cost</th><th>Quoted</th><th>Total</th><th></th></tr></thead><tbody>
                {gangsheetRows.map((row, idx) => (
                  <tr key={row.id}>
                    <td className="nq-td-num">{idx + 1}</td>
                    <td><select className="nq-table-select" value={row.size} onChange={e => updateGangsheetRow(row.id, { size: e.target.value })}>{GANGSHEET_SIZES.map(s => <option key={s}>{s}</option>)}</select></td>
                    <td><input className="nq-table-input" type="number" value={row.noArtworks} onChange={e => updateGangsheetRow(row.id, { noArtworks: +e.target.value })} /></td>
                    <td><input className="nq-table-input" type="number" value={row.qtySheets} onChange={e => updateGangsheetRow(row.id, { qtySheets: +e.target.value })} /></td>
                    <td><ImageUploadCell imageUrl={row.front_image} label="File" uploading={uploadingImg[`${row.id}-front_image`]} onUpload={f => uploadItemImage(row.id, 'front_image', f, updateGangsheetRow)} onRemove={() => updateGangsheetRow(row.id, { front_image: null })} /></td>
                    <td><div className="nq-money-input"><span>$</span><input type="number" value={row.stdCost} onChange={e => updateGangsheetRow(row.id, { stdCost: +e.target.value })} /></div></td>
                    <td><div className="nq-money-input nq-money-quoted"><span>$</span><input type="number" value={row.quotedCost} onChange={e => updateGangsheetRow(row.id, { quotedCost: +e.target.value })} /></div></td>
                    <td className="nq-td-total">${fmt(row.qtySheets * row.quotedCost)}</td>
                    <td><button className="nq-icon-btn nq-delete-btn" onClick={() => setGangsheetRows(prev => prev.filter(r => r.id !== row.id))}><Trash2 size={14} /></button></td>
                  </tr>
                ))}
                {gangsheetRows.length === 0 && <tr><td colSpan={9} style={{ textAlign: 'center', color: '#94a3b8', padding: '18px 0' }}>No sheets yet — click "Add Gangsheet Row" below.</td></tr>}
              </tbody></table></div>
              <button className="nq-add-row-btn" onClick={() => setGangsheetRows(prev => [...prev, { id: uid(), size: '22" x 60"', noArtworks: 1, qtySheets: 1, stdCost: 25, quotedCost: 30, front_image: null }])}><Plus size={12} /> Add Gangsheet Row</button>
            </section>
          )}

          <OtherChargesSection charges={otherCharges} toggleCharge={toggleCharge} updateCharge={updateCharge} />
          <NotesSection customerNotes={supplierNotes} internalNotes={internalNotes} setCustomerNotes={setSupplierNotes} setInternalNotes={setInternalNotes} />
          <AISection />
          <ArtworkUploader quotationId={quoteId} />
        </main>

        <aside className="nq-sidebar">
          <CRMSnapshotPanel lead={leadData ?? null} />
          <PreviousQuotesSection />
          <PricingSummary totals={totals} />
          <TermsSection paymentTerms={paymentTerms} productionTime={productionTime} deliveryMethod={deliveryMethod} currency={currency} setPaymentTerms={setPaymentTerms} setProductionTime={setProductionTime} setDeliveryMethod={setDeliveryMethod} setCurrency={setCurrency} />
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
