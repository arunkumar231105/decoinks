import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Avatar } from '@mui/material'
import { ChevronDown, Plus, Search, Trash2, Zap } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from '../utils/toast'
import { cn } from '../utils/cn'
import { api } from '../services/api'

// ── Types ─────────────────────────────────────────────────────────────────────

interface ApiSupplier { id: string; name: string }
interface ApiUser     { id: string; name: string }

interface PIRow {
  id:            string
  product_type:  string
  qty:           string
  sizes:         string
  colors:        string
  artwork_count: string
  notes:         string
}

// ── Constants ─────────────────────────────────────────────────────────────────

const SOURCES     = ['Facebook Messenger', 'WhatsApp', 'Instagram', 'Email', 'Walk-in', 'Phone'] as const
const BUYER_TYPES = ['Wholesale', 'Retail', 'Reseller', 'Other']

// ── Helpers ───────────────────────────────────────────────────────────────────

const uid      = () => Math.random().toString(36).slice(2, 8)
const emptyRow = (): PIRow => ({
  id: uid(), product_type: '', qty: '', sizes: '', colors: '', artwork_count: '', notes: '',
})

// ── Component ─────────────────────────────────────────────────────────────────

export function AddLeadPage() {
  const navigate     = useNavigate()
  const queryClient  = useQueryClient()

  // ── Remote data ──
  const { data: apiSuppliers = [] } = useQuery<ApiSupplier[]>({
    queryKey: ['suppliers', 'mini'],
    queryFn:  () => api.get('/suppliers', { params: { limit: 200 } }).then(r => r.data.data.rows),
  })
  const { data: apiUsers = [] } = useQuery<ApiUser[]>({
    queryKey: ['users', 'mini'],
    queryFn:  () => api.get('/users', { params: { limit: 100 } }).then(r => r.data.data.rows),
  })

  // ── Lead meta ──
  const [supplierQuery,      setSupplierQuery]      = useState('')
  const [showCustDrop,       setShowCustDrop]       = useState(false)
  const [selectedSupplierId, setSelectedSupplierId] = useState<string | null>(null)
  const [source,             setSource]             = useState('Email')
  const [selectedAgentId,    setSelectedAgentId]    = useState<string | null>(null)
  const [showAgentDrop,      setShowAgentDrop]      = useState(false)

  // ── Customer info ──
  const [companyName, setCompanyName] = useState('')
  const [email,       setEmail]       = useState('')
  const [phone,       setPhone]       = useState('')
  const [whatsapp,    setWhatsapp]    = useState('')

  // ── Address ──
  const [shippingAddress, setShippingAddress] = useState('')
  const [city,            setCity]            = useState('')
  const [state,           setState]           = useState('')
  const [zip,             setZip]             = useState('')
  const [country,         setCountry]         = useState('')
  const [billingAddress,  setBillingAddress]  = useState('')
  const [sameAsBilling,   setSameAsBilling]   = useState(false)

  // ── Classification + notes ──
  const [buyerType,     setBuyerType]     = useState('')
  const [internalNotes, setInternalNotes] = useState('')

  // ── Product interest ──
  const [piRows, setPiRows] = useState<PIRow[]>([emptyRow()])

  // ── Validation errors ──
  const [errors, setErrors] = useState<Record<string, string>>({})

  // ── Derived ──
  const filteredSuppliers = apiSuppliers.filter(c =>
    c.name.toLowerCase().includes(supplierQuery.toLowerCase()),
  )
  const selectedAgent = apiUsers.find(u => u.id === selectedAgentId)

  // ── PI handlers ──
  const updatePIRow = (id: string, patch: Partial<PIRow>) =>
    setPiRows(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r))
  const removePIRow = (id: string) =>
    setPiRows(prev => prev.filter(r => r.id !== id))

  // ── Same as billing handler ──
  const handleSameAsBilling = (checked: boolean) => {
    setSameAsBilling(checked)
    if (checked) setBillingAddress(shippingAddress)
  }

  // ── Mutation ──
  const createMutation = useMutation({
    mutationFn: (payload: object) => api.post('/leads', payload),
    onSuccess: () => {
      toast.success('Lead created')
      queryClient.invalidateQueries({ queryKey: ['leads'] })
      navigate('/leads')
    },
    onError: (err: any) => toast.error(err.response?.data?.message ?? 'Failed to create lead'),
  })

  // ── Validation ──
  const validate = (): boolean => {
    const errs: Record<string, string> = {}
    if (!supplierQuery.trim()) errs.supplier = 'Supplier name is required'
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errs.email = 'Invalid email format'
    piRows.forEach((r, i) => {
      if (r.qty && (isNaN(+r.qty) || +r.qty < 1))
        errs[`pi_qty_${i}`] = 'Must be a positive number'
      if (r.artwork_count && (isNaN(+r.artwork_count) || +r.artwork_count < 0))
        errs[`pi_ac_${i}`] = 'Must be >= 0'
    })
    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  // ── Submit ──
  const handleSubmit = () => {
    if (!validate()) return

    const productInterest = piRows
      .filter(r => r.product_type || r.qty)
      .map((r, i) => ({
        product_type:  r.product_type  || null,
        qty:           r.qty           ? +r.qty           : null,
        sizes:         r.sizes         || null,
        colors:        r.colors        || null,
        artwork_count: r.artwork_count ? +r.artwork_count : 0,
        notes:         r.notes         || null,
        sort_order:    i,
      }))

    createMutation.mutate({
      supplier_id:      selectedSupplierId ?? undefined,
      supplier_name:    supplierQuery.trim() || undefined,
      source,
      assigned_to:      selectedAgentId  ?? undefined,
      company_name:     companyName      || undefined,
      email:            email            || undefined,
      phone:            phone            || undefined,
      whatsapp:         whatsapp         || undefined,
      shipping_address: shippingAddress  || undefined,
      city:             city             || undefined,
      state:            state            || undefined,
      zip:              zip              || undefined,
      country:          country          || undefined,
      billing_address:  billingAddress   || undefined,
      buyer_type:       buyerType        || undefined,
      internal_notes:   internalNotes    || undefined,
      productInterest:  productInterest.length ? productInterest : undefined,
    })
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="add-lead-page">
      <div className="al-body">

        {/* ════ LEFT PANEL ════ */}
        <aside className="al-left">
          <div className="al-panel">
            <div className="al-panel-header">
              <div className="al-panel-avatar"><Zap size={16} /></div>
              <h3>Add Lead</h3>
            </div>

            <div className="al-fields">

              {/* Lead No */}
              <div className="al-field">
                <label>Lead No.</label>
                <input className="al-input al-input-readonly" value="AUTO-GENERATED" readOnly />
              </div>

              {/* Supplier dropdown (search) */}
              <div className="al-field" style={{ position: 'relative' }}>
                <label>Supplier <span className="al-req">*</span></label>
                {errors.supplier && <span className="al-error">{errors.supplier}</span>}
                <div className={cn('al-combobox', showCustDrop && supplierQuery && 'al-combobox-open')}>
                  <Search size={13} className="al-combobox-icon" />
                  <input
                    placeholder="Search supplier..."
                    value={supplierQuery}
                    onChange={e => {
                      setSupplierQuery(e.target.value)
                      setShowCustDrop(true)
                      if (!e.target.value) setSelectedSupplierId(null)
                    }}
                    onFocus={() => setShowCustDrop(true)}
                    onBlur={() => setTimeout(() => setShowCustDrop(false), 150)}
                  />
                </div>
                {showCustDrop && filteredSuppliers.length > 0 && (
                  <div className="al-dropdown">
                    {filteredSuppliers.map(c => (
                      <button
                        key={c.id}
                        className="al-dropdown-item"
                        onMouseDown={e => e.preventDefault()}
                        onClick={() => {
                          setSupplierQuery(c.name)
                          setSelectedSupplierId(c.id)
                          setShowCustDrop(false)
                        }}
                      >
                        {c.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Source */}
              <div className="al-field">
                <label>Source Channel <span className="al-req">*</span></label>
                <select
                  className="al-input"
                  value={source}
                  onChange={e => setSource(e.target.value)}
                >
                  {SOURCES.map(s => <option key={s}>{s}</option>)}
                </select>
              </div>

              {/* Sales Agent */}
              <div className="al-field" style={{ position: 'relative' }}>
                <label>Sales Agent</label>
                <button
                  className="al-agent-select"
                  onClick={() => setShowAgentDrop(v => !v)}
                >
                  <Avatar sx={{ width: 22, height: 22, fontSize: 9, bgcolor: '#0D9488' }}>
                    {selectedAgent?.name?.charAt(0) ?? '?'}
                  </Avatar>
                  <span className="al-agent-name">
                    {selectedAgent?.name ?? 'Select agent'}
                  </span>
                  <ChevronDown size={13} className="al-agent-chevron" />
                </button>
                {showAgentDrop && (
                  <div className="al-dropdown al-agent-dropdown">
                    {apiUsers.map(a => (
                      <button
                        key={a.id}
                        className={cn(
                          'al-dropdown-item al-dropdown-agent',
                          selectedAgentId === a.id && 'al-dropdown-item-active',
                        )}
                        onClick={() => { setSelectedAgentId(a.id); setShowAgentDrop(false) }}
                      >
                        <Avatar sx={{ width: 22, height: 22, fontSize: 9, bgcolor: '#0D9488' }}>
                          {a.name.charAt(0)}
                        </Avatar>
                        {a.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>

            </div>
          </div>
        </aside>

        {/* ════ MAIN AREA ════ */}
        <main className="al-center">

          {/* ── Section 1: Customer Info ── */}
          <div className="al-panel al-section">
            <div className="al-section-header">
              <span className="al-section-num">1</span>
              <h4>Customer Info</h4>
            </div>
            <div className="al-grid-2">
              <div className="al-field">
                <label>Company Name</label>
                <input
                  className="al-input"
                  value={companyName}
                  onChange={e => setCompanyName(e.target.value)}
                  placeholder="e.g. Acme Corp"
                />
              </div>
              <div className="al-field">
                <label>Email</label>
                {errors.email && <span className="al-error">{errors.email}</span>}
                <input
                  className="al-input"
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="orders@example.com"
                />
              </div>
              <div className="al-field">
                <label>Phone</label>
                <input
                  className="al-input"
                  value={phone}
                  onChange={e => setPhone(e.target.value)}
                  placeholder="+1-555-0000"
                />
              </div>
              <div className="al-field">
                <label>WhatsApp</label>
                <input
                  className="al-input"
                  value={whatsapp}
                  onChange={e => setWhatsapp(e.target.value)}
                  placeholder="+1-555-0000"
                />
              </div>
            </div>
          </div>

          {/* ── Section 2: Address ── */}
          <div className="al-panel al-section">
            <div className="al-section-header">
              <span className="al-section-num">2</span>
              <h4>Address</h4>
            </div>
            <div className="al-grid-2" style={{ marginBottom: 10 }}>
              <div className="al-field" style={{ gridColumn: '1 / -1' }}>
                <label>Shipping Address</label>
                <textarea
                  className="al-textarea"
                  rows={2}
                  value={shippingAddress}
                  onChange={e => {
                    setShippingAddress(e.target.value)
                    if (sameAsBilling) setBillingAddress(e.target.value)
                  }}
                  placeholder="Street address..."
                />
              </div>
            </div>
            <div className="al-grid-3">
              <div className="al-field">
                <label>City</label>
                <input className="al-input" value={city} onChange={e => setCity(e.target.value)} placeholder="Dallas" />
              </div>
              <div className="al-field">
                <label>State</label>
                <input className="al-input" value={state} onChange={e => setState(e.target.value)} placeholder="TX" />
              </div>
              <div className="al-field">
                <label>ZIP</label>
                <input className="al-input" value={zip} onChange={e => setZip(e.target.value)} placeholder="75201" />
              </div>
              <div className="al-field">
                <label>Country</label>
                <input className="al-input" value={country} onChange={e => setCountry(e.target.value)} placeholder="USA" />
              </div>
            </div>
            <div className="al-grid-2" style={{ marginTop: 10 }}>
              <div className="al-field" style={{ gridColumn: '1 / -1' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <input
                    type="checkbox"
                    checked={sameAsBilling}
                    onChange={e => handleSameAsBilling(e.target.checked)}
                  />
                  Same as Shipping Address
                </label>
                <label>Billing Address</label>
                <textarea
                  className="al-textarea"
                  rows={2}
                  value={billingAddress}
                  onChange={e => setBillingAddress(e.target.value)}
                  placeholder="Street address (if different)..."
                  disabled={sameAsBilling}
                />
              </div>
            </div>
          </div>

          {/* ── Section 3: Classification & Notes ── */}
          <div className="al-panel al-section">
            <div className="al-section-header">
              <span className="al-section-num">3</span>
              <h4>Classification &amp; Notes</h4>
            </div>
            <div className="al-grid-2">
              <div className="al-field">
                <label>Buyer Type</label>
                <select
                  className="al-input"
                  value={buyerType}
                  onChange={e => setBuyerType(e.target.value)}
                >
                  <option value="">-- Select --</option>
                  {BUYER_TYPES.map(t => <option key={t}>{t}</option>)}
                </select>
              </div>
              <div className="al-field" style={{ gridColumn: '1 / -1' }}>
                <div className="al-label-row">
                  <label>Internal Notes <span className="al-optional">(optional)</span></label>
                  <span className="al-char-count">{internalNotes.length}/1000</span>
                </div>
                <textarea
                  className="al-textarea"
                  rows={3}
                  maxLength={1000}
                  value={internalNotes}
                  onChange={e => setInternalNotes(e.target.value)}
                  placeholder="Private notes visible only to the team..."
                />
              </div>
            </div>
          </div>

          {/* ── Section 4: Product Interest ── */}
          <div className="al-panel al-section">
            <div className="al-section-header">
              <span className="al-section-num">4</span>
              <h4>Product Interest</h4>
            </div>
            <div className="al-table-wrap">
              <table className="al-table">
                <thead>
                  <tr>
                    <th className="al-th-sno">S.No</th>
                    <th>Product Type</th>
                    <th>Qty</th>
                    <th>Sizes</th>
                    <th>Colors</th>
                    <th>Artwork Count</th>
                    <th>Notes</th>
                    <th className="al-th-action"></th>
                  </tr>
                </thead>
                <tbody>
                  {piRows.map((row, i) => (
                    <tr key={row.id}>
                      <td className="al-td-sno">{i + 1}</td>
                      <td>
                        <input
                          className="al-table-input"
                          value={row.product_type}
                          onChange={e => updatePIRow(row.id, { product_type: e.target.value })}
                          placeholder="T-Shirt, Hoodie..."
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          className="al-table-input"
                          min={1}
                          value={row.qty}
                          onChange={e => updatePIRow(row.id, { qty: e.target.value })}
                          placeholder="100"
                        />
                        {errors[`pi_qty_${i}`] && (
                          <span className="al-error">{errors[`pi_qty_${i}`]}</span>
                        )}
                      </td>
                      <td>
                        <input
                          className="al-table-input"
                          value={row.sizes}
                          onChange={e => updatePIRow(row.id, { sizes: e.target.value })}
                          placeholder="S,M,L,XL"
                        />
                      </td>
                      <td>
                        <input
                          className="al-table-input"
                          value={row.colors}
                          onChange={e => updatePIRow(row.id, { colors: e.target.value })}
                          placeholder="Black,White"
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          className="al-table-input"
                          min={0}
                          value={row.artwork_count}
                          onChange={e => updatePIRow(row.id, { artwork_count: e.target.value })}
                          placeholder="0"
                        />
                        {errors[`pi_ac_${i}`] && (
                          <span className="al-error">{errors[`pi_ac_${i}`]}</span>
                        )}
                      </td>
                      <td>
                        <input
                          className="al-table-input"
                          value={row.notes}
                          onChange={e => updatePIRow(row.id, { notes: e.target.value })}
                          placeholder="Front print only..."
                        />
                      </td>
                      <td>
                        <button
                          className="lb-icon-btn al-row-delete"
                          onClick={() => removePIRow(row.id)}
                          disabled={piRows.length === 1}
                          title="Remove row"
                        >
                          <Trash2 size={13} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button
              className="al-add-row-btn"
              onClick={() => setPiRows(prev => [...prev, emptyRow()])}
            >
              <Plus size={13} /> Add Row
            </button>
          </div>

        </main>
      </div>

      {/* ════ BOTTOM BAR ════ */}
      <div className="al-bottom-bar">
        <div className="al-bottom-right" style={{ marginLeft: 'auto' }}>
          <button className="lb-action-btn" onClick={() => navigate(-1)}>Cancel</button>
          <button
            className="lb-action-btn lb-action-primary al-create-btn"
            onClick={handleSubmit}
            disabled={createMutation.isPending}
          >
            {createMutation.isPending ? 'Creating...' : 'Create Lead'}
          </button>
        </div>
      </div>

    </div>
  )
}
