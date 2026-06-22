import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, Divider as MuiDivider, Menu, MenuItem } from '@mui/material'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { FileText, Loader2, MoreHorizontal, Plus, Search, Zap } from 'lucide-react'
import toast from '../utils/toast'
import { api } from '../services/api'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Lead {
  id: string
  lead_number: string
  supplier_name: string
  customer_name: string | null
  company_name: string | null
  source: string | null
  status: string
  stage: string
  created_at: string
  agent_name: string | null
  customer_id: string | null
}

const STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  'New':                  { bg: '#f1f5f9', color: '#475569' },
  'Quotation':            { bg: '#dbeafe', color: '#1d4ed8' },
  'Pending':              { bg: '#fef3c7', color: '#b45309' },
  'Payment Sent':         { bg: '#ede9fe', color: '#6d28d9' },
  'Partial':              { bg: '#fed7aa', color: '#c2410c' },
  'Confirmed':            { bg: '#dcfce7', color: '#15803d' },
  'Quotation Generated':  { bg: '#ccfbf1', color: '#0d9488' },
  'Quotation Sent':       { bg: '#bfdbfe', color: '#2563eb' },
  'Quotation Approved':   { bg: '#bbf7d0', color: '#16a34a' },
}

// ── Component ─────────────────────────────────────────────────────────────────

export function LeadsListPage() {
  const navigate     = useNavigate()
  const queryClient  = useQueryClient()
  const [search, setSearch]         = useState('')
  const [page, setPage]             = useState(1)
  const [menuAnchor, setMenuAnchor] = useState<{ el: HTMLElement; lead: Lead } | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; number: string } | null>(null)

  const { data, isLoading } = useQuery<{ rows: Lead[]; total: number }>({
    queryKey: ['leads', 'list', page, search],
    queryFn: () =>
      api.get('/leads/list', { params: { page, limit: 20, search } })
         .then(r => r.data.data),
    placeholderData: prev => prev,
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/leads/${id}`),
    onSuccess: () => {
      toast.success('Lead deleted')
      queryClient.invalidateQueries({ queryKey: ['leads', 'list'] })
      setConfirmDelete(null)
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.message ?? 'Could not delete lead')
      setConfirmDelete(null)
    },
  })

  // Converts lead to customer (if needed) then opens New Quotation form with customer pre-filled
  const convertMutation = useMutation({
    mutationFn: (id: string) => api.post(`/leads/${id}/convert-to-customer`),
    onSuccess: (res: any) => {
      const customer = res.data?.data
      const existingId: string | undefined = res.data?.customer_id
      queryClient.invalidateQueries({ queryKey: ['leads', 'list'] })
      queryClient.invalidateQueries({ queryKey: ['customers'] })
      const customerId = customer?.id ?? existingId
      if (customerId) navigate('/quotes/new', { state: { fromCustomerId: customerId } })
      else navigate('/quotes/new')
    },
    onError: (err: any) => {
      const existingId: string | undefined = err.response?.data?.data?.customer_id
      if (existingId) navigate('/quotes/new', { state: { fromCustomerId: existingId } })
      else toast.error(err.response?.data?.message ?? 'Could not create quotation from lead')
    },
  })

  const leads     = data?.rows ?? []
  const total     = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / 20))

  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

  return (
    <div className="cust-page">
      {/* ── Header ── */}
      <div className="cust-page-header">
        <div>
          <h1 className="cust-page-title">
            <Zap size={18} style={{ marginRight: 8, color: '#0d9488', verticalAlign: 'middle' }} />
            Leads
          </h1>
          <p className="cust-page-sub">Track every prospect from first contact to confirmed order.</p>
        </div>
        <div className="cust-controls">
          <div className="cust-search">
            <Search size={14} />
            <input
              placeholder="Search by lead #, name, or description…"
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1) }}
            />
          </div>
          <button
            className="lb-action-btn lb-action-primary"
            onClick={() => navigate('/leads/new')}
          >
            <Plus size={14} /> Add Lead
          </button>
        </div>
      </div>

      {/* ── Table ── */}
      <div className="cust-table-wrap">
        <table className="cust-table">
          <thead>
            <tr>
              <th>Lead #</th>
              <th>Customer / Company</th>
              <th>Source</th>
              <th>Status</th>
              <th>Stage</th>
              <th>Agent</th>
              <th>Created</th>
              <th style={{ width: 40 }}></th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={8} className="cust-empty-row">Loading…</td>
              </tr>
            )}
            {!isLoading && leads.length === 0 && (
              <tr>
                <td colSpan={8} className="cust-empty-row">
                  No leads found.{' '}
                  <button
                    className="nq-link-btn"
                    onClick={() => navigate('/leads/new')}
                  >
                    Add your first lead
                  </button>
                </td>
              </tr>
            )}
            {leads.map(lead => {
              const sc = STATUS_COLORS[lead.status]
              return (
                <tr
                  key={lead.id}
                  className="cust-row"
                  style={{ cursor: 'default' }}
                >
                  <td>
                    <span className="lb-lead-id">{lead.lead_number}</span>
                  </td>
                  <td className="cust-name-cell">
                    <span>{lead.supplier_name ?? lead.customer_name ?? '—'}</span>
                    {lead.company_name && (
                      <span className="cust-muted">{lead.company_name}</span>
                    )}
                  </td>
                  <td className="cust-muted">{lead.source ?? '—'}</td>
                  <td>
                    <span
                      className="cust-status-badge"
                      style={sc
                        ? { background: sc.bg, color: sc.color }
                        : { background: '#f1f5f9', color: '#475569' }}
                    >
                      {lead.status}
                    </span>
                  </td>
                  <td className="cust-muted" style={{ textTransform: 'capitalize' }}>
                    {lead.stage}
                  </td>
                  <td className="cust-muted">{lead.agent_name ?? '—'}</td>
                  <td className="cust-muted">{fmtDate(lead.created_at)}</td>
                  <td onClick={e => e.stopPropagation()}>
                    <button
                      className="lb-icon-btn"
                      onClick={e => setMenuAnchor({ el: e.currentTarget, lead })}
                    >
                      <MoreHorizontal size={15} />
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* ── Pagination ── */}
      {totalPages > 1 && (
        <div className="cust-pagination" style={{ display: 'flex', gap: 6, padding: '12px 0', justifyContent: 'center' }}>
          {Array.from({ length: totalPages }, (_, i) => i + 1).map(n => (
            <button
              key={n}
              className={`lb-action-btn ${n === page ? 'lb-action-primary' : ''}`}
              style={{ minWidth: 36, padding: '0 10px' }}
              onClick={() => setPage(n)}
            >
              {n}
            </button>
          ))}
        </div>
      )}

      {/* ── Row context menu ── */}
      <Menu
        anchorEl={menuAnchor?.el}
        open={Boolean(menuAnchor)}
        onClose={() => setMenuAnchor(null)}
      >
        <MenuItem
          onClick={() => {
            navigate('/leads/board')
            setMenuAnchor(null)
          }}
        >
          <FileText size={14} style={{ marginRight: 8 }} /> Open in Board View
        </MenuItem>
        <MuiDivider />
        <MenuItem
          onClick={() => {
            const lead = menuAnchor!.lead
            setMenuAnchor(null)
            if (lead.customer_id) {
              // Already a customer — go straight to new quote form with customer pre-filled
              navigate('/quotes/new', { state: { fromCustomerId: lead.customer_id } })
            } else {
              // Convert to customer first, then open quote form
              convertMutation.mutate(lead.id)
            }
          }}
          disabled={convertMutation.isPending}
        >
          {convertMutation.isPending
            ? <><Loader2 size={14} style={{ marginRight: 8, animation: 'spin 1s linear infinite' }} /> Converting…</>
            : <><Zap size={14} style={{ marginRight: 8, color: '#0d9488' }} /> New Quotation</>
          }
        </MenuItem>
        <MuiDivider />
        <MenuItem
          sx={{ color: '#dc2626' }}
          onClick={() => {
            const lead = menuAnchor!.lead
            setMenuAnchor(null)
            setConfirmDelete({ id: lead.id, number: lead.lead_number })
          }}
        >
          Delete Lead
        </MenuItem>
      </Menu>

      <Dialog open={Boolean(confirmDelete)} onClose={() => setConfirmDelete(null)}>
        <DialogTitle>Delete Lead</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Permanently delete lead <strong>{confirmDelete?.number}</strong>? This cannot be undone.
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
    </div>
  )
}
