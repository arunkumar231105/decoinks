import { useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Plus, Search } from 'lucide-react'
import { Skeleton } from '@mui/material'
import { api } from '../services/api'
import { ClaimDetailsDrawer } from '../components/claims/ClaimDetailsDrawer'
import '../styles/claims.css'
import { useColumnDrag } from '../hooks/useColumnDrag'
import { ColumnHideMenu } from '../components/ColumnHideMenu'
import { ColumnFreezeField } from '../components/ColumnFreezeField'

const STATUSES = ['All', 'Draft', 'Raised', 'Under Review', 'Approved', 'Refunded', 'Closed', 'Rejected']
const money = (v: any) => v == null ? '—'
  : Number(v).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
const date = (v: any) => v ? new Date(v).toLocaleDateString('en-US',
  { month: 'short', day: 'numeric', year: 'numeric' }) : '—'

export function ClaimsListPage() {
  const nav = useNavigate()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('All')
  const [page, setPage] = useState(1)
  // A row opens beside the list rather than navigating away from it.
  const [openClaim, setOpenClaim] = useState<string | null>(null)
  const limit = 20

  const list = useQuery({
    queryKey: ['claims', { search, status, page }],
    queryFn: () => api.get('/claims', {
      params: { page, limit, search: search || undefined, status: status === 'All' ? undefined : status },
    }).then(r => r.data.data),
  })
  const rows = list.data?.rows ?? []
  const total = list.data?.total ?? 0
  const pages = Math.max(1, Math.ceil(total / limit))

  // The grid's columns, in the order they are drawn. They can be dragged into
  // another order by their headers, the first one frozen (hooks/useColumnDrag).
  const cols: Record<string, { head: ReactNode; cell: (c: any) => ReactNode; className?: string }> = {
    claim: { head: 'Claim No.', cell: c => <strong>{c.claim_number}</strong> },
    raised: { head: 'Raised', cell: c => date(c.created_at) },
    customer: { head: 'Customer', cell: c => <>{c.customer_name ?? '—'}<small className="leads-cell-sub">{c.customer_number ?? ''}</small></> },
    order: { head: 'Sales Order', cell: c => c.order_number ?? '—' },
    // The purchase order the work was bought against — which is what tells you
    // which factory has to answer for it.
    po: { head: 'PO Number', cell: c => c.po_number ?? '—' },
    category: { head: 'Category', cell: c => <>{c.claim_category}<small className="leads-cell-sub">{c.sub_issue ?? ''}</small></> },
    claimed: { head: 'Claimed', cell: c => money(c.claimed_amount), className: 'cw-num' },
    approved: { head: 'Approved', cell: c => money(c.approved_amount), className: 'cw-num' },
    decision: { head: 'Decision', cell: c => c.decision },
    // Who settled it, and when — a decision with no name on it is not much of
    // a record.
    approved_by: { head: 'Approved By', cell: c => c.responsible_admin_name ?? '—' },
    approved_date: { head: 'Approved Date', cell: c => c.approval_date ? date(c.approval_date) : '—' },
    status: { head: 'Status', cell: c => <span className={`leads-pill st-${String(c.status).toLowerCase().replace(/\s+/g, '-')}`}>{c.status}</span> },
  }
  const columnDrag = useColumnDrag(Object.keys(cols), { frozen: 1 })

  return (
    <div className="leads-page">
      <header className="leads-actionbar cw-actionbar">
        <label className="leads-search">
          <Search size={20}/>
          <input value={search} placeholder="Search by claim no, order no or customer…"
            onChange={e => { setSearch(e.target.value); setPage(1) }} />
        </label>
        <label className="leads-filter">
          <span>Status</span>
          <select value={status} onChange={e => { setStatus(e.target.value); setPage(1) }}>
            {STATUSES.map(s => <option key={s}>{s}</option>)}
          </select>
        </label>
        <ColumnHideMenu wrapperClassName="leads-filter"
          columns={Object.entries(cols).map(([key, c]) => ({ key, label: String(c.head) }))}
          hidden={columnDrag.hidden} onToggle={columnDrag.toggleHidden} onShowAll={columnDrag.showAll} />
        <ColumnFreezeField className="leads-filter" value={columnDrag.frozenCount}
          max={columnDrag.visible.length} shown={columnDrag.frozenShown} onChange={columnDrag.setFrozenCount} />
        <button className="leads-btn primary" onClick={() => nav('/claims/new')}>
          <Plus size={18}/> New Claim
        </button>
      </header>

      <section className="leads-table-card">
        <div className="leads-table-scroll">
          <table ref={columnDrag.tableRef} className="leads-table cw-table">
            <thead><tr>
              {columnDrag.visible.map((k, i) =>
                <th key={k} {...columnDrag.headProps(k, i)} className={cols[k].className}>{cols[k].head}</th>)}
            </tr></thead>
            <tbody>
              {list.isLoading && Array.from({ length: 6 }).map((_, i) =>
                <tr key={i}><td colSpan={12}><Skeleton height={34}/></td></tr>)}
              {!list.isLoading && !rows.length && (
                <tr><td colSpan={12}>
                  <div className="leads-state">
                    <strong>No claims yet.</strong>
                    <p>Raise one against a sales order when a customer reports a problem.</p>
                    <button onClick={() => nav('/claims/new')}>New Claim</button>
                  </div>
                </td></tr>
              )}
              {rows.map((c: any) => (
                <tr key={c.id} onClick={() => setOpenClaim(c.id)} style={{ cursor: 'pointer' }}>
                  {columnDrag.visible.map((k, i) =>
                    <td key={k} {...columnDrag.cellProps(k, i)} className={cols[k].className}>{cols[k].cell(c)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <footer className="leads-pagination">
          <p>Showing <b>{rows.length ? (page - 1) * limit + 1 : 0}</b> to <b>{Math.min(page * limit, total)}</b> of <b>{total}</b> claims</p>
          <div>
            <button disabled={page === 1} onClick={() => setPage(p => p - 1)}>Previous</button>
            <button disabled={page >= pages} onClick={() => setPage(p => p + 1)}>Next</button>
          </div>
        </footer>
      </section>

      <ClaimDetailsDrawer claimId={openClaim} onClose={() => setOpenClaim(null)} />
    </div>
  )
}
