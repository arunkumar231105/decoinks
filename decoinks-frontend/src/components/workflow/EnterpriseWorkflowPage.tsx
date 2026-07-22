import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  BadgeCheck, Box, CalendarDays, ChevronDown, ChevronFirst, ChevronLast,
  ChevronLeft, ChevronRight, CircleDollarSign, Clock3, Download, FileText,
  PackageCheck, Plus, Printer, Search, Send, ShoppingBag, Star,
  Truck, Upload, Users, X,
} from 'lucide-react'
import toast from '../../utils/toast'
import { api } from '../../services/api'
import { downloadCsv } from '../../utils/actions'
import { BulkUploadModal } from '../BulkUploadModal'
import { BulkUploadOrdersModal } from '../BulkUploadOrdersModal'

export type EnterpriseWorkflowKind = 'quotations' | 'invoices' | 'orders' | 'purchase-orders'

type AnyRow = Record<string, any>
type Column = { key: string; label: string; numeric?: boolean; render?: (row: AnyRow) => React.ReactNode }
type Kpi = { label: string; icon: typeof Users; value: (rows: AnyRow[], total: number) => string | number; tone: string }

const money = (value: any) => `$${Number(value || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const date = (value: any) => {
  if (!value) return '—'
  const raw = String(value)
  return new Date(/^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00:00` : raw).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
const titleCase = (value: any) => String(value || '—').replaceAll('_', ' ').replace(/\b\w/g, s => s.toUpperCase())
const pick = (row: AnyRow, ...keys: string[]) => keys.map(k => row?.[k]).find(v => v !== null && v !== undefined && v !== '')
const countStatus = (rows: AnyRow[], ...statuses: string[]) => rows.filter(r => statuses.some(status => String(r.status || '').trim().toLowerCase() === status.trim().toLowerCase())).length

const statusTone = (value: any) => {
  const text = String(value || '').toLowerCase()
  if (/paid|approved|delivered|converted|positive|received|complete/.test(text)) return 'green'
  if (/pending|hold|partial|waiting|production/.test(text)) return 'amber'
  if (/cancel|reject|negative|overdue|discontinued/.test(text)) return 'red'
  if (/sent|ship|transit|issued/.test(text)) return 'blue'
  return 'slate'
}

const Badge = ({ children }: { children: React.ReactNode }) => <span className={`ew-badge ew-badge-${statusTone(children)}`}>{children || '—'}</span>

const common = {
  empty: (r: AnyRow, ...keys: string[]) => pick(r, ...keys) ?? '—',
  status: (r: AnyRow) => <Badge>{titleCase(r.status)}</Badge>,
}

const CONFIG: Record<EnterpriseWorkflowKind, {
  title: string; subtitle: string; api: string; newPath: string; newLabel: string; search: string
  numberKey: string; dateKey: string; columns: Column[]; kpis: Kpi[]; statuses: string[]
}> = {
  quotations: {
    title: 'Quotations', subtitle: 'Manage and track quotations for leads and customers.', api: '/quotations', newPath: '/quotes/new', newLabel: 'New Quotation',
    search: 'Search by quote no, customer, email, phone or sales agent…', numberKey: 'quote_number', dateKey: 'created_at',
    statuses: ['Draft', 'Sent', 'Approved', 'Rejected', 'Expired'],
    kpis: [
      { label: 'Total Quotes', icon: FileText, value: (_, t) => t, tone: 'blue' },
      { label: 'Draft', icon: FileText, value: r => countStatus(r, 'draft'), tone: 'slate' },
      { label: 'Sent', icon: Send, value: r => countStatus(r, 'sent'), tone: 'green' },
      { label: 'Approved', icon: BadgeCheck, value: r => countStatus(r, 'approved'), tone: 'green' },
      { label: 'Rejected', icon: X, value: r => countStatus(r, 'rejected'), tone: 'red' },
      { label: 'Expired', icon: Clock3, value: r => countStatus(r, 'expired'), tone: 'amber' },
      { label: 'Total Value', icon: CircleDollarSign, value: r => money(r.reduce((a, x) => a + Number(x.total || 0), 0)), tone: 'blue' },
      { label: 'Average Quote', icon: CircleDollarSign, value: r => money(r.length ? r.reduce((a, x) => a + Number(x.total || 0), 0) / r.length : 0), tone: 'purple' },
    ],
    columns: [
      { key: 'quote_number', label: 'Quotation No.', render: r => <strong className="ew-link">{r.quote_number}</strong> },
      { key: 'revision_number', label: 'Revision', numeric: true },
      { key: 'created_at', label: 'Quote Date', render: r => date(r.created_at) },
      { key: 'status', label: 'Status', render: common.status },
      { key: 'response', label: 'Customer Response', render: r => <Badge>{common.empty(r, 'customer_response')}</Badge> },
      { key: 'customer', label: 'Customer Name', render: r => <div><strong>{common.empty(r, 'customer_name')}</strong><small>{common.empty(r, 'billing_email', 'email')}</small></div> },
      { key: 'source', label: 'Source', render: r => common.empty(r, 'source') },
      { key: 'sent_via', label: 'Sent Via', render: r => common.empty(r, 'sent_via') },
      { key: 'item', label: 'Item', render: r => common.empty(r, 'order_type', 'item_name', 'description') },
      { key: 'qty', label: 'Qty', numeric: true, render: r => common.empty(r, 'total_qty', 'qty') },
      { key: 'total', label: 'Amount', numeric: true, render: r => <strong>{money(r.total)}</strong> },
    ],
  },
  invoices: {
    title: 'Invoices', subtitle: 'Track billing, payments and manage outstanding balances.', api: '/invoices', newPath: '/invoices/new', newLabel: 'New Invoice',
    search: 'Search invoices by number, customer, email or quotation…', numberKey: 'invoice_number', dateKey: 'invoice_date',
    statuses: ['Draft', 'Sent', 'Partially Paid', 'Paid', 'Overdue', 'Void'],
    kpis: [
      { label: 'Total Invoices', icon: FileText, value: (_, t) => t, tone: 'blue' },
      { label: 'Draft', icon: FileText, value: r => countStatus(r, 'draft'), tone: 'slate' },
      { label: 'Sent', icon: Send, value: r => countStatus(r, 'sent'), tone: 'blue' },
      { label: 'Partially Paid', icon: Clock3, value: r => countStatus(r, 'partially paid'), tone: 'amber' },
      { label: 'Paid', icon: CircleDollarSign, value: r => countStatus(r, 'paid'), tone: 'green' },
      { label: 'Overdue', icon: Clock3, value: r => countStatus(r, 'overdue'), tone: 'red' },
      { label: 'Total Amount', icon: CircleDollarSign, value: r => money(r.reduce((a, x) => a + Number(x.total || 0), 0)), tone: 'blue' },
      { label: 'Balance Due', icon: Clock3, value: r => money(r.reduce((a, x) => a + Number(x.balance_due || 0), 0)), tone: 'purple' },
    ],
    columns: [
      { key: 'invoice_number', label: 'Invoice #', render: r => <strong className="ew-link">{r.invoice_number}</strong> },
      { key: 'quote_number', label: 'Quotation ID', render: r => common.empty(r, 'quote_number') },
      { key: 'customer', label: 'Customer', render: r => <div><strong>{common.empty(r, 'customer_display_name', 'customer_name')}</strong><small>{common.empty(r, 'company')}</small></div> },
      { key: 'invoice_date', label: 'Invoice Date', render: r => date(pick(r, 'invoice_date', 'issue_date')) },
      { key: 'due_date', label: 'Due Date', render: r => date(r.due_date) },
      { key: 'total', label: 'Amount', numeric: true, render: r => <strong>{money(r.total)}</strong> },
      { key: 'status', label: 'Status', render: common.status },
      { key: 'response', label: 'Customer Response', render: r => <Badge>{common.empty(r, 'customer_response')}</Badge> },
      { key: 'payment', label: 'Payment Status', render: r => <Badge>{common.empty(r, 'payment_status', 'status')}</Badge> },
      { key: 'amount_paid', label: 'Paid', numeric: true, render: r => money(r.amount_paid) },
      { key: 'balance_due', label: 'Balance', numeric: true, render: r => money(r.balance_due) },
      { key: 'updated_at', label: 'Last Activity', render: r => date(r.updated_at) },
    ],
  },
  orders: {
    title: 'Sales Orders', subtitle: 'Manage and track sales orders from confirmation to delivery.', api: '/orders', newPath: '/orders/new', newLabel: 'New Sales Order',
    search: 'Search by order ID, customer, product or agent…', numberKey: 'order_number', dateKey: 'order_date',
    statuses: ['Draft', 'Confirmed', 'In Production', 'QC', 'Ready to Ship', 'Shipped', 'Delivered', 'Cancelled'],
    kpis: [
      { label: 'Orders', icon: ShoppingBag, value: (_, t) => t, tone: 'blue' },
      { label: 'Order Value', icon: CircleDollarSign, value: r => money(r.reduce((a, x) => a + Number(x.total || 0), 0)), tone: 'purple' },
      { label: 'Draft', icon: FileText, value: r => countStatus(r, 'draft'), tone: 'slate' },
      { label: 'Confirmed', icon: BadgeCheck, value: r => countStatus(r, 'confirmed'), tone: 'green' },
      { label: 'In Production', icon: Box, value: r => countStatus(r, 'In Production'), tone: 'purple' },
      { label: 'Ready to Ship', icon: PackageCheck, value: r => countStatus(r, 'ready to ship'), tone: 'amber' },
      { label: 'Shipped', icon: Truck, value: r => countStatus(r, 'Shipped'), tone: 'blue' },
      { label: 'Delivered', icon: PackageCheck, value: r => countStatus(r, 'delivered'), tone: 'green' },
    ],
    columns: [
      { key: 'order_number', label: 'Order ID', render: r => <strong className="ew-link">{r.order_number}</strong> },
      { key: 'order_date', label: 'Order Date', render: r => date(r.order_date) },
      { key: 'agent', label: 'Agent Name', render: r => common.empty(r, 'agent_name') },
      { key: 'customer', label: 'Customer Name', render: r => common.empty(r, 'customer_name', 'contact_name', 'supplier_name') },
      { key: 'order_type', label: 'Product Type', render: r => titleCase(r.order_type) },
      { key: 'qty', label: 'Qty', numeric: true, render: r => common.empty(r, 'total_qty', 'quantity') },
      { key: 'total', label: 'Order Value', numeric: true, render: r => <strong>{money(r.total)}</strong> },
      { key: 'paid', label: 'Paid Amount', numeric: true, render: r => money(pick(r, 'amount_paid', 'payment_received')) },
      { key: 'method', label: 'Payment Method', render: r => common.empty(r, 'payment_method') },
      { key: 'status', label: 'Status', render: common.status },
      { key: 'tracking', label: 'Tracking ID', render: r => common.empty(r, 'tracking_number') },
      { key: 'delivery', label: 'Estimated Delivery', render: r => date(pick(r, 'expected_delivery_date', 'due_date')) },
      { key: 'updated_at', label: 'Last Update', render: r => date(r.updated_at) },
    ],
  },
  'purchase-orders': {
    title: 'Purchase Orders', subtitle: 'Manage and track all purchase orders with suppliers.', api: '/purchase-orders', newPath: '/purchase-orders/new', newLabel: 'New Purchase Order',
    search: 'Search PO by number, vendor, order or tracking ID…', numberKey: 'po_number', dateKey: 'order_date',
    statuses: ['Draft', 'Pending Approval', 'Approved', 'Sent', 'Accepted', 'In Production', 'Shipped', 'Partially Received', 'Received', 'Closed', 'Cancelled'],
    kpis: [
      { label: 'Total Purchase Orders', icon: FileText, value: (_, t) => t, tone: 'blue' },
      { label: 'Draft', icon: FileText, value: r => countStatus(r, 'draft'), tone: 'slate' },
      { label: 'Pending Approval', icon: Clock3, value: r => countStatus(r, 'pending approval'), tone: 'amber' },
      { label: 'Approved / Sent', icon: Send, value: r => countStatus(r, 'approved', 'sent'), tone: 'blue' },
      { label: 'In Production', icon: Box, value: r => countStatus(r, 'In Production'), tone: 'purple' },
      { label: 'Shipped', icon: Truck, value: r => countStatus(r, 'Shipped'), tone: 'blue' },
      { label: 'Received / Closed', icon: PackageCheck, value: r => countStatus(r, 'received', 'closed'), tone: 'green' },
      { label: 'PO Value', icon: CircleDollarSign, value: r => money(r.reduce((a, x) => a + Number(pick(x, 'grand_total', 'total') || 0), 0)), tone: 'green' },
    ],
    columns: [
      { key: 'po_number', label: 'PO #', render: r => <strong className="ew-link">{common.empty(r, 'source_po_number', 'po_number')}</strong> },
      { key: 'order_date', label: 'PO Date', render: r => date(r.order_date) },
      { key: 'vendor', label: 'Vendor', render: r => <div><strong>{common.empty(r, 'display_vendor_name', 'vendor_name', 'supplier_name')}</strong><small>{common.empty(r, 'vendor_country', 'country')}</small></div> },
      { key: 'order', label: 'Source Order', render: r => common.empty(r, 'order_number', 'source_order_number') },
      { key: 'product', label: 'Product Type', render: r => common.empty(r, 'print_type', 'order_type') },
      { key: 'status', label: 'Status', render: common.status },
      { key: 'shipping', label: 'Shipping By', render: r => common.empty(r, 'shipping_by', 'shipping_method') },
      { key: 'service', label: 'Service Type', render: r => common.empty(r, 'service_type') },
      { key: 'tracking', label: 'Tracking ID', render: r => common.empty(r, 'tracking_id', 'tracking_number') },
      { key: 'delivery', label: 'Est. Delivery', render: r => date(r.expected_date) },
      { key: 'comments', label: 'Customer Comments', render: r => common.empty(r, 'customer_comments') },
    ],
  },
}

const PAGE_SIZE = 10
type Period = 'today' | 'week' | 'month' | 'custom' | 'all'

const toIsoDate = (value: Date) => {
  const local = new Date(value.getTime() - value.getTimezoneOffset() * 60000)
  return local.toISOString().slice(0, 10)
}

const customerOf = (r: AnyRow) => String(pick(r, 'customer_display_name', 'customer_name', 'contact_name', 'display_vendor_name', 'vendor_name', 'supplier_name') || '')
const productOf = (r: AnyRow) => String(pick(r, 'order_type', 'print_type', 'product_type', 'item_name') || '')
const sourceOf = (r: AnyRow) => String(pick(r, 'source', 'customer_source', 'sent_via') || '')

export function EnterpriseWorkflowPage({ kind }: { kind: EnterpriseWorkflowKind }) {
  const config = CONFIG[kind]
  const navigate = useNavigate()
  const [allRows, setAllRows] = useState<AnyRow[]>([])
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(PAGE_SIZE)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('All')
  const [customer, setCustomer] = useState('All')
  const [product, setProduct] = useState('All')
  const [source, setSource] = useState('All')
  const [period, setPeriod] = useState<Period>('month')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [favorites, setFavorites] = useState<Set<string>>(new Set())
  const [active, setActive] = useState<AnyRow | null>(null)
  const [detail, setDetail] = useState<AnyRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [quoteImport, setQuoteImport] = useState(false)
  const [orderImport, setOrderImport] = useState(false)
  const [columnsOpen, setColumnsOpen] = useState(false)
  const [visibleColumns, setVisibleColumns] = useState<Set<string>>(() => new Set(config.columns.map(c => c.key)))
  const searchInputRef = useRef<HTMLInputElement>(null)

  const load = async () => {
    setLoading(true)
    try {
      const { data } = await api.get(config.api, { params: { page: 1, limit: 1000 } })
      setAllRows(data.data.rows || [])
    } catch { toast.error(`Failed to load ${config.title.toLowerCase()}`) }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [kind])
  useEffect(() => {
    setPage(1); setActive(null); setDetail(null); setSelected(new Set())
    setVisibleColumns(new Set(config.columns.map(c => c.key)))
    try { setFavorites(new Set(JSON.parse(localStorage.getItem(`ew-favorites-${kind}`) || '[]'))) } catch { setFavorites(new Set()) }
  }, [kind])
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault(); searchInputRef.current?.focus()
      }
      if (event.key === 'Escape') { setColumnsOpen(false); setActive(null); setDetail(null) }
    }
    window.addEventListener('keydown', shortcut)
    return () => window.removeEventListener('keydown', shortcut)
  }, [])

  const periodRange = useMemo(() => {
    if (period === 'all') return ['', ''] as const
    if (period === 'custom') return [dateFrom, dateTo] as const
    const now = new Date()
    const start = new Date(now)
    if (period === 'week') start.setDate(now.getDate() - 6)
    if (period === 'month') start.setDate(1)
    return [toIsoDate(start), toIsoDate(now)] as const
  }, [period, dateFrom, dateTo])

  const filteredRows = useMemo(() => allRows.filter(row => {
    const haystack = Object.values(row).filter(v => typeof v === 'string' || typeof v === 'number').join(' ').toLowerCase()
    if (search.trim() && !haystack.includes(search.trim().toLowerCase())) return false
    if (status !== 'All' && String(row.status || '').toLowerCase() !== status.toLowerCase()) return false
    if (customer !== 'All' && customerOf(row) !== customer) return false
    if (product !== 'All' && productOf(row) !== product) return false
    if (source !== 'All' && sourceOf(row) !== source) return false
    const rawDate = pick(row, config.dateKey, 'created_at', 'issue_date', 'order_date')
    const rowDate = rawDate ? String(rawDate).slice(0, 10) : ''
    if (periodRange[0] && rowDate && rowDate < periodRange[0]) return false
    if (periodRange[1] && rowDate && rowDate > periodRange[1]) return false
    return true
  }), [allRows, search, status, customer, product, source, periodRange, config.dateKey])

  const total = filteredRows.length
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const rows = filteredRows.slice((page - 1) * pageSize, page * pageSize)
  const shownColumns = config.columns.filter(c => visibleColumns.has(c.key))
  const unique = (values: string[]) => [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b))
  const customers = useMemo(() => unique(allRows.map(customerOf)), [allRows])
  const products = useMemo(() => unique(allRows.map(productOf)), [allRows])
  const sources = useMemo(() => unique(allRows.map(sourceOf)), [allRows])
  useEffect(() => { setPage(1) }, [search, status, customer, product, source, period, dateFrom, dateTo])
  useEffect(() => { if (page > pages) setPage(pages) }, [page, pages])

  const openDetail = async (row: AnyRow) => {
    setActive(row); setDetail(row)
    try {
      const { data } = await api.get(`${config.api}/${row.id}`)
      const record = data.data || row
      const extras: AnyRow = {}
      if (record.customer_id) {
        try { extras.linked_customer = (await api.get(`/customers/${record.customer_id}`)).data.data } catch { /* historical records may not have a customer profile */ }
      }
      if (kind === 'quotations') {
        try { extras.attachments = (await api.get(`/quotations/${row.id}/artworks`)).data.artworks || [] } catch { extras.attachments = [] }
      }
      if (kind === 'purchase-orders') {
        try { extras.attachments = (await api.get(`/purchase-orders/${row.id}/attachments`)).data.data || [] } catch { extras.attachments = [] }
      }
      setDetail({ ...record, ...extras })
    } catch { /* list data remains useful */ }
  }
  const pathFor = (row: AnyRow) => kind === 'quotations' ? `/quotes/${row.id}` : `${config.api}/${row.id}`
  const printPathFor = (row: AnyRow) => kind === 'quotations' ? `/quotes/${row.id}/print` : `${config.api}/${row.id}/print`
  const toggle = (id: string) => setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const toggleFavorite = (id: string) => setFavorites(current => {
    const next = new Set(current); next.has(id) ? next.delete(id) : next.add(id)
    localStorage.setItem(`ew-favorites-${kind}`, JSON.stringify([...next])); return next
  })
  const allChecked = rows.length > 0 && rows.every(r => selected.has(r.id))
  const visiblePages = useMemo(() => Array.from({ length: Math.min(5, pages) }, (_, i) => Math.min(Math.max(1, page - 2) + i, pages)).filter((v, i, a) => a.indexOf(v) === i), [page, pages])

  const handleImport = () => {
    if (kind === 'quotations') setQuoteImport(true)
    else if (kind === 'orders') setOrderImport(true)
  }

  const updateSelectedStatus = async (nextStatus: string) => {
    if (!nextStatus || !selected.size) return
    try {
      await Promise.all([...selected].map(id => api.patch(`${config.api}/${id}/status`, { status: nextStatus })))
      toast.success(`${selected.size} record${selected.size === 1 ? '' : 's'} updated`)
      setSelected(new Set()); await load()
    } catch (error: any) { toast.error(error.response?.data?.message || 'Status update failed') }
  }

  const clearFilters = () => {
    setSearch(''); setStatus('All'); setCustomer('All'); setProduct('All'); setSource('All')
    setPeriod('all'); setDateFrom(''); setDateTo(''); setPage(1)
  }

  return <div className={`ew-page ${active ? 'ew-with-drawer' : ''}`}>
    <main className="ew-main">
      <div className="ew-actions">
        <label className="ew-search"><Search size={17}/><input ref={searchInputRef} value={search} onChange={e => setSearch(e.target.value)} placeholder={config.search}/>{search ? <button onClick={() => setSearch('')} aria-label="Clear search"><X size={15}/></button> : <kbd>Ctrl K</kbd>}</label>
        {(kind === 'quotations' || kind === 'orders') && <button className="ew-btn" onClick={handleImport}><Upload size={15}/>Import {config.title}</button>}
        <button className="ew-btn" onClick={() => downloadCsv(`${kind}.csv`, filteredRows)}><Download size={15}/>Export</button>
        <button className="ew-btn ew-primary" onClick={() => navigate(config.newPath)}><Plus size={16}/>{config.newLabel}</button>
      </div>

      <div className="ew-period" role="group" aria-label="Date period">
        {([['today', 'Today'], ['week', 'This Week'], ['month', 'This Month'], ['custom', 'Custom'], ['all', 'All Time']] as [Period, string][]).map(([value, label]) => <button key={value} className={period === value ? 'active' : ''} onClick={() => setPeriod(value)}>{label}</button>)}
      </div>

      <section className="ew-kpis">
        {config.kpis.map(({ label, icon: Icon, value, tone }) => <article className="ew-kpi" key={label}>
          <span className={`ew-kpi-icon ew-${tone}`}><Icon size={19}/></span><span><small>{label}</small><strong>{value(filteredRows, total)}</strong><em>{period === 'all' ? 'All-time total' : 'Selected period'}</em></span>
        </article>)}
      </section>

      <section className="ew-filters">
        <label><span>Status</span><select value={status} onChange={e => setStatus(e.target.value)}><option>All</option>{config.statuses.map(s => <option key={s}>{s}</option>)}</select></label>
        <label><span>Customer / Vendor</span><select value={customer} onChange={e => setCustomer(e.target.value)}><option>All</option>{customers.map(v => <option key={v}>{v}</option>)}</select></label>
        <label><span>Product Type</span><select value={product} onChange={e => setProduct(e.target.value)}><option>All</option>{products.map(v => <option value={v} key={v}>{titleCase(v)}</option>)}</select></label>
        <label><span>Source</span><select value={source} onChange={e => setSource(e.target.value)}><option>All</option>{sources.map(v => <option value={v} key={v}>{titleCase(v)}</option>)}</select></label>
        {period === 'custom' ? <><label className="ew-date"><span>From</span><input type="date" value={dateFrom} max={dateTo || undefined} onChange={e => setDateFrom(e.target.value)}/></label><label className="ew-date"><span>To</span><input type="date" value={dateTo} min={dateFrom || undefined} onChange={e => setDateTo(e.target.value)}/></label></> : <div className="ew-range-label"><CalendarDays size={15}/><span>{periodRange[0] ? `${date(periodRange[0])} – ${date(periodRange[1])}` : 'All dates'}</span></div>}
        <button className="ew-btn ew-clear" onClick={clearFilters}>Clear Filters</button>
      </section>

      <section className="ew-bulk">
        <strong>{selected.size} selected</strong>
        <select aria-label="Update selected status" disabled={!selected.size} defaultValue="" onChange={e => { updateSelectedStatus(e.target.value); e.currentTarget.value = '' }}><option value="" disabled>Update status…</option>{config.statuses.map(s => <option key={s}>{s}</option>)}</select>
        <button className="ew-btn" disabled={!selected.size} onClick={() => downloadCsv(`${kind}-selected.csv`, allRows.filter(r => selected.has(r.id)))}><Download size={14}/>Export selected</button><span/>
        <div className="ew-columns"><button className="ew-btn" onClick={() => setColumnsOpen(v => !v)}>Columns <ChevronDown size={13}/></button>{columnsOpen && <div className="ew-columns-menu"><header><strong>Visible columns</strong><button onClick={() => setColumnsOpen(false)}><X size={14}/></button></header>{config.columns.map(c => <label key={c.key}><input type="checkbox" checked={visibleColumns.has(c.key)} onChange={() => setVisibleColumns(current => { const next = new Set(current); next.has(c.key) ? next.delete(c.key) : next.add(c.key); return next })}/>{c.label}</label>)}</div>}</div>
      </section>

      <section className="ew-table-card">
        <div className="ew-table-scroll"><table className="ew-table"><thead><tr>
          <th><input type="checkbox" checked={allChecked} onChange={() => setSelected(allChecked ? new Set() : new Set(rows.map(r => r.id)))}/></th><th aria-label="Favourite"></th>
          {shownColumns.map(c => <th key={c.key} className={c.numeric ? 'numeric' : ''}>{c.label}</th>)}<th>Actions</th>
        </tr></thead><tbody>
          {loading && Array.from({ length: 6 }).map((_, i) => <tr key={i} className="ew-skeleton"><td colSpan={shownColumns.length + 3}><span/></td></tr>)}
          {!loading && rows.length === 0 && <tr><td className="ew-empty" colSpan={shownColumns.length + 3}><strong>No matching records</strong><span>Try changing the period or clearing your filters.</span><button onClick={clearFilters}>Clear filters</button></td></tr>}
          {!loading && rows.map(row => <tr key={row.id} className={active?.id === row.id ? 'active' : ''} onClick={() => openDetail(row)}>
            <td onClick={e => e.stopPropagation()}><input type="checkbox" checked={selected.has(row.id)} onChange={() => toggle(row.id)}/></td><td onClick={e => e.stopPropagation()}><button className={`ew-star ${favorites.has(row.id) ? 'active' : ''}`} onClick={() => toggleFavorite(row.id)} aria-label={favorites.has(row.id) ? 'Remove from favourites' : 'Add to favourites'} title={favorites.has(row.id) ? 'Remove from favourites' : 'Add to favourites'}><Star size={14}/></button></td>
            {shownColumns.map(c => <td key={c.key} className={c.numeric ? 'numeric' : ''}>{c.render ? c.render(row) : common.empty(row, c.key)}</td>)}
            <td onClick={e => e.stopPropagation()}><button className="ew-icon-btn" onClick={() => navigate(pathFor(row))} aria-label="Open full record" title="Open full record"><FileText size={16}/></button></td>
          </tr>)}
        </tbody></table></div>
        <footer className="ew-pagination"><span>Showing {total ? (page - 1) * pageSize + 1 : 0} to {Math.min(page * pageSize, total)} of <strong>{total}</strong> {config.title.toLowerCase()}</span><div><label>Rows per page <select value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setPage(1) }}><option>10</option><option>25</option><option>50</option></select></label><button disabled={page === 1} onClick={() => setPage(1)}><ChevronFirst/></button><button disabled={page === 1} onClick={() => setPage(p => p - 1)}><ChevronLeft/></button>{visiblePages.map(p => <button className={p === page ? 'active' : ''} onClick={() => setPage(p)} key={p}>{p}</button>)}<button disabled={page === pages} onClick={() => setPage(p => p + 1)}><ChevronRight/></button><button disabled={page === pages} onClick={() => setPage(pages)}><ChevronLast/></button></div></footer>
      </section>
    </main>

    {active && <>
      <button className="ew-drawer-scrim" aria-label={`Close ${config.title.slice(0, -1).toLowerCase()} summary`} onClick={() => { setActive(null); setDetail(null) }}/>
      <aside className="ew-drawer" role="dialog" aria-modal="true" aria-label={`${config.title.slice(0, -1)} summary`}>
      <header><div><small>{config.title.slice(0, -1)} Summary</small><h3>{active[config.numberKey]}</h3><div className="ew-drawer-badges"><Badge>{titleCase(active.status)}</Badge>{kind === 'quotations' && <Badge>Revision {active.revision_number ?? 0}</Badge>}{kind !== 'quotations' && active.payment_status && <Badge>{titleCase(active.payment_status)}</Badge>}</div></div><button className="ew-icon-btn ew-drawer-close" onClick={() => { setActive(null); setDetail(null) }} aria-label="Close summary"><X size={20}/></button></header>
      <div className="ew-drawer-actions"><button onClick={() => navigate(printPathFor(active))} title="Print or preview"><Printer size={16}/><span>Print</span></button><button onClick={() => downloadCsv(`${active[config.numberKey]}.csv`, [detail || active])} title="Export this record"><Download size={16}/><span>Export</span></button></div>
      <WorkflowDrawerContent kind={kind} row={detail || active} navigate={navigate}/>
      {kind === 'quotations' && <button className="ew-full" onClick={() => navigate(pathFor(active))}>View Full History</button>}
      </aside>
    </>}
    {kind === 'quotations' && quoteImport && (
      <BulkUploadModal onClose={() => setQuoteImport(false)} />
    )}
    {kind === 'orders' && orderImport && (
      <BulkUploadOrdersModal onClose={() => setOrderImport(false)} />
    )}
  </div>
}

type DrawerField = { label: string; value: React.ReactNode }
const shown = (value: any) => value === null || value === undefined || value === '' ? '—' : value
const first = (row: AnyRow, ...keys: string[]) => shown(pick(row, ...keys))
const sum = (rows: AnyRow[] | undefined, key: string) => (rows || []).reduce((total, item) => total + Number(item?.[key] || 0), 0)
const location = (row: AnyRow) => [pick(row, 'shipping_city', 'city'), pick(row, 'shipping_state', 'state'), pick(row, 'country')].filter(Boolean).join(', ') || '—'

function DrawerSection({ title, fields, children, tone = '' }: { title: string; fields?: DrawerField[]; children?: React.ReactNode; tone?: string }) {
  return <section className={`ew-drawer-section ${tone}`}><h4>{title}</h4>{fields?.map(field => <div className="ew-detail-row" key={field.label}><span>{field.label}</span><strong>{shown(field.value)}</strong></div>)}{children}</section>
}

function ItemsSection({ items = [] }: { items?: AnyRow[] }) {
  return <DrawerSection title={`Items / Products (${items.length})`}><div className="ew-detail-items-head"><span>Item</span><span>Qty</span><span>Amount</span></div>{items.length ? <div className="ew-detail-items">{items.map((item, index) => <div key={item.id || index}><span><b>{first(item, 'description', 'category', 'product_type')}</b><small>{[item.artwork_count ? `${item.artwork_count} artworks` : '', item.sizes || item.colors || ''].filter(Boolean).join(' · ') || '—'}</small></span><strong>{first(item, 'qty', 'quantity')}</strong><strong>{money(pick(item, 'amount') ?? Number(item.unit_price || 0) * Number(item.qty || 0))}</strong></div>)}</div> : <p className="ew-detail-empty">No items recorded.</p>}</DrawerSection>
}

function DocumentsSection({ title = 'Attachments', documents = [], generated, placeholders = [], navigate }: { title?: string; documents?: AnyRow[]; generated?: { label: string; path: string }; placeholders?: string[]; navigate: (path: string) => void }) {
  const docs = documents || []
  return <DrawerSection title={`${title}${docs.length ? ` (${docs.length})` : ''}`}><div className="ew-documents">{generated && <button onClick={() => navigate(generated.path)}><FileText size={16}/><span>{generated.label}</span><Download size={15}/></button>}{docs.map((doc, index) => <a key={doc.id || index} href={doc.file_url || '#'} target="_blank" rel="noreferrer"><FileText size={16}/><span>{first(doc, 'filename', 'name', 'artwork_no')}</span><Download size={15}/></a>)}{placeholders.map(label => <button className="empty" disabled key={label}><FileText size={16}/><span>{label}</span><span>—</span></button>)}{!generated && !docs.length && !placeholders.length && <p className="ew-detail-empty">No attachments.</p>}</div></DrawerSection>
}

function NotesSection({ row, label = 'Notes' }: { row: AnyRow; label?: string }) {
  return <DrawerSection title={label}><p className="ew-detail-notes">{first(row, 'customer_notes', 'notes', 'internal_notes', 'special_instructions')}</p></DrawerSection>
}

function WorkflowDrawerContent({ kind, row, navigate }: { kind: EnterpriseWorkflowKind; row: AnyRow; navigate: (path: string) => void }) {
  const customer = row.linked_customer || {}
  const items = row.items || []
  const number = row[CONFIG[kind].numberKey]
  if (kind === 'quotations') return <>
    <DrawerSection title="Overview" fields={[
      { label: 'Quote Date', value: date(row.created_at) }, { label: 'Valid Until', value: date(row.valid_until) }, { label: 'Status', value: <Badge>{titleCase(row.status)}</Badge> },
      { label: 'Customer Response', value: first(row, 'customer_response') }, { label: 'Source', value: first(row, 'customer_source', 'source') }, { label: 'Sent Via', value: first(row, 'sent_via') },
      { label: 'Payment Terms', value: first(row, 'payment_terms') }, { label: 'Shipping', value: Number(row.estimated_shipping || row.shipping_amount || 0) ? money(row.estimated_shipping || row.shipping_amount) : 'Not included' },
      { label: 'Sales Agent', value: first(row, 'sales_agent_name', 'created_by_name', 'agent_name') },
    ]}/>
    <DrawerSection title="Customer / Lead" fields={[
      { label: 'Customer Name', value: first(row, 'customer_name', 'company_name', 'supplier_name') }, { label: 'Email', value: first(row, 'billing_email', 'email') },
      { label: 'Phone', value: first(row, 'contact_number', 'phone', 'whatsapp') }, { label: 'Location', value: location(row) }, { label: 'Language', value: first(row, 'language') },
    ]}/>
    <ItemsSection items={items}/>
    <DrawerSection title="Total Amount" fields={[{ label: 'Total', value: `${money(row.total)} ${row.currency || 'USD'}` }]}/>
    <NotesSection row={row}/>
    <DocumentsSection documents={row.attachments} navigate={navigate}/>
  </>

  if (kind === 'invoices') return <>
    <DrawerSection title="Main Information" fields={[
      { label: 'Invoice Date', value: date(pick(row, 'issue_date', 'invoice_date')) }, { label: 'Due Date', value: date(row.due_date) }, { label: 'Quotation ID', value: first(row, 'quote_number') },
      { label: 'Customer', value: first(row, 'customer_display_name', 'customer_name') }, { label: 'Contact', value: first(row, 'contact_person') === '—' ? first(customer, 'contact_person') : first(row, 'contact_person') },
      { label: 'Phone', value: first(row, 'contact_number', 'phone') === '—' ? first(customer, 'primary_phone', 'phone') : first(row, 'contact_number', 'phone') }, { label: 'Company', value: first(row, 'company_name') === '—' ? first(customer, 'company_name', 'company') : first(row, 'company_name') },
      { label: 'Source', value: first(row, 'customer_source', 'source') === '—' ? first(customer, 'source') : first(row, 'customer_source', 'source') }, { label: 'Sales Agent', value: first(row, 'sales_agent_display_name', 'sales_agent_name', 'agent_name') },
    ]}/>
    <DrawerSection title="Financial Summary" fields={[
      { label: 'Subtotal', value: money(row.subtotal) }, { label: 'Shipping', value: money(pick(row, 'shipping_charges', 'original_shipping_charges') || 0) },
      { label: `Tax (${Number(row.tax_pct || 0)}%)`, value: money(row.tax_amt) }, { label: 'Total Amount', value: money(row.total) },
      { label: 'Amount Paid', value: money(row.amount_paid) }, { label: 'Balance Due', value: money(row.balance_due) },
    ]}/>
    <ItemsSection items={items}/>
    <DrawerSection title="Payment History"><div className="ew-payment-history">{row.payments?.length ? row.payments.map((payment: AnyRow, index: number) => <div key={payment.id || index}><Badge>{titleCase(payment.status || 'Received')}</Badge><span>{date(payment.paid_at)}</span><strong>{money(payment.amount)}</strong></div>) : <p className="ew-detail-empty">No payments recorded.</p>}</div></DrawerSection>
    <NotesSection row={row}/>
    <DocumentsSection documents={[]} generated={{ label: `Invoice_${number}.pdf`, path: `/invoices/${row.id}/print` }} navigate={navigate}/>
    <DrawerSection title="Related"><div className="ew-related-actions">{row.quote_id ? <button onClick={() => navigate(`/quotes/${row.quote_id}`)}>View Quotation</button> : <button disabled>View Quotation</button>}<button onClick={() => navigate(`/invoices/${row.id}`)}>View History</button></div></DrawerSection>
  </>

  if (kind === 'orders') return <>
    <DrawerSection title="Customer Information" fields={[
      { label: 'Customer No', value: first(customer, 'customer_number') }, { label: 'Company Name', value: first(customer, 'company_name', 'company') },
      { label: 'Contact Person', value: first(row, 'contact_name') === '—' ? first(customer, 'contact_person') : first(row, 'contact_name') }, { label: 'Email ID', value: first(row, 'contact_email') === '—' ? first(customer, 'email') : first(row, 'contact_email') },
      { label: 'Phone No', value: first(row, 'contact_phone') === '—' ? first(customer, 'primary_phone', 'phone') : first(row, 'contact_phone') }, { label: 'Source', value: first(customer, 'source') },
      { label: 'Agent', value: first(row, 'agent_name') }, { label: 'Address', value: first(row, 'shipping_address') === '—' ? [customer.address_line1, customer.city, customer.state, customer.zip, customer.country].filter(Boolean).join(', ') || '—' : first(row, 'shipping_address') },
    ]}/>
    <DrawerSection title="Order Information" fields={[
      { label: 'Order Date', value: date(row.order_date) }, { label: 'Order Value', value: money(row.total) }, { label: 'Payment Date', value: date(row.payment_date) },
      { label: 'Payment Terms', value: first(row, 'payment_terms') }, { label: 'Payment Method', value: first(row, 'payment_method') }, { label: 'PO Issuance Date', value: date(row.purchase_orders?.[0]?.created_at || row.po_issued_at) },
    ]}/>
    <DrawerSection title="Order Details" fields={[
      { label: 'Product Type', value: titleCase(first(row, 'order_type')) }, { label: 'Item / Qty', value: `${items.length || '—'} items / ${sum(items, 'qty') || '—'} pcs` },
      { label: 'Status', value: <Badge>{titleCase(row.status)}</Badge> }, { label: 'Tracking ID', value: first(row, 'tracking_number') },
    ]}/>
  </>

  const coveredOrders = row.orders || []
  const totalQty = coveredOrders.reduce((total: number, order: AnyRow) => total + Number(order.qty || 0), 0) || sum(items, 'qty')
  const instructions = String(pick(row, 'terms_conditions', 'notes') || '').split(/\n|•/).map((text: string) => text.trim().replace(/^[-*]\s*/, '')).filter(Boolean)
  return <>
    <DrawerSection title="PO Details" fields={[
      { label: 'PO #', value: first(row, 'source_po_number', 'po_number') }, { label: 'PO Issued Date', value: date(row.order_date || row.created_at) },
      { label: 'Sales Order No', value: coveredOrders.map((order: AnyRow) => order.order_number).filter(Boolean).join(', ') || first(row, 'order_number') }, { label: 'Supplier Name', value: first(row, 'supplier_name', 'vendor_name') },
      { label: 'Product Type', value: titleCase(first(row, 'print_type', 'po_type')) }, { label: 'Status', value: <Badge>{titleCase(row.status)}</Badge> },
    ]}/>
    <DrawerSection title="Order Details" fields={[
      { label: 'Order Type', value: titleCase(first(row, 'print_type', 'po_type')) }, { label: 'No. of Artworks', value: row.order_total_artworks ?? row.total_artworks ?? row.artworks?.length ?? '—' },
      { label: 'Total Qty', value: totalQty || '—' }, { label: 'No. of Gangsheets', value: row.total_gangsheets ?? row.fragments?.length ?? '—' },
      { label: 'Total Gangsheet Length', value: first(row, 'gangsheet_lengths') },
    ]}/>
    <DrawerSection title="PO Instructions" tone="ew-instructions">{instructions.length ? <ul>{instructions.map((instruction: string, index: number) => <li key={index}>{instruction}</li>)}</ul> : <p className="ew-detail-empty">No instructions recorded.</p>}</DrawerSection>
    <DrawerSection title="Shipping Information" fields={[
      { label: 'Shipping By', value: first(row, 'shipping_by', 'shipping_method') }, { label: 'Service Type', value: first(row, 'service_type', 'carrier') },
      { label: 'Tracking ID', value: first(row, 'tracking_id', 'tracking_number') }, { label: 'Tracking Status', value: first(row, 'tracking_status', 'status') },
      { label: 'Estimated Delivery', value: date(row.expected_date) },
    ]}/>
    <DocumentsSection title="Documents" documents={row.attachments} generated={{ label: 'Purchase Order (PDF)', path: `/purchase-orders/${row.id}/print` }} placeholders={row.attachments?.some((doc: AnyRow) => /shipping|label/i.test(doc.filename || doc.name || '')) ? [] : ['Shipping Label (PDF)']} navigate={navigate}/>
  </>
}
