import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Columns3, Filter, Plus, Search, X,
} from 'lucide-react'
import { TableStates, num } from '../components/ui'
import api from '../services/api'
import FactoriesModal from '../components/fulfillment/FactoriesModal'
import {
  CARDS, STAGE_TEXT, STAGE_TONE, STAGES, carrierUrl, type GridResponse, type GridRow,
} from '../components/fulfillment/stages'

/**
 * Supplier Order Management — every purchase order shared with this supplier,
 * with its factory, push date, stage and courier tracking, in one grid.
 * Laid out to the owner's design (16 Sep 2026).
 */

const PAGE_SIZE = 8
// Purchase orders are issued from Printshop; the design's button opens its New PO form.
const NEW_PO_URL = 'https://printshop.decoinkssuite.com/purchase-orders/new'
const COLUMNS_KEY = 'fp-order-grid-hidden-columns'
const MANAGE_FACTORIES = '__manage__'

type ColumnKey =
  | 'sno' | 'po_number' | 'customer' | 'order_number' | 'factory' | 'push_date' | 'stage'
  | 'items' | 'qty' | 'courier' | 'tracking_number' | 'tracking_text'

const COLUMNS: { key: ColumnKey; label: string; sort: string; required?: boolean }[] = [
  { key: 'sno', label: 'S.No', sort: 'issue_date' },
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

// Columns whose text wraps instead of being cut off, so the whole grid fits
// narrower (and zoomed) screens with nothing hidden behind an ellipsis.
const WRAP = new Set<ColumnKey>(['customer', 'factory', 'items', 'courier', 'tracking_number', 'tracking_text'])

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
  const sorted = params.has('sort')   // arrows show only once someone picks a column
  const sort = params.get('sort') ?? 'issue_date'
  const dir = params.get('dir') === 'asc' ? 'asc' : 'desc'
  const page = Math.max(1, Number(params.get('page')) || 1)

  const [hidden, setHidden] = useState<ColumnKey[]>(readHidden)
  const [columnsOpen, setColumnsOpen] = useState(false)
  const [moreFilters, setMoreFilters] = useState(Boolean(pushFrom || pushTo))
  const [factoriesOpen, setFactoriesOpen] = useState(false)
  const columnsRef = useRef<HTMLDivElement>(null)

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
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setColumnsOpen(false) }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', onKey) }
  }, [columnsOpen])

  const query = useQuery({
    queryKey: ['order-grid', { search: params.get('search') ?? '', stage, factory, courier, pushFrom, pushTo, sort, dir, page }],
    queryFn: () => api.get('/purchase-orders/order-grid', {
      params: {
        search: params.get('search') || undefined, stage: stage || undefined, factory: factory || undefined,
        courier: courier || undefined, push_from: pushFrom || undefined, push_to: pushTo || undefined,
        sort, dir, page, limit: PAGE_SIZE,
      },
    }).then(r => r.data as GridResponse),
    placeholderData: keepPreviousData,
  })

  const data = query.data
  const rows = data?.rows ?? []
  const total = data?.total ?? 0
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
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

  const pageNumbers = useMemo(() => {
    const out: (number | '…')[] = []
    for (let n = 1; n <= pages; n++) {
      if (n === 1 || n === pages || (n >= page - 1 && n <= page + 3 && n <= Math.max(5, page + 1)) || (page <= 3 && n <= 5)) out.push(n)
      else if (out[out.length - 1] !== '…') out.push('…')
    }
    return out
  }, [page, pages])

  const clearFilters = () => {
    setSearch('')
    setDebounced('')
    setParams(new URLSearchParams(), { replace: true })
  }

  const cell = (r: GridRow, key: ColumnKey, index: number) => {
    switch (key) {
      case 'sno': return <span className="text-slate-700">{(page - 1) * PAGE_SIZE + index + 1}</span>
      case 'po_number': return <span className="text-blue-600">{r.po_number}</span>
      case 'customer': return (
        <div className="min-w-[104px] max-w-[180px]">
          <div className="text-slate-900">{r.customer_name ?? '—'}</div>
          {r.customer_location && <div className="text-xs text-slate-500">{r.customer_location}</div>}
        </div>
      )
      case 'order_number': return r.order_number
        ? <span className={r.order_archived ? 'text-slate-400' : 'text-slate-800'} title={r.order_archived ? 'This sales order has been archived' : undefined}>{r.order_number}</span>
        : <span className="text-slate-400">—</span>
      case 'factory': return r.factory
        ? <span className={r.factory.is_active ? 'text-slate-800' : 'text-slate-400'}>{r.factory.name}</span>
        : <span className="text-slate-400">—</span>
      case 'push_date': return r.push_date ? <span className="text-slate-800">{r.push_date}</span> : <span className="text-slate-400">—</span>
      case 'stage': return (
        <span className={`inline-flex whitespace-nowrap rounded-md px-2 py-[3px] text-[12.5px] ${STAGE_TONE[r.stage] ?? STAGE_TONE.Cancelled}`}>
          {r.stage}
        </span>
      )
      case 'items': return r.items ? <span className="block min-w-[100px] max-w-[190px] text-slate-800">{r.items}</span> : <span className="text-slate-400">—</span>
      case 'qty': return r.qty != null ? <span className="text-slate-800">{num(r.qty)}</span> : <span className="text-slate-400">—</span>
      case 'courier': return r.courier ? <span className="text-slate-800">{String(r.courier).toUpperCase()}</span> : <span className="text-slate-400">—</span>
      case 'tracking_number': {
        if (!r.tracking_number) return <span className="text-slate-400">—</span>
        const url = carrierUrl(r.courier, r.tracking_number)
        return url
          ? <a href={url} target="_blank" rel="noopener noreferrer" className="block min-w-[90px] max-w-[130px] break-all text-slate-800 hover:text-blue-600 hover:underline"
              onClick={e => e.stopPropagation()} title={`Track ${r.tracking_number} on ${String(r.courier).toUpperCase()}`}>{r.tracking_number}</a>
          : <span className="block min-w-[90px] max-w-[130px] break-all text-slate-800">{r.tracking_number}</span>
      }
      case 'tracking_text': return r.tracking_text
        ? <span className={`block min-w-[84px] max-w-[160px] ${STAGE_TEXT[r.stage] ?? 'text-slate-800'}`}>{r.tracking_text}</span>
        : <span className="text-slate-400">—</span>
    }
  }

  const selectClass = 'h-10 w-full appearance-none rounded-lg border border-line bg-white pl-3 pr-9 text-[13px] text-slate-800 outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/15'
  const Chevron = () => (
    <svg aria-hidden className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
    </svg>
  )

  const renderCard = (c: typeof CARDS[number]) => {
    const active = Boolean(stage) && stage === c.filter
    const Icon = c.icon
    return (
      <button key={c.label} type="button" onClick={() => update({ stage: c.filter || null })} aria-pressed={active}
        className={`flex min-w-0 items-center gap-3.5 rounded-lg border bg-white px-4 py-[15px] text-left shadow-card transition hover:shadow-pop ${active ? 'border-blue-500 ring-1 ring-blue-500/30' : 'border-line hover:border-slate-300'}`}>
        <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-lg ${c.tone}`}>
          {c.solid ? <Icon size={24} fill="currentColor" stroke="white" strokeWidth={2} /> : <Icon size={22} />}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[14px] text-slate-700">{c.label}</span>
          {query.isLoading
            ? <span className="fp-skeleton mt-1 block h-6 w-10" />
            : <span className="block text-2xl font-bold leading-tight text-slate-900">{num(cardValue(c.key))}</span>}
        </span>
      </button>
    )
  }

  return (
    <>
      <header className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-[26px] font-bold leading-tight text-slate-900 sm:text-[32px]">Supplier Order Management</h1>
          <p className="mt-1 text-sm text-slate-500 sm:text-[15px]">Manage supplier PO issuance, factory progress and courier tracking from one operational grid.</p>
        </div>
        <a href={NEW_PO_URL} target="_blank" rel="noopener noreferrer"
          className="inline-flex h-11 shrink-0 items-center justify-center gap-2.5 self-start rounded-md bg-[#0f8f86] px-5 text-[15px] font-medium text-white shadow-sm transition hover:bg-[#0c7a72]">
          <Plus size={20} /> Issue PO to Supplier
        </a>
      </header>

      {/* Summary cards: six, then five — a click filters the grid */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {CARDS.slice(0, 6).map(renderCard)}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        {CARDS.slice(6).map(renderCard)}
      </div>

      {/* Filters */}
      <div className="mt-5 flex flex-wrap items-center gap-2.5">
        <div className="relative min-w-0 basis-full md:basis-auto md:flex-[2.2] md:min-w-[260px]">
          <Search size={17} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            className="h-10 w-full rounded-lg border border-line bg-white pl-10 pr-9 text-[13px] text-slate-800 outline-none transition placeholder:text-slate-500 focus:border-brand focus:ring-2 focus:ring-brand/15"
            placeholder="Search by PO#, customer, order no, tracking ID..." value={search} onChange={e => setSearch(e.target.value)}
            aria-label="Search purchase orders"
          />
          {search && (
            <button className="absolute right-2 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded text-slate-500 hover:bg-slate-100"
              onClick={() => setSearch('')} aria-label="Clear search"><X size={14} /></button>
          )}
        </div>
        <label className="relative min-w-0 flex-1 basis-[calc(50%-5px)] sm:basis-[160px]">
          <span className="sr-only">Factory</span>
          <select className={selectClass} value={factory}
            onChange={e => {
              if (e.target.value === MANAGE_FACTORIES) { setFactoriesOpen(true); return }
              update({ factory: e.target.value || null })
            }}>
            <option value="">Factory: All</option>
            <option value="none">Factory: Not set</option>
            {(data?.filters.factories ?? []).map(f => <option key={f.id} value={f.id}>Factory: {f.name}</option>)}
            <option value={MANAGE_FACTORIES}>＋ Manage factories…</option>
          </select>
          <Chevron />
        </label>
        <label className="relative min-w-0 flex-1 basis-[calc(50%-5px)] sm:basis-[160px]">
          <span className="sr-only">Status</span>
          <select className={selectClass} value={stage} onChange={e => update({ stage: e.target.value || null })}>
            <option value="">Status: All</option>
            <option value="Pending">Status: Pending</option>
            {STAGES.map(s => <option key={s} value={s}>Status: {s}</option>)}
          </select>
          <Chevron />
        </label>
        <label className="relative min-w-0 flex-1 basis-[calc(50%-5px)] sm:basis-[150px]">
          <span className="sr-only">Courier</span>
          <select className={selectClass} value={courier} onChange={e => update({ courier: e.target.value || null })}>
            <option value="">Courier: All</option>
            <option value="none">Courier: Not set</option>
            {(data?.filters.couriers ?? []).map(c => <option key={c} value={c}>Courier: {c}</option>)}
          </select>
          <Chevron />
        </label>
        <button onClick={() => setMoreFilters(v => !v)} aria-expanded={moreFilters}
          className={`flex h-10 min-w-0 flex-1 basis-[calc(50%-5px)] items-center justify-center gap-2 rounded-lg border bg-white px-4 text-[13px] text-slate-800 transition hover:bg-slate-50 sm:flex-none sm:basis-auto ${moreFilters ? 'border-blue-500 text-blue-600' : 'border-line'}`}>
          <Filter size={16} /> Add filter
        </button>
        <div className="relative flex-1 basis-[calc(50%-5px)] sm:flex-none sm:basis-auto" ref={columnsRef}>
          <button onClick={() => setColumnsOpen(v => !v)} aria-expanded={columnsOpen}
            className="flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-line bg-white px-4 text-[13px] text-slate-800 transition hover:bg-slate-50">
            <Columns3 size={16} /> Manage columns
          </button>
          {columnsOpen && (
            <div className="absolute right-0 z-30 mt-1.5 w-56 rounded-xl border border-line bg-white p-2 shadow-pop">
              {COLUMNS.map(c => (
                <label key={c.key} className={`flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm ${c.required ? 'text-slate-400' : 'cursor-pointer text-slate-800 hover:bg-slate-50'}`}>
                  <input type="checkbox" className="h-4 w-4 accent-blue-600" disabled={c.required} checked={!hidden.includes(c.key)}
                    onChange={e => setHidden(h => e.target.checked ? h.filter(k => k !== c.key) : [...h, c.key])} />
                  {c.label}
                </label>
              ))}
              {hidden.length > 0 && (
                <button className="mt-1 w-full rounded-md px-2 py-1.5 text-left text-[13px] font-medium text-blue-600 hover:bg-slate-50" onClick={() => setHidden([])}>
                  Show all columns
                </button>
              )}
            </div>
          )}
        </div>
        {filtersOn && (
          <button onClick={clearFilters} className="flex h-10 items-center gap-1.5 rounded-lg px-3 text-[13px] text-slate-600 transition hover:bg-slate-100">
            <X size={15} /> Clear
          </button>
        )}
      </div>

      {moreFilters && (
        <div className="mt-2.5 flex flex-wrap items-end gap-2.5">
          <label className="min-w-[150px] flex-1 sm:flex-none">
            <span className="mb-1 block text-xs text-slate-600">Push date from</span>
            <input type="date" className="h-10 w-full rounded-lg border border-line bg-white px-3 text-[13px] outline-none focus:border-brand" value={pushFrom} max={pushTo || undefined} onChange={e => update({ push_from: e.target.value || null })} />
          </label>
          <label className="min-w-[150px] flex-1 sm:flex-none">
            <span className="mb-1 block text-xs text-slate-600">Push date to</span>
            <input type="date" className="h-10 w-full rounded-lg border border-line bg-white px-3 text-[13px] outline-none focus:border-brand" value={pushTo} min={pushFrom || undefined} onChange={e => update({ push_to: e.target.value || null })} />
          </label>
        </div>
      )}

      {/* Grid — relative, so the header's screen-reader label (absolutely
          positioned) stays inside the card instead of widening the page. */}
      <div className="relative mt-4 overflow-hidden rounded-xl border border-line bg-white shadow-card">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px] border-collapse">
            <thead>
              <tr className="border-b border-line">
                {visible.map(c => (
                  <th key={c.key} className="px-1.5 py-3.5 text-left 2xl:px-2 align-middle text-[13px] font-semibold text-slate-800"
                    aria-sort={sorted && sort === c.sort ? (dir === 'asc' ? 'ascending' : 'descending') : undefined}>
                    <button className="inline-flex items-center gap-1 text-left hover:text-blue-600"
                      onClick={() => update({ sort: c.sort, dir: sort === c.sort && dir === 'desc' ? 'asc' : 'desc' })}>
                      <span className={WRAP.has(c.key) ? '' : 'whitespace-nowrap'}>{c.label}</span>
                      {sorted && sort === c.sort
                        ? (dir === 'asc' ? <ArrowUp size={14} className="text-blue-600" /> : <ArrowDown size={14} className="text-blue-600" />)
                        : <ArrowUpDown size={12} className="shrink-0 text-slate-500" />}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <TableStates
                colSpan={visible.length}
                loading={query.isLoading}
                error={query.isError ? 'The purchase orders could not be loaded.' : null}
                empty={!query.isLoading && !query.isError && rows.length === 0}
                emptyMessage={filtersOn ? 'No purchase orders match these filters.' : 'No purchase orders have been shared with you yet.'}
                onRetry={() => query.refetch()}
              />
              {!query.isLoading && !query.isError && rows.map((r, i) => (
                <tr key={r.id} className="cursor-pointer border-b border-line text-[13px] last:border-0 hover:bg-slate-50" title={`Open ${r.po_number}`}
                  onClick={() => navigate(`/purchase-orders/${r.id}`)}>
                  {visible.map(c => <td key={c.key} className={`px-1.5 py-[9px] 2xl:px-2 ${WRAP.has(c.key) ? '' : 'whitespace-nowrap'}`}>{cell(r, c.key, i)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex flex-col gap-3 border-t border-line px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-[13px] text-slate-700">
            {total === 0 ? 'No orders' : `Showing ${(page - 1) * PAGE_SIZE + 1} – ${Math.min(page * PAGE_SIZE, total)} of ${num(total)} orders`}
          </span>
          <nav className="flex flex-wrap items-center gap-1.5" aria-label="Pagination">
            <button className="grid h-9 w-9 place-items-center rounded-md border border-line bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40"
              disabled={page <= 1} onClick={() => update({ page: page - 1 }, false)} aria-label="Previous page"><ChevronLeft size={16} /></button>
            {pageNumbers.map((n, i) => n === '…'
              ? <span key={`gap-${i}`} className="px-1.5 text-slate-500">…</span>
              : <button key={n} onClick={() => update({ page: n }, false)} aria-current={n === page ? 'page' : undefined}
                  className={`grid h-9 min-w-9 place-items-center rounded-md border px-2.5 text-[13px] ${n === page ? 'border-blue-600 bg-blue-600 text-white' : 'border-line bg-white text-slate-700 hover:bg-slate-50'}`}>{n}</button>)}
            <button className="grid h-9 w-9 place-items-center rounded-md border border-line bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40"
              disabled={page >= pages} onClick={() => update({ page: page + 1 }, false)} aria-label="Next page"><ChevronRight size={16} /></button>
          </nav>
        </div>
      </div>

      <FactoriesModal open={factoriesOpen} onClose={() => setFactoriesOpen(false)} />
    </>
  )
}
