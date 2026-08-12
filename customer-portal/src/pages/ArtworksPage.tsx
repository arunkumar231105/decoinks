import { useMemo, useState } from 'react'
import { Image as ImageIcon, Repeat, ShoppingBag, RotateCcw, Download, ArrowDown, Eye } from 'lucide-react'
import { Layout } from '../components/Layout'
import { Drawer, DrawerSection, Field } from '../components/SidePanel'
import { Badge, Pagination, StatCard, TableStates, Thumb } from '../components/ui'
import { useResource } from '../hooks/useResource'
import { endpoints, num, dash } from '../services/api'
import type { Artwork, Summary } from '../types'
import { cn } from '../utils/cn'

const COLUMNS = ['', 'Date Added', 'Thumbnail', 'Artwork Name', 'Size', 'Transfers Qty', 'File Type', 'File Size', 'Used In Orders', '']

export default function ArtworksPage() {
  const summary = useResource<Summary>(endpoints.summary)
  const artworks = useResource<Artwork[]>(endpoints.artworks)

  const [selected, setSelected] = useState<Artwork | null>(null)
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [type, setType] = useState('All')
  const [size, setSize] = useState('All')
  const [page, setPage] = useState(1)
  const [rows, setRows] = useState(10)

  const list = artworks.data ?? []
  const sizes = useMemo(() => ['All', ...Array.from(new Set(list.map(a => a.size).filter(Boolean) as string[]))], [list])
  const types = useMemo(() => ['All', ...Array.from(new Set(list.map(a => a.fileType).filter(Boolean) as string[]))], [list])

  const filtered = useMemo(() => list.filter(a =>
    (type === 'All' || a.fileType === type) && (size === 'All' || a.size === size)), [list, type, size])

  const pageCount = Math.max(1, Math.ceil(filtered.length / rows))
  const current = Math.min(page, pageCount)
  const visible = filtered.slice((current - 1) * rows, current * rows)
  const s = summary.data

  const allShown = visible.length > 0 && visible.every(a => checked.has(a.id))
  const toggleAll = () => {
    const next = new Set(checked)
    visible.forEach(a => (allShown ? next.delete(a.id) : next.add(a.id)))
    setChecked(next)
  }
  const toggleOne = (id: string) => {
    const next = new Set(checked)
    if (next.has(id)) next.delete(id); else next.add(id)
    setChecked(next)
  }

  return (
    <Layout title="Artworks" subtitle="View and manage all artwork files." searchPlaceholder="Search by artwork name, order no, size…">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard icon={ImageIcon} loading={summary.loading} value={num(s?.artworks)} label="Total Artworks" hint="Total uploaded" />
        <StatCard icon={Repeat} loading={summary.loading} value={num(s?.transfersQty)} label="Total Transfers Qty" hint="Across all orders" tone="bg-emerald-50 text-emerald-600" />
        <StatCard icon={ShoppingBag} loading={summary.loading} value={num(s?.artworksUsedInOrders)} label="Used in Orders" hint="Across all orders" tone="bg-amber-50 text-amber-600" />
      </div>

      <div className="cp-card mt-4 p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <label className="block">
            <span className="cp-label">Artwork Type</span>
            <select className="cp-input" value={type} onChange={e => { setType(e.target.value); setPage(1) }}>
              {types.map(v => <option key={v}>{v}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="cp-label">Size</span>
            <select className="cp-input" value={size} onChange={e => { setSize(e.target.value); setPage(1) }}>
              {sizes.map(v => <option key={v}>{v}</option>)}
            </select>
          </label>
          <div className="flex items-end sm:col-span-2 xl:col-span-2">
            <button className="cp-btn w-full sm:w-auto" onClick={() => { setType('All'); setSize('All'); setPage(1) }}>
              <RotateCcw size={15} /> Clear Filters
            </button>
            {checked.size > 0 && (
              <span className="ml-3 self-center text-[13px] font-medium text-brand">{checked.size} selected</span>
            )}
          </div>
        </div>
      </div>

      <div className="cp-card mt-4 overflow-hidden">
        <div className="cp-table-wrap">
          <table className="w-full min-w-[900px] border-collapse">
            <thead>
              <tr>
                <th className="cp-th w-10">
                  <input type="checkbox" className="cp-check" checked={allShown} onChange={toggleAll} aria-label="Select all rows" />
                </th>
                <th className="cp-th"><span className="inline-flex items-center gap-1">Date Added <ArrowDown size={12} /></span></th>
                {COLUMNS.slice(2).map((h, i) => <th key={h || i} className="cp-th">{h}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              <TableStates
                colSpan={COLUMNS.length}
                loading={artworks.loading}
                error={artworks.error}
                empty={filtered.length === 0}
                emptyMessage="Artwork files you send us will be listed here."
                onRetry={artworks.reload}
              />
              {!artworks.loading && !artworks.error && visible.map(a => (
                <tr key={a.id} onClick={() => setSelected(a)} className={cn('cp-row', selected?.id === a.id && 'cp-row-active')}>
                  <td className="cp-td" onClick={e => e.stopPropagation()}>
                    <input type="checkbox" className="cp-check" checked={checked.has(a.id)} onChange={() => toggleOne(a.id)} aria-label={`Select ${a.name}`} />
                  </td>
                  <td className="cp-td">
                    <div>{dash(a.dateAdded)}</div>
                    {a.timeAdded && <div className="text-xs text-muted">{a.timeAdded}</div>}
                  </td>
                  <td className="cp-td"><Thumb name={a.name} src={a.previewUrl} /></td>
                  <td className="cp-td font-medium">{a.name}</td>
                  <td className="cp-td">{dash(a.size)}</td>
                  <td className="cp-td">{a.transfersQty}</td>
                  <td className="cp-td">{dash(a.fileType)}</td>
                  <td className="cp-td">{dash(a.fileSize)}</td>
                  <td className="cp-td text-brand">{a.usedInOrders.length} Order{a.usedInOrders.length === 1 ? '' : 's'}</td>
                  <td className="cp-td">
                    <button onClick={e => { e.stopPropagation(); setSelected(a) }} aria-label={`View ${a.name}`} className="cp-icon-btn text-brand">
                      <Eye size={15} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {!artworks.loading && !artworks.error && filtered.length > 0 && (
          <Pagination page={current} pageCount={pageCount} total={filtered.length} rows={rows} onPage={setPage} onRows={setRows} />
        )}
      </div>

      <Drawer
        open={!!selected}
        caption="Artwork Details"
        title={selected?.name ?? ''}
        badges={selected && (
          <Badge tone="bg-emerald-50 text-emerald-700 ring-emerald-600/20">
            Used in {selected.usedInOrders.length} Order{selected.usedInOrders.length === 1 ? '' : 's'}
          </Badge>
        )}
        actions={selected?.downloadUrl
          ? <a className="cp-btn cp-btn-sm cp-btn-primary" href={selected.downloadUrl} download><Download size={15} /> Download File</a>
          : <button className="cp-btn cp-btn-sm" disabled><Download size={15} /> Download File</button>}
        onClose={() => setSelected(null)}
      >
        {selected && (
          <>
            <div className="px-5 py-5 sm:px-6">
              <Thumb name={selected.name} src={selected.previewUrl} className="h-56 w-full rounded-xl text-5xl" />
            </div>

            <DrawerSection title="File Information">
              <Field label="Artwork ID" value={dash(selected.artworkId)} />
              <Field label="File Name" value={dash(selected.fileName)} />
              <Field label="Size" value={dash(selected.size)} />
              <Field label="File Type" value={dash(selected.fileType)} />
              <Field label="File Size" value={dash(selected.fileSize)} />
              <Field label="Date Added" value={dash([selected.dateAdded, selected.timeAdded].filter(Boolean).join(', '))} />
              <Field label="Created By" value={dash(selected.createdBy)} />
              <Field label="No. of Transfers" value={selected.transfersQty} />
            </DrawerSection>

            <DrawerSection title={`Used In Orders (${selected.usedInOrders.length})`}>
              {selected.usedInOrders.length === 0
                ? <p className="text-[13px] text-muted">Not used in any order yet.</p>
                : (
                  <div className="divide-y divide-line">
                    {selected.usedInOrders.map(u => (
                      <div key={u.orderNo} className="flex items-center justify-between gap-3 py-2.5">
                        <span className="text-[13px] font-semibold text-brand">{u.orderNo}</span>
                        <span className="text-[13px] text-muted">{dash(u.orderDate)}</span>
                        <span className="text-[13px] font-medium text-ink">{u.transfersQty}</span>
                      </div>
                    ))}
                  </div>
                )}
            </DrawerSection>
          </>
        )}
      </Drawer>
    </Layout>
  )
}
