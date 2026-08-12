import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ClipboardList, LayoutGrid, Shirt, XCircle, Factory, CheckCircle2, PauseCircle,
  Download, RotateCcw, Search,
} from 'lucide-react'
import { PageHeader } from '../components/Layout'
import { Panel, Pill, StatCard, TableStates, fmtDate, num } from '../components/ui'
import api from '../services/api'

interface OrderRow {
  id: string
  order_number: string
  po_number?: string | null
  customer_name?: string | null
  order_type: string
  order_date: string | null
  due_date: string | null
  shipped_date?: string | null
  status: string
  total_qty?: number | null
  size_summary?: string | null
}

const COLUMNS = ['#', 'Order ID', 'PO Number', 'Customer', 'Order Type', 'Order Date', 'Due Date', 'Shipped Date', 'Qty / Size', 'Status', 'On Time / Delayed']

const typeLabel = (t: string) =>
  t === 'gangsheet' ? 'Gangsheet' : t === 'apparel' ? 'Custom T-shirts' : t === 'dtf' ? 'DTF Transfers' : t

/** Delivered on or before the due date counts as on time; nothing shipped yet is neutral. */
function timeliness(o: OrderRow): 'On Time' | 'Delayed' | null {
  if (!o.due_date) return null
  if (o.status === 'Cancelled') return null
  const due = new Date(o.due_date).getTime()
  if (o.shipped_date) return new Date(o.shipped_date).getTime() <= due ? 'On Time' : 'Delayed'
  return Date.now() <= due ? 'On Time' : 'Delayed'
}

export default function ReportsPage() {
  const [rows, setRows] = useState<OrderRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const [type, setType] = useState('All')
  const [status, setStatus] = useState('All')
  const [page, setPage] = useState(1)
  const perPage = 10

  const load = () => {
    setLoading(true)
    api.get('/orders', { params: { limit: 500 } })
      .then(r => { setRows(r.data?.orders ?? r.data?.data ?? r.data ?? []); setError(null) })
      .catch(() => setError('The report could not be loaded.'))
      .finally(() => setLoading(false))
  }
  useEffect(load, [])

  const filtered = useMemo(() => rows.filter(o => {
    const q = search.trim().toLowerCase()
    const matchQ = !q || [o.order_number, o.po_number, o.customer_name].some(v => v?.toLowerCase().includes(q))
    return matchQ
      && (type === 'All' || typeLabel(o.order_type) === type)
      && (status === 'All' || o.status === status)
  }), [rows, search, type, status])

  const pageCount = Math.max(1, Math.ceil(filtered.length / perPage))
  const current = Math.min(page, pageCount)
  const visible = filtered.slice((current - 1) * perPage, current * perPage)

  const count = (fn: (o: OrderRow) => boolean) => rows.filter(fn).length
  const stats = [
    { icon: ClipboardList, label: 'Total Orders', value: rows.length, tone: 'bg-brand' },
    { icon: LayoutGrid, label: 'Gangsheet Orders', value: count(o => o.order_type === 'gangsheet'), tone: 'bg-violet-600' },
    { icon: Shirt, label: 'Custom T-shirts', value: count(o => o.order_type === 'apparel'), tone: 'bg-cyan-600' },
    { icon: XCircle, label: 'Orders Cancelled', value: count(o => o.status === 'Cancelled'), tone: 'bg-rose-600' },
    { icon: Factory, label: 'In Production', value: count(o => o.status === 'In Production'), tone: 'bg-orange-500' },
    { icon: CheckCircle2, label: 'Completed', value: count(o => o.status === 'Completed' || o.status === 'Delivered'), tone: 'bg-emerald-600' },
    { icon: PauseCircle, label: 'On Hold', value: count(o => o.status === 'On Hold'), tone: 'bg-violet-600' },
  ]

  const exportCsv = () => {
    const head = ['Order ID', 'PO Number', 'Customer', 'Type', 'Order Date', 'Due Date', 'Shipped', 'Qty', 'Status', 'Timeliness']
    const body = filtered.map(o => [
      o.order_number, o.po_number ?? '', o.customer_name ?? '', typeLabel(o.order_type),
      fmtDate(o.order_date), fmtDate(o.due_date), fmtDate(o.shipped_date), o.total_qty ?? '',
      o.status, timeliness(o) ?? '',
    ])
    const csv = [head, ...body].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `all-orders-report-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <>
      <PageHeader
        breadcrumb={<><span>Reports</span><span>›</span><span className="font-medium text-ink">All Orders Report</span></>}
        title="All Orders Report"
        subtitle="Complete list of all orders with their current status and details."
        actions={<button className="fp-btn" onClick={exportCsv} disabled={filtered.length === 0}><Download size={16} /> Export</button>}
      />

      {/* Filters */}
      <div className="fp-card mb-4 p-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <label className="block">
            <span className="fp-label">Search</span>
            <div className="relative">
              <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input className="fp-input pl-10" placeholder="Search by Order ID, PO No., Customer…"
                value={search} onChange={e => { setSearch(e.target.value); setPage(1) }} />
            </div>
          </label>
          <label className="block">
            <span className="fp-label">Order Type</span>
            <select className="fp-input" value={type} onChange={e => { setType(e.target.value); setPage(1) }}>
              {['All', 'Gangsheet', 'Custom T-shirts', 'DTF Transfers'].map(v => <option key={v}>{v}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="fp-label">Status</span>
            <select className="fp-input" value={status} onChange={e => { setStatus(e.target.value); setPage(1) }}>
              {['All', 'In Production', 'Shipped', 'Completed', 'Delivered', 'On Hold', 'Cancelled'].map(v => <option key={v}>{v}</option>)}
            </select>
          </label>
          <div className="flex items-end">
            <button className="fp-btn w-full" onClick={() => { setSearch(''); setType('All'); setStatus('All'); setPage(1) }}>
              <RotateCcw size={15} /> Clear Filters
            </button>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4 2xl:grid-cols-7">
        {stats.map(s => <StatCard key={s.label} icon={s.icon} label={s.label} value={num(s.value)} tone={s.tone} loading={loading} />)}
      </div>

      <Panel title={`All Orders (${filtered.length})`}>
        <div className="fp-table-wrap">
          <table className="w-full min-w-[1100px] border-collapse">
            <thead><tr>{COLUMNS.map(h => <th key={h} className="fp-th">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-line">
              <TableStates colSpan={COLUMNS.length} loading={loading} error={error} onRetry={load}
                empty={filtered.length === 0} emptyMessage="No orders match these filters." />
              {!loading && !error && visible.map((o, i) => {
                const t = timeliness(o)
                return (
                  <tr key={o.id} className="transition-colors hover:bg-brand/[0.04]">
                    <td className="fp-td text-muted">{(current - 1) * perPage + i + 1}</td>
                    <td className="fp-td"><Link to={`/orders/${o.id}`} className="fp-link">{o.order_number}</Link></td>
                    <td className="fp-td">{o.po_number || '—'}</td>
                    <td className="fp-td">{o.customer_name || '—'}</td>
                    <td className="fp-td"><Pill>{typeLabel(o.order_type)}</Pill></td>
                    <td className="fp-td whitespace-nowrap">{fmtDate(o.order_date)}</td>
                    <td className="fp-td whitespace-nowrap">{fmtDate(o.due_date)}</td>
                    <td className="fp-td whitespace-nowrap">{fmtDate(o.shipped_date)}</td>
                    <td className="fp-td whitespace-nowrap">{o.total_qty ? `${o.total_qty}${o.size_summary ? ` (${o.size_summary})` : ''}` : '—'}</td>
                    <td className="fp-td"><Pill>{o.status}</Pill></td>
                    <td className="fp-td">{t ? <Pill>{t}</Pill> : '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {!loading && !error && filtered.length > 0 && (
          <div className="flex flex-col gap-3 border-t border-line px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[13px] text-muted">
              Showing {(current - 1) * perPage + 1} to {Math.min(current * perPage, filtered.length)} of {filtered.length} entries
            </p>
            <div className="flex items-center gap-1.5">
              <button className="fp-btn h-9" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={current === 1}>Previous</button>
              {Array.from({ length: pageCount }).map((_, i) => i + 1)
                .filter(p => p === 1 || p === pageCount || Math.abs(p - current) <= 1)
                .map((p, idx, arr) => (
                  <span key={p} className="flex items-center gap-1.5">
                    {idx > 0 && arr[idx - 1] !== p - 1 && <span className="px-1 text-muted">…</span>}
                    <button onClick={() => setPage(p)}
                      className={`h-9 min-w-9 rounded-lg border px-3 text-[13px] font-medium transition ${
                        p === current ? 'border-brand bg-brand text-white' : 'border-line bg-white text-ink hover:bg-slate-50'}`}>
                      {p}
                    </button>
                  </span>
                ))}
              <button className="fp-btn h-9" onClick={() => setPage(p => Math.min(pageCount, p + 1))} disabled={current === pageCount}>Next</button>
            </div>
          </div>
        )}
      </Panel>

      <p className="mt-4 flex items-center gap-2 rounded-xl bg-sky-50 px-4 py-3 text-[13px] text-sky-800 ring-1 ring-inset ring-sky-600/15">
        All dates and times are shown in your local time zone.
      </p>
    </>
  )
}
