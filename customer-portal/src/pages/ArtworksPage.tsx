import { useMemo, useState } from 'react'
import {
  Image as ImageIcon, Repeat, ShoppingBag, MoreVertical, RotateCcw, Download, CalendarDays, ArrowDown,
} from 'lucide-react'
import { Layout } from '../components/Layout'
import { SidePanel, DetailRow, PanelSection } from '../components/SidePanel'
import { Badge, EmptyRow, Pagination, StatCard, Thumb } from '../components/ui'
import { ARTWORKS, SUMMARY, num, type Artwork } from '../data/mock'
import { cn } from '../utils/cn'

export default function ArtworksPage() {
  const [selected, setSelected] = useState<Artwork | null>(null)
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [order, setOrder] = useState('All Orders')
  const [type, setType] = useState('All')
  const [size, setSize] = useState('All')
  const [page, setPage] = useState(1)
  const [rows, setRows] = useState(10)

  const sizes = useMemo(() => ['All', ...Array.from(new Set(ARTWORKS.map(a => a.size)))], [])
  const orders = useMemo(
    () => ['All Orders', ...Array.from(new Set(ARTWORKS.flatMap(a => a.usedInOrders.map(u => u.orderNo))))],
    [])

  const filtered = useMemo(() => ARTWORKS.filter(a =>
    (type === 'All' || a.fileType === type) &&
    (size === 'All' || a.size === size) &&
    (order === 'All Orders' || a.usedInOrders.some(u => u.orderNo === order))), [type, size, order])

  const pageCount = Math.max(1, Math.ceil(filtered.length / rows))
  const current = Math.min(page, pageCount)
  const visible = filtered.slice((current - 1) * rows, current * rows)

  const allShown = visible.length > 0 && visible.every(a => checked.has(a.id))
  const toggleAll = () => {
    const next = new Set(checked)
    if (allShown) visible.forEach(a => next.delete(a.id))
    else visible.forEach(a => next.add(a.id))
    setChecked(next)
  }
  const toggleOne = (id: string) => {
    const next = new Set(checked)
    next.has(id) ? next.delete(id) : next.add(id)
    setChecked(next)
  }

  const clearFilters = () => { setOrder('All Orders'); setType('All'); setSize('All'); setPage(1) }

  return (
    <Layout title="Artworks" subtitle="View and manage all artwork files." searchPlaceholder="Search by artwork name, order no, size…">
      {/* Stats */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard icon={ImageIcon} value={SUMMARY.artworks} label="Total Artworks" hint="Total uploaded" />
        <StatCard icon={Repeat} value={num(SUMMARY.transfersQty)} label="Total Transfers Qty" hint="Across all orders" tone="bg-emerald-50 text-emerald-600" />
        <StatCard icon={ShoppingBag} value={SUMMARY.artworksUsedInOrders} label="Artworks Used in Orders" hint="Across all orders" tone="bg-amber-50 text-amber-600" />
      </div>

      {/* Filters */}
      <div className="cp-card mt-4 p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <label className="block">
            <span className="cp-label">Order No.</span>
            <select className="cp-input" value={order} onChange={e => { setOrder(e.target.value); setPage(1) }}>
              {orders.map(v => <option key={v}>{v}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="cp-label">Date Added</span>
            <div className="relative">
              <CalendarDays size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input className="cp-input pl-10" defaultValue="04/01/2025 – 05/31/2026" readOnly />
            </div>
          </label>
          <label className="block">
            <span className="cp-label">Artwork Type</span>
            <select className="cp-input" value={type} onChange={e => { setType(e.target.value); setPage(1) }}>
              {['All', 'PNG', 'JPG', 'SVG'].map(v => <option key={v}>{v}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="cp-label">Size</span>
            <select className="cp-input" value={size} onChange={e => { setSize(e.target.value); setPage(1) }}>
              {sizes.map(v => <option key={v}>{v}</option>)}
            </select>
          </label>
        </div>
        <div className="mt-3 flex items-center justify-between gap-3">
          <p className="text-[13px] text-muted">
            Showing {filtered.length === 0 ? 0 : (current - 1) * rows + 1} to {Math.min(current * rows, filtered.length)} of {SUMMARY.artworks} artworks
            {checked.size > 0 && <span className="ml-2 font-medium text-brand">· {checked.size} selected</span>}
          </p>
          <button className="cp-btn h-9" onClick={clearFilters}><RotateCcw size={15} /> Clear Filters</button>
        </div>
      </div>

      {/* Table + detail panel */}
      <div className="mt-4 flex items-start gap-4">
        <div className="cp-card min-w-0 flex-1">
          <div className="cp-table-wrap">
            <table className="w-full min-w-[900px] border-collapse">
              <thead className="border-b border-line">
                <tr>
                  <th className="cp-th w-10">
                    <input type="checkbox" checked={allShown} onChange={toggleAll} aria-label="Select all rows"
                      className="h-4 w-4 rounded border-slate-300 text-brand focus:ring-brand" />
                  </th>
                  <th className="cp-th">
                    <span className="inline-flex items-center gap-1">Date Added <ArrowDown size={13} /></span>
                  </th>
                  {['Thumbnail', 'Artwork Name', 'Size', 'Transfers Qty', 'File Type', 'File Size', 'Used In Orders', 'Action'].map(h => (
                    <th key={h} className="cp-th">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {visible.length === 0 && <EmptyRow colSpan={10} message="No artworks match these filters." />}
                {visible.map(a => (
                  <tr
                    key={a.id}
                    onClick={() => setSelected(a)}
                    className={cn('cursor-pointer transition hover:bg-slate-50', selected?.id === a.id && 'bg-brand/5')}
                  >
                    <td className="cp-td" onClick={e => e.stopPropagation()}>
                      <input type="checkbox" checked={checked.has(a.id)} onChange={() => toggleOne(a.id)}
                        aria-label={`Select ${a.name}`}
                        className="h-4 w-4 rounded border-slate-300 text-brand focus:ring-brand" />
                    </td>
                    <td className="cp-td">
                      <div>{a.dateAdded}</div>
                      <div className="text-xs text-muted">{a.timeAdded}</div>
                    </td>
                    <td className="cp-td"><Thumb name={a.name} /></td>
                    <td className="cp-td font-medium">{a.name}</td>
                    <td className="cp-td">{a.size}</td>
                    <td className="cp-td">{a.transfersQty}</td>
                    <td className="cp-td">{a.fileType}</td>
                    <td className="cp-td">{a.fileSize}</td>
                    <td className="cp-td text-brand">{a.usedInOrders.length} Order{a.usedInOrders.length === 1 ? '' : 's'}</td>
                    <td className="cp-td">
                      <button onClick={e => e.stopPropagation()} aria-label="More actions"
                        className="grid h-8 w-8 place-items-center rounded-lg text-muted transition hover:bg-slate-100">
                        <MoreVertical size={15} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Pagination page={current} pageCount={pageCount} total={filtered.length} rows={rows} onPage={setPage} onRows={setRows} />
        </div>

        <SidePanel
          open={!!selected}
          onClose={() => setSelected(null)}
          title="Artwork Details"
        >
          {selected && (
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-3">
                <h3 className="text-base font-bold text-brand">{selected.name}</h3>
                <Badge tone="bg-emerald-100 text-emerald-700">
                  Used in {selected.usedInOrders.length} Order{selected.usedInOrders.length === 1 ? '' : 's'}
                </Badge>
              </div>

              <Thumb name={selected.name} className="h-52 w-full rounded-xl text-4xl" />

              <button className="cp-btn cp-btn-primary w-full"><Download size={16} /> Download File</button>

              <div className="divide-y divide-line border-t border-line pt-1">
                <DetailRow label="Artwork ID" value={selected.artworkId} />
                <DetailRow label="File Name" value={selected.fileName} />
                <DetailRow label="Size" value={selected.size} />
                <DetailRow label="File Type" value={selected.fileType} />
                <DetailRow label="File Size" value={selected.fileSize} />
                <DetailRow label="Date Added" value={`${selected.dateAdded}, ${selected.timeAdded}`} />
                <DetailRow label="Created By" value={selected.createdBy} />
                <DetailRow label="No. of Transfers" value={selected.transfersQty} />
              </div>

              <PanelSection title={`Used In Orders (${selected.usedInOrders.length})`}>
                <div className="cp-table-wrap">
                  <table className="w-full border-collapse text-left">
                    <thead>
                      <tr className="border-b border-line">
                        {['Order No.', 'Order Date', 'Transfers Qty'].map(h => (
                          <th key={h} className="py-2 text-[11px] font-semibold uppercase tracking-wide text-muted">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {selected.usedInOrders.map(u => (
                        <tr key={u.orderNo}>
                          <td className="py-2.5 text-[13px] font-semibold text-brand">{u.orderNo}</td>
                          <td className="py-2.5 text-[13px] text-muted">{u.orderDate}</td>
                          <td className="py-2.5 text-[13px] text-ink">{u.transfersQty}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </PanelSection>
            </div>
          )}
        </SidePanel>
      </div>
    </Layout>
  )
}
