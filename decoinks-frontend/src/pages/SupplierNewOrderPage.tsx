import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, ChevronRight, Info, Package, Plus, RefreshCw, Trash2, UploadCloud, X } from 'lucide-react'
import toast from '../utils/toast'
import { api } from '../services/api'
import '../styles/purchase-order-form.css'
import '../styles/supplier-new-order.css'

/**
 * Supplier Management → Issue PO to Supplier: BlankTex's New Order screen in
 * Printshop (owner, 19 Sep 2026) — the same four sections, fields and rules as
 * /root/BlankTex/frontend/src/pages/Purchase.jsx, in Printshop's look.
 *
 * Nothing is typed from scratch here (owner, 19 Sep 2026): pick the supplier,
 * then a sales order that still has an open PO for that supplier, then the PO —
 * and the whole order fills from it (items, style/colour/size, pieces, print and
 * mockup images, recipient, carrier). Everything stays locked until a PO is
 * loaded; after that it can be corrected, but no line can be added and no line
 * can ask for more pieces than the PO has. A PO already placed on the supplier
 * is not offered again.
 *
 * For now the screen fills and checks the order but does not send it: placing
 * with DIGI still happens in BlankTex, and sending from here is the next step.
 * BlankTex is not called or changed; the catalogue and the sales-order / PO
 * pickers come from Printshop's own API (/api/supplier-orders/new-order/*).
 */

interface CatalogColor { style_color_id: string; supplier_id?: string; color_code?: string; color_name?: string; display_name?: string }
interface CatalogSize { style_size_id: string; supplier_id: string; size_code: string; size_name: string }
interface CatalogStyle {
  style_id: string; supplier_id: string; style_no: string; style_name: string; craft_types: string | null
  images: string[] | null; color_ids: string[]; colors: CatalogColor[]; size_ids: string[]; size_weights: Record<string, number>
}
interface Supplier { supplier_id: string; supplier_code: string; supplier_name: string; api_provider: string | null; can_place_order: boolean }
interface Catalog { suppliers: Supplier[]; styles: CatalogStyle[]; colors: CatalogColor[]; sizes: CatalogSize[] }
interface Image { url: string; original_name?: string }
interface Item {
  product_title: string; style_id: string; style_color_id: string; style_size_id: string; craft_type: string
  quantity: string | number; print_position: string; specification: string; remark: string
  images: Partial<Record<'front_print' | 'front_mockup' | 'back_print' | 'back_mockup', Image>>
  // Pieces the PO line holds — this order can send fewer, never more.
  max_qty?: number
}
interface Form {
  supplier_id: string; order_no: string; carrier: string; order_time: string; recipient_name: string; phone: string
  address_line_1: string; address_line_2: string; city: string; state_province: string; postal_code: string; country: string
}

// Drafts of the first version of this screen; nothing is kept in the browser now.
const OLD_DRAFT_KEYS = ['printshop:supplier-new-order:form', 'printshop:supplier-new-order:items']
const BLANKTEX_NEW_ORDER = 'https://blanktex.decoinkssuite.com/purchase'

const emptyItem = (): Item => ({
  product_title: '', style_id: '', style_color_id: '', style_size_id: '', craft_type: '1', quantity: 1,
  print_position: '', specification: '', remark: '', images: {},
})

function localDateTime(date = new Date()) {
  const pad = (v: number) => String(v).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}
// BlankTex's order id: ORD-YYMMDDhhmmss.
function generateOrderId() {
  const n = new Date()
  return `ORD-${[n.getFullYear() % 100, n.getMonth() + 1, n.getDate(), n.getHours(), n.getMinutes(), n.getSeconds()]
    .map(v => String(v).padStart(2, '0')).join('')}`
}
const newForm = (): Form => ({
  supplier_id: '', order_no: generateOrderId(), carrier: '', order_time: localDateTime(), recipient_name: '', phone: '',
  address_line_1: '', address_line_2: '', city: '', state_province: '', postal_code: '', country: 'US',
})

// Auto-fill matches only exactly (normalised): a wrong guess would send the wrong
// garment, so anything uncertain is left for the agent to pick — as in BlankTex.
const normalizeKey = (v: unknown) => String(v ?? '').trim().toLowerCase().replace(/[^a-z0-9]/g, '')
function matchCatalog<T extends Record<string, any>>(list: T[], fields: string[], ...candidates: unknown[]): T | null {
  const wanted = candidates.map(normalizeKey).filter(Boolean)
  if (!wanted.length) return null
  for (const entry of list) for (const f of fields) {
    const v = normalizeKey(entry[f])
    if (v && wanted.includes(v)) return entry
  }
  return null
}

function formatWeight(grams: number | null) {
  if (grams == null) return '—'
  const lb = grams / 453.59237
  return `${grams < 1000 ? `${Math.round(grams)} g` : `${(grams / 1000).toFixed(2)} kg`} (${lb.toFixed(2)} lb)`
}
function unitWeight(item: Item, styles: CatalogStyle[]) {
  const g = styles.find(s => s.style_id === item.style_id)?.size_weights?.[item.style_size_id]
  return g == null ? null : Number(g)
}

const US_STATES = 'AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY PR'.split(' ')
const COUNTRIES = ['US', 'CA', 'MX', 'GB', 'AU']

// ── Small pieces ─────────────────────────────────────────────────────────────

interface Option { value: string; label: string; hint?: string }
function SearchSelect({ value, options, placeholder, disabled, onChange }: {
  value: string; options: Option[]; placeholder: string; disabled?: boolean; onChange: (v: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [])
  const chosen = options.find(o => o.value === value)
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase()
    return s ? options.filter(o => `${o.label} ${o.hint ?? ''}`.toLowerCase().includes(s)) : options
  }, [options, q])
  return (
    <div ref={box} className="sno-select" style={{ position: 'relative' }}>
      <button type="button" className="np-input sno-select-btn" disabled={disabled} onClick={() => { setOpen(o => !o); setQ('') }}>
        <span className={chosen ? '' : 'sno-placeholder'}>{chosen ? chosen.label : placeholder}</span>
        {chosen?.hint && <small>{chosen.hint}</small>}
        <ChevronDown size={14} />
      </button>
      {open && !disabled && (
        <div className="np-dropdown">
          <input className="np-input sno-select-search" autoFocus placeholder="Search…" value={q} onChange={e => setQ(e.target.value)} />
          {shown.length === 0 && <div className="np-dropdown-empty">Nothing matches</div>}
          {shown.map(o => (
            <button type="button" key={o.value} className="np-dropdown-item" onMouseDown={() => { onChange(o.value); setOpen(false) }}>
              <span className="np-dropdown-name">{o.label}</span>
              {o.hint && <span className="np-dropdown-sub">{o.hint}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function Section({ number, title, children, action }: { number: string; title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="np-card">
      <div className="np-card-header" style={{ justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span className="np-section-num">{number}</span><h3>{title}</h3></div>
        {action}
      </div>
      {children}
    </div>
  )
}

function Field({ label, hint, children, full }: { label: string; hint?: string; children: React.ReactNode; full?: boolean }) {
  return (
    <div className={`np-field${full ? ' sno-full' : ''}`}>
      <label className="np-label">{label} {hint && <small className="sno-hint">{hint}</small>}</label>
      {children}
    </div>
  )
}

function UploadZone({ label, hint, image, uploading, onFile, onClear }: {
  label: string; hint: string; image?: Image; uploading: boolean; onFile: (f: File) => void; onClear: () => void
}) {
  const [over, setOver] = useState(false)
  return (
    <div className="np-field">
      <label className="np-label">{label} <small className="sno-hint">{hint}</small></label>
      <label className={`sno-upload${image ? ' done' : ''}${over ? ' over' : ''}`}
        onDragOver={e => { e.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)}
        onDrop={e => { e.preventDefault(); setOver(false); if (e.dataTransfer.files[0]) onFile(e.dataTransfer.files[0]) }}>
        <input type="file" hidden accept="image/png,image/jpeg,image/webp" disabled={uploading}
          onChange={e => { if (e.target.files?.[0]) onFile(e.target.files[0]); e.currentTarget.value = '' }} />
        {uploading ? <b>Uploading…</b> : image ? (
          <>
            <img src={image.url} alt={label} />
            <span className="sno-upload-ok">✓ Uploaded</span>
            <button type="button" className="lb-action-btn" onClick={e => { e.preventDefault(); onClear() }}><X size={12} /> Remove</button>
          </>
        ) : (
          <><UploadCloud size={20} /><b>Upload {label.replace(' *', '')}</b><span>Click or drag &amp; drop</span></>
        )}
      </label>
    </div>
  )
}

// ── One item ─────────────────────────────────────────────────────────────────

function ItemCard({ item, index, catalog, onChange, onUpload, uploading }: {
  item: Item; index: number; catalog: Catalog
  onChange: (field: keyof Item, value: any) => void
  onUpload: (role: keyof Item['images'], file: File) => void; uploading: string | null
}) {
  const style = catalog.styles.find(s => s.style_id === item.style_id)
  // A style only comes in the colours/sizes the catalogue lists for it; with no
  // per-style breakdown the supplier-wide palette is kept (as in BlankTex).
  const colors = useMemo(() => {
    if (style?.colors?.length) return style.colors
    const allowed = style?.color_ids || []
    return allowed.length ? catalog.colors.filter(c => allowed.includes(c.style_color_id)) : catalog.colors
  }, [catalog.colors, style])
  const sizes = useMemo(() => {
    const allowed = style?.size_ids || []
    return allowed.length ? catalog.sizes.filter(z => allowed.includes(z.style_size_id)) : catalog.sizes
  }, [catalog.sizes, style])
  const crafts = String(style?.craft_types || '1,2').split(',').map(v => v.trim())
  const weight = unitWeight(item, catalog.styles)
  const pieces = Math.max(1, Number.parseInt(String(item.quantity), 10) || 0)
  const both = item.print_position === '1,2'
  const zone = (role: keyof Item['images'], label: string, hint: string) => (
    <UploadZone label={label} hint={hint} image={item.images[role]} uploading={uploading === role}
      onFile={f => onUpload(role, f)} onClear={() => onChange('images', { ...item.images, [role]: undefined })} />
  )

  return (
    <div className="sno-item">
      <div className="sno-item-head"><b>Item #{index + 1}</b>
        <span className="sno-muted">{item.remark}</span>
      </div>
      <div className="sno-grid one">
        <Field label="Product Title *"><input className="np-input" value={item.product_title} placeholder="e.g. Custom Print T-Shirt"
          onChange={e => onChange('product_title', e.target.value)} /></Field>
      </div>
      <div className="sno-grid three">
        <Field label="Style *"><SearchSelect value={item.style_id} placeholder="— Search style name or number —"
          options={catalog.styles.map(s => ({ value: s.style_id, label: s.style_name, hint: s.style_no }))}
          onChange={v => onChange('style_id', v)} /></Field>
        <Field label="Color *"><SearchSelect value={item.style_color_id} disabled={!item.style_id}
          placeholder={item.style_id ? '— Select Color —' : '— Select a style first —'}
          options={colors.map(c => ({ value: c.style_color_id, label: c.display_name || c.color_name || '', hint: c.color_code }))}
          onChange={v => onChange('style_color_id', v)} /></Field>
        <Field label="Size *"><SearchSelect value={item.style_size_id} disabled={!item.style_id}
          placeholder={item.style_id ? '— Select Size —' : '— Select a style first —'}
          options={sizes.map(z => ({ value: z.style_size_id, label: z.size_name, hint: z.size_code }))}
          onChange={v => onChange('style_size_id', v)} /></Field>
      </div>
      {style && item.style_size_id && (
        <div className="sno-weight"><span>Weight</span>
          <b>{weight == null ? 'Not published for this size' : `${formatWeight(weight)} / pc`}</b>
          {weight != null && <small>× {pieces} pc = {formatWeight(weight * pieces)}</small>}
        </div>
      )}
      {style && (
        <div className="sno-style">
          {style.images?.[0] ? <img src={style.images[0]} alt={style.style_name} /> : <div className="sno-style-ph"><Package size={22} /></div>}
          <div><b>{style.style_name}</b><span>Supplier style: {style.style_no}</span>
            <small>{colors.length} colours · {sizes.length} sizes{style.color_ids?.length ? '' : ' (supplier-wide palette)'} · SKU: {style.style_no}-COLOR-SIZE</small></div>
        </div>
      )}
      <div className="sno-grid two">
        <Field label="Craft Type *"><select className="np-select" value={item.craft_type} onChange={e => onChange('craft_type', e.target.value)}>
          <option value="1" disabled={!crafts.includes('1')}>Heat Transfer (烫画)</option>
          <option value="2" disabled={!crafts.includes('2')}>DTG Direct-to-Garment (直喷)</option>
        </select></Field>
        <Field label="Quantity *" hint={item.max_qty ? `(PO line: ${item.max_qty} — up to that)` : undefined}>
          <input className="np-input" type="number" min={1} max={item.max_qty || undefined} value={item.quantity} onChange={e => onChange('quantity', e.target.value)} /></Field>
      </div>
      <div className="sno-grid three">
        <Field label="Print Position"><select className="np-select" value={item.print_position} onChange={e => onChange('print_position', e.target.value)}>
          <option value="">— None —</option><option value="1">Front</option><option value="2">Back</option><option value="1,2">Both (Front &amp; Back)</option>
        </select></Field>
        <Field label="Specification"><input className="np-input" value={item.specification} placeholder="e.g. Black/XL" onChange={e => onChange('specification', e.target.value)} /></Field>
        <Field label="Remark"><input className="np-input" value={item.remark} placeholder="Optional note" onChange={e => onChange('remark', e.target.value)} /></Field>
      </div>
      <div className="sno-grid two">
        {zone('front_print', both ? 'Front Print *' : 'Print Image *', '(PNG, what gets printed)')}
        {zone('front_mockup', both ? 'Front Mockup *' : 'Mockup Image *', '(preview/effect)')}
      </div>
      {both && (
        <div className="sno-grid two">
          {zone('back_print', 'Back Print *', '(PNG, back design)')}
          {zone('back_mockup', 'Back Mockup *', '(back preview)')}
        </div>
      )}
    </div>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────

export function SupplierNewOrderPage() {
  const navigate = useNavigate()
  const [form, setForm] = useState<Form>(newForm)
  const [items, setItems] = useState<Item[]>([])
  // The PO this order was filled from; until there is one, nothing can be entered.
  const [loadedPo, setLoadedPo] = useState<{ id: string; po_number: string } | null>(null)
  const [uploading, setUploading] = useState<Record<string, string>>({})
  const [preview, setPreview] = useState(false)
  const [salesOrderId, setSalesOrderId] = useState('')
  const [orderPos, setOrderPos] = useState<any[]>([])
  const [poId, setPoId] = useState('')
  const [importing, setImporting] = useState(false)
  const [importNote, setImportNote] = useState('')

  useEffect(() => { try { OLD_DRAFT_KEYS.forEach(k => localStorage.removeItem(k)) } catch { /* storage blocked */ } }, [])

  const { data: catalog, isLoading, error, refetch } = useQuery<Catalog>({
    queryKey: ['supplier-new-order-catalog'],
    queryFn: () => api.get('/supplier-orders/new-order/catalog').then(r => r.data),
    staleTime: 5 * 60 * 1000,
  })
  const supplier = catalog?.suppliers.find(s => s.supplier_id === form.supplier_id)
  const supplierCode = supplier?.can_place_order ? supplier.supplier_code : ''
  // Sales orders with a PO for this supplier that is not on the supplier yet.
  const { data: salesOrders = [], isFetching: loadingOrders } = useQuery<any[]>({
    queryKey: ['supplier-new-order-sales-orders', supplierCode],
    queryFn: () => api.get('/supplier-orders/new-order/sales-orders', { params: { supplier: supplierCode } }).then(r => r.data.data ?? []),
    enabled: Boolean(supplierCode),
    staleTime: 0,
  })
  const supplierCatalog: Catalog = useMemo(() => ({
    suppliers: catalog?.suppliers ?? [],
    styles: (catalog?.styles ?? []).filter(s => s.supplier_id === form.supplier_id),
    colors: (catalog?.colors ?? []).filter(c => c.supplier_id === form.supplier_id),
    sizes: (catalog?.sizes ?? []).filter(z => z.supplier_id === form.supplier_id),
  }), [catalog, form.supplier_id])

  // Back to nothing chosen: no sales order, no PO, no lines, a fresh order id.
  const resetOrder = () => {
    setItems([]); setSalesOrderId(''); setImportNote(''); setOrderPos([]); setPoId(''); setLoadedPo(null)
    setForm(cur => ({ ...newForm(), supplier_id: cur.supplier_id }))
  }
  const setField = (field: keyof Form, value: string) => {
    setForm(cur => ({ ...cur, [field]: value }))
    // Another supplier's catalogue: the matched lines and the order link no longer hold.
    if (field === 'supplier_id') resetOrder()
  }
  const changeItem = (index: number, field: keyof Item, value: any) => setItems(cur => cur.map((it, i) => {
    if (i !== index) return it
    if (field === 'style_id') {
      const st = supplierCatalog.styles.find(s => s.style_id === value)
      const craft = String(st?.craft_types || '1').split(',')[0].trim() || '1'
      return { ...it, style_id: value, style_color_id: '', style_size_id: '', craft_type: craft }
    }
    return { ...it, [field]: value }
  }))

  // Lines from Printshop mapped onto this supplier's catalogue — by the codes the
  // line was picked with first, then by name. Unmatched stays blank on purpose.
  const mapLines = (lines: any[], remark: (it: any) => string) => {
    let unmatched = 0
    const mapped = lines.map((it: any): Item => {
      const st = matchCatalog(supplierCatalog.styles, ['style_no'], it.style_no)
        || matchCatalog(supplierCatalog.styles, ['style_name', 'style_no'], it.item, it.model)
      const palette = st?.color_ids?.length ? supplierCatalog.colors.filter(c => st.color_ids.includes(c.style_color_id)) : supplierCatalog.colors
      const range = st?.size_ids?.length ? supplierCatalog.sizes.filter(z => st.size_ids.includes(z.style_size_id)) : supplierCatalog.sizes
      const color = matchCatalog(palette, ['color_code'], it.color_code) || matchCatalog(palette, ['color_code', 'color_name', 'display_name'], it.color)
      const size = matchCatalog(range, ['size_code'], it.size_code) || matchCatalog(range, ['size_code', 'size_name'], it.size)
      if (!st || !color || !size) unmatched += 1
      const images: Item['images'] = {}
      if (it.front_image) images.front_print = { url: it.front_image }
      if (it.front_mockup) images.front_mockup = { url: it.front_mockup }
      if (it.back_image) images.back_print = { url: it.back_image }
      if (it.back_mockup) images.back_mockup = { url: it.back_mockup }
      const both = Boolean(it.back_image || it.back_mockup)
      return {
        ...emptyItem(),
        product_title: it.item || it.style_description || 'Imported item',
        style_id: st?.style_id || '', style_color_id: color?.style_color_id || '', style_size_id: size?.style_size_id || '',
        craft_type: st ? (String(st.craft_types || '1').split(',')[0].trim() || '1') : '1',
        quantity: Number(it.qty) || 1,
        print_position: both ? '1,2' : (it.front_image ? '1' : ''),
        specification: [it.color, it.size].filter(Boolean).join(' / '),
        remark: remark(it),
        images,
        max_qty: Number(it.qty) || 1,
      }
    })
    return { mapped, unmatched }
  }
  const fillRecipient = (order: any, ship: any, carrier?: string) => setForm(cur => ({
    ...cur,
    carrier: carrier && ['USPS', 'UPS', 'FedEx'].includes(carrier) ? carrier : cur.carrier,
    recipient_name: order?.shipping_name || order?.contact_name || ship?.name || ship?.company_name || cur.recipient_name,
    phone: order?.contact_phone || ship?.mobile_number || ship?.phone || ship?.company_phone_number || cur.phone,
    address_line_1: ship?.address_line1 || order?.shipping_address || cur.address_line_1,
    address_line_2: ship?.address_line2 || '',
    city: ship?.city || cur.city,
    state_province: ship?.state || cur.state_province,
    postal_code: ship?.zip || cur.postal_code,
    country: ship?.country && ship.country.length === 2 ? ship.country : (/united states|usa/i.test(ship?.country || '') ? 'US' : cur.country || 'US'),
  }))
  const matchedNote = (n: number) => n
    ? `${n} item${n === 1 ? '' : 's'} need Style/Color/Size confirmed below before placing.`
    : 'All items matched the supplier catalog — review recipient & artwork, then place.'

  const importPurchaseOrder = async (id: string, orderId = salesOrderId, pos = orderPos) => {
    setPoId(id); setLoadedPo(null); setItems([])
    setForm(cur => ({ ...newForm(), supplier_id: cur.supplier_id }))
    if (!id) { setImportNote(''); return }
    if (!pos.some(p => p.id === id)) return
    setImporting(true)
    try {
      const po = (await api.get(`/supplier-orders/new-order/sales-orders/${orderId}/purchase-orders/${id}`, { params: { supplier: supplierCode } })).data.data
      if (po.items_source === 'none') {
        // A partial PO without lines does not say which pieces it covers.
        setImportNote(`${po.po_number} is a partial PO with no items saved — open it in Purchase Orders, add its items and artwork, then pick it here.`)
        toast.error(`${po.po_number} has no items to order`)
        return
      }
      fillRecipient(po.order, po.ship_to, po.carrier)
      setLoadedPo({ id: po.id, po_number: po.po_number })
      {
        const { mapped, unmatched } = mapLines(po.items || [], it => `Printshop ${po.po_number}${it.catalog_sku ? ` · SKU ${it.catalog_sku}` : ''}`)
        setItems(mapped)
        setImportNote(`Imported ${po.po_number}${po.order?.order_number ? ` (sales order ${po.order.order_number})` : ''} — ${mapped.length} item${mapped.length === 1 ? '' : 's'}` +
          `${po.items_source === 'sales_order' ? ' from the sales order (this full PO has no lines of its own)' : ''}. ${matchedNote(unmatched)}`)
      }
      toast.success(`Loaded purchase order ${po.po_number}`)
    } catch (err: any) {
      toast.error(err?.response?.data?.error ?? 'Could not load the purchase order'); setPoId('')
    } finally { setImporting(false) }
  }

  // The sales order first, then its open PO (a lone one is taken at once).
  const selectSalesOrder = async (id: string) => {
    resetOrder()
    if (!id) return
    setSalesOrderId(id)
    const order = salesOrders.find(o => o.id === id)
    setImporting(true)
    let pos: any[] | null = null
    try { pos = (await api.get(`/supplier-orders/new-order/sales-orders/${id}/purchase-orders`, { params: { supplier: supplierCode } })).data.data ?? [] }
    catch (err: any) { toast.error(err?.response?.data?.error ?? 'Could not load its purchase orders'); setSalesOrderId('') }
    finally { setImporting(false) }
    if (!pos) return
    if (!pos.length) { setImportNote(`${order?.order_number ?? 'This order'} has no open ${supplierCode} PO left.`); return }
    setOrderPos(pos)
    if (pos.length === 1) return importPurchaseOrder(pos[0].id, id, pos)
    setImportNote(`${order?.order_number} has ${pos.length} open purchase orders — pick the one this order is for.`)
  }

  const uploadImage = async (index: number, role: keyof Item['images'], file: File) => {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) return toast.error('Use a PNG, JPG, or WebP image')
    if (file.size > 10 * 1024 * 1024) return toast.error('Image must be 10 MB or smaller')
    const key = `${index}:${role}`
    setUploading(cur => ({ ...cur, [key]: role }))
    try {
      const fd = new FormData()
      fd.append('file', file)
      const up = await api.post('/upload/image', fd, { headers: { 'Content-Type': 'multipart/form-data' } })
      const url: string | undefined = up.data?.url ?? up.data?.data?.url
      if (!url) throw new Error('The upload did not return a link')
      setItems(cur => cur.map((it, i) => i === index ? { ...it, images: { ...it.images, [role]: { url, original_name: file.name } } } : it))
      toast.success('Image uploaded ✓')
    } catch (err: any) {
      toast.error(err?.response?.data?.error ?? err?.message ?? 'Upload failed')
    } finally {
      setUploading(cur => { const next = { ...cur }; delete next[key]; return next })
    }
  }

  // The same checks BlankTex runs before it places an order.
  const validate = () => {
    if (!form.supplier_id) return 'Select a supplier first'
    if (!salesOrderId) return 'Select the sales order'
    if (!loadedPo || loadedPo.id !== poId) return 'Select the purchase order — the order is filled from it'
    if (!items.length) return `${loadedPo.po_number} has no items to order`
    for (let i = 0; i < items.length; i += 1) {
      const it = items[i]
      if (!it.product_title.trim()) return `Item #${i + 1}: title is required`
      if (!it.style_id) return `Item #${i + 1}: style is required`
      if (!it.style_color_id) return `Item #${i + 1}: color is required`
      if (!it.style_size_id) return `Item #${i + 1}: size is required`
      const qty = Number.parseInt(String(it.quantity), 10)
      if (!Number.isInteger(qty) || qty < 1) return `Item #${i + 1}: quantity must be at least 1`
      if (it.max_qty && qty > it.max_qty) return `Item #${i + 1}: ${qty} is more than the ${it.max_qty} on ${loadedPo.po_number}`
      if (!it.images.front_print) return `Item #${i + 1}: print image is required`
      if (!it.images.front_mockup) return `Item #${i + 1}: mockup image is required`
      if (it.print_position === '1,2' && !it.images.back_print) return `Item #${i + 1}: back print image is required for Both position`
      if (it.print_position === '1,2' && !it.images.back_mockup) return `Item #${i + 1}: back mockup image is required for Both position`
    }
    const digits = (v: string) => String(v || '').replace(/\D/g, '')
    if (!form.order_no.trim()) return 'Order ID is required'
    if (!form.order_time) return 'Order time is required'
    if (!form.recipient_name.trim()) return 'Recipient full name is required'
    if (!form.phone.trim()) return 'Phone number is required'
    if (digits(form.phone).length < 7) return 'Enter a valid phone number'
    if (!form.address_line_1.trim()) return 'Address Line 1 is required'
    if (!form.city.trim()) return 'City is required'
    if (!form.state_province.trim()) return 'State / Province is required'
    if (!form.postal_code.trim()) return 'ZIP / Postal code is required'
    if (form.country === 'US' && !/^\d{5}(-\d{4})?$/.test(form.postal_code.trim())) return 'Enter a valid US ZIP code (e.g. 90210 or 90210-1234)'
    return ''
  }
  const checkOrder = () => {
    const problem = validate()
    if (problem) return toast.error(problem)
    toast.success('Order is complete — placing it from Printshop is the next step; place it in BlankTex for now.')
  }
  const startOver = () => {
    if (!window.confirm('Clear this order and start a new one?')) return
    setForm(newForm()); setItems([]); setSalesOrderId(''); setOrderPos([]); setPoId(''); setImportNote(''); setLoadedPo(null)
  }

  const totals = items.reduce((sum, it) => {
    const pcs = Math.max(0, Number.parseInt(String(it.quantity), 10) || 0)
    const unit = unitWeight(it, supplierCatalog.styles)
    return { pieces: sum.pieces + pcs, grams: sum.grams + (unit == null ? 0 : unit * pcs), unweighed: sum.unweighed + (it.style_size_id && unit == null ? 1 : 0) }
  }, { pieces: 0, grams: 0, unweighed: 0 })
  const ready = Boolean(supplier?.can_place_order)
  const filled = ready && Boolean(loadedPo)
  const busy = Object.keys(uploading).length > 0

  return (
    <div className="np-page sno-page">
      <div className="np-header">
        <div>
          <div className="np-breadcrumb">
            <Link to="/supplier-management" className="hover:text-gray-700">Supplier Management</Link>
            <ChevronRight size={13} /><strong>New Order</strong>
          </div>
          <h2 className="np-page-title">New Order</h2>
          <p style={{ fontSize: 12, color: '#6b7280', margin: '2px 0 0' }}>Place a new supplier purchase order</p>
        </div>
        <div className="np-header-actions">
          <button type="button" className="lb-action-btn" onClick={startOver}>Start over</button>
        </div>
      </div>

      <div className="sno-banner">
        <Info size={15} />
        <span>This is BlankTex's New Order screen inside Printshop. Sending the order to the supplier from here is the next step —
          for now place it in <a href={BLANKTEX_NEW_ORDER} target="_blank" rel="noreferrer">BlankTex</a>.</span>
      </div>

      {isLoading ? <div className="np-card sno-muted">Loading purchase catalog…</div>
        : error ? <div className="np-card sno-error">Could not load the supplier catalog. <button className="lb-action-btn" onClick={() => refetch()}>Try again</button></div>
        : <>
          <Section number="1" title="Supplier Selection">
            <div className="sno-grid one">
              <Field label="Fulfillment Supplier *">
                <select className="np-select" value={form.supplier_id} onChange={e => setField('supplier_id', e.target.value)}>
                  <option value="">— Select Supplier Before Creating Order —</option>
                  {catalog!.suppliers.map(s => <option key={s.supplier_id} value={s.supplier_id} disabled={!s.can_place_order}>
                    {s.supplier_name} ({s.supplier_code}){s.can_place_order ? ' — API Connected' : ' — API Not Configured'}</option>)}
                </select>
              </Field>
            </div>
            {supplier && (
              <div className={`sno-choice ${supplier.can_place_order ? 'ready' : 'blocked'}`}>
                <span>{supplier.can_place_order ? '✓' : '!'}</span>
                <div><b>{supplier.supplier_name}</b>
                  <small>{supplier.can_place_order
                    ? `Connected through ${supplier.api_provider} production API · ${supplierCatalog.styles.length} styles · ${supplierCatalog.colors.length} colors · ${supplierCatalog.sizes.length} sizes`
                    : 'This supplier cannot receive API purchase orders yet.'}</small></div>
                {supplier.can_place_order && <button type="button" className="lb-action-btn" onClick={() => refetch()} title="Reload the catalog BlankTex keeps for this supplier"><RefreshCw size={13} /> Reload Catalog</button>}
              </div>
            )}
            {ready && (
              <div className="sno-grid one" style={{ marginTop: 12 }}>
                <Field label="Sales Order *" hint={`(apparel orders with a ${supplierCode} PO not yet on ${supplier!.supplier_name})`}>
                  <SearchSelect value={salesOrderId}
                    placeholder={importing ? 'Loading order…' : loadingOrders ? 'Loading sales orders…'
                      : (salesOrders.length ? '— Pick the sales order —' : `— No sales order has an open ${supplierCode} PO —`)}
                    disabled={!salesOrders.length}
                    options={salesOrders.map(o => ({ value: o.id, label: `${o.order_number} — ${o.customer_name || 'No customer'}`,
                      hint: `${o.total_qty} pc · ${o.open_po_count} open PO${o.open_po_count === 1 ? '' : 's'}${o.sales_channel ? ` · ${o.sales_channel}` : ''}` }))}
                    onChange={selectSalesOrder} />
                </Field>
                {salesOrderId && orderPos.length > 0 && (
                  <Field label="Purchase Order *" hint={`(${orderPos.length} open for this sales order)`}>
                    <SearchSelect value={poId} placeholder={importing ? 'Loading purchase order…' : '— Pick the purchase order —'}
                      options={orderPos.map(p => ({ value: p.id, label: `${p.po_number} — ${p.po_scope === 'partial' ? 'Partial' : 'Full'} PO`,
                        hint: `${p.item_count ? `${p.total_qty} pc · ${p.item_count} line${p.item_count === 1 ? '' : 's'}` : 'no lines of its own'}${p.supplier_name ? ` · ${p.supplier_name}` : ''}` }))}
                      onChange={v => importPurchaseOrder(v)} />
                  </Field>
                )}
                {importNote && <div className={`sno-choice ${loadedPo ? 'ready' : 'blocked'}`}><span>{loadedPo ? '↧' : '!'}</span>
                  <div><b>{loadedPo ? `Filled from ${loadedPo.po_number}` : 'Purchase order'}</b><small>{importNote}</small></div></div>}
              </div>
            )}
          </Section>

          {ready && !loadedPo && <div className="sno-lock"><Info size={15} /> Pick the sales order and its purchase order above — the order fills from the PO. Nothing is entered by hand.</div>}
          <fieldset className="sno-workflow" disabled={!filled}>
            <Section number="2" title="Order Info">
              <div className="sno-grid two">
                <Field label="Order ID *" hint="(must be unique)"><input className="np-input" value={form.order_no} onChange={e => setField('order_no', e.target.value)} /></Field>
                <Field label="Carrier"><select className="np-select" value={form.carrier} onChange={e => setField('carrier', e.target.value)}>
                  <option value="">— Select Carrier —</option><option>USPS</option><option>UPS</option><option>FedEx</option></select></Field>
                <Field label="Order Time *" full><input className="np-input" type="datetime-local" value={form.order_time} onChange={e => setField('order_time', e.target.value)} /></Field>
              </div>
            </Section>

            <Section number="3" title="Recipient">
              <div className="sno-grid two">
                <Field label="Full Name *"><input className="np-input" value={form.recipient_name} onChange={e => setField('recipient_name', e.target.value)} /></Field>
                <Field label="Phone *"><input className="np-input" type="tel" value={form.phone} onChange={e => setField('phone', e.target.value)} /></Field>
                <Field label="Address Line 1 *" full><input className="np-input" value={form.address_line_1} onChange={e => setField('address_line_1', e.target.value)} /></Field>
                <Field label="Address Line 2" full><input className="np-input" value={form.address_line_2} onChange={e => setField('address_line_2', e.target.value)} /></Field>
                <Field label="City *"><input className="np-input" value={form.city} onChange={e => setField('city', e.target.value)} /></Field>
                <Field label="State / Province *">{form.country === 'US'
                  ? <SearchSelect value={form.state_province} placeholder="— Search state (CA, NY…) —"
                      options={US_STATES.map(s => ({ value: s, label: s }))} onChange={v => setField('state_province', v)} />
                  : <input className="np-input" value={form.state_province} placeholder="State / Province" onChange={e => setField('state_province', e.target.value)} />}</Field>
                <Field label="ZIP Code *"><input className="np-input" value={form.postal_code} onChange={e => setField('postal_code', e.target.value)} /></Field>
                <Field label="Country *"><select className="np-select" value={form.country}
                  onChange={e => setForm(cur => ({ ...cur, country: e.target.value, state_province: '' }))}>
                  {COUNTRIES.map(c => <option key={c}>{c}</option>)}</select></Field>
              </div>
            </Section>

            <Section number="4" title="Items" action={loadedPo ? <span className="sno-muted">From {loadedPo.po_number} — items come only from the PO</span> : undefined}>
              {!items.length
                ? <div className="sno-empty">The items of the purchase order appear here</div>
                : items.map((it, i) => (
                  <ItemCard key={i} item={it} index={i} catalog={supplierCatalog}
                    onChange={(f, v) => changeItem(i, f, v)}
                    onUpload={(role, file) => uploadImage(i, role, file)}
                    uploading={Object.entries(uploading).find(([k]) => k.startsWith(`${i}:`))?.[1] ?? null} />
                ))}
              {items.length > 0 && (
                <div className="sno-totals">
                  <div><small>ITEMS</small><b>{items.length}</b></div>
                  <div><small>PIECES</small><b>{totals.pieces}</b></div>
                  <div><small>TOTAL WEIGHT</small><b>{formatWeight(totals.grams)}</b></div>
                  {totals.unweighed > 0 && <span className="sno-muted">No published weight for {totals.unweighed} item{totals.unweighed > 1 ? 's' : ''} — not counted above</span>}
                </div>
              )}
            </Section>
          </fieldset>

          {!form.supplier_id && <div className="sno-muted" style={{ textAlign: 'center', margin: '4px 0 12px' }}>Select an API-connected supplier above, then the sales order and its purchase order.</div>}

          <div className="sno-actions">
            <button type="button" className="lb-action-btn" onClick={() => navigate('/supplier-management')}>Cancel</button>
            <button type="button" className="lb-action-btn" onClick={() => setPreview(v => !v)} disabled={!filled}>Preview JSON</button>
            <button type="button" className="lb-action-btn" onClick={checkOrder} disabled={!filled || busy}>Check Order</button>
            <button type="button" className="lb-action-btn lb-action-primary" disabled
              title="Sending to the supplier from Printshop is the next step — place it in BlankTex for now">→ Place Order</button>
          </div>
          {preview && filled && <pre className="sno-preview">{JSON.stringify({ ...form, items }, null, 2)}</pre>}
        </>}
    </div>
  )
}

export default SupplierNewOrderPage
