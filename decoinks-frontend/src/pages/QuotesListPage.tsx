import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ChevronDown,
  Download,
  Filter,
  FileText,
  Plus,
  Search,
  Trash2,
  Upload,
} from 'lucide-react'
import { Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle } from '@mui/material'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from '../utils/toast'
import { cn } from '../utils/cn'
import { api } from '../services/api'
import { downloadCsv } from '../utils/actions'
import { BulkUploadModal } from '../components/BulkUploadModal'

interface Quote {
  id: string
  quote_number: string
  customer_name: string | null
  created_by_name: string | null
  created_at: string
  valid_until: string | null
  total: number
  status: 'Draft' | 'Sent' | 'Approved' | 'Rejected' | 'Expired'
}

const STATUS_STYLES: Record<string, string> = {
  Draft:    'nq-status-draft',
  Sent:     'nq-status-sent',
  Approved: 'nq-status-accepted',
  Rejected: 'nq-status-declined',
  Expired:  'nq-status-expired',
}

const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtDate = (d: string | null) => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'

function agentInitials(name: string | null) {
  if (!name) return '?'
  return name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()
}

export function QuotesListPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('All')
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; number: string } | null>(null)
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false)
  const [bulkUploadOpen, setBulkUploadOpen] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkDeleting, setBulkDeleting] = useState(false)

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/quotations/${id}`),
    onSuccess: () => {
      toast.success('Quotation deleted')
      queryClient.invalidateQueries({ queryKey: ['quotations'] })
      setConfirmDelete(null)
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.message ?? 'Could not delete quotation')
      setConfirmDelete(null)
    },
  })

  const handleConvertToInvoice = (quoteId: string) => {
    navigate('/invoices/new', { state: { fromQuoteId: quoteId } })
  }

  const { data, isLoading } = useQuery({
    queryKey: ['quotations', { search, statusFilter }],
    queryFn: async () => {
      const params: Record<string, any> = { page: 1, limit: 200 }
      if (statusFilter !== 'All') params.status = statusFilter
      const { data } = await api.get('/quotations', { params })
      const rows: Quote[] = data.data.rows
      return {
        rows: search
          ? rows.filter(r =>
              r.quote_number.toLowerCase().includes(search.toLowerCase()) ||
              (r.customer_name ?? '').toLowerCase().includes(search.toLowerCase())
            )
          : rows,
        total: data.data.total,
      }
    },
  })

  const quotes: Quote[] = data?.rows ?? []
  const total: number = data?.total ?? 0

  const allSelected = quotes.length > 0 && quotes.every(q => selected.has(q.id))
  const someSelected = selected.size > 0

  function toggleAll() {
    if (allSelected) {
      setSelected(new Set())
    } else {
      setSelected(new Set(quotes.map(q => q.id)))
    }
  }

  function toggleOne(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  async function handleBulkDelete() {
    setBulkDeleting(true)
    setConfirmBulkDelete(false)
    const ids = [...selected]
    let ok = 0, fail = 0
    for (const id of ids) {
      try {
        await api.delete(`/quotations/${id}`)
        ok++
      } catch {
        fail++
      }
    }
    setBulkDeleting(false)
    setSelected(new Set())
    queryClient.invalidateQueries({ queryKey: ['quotations'] })
    if (ok > 0) toast.success(`${ok} quote${ok > 1 ? 's' : ''} deleted`)
    if (fail > 0) toast.error(`${fail} could not be deleted`)
  }

  return (
    <div className="ql-page">
      <div className="ql-toolbar">
        <div className="ql-search">
          <Search size={14} />
          <input
            placeholder="Search quotes..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        <div className="ql-filters">
          {(['All', 'Draft', 'Sent', 'Approved', 'Rejected', 'Expired'] as const).map(s => (
            <button
              key={s}
              className={cn('ql-filter-btn', statusFilter === s && 'ql-filter-btn-active')}
              onClick={() => setStatusFilter(s)}
            >
              {s}
            </button>
          ))}
        </div>

        <div className="ql-toolbar-right">
          {someSelected ? (
            <button
              className="lb-action-btn"
              style={{ color: '#dc2626', borderColor: '#fca5a5', gap: 6, fontWeight: 600 }}
              onClick={() => setConfirmBulkDelete(true)}
              disabled={bulkDeleting}
            >
              <Trash2 size={13} />
              {bulkDeleting ? 'Deleting...' : `Delete Selected (${selected.size})`}
            </button>
          ) : null}
          <button className="lb-action-btn" onClick={() => setStatusFilter(statusFilter === 'All' ? 'Draft' : 'All')}><Filter size={13} /> Filter</button>
          <button className="lb-action-btn" onClick={() => downloadCsv('quotations.csv', quotes as unknown as Record<string, unknown>[])}><Download size={13} /> Export<ChevronDown size={12} /></button>
          <button className="lb-action-btn" onClick={() => setBulkUploadOpen(true)} style={{ gap: 6 }}>
            <Upload size={13} /> Import CSV
          </button>
          <button className="lb-action-btn lb-action-primary" onClick={() => navigate('/quotes/new')}>
            <Plus size={14} /> New Quotation
          </button>
        </div>
      </div>

      <div className="ql-table-wrap">
        <table className="ql-table">
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  checked={allSelected}
                  ref={el => { if (el) el.indeterminate = someSelected && !allSelected }}
                  onChange={toggleAll}
                />
              </th>
              <th>Quote No.</th>
              <th>Customer</th>
              <th>Agent</th>
              <th>Date</th>
              <th>Valid Until</th>
              <th>Amount</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={9} className="ql-empty">Loading…</td></tr>}
            {!isLoading && quotes.length === 0 && <tr><td colSpan={9} className="ql-empty">No quotations found.</td></tr>}
            {!isLoading && quotes.map(q => (
              <tr
                key={q.id}
                className="ql-row"
                onClick={() => navigate(`/quotes/${q.id}`)}
                style={selected.has(q.id) ? { background: '#f0fdfa' } : undefined}
              >
                <td onClick={e => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={selected.has(q.id)}
                    onChange={() => toggleOne(q.id)}
                  />
                </td>
                <td>
                  <button className="ql-quote-link" onClick={e => { e.stopPropagation(); navigate(`/quotes/${q.id}`) }}>
                    {q.quote_number}
                  </button>
                </td>
                <td className="ql-customer">{q.customer_name ?? '—'}</td>
                <td>
                  <div className="ql-agent">
                    <div className="ql-agent-avatar" style={{ background: '#0D9488' }}>
                      {agentInitials(q.created_by_name)}
                    </div>
                    <span>{q.created_by_name ?? '—'}</span>
                  </div>
                </td>
                <td className="ql-date">{fmtDate(q.created_at)}</td>
                <td className="ql-date">{fmtDate(q.valid_until)}</td>
                <td className="ql-amount">${fmt(Number(q.total))}</td>
                <td>
                  <span className={cn('ql-status', STATUS_STYLES[q.status] ?? 'nq-status-draft')}>
                    {q.status}
                  </span>
                </td>
                <td onClick={e => e.stopPropagation()} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <button
                    className="lb-action-btn"
                    style={{ fontSize: 12, padding: '4px 10px' }}
                    onClick={() => navigate(`/quotes/${q.id}`)}
                  >
                    View
                  </button>
                  <button
                    className="lb-action-btn lb-action-primary"
                    style={{ fontSize: 12, padding: '4px 10px', gap: 4 }}
                    onClick={() => handleConvertToInvoice(q.id)}
                    title="Convert to Invoice"
                  >
                    <FileText size={12} />
                    Invoice
                  </button>
                  <button
                    className="lb-action-btn"
                    style={{ fontSize: 12, padding: '4px 8px', color: '#dc2626', borderColor: '#fca5a5' }}
                    onClick={() => setConfirmDelete({ id: q.id, number: q.quote_number })}
                  >
                    <Trash2 size={12} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="ql-footer">
        <span>
          {someSelected
            ? `${selected.size} selected of ${quotes.length} quotes`
            : `Showing ${quotes.length} of ${total} quotations`}
        </span>
      </div>

      {bulkUploadOpen && <BulkUploadModal onClose={() => setBulkUploadOpen(false)} />}
      {/* legacy DTF-only importer removed — the CSV importer above now detects
          order_type (dtf / gangsheet / apparel) from the file */}

      {/* Single delete */}
      <Dialog open={Boolean(confirmDelete)} onClose={() => setConfirmDelete(null)}>
        <DialogTitle>Delete Quotation</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Permanently delete <strong>{confirmDelete?.number}</strong>? This cannot be undone.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <button className="lb-action-btn" onClick={() => setConfirmDelete(null)}>Cancel</button>
          <button
            className="lb-action-btn"
            style={{ color: '#dc2626', borderColor: '#fca5a5' }}
            disabled={deleteMutation.isPending}
            onClick={() => confirmDelete && deleteMutation.mutate(confirmDelete.id)}
          >
            {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
          </button>
        </DialogActions>
      </Dialog>

      {/* Bulk delete confirm */}
      <Dialog open={confirmBulkDelete} onClose={() => setConfirmBulkDelete(false)}>
        <DialogTitle>Delete {selected.size} Quotes</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Permanently delete <strong>{selected.size} selected quote{selected.size > 1 ? 's' : ''}</strong>? This cannot be undone.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <button className="lb-action-btn" onClick={() => setConfirmBulkDelete(false)}>Cancel</button>
          <button
            className="lb-action-btn"
            style={{ color: '#dc2626', borderColor: '#fca5a5', fontWeight: 600 }}
            onClick={handleBulkDelete}
          >
            Delete {selected.size} Quotes
          </button>
        </DialogActions>
      </Dialog>
    </div>
  )
}
