import { useReducer, useMemo, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import toast from '../utils/toast'
import { ChevronRight, Plus, Save, Trash2 } from 'lucide-react'
import { cn } from '../utils/cn'
import { api } from '../services/api'

// ── Types ──────────────────────────────────────────────────────────────────────

interface POLineItem {
  id: string
  product_id: string | null
  item_name: string
  description: string
  hsn_code: string
  uom: string
  qty_ordered: number
  unit_price: number
  discount_pct: number
  tax_pct: number
  line_total: number
  required_by_date: string
  remarks: string
  sort_order: number
}

interface POFormState {
  order_date: string
  expected_date: string
  currency: string
  priority: 'Low' | 'Medium' | 'High' | 'Urgent'
  supplier_id: string
  supplier_name: string
  supplier_reference: string
  payment_terms: string
  order_id: string
  buyer_id: string
  department: string
  shipping_method: string
  shipping_address: string
  billing_address: string
  freight_charges: number
  other_charges: number
  notes: string
  terms_conditions: string
  items: POLineItem[]
}

type Action =
  | { type: 'SET'; field: keyof Omit<POFormState, 'items'>; value: string | number }
  | { type: 'ADD_ITEM' }
  | { type: 'UPDATE_ITEM'; id: string; patch: Partial<POLineItem> }
  | { type: 'REMOVE_ITEM'; id: string }

// ── Helpers ────────────────────────────────────────────────────────────────────

const uid = () => Math.random().toString(36).slice(2, 9)
const todayISO = () => new Date().toISOString().split('T')[0]

function calcLineTotal(item: Pick<POLineItem, 'qty_ordered' | 'unit_price' | 'discount_pct' | 'tax_pct'>): number {
  const base      = item.qty_ordered * item.unit_price
  const afterDisc = base * (1 - (item.discount_pct || 0) / 100)
  const withTax   = afterDisc * (1 + (item.tax_pct || 0) / 100)
  return +withTax.toFixed(2)
}

function calcTotals(items: POLineItem[], freight: number, other: number) {
  let subtotal       = 0
  let total_discount = 0
  let total_tax      = 0
  for (const it of items) {
    const base       = it.qty_ordered * it.unit_price
    const disc_amt   = +(base * (it.discount_pct / 100)).toFixed(2)
    const after_disc = base - disc_amt
    const tax_amt    = +(after_disc * (it.tax_pct / 100)).toFixed(2)
    subtotal       += base
    total_discount += disc_amt
    total_tax      += tax_amt
  }
  subtotal       = +subtotal.toFixed(2)
  total_discount = +total_discount.toFixed(2)
  total_tax      = +total_tax.toFixed(2)
  const grand_total = +(subtotal - total_discount + total_tax + Number(freight) + Number(other)).toFixed(2)
  return { subtotal, total_discount, total_tax, grand_total }
}

function newItem(idx: number): POLineItem {
  return {
    id: uid(),
    product_id: null,
    item_name: '',
    description: '',
    hsn_code: '',
    uom: 'pcs',
    qty_ordered: 1,
    unit_price: 0,
    discount_pct: 0,
    tax_pct: 0,
    line_total: 0,
    required_by_date: '',
    remarks: '',
    sort_order: idx,
  }
}

// ── Reducer ────────────────────────────────────────────────────────────────────

const initialState: POFormState = {
  order_date:         todayISO(),
  expected_date:      '',
  currency:           'USD',
  priority:           'Medium',
  supplier_id:        '',
  supplier_name:      '',
  supplier_reference: '',
  payment_terms:      '',
  order_id:           '',
  buyer_id:           '',
  department:         '',
  shipping_method:    '',
  shipping_address:   '',
  billing_address:    '',
  freight_charges:    0,
  other_charges:      0,
  notes:              '',
  terms_conditions:   '',
  items:              [],
}

function reducer(state: POFormState, action: Action): POFormState {
  switch (action.type) {
    case 'SET':
      return { ...state, [action.field]: action.value }
    case 'ADD_ITEM':
      return { ...state, items: [...state.items, newItem(state.items.length)] }
    case 'UPDATE_ITEM': {
      const items = state.items.map(it => {
        if (it.id !== action.id) return it
        const updated = { ...it, ...action.patch }
        updated.line_total = calcLineTotal(updated)
        return updated
      })
      return { ...state, items }
    }
    case 'REMOVE_ITEM':
      return { ...state, items: state.items.filter(it => it.id !== action.id) }
    default:
      return state
  }
}

// ── Component ──────────────────────────────────────────────────────────────────

const PRIORITY_COLORS: Record<string, string> = {
  Low:    'bg-gray-100 text-gray-600',
  Medium: 'bg-blue-50 text-blue-700',
  High:   'bg-orange-50 text-orange-700',
  Urgent: 'bg-red-50 text-red-700',
}

const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'CNY', 'INR']
const PAYMENT_TERMS = ['Net 15', 'Net 30', 'Net 45', 'Net 60', 'Due on Receipt', 'Prepaid', '50% Advance']
const SHIPPING_METHODS = ['Standard', 'Express', 'Air Freight', 'Sea Freight', 'Courier', 'Pickup', 'Other']

export function NewPurchaseOrderPage() {
  const navigate = useNavigate()
  const [state, dispatch] = useReducer(reducer, initialState)
  const [supplierSearch, setSupplierSearch] = useState('')
  const [supplierOpen, setSupplierOpen] = useState(false)

  const set = (field: keyof Omit<POFormState, 'items'>, value: string | number) =>
    dispatch({ type: 'SET', field, value })

  // ── Data fetching ──

  const { data: suppliersData } = useQuery({
    queryKey: ['suppliers-for-po'],
    queryFn: () => api.get('/suppliers', { params: { limit: 200 } }).then(r => r.data.data?.rows ?? []),
  })

  const { data: usersData } = useQuery({
    queryKey: ['users-for-po'],
    queryFn: () => api.get('/users').then(r => r.data.data ?? r.data ?? []),
  })

  const suppliers: { id: string; name: string; email: string }[] = suppliersData ?? []
  const users: { id: string; name: string }[] = usersData ?? []

  const filteredSuppliers = suppliers.filter(s =>
    s.name.toLowerCase().includes(supplierSearch.toLowerCase()) ||
    (s.email ?? '').toLowerCase().includes(supplierSearch.toLowerCase())
  )

  // ── Totals ──

  const totals = useMemo(
    () => calcTotals(state.items, state.freight_charges, state.other_charges),
    [state.items, state.freight_charges, state.other_charges]
  )

  // ── Mutation ──

  const createMutation = useMutation({
    mutationFn: (payload: object) => api.post('/purchase-orders', payload),
    onSuccess: (res) => {
      toast.success('Purchase order created')
      navigate(`/purchase-orders/${res.data.po?.id ?? ''}`)
    },
    onError: (err: any) => toast.error(err.response?.data?.message ?? 'Failed to create PO'),
  })

  function buildPayload() {
    return {
      supplier_id:        state.supplier_id || null,
      supplier_reference: state.supplier_reference || null,
      payment_terms:      state.payment_terms || null,
      currency:           state.currency,
      buyer_id:           state.buyer_id || null,
      department:         state.department || null,
      priority:           state.priority,
      shipping_method:    state.shipping_method || null,
      shipping_address:   state.shipping_address || null,
      billing_address:    state.billing_address || null,
      terms_conditions:   state.terms_conditions || null,
      order_date:         state.order_date || null,
      expected_date:      state.expected_date || null,
      notes:              state.notes || null,
      freight_charges:    state.freight_charges,
      other_charges:      state.other_charges,
      order_id:           state.order_id || null,
      items: state.items.map((item, i) => ({
        item_name:        item.item_name,
        description:      item.description || null,
        hsn_code:         item.hsn_code || null,
        uom:              item.uom || 'pcs',
        qty_ordered:      item.qty_ordered,
        unit_price:       item.unit_price,
        discount_pct:     item.discount_pct,
        tax_pct:          item.tax_pct,
        required_by_date: item.required_by_date || null,
        remarks:          item.remarks || null,
        sort_order:       i,
        product_id:       item.product_id || null,
      })),
    }
  }

  function handleSave() {
    if (state.items.length === 0) {
      toast.error('Add at least one line item')
      return
    }
    const invalid = state.items.find(it => !it.item_name.trim())
    if (invalid) {
      toast.error('All line items require a name')
      return
    }
    createMutation.mutate(buildPayload())
  }

  const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2 })

  return (
    <div className="np-page">

      {/* ── HEADER ── */}
      <div className="np-header">
        <div>
          <div className="np-breadcrumb">
            <Link to="/purchase-orders" className="hover:text-gray-700">Purchase Orders</Link>
            <ChevronRight size={13} />
            <strong>New</strong>
          </div>
          <h2 className="np-page-title">New Purchase Order</h2>
        </div>
        <div className="np-header-actions">
          <button className="lb-action-btn" onClick={() => navigate(-1)}>Cancel</button>
          <button
            className="lb-action-btn lb-action-primary"
            onClick={handleSave}
            disabled={createMutation.isPending}
          >
            <Save size={13} /> Save PO
          </button>
        </div>
      </div>

      {/* ── INFO BAR ── */}
      <div className="np-info-bar">
        <div className="np-info-cell">
          <span className="np-info-label">PO Number</span>
          <strong className="np-info-val np-teal">Auto-generated</strong>
        </div>
        <div className="np-info-divider" />
        <div className="np-info-cell">
          <span className="np-info-label">Order Date</span>
          <input type="date" className="np-date-input" value={state.order_date}
            onChange={e => set('order_date', e.target.value)} />
        </div>
        <div className="np-info-divider" />
        <div className="np-info-cell">
          <span className="np-info-label">Expected Date</span>
          <input type="date" className="np-date-input" value={state.expected_date}
            onChange={e => set('expected_date', e.target.value)} />
        </div>
        <div className="np-info-divider" />
        <div className="np-info-cell">
          <span className="np-info-label">Currency</span>
          <select className="np-date-input" value={state.currency}
            onChange={e => set('currency', e.target.value)}>
            {CURRENCIES.map(c => <option key={c}>{c}</option>)}
          </select>
        </div>
        <div className="np-info-divider" />
        <div className="np-info-cell">
          <span className="np-info-label">Priority</span>
          <select
            className={cn('np-badge-select', PRIORITY_COLORS[state.priority])}
            value={state.priority}
            onChange={e => set('priority', e.target.value as POFormState['priority'])}
          >
            {['Low', 'Medium', 'High', 'Urgent'].map(p => <option key={p}>{p}</option>)}
          </select>
        </div>
        <div className="np-info-divider" />
        <div className="np-info-cell">
          <span className="np-info-label">Status</span>
          <span className="np-badge np-badge-yellow">Draft</span>
        </div>
      </div>

      {/* ── TWO-COLUMN LAYOUT ── */}
      <div className="resp-two-col">

        {/* ── MAIN CONTENT ── */}
        <div className="resp-two-col-main">

          {/* Section 1: Supplier */}
          <div className="np-card">
            <div className="np-card-header">
              <span className="np-section-num">1</span>
              <h3>Supplier</h3>
            </div>
            <div className="np-vendor-grid">
              {/* Supplier search */}
              <div className="np-field" style={{ position: 'relative' }}>
                <label className="np-label">Supplier <span style={{ color: '#ef4444' }}>*</span></label>
                <input
                  className="np-select"
                  placeholder="Search supplier..."
                  value={state.supplier_name || supplierSearch}
                  onFocus={() => { setSupplierOpen(true); setSupplierSearch('') }}
                  onChange={e => {
                    setSupplierSearch(e.target.value)
                    setSupplierOpen(true)
                    if (!e.target.value) {
                      set('supplier_id', '')
                      set('supplier_name', '')
                    }
                  }}
                  onBlur={() => setTimeout(() => setSupplierOpen(false), 150)}
                />
                {supplierOpen && filteredSuppliers.length > 0 && (
                  <div className="np-dropdown">
                    {filteredSuppliers.slice(0, 8).map(s => (
                      <button
                        key={s.id}
                        className="np-dropdown-item"
                        onMouseDown={() => {
                          set('supplier_id', s.id)
                          set('supplier_name', s.name)
                          setSupplierSearch('')
                          setSupplierOpen(false)
                        }}
                      >
                        <span className="np-dropdown-name">{s.name}</span>
                        {s.email && <span className="np-dropdown-sub">{s.email}</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="np-field">
                <label className="np-label">Supplier Reference</label>
                <input className="np-input" placeholder="Vendor's own ref #..."
                  value={state.supplier_reference}
                  onChange={e => set('supplier_reference', e.target.value)} />
              </div>

              <div className="np-field">
                <label className="np-label">Payment Terms</label>
                <select className="np-select" value={state.payment_terms}
                  onChange={e => set('payment_terms', e.target.value)}>
                  <option value="">— select —</option>
                  {PAYMENT_TERMS.map(t => <option key={t}>{t}</option>)}
                </select>
              </div>
            </div>
          </div>

          {/* Section 2: Fulfillment */}
          <div className="np-card">
            <div className="np-card-header">
              <span className="np-section-num">2</span>
              <h3>Fulfillment</h3>
            </div>
            <div className="np-vendor-grid">
              <div className="np-field">
                <label className="np-label">Buyer / Requested By</label>
                <select className="np-select" value={state.buyer_id}
                  onChange={e => set('buyer_id', e.target.value)}>
                  <option value="">— select user —</option>
                  {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </div>

              <div className="np-field">
                <label className="np-label">Department</label>
                <input className="np-input" placeholder="e.g. Production, Design..."
                  value={state.department}
                  onChange={e => set('department', e.target.value)} />
              </div>

              <div className="np-field">
                <label className="np-label">Shipping Method</label>
                <select className="np-select" value={state.shipping_method}
                  onChange={e => set('shipping_method', e.target.value)}>
                  <option value="">— select —</option>
                  {SHIPPING_METHODS.map(m => <option key={m}>{m}</option>)}
                </select>
              </div>

              <div className="np-field np-field-full">
                <label className="np-label">Shipping Address</label>
                <textarea className="np-textarea" rows={2}
                  placeholder="Delivery address..."
                  value={state.shipping_address}
                  onChange={e => set('shipping_address', e.target.value)} />
              </div>

              <div className="np-field np-field-full">
                <label className="np-label">Billing Address</label>
                <textarea className="np-textarea" rows={2}
                  placeholder="Billing address..."
                  value={state.billing_address}
                  onChange={e => set('billing_address', e.target.value)} />
              </div>
            </div>
          </div>

          {/* Section 3: Line Items */}
          <div className="np-card">
            <div className="np-card-header">
              <span className="np-section-num">3</span>
              <h3>Line Items</h3>
            </div>
            <div className="np-table-wrap" style={{ overflowX: 'auto' }}>
              <table className="np-table" style={{ minWidth: '900px' }}>
                <thead>
                  <tr>
                    <th style={{ width: 36 }}>#</th>
                    <th style={{ minWidth: 160 }}>Item Name</th>
                    <th style={{ width: 80 }}>HSN</th>
                    <th style={{ width: 64 }}>UOM</th>
                    <th style={{ width: 72 }}>Qty</th>
                    <th style={{ width: 96 }}>Unit Price</th>
                    <th style={{ width: 64 }}>Disc%</th>
                    <th style={{ width: 64 }}>Tax%</th>
                    <th style={{ width: 96 }}>Line Total</th>
                    <th style={{ width: 110 }}>Req By</th>
                    <th style={{ minWidth: 120 }}>Remarks</th>
                    <th style={{ width: 36 }} />
                  </tr>
                </thead>
                <tbody>
                  {state.items.length === 0 && (
                    <tr>
                      <td colSpan={12} style={{ textAlign: 'center', padding: '20px', color: '#9ca3af', fontSize: '13px' }}>
                        No items yet — click "Add Item" below
                      </td>
                    </tr>
                  )}
                  {state.items.map((item, i) => (
                    <tr key={item.id}>
                      <td className="np-td-num">{i + 1}</td>
                      <td>
                        <input className="np-table-input" placeholder="Item name..."
                          value={item.item_name}
                          onChange={e => dispatch({ type: 'UPDATE_ITEM', id: item.id, patch: { item_name: e.target.value } })} />
                      </td>
                      <td>
                        <input className="np-table-input" placeholder="HSN..."
                          value={item.hsn_code}
                          onChange={e => dispatch({ type: 'UPDATE_ITEM', id: item.id, patch: { hsn_code: e.target.value } })} />
                      </td>
                      <td>
                        <input className="np-table-input" placeholder="pcs"
                          value={item.uom}
                          onChange={e => dispatch({ type: 'UPDATE_ITEM', id: item.id, patch: { uom: e.target.value } })} />
                      </td>
                      <td>
                        <input type="number" className="np-table-input np-num-input" min={1}
                          value={item.qty_ordered}
                          onChange={e => dispatch({ type: 'UPDATE_ITEM', id: item.id, patch: { qty_ordered: +e.target.value || 1 } })} />
                      </td>
                      <td>
                        <input type="number" className="np-table-input np-num-input" min={0} step={0.01}
                          value={item.unit_price}
                          onChange={e => dispatch({ type: 'UPDATE_ITEM', id: item.id, patch: { unit_price: +e.target.value || 0 } })} />
                      </td>
                      <td>
                        <input type="number" className="np-table-input np-num-input" min={0} max={100} step={0.1}
                          value={item.discount_pct}
                          onChange={e => dispatch({ type: 'UPDATE_ITEM', id: item.id, patch: { discount_pct: +e.target.value || 0 } })} />
                      </td>
                      <td>
                        <input type="number" className="np-table-input np-num-input" min={0} max={100} step={0.1}
                          value={item.tax_pct}
                          onChange={e => dispatch({ type: 'UPDATE_ITEM', id: item.id, patch: { tax_pct: +e.target.value || 0 } })} />
                      </td>
                      <td style={{ textAlign: 'right', paddingRight: '8px', fontSize: '13px', fontWeight: 600 }}>
                        {fmt(item.line_total)}
                      </td>
                      <td>
                        <input type="date" className="np-table-input"
                          value={item.required_by_date}
                          onChange={e => dispatch({ type: 'UPDATE_ITEM', id: item.id, patch: { required_by_date: e.target.value } })} />
                      </td>
                      <td>
                        <input className="np-table-input" placeholder="Remarks..."
                          value={item.remarks}
                          onChange={e => dispatch({ type: 'UPDATE_ITEM', id: item.id, patch: { remarks: e.target.value } })} />
                      </td>
                      <td>
                        <button className="np-del-btn" onClick={() => dispatch({ type: 'REMOVE_ITEM', id: item.id })}>
                          <Trash2 size={13} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button className="np-add-row-btn" onClick={() => dispatch({ type: 'ADD_ITEM' })}>
              <Plus size={13} /> Add Item
            </button>
          </div>

          {/* Section 4: Notes & T&C */}
          <div className="np-card">
            <div className="np-card-header">
              <span className="np-section-num">4</span>
              <h3>Notes &amp; Terms</h3>
            </div>
            <div className="np-vendor-grid">
              <div className="np-field np-field-full">
                <label className="np-label">Notes (internal)</label>
                <textarea className="np-textarea" rows={3}
                  placeholder="Internal notes..."
                  value={state.notes}
                  onChange={e => set('notes', e.target.value)} />
              </div>
              <div className="np-field np-field-full">
                <label className="np-label">Terms &amp; Conditions</label>
                <textarea className="np-textarea" rows={3}
                  placeholder="Payment and delivery terms..."
                  value={state.terms_conditions}
                  onChange={e => set('terms_conditions', e.target.value)} />
              </div>
            </div>
          </div>

        </div>

        {/* ── SIDEBAR: Financial Summary ── */}
        <div className="resp-sidebar-col">
          <div className="np-card" style={{ position: 'sticky', top: '80px' }}>
            <div className="np-card-header">
              <h3>Financial Summary</h3>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', padding: '4px 0' }}>
              <SummaryRow label="Subtotal" value={fmt(totals.subtotal)} currency={state.currency} />
              <SummaryRow label="Total Discount" value={`− ${fmt(totals.total_discount)}`} currency={state.currency} dimmed />
              <SummaryRow label="Total Tax" value={fmt(totals.total_tax)} currency={state.currency} />
              <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: '8px' }}>
                <label className="np-label">Freight Charges</label>
                <input type="number" className="np-input" min={0} step={0.01}
                  value={state.freight_charges}
                  onChange={e => set('freight_charges', +e.target.value || 0)} />
              </div>
              <div>
                <label className="np-label">Other Charges</label>
                <input type="number" className="np-input" min={0} step={0.01}
                  value={state.other_charges}
                  onChange={e => set('other_charges', +e.target.value || 0)} />
              </div>
              <div style={{ borderTop: '2px solid #1a1a2e', paddingTop: '10px', marginTop: '2px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '13px', fontWeight: 700, color: '#111' }}>Grand Total</span>
                  <span style={{ fontSize: '16px', fontWeight: 800, color: '#1a1a2e' }}>
                    {state.currency} {fmt(totals.grand_total)}
                  </span>
                </div>
              </div>
            </div>

            <div style={{ marginTop: '20px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <button
                className="lb-action-btn lb-action-primary"
                style={{ width: '100%', justifyContent: 'center' }}
                onClick={handleSave}
                disabled={createMutation.isPending}
              >
                <Save size={13} /> Save PO
              </button>
              <button className="lb-action-btn" style={{ width: '100%', justifyContent: 'center' }}
                onClick={() => navigate(-1)}>
                Cancel
              </button>
            </div>
          </div>
        </div>

      </div>
    </div>
  )
}

// ── Summary row helper ─────────────────────────────────────────────────────────

function SummaryRow({
  label,
  value,
  currency,
  dimmed,
}: {
  label: string
  value: string
  currency: string
  dimmed?: boolean
}) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <span style={{ fontSize: '12px', color: dimmed ? '#9ca3af' : '#6b7280' }}>{label}</span>
      <span style={{ fontSize: '13px', fontWeight: 600, color: dimmed ? '#9ca3af' : '#374151' }}>
        {currency} {value}
      </span>
    </div>
  )
}
