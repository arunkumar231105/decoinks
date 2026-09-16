import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import {
  ArrowDown, ArrowUp, ArrowUpDown, Boxes, CheckCircle2, ChevronLeft, ChevronRight, ClipboardList, Factory, Package, Search, Truck, X,
  type LucideIcon,
} from 'lucide-react'
import { TableStates, fmtDate, num } from '../ui'
import api from '../../services/api'

/**
 * The Products and Inventory pages, in the Supplier Order Management look.
 * Both read GET /products: every product across the POs shared with this
 * supplier, with its quantity split by where those POs stand. Products lists
 * what has been ordered; Inventory shows where the pieces are.
 */

export interface Product {
  key: string
  name: string
  category: string | null
  color: string | null
  size: string | null
  qty: number
  with_factory: number
  on_the_way: number
  delivered: number
  po_count: number
  customer_count: number
  po_numbers: string[]
  last_ordered: string | null
}

type Mode = 'products' | 'inventory'
type Where = '' | 'with_factory' | 'on_the_way' | 'delivered'

const PAGE_SIZE = 10

const COPY: Record<Mode, { title: string; subtitle: string }> = {
  products: {
    title: 'Products',
    subtitle: 'Every product on the purchase orders shared with you — how much was ordered, on how many POs, and when last.',
  },
  inventory: {
    title: 'Inventory',
    subtitle: 'Where every ordered piece stands — still with the factory, on the way to the customer, or delivered.',
  },
}

const variant = (p: Product) => [p.color, p.size].filter(Boolean).join(' / ')

function Card({ label, value, icon: Icon, tone, active, onClick, loading }: {
  label: string; value: number; icon: LucideIcon; tone: string; active?: boolean; onClick?: () => void; loading: boolean
}) {
  const body = (
    <>
      <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-lg ${tone}`}><Icon size={22} /></span>
      <span className="min-w-0">
        <span className="block truncate text-[14px] text-slate-700">{label}</span>
        {loading
          ? <span className="fp-skeleton mt-1 block h-6 w-10" />
          : <span className="block text-2xl font-bold leading-tight text-slate-900">{num(value)}</span>}
      </span>
    </>
  )
  const cls = `flex min-w-0 items-center gap-3.5 rounded-lg border bg-white px-4 py-[15px] text-left shadow-card transition ${active ? 'border-blue-500 ring-1 ring-blue-500/30' : 'border-line'}`
  return onClick
    ? <button type="button" onClick={onClick} aria-pressed={Boolean(active)} className={`${cls} hover:shadow-pop ${active ? '' : 'hover:border-slate-300'}`}>{body}</button>
    : <div className={cls}>{body}</div>
}

export default function ProductsView({ mode }: { mode: Mode }) {
  const [search, setSearch] = useState('')
  const [where, setWhere] = useState<Where>('')
  const [sort, setSort] = useState<{ key: keyof Product; dir: 1 | -1 } | null>(null)
  const [page, setPage] = useState(1)

  const query = useQuery({
    queryKey: ['portal-products'],
    queryFn: () => api.get('/products').then(r => (r.data?.products ?? []) as Product[]),
  })
  const all = query.data ?? []

  const totals = useMemo(() => all.reduce(
    (t, p) => ({ qty: t.qty + p.qty, with_factory: t.with_factory + p.with_factory, on_the_way: t.on_the_way + p.on_the_way, delivered: t.delivered + p.delivered }),
    { qty: 0, with_factory: 0, on_the_way: 0, delivered: 0 },
  ), [all])
  const poCount = useMemo(() => new Set(all.flatMap(p => p.po_numbers)).size, [all])

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    let out = all.filter(p => !q || [p.name, p.category, p.color, p.size, ...p.po_numbers].some(v => String(v || '').toLowerCase().includes(q)))
    if (where) out = out.filter(p => p[where] > 0)
    if (sort) {
      out = [...out].sort((a, b) => {
        const x = a[sort.key] ?? '', y = b[sort.key] ?? ''
        if (typeof x === 'number' && typeof y === 'number') return (x - y) * sort.dir
        return String(x).localeCompare(String(y)) * sort.dir
      })
    }
    return out
  }, [all, search, where, sort])

  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const current = Math.min(page, pages)
  const shown = rows.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE)
  const filtersOn = Boolean(search.trim() || where)

  const columns: { key: keyof Product | 'sno' | 'variant' | 'progress'; label: string; align?: 'right' }[] = mode === 'products'
    ? [
        { key: 'sno', label: 'S.No' }, { key: 'name', label: 'Product' }, { key: 'category', label: 'Category' },
        { key: 'variant', label: 'Color / Size' }, { key: 'po_count', label: 'POs', align: 'right' },
        { key: 'customer_count', label: 'Customers', align: 'right' }, { key: 'qty', label: 'Qty Ordered', align: 'right' },
        { key: 'last_ordered', label: 'Last Ordered' },
      ]
    : [
        { key: 'sno', label: 'S.No' }, { key: 'name', label: 'Product' }, { key: 'variant', label: 'Color / Size' },
        { key: 'with_factory', label: 'With Factory', align: 'right' }, { key: 'on_the_way', label: 'On the Way', align: 'right' },
        { key: 'delivered', label: 'Delivered', align: 'right' }, { key: 'qty', label: 'Total Qty', align: 'right' },
        { key: 'progress', label: 'Delivered %' },
      ]

  const pick = (w: Where) => { setWhere(cur => (cur === w ? '' : w)); setPage(1) }

  const cell = (p: Product, key: typeof columns[number]['key'], i: number) => {
    const muted = <span className="text-slate-400">—</span>
    switch (key) {
      case 'sno': return <span className="text-slate-700">{(current - 1) * PAGE_SIZE + i + 1}</span>
      case 'name': return <span className="block max-w-[280px] truncate text-slate-900" title={p.name}>{p.name}</span>
      case 'category': return p.category ? <span className="text-slate-800">{p.category}</span> : muted
      case 'variant': return variant(p) ? <span className="text-slate-800">{variant(p)}</span> : muted
      case 'last_ordered': return p.last_ordered ? <span className="text-slate-800">{fmtDate(p.last_ordered)}</span> : muted
      case 'po_count': return (
        <span className="text-blue-600" title={p.po_numbers.join(', ')}>{num(p.po_count)}</span>
      )
      case 'with_factory': return <span className={p.with_factory ? 'text-orange-600' : 'text-slate-400'}>{num(p.with_factory)}</span>
      case 'on_the_way': return <span className={p.on_the_way ? 'text-blue-600' : 'text-slate-400'}>{num(p.on_the_way)}</span>
      case 'delivered': return <span className={p.delivered ? 'text-green-700' : 'text-slate-400'}>{num(p.delivered)}</span>
      case 'progress': {
        const pct = p.qty ? Math.round((p.delivered / p.qty) * 100) : 0
        return (
          <span className="flex items-center gap-2.5">
            <span className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-100">
              <span className="block h-full rounded-full bg-green-500" style={{ width: `${pct}%` }} />
            </span>
            <span className="w-9 text-right text-slate-700">{pct}%</span>
          </span>
        )
      }
      default: return <span className="text-slate-800">{num(p[key] as number)}</span>
    }
  }

  return (
    <>
      <header className="mb-5">
        <h1 className="text-[26px] font-bold leading-tight text-slate-900 sm:text-[32px]">{COPY[mode].title}</h1>
        <p className="mt-1 text-sm text-slate-500 sm:text-[15px]">{COPY[mode].subtitle}</p>
      </header>

      {mode === 'products' ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Card label="Products" value={all.length} icon={Package} tone="bg-blue-50 text-blue-600" loading={query.isLoading} />
          <Card label="Qty Ordered" value={totals.qty} icon={Boxes} tone="bg-purple-50 text-purple-600" loading={query.isLoading} />
          <Card label="Purchase Orders" value={poCount} icon={ClipboardList} tone="bg-orange-50 text-orange-500" loading={query.isLoading} />
          <Card label="Delivered" value={totals.delivered} icon={CheckCircle2} tone="bg-green-50 text-green-600" loading={query.isLoading} />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Card label="Total Qty" value={totals.qty} icon={Boxes} tone="bg-blue-50 text-blue-600" loading={query.isLoading}
            onClick={() => pick('')} />
          <Card label="With Factory" value={totals.with_factory} icon={Factory} tone="bg-orange-50 text-orange-500" loading={query.isLoading}
            active={where === 'with_factory'} onClick={() => pick('with_factory')} />
          <Card label="On the Way" value={totals.on_the_way} icon={Truck} tone="bg-teal-50 text-teal-600" loading={query.isLoading}
            active={where === 'on_the_way'} onClick={() => pick('on_the_way')} />
          <Card label="Delivered" value={totals.delivered} icon={CheckCircle2} tone="bg-green-50 text-green-600" loading={query.isLoading}
            active={where === 'delivered'} onClick={() => pick('delivered')} />
        </div>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-2.5">
        <div className="relative min-w-0 basis-full md:basis-[440px]">
          <Search size={17} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            className="h-10 w-full rounded-lg border border-line bg-white pl-10 pr-9 text-[13px] text-slate-800 outline-none transition placeholder:text-slate-500 focus:border-brand focus:ring-2 focus:ring-brand/15"
            placeholder="Search by product, color, size, PO#..." value={search}
            onChange={e => { setSearch(e.target.value); setPage(1) }} aria-label={`Search ${COPY[mode].title.toLowerCase()}`}
          />
          {search && (
            <button className="absolute right-2 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded text-slate-500 hover:bg-slate-100"
              onClick={() => setSearch('')} aria-label="Clear search"><X size={14} /></button>
          )}
        </div>
        {filtersOn && (
          <button onClick={() => { setSearch(''); setWhere(''); setPage(1) }} className="flex h-10 items-center gap-1.5 rounded-lg px-3 text-[13px] text-slate-600 transition hover:bg-slate-100">
            <X size={15} /> Clear
          </button>
        )}
        <Link to="/purchase-orders" className="ml-auto hidden text-[13px] text-blue-600 hover:underline sm:inline">Open Supplier Management →</Link>
      </div>

      <div className="relative mt-4 overflow-hidden rounded-xl border border-line bg-white shadow-card">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] border-collapse">
            <thead>
              <tr className="border-b border-line">
                {columns.map(c => {
                  const sortable = c.key !== 'sno' && c.key !== 'variant' && c.key !== 'progress'
                  const on = sortable && sort?.key === c.key
                  return (
                    <th key={c.key} className={`whitespace-nowrap px-3 py-3.5 text-[13px] font-semibold text-slate-800 ${c.align === 'right' ? 'text-right' : 'text-left'}`}
                      aria-sort={on ? (sort!.dir === 1 ? 'ascending' : 'descending') : undefined}>
                      {sortable ? (
                        <button className="inline-flex items-center gap-1 hover:text-blue-600"
                          onClick={() => { setSort(s => ({ key: c.key as keyof Product, dir: s?.key === c.key && s.dir === -1 ? 1 : -1 })); setPage(1) }}>
                          {c.label}
                          {on ? (sort!.dir === 1 ? <ArrowUp size={13} className="text-blue-600" /> : <ArrowDown size={13} className="text-blue-600" />)
                            : <ArrowUpDown size={13} className="text-slate-500" />}
                        </button>
                      ) : c.label}
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              <TableStates
                colSpan={columns.length}
                loading={query.isLoading}
                error={query.isError ? 'The products could not be loaded.' : null}
                empty={!query.isLoading && !query.isError && shown.length === 0}
                emptyMessage={filtersOn ? 'No products match these filters.' : 'No purchase orders with products have been shared with you yet.'}
                onRetry={() => query.refetch()}
              />
              {!query.isLoading && !query.isError && shown.map((p, i) => (
                <tr key={p.key} className="border-b border-line text-[13px] last:border-0 hover:bg-slate-50">
                  {columns.map(c => (
                    <td key={c.key} className={`whitespace-nowrap px-3 py-3 ${c.align === 'right' ? 'text-right' : ''}`}>{cell(p, c.key, i)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex flex-col gap-3 border-t border-line px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-[13px] text-slate-700">
            {rows.length === 0 ? 'No products' : `Showing ${(current - 1) * PAGE_SIZE + 1} – ${Math.min(current * PAGE_SIZE, rows.length)} of ${num(rows.length)} products`}
          </span>
          <nav className="flex flex-wrap items-center gap-1.5" aria-label="Pagination">
            <button className="grid h-9 w-9 place-items-center rounded-md border border-line bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40"
              disabled={current <= 1} onClick={() => setPage(current - 1)} aria-label="Previous page"><ChevronLeft size={16} /></button>
            {Array.from({ length: pages }, (_, k) => k + 1)
              .filter(n => n === 1 || n === pages || Math.abs(n - current) <= 1 || (current <= 3 && n <= 5))
              .map((n, i, list) => (
                <span key={n} className="flex items-center gap-1.5">
                  {i > 0 && n - list[i - 1] > 1 && <span className="px-1.5 text-slate-500">…</span>}
                  <button onClick={() => setPage(n)} aria-current={n === current ? 'page' : undefined}
                    className={`grid h-9 min-w-9 place-items-center rounded-md border px-2.5 text-[13px] ${n === current ? 'border-blue-600 bg-blue-600 text-white' : 'border-line bg-white text-slate-700 hover:bg-slate-50'}`}>{n}</button>
                </span>
              ))}
            <button className="grid h-9 w-9 place-items-center rounded-md border border-line bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40"
              disabled={current >= pages} onClick={() => setPage(current + 1)} aria-label="Next page"><ChevronRight size={16} /></button>
          </nav>
        </div>
      </div>
    </>
  )
}
