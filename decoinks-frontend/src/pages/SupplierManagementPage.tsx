import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle, ArrowDown, ArrowUp, ArrowUpDown, Box, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, Clock,
  Columns3, FileText, Filter, Plane, Plus, RefreshCw, Search, Send, Settings, Truck, X, type LucideIcon,
} from 'lucide-react'
import { api } from '../services/api'
import '../styles/supplier-management.css'

/**
 * Supplier Order Management — every order pushed to DIGI, with where it stands,
 * from the DIGI API (backend: modules/supplier-orders, synced every two minutes).
 * Laid out to the owner's design (17 Sep 2026). Read-only: status, factory and
 * tracking are DIGI's and the courier's.
 */

interface Row {
  order_no: string
  po_id: string | null
  po_numbers: string[]
  sales_order_id: string | null
  sales_order_number: string | null
  customer_name: string | null
  customer_location: string | null
  factory: string | null
  push_date: string | null
  order_time: string | null
  stage: string
  digi_status_label: string | null
  items: string | null
  item_lines: { title: string | null; color: string | null; size: string | null; qty: number }[]
  qty: number | null
  courier: string | null
  tracking_number: string | null
  tracking_text: string | null
  courier_eta: string | null
  delivered_date: string | null
  shipping_time: string | null
  label_url: string | null
  label_tracking_number: string | null
  label_courier: string | null
  reason: string | null
  synced_at: string | null
}
interface GridResponse {
  rows: Row[]
  total: number
  summary: { total: number; issued: number; pending: number; stages: Record<string, number> }
  filters: { stages: string[]; factories: string[]; couriers: string[] }
  synced_at: string | null
}

const PAGE_SIZE = 8
const COLUMNS_KEY = 'som-hidden-columns'
const STAGES = ['To be Pushed', 'Factory Audit', 'In Production', 'Exception', 'Shipped', 'Pre-Transit', 'In Transit', 'Delivered', 'Cancelled']
const slug = (s: string) => s.toLowerCase().replace(/[^a-z]+/g, '-')

const CARDS: { label: string; filter: string; icon: LucideIcon; bg: string; fg: string; solid?: boolean; value: (g: GridResponse) => number }[] = [
  { label: 'Total PO', filter: '', icon: FileText, bg: '#eff6ff', fg: '#2563eb', value: g => g.summary.total },
  { label: 'Issued', filter: 'Issued', icon: CheckCircle2, bg: '#f0fdf4', fg: '#16a34a', value: g => g.summary.issued },
  { label: 'Pending', filter: 'Pending', icon: Clock, bg: '#fff7ed', fg: '#f97316', value: g => g.summary.pending },
  { label: 'To be Pushed', filter: 'To be Pushed', icon: Send, bg: '#eff6ff', fg: '#2563eb', value: g => g.summary.stages['To be Pushed'] ?? 0 },
  { label: 'Factory Audit', filter: 'Factory Audit', icon: Search, bg: '#faf5ff', fg: '#9333ea', value: g => g.summary.stages['Factory Audit'] ?? 0 },
  { label: 'In Production', filter: 'In Production', icon: Settings, bg: '#eff6ff', fg: '#2563eb', value: g => g.summary.stages['In Production'] ?? 0 },
  { label: 'Exceptions', filter: 'Exception', icon: AlertTriangle, bg: '#fef2f2', fg: '#dc2626', value: g => g.summary.stages.Exception ?? 0 },
  { label: 'Shipped', filter: 'Shipped', icon: Truck, bg: '#f0fdfa', fg: '#0d9488', value: g => g.summary.stages.Shipped ?? 0 },
  { label: 'Pre-Transit', filter: 'Pre-Transit', icon: Box, bg: '#ecfeff', fg: '#0e7490', value: g => g.summary.stages['Pre-Transit'] ?? 0 },
  { label: 'Transit', filter: 'In Transit', icon: Plane, bg: '#eef2ff', fg: '#4f46e5', value: g => g.summary.stages['In Transit'] ?? 0 },
  { label: 'Delivered', filter: 'Delivered', icon: CheckCircle2, bg: '#f0fdf4', fg: '#16a34a', solid: true, value: g => g.summary.stages.Delivered ?? 0 },
]

type ColumnKey = 'sno' | 'po_number' | 'customer' | 'order_no' | 'factory' | 'push_date' | 'stage' | 'items' | 'qty' | 'courier' | 'tracking_number' | 'tracking_text'
const COLUMNS: { key: ColumnKey; label: string; sort: string; required?: boolean }[] = [
  { key: 'sno', label: 'S.No', sort: 'push_date' },
  { key: 'po_number', label: 'PO#', sort: 'po_number' },
  { key: 'customer', label: 'Customer', sort: 'customer' },
  { key: 'order_no', label: 'Order No', sort: 'order_no', required: true },
  { key: 'factory', label: 'Factory', sort: 'factory' },
  { key: 'push_date', label: 'Push Date', sort: 'push_date' },
  { key: 'stage', label: 'Status', sort: 'stage', required: true },
  { key: 'items', label: 'Items', sort: 'items' },
  { key: 'qty', label: 'Qty', sort: 'qty' },
  { key: 'courier', label: 'Courier Service', sort: 'courier' },
  { key: 'tracking_number', label: 'Tracking ID', sort: 'tracking_number' },
  { key: 'tracking_text', label: 'Tracking Status', sort: 'tracking_text' },
]

const num = (n?: number | null) => Number(n ?? 0).toLocaleString('en-US')
const when = (v?: string | null) => v ? new Date(v).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—'
const day = (v?: string | null) => v ? new Date(`${String(v).slice(0, 10)}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'
const ago = (v?: string | null) => {
  if (!v) return 'never'
  const m = Math.round((Date.now() - new Date(v).getTime()) / 60000)
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`
}
function trackUrl(courier?: string | null, n?: string | null) {
  if (!n) return null
  const c = String(courier || '').toUpperCase()
  const t = encodeURIComponent(n)
  if (c.includes('USPS')) return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${t}`
  if (c.includes('UPS')) return `https://www.ups.com/track?tracknum=${t}`
  if (c.includes('FEDEX')) return `https://www.fedex.com/fedextrack/?trknbr=${t}`
  return null
}
const readHidden = (): ColumnKey[] => { try { return JSON.parse(localStorage.getItem(COLUMNS_KEY) || '[]') } catch { return [] } }

function Chevron() { return <ChevronDown size={16} /> }

export function SupplierManagementPage() {
  const qc = useQueryClient()
  const [params, setParams] = useSearchParams()
  const [search, setSearch] = useState(params.get('search') ?? '')
  const stage = params.get('stage') ?? ''
  const factory = params.get('factory') ?? ''
  const courier = params.get('courier') ?? ''
  const pushFrom = params.get('push_from') ?? ''
  const pushTo = params.get('push_to') ?? ''
  const sorted = params.has('sort')
  const sort = params.get('sort') ?? 'push_date'
  const dir = params.get('dir') === 'asc' ? 'asc' : 'desc'
  const page = Math.max(1, Number(params.get('page')) || 1)
  const [hidden, setHidden] = useState<ColumnKey[]>(readHidden)
  const [colsOpen, setColsOpen] = useState(false)
  const [dates, setDates] = useState(Boolean(pushFrom || pushTo))
  const [open, setOpen] = useState<Row | null>(null)
  const colsRef = useRef<HTMLDivElement>(null)

  const update = (next: Record<string, string | number | null>, resetPage = true) => {
    const p = new URLSearchParams(params)
    for (const [k, v] of Object.entries(next)) (v === null || v === '') ? p.delete(k) : p.set(k, String(v))
    if (resetPage && !('page' in next)) p.delete('page')
    setParams(p, { replace: true })
  }

  useEffect(() => {
    const t = setTimeout(() => { if ((params.get('search') ?? '') !== search.trim()) update({ search: search.trim() || null }) }, 300)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])
  useEffect(() => { try { localStorage.setItem(COLUMNS_KEY, JSON.stringify(hidden)) } catch { /* private mode */ } }, [hidden])
  useEffect(() => {
    if (!colsOpen) return
    const close = (e: MouseEvent) => { if (!colsRef.current?.contains(e.target as Node)) setColsOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [colsOpen])
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(null) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  const query = useQuery({
    queryKey: ['digi-orders', { search: params.get('search') ?? '', stage, factory, courier, pushFrom, pushTo, sort, dir, page }],
    queryFn: () => api.get('/supplier-orders/digi', {
      params: {
        search: params.get('search') || undefined, stage: stage || undefined, factory: factory || undefined,
        courier: courier || undefined, push_from: pushFrom || undefined, push_to: pushTo || undefined,
        sort, dir, page, limit: PAGE_SIZE,
      },
    }).then(r => r.data as GridResponse),
    placeholderData: keepPreviousData,
    // Live: the server syncs DIGI every two minutes; the page looks every 30 seconds.
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  })
  const sync = useMutation({
    mutationFn: () => api.post('/supplier-orders/digi/sync').then(r => r.data),
    onSettled: () => qc.invalidateQueries({ queryKey: ['digi-orders'] }),
  })

  const data = query.data
  const rows = data?.rows ?? []
  const total = data?.total ?? 0
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const visible = COLUMNS.filter(c => !hidden.includes(c.key))
  const filtersOn = Boolean(params.get('search') || stage || factory || courier || pushFrom || pushTo)

  const pageNumbers = useMemo(() => {
    const out: (number | '…')[] = []
    for (let n = 1; n <= pages; n++) {
      if (n === 1 || n === pages || Math.abs(n - page) <= 1 || (page <= 3 && n <= 5)) out.push(n)
      else if (out[out.length - 1] !== '…') out.push('…')
    }
    return out
  }, [page, pages])

  const cell = (r: Row, key: ColumnKey, i: number) => {
    const dash = <span className="som-muted">—</span>
    switch (key) {
      case 'sno': return (page - 1) * PAGE_SIZE + i + 1
      case 'po_number': return r.po_numbers.length
        ? <span className="som-link som-nw">{r.po_numbers.map(p => <span key={p} style={{ display: 'block' }}>{p}</span>)}</span>
        : dash
      case 'customer': return (
        <span className="som-wrap">{r.customer_name ?? '—'}{r.customer_location && <span className="som-sub">{r.customer_location}</span>}</span>
      )
      case 'order_no': return <span className="som-nw">{r.order_no}</span>
      case 'factory': return r.factory ? <span className="som-wrap">{r.factory}</span> : dash
      case 'push_date': return r.push_date ? <span className="som-nw">{r.push_date}</span> : dash
      case 'stage': return <span className={`som-pill st-${slug(r.stage)}`}>{r.stage}</span>
      case 'items': return r.items ? <span className="som-wrap">{r.items}</span> : dash
      case 'qty': return r.qty != null ? num(r.qty) : dash
      case 'courier': return r.courier ? String(r.courier).toUpperCase() : dash
      case 'tracking_number': {
        if (!r.tracking_number) return dash
        const url = trackUrl(r.courier, r.tracking_number)
        return url
          ? <a href={url} target="_blank" rel="noopener noreferrer" className="som-nw" style={{ color: 'inherit' }} onClick={e => e.stopPropagation()}>{r.tracking_number}</a>
          : <span className="som-nw">{r.tracking_number}</span>
      }
      case 'tracking_text': return r.tracking_text ? <span className={`som-wrap tx-${slug(r.stage)}`}>{r.tracking_text}</span> : dash
    }
  }

  return (
    <div className="som">
      <div className="som-top">
        <div className="som-sync">
          <span>DIGI orders · synced {ago(data?.synced_at)}</span>
          <button onClick={() => sync.mutate()} disabled={sync.isPending} title="Ask the DIGI API again now">
            <RefreshCw size={14} className={sync.isPending ? 'som-spin' : undefined} /> {sync.isPending ? 'Syncing…' : 'Sync now'}
          </button>
          {sync.isError && <span style={{ color: '#dc2626' }}>Sync failed — try again in a minute</span>}
        </div>
        <Link to="/purchase-orders/new" className="som-issue"><Plus size={20} /> Issue PO to Supplier</Link>
      </div>

      {[CARDS.slice(0, 6), CARDS.slice(6)].map((group, gi) => (
        <div key={gi} className={`som-cards ${gi === 0 ? 'six' : 'five'}`}>
          {group.map(c => {
            const on = Boolean(stage) && stage === c.filter
            const Icon = c.icon
            return (
              <button key={c.label} className={`som-card${on ? ' on' : ''}`} aria-pressed={on} onClick={() => update({ stage: c.filter || null })}>
                <span className="som-card-icon" style={{ background: c.bg, color: c.fg }}>
                  {c.solid ? <Icon size={24} fill="currentColor" stroke="white" /> : <Icon size={22} />}
                </span>
                <span style={{ minWidth: 0 }}>
                  <span className="som-card-label">{c.label}</span>
                  <span className="som-card-value">{data ? num(c.value(data)) : '–'}</span>
                </span>
              </button>
            )
          })}
        </div>
      ))}

      <div className="som-filters">
        <div className="som-search">
          <Search size={17} />
          <input placeholder="Search by PO#, customer, order no, tracking ID..." value={search} onChange={e => setSearch(e.target.value)} aria-label="Search DIGI orders" />
          {search && <button onClick={() => setSearch('')} aria-label="Clear search"><X size={14} /></button>}
        </div>
        <label className="som-select">
          <select value={factory} onChange={e => update({ factory: e.target.value || null })} aria-label="Factory">
            <option value="">Factory: All</option>
            <option value="none">Factory: Not given by DIGI</option>
            {(data?.filters.factories ?? []).map(f => <option key={f} value={f}>Factory: {f}</option>)}
          </select>
          <Chevron />
        </label>
        <label className="som-select">
          <select value={stage} onChange={e => update({ stage: e.target.value || null })} aria-label="Status">
            <option value="">Status: All</option>
            <option value="Pending">Status: Pending</option>
            {STAGES.map(s => <option key={s} value={s}>Status: {s}</option>)}
          </select>
          <Chevron />
        </label>
        <label className="som-select">
          <select value={courier} onChange={e => update({ courier: e.target.value || null })} aria-label="Courier">
            <option value="">Courier: All</option>
            {(data?.filters.couriers ?? []).map(c => <option key={c} value={c}>Courier: {c}</option>)}
          </select>
          <Chevron />
        </label>
        <button className={`som-btn${dates ? ' on' : ''}`} onClick={() => setDates(v => !v)} aria-expanded={dates}><Filter size={16} /> Add filter</button>
        <div className="som-cols" ref={colsRef}>
          <button className="som-btn" onClick={() => setColsOpen(v => !v)} aria-expanded={colsOpen}><Columns3 size={16} /> Manage columns</button>
          {colsOpen && (
            <div className="som-cols-menu">
              {COLUMNS.map(c => (
                <label key={c.key} style={c.required ? { color: '#94a3b8', cursor: 'default' } : undefined}>
                  <input type="checkbox" disabled={c.required} checked={!hidden.includes(c.key)}
                    onChange={e => setHidden(h => e.target.checked ? h.filter(k => k !== c.key) : [...h, c.key])} />
                  {c.label}
                </label>
              ))}
            </div>
          )}
        </div>
        {filtersOn && <button className="som-btn plain" onClick={() => { setSearch(''); setParams(new URLSearchParams(), { replace: true }) }}><X size={15} /> Clear</button>}
      </div>

      {dates && (
        <div className="som-dates">
          <label>Push date from<input type="date" value={pushFrom} max={pushTo || undefined} onChange={e => update({ push_from: e.target.value || null })} /></label>
          <label>Push date to<input type="date" value={pushTo} min={pushFrom || undefined} onChange={e => update({ push_to: e.target.value || null })} /></label>
        </div>
      )}

      <div className="som-table-card">
        <div className="som-scroll">
          <table className="som-table">
            <thead>
              <tr>
                {visible.map(c => (
                  <th key={c.key} aria-sort={sorted && sort === c.sort ? (dir === 'asc' ? 'ascending' : 'descending') : undefined}>
                    <button onClick={() => update({ sort: c.sort, dir: sort === c.sort && dir === 'desc' ? 'asc' : 'desc' })}>
                      {c.label}
                      {sorted && sort === c.sort
                        ? (dir === 'asc' ? <ArrowUp size={13} color="#2563eb" /> : <ArrowDown size={13} color="#2563eb" />)
                        : <ArrowUpDown size={12} color="#64748b" />}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {query.isLoading && Array.from({ length: PAGE_SIZE }).map((_, i) => (
                <tr key={i}><td colSpan={visible.length}><div className="som-skel" /></td></tr>
              ))}
              {query.isError && <tr><td colSpan={visible.length} className="som-empty">The DIGI orders could not be loaded. <button className="som-btn" onClick={() => query.refetch()}>Try again</button></td></tr>}
              {!query.isLoading && !query.isError && rows.length === 0 && (
                <tr><td colSpan={visible.length} className="som-empty">{filtersOn ? 'No DIGI orders match these filters.' : 'No DIGI orders yet.'}</td></tr>
              )}
              {!query.isLoading && !query.isError && rows.map((r, i) => (
                <tr key={r.order_no} onClick={() => setOpen(r)} title={`Open ${r.order_no}`}>
                  {visible.map(c => <td key={c.key}>{cell(r, c.key, i)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="som-foot">
          <span>{total === 0 ? 'No orders' : `Showing ${(page - 1) * PAGE_SIZE + 1} – ${Math.min(page * PAGE_SIZE, total)} of ${num(total)} orders`}</span>
          <nav className="som-pages" aria-label="Pagination">
            <button disabled={page <= 1} onClick={() => update({ page: page - 1 }, false)} aria-label="Previous page"><ChevronLeft size={16} /></button>
            {pageNumbers.map((n, i) => n === '…'
              ? <span key={`g${i}`} style={{ padding: '0 4px', color: '#64748b' }}>…</span>
              : <button key={n} className={n === page ? 'on' : undefined} aria-current={n === page ? 'page' : undefined} onClick={() => update({ page: n }, false)}>{n}</button>)}
            <button disabled={page >= pages} onClick={() => update({ page: page + 1 }, false)} aria-label="Next page"><ChevronRight size={16} /></button>
          </nav>
        </div>
      </div>

      {open && (
        <>
          <button className="som-scrim" aria-label="Close" onClick={() => setOpen(null)} />
          <aside className="som-drawer" role="dialog" aria-modal="true" aria-label={`DIGI order ${open.order_no}`}>
            <header>
              <div>
                <small>DIGI order</small>
                <h3>{open.order_no}</h3>
                <span className={`som-pill st-${slug(open.stage)}`} style={{ marginTop: 6 }}>{open.stage}</span>
              </div>
              <button className="som-x" onClick={() => setOpen(null)} aria-label="Close"><X size={20} /></button>
            </header>
            <section>
              <h4>DIGI</h4>
              <dl className="som-kv">
                <dt>DIGI status</dt><dd>{open.digi_status_label ?? '—'}</dd>
                {open.reason && <><dt>Reason</dt><dd style={{ color: '#dc2626' }}>{open.reason}</dd></>}
                <dt>Pushed</dt><dd>{when(open.order_time)}</dd>
                <dt>Factory</dt><dd>{open.factory ?? 'Not given by DIGI'}</dd>
                <dt>Shipped by DIGI</dt><dd>{when(open.shipping_time)}</dd>
                <dt>Customer</dt><dd>{open.customer_name ?? '—'}{open.customer_location ? `, ${open.customer_location}` : ''}</dd>
                <dt>Pieces</dt><dd>{open.qty != null ? num(open.qty) : '—'}</dd>
              </dl>
            </section>
            <section>
              <h4>Shipping</h4>
              <dl className="som-kv">
                <dt>Courier</dt><dd>{open.courier ?? open.label_courier ?? '—'}</dd>
                <dt>Tracking ID</dt>
                <dd>{(open.tracking_number || open.label_tracking_number)
                  ? (trackUrl(open.courier ?? open.label_courier, open.tracking_number ?? open.label_tracking_number)
                    ? <a className="som-link" href={trackUrl(open.courier ?? open.label_courier, open.tracking_number ?? open.label_tracking_number)!} target="_blank" rel="noopener noreferrer">{open.tracking_number ?? open.label_tracking_number}</a>
                    : (open.tracking_number ?? open.label_tracking_number))
                  : '—'}</dd>
                <dt>Tracking status</dt><dd>{open.tracking_text ?? '—'}</dd>
                {open.courier_eta && <><dt>Expected</dt><dd>{day(open.courier_eta)}</dd></>}
                {open.delivered_date && <><dt>Delivered</dt><dd>{day(open.delivered_date)}</dd></>}
                <dt>Shipping label</dt><dd>{open.label_url ? <a className="som-link" href={open.label_url} target="_blank" rel="noopener noreferrer">Open label PDF</a> : '—'}</dd>
              </dl>
            </section>
            <section>
              <h4>Printshop</h4>
              <dl className="som-kv">
                <dt>Purchase order</dt>
                <dd>{open.po_numbers.length
                  ? (open.po_id ? <Link className="som-link" to={`/purchase-orders/${open.po_id}`}>{open.po_numbers[0]}</Link> : open.po_numbers.join(', '))
                  : 'Not linked'}</dd>
                <dt>Sales order</dt>
                <dd>{open.sales_order_id ? <Link className="som-link" to={`/orders/${open.sales_order_id}`}>{open.sales_order_number}</Link> : 'Not linked'}</dd>
              </dl>
            </section>
            {open.item_lines.length > 0 && (
              <section>
                <h4>Items</h4>
                <table className="som-lines">
                  <thead><tr><th>Item</th><th>Colour / Size</th><th>Qty</th></tr></thead>
                  <tbody>
                    {open.item_lines.map((l, i) => (
                      <tr key={i}><td>{l.title ?? '—'}</td><td>{[l.color, l.size].filter(Boolean).join(' / ') || '—'}</td><td>{num(l.qty)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </section>
            )}
            <p style={{ fontSize: 12, color: '#94a3b8', margin: '12px 0 0' }}>From the DIGI API · synced {ago(open.synced_at)}</p>
          </aside>
        </>
      )}
    </div>
  )
}
