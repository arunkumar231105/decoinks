import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, Divider, Menu, MenuItem } from '@mui/material'
import {
  ChevronLeft,
  ChevronRight,
  Filter,
  MoreHorizontal,
  Plus,
  Search,
  Upload,
} from 'lucide-react'
import toast from '../utils/toast'
import { cn } from '../utils/cn'
import { api } from '../services/api'
import { BulkUploadOrdersModal } from '../components/BulkUploadOrdersModal'

type WorkflowKind = 'invoices' | 'orders' | 'purchase-orders'

interface WorkflowRecord {
  id: string
  primaryId: string
  customer: string
  linked: string
  owner: string
  status: string
  amount: string
  date: string
  due: string
  meta: string
  sourceId?: string
  gangsheets?: number
  artworks?: number
  shipping?: string
  paymentState?: string
}

interface KindConfig {
  title: string
  subtitle: string
  searchPlaceholder: string
  newLabel: string
  newPath: string
  primaryColumn: string
  linkedColumn: string
  amountColumn: string
  apiPath: string
  mapRow: (row: any) => WorkflowRecord
}

const fmtDate = (d: string | null) => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '-'
const fmtMoney = (n: any) => n != null ? `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2 })}` : '-'

const STATUS_TONES: Record<string, string> = {
  'Paid': 'green', 'Approved': 'green', 'Completed': 'green', 'Delivered': 'green', 'Acknowledged': 'green', 'Ready to Ship': 'green',
  'Sent': 'blue', 'In Production': 'blue', 'In Transit': 'blue', 'Label Created': 'blue',
  'Draft': 'slate', 'Not Started': 'slate',
  'Overdue': 'red', 'Rejected': 'red', 'Cancelled': 'red',
  'On Hold': 'amber', 'Free/Reprint': 'amber', 'Proofing': 'purple', 'Partial': 'purple',
}

function toneCls(status: string) {
  return `wf-status-${STATUS_TONES[status] ?? 'slate'}`
}

const KIND_CONFIGS: Record<WorkflowKind, KindConfig> = {
  invoices: {
    title: 'Invoices',
    subtitle: 'Track billing, payments, and customer follow-up.',
    searchPlaceholder: 'Search invoice, customer, or order...',
    newLabel: 'New Invoice',
    newPath: '/invoices/new',
    primaryColumn: 'Invoice',
    linkedColumn: 'Order',
    amountColumn: 'Total',
    apiPath: '/invoices',
    mapRow: (r) => ({
      id: r.id,
      primaryId: r.invoice_number,
      customer: r.customer_name ?? '-',
      linked: r.order_number ?? '-',
      owner: r.created_by_name ?? '-',
      status: r.status,
      amount: fmtMoney(r.total),
      date: fmtDate(r.invoice_date),
      due: fmtDate(r.due_date),
      meta: '',
    }),
  },
  orders: {
    title: 'Orders',
    subtitle: 'Manage production jobs from intake to delivery.',
    searchPlaceholder: 'Search order, customer, product...',
    newLabel: 'New Order',
    newPath: '/orders/new',
    primaryColumn: 'Order',
    linkedColumn: 'Type',
    amountColumn: 'Value',
    apiPath: '/orders',
    mapRow: (r) => ({
      id: r.id,
      primaryId: r.order_number,
      customer: r.customer_name ?? r.supplier_name ?? r.supplier_name_text ?? r.contact_name ?? '-',
      linked: r.order_type ?? '-',
      owner: r.agent_name ?? '-',
      status: r.status,
      amount: fmtMoney(r.total),
      date: fmtDate(r.order_date),
      due: fmtDate(r.due_date),
      meta: '',
    }),
  },
  'purchase-orders': {
    title: 'Purchase Orders',
    subtitle: 'DTF production, artworks, gangsheets, shipping and payments in one place.',
    searchPlaceholder: 'Search PO, client, vendor, or address...',
    newLabel: 'New PO',
    newPath: '/purchase-orders/new',
    primaryColumn: 'PO',
    linkedColumn: 'Order',
    amountColumn: 'Total',
    apiPath: '/purchase-orders',
    mapRow: (r) => ({
      id: r.id,
      primaryId: r.source_po_number ?? r.po_number,
      sourceId: r.source_po_number && r.source_po_number !== r.po_number ? r.po_number : undefined,
      customer: r.customer_name ?? '-',
      linked: r.display_vendor_name ?? r.vendor_name ?? r.supplier_name ?? '-',
      owner: r.created_by_name ?? '-',
      status: r.source_payment_status ?? r.status,
      amount: r.source_payment_status === 'Free/Reprint' ? 'Free' : fmtMoney(r.payment_received ?? r.total),
      date: fmtDate(r.order_date),
      due: r.required_dispatch_text ?? fmtDate(r.expected_date),
      meta: r.print_type ?? '',
      gangsheets: Number(r.total_gangsheets ?? 0),
      artworks: Number(r.total_artworks ?? 0),
      shipping: fmtMoney(r.shipping_charge),
      paymentState: r.payment_status,
    }),
  },
}

const PAGE_SIZE = 10

export function WorkflowListPage({ kind }: { kind: WorkflowKind }) {
  const navigate = useNavigate()
  const config = KIND_CONFIGS[kind]

  const [records, setRecords] = useState<WorkflowRecord[]>([])
  const [total, setTotal] = useState(0)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [statusFilter, setStatusFilter] = useState('All')
  const [filterAnchor, setFilterAnchor] = useState<HTMLElement | null>(null)
  const [menuAnchor, setMenuAnchor] = useState<{ el: HTMLElement; id: string; primaryId: string } | null>(null)
  const [loading, setLoading] = useState(false)
  const [allStatuses, setAllStatuses] = useState<string[]>(['All'])
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; primaryId: string } | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [bulkOrderModal, setBulkOrderModal] = useState(false)

  const totalPages = Math.ceil(total / PAGE_SIZE)

  const fetchRecords = async (p = page, q = search, sf = statusFilter) => {
    setLoading(true)
    try {
      const params: Record<string, any> = { page: p, limit: PAGE_SIZE }
      if (q) params.search = q
      if (sf !== 'All') params.status = sf
      const { data } = await api.get(config.apiPath, { params })
      const mapped = data.data.rows.map(config.mapRow)
      setRecords(mapped)
      setTotal(data.data.total)
      if (allStatuses.length <= 1 && mapped.length > 0) {
        const statuses = Array.from(new Set(data.data.rows.map((r: any) => r.status))) as string[]
        setAllStatuses(['All', ...statuses])
      }
    } catch {
      toast.error(`Failed to load ${config.title.toLowerCase()}`)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchRecords() }, [kind])
  const handleSearch = (v: string) => { setSearch(v); setPage(1); fetchRecords(1, v, statusFilter) }
  const handleFilter = (sf: string) => { setStatusFilter(sf); setPage(1); setFilterAnchor(null); fetchRecords(1, search, sf) }
  const handlePage = (p: number) => { setPage(p); fetchRecords(p, search, statusFilter) }

  const handleDelete = async () => {
    if (!confirmDelete) return
    setDeleting(true)
    try {
      await api.delete(`${config.apiPath}/${confirmDelete.id}`)
      toast.success(`${config.title.slice(0, -1)} deleted`)
      setConfirmDelete(null)
      fetchRecords(page, search, statusFilter)
    } catch (err: any) {
      toast.error(err.response?.data?.message ?? `Could not delete ${config.title.slice(0, -1).toLowerCase()}`)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="wf-page">
      <div className="cust-page-header">
        <div>
          <h2 className="cust-page-title">{config.title}</h2>
          <p className="cust-page-sub">{config.subtitle}</p>
        </div>
        <div className="cust-controls">
          <div className="cust-search">
            <Search size={14} />
            <input
              placeholder={config.searchPlaceholder}
              value={search}
              onChange={(e) => handleSearch(e.target.value)}
            />
          </div>
          <button
            className={cn('lb-action-btn', statusFilter !== 'All' && 'lb-action-btn-filtered')}
            onClick={(e) => setFilterAnchor(e.currentTarget)}
          >
            <Filter size={14} />
            {statusFilter === 'All' ? 'Filter' : statusFilter}
            <ChevronRight size={12} className="cust-filter-chevron" />
          </button>
          {kind === 'orders' && (
            <button className="lb-action-btn" onClick={() => setBulkOrderModal(true)} style={{ gap: 6 }}>
              <Upload size={13} /> Bulk Upload (CSV)
            </button>
          )}
          <button className="lb-action-btn lb-action-primary" onClick={() => navigate(config.newPath)}>
            <Plus size={14} /> {config.newLabel}
          </button>
        </div>
      </div>

      <div className="al-panel cust-table-wrap wf-table-wrap">
        <table className="cust-table wf-table">
          {kind === 'purchase-orders' ? (
            <>
          <thead>
            <tr>
              <th>Source PO</th>
              <th>Client</th>
              <th>Vendor</th>
              <th>Gangsheets</th>
              <th>Artworks</th>
              <th>Payment</th>
              <th>Shipping</th>
              <th>Payment Status</th>
              <th>PO Date</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={10} className="cust-empty-row">Loading...</td></tr>}
            {!loading && records.length === 0 && <tr><td colSpan={10} className="cust-empty-row">No purchase orders found.</td></tr>}
            {!loading && records.map((record) => (
              <tr key={record.id} className="cust-row" style={{ cursor: 'pointer' }} onClick={() => navigate(`/purchase-orders/${record.id}`)}>
                <td><div className="wf-record-title"><strong>{record.primaryId}</strong>{record.sourceId && <span>Internal: {record.sourceId}</span>}</div></td>
                <td><strong>{record.customer}</strong></td>
                <td className="cust-muted">{record.linked}</td>
                <td>{record.gangsheets}</td>
                <td>{record.artworks?.toLocaleString()}</td>
                <td className="cust-spent">{record.amount}</td>
                <td>{record.shipping}</td>
                <td><span className={cn('wf-status', toneCls(record.status))}>{record.status}</span></td>
                <td className="cust-muted">{record.date}</td>
                <td onClick={(e) => e.stopPropagation()}><button className="lb-icon-btn" onClick={(e) => setMenuAnchor({ el: e.currentTarget, id: record.id, primaryId: record.primaryId })}><MoreHorizontal size={15} /></button></td>
              </tr>
            ))}
          </tbody>
            </>
          ) : (
            <>
          <thead>
            <tr>
              <th>{config.primaryColumn}</th>
              <th>Customer / Vendor</th>
              <th>{config.linkedColumn}</th>
              <th>Status</th>
              <th>{config.amountColumn}</th>
              <th>Date</th>
              <th>Due / ETA</th>
              <th>Owner</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={9} className="cust-empty-row">Loading...</td></tr>}
            {!loading && records.length === 0 && <tr><td colSpan={9} className="cust-empty-row">No records found.</td></tr>}
            {!loading && records.map((record) => (
              <tr key={record.id} className="cust-row" style={{ cursor: 'pointer' }} onClick={() => navigate(`/${kind}/${record.id}`)}>
                <td>
                  <div className="wf-record-title">
                    <strong>{record.primaryId}</strong>
                    {record.meta && <span>{record.meta}</span>}
                  </div>
                </td>
                <td>{record.customer}</td>
                <td className="cust-muted">{record.linked}</td>
                <td>
                  <span className={cn('wf-status', toneCls(record.status))}>
                    {record.status}
                  </span>
                </td>
                <td className="cust-spent">{record.amount}</td>
                <td className="cust-muted">{record.date}</td>
                <td>{record.due}</td>
                <td className="cust-muted">{record.owner}</td>
                <td onClick={(e) => e.stopPropagation()}>
                  <button className="lb-icon-btn" onClick={(e) => setMenuAnchor({ el: e.currentTarget, id: record.id, primaryId: record.primaryId })}>
                    <MoreHorizontal size={15} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
            </>
          )}
        </table>
      </div>

      {totalPages > 1 && (
        <div className="cust-pagination">
          <span className="cust-pag-info">
            Showing {Math.min((page - 1) * PAGE_SIZE + 1, total)}-{Math.min(page * PAGE_SIZE, total)} of {total} records
          </span>
          <div className="cust-pag-controls">
            <button className="lb-action-btn cust-pag-btn" disabled={page === 1} onClick={() => handlePage(page - 1)}><ChevronLeft size={14} /></button>
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((n) => (
              <button key={n} className={cn('lb-action-btn cust-pag-btn', n === page && 'lb-action-primary')} onClick={() => handlePage(n)}>{n}</button>
            ))}
            <button className="lb-action-btn cust-pag-btn" disabled={page === totalPages} onClick={() => handlePage(page + 1)}><ChevronRight size={14} /></button>
          </div>
        </div>
      )}

      <Menu anchorEl={filterAnchor} open={Boolean(filterAnchor)} onClose={() => setFilterAnchor(null)}>
        {allStatuses.map((s) => (
          <MenuItem key={s} selected={statusFilter === s} onClick={() => handleFilter(s)}>{s}</MenuItem>
        ))}
      </Menu>

      <Menu anchorEl={menuAnchor?.el} open={Boolean(menuAnchor)} onClose={() => setMenuAnchor(null)}>
        <MenuItem onClick={() => {
          const id = menuAnchor?.id
          setMenuAnchor(null)
          if (id) navigate(`/${kind}/${id}`)
        }}>View Details</MenuItem>
        <MenuItem onClick={() => { setMenuAnchor(null); navigate(config.newPath) }}>Create New</MenuItem>
        <Divider />
        <MenuItem
          sx={{ color: '#dc2626' }}
          onClick={() => {
            const { id, primaryId } = menuAnchor!
            setMenuAnchor(null)
            setConfirmDelete({ id, primaryId })
          }}
        >
          Delete
        </MenuItem>
      </Menu>

      {bulkOrderModal && <BulkUploadOrdersModal onClose={() => { setBulkOrderModal(false); fetchRecords() }} />}

      <Dialog open={Boolean(confirmDelete)} onClose={() => setConfirmDelete(null)}>
        <DialogTitle>Delete {config.title.slice(0, -1)}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Permanently delete <strong>{confirmDelete?.primaryId}</strong>? This cannot be undone.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <button className="lb-action-btn" onClick={() => setConfirmDelete(null)}>Cancel</button>
          <button
            className="lb-action-btn"
            style={{ color: '#dc2626', borderColor: '#fca5a5' }}
            disabled={deleting}
            onClick={handleDelete}
          >
            {deleting ? 'Deleting...' : 'Delete'}
          </button>
        </DialogActions>
      </Dialog>
    </div>
  )
}
