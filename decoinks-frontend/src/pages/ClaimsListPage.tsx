import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Plus, Search } from 'lucide-react'
import { Skeleton } from '@mui/material'
import { api } from '../services/api'
import { ClaimDetailsDrawer } from '../components/claims/ClaimDetailsDrawer'
import '../styles/claims.css'

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
        <button className="leads-btn primary" onClick={() => nav('/claims/new')}>
          <Plus size={18}/> New Claim
        </button>
      </header>

      <section className="leads-table-card">
        <div className="leads-table-scroll">
          <table className="leads-table cw-table">
            <thead><tr>
              <th>Claim No.</th><th>Raised</th><th>Customer</th><th>Sales Order</th>
              <th>Category</th><th className="cw-num">Claimed</th><th className="cw-num">Approved</th>
              <th>Decision</th><th>Status</th>
            </tr></thead>
            <tbody>
              {list.isLoading && Array.from({ length: 6 }).map((_, i) =>
                <tr key={i}><td colSpan={9}><Skeleton height={34}/></td></tr>)}
              {!list.isLoading && !rows.length && (
                <tr><td colSpan={9}>
                  <div className="leads-state">
                    <strong>No claims yet.</strong>
                    <p>Raise one against a sales order when a customer reports a problem.</p>
                    <button onClick={() => nav('/claims/new')}>New Claim</button>
                  </div>
                </td></tr>
              )}
              {rows.map((c: any) => (
                <tr key={c.id} onClick={() => setOpenClaim(c.id)} style={{ cursor: 'pointer' }}>
                  <td><strong>{c.claim_number}</strong></td>
                  <td>{date(c.created_at)}</td>
                  <td>{c.customer_name ?? '—'}<small className="leads-cell-sub">{c.customer_number ?? ''}</small></td>
                  <td>{c.order_number ?? '—'}</td>
                  <td>{c.claim_category}<small className="leads-cell-sub">{c.sub_issue ?? ''}</small></td>
                  <td className="cw-num">{money(c.claimed_amount)}</td>
                  <td className="cw-num">{money(c.approved_amount)}</td>
                  <td>{c.decision}</td>
                  <td><span className={`leads-pill st-${String(c.status).toLowerCase().replace(/\s+/g, '-')}`}>{c.status}</span></td>
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
