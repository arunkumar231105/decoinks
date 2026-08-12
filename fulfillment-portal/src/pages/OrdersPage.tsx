import { useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  Search, ChevronLeft, ChevronRight, Download, X,
  Package, ShoppingCart, BarChart2, XCircle, Clock, CheckCircle, PauseCircle,
} from 'lucide-react'
import api from '../services/api'
import { cn } from '../utils/cn'

// ─── Config ───────────────────────────────────────────────────────────────────

const STATUS_BADGE: Record<string, string> = {
  'In Production': 'bg-blue-50 text-blue-700',
  Shipped:         'bg-orange-50 text-orange-700',
  Completed:       'bg-green-50 text-green-700',
  'On Hold':       'bg-yellow-50 text-yellow-700',
  Cancelled:       'bg-red-50 text-red-700',
  Draft:           'bg-gray-100 text-gray-600',
  Confirmed:       'bg-emerald-50 text-emerald-700',
  Delivered:       'bg-teal-50 text-teal-700',
}

const TYPE_BADGE: Record<string, string> = {
  apparel:   'bg-blue-50 text-blue-700',
  gangsheet: 'bg-purple-50 text-purple-700',
  dtf:       'bg-orange-50 text-orange-700',
}

const STATUSES  = ['All', 'Draft', 'Confirmed', 'In Production', 'Ready to Ship', 'Shipped', 'Delivered', 'Completed', 'On Hold', 'Cancelled']
const TYPES     = ['All', 'apparel', 'gangsheet', 'dtf']

// ─── Types ────────────────────────────────────────────────────────────────────

interface Order {
  id: string
  order_number: string
  po_number: string | null
  status: string
  order_type: string
  order_date: string
  due_date: string | null
  sent_at: string | null
  total: number
}

interface Counts {
  total: number; gangsheet: number; apparel: number; dtf: number
  cancelled: number; inProduction: number; completed: number; onHold: number
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmt = (d: string | null) =>
  d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'

function onTimeBadge(dueDate: string | null, status: string) {
  if (['Completed', 'Delivered', 'Cancelled'].includes(status) || !dueDate) return null
  return new Date(dueDate) < new Date()
    ? <span className="badge bg-red-50 text-red-600 text-[10px]">Delayed</span>
    : <span className="badge bg-green-50 text-green-700 text-[10px]">On Time</span>
}

function exportCSV(orders: Order[]) {
  const header = ['Order ID', 'PO Number', 'Order Type', 'Order Date', 'Due Date', 'Status', 'Total']
  const rows   = orders.map((o) => [
    o.order_number, o.po_number ?? '', o.order_type,
    fmt(o.order_date), fmt(o.due_date), o.status,
    o.total?.toFixed(2) ?? '',
  ])
  const csv = [header, ...rows].map((r) => r.map((c) => `"${c}"`).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url  = URL.createObjectURL(blob)
  const a    = Object.assign(document.createElement('a'), { href: url, download: 'orders.csv' })
  a.click()
  URL.revokeObjectURL(url)
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function OrdersPage() {
  const [page, setPage]       = useState(1)
  const [search, setSearch]   = useState('')
  const [status, setStatus]   = useState('All')
  const [type, setType]       = useState('All')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo]     = useState('')

  const resetFilters = useCallback(() => {
    setSearch(''); setStatus('All'); setType('All')
    setDateFrom(''); setDateTo(''); setPage(1)
  }, [])

  const { data, isLoading } = useQuery({
    queryKey: ['orders', page, search, status, type, dateFrom, dateTo],
    queryFn: () =>
      api.get('/orders', {
        params: {
          page, limit: 10,
          ...(search   ? { search }                : {}),
          ...(status !== 'All' ? { status }        : {}),
          ...(type   !== 'All' ? { order_type: type } : {}),
          ...(dateFrom ? { date_from: dateFrom }   : {}),
          ...(dateTo   ? { date_to: dateTo }       : {}),
        },
      }).then((r) => r.data),
    placeholderData: (prev) => prev,
  })

  const orders: Order[] = data?.orders ?? []
  const total           = data?.total  ?? 0
  const pages           = Math.max(1, Math.ceil(total / 10))
  const counts: Counts  = data?.counts ?? { total: 0, gangsheet: 0, apparel: 0, dtf: 0, cancelled: 0, inProduction: 0, completed: 0, onHold: 0 }

  const hasFilters = search || status !== 'All' || type !== 'All' || dateFrom || dateTo

  const statCards = [
    { label: 'Total Orders',    value: counts.total,        icon: BarChart2,   bg: 'bg-blue-50',   color: 'text-blue-600' },
    { label: 'Gangsheet',       value: counts.gangsheet,    icon: Package,     bg: 'bg-purple-50', color: 'text-purple-600' },
    { label: 'Custom T-shirts', value: counts.apparel,      icon: ShoppingCart, bg: 'bg-blue-50',  color: 'text-blue-600' },
    { label: 'Cancelled',       value: counts.cancelled,    icon: XCircle,     bg: 'bg-red-50',    color: 'text-red-500' },
    { label: 'In Production',   value: counts.inProduction, icon: Clock,       bg: 'bg-orange-50', color: 'text-orange-600' },
    { label: 'Completed',       value: counts.completed,    icon: CheckCircle, bg: 'bg-green-50',  color: 'text-green-600' },
    { label: 'On Hold',         value: counts.onHold,       icon: PauseCircle, bg: 'bg-yellow-50', color: 'text-yellow-600' },
  ]

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Orders</h2>
          <p className="text-sm text-gray-500 mt-1">All orders shared with you by Decoinks.</p>
        </div>
        <button
          onClick={() => exportCSV(orders)}
          className="btn-secondary flex items-center gap-2"
        >
          <Download size={14} /> Export CSV
        </button>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-7 gap-3">
        {statCards.map(({ label, value, icon: Icon, bg, color }) => (
          <div key={label} className="card py-3 px-4">
            <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center mb-2', bg)}>
              <Icon size={16} className={color} />
            </div>
            <p className="text-xl font-bold text-gray-900">{value}</p>
            <p className="text-[11px] text-gray-500 mt-0.5 leading-tight">{label}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="card">
        <div className="flex items-center gap-3 flex-wrap">
          {/* Search */}
          <div className="relative flex-1 min-w-[180px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1) }}
              placeholder="Search order number..."
              className="input pl-8"
            />
          </div>
          {/* Type */}
          <select value={type} onChange={(e) => { setType(e.target.value); setPage(1) }} className="input w-40">
            {TYPES.map((t) => (
              <option key={t} value={t}>{t === 'All' ? 'All Types' : t === 'apparel' ? 'Custom T-shirts' : t.charAt(0).toUpperCase() + t.slice(1)}</option>
            ))}
          </select>
          {/* Status */}
          <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1) }} className="input w-44">
            {STATUSES.map((s) => (
              <option key={s} value={s}>{s === 'All' ? 'All Statuses' : s}</option>
            ))}
          </select>
          {/* Date From */}
          <div className="flex items-center gap-1">
            <label className="text-xs text-gray-500 whitespace-nowrap">From</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => { setDateFrom(e.target.value); setPage(1) }}
              className="input w-36"
            />
          </div>
          {/* Date To */}
          <div className="flex items-center gap-1">
            <label className="text-xs text-gray-500 whitespace-nowrap">To</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => { setDateTo(e.target.value); setPage(1) }}
              className="input w-36"
            />
          </div>
          {hasFilters && (
            <button onClick={resetFilters} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
              <X size={14} /> Clear
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="card p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                {['#', 'Order ID', 'PO Number', 'Type', 'Order Date', 'Due Date', 'Status', 'Timing', ''].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={9} className="text-center py-12 text-gray-400">Loading...</td></tr>
              ) : orders.length === 0 ? (
                <tr><td colSpan={9} className="text-center py-12 text-gray-400">No orders found</td></tr>
              ) : (
                orders.map((o, idx) => (
                  <tr key={o.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 text-sm text-gray-500">{(page - 1) * 10 + idx + 1}</td>
                    <td className="px-4 py-3">
                      <Link to={`/orders/${o.id}`} className="text-sm text-accent font-medium hover:underline whitespace-nowrap">
                        {o.order_number}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">{o.po_number ?? '—'}</td>
                    <td className="px-4 py-3">
                      <span className={cn('badge capitalize', TYPE_BADGE[o.order_type] ?? 'bg-gray-100 text-gray-600')}>
                        {o.order_type === 'apparel' ? 'Custom T-shirt' : o.order_type}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700 whitespace-nowrap">{fmt(o.order_date)}</td>
                    <td className="px-4 py-3 text-sm text-gray-700 whitespace-nowrap">{fmt(o.due_date)}</td>
                    <td className="px-4 py-3">
                      <span className={cn('badge', STATUS_BADGE[o.status] ?? 'bg-gray-100 text-gray-600')}>
                        {o.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">{onTimeBadge(o.due_date, o.status)}</td>
                    <td className="px-4 py-3">
                      <Link to={`/orders/${o.id}`} className="text-xs text-accent hover:underline whitespace-nowrap">
                        View →
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="px-4 py-3 flex items-center justify-between border-t border-gray-100">
          <p className="text-sm text-gray-500">
            Showing {total === 0 ? 0 : (page - 1) * 10 + 1} to {Math.min(page * 10, total)} of {total} entries
          </p>
          <div className="flex items-center gap-1">
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="p-1.5 rounded text-gray-400 hover:text-gray-700 disabled:opacity-30">
              <ChevronLeft size={16} />
            </button>
            {Array.from({ length: Math.min(5, pages) }, (_, i) => {
              const start = Math.max(1, Math.min(page - 2, pages - 4))
              return start + i
            }).map((p) => (
              <button
                key={p}
                onClick={() => setPage(p)}
                className={cn('w-8 h-8 rounded text-sm font-medium', page === p ? 'bg-accent text-white' : 'text-gray-600 hover:bg-gray-100')}
              >
                {p}
              </button>
            ))}
            <button onClick={() => setPage((p) => Math.min(pages, p + 1))} disabled={page === pages} className="p-1.5 rounded text-gray-400 hover:text-gray-700 disabled:opacity-30">
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
