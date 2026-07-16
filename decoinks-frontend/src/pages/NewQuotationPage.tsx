import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, ChevronRight, Eye, FileText, Image, MapPin, Plus, Save, Search, Shirt, Trash2, Upload, UserRound, X } from 'lucide-react'
import { api } from '../services/api'
import { getApiError } from '../utils/apiError'
import toast from '../utils/toast'

type QuoteType = 'dtf' | 'apparel'
type Line = {
  key: string
  product_id: string
  description: string
  artwork_id: string
  front_artwork_id: string
  back_artwork_id: string
  brand: string
  model: string
  color: string
  sizes: string
  artwork_width: number
  artwork_height: number
  artwork_count: number
  qty: number
  unit_price: number
  artwork_url: string
  artwork_label: string
  front_artwork_url: string
  front_artwork_label: string
  back_artwork_url: string
  back_artwork_label: string
}

const blankLine = (): Line => ({
  key: crypto.randomUUID(), product_id: '', description: '', artwork_id: '',
  front_artwork_id: '', back_artwork_id: '', brand: '', model: '', color: '',
  sizes: '', artwork_width: 0, artwork_height: 0, artwork_count: 1, qty: 1, unit_price: 0,
  artwork_url: '', artwork_label: '', front_artwork_url: '', front_artwork_label: '', back_artwork_url: '', back_artwork_label: '',
})

const addressText = (address: any) => {
  if (!address) return ''
  return [address.line1, address.line2, [address.city, address.state, address.zipcode].filter(Boolean).join(', '), address.country]
    .filter(Boolean).join('\n')
}

function useDebounced(value: string, delay = 250) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => { const timer = window.setTimeout(() => setDebounced(value), delay); return () => window.clearTimeout(timer) }, [value, delay])
  return debounced
}

function SearchPicker({ value, label, placeholder, options, loading, optional, onSearch, onChange }: {
  value: string; label: string; placeholder: string; options: any[]; loading?: boolean; optional?: boolean
  onSearch: (value: string) => void; onChange: (value: string, option?: any) => void
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  return <div className="nq-search-picker">
    <div className="nq-search-input-wrap">
      <Search size={15}/>
      <input className="al-input" value={open ? search : label} placeholder={placeholder}
        onFocus={() => { setOpen(true); setSearch(''); onSearch('') }}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        onChange={e => { setSearch(e.target.value); onSearch(e.target.value); setOpen(true) }}/>
      {value ? <button type="button" className="nq-search-clear" title="Clear selection" onMouseDown={e => e.preventDefault()} onClick={() => onChange('')}><X size={14}/></button> : <ChevronDown size={15}/>}
    </div>
    {open && <div className="nq-search-menu">
      {optional && <button type="button" onMouseDown={e => e.preventDefault()} onClick={() => { onChange(''); setOpen(false) }}>No linked lead</button>}
      {loading && <div className="nq-search-empty">Searching…</div>}
      {!loading && options.map(option => <button type="button" key={option.id} onMouseDown={e => e.preventDefault()} onClick={() => { onChange(option.id, option); setOpen(false) }}><strong>{option.primary}</strong><span>{option.secondary}</span></button>)}
      {!loading && options.length === 0 && <div className="nq-search-empty">No matching record found</div>}
    </div>}
  </div>
}

function ArtworkUpload({ label, artworkLabel, artworkUrl, uploading, onUpload, onClear }: {
  label: string; artworkLabel: string; artworkUrl: string; uploading: boolean
  onUpload: (file: File) => void; onClear: () => void
}) {
  const inputId = `art-${crypto.randomUUID()}`
  return <div className="nq-art-upload">
    {artworkLabel ? <div className="nq-art-selected">
      {artworkUrl && !/\.pdf($|\?)/i.test(artworkUrl) ? <img src={artworkUrl} alt={artworkLabel}/> : <FileText size={24}/>}
      <span title={artworkLabel}>{artworkLabel}</span><button type="button" title="Remove" onClick={onClear}><X size={13}/></button>
    </div> : <label htmlFor={inputId} className={uploading ? 'disabled' : ''}><Upload size={15}/><span>{uploading ? 'Uploading…' : label}</span></label>}
    <input id={inputId} type="file" accept="image/*,.pdf,.ai,.eps,.svg" disabled={uploading} onChange={e => { const file = e.target.files?.[0]; if (file) onUpload(file); e.currentTarget.value = '' }}/>
  </div>
}

export function NewQuotationPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [form, setForm] = useState<any>({
    customer_id: '', lead_id: '', order_type: 'dtf' as QuoteType, valid_until: '', status: 'Draft', currency: 'USD',
    payment_terms: 'Net 15', payment_method: 'Bank Transfer', discount_type: 'fixed', discount_value: 0,
    tax_percentage: 0, shipping_amount: 0, estimated_shipping_cost: 0, rush_services: 0,
    notes: '', internal_notes: '',
  })
  const [lines, setLines] = useState<Line[]>([blankLine()])
  const [customerSearch, setCustomerSearch] = useState('')
  const [leadSearch, setLeadSearch] = useState('')
  const [uploading, setUploading] = useState<Record<string, boolean>>({})
  const debouncedCustomerSearch = useDebounced(customerSearch)
  const debouncedLeadSearch = useDebounced(leadSearch)

  const { data: customers = [], isFetching: customersLoading } = useQuery<any[]>({
    queryKey: ['quote-customers', debouncedCustomerSearch],
    queryFn: () => api.get('/customers', { params: { limit: 30, search: debouncedCustomerSearch } }).then(r => r.data.data.rows),
  })
  const { data: customerDetail, isFetching: customerLoading } = useQuery<any>({
    queryKey: ['quote-customer', form.customer_id],
    queryFn: () => api.get(`/customers/${form.customer_id}`).then(r => r.data.data),
    enabled: !!form.customer_id,
  })
  const { data: leads = [], isFetching: leadsLoading } = useQuery<any[]>({
    queryKey: ['quote-leads', debouncedLeadSearch],
    queryFn: () => api.get('/leads/list', { params: { limit: 30, search: debouncedLeadSearch } }).then(r => r.data.data.rows),
  })
  const { data: selectedLead } = useQuery<any>({
    queryKey: ['quote-lead', form.lead_id],
    queryFn: () => api.get(`/leads/${form.lead_id}`).then(r => r.data.data),
    enabled: !!form.lead_id,
  })
  const { data: existing } = useQuery<any>({
    queryKey: ['quotation', id],
    queryFn: () => api.get(`/quotations/${id}`).then(r => r.data.data ?? r.data),
    enabled: !!id,
  })

  useEffect(() => {
    if (!existing) return
    setForm((current: any) => ({
      ...current, ...existing, customer_id: existing.customer_id ?? '', lead_id: existing.lead_id ?? '',
      order_type: existing.order_type === 'apparel' ? 'apparel' : 'dtf',
      discount_type: existing.discount_type ?? 'fixed',
      discount_value: Number(existing.discount_value ?? existing.discount_pct ?? 0),
      tax_percentage: Number(existing.tax_percentage ?? existing.tax_pct ?? 0),
      shipping_amount: Number(existing.shipping_amount ?? 0),
      estimated_shipping_cost: Number(existing.estimated_shipping ?? 0),
      rush_services: Number(existing.rush_services ?? 0),
    }))
    const saved = existing.items ?? []
    setLines(saved.length ? saved.map((x: any, i: number) => ({
      key: x.id ?? String(i), product_id: x.product_id ?? '', description: x.description ?? '', artwork_id: x.artwork_id ?? '',
      front_artwork_id: x.front_artwork_id ?? '', back_artwork_id: x.back_artwork_id ?? '', brand: x.brand ?? '', model: x.model ?? '',
      color: x.colors ?? '', sizes: x.sizes ?? '', artwork_width: Number(x.artwork_width ?? 0), artwork_height: Number(x.artwork_height ?? 0),
      artwork_count: Number(x.artwork_count) || 1,
      qty: Number(x.qty) || 1, unit_price: Number(x.unit_price) || 0,
      artwork_url: x.artwork_file_url ?? x.artwork_image ?? '', artwork_label: [x.artwork_no, x.artwork_name].filter(Boolean).join(' · '),
      front_artwork_url: x.front_artwork_url ?? x.front_image ?? '', front_artwork_label: [x.front_artwork_no, x.front_artwork_name].filter(Boolean).join(' · '),
      back_artwork_url: x.back_artwork_url ?? x.back_image ?? '', back_artwork_label: [x.back_artwork_no, x.back_artwork_name].filter(Boolean).join(' · '),
    })) : [blankLine()])
  }, [existing])

  useEffect(() => {
    if (!customerDetail || existing) return
    setForm((current: any) => ({ ...current, lead_id: current.lead_id || customerDetail.lead_id || '' }))
  }, [customerDetail, existing])

  const selectedCustomer = customerDetail
  const shipping = customerDetail?.addresses?.find((a: any) => a.address_type === 'shipping' && a.is_default)
    ?? customerDetail?.addresses?.find((a: any) => a.address_type === 'shipping')
  const billing = customerDetail?.addresses?.find((a: any) => a.address_type === 'billing' && a.is_default)
    ?? customerDetail?.addresses?.find((a: any) => a.address_type === 'billing')
  const legacyShipping = [selectedCustomer?.address_line1, selectedCustomer?.city, selectedCustomer?.state, selectedCustomer?.zip, selectedCustomer?.country].filter(Boolean).join(', ')
  const shippingSnapshot = addressText(shipping) || legacyShipping
  const billingSnapshot = addressText(billing) || selectedCustomer?.billing_address || shippingSnapshot

  const amounts = useMemo(() => {
    const items = lines.reduce((sum, line) => sum + (Number(line.qty) || 0) * (Number(line.unit_price) || 0), 0)
    const subtotal = items + (Number(form.shipping_amount) || 0) + (Number(form.rush_services) || 0)
    const rawDiscount = form.discount_type === 'fixed'
      ? Number(form.discount_value) || 0
      : subtotal * (Number(form.discount_value) || 0) / 100
    const discount = Math.min(Math.max(rawDiscount, 0), subtotal)
    const tax = (subtotal - discount) * (Number(form.tax_percentage) || 0) / 100
    return { items, subtotal, discount, tax, total: subtotal - discount + tax }
  }, [lines, form.shipping_amount, form.rush_services, form.discount_type, form.discount_value, form.tax_percentage])

  const money = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
  const updateLine = (key: string, patch: Partial<Line>) => setLines(value => value.map(line => line.key === key ? { ...line, ...patch } : line))
  const uploadArtwork = async (lineKey: string, position: 'artwork' | 'front' | 'back', file: File) => {
    const uploadKey = `${lineKey}:${position}`
    setUploading(value => ({ ...value, [uploadKey]: true }))
    try {
      const data = new FormData()
      data.append('file', file)
      data.append('name', file.name.replace(/\.[^.]+$/, ''))
      data.append('status', 'Draft')
      data.append('artwork_type', 'custom')
      if (form.lead_id) data.append('lead_id', form.lead_id)
      const response = await api.post('/artworks', data, { headers: { 'Content-Type': 'multipart/form-data' } })
      const artwork = response.data.data ?? response.data
      const common = { [`${position}_artwork_url`]: artwork.file_url ?? '', [`${position}_artwork_label`]: `${artwork.artwork_no} · ${artwork.name}` }
      if (position === 'artwork') updateLine(lineKey, { artwork_id: artwork.id, artwork_url: artwork.file_url ?? '', artwork_label: `${artwork.artwork_no} · ${artwork.name}`, artwork_width: Number(artwork.width_inches ?? 0), artwork_height: Number(artwork.height_inches ?? 0) })
      else updateLine(lineKey, { ...common, [`${position}_artwork_id`]: artwork.id } as Partial<Line>)
      qc.invalidateQueries({ queryKey: ['artworks'] })
      toast.success(`${position === 'artwork' ? 'Artwork' : `${position[0].toUpperCase()}${position.slice(1)} artwork`} uploaded`)
    } catch (error: any) {
      toast.error(error.response?.data?.message ?? error.response?.data?.error ?? 'Artwork upload failed')
    } finally {
      setUploading(value => ({ ...value, [uploadKey]: false }))
    }
  }
  const changeType = (type: QuoteType) => {
    if (form.order_type === type) return
    setForm((value: any) => ({ ...value, order_type: type }))
    setLines([blankLine()])
  }
  const isLineReady = (line: Line) => form.order_type === 'dtf'
    ? !!line.description && Number(line.qty) > 0
    : !!line.description && !!line.color && !!line.sizes && Number(line.qty) > 0

  const mutation = useMutation({
    mutationFn: async ({ preview }: { preview: boolean }) => {
      const items = lines.filter(isLineReady).map(({ key, color, ...line }) => {
        return {
          ...line,
          product_id: line.product_id || null,
          artwork_id: line.artwork_id || null,
          front_artwork_id: line.front_artwork_id || null,
          back_artwork_id: line.back_artwork_id || null,
          artwork_image: line.artwork_url || null,
          front_image: line.front_artwork_url || null,
          back_image: line.back_artwork_url || null,
          product_type: form.order_type === 'dtf' ? 'DTF Transfers' : 'Custom Apparel',
          decoration_method: 'DTF', colors: color || null,
          artwork_count: form.order_type === 'dtf' ? line.artwork_count : Number(!!line.front_artwork_id) + Number(!!line.back_artwork_id),
          qty: Number(line.qty), unit_price: Number(line.unit_price), unit: 'pcs',
        }
      })
      const payload = {
        ...form,
        // Search controls use an empty string for "not selected". The API's
        // optional UUID fields correctly use null, so normalize them here.
        lead_id: form.lead_id || null,
        customer_id: form.customer_id || null,
        supplier_id: form.supplier_id || null,
        sales_agent_id: form.sales_agent_id || null,
        valid_until: form.valid_until || null,
        due_date: form.due_date || null,
        customer_name: selectedCustomer?.name ?? existing?.customer_name ?? null,
        company_name: selectedCustomer?.company_name ?? selectedCustomer?.company ?? null,
        billing_email: selectedCustomer?.email ?? null,
        contact_number: selectedCustomer?.mobile_number ?? selectedCustomer?.phone ?? selectedCustomer?.company_phone_number ?? null,
        whatsapp: selectedCustomer?.whatsapp ?? null,
        shipping_address: shippingSnapshot || null,
        billing_address: billingSnapshot || null,
        shipping_city: shipping?.city ?? selectedCustomer?.city ?? null,
        shipping_state: shipping?.state ?? selectedCustomer?.state ?? null,
        shipping_country: shipping?.country ?? selectedCustomer?.country ?? null,
        zip_code: shipping?.zipcode ?? selectedCustomer?.zip ?? null,
        discount_value: Number(form.discount_value) || 0,
        tax_percentage: Number(form.tax_percentage) || 0,
        shipping_amount: Number(form.shipping_amount) || 0,
        rush_services: Number(form.rush_services) || 0,
        estimated_shipping_cost: Number(form.estimated_shipping_cost) || 0,
        discount_pct: form.discount_type === 'percentage' ? Number(form.discount_value) || 0 : 0,
        items,
      }
      const response = id ? await api.put(`/quotations/${id}`, payload) : await api.post('/quotations', payload)
      return { quote: response.data.data ?? response.data, preview }
    },
    onSuccess: ({ quote, preview }) => {
      qc.invalidateQueries({ queryKey: ['quotations'] })
      toast.success(id ? 'Quotation updated' : 'Quotation created')
      const savedId = quote.id ?? id
      if (!savedId) throw new Error('Saved quotation id was not returned')
      navigate(preview ? `/quotes/${savedId}/print` : '/quotes')
    },
    onError: (error: unknown) => toast.error(getApiError(error)),
  })

  const saveDisabled = mutation.isPending || !form.customer_id || !lines.some(isLineReady)

  return <div className="nq-page nq-redesign">
    <header className="ncust-header">
      <div><div className="ns-breadcrumb"><span onClick={() => navigate('/quotations')}>Quotations</span><ChevronRight size={13}/><strong>{id ? 'Edit' : 'New'} Quotation</strong></div><h2 className="ns-page-title">{id ? 'Edit' : 'New'} Quotation</h2></div>
      <div className="ns-header-actions"><button className="lb-action-btn" onClick={() => navigate(-1)}>Cancel</button><button className="lb-action-btn" disabled={saveDisabled} onClick={() => mutation.mutate({ preview: false })}><Save size={15}/> {mutation.isPending ? 'Saving…' : 'Save Draft'}</button><button className="lb-action-btn lb-action-primary" disabled={saveDisabled} onClick={() => mutation.mutate({ preview: true })}><Eye size={15}/> Save & Preview</button></div>
    </header>

    <section className="nq-card nq-type-card">
      <div className="nq-card-heading"><FileText size={17}/><h3>Quotation Type</h3><span className="nq-muted">Fields and preview change automatically by business type.</span></div>
      <div className="nq-type-grid">
        <button type="button" className={`nq-type-choice ${form.order_type === 'dtf' ? 'active' : ''}`} onClick={() => changeType('dtf')}><Image size={24}/><span><strong>DTF Transfers</strong><small>Artwork, size, quantity and rate per transfer</small></span></button>
        <button type="button" className={`nq-type-choice ${form.order_type === 'apparel' ? 'active' : ''}`} onClick={() => changeType('apparel')}><Shirt size={24}/><span><strong>Custom Apparel</strong><small>Garment, color, size ratio and front/back artwork</small></span></button>
      </div>
    </section>

    <section className="nq-card">
      <div className="nq-card-heading"><UserRound size={17}/><h3>Customer & Quotation Details</h3></div>
      <div className="nq-detail-grid">
        <div className="al-field"><label>Customer *</label><SearchPicker value={form.customer_id} label={selectedCustomer ? `${selectedCustomer.customer_no ?? selectedCustomer.customer_number} · ${selectedCustomer.name}` : ''} placeholder="Search customer by name…" loading={customersLoading} onSearch={setCustomerSearch} onChange={customer_id => setForm({ ...form, customer_id })} options={customers.map(c => ({ ...c, primary: c.name, secondary: [c.customer_no ?? c.customer_number, c.company_name, c.email].filter(Boolean).join(' · ') }))}/></div>
        <div className="al-field"><label>Originating Lead</label><SearchPicker value={form.lead_id} label={selectedLead ? `${selectedLead.lead_number} · ${selectedLead.customer_name ?? selectedLead.supplier_name ?? ''}` : ''} placeholder="Search lead by name or number…" loading={leadsLoading} optional onSearch={setLeadSearch} onChange={lead_id => setForm({ ...form, lead_id })} options={leads.map(l => ({ ...l, primary: l.customer_name ?? l.supplier_name ?? 'Unnamed lead', secondary: l.lead_number }))}/></div>
        <div className="al-field"><label>Valid Until</label><input className="al-input" type="date" value={form.valid_until ?? ''} onChange={e => setForm({ ...form, valid_until: e.target.value })}/></div>
        <div className="al-field"><label>Payment Terms</label><select className="al-input" value={form.payment_terms} onChange={e => setForm({ ...form, payment_terms: e.target.value })}>{['Due on Receipt', 'Net 7', 'Net 15', 'Net 30'].map(x => <option key={x}>{x}</option>)}</select></div>
      </div>
      {form.customer_id && <div className="nq-customer-preview">
        <div><UserRound size={18}/><span><small>Customer</small><strong>{customerLoading ? 'Loading…' : selectedCustomer?.name || '—'}</strong><em>{selectedCustomer?.company_name ?? selectedCustomer?.company ?? ''}</em></span></div>
        <div><FileText size={18}/><span><small>Contact</small><strong>{selectedCustomer?.email || 'No email saved'}</strong><em>{selectedCustomer?.mobile_number ?? selectedCustomer?.phone ?? selectedCustomer?.company_phone_number ?? 'No phone saved'}</em></span></div>
        <div><MapPin size={18}/><span><small>Shipping Address</small><strong className="nq-address-text">{shippingSnapshot || 'No shipping address saved'}</strong></span></div>
      </div>}
    </section>

    <section className="nq-card">
      <div className="nq-card-heading"><h3>{form.order_type === 'dtf' ? 'DTF Transfer Items' : 'Custom Apparel Items'}</h3><span className="nq-muted">Amount is calculated automatically: Quantity × Rate.</span><button className="lb-action-btn" style={{ marginLeft: 'auto' }} onClick={() => setLines(value => [...value, blankLine()])}><Plus size={14}/> Add item</button></div>
      <div className="nq-table-wrap"><table className="nq-table nq-quote-entry"><thead>{form.order_type === 'dtf' ? <tr><th>#</th><th>Description *</th><th>Artwork *</th><th>Width (in)</th><th>Height (in)</th><th>Qty *</th><th>Rate / piece ($) *</th><th>Amount</th><th/></tr> : <tr><th>#</th><th>Item Description *</th><th>Brand</th><th>Model</th><th>Color *</th><th>Size Ratio *</th><th>Qty *</th><th>Front Artwork</th><th>Back Artwork</th><th>Unit Price ($) *</th><th>Amount</th><th/></tr>}</thead>
        <tbody>{lines.map((line, index) => <tr key={line.key}>
          <td className="nq-row-number">{index + 1}</td>
          <td><input className="al-input" value={line.description} onChange={e => updateLine(line.key, { description: e.target.value })} placeholder={form.order_type === 'dtf' ? 'Premium Quality DTF Transfer' : 'T-Shirt (Premium)'}/></td>
          {form.order_type === 'dtf' ? <>
            <td><ArtworkUpload label="Upload artwork" artworkLabel={line.artwork_label} artworkUrl={line.artwork_url} uploading={!!uploading[`${line.key}:artwork`]} onUpload={file => uploadArtwork(line.key, 'artwork', file)} onClear={() => updateLine(line.key, { artwork_id: '', artwork_url: '', artwork_label: '' })}/></td>
            <td><input className="al-input nq-number" type="number" min="0" step="0.01" value={line.artwork_width || ''} onChange={e => updateLine(line.key, { artwork_width: +e.target.value })}/></td>
            <td><input className="al-input nq-number" type="number" min="0" step="0.01" value={line.artwork_height || ''} onChange={e => updateLine(line.key, { artwork_height: +e.target.value })}/></td>
          </> : <>
            <td><input className="al-input" value={line.brand} onChange={e => updateLine(line.key, { brand: e.target.value })} placeholder="Gildan"/></td>
            <td><input className="al-input" value={line.model} onChange={e => updateLine(line.key, { model: e.target.value })} placeholder="18500"/></td>
            <td><input className="al-input" value={line.color} onChange={e => updateLine(line.key, { color: e.target.value })} placeholder="Black"/></td>
            <td><input className="al-input" value={line.sizes} onChange={e => updateLine(line.key, { sizes: e.target.value })} placeholder="S:10, M:20, L:15, XL:5"/></td>
          </>}
          <td><input className="al-input nq-number" type="number" min="1" step="1" value={line.qty} onChange={e => updateLine(line.key, { qty: +e.target.value })}/></td>
          {form.order_type === 'apparel' && <><td><ArtworkUpload label="Upload front" artworkLabel={line.front_artwork_label} artworkUrl={line.front_artwork_url} uploading={!!uploading[`${line.key}:front`]} onUpload={file => uploadArtwork(line.key, 'front', file)} onClear={() => updateLine(line.key, { front_artwork_id: '', front_artwork_url: '', front_artwork_label: '' })}/></td><td><ArtworkUpload label="Upload back" artworkLabel={line.back_artwork_label} artworkUrl={line.back_artwork_url} uploading={!!uploading[`${line.key}:back`]} onUpload={file => uploadArtwork(line.key, 'back', file)} onClear={() => updateLine(line.key, { back_artwork_id: '', back_artwork_url: '', back_artwork_label: '' })}/></td></>}
          <td><div className="nq-money-input"><span>$</span><input className="al-input nq-number" type="number" min="0" step="0.01" value={line.unit_price || ''} onChange={e => updateLine(line.key, { unit_price: +e.target.value })}/></div></td>
          <td><strong className="nq-line-amount">{money(line.qty * line.unit_price)}</strong><small className="nq-formula">{line.qty} × {money(line.unit_price)}</small></td>
          <td><button className="nq-icon-btn" disabled={lines.length === 1} onClick={() => setLines(value => value.filter(item => item.key !== line.key))}><Trash2 size={15}/></button></td>
        </tr>)}</tbody></table></div>
    </section>

    <div className="nq-bottom-layout"><section className="nq-card"><div className="nq-card-heading"><h3>Notes</h3></div><div className="al-field"><label>Customer-facing Notes</label><textarea className="al-textarea" rows={5} maxLength={500} value={form.notes ?? ''} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="Add quotation notes…"/></div><div className="al-field"><label>Internal Notes</label><textarea className="al-textarea" rows={3} value={form.internal_notes ?? ''} onChange={e => setForm({ ...form, internal_notes: e.target.value })}/></div></section>
      <section className="nq-card nq-financial"><div className="nq-card-heading"><h3>Pricing Summary</h3></div><div className="nq-fin-grid"><div className="al-field"><label>Rush Services ($)</label><input className="al-input" type="number" min="0" step="0.01" value={form.rush_services} onChange={e => setForm({ ...form, rush_services: +e.target.value })}/></div><div className="al-field"><label>Estimated Shipping ($)</label><input className="al-input" type="number" min="0" step="0.01" value={form.shipping_amount} onChange={e => setForm({ ...form, shipping_amount: +e.target.value })}/></div><div className="al-field"><label>Discount Type</label><select className="al-input" value={form.discount_type} onChange={e => setForm({ ...form, discount_type: e.target.value })}><option value="fixed">Fixed amount</option><option value="percentage">Percentage</option></select></div><div className="al-field"><label>Discount {form.discount_type === 'fixed' ? '($)' : '(%)'}</label><input className="al-input" type="number" min="0" step="0.01" value={form.discount_value} onChange={e => setForm({ ...form, discount_value: +e.target.value })}/></div><div className="al-field"><label>Tax (%)</label><input className="al-input" type="number" min="0" max="100" step="0.01" value={form.tax_percentage} onChange={e => setForm({ ...form, tax_percentage: +e.target.value })}/></div><div className="al-field"><label>Payment Method</label><select className="al-input" value={form.payment_method} onChange={e => setForm({ ...form, payment_method: e.target.value })}>{['Bank Transfer', 'Zelle', 'PayPal', 'Credit / Debit Card', 'Cash'].map(x => <option key={x}>{x}</option>)}</select></div></div>
        <div className="nq-summary"><span>Items Total <b>{money(amounts.items)}</b></span><span>Rush Services <b>{money(Number(form.rush_services) || 0)}</b></span><span>Shipping <b>{money(Number(form.shipping_amount) || 0)}</b></span><span>Subtotal <b>{money(amounts.subtotal)}</b></span><span>Discount <b>- {money(amounts.discount)}</b></span><span>Tax <b>{money(amounts.tax)}</b></span><span className="total">Total <b>{money(amounts.total)}</b></span></div>
      </section></div>
    <div className="nq-sticky-actions">
      <span>{saveDisabled && !mutation.isPending ? 'Select a customer and add at least one complete item.' : 'Ready to save quotation'}</span>
      <button className="lb-action-btn" onClick={() => navigate('/quotes')}>Cancel</button>
      <button className="lb-action-btn" disabled={saveDisabled} onClick={() => mutation.mutate({ preview: false })}><Save size={15}/> {mutation.isPending ? 'Saving…' : 'Save Draft'}</button>
      <button className="lb-action-btn lb-action-primary" disabled={saveDisabled} onClick={() => mutation.mutate({ preview: true })}><Eye size={15}/> Save &amp; Preview</button>
    </div>
  </div>
}
