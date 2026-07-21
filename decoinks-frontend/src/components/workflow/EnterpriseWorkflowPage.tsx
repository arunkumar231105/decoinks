import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  BadgeCheck, Box, CalendarDays, ChevronDown, ChevronFirst, ChevronLast,
  ChevronLeft, ChevronRight, CircleDollarSign, Clock3, Download, FileText,
  MoreHorizontal, PackageCheck, Plus, Search, Send, ShoppingBag, Star,
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
const date = (value: any) => value ? new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'
const titleCase = (value: any) => String(value || '—').replaceAll('_', ' ').replace(/\b\w/g, s => s.toUpperCase())
const pick = (row: AnyRow, ...keys: string[]) => keys.map(k => row?.[k]).find(v => v !== null && v !== undefined && v !== '')
const countStatus = (rows: AnyRow[], ...needles: string[]) => rows.filter(r => needles.some(n => String(r.status || '').toLowerCase().includes(n.toLowerCase()))).length

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
      { label: 'Saved (Draft)', icon: FileText, value: r => countStatus(r, 'draft'), tone: 'slate' },
      { label: 'Sent', icon: Send, value: r => countStatus(r, 'sent'), tone: 'green' },
      { label: 'Sent via Messenger', icon: Send, value: r => r.filter(x => /messenger/i.test(String(pick(x, 'sent_via', 'source') || ''))).length, tone: 'blue' },
      { label: 'Converted', icon: BadgeCheck, value: r => countStatus(r, 'approved', 'converted'), tone: 'green' },
      { label: 'Pending', icon: Clock3, value: r => countStatus(r, 'pending'), tone: 'amber' },
      { label: 'Discontinued', icon: X, value: r => countStatus(r, 'rejected', 'expired', 'discontinued'), tone: 'red' },
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
    statuses: ['Draft', 'Sent', 'Paid', 'Partial', 'Overdue', 'Cancelled'],
    kpis: [
      { label: 'Total Invoices', icon: FileText, value: (_, t) => t, tone: 'blue' },
      { label: 'Sent', icon: Send, value: r => countStatus(r, 'sent'), tone: 'blue' },
      { label: 'Positive', icon: BadgeCheck, value: r => r.filter(x => /positive/i.test(String(x.customer_response || ''))).length, tone: 'green' },
      { label: 'Negative', icon: X, value: r => r.filter(x => /negative/i.test(String(x.customer_response || ''))).length, tone: 'red' },
      { label: 'Unresponsive', icon: Clock3, value: r => r.filter(x => /unresponsive/i.test(String(x.customer_response || ''))).length, tone: 'amber' },
      { label: 'Paid', icon: CircleDollarSign, value: r => countStatus(r, 'paid'), tone: 'green' },
      { label: 'Amount', icon: CircleDollarSign, value: r => money(r.reduce((a, x) => a + Number(x.total || 0), 0)), tone: 'blue' },
      { label: 'Outstanding', icon: Clock3, value: r => money(r.reduce((a, x) => a + Number(x.balance_due || 0), 0)), tone: 'purple' },
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
    statuses: ['Draft', 'Approved', 'Pending', 'In Production', 'Shipped', 'Delivered', 'Cancelled'],
    kpis: [
      { label: 'Orders', icon: ShoppingBag, value: (_, t) => t, tone: 'blue' },
      { label: 'Amount', icon: CircleDollarSign, value: r => money(r.reduce((a, x) => a + Number(x.total || 0), 0)), tone: 'purple' },
      { label: 'Approved', icon: BadgeCheck, value: r => countStatus(r, 'approved'), tone: 'green' },
      { label: 'Pending', icon: Clock3, value: r => countStatus(r, 'pending', 'draft'), tone: 'amber' },
      { label: 'PO Issued', icon: FileText, value: r => r.filter(x => pick(x, 'po_number', 'purchase_order_number')).length, tone: 'red' },
      { label: 'In Production', icon: Box, value: r => countStatus(r, 'production'), tone: 'purple' },
      { label: 'Shipped', icon: Truck, value: r => countStatus(r, 'ship', 'transit'), tone: 'blue' },
      { label: 'Delivered', icon: PackageCheck, value: r => countStatus(r, 'deliver', 'complete'), tone: 'green' },
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
    statuses: ['Draft', 'Issued', 'Pending', 'In Production', 'Shipped', 'Delivered', 'On Hold', 'Cancelled'],
    kpis: [
      { label: 'Total PO Issued', icon: FileText, value: (_, t) => t, tone: 'blue' },
      { label: 'PO Issued', icon: FileText, value: r => countStatus(r, 'issued', 'approved'), tone: 'red' },
      { label: 'Pending', icon: Clock3, value: r => countStatus(r, 'pending', 'draft'), tone: 'amber' },
      { label: 'In Production', icon: Box, value: r => countStatus(r, 'production'), tone: 'purple' },
      { label: 'Shipped', icon: Truck, value: r => countStatus(r, 'ship', 'transit'), tone: 'blue' },
      { label: 'Delivered', icon: PackageCheck, value: r => countStatus(r, 'deliver', 'received'), tone: 'green' },
      { label: 'On Hold', icon: Clock3, value: r => countStatus(r, 'hold'), tone: 'amber' },
      { label: 'Cancelled', icon: X, value: r => countStatus(r, 'cancel'), tone: 'red' },
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

export function EnterpriseWorkflowPage({ kind }: { kind: EnterpriseWorkflowKind }) {
  const config = CONFIG[kind]
  const navigate = useNavigate()
  const [rows, setRows] = useState<AnyRow[]>([])
  const [analytics, setAnalytics] = useState<AnyRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('All')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [active, setActive] = useState<AnyRow | null>(null)
  const [detail, setDetail] = useState<AnyRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [quoteImport, setQuoteImport] = useState(false)
  const [orderImport, setOrderImport] = useState(false)
  const firstLoad = useRef(true)

  const load = async () => {
    setLoading(true)
    try {
      const params: AnyRow = { page, limit: PAGE_SIZE }
      if (search.trim()) params.search = search.trim()
      if (status !== 'All') params.status = status
      const { data } = await api.get(config.api, { params })
      setRows(data.data.rows || [])
      setTotal(Number(data.data.total || 0))
      if (firstLoad.current) {
        firstLoad.current = false
        const all = await api.get(config.api, { params: { page: 1, limit: 1000 } })
        setAnalytics(all.data.data.rows || [])
      }
    } catch { toast.error(`Failed to load ${config.title.toLowerCase()}`) }
    finally { setLoading(false) }
  }

  useEffect(() => { const timer = setTimeout(load, 260); return () => clearTimeout(timer) }, [kind, page, search, status])
  useEffect(() => { setPage(1); setActive(null); setDetail(null); firstLoad.current = true }, [kind])

  const openDetail = async (row: AnyRow) => {
    setActive(row); setDetail(row)
    try { const { data } = await api.get(`${config.api}/${row.id}`); setDetail(data.data || row) } catch { /* list data remains useful */ }
  }
  const pathFor = (row: AnyRow) => kind === 'quotations' ? `/quotes/${row.id}` : `${config.api}/${row.id}`
  const toggle = (id: string) => setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const allChecked = rows.length > 0 && rows.every(r => selected.has(r.id))
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const visiblePages = useMemo(() => Array.from({ length: Math.min(5, pages) }, (_, i) => Math.min(Math.max(1, page - 2) + i, pages)).filter((v, i, a) => a.indexOf(v) === i), [page, pages])

  const handleImport = () => {
    if (kind === 'quotations') setQuoteImport(true)
    else if (kind === 'orders') setOrderImport(true)
    else toast.info(`Import for ${config.title} is not enabled in this workspace yet.`)
  }

  return <div className={`ew-page ${active ? 'ew-with-drawer' : ''}`}>
    <main className="ew-main">
      <div className="ew-actions">
        <label className="ew-search"><Search size={17}/><input value={search} onChange={e => { setSearch(e.target.value); setPage(1) }} placeholder={config.search}/><kbd>Ctrl K</kbd></label>
        <button className="ew-btn" onClick={handleImport}><Upload size={15}/>Import {kind === 'purchase-orders' ? 'POs' : config.title}</button>
        <button className="ew-btn" onClick={() => downloadCsv(`${kind}.csv`, analytics)}><Download size={15}/>Export<ChevronDown size={13}/></button>
        <button className="ew-btn ew-primary" onClick={() => navigate(config.newPath)}><Plus size={16}/>{config.newLabel}<ChevronDown size={13}/></button>
      </div>

      <div className="ew-period"><button className="active">Today</button><button>This Week</button><button>This Month</button><button>Custom</button><button aria-label="Pick date"><CalendarDays size={14}/></button></div>

      <section className="ew-kpis">
        {config.kpis.map(({ label, icon: Icon, value, tone }) => <button className="ew-kpi" key={label}>
          <span className={`ew-kpi-icon ew-${tone}`}><Icon size={19}/></span><span><small>{label}</small><strong>{value(analytics, total)}</strong><em>Current total</em></span>
        </button>)}
      </section>

      <section className="ew-filters">
        <label><span>Status</span><select value={status} onChange={e => { setStatus(e.target.value); setPage(1) }}><option>All</option>{config.statuses.map(s => <option key={s}>{s}</option>)}</select></label>
        <label><span>Customer / Vendor</span><select><option>All</option></select></label>
        <label><span>Product Type</span><select><option>All</option></select></label>
        <label><span>Source</span><select><option>All</option></select></label>
        <label className="ew-date"><span>Date Range</span><input type="date"/></label>
        <button className="ew-btn ew-clear" onClick={() => { setSearch(''); setStatus('All'); setPage(1) }}>Clear Filters</button>
      </section>

      <section className="ew-bulk">
        <strong>{selected.size} selected</strong><button className="ew-btn">Update Status</button><button className="ew-btn"><Download size={14}/>Export</button><span/><button className="ew-btn">Columns</button>
      </section>

      <section className="ew-table-card">
        <div className="ew-table-scroll"><table className="ew-table"><thead><tr>
          <th><input type="checkbox" checked={allChecked} onChange={() => setSelected(allChecked ? new Set() : new Set(rows.map(r => r.id)))}/></th><th aria-label="Favourite"></th>
          {config.columns.map(c => <th key={c.key} className={c.numeric ? 'numeric' : ''}>{c.label}</th>)}<th>Actions</th>
        </tr></thead><tbody>
          {loading && Array.from({ length: 6 }).map((_, i) => <tr key={i} className="ew-skeleton"><td colSpan={config.columns.length + 3}><span/></td></tr>)}
          {!loading && rows.length === 0 && <tr><td className="ew-empty" colSpan={config.columns.length + 3}>No {config.title.toLowerCase()} match the selected filters.</td></tr>}
          {!loading && rows.map(row => <tr key={row.id} className={active?.id === row.id ? 'active' : ''} onClick={() => openDetail(row)}>
            <td onClick={e => e.stopPropagation()}><input type="checkbox" checked={selected.has(row.id)} onChange={() => toggle(row.id)}/></td><td><Star size={14}/></td>
            {config.columns.map(c => <td key={c.key} className={c.numeric ? 'numeric' : ''}>{c.render ? c.render(row) : common.empty(row, c.key)}</td>)}
            <td onClick={e => e.stopPropagation()}><button className="ew-icon-btn" onClick={() => navigate(pathFor(row))} aria-label="View record"><MoreHorizontal size={17}/></button></td>
          </tr>)}
        </tbody></table></div>
        <footer className="ew-pagination"><span>Showing {total ? (page - 1) * PAGE_SIZE + 1 : 0} to {Math.min(page * PAGE_SIZE, total)} of <strong>{total}</strong> {config.title.toLowerCase()}</span><div><label>Rows per page <select value={PAGE_SIZE} disabled><option>{PAGE_SIZE}</option></select></label><button disabled={page === 1} onClick={() => setPage(1)}><ChevronFirst/></button><button disabled={page === 1} onClick={() => setPage(p => p - 1)}><ChevronLeft/></button>{visiblePages.map(p => <button className={p === page ? 'active' : ''} onClick={() => setPage(p)} key={p}>{p}</button>)}<button disabled={page === pages} onClick={() => setPage(p => p + 1)}><ChevronRight/></button><button disabled={page === pages} onClick={() => setPage(pages)}><ChevronLast/></button></div></footer>
      </section>
    </main>

    {active && <aside className="ew-drawer">
      <header><div><small>{config.title.slice(0, -1)} Summary</small><h3>{active[config.numberKey]}</h3><Badge>{titleCase(active.status)}</Badge></div><button className="ew-icon-btn" onClick={() => { setActive(null); setDetail(null) }}><X size={18}/></button></header>
      <div className="ew-drawer-actions"><button><FileText size={15}/></button><button><Download size={15}/></button><button><MoreHorizontal size={15}/></button></div>
      <DrawerSection title="Overview" row={detail || active} fields={[
        ['Record No.', config.numberKey], ['Date', config.dateKey], ['Status', 'status'], ['Customer', 'customer_name'], ['Vendor', 'display_vendor_name'], ['Product Type', 'order_type'], ['Total Amount', 'total'], ['Due Date', 'due_date'], ['Payment Status', 'payment_status'], ['Sales Agent', 'agent_name'],
      ]}/>
      <DrawerSection title="Additional Information" row={detail || active} fields={[
        ['Quote', 'quote_number'], ['Order', 'order_number'], ['Tracking ID', 'tracking_number'], ['Shipping', 'shipping_method'], ['Notes', 'notes'], ['Last Updated', 'updated_at'],
      ]}/>
      <button className="ew-full" onClick={() => navigate(pathFor(active))}>View Full Details</button>
    </aside>}
    {kind === 'quotations' && quoteImport && (
      <BulkUploadModal onClose={() => setQuoteImport(false)} />
    )}
    {kind === 'orders' && orderImport && (
      <BulkUploadOrdersModal onClose={() => setOrderImport(false)} />
    )}
  </div>
}

function DrawerSection({ title, row, fields }: { title: string; row: AnyRow; fields: [string, string][] }) {
  const visible = fields.map(([label, key]) => [label, row?.[key]] as const).filter(([, value]) => value !== null && value !== undefined && value !== '')
  if (!visible.length) return null
  return <section className="ew-drawer-section"><h4>{title}</h4>{visible.map(([label, value]) => <div key={label}><span>{label}</span><strong>{/date|_at/i.test(label) ? date(value) : /amount|total/i.test(label) ? money(value) : titleCase(value)}</strong></div>)}</section>
}
