import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Columns3, ExternalLink, Factory as FactoryIcon,
  Filter, Pencil, Search, X,
} from 'lucide-react'
import { PageHeader } from '../components/Layout'
import { TableStates, fmtDate, num } from '../components/ui'
import api from '../services/api'
import StageEditor from '../components/fulfillment/StageEditor'
import FactoriesModal from '../components/fulfillment/FactoriesModal'
import {
  CARDS, STAGE_TEXT, STAGE_TONE, STAGES, carrierUrl, type GridResponse, type GridRow,
} from '../components/fulfillment/stages'

/**
 * Supplier Order Management — every purchase order shared with this supplier,
 * with its factory, push date, stage and courier tracking, in one grid.
 */

const PAGE_SIZES = [10, 25, 50, 100]
const COLUMNS_KEY = 'fp-order-grid-hidden-columns'

type ColumnKey =
  | 'sno' | 'po_number' | 'customer' | 'order_number' | 'factory' | 'push_date' | 'stage'
  | 'items' | 'qty' | 'courier' | 'tracking_number' | 'tracking_text'

const COLUMNS: { key: ColumnKey; label: string; sort?: string; required?: boolean }[] = [
  { key: 'sno', label: 'S.No' },
  { key: 'po_number', label: 'PO#', sort: 'po_number', required: true },
  { key: 'customer', label: 'Customer', sort: 'customer' },
  { key: 'order_number', label: 'Order No', sort: 'order_number' },
  { key: 'factory', label: 'Factory', sort: 'factory' },
  { key: 'push_date', label: 'Push Date', sort: 'push_date' },
  { key: 'stage', label: 'Status', sort: 'stage', required: true },
  { key: 'items', label: 'Items', sort: 'items' },
  { key: 'qty', label: 'Qty', sort: 'qty' },
  { key: 'courier', label: 'Courier Service', sort: 'courier' },
  { key: 'tracking_number', label: 'Tracking ID', sort: 'tracking_number' },
  { key: 'tracking_text', label: 'Tracking Status', sort: 'tracking_text' },
]

const readHidden = (): ColumnKey[] => {
  try { return JSON.parse(localStorage.getItem(COLUMNS_KEY) || '[]') } catch { return [] }
}

export default function PurchaseOrdersPage() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()

  const [search, setSearch] = useState(params.get('search') ?? '')
  const [debounced, setDebounced] = useState(search)
  const stage = params.get('stage') ?? ''
  const factory = params.get('factory') ?? ''
  const courier = params.get('courier') ?? ''
  const pushFrom = params.get('push_from') ?? ''
  const pushTo = params.get('push_to') ?? ''
  const sort = params.get('sort') ?? 'issue_date'
  const dir = params.get('dir') === 'asc' ? 'asc' : 'desc'
  const page = Math.max(1, Number(params.get('page')) || 1)
  const limit = PAGE_SIZES.includes(Number(params.get('limit'))) ? Number(params.get('limit')) : 10

  const [hidden, setHidden] = useState<ColumnKey[]>(readHidden)
  const [columnsOpen, setColumnsOpen] = useState(false)
  const [moreFilters, setMoreFilters] = useState(Boolean(pushFrom || pushTo))
  const [editing, setEditing] = useState<GridRow | null>(null)
  const [factoriesOpen, setFactoriesOpen] = useState(false)
  const columnsRef = useRef<HTMLDivElement>(null)

  // Only the keys that change the grid; everything else stays in the URL untouched.
  const update = (next: Record<string, string | number | null>, resetPage = true) => {
    const p = new URLSearchParams(params)
    for (const [k, v] of Object.entries(next)) {
      if (v === null || v === '' || v === undefined) p.delete(k)
      else p.set(k, String(v))
    }
    if (resetPage && !('page' in next)) p.delete('page')
    setParams(p, { replace: true })
  }

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300)
    return () => clearTimeout(t)
  }, [search])
  useEffect(() => {
    if ((params.get('search') ?? '') !== debounced) update({ search: debounced || null })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced])

  useEffect(() => { try { localStorage.setItem(COLUMNS_KEY, JSON.stringify(hidden)) } catch { /* private mode */ } }, [hidden])
  useEffect(() => {
    if (!columnsOpen) return
    const close = (e: MouseEvent) => { if (!columnsRef.current?.contains(e.target as Node)) setColumnsOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [columnsOpen])

  const query = useQuery({
    queryKey: ['order-grid', { search: params.get('search') ?? '', stage, factory, courier, pushFrom, pushTo, sort, dir, page, limit }],
    queryFn: () => api.get('/purchase-orders/order-grid', {
      params: {
        search: params.get('search') || undefined, stage: stage || undefined, factory: factory || undefined,
        courier: courier || undefined, push_from: pushFrom || undefined, push_to: pushTo || undefined,
        sort, dir, page, limit,
      },
    }).then(r => r.data as GridResponse),
    placeholderData: keepPreviousData,
  })

  const data = query.data
  const rows = data?.rows ?? []
  const total = data?.total ?? 0
  const pages = Math.max(1, Math.ceil(total / limit))
  const visible = COLUMNS.filter(c => !hidden.includes(c.key))
  const filtersOn = Boolean(params.get('search') || stage || factory || courier || pushFrom || pushTo)

  useEffect(() => { if (data && page > pages) update({ page: pages }, false) }, [data, page, pages]) // eslint-disable-line react-hooks/exhaustive-deps

  const cardValue = (key: typeof CARDS[number]['key']) => {
    if (!data) return 0
    if (key === 'total') return data.summary.total
    if (key === 'issued') return data.summary.issued
    if (key === 'pending') return data.summary.pending
    return data.summary.stages[key] ?? 0
  }

  const toggleSort = (key?: string) => {
    if (!key) return
    update({ sort: key, dir: sort === key && dir === 'desc' ? 'asc' : 'desc' })
  }

  const pageNumbers = useMemo(() => {
    const out: (number | '…')[] = []
    for (let n = 1; n <= pages; n++) {
      if (n === 1 || n === pages || Math.abs(n - page) <= 1) out.push(n)
      else if (out[out.length - 1] !== '…') out.push('…')
    }
    return out
  }, [page, pages])

  const cell = (r: GridRow, key: ColumnKey, index: number) => {
    switch (key) {
      case 'sno': return <span className="text-muted">{(page - 1) * limit + index + 1}</span>
      case 'po_number': return <span className="fp-link">{r.po_number}</span>
      case 'customer': return (
        <div className="min-w-[150px]">
          <div className="font-medium text-ink">{r.customer_name ?? '—'}</div>
          {r.customer_location && <div className="text-xs text-muted">{r.customer_location}</div>}
        </div>
      )
      case 'order_number': return r.order_number
        ? <span className={r.order_archived ? 'text-muted' : ''} title={r.order_archived ? 'This sales order has been archived' : undefined}>{r.order_number}</span>
        : '—'
      case 'factory': return r.factory
        ? <span className={r.factory.is_active ? '' : 'text-muted'}>{r.factory.name}</span>
        : <span className="text-muted">—</span>
      case 'push_date': return r.push_date ? fmtDate(r.push_date) : <span className="text-muted">—</span>
      case 'stage': return (
        <span className={`inline-flex whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${STAGE_TONE[r.stage] ?? STAGE_TONE.Cancelled}`}>
          {r.stage}
        </span>
      )
      case 'items': return r.items ? <span className="block max-w-[220px] truncate" title={r.items}>{r.items}</span> : <span className="text-muted">—</span>
      case 'qty': return r.qty != null ? num(r.qty) : <span className="text-muted">—</span>
      case 'courier': return r.courier ? String(r.courier).toUpperCase() : <span className="text-muted">—</span>
      case 'tracking_number': {
        if (!r.tracking_number) return <span className="text-muted">—</span>
        const url = carrierUrl(r.courier, r.tracking_number)
        return url
          ? <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-mono text-[13px] text-brand hover:underline"
              onClick={e => e.stopPropagation()} title={`Track on ${String(r.courier).toUpperCase()}`}>
              {r.tracking_number} <ExternalLink size={12} />
            </a>
          : <span className="font-mono text-[13px]">{r.tracking_number}</span>
      }
      case 'tracking_text': return r.tracking_text
        ? <span className={`block max-w-[220px] truncate font-medium ${STAGE_TEXT[r.stage] ?? 'text-ink'}`} title={r.tracking_text}>{r.tracking_text}</span>
        : <span className="text-muted">—</span>
    }
  }

  const clearFilters = () => {
    setSearch('')
    setDebounced('')
    const p = new URLSearchParams()
    if (params.get('limit')) p.set('limit', params.get('limit')!)
    setParams(p, { replace: true })
  }

  return (
    <>
      <PageHeader
        title="Supplier Order Management"
        subtitle="Manage purchase orders, factory progress and courier tracking from one grid."
        actions={
          <button className="fp-btn h-10" onClick={() => setFactoriesOpen(true)}>
            <FactoryIcon size={16} /> Factories
          </button>
        }
      />

      {/* Summary cards — a click filters the grid */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6">
        {CARDS.map(c => {
          const active = stage === c.filter && (c.filter !== '' || !stage)
          const Icon = c.icon
          return (
            <button
              key={c.label} type="button"
              onClick={() => update({ stage: c.filter || null })}
              className={`fp-card flex items-center gap-3 p-3.5 text-left transition hover:border-slate-300 hover:shadow-pop ${active ? 'border-brand ring-2 ring-brand/15' : ''}`}
              aria-pressed={active}
            >
              <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${c.tone}`}><Icon size={19} /></span>
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-medium text-muted">{c.label}</span>
                {query.isLoading
                  ? <span className="fp-skeleton mt-1 block h-6 w-10" />
                  : <span className="block text-[22px] font-bold leading-tight text-ink">{num(cardValue(c.key))}</span>}
              </span>
            </button>
          )
        })}
      </div>

      {/* Filters */}
      <div className="fp-card mt-4 p-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative min-w-[220px] flex-[2]">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              className="fp-input h-10 pl-9 pr-8" placeholder="Search by PO#, customer, order no, tracking ID…"
              value={search} onChange={e => setSearch(e.target.value)}
            />
            {search && (
              <button className="absolute right-2 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded text-muted hover:bg-slate-100"
                onClick={() => setSearch('')} aria-label="Clear search"><X size={14} /></button>
            )}
          </div>
          <label className="flex min-w-[150px] flex-1 items-center">
            <span className="sr-only">Factory</span>
            <select className="fp-input h-10" value={factory} onChange={e => update({ factory: e.target.value || null })}>
              <option value="">Factory: All</option>
              <option value="none">No factory yet</option>
              {(data?.filters.factories ?? []).map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </label>
          <label className="flex min-w-[150px] flex-1 items-center">
            <span className="sr-only">Status</span>
            <select className="fp-input h-10" value={stage} onChange={e => update({ stage: e.target.value || null })}>
              <option value="">Status: All</option>
              <option value="Pending">Pending (not shipped yet)</option>
              {STAGES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label className="flex min-w-[140px] flex-1 items-center">
            <span className="sr-only">Courier</span>
            <select className="fp-input h-10" value={courier} onChange={e => update({ courier: e.target.value || null })}>
              <option value="">Courier: All</option>
              <option value="none">No courier yet</option>
              {(data?.filters.couriers ?? []).map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <button className={`fp-btn h-10 ${moreFilters ? 'border-brand text-brand' : ''}`} onClick={() => setMoreFilters(v => !v)}>
            <Filter size={15} /> Add filter
          </button>
          <div className="relative" ref={columnsRef}>
            <button className="fp-btn h-10" onClick={() => setColumnsOpen(v => !v)} aria-expanded={columnsOpen}>
              <Columns3 size={15} /> Manage columns
            </button>
            {columnsOpen && (
              <div className="absolute right-0 z-20 mt-1.5 w-56 rounded-xl border border-line bg-white p-2 shadow-pop">
                {COLUMNS.map(c => (
                  <label key={c.key} className={`flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm ${c.required ? 'text-muted' : 'cursor-pointer hover:bg-slate-50'}`}>
                    <input
                      type="checkbox" className="h-4 w-4 accent-brand" disabled={c.required}
                      checked={!hidden.includes(c.key)}
                      onChange={e => setHidden(h => e.target.checked ? h.filter(k => k !== c.key) : [...h, c.key])}
                    />
                    {c.label}
                  </label>
                ))}
                {hidden.length > 0 && (
                  <button className="mt-1 w-full rounded-md px-2 py-1.5 text-left text-[13px] font-medium text-brand hover:bg-slate-50" onClick={() => setHidden([])}>
                    Show all columns
                  </button>
                )}
              </div>
            )}
          </div>
          {filtersOn && (
            <button className="fp-btn h-10 text-muted" onClick={clearFilters}><X size={15} /> Clear</button>
          )}
        </div>

        {moreFilters && (
          <div className="mt-2.5 flex flex-wrap items-end gap-2.5 border-t border-line pt-2.5">
            <label className="min-w-[160px]">
              <span className="fp-label">Push date from</span>
              <input type="date" className="fp-input h-10" value={pushFrom} max={pushTo || undefined} onChange={e => update({ push_from: e.target.value || null })} />
            </label>
            <label className="min-w-[160px]">
              <span className="fp-label">Push date to</span>
              <input type="date" className="fp-input h-10" value={pushTo} min={pushFrom || undefined} onChange={e => update({ push_to: e.target.value || null })} />
            </label>
          </div>
        )}
      </div>

      {/* Grid — relative, so the header's screen-reader label (absolutely
          positioned) stays inside the card instead of widening the page. */}
      <div className="fp-card relative mt-4 overflow-hidden">
        <div className="fp-table-wrap">
          <table className="w-full min-w-[1180px] border-collapse">
            <thead>
              <tr className="border-b border-line">
                {visible.map(c => (
                  <th key={c.key} className="fp-th" aria-sort={sort === c.sort ? (dir === 'asc' ? 'ascending' : 'descending') : undefined}>
                    {c.sort ? (
                      <button className="inline-flex items-center gap-1 hover:text-ink" onClick={() => toggleSort(c.sort)}>
                        {c.label}
                        {sort === c.sort ? (dir === 'asc' ? <ArrowUp size={13} /> : <ArrowDown size={13} />) : <ArrowUpDown size={13} className="opacity-40" />}
                      </button>
                    ) : c.label}
                  </th>
                ))}
                <th className="fp-th w-[1%]"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              <TableStates
                colSpan={visible.length + 1}
                loading={query.isLoading}
                error={query.isError ? 'The purchase orders could not be loaded.' : null}
                empty={!query.isLoading && !query.isError && rows.length === 0}
                emptyMessage={filtersOn ? 'No purchase orders match these filters.' : 'No purchase orders have been shared with you yet.'}
                onRetry={() => query.refetch()}
              />
              {!query.isLoading && !query.isError && rows.map((r, i) => (
                <tr key={r.id} className="cursor-pointer border-b border-line last:border-0 hover:bg-slate-50/70"
                  onClick={() => navigate(`/purchase-orders/${r.id}`)}>
                  {visible.map(c => <td key={c.key} className="fp-td whitespace-nowrap">{cell(r, c.key, i)}</td>)}
                  <td className="fp-td" onClick={e => e.stopPropagation()}>
                    <button className="fp-btn h-8 px-2.5 text-[13px]" onClick={() => setEditing(r)} title="Update stage, factory or push date">
                      <Pencil size={13} /> Update
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex flex-col gap-3 border-t border-line px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3 text-[13px] text-muted">
            <span>
              {total === 0 ? 'No orders' : `Showing ${(page - 1) * limit + 1} – ${Math.min(page * limit, total)} of ${num(total)} orders`}
            </span>
            <select className="h-8 rounded-md border border-line bg-white px-2 text-[13px]" value={limit}
              onChange={e => update({ limit: e.target.value })} aria-label="Rows per page">
              {PAGE_SIZES.map(n => <option key={n} value={n}>{n} / page</option>)}
            </select>
          </div>
          <div className="flex items-center gap-1.5">
            <button className="fp-btn h-8 w-8 px-0" disabled={page <= 1} onClick={() => update({ page: page - 1 }, false)} aria-label="Previous page"><ChevronLeft size={15} /></button>
            {pageNumbers.map((n, i) => n === '…'
              ? <span key={`gap-${i}`} className="px-1 text-muted">…</span>
              : <button key={n} onClick={() => update({ page: n }, false)} aria-current={n === page ? 'page' : undefined}
                  className={`fp-btn h-8 min-w-8 px-2.5 text-[13px] ${n === page ? 'fp-btn-primary' : ''}`}>{n}</button>)}
            <button className="fp-btn h-8 w-8 px-0" disabled={page >= pages} onClick={() => update({ page: page + 1 }, false)} aria-label="Next page"><ChevronRight size={15} /></button>
          </div>
        </div>
      </div>

      <StageEditor row={editing} onClose={() => setEditing(null)} />
      <FactoriesModal open={factoriesOpen} onClose={() => setFactoriesOpen(false)} />
    </>
  )
}
