import { useMemo, useState } from 'react'
import {
  ClipboardList, Image as ImageIcon, Repeat, Wallet, Settings2, Truck, CheckCircle2,
  Eye, RotateCcw, FileText, Download, Printer,
} from 'lucide-react'
import { Layout } from '../components/Layout'
import { Drawer, DrawerSection, Field } from '../components/SidePanel'
import { OrderStatusBadge, Pagination, PaymentBadge, StatCard, TableStates } from '../components/ui'
import { useResource } from '../hooks/useResource'
import { endpoints, money, num, dash, fmtDate, fmtTime } from '../services/api'
import type { Order, Summary } from '../types'
import { cn } from '../utils/cn'

const COLUMNS = ['Order #', 'Order Date', 'Shipment Date', 'No. of Artworks', 'Gangsheets', 'Transfers Qty', 'Order Value', 'Payment', 'Status', 'Tracking ID', '']

export default function OrderHistoryPage() {
  const summary = useResource<Summary>(endpoints.summary)
  const orders = useResource<Order[]>(endpoints.orders)

  const [selected, setSelected] = useState<Order | null>(null)
  const [payment, setPayment] = useState('All')
  const [status, setStatus] = useState('All')
  const [sort, setSort] = useState('Newest First')
  const [page, setPage] = useState(1)
  const [rows, setRows] = useState(10)

  const list = orders.data ?? []
  const filtered = useMemo(() => {
    const out = list.filter(o =>
      (payment === 'All' || o.paymentStatus === payment) &&
      (status === 'All' || o.status === status))
    return sort === 'Oldest First' ? [...out].reverse()
      : sort === 'Highest Value' ? [...out].sort((a, b) => b.value - a.value)
      : out
  }, [list, payment, status, sort])

  const pageCount = Math.max(1, Math.ceil(filtered.length / rows))
  const current = Math.min(page, pageCount)
  const visible = filtered.slice((current - 1) * rows, current * rows)
  const s = summary.data

  return (
    <Layout title="Order History" subtitle="View and track all your DTF transfer orders." searchPlaceholder="Search by order #, artwork, date…">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 2xl:grid-cols-7">
        <StatCard icon={ClipboardList} loading={summary.loading} value={num(s?.orders)} label="Orders" />
        <StatCard icon={ImageIcon} loading={summary.loading} value={num(s?.artworks)} label="Artworks" tone="bg-violet-50 text-violet-600" />
        <StatCard icon={Repeat} loading={summary.loading} value={num(s?.transfersQty)} label="Transfers Qty" tone="bg-emerald-50 text-emerald-600" />
        <StatCard icon={Wallet} loading={summary.loading} value={money(s?.orderValue)} label="Order Value" tone="bg-amber-50 text-amber-600" />
        <StatCard icon={Settings2} loading={summary.loading} value={num(s?.inProduction)} label="In Production" tone="bg-sky-50 text-sky-600" />
        <StatCard icon={Truck} loading={summary.loading} value={num(s?.shipped)} label="Shipped" tone="bg-indigo-50 text-brand" />
        <StatCard icon={CheckCircle2} loading={summary.loading} value={num(s?.delivered)} label="Delivered" tone="bg-emerald-50 text-emerald-600" />
      </div>

      {/* Filters */}
      <div className="cp-card mt-4 p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <label className="block">
            <span className="cp-label">Payment Status</span>
            <select className="cp-input" value={payment} onChange={e => { setPayment(e.target.value); setPage(1) }}>
              {['All', 'Paid', 'Partially Paid', 'Unpaid'].map(v => <option key={v}>{v}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="cp-label">Order Status</span>
            <select className="cp-input" value={status} onChange={e => { setStatus(e.target.value); setPage(1) }}>
              {['All', 'In Production', 'Shipped', 'Delivered'].map(v => <option key={v}>{v}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="cp-label">Sort By</span>
            <select className="cp-input" value={sort} onChange={e => setSort(e.target.value)}>
              {['Newest First', 'Oldest First', 'Highest Value'].map(v => <option key={v}>{v}</option>)}
            </select>
          </label>
          <div className="flex items-end">
            <button className="cp-btn w-full" onClick={() => { setPayment('All'); setStatus('All'); setSort('Newest First'); setPage(1) }}>
              <RotateCcw size={15} /> Clear Filters
            </button>
          </div>
        </div>
      </div>

      {/* Table — full width; the drawer floats above it */}
      <div className="cp-card mt-4 overflow-hidden">
        <div className="cp-table-wrap">
          <table className="w-full min-w-[980px] border-collapse">
            <thead>
              <tr>{COLUMNS.map((h, i) => <th key={h || i} className="cp-th">{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-line">
              <TableStates
                colSpan={COLUMNS.length}
                loading={orders.loading}
                error={orders.error}
                empty={filtered.length === 0}
                emptyMessage="Your orders will appear here once they're placed."
                onRetry={orders.reload}
              />
              {!orders.loading && !orders.error && visible.map(o => (
                <tr key={o.id} onClick={() => setSelected(o)}
                  className={cn('cp-row', selected?.id === o.id && 'cp-row-active')}>
                  <td className="cp-td font-semibold text-brand">{o.number}</td>
                  <td className="cp-td">
                    <div>{fmtDate(o.orderDate)}</div>
                    {fmtTime(o.orderDate) && <div className="text-xs text-muted">{fmtTime(o.orderDate)}</div>}
                  </td>
                  <td className="cp-td">
                    <div>{fmtDate(o.shipmentDate)}</div>
                    {fmtTime(o.shipmentDate) && <div className="text-xs text-muted">{fmtTime(o.shipmentDate)}</div>}
                  </td>
                  <td className="cp-td tabular-nums">{o.artworkCount}</td>
                  <td className="cp-td tabular-nums">{o.gangsheets ? o.gangsheets : '—'}</td>
                  <td className="cp-td tabular-nums">{o.transfersQty}</td>
                  <td className="cp-td font-semibold">{money(o.value)}</td>
                  <td className="cp-td"><PaymentBadge status={o.paymentStatus} /></td>
                  <td className="cp-td"><OrderStatusBadge status={o.status} /></td>
                  <td className="cp-td">
                    {o.trackingNo
                      ? <span className="font-medium tabular-nums text-ink">{o.trackingNo}</span>
                      : <span className="text-muted">—</span>}
                  </td>
                  <td className="cp-td">
                    <button onClick={e => { e.stopPropagation(); setSelected(o) }} aria-label={`View ${o.number}`} className="cp-icon-btn text-brand">
                      <Eye size={15} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {!orders.loading && !orders.error && filtered.length > 0 && (
          <Pagination page={current} pageCount={pageCount} total={filtered.length} rows={rows} onPage={setPage} onRows={setRows} />
        )}
      </div>

      <Drawer
        open={!!selected}
        caption="Order Summary"
        title={selected?.number ?? ''}
        badges={selected && <><OrderStatusBadge status={selected.status} /><PaymentBadge status={selected.paymentStatus} /></>}
        actions={<>
          <button className="cp-btn cp-btn-sm"><Printer size={15} /> Preview</button>
          <button className="cp-btn cp-btn-sm"><Download size={15} /> Export</button>
        </>}
        onClose={() => setSelected(null)}
      >
        {selected && (
          <>
            <DrawerSection title="Overview">
              <Field label="Order Type" value={dash(selected.orderType)} />
              <Field label="Order Date" value={fmtDate(selected.orderDate)} />
              <Field label="Shipment Date" value={fmtDate(selected.shipmentDate)} />
              <Field label="Delivered On" value={fmtDate(selected.deliveredOn)} />
            </DrawerSection>

            <DrawerSection title="Payment & Shipping">
              <Field label="Payment Status" value={<PaymentBadge status={selected.paymentStatus} />} />
              <Field label="Payment Method" value={dash(selected.paymentMethod)} />
              <Field label="Shipping Method" value={dash(selected.shippingMethod)} />
              <Field label="Tracking No." value={dash(selected.trackingNo)} />
            </DrawerSection>

            <DrawerSection title="Related Documents">
              <Field label="Invoice No." value={<span className="text-brand">{dash(selected.invoiceNo)}</span>} />
              <Field label="Sales Order No." value={<span className="text-brand">{dash(selected.salesOrderNo)}</span>} />
              <div className="mt-3 space-y-2">
                {selected.documents.length === 0 && <p className="text-[13px] text-muted">No attachments.</p>}
                {selected.documents.map(d => (
                  <a key={d.number} href={d.url ?? '#'} target="_blank" rel="noreferrer"
                    className="flex items-center gap-3 rounded-xl border border-line p-3 transition hover:border-slate-300 hover:bg-slate-50">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-rose-50 text-rose-600"><FileText size={17} /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-semibold text-ink">{d.kind}</span>
                      <span className="block truncate text-xs text-muted">{d.fileName}</span>
                    </span>
                    <Download size={15} className="shrink-0 text-muted" />
                  </a>
                ))}
              </div>
            </DrawerSection>

            <DrawerSection title="Order Summary">
              <Field label="No. of Artworks" value={selected.artworkCount} />
              <Field label="Gangsheets" value={selected.gangsheets || '—'} />
              <Field label="Transfers Qty" value={selected.transfersQty} />
              <Field label="Total Amount" value={<span className="text-base">{money(selected.value)}</span>} />
            </DrawerSection>
          </>
        )}
      </Drawer>
    </Layout>
  )
}
