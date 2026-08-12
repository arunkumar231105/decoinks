import { useMemo, useState } from 'react'
import {
  ClipboardList, Image as ImageIcon, Repeat, Wallet, Settings2, Truck, CheckCircle2,
  Eye, MoreVertical, RotateCcw, FileText, Download, CalendarDays,
} from 'lucide-react'
import { Layout } from '../components/Layout'
import { SidePanel, DetailRow, PanelSection } from '../components/SidePanel'
import { EmptyRow, OrderStatusBadge, Pagination, PaymentBadge, StatCard } from '../components/ui'
import { ORDERS, SUMMARY, money, num, type Order } from '../data/mock'
import { cn } from '../utils/cn'

const PERIODS = ['Weekly', 'Monthly', 'Yearly', 'Custom'] as const

export default function OrderHistoryPage() {
  const [selected, setSelected] = useState<Order | null>(null)
  const [payment, setPayment] = useState('All')
  const [status, setStatus] = useState('All')
  const [sort, setSort] = useState('Newest First')
  const [period, setPeriod] = useState<(typeof PERIODS)[number]>('Monthly')
  const [page, setPage] = useState(1)
  const [rows, setRows] = useState(10)

  const filtered = useMemo(() => {
    const list = ORDERS.filter(o =>
      (payment === 'All' || o.paymentStatus === payment) &&
      (status === 'All' || o.status === status))
    return sort === 'Oldest First' ? [...list].reverse()
      : sort === 'Highest Value' ? [...list].sort((a, b) => b.value - a.value)
      : list
  }, [payment, status, sort])

  const pageCount = Math.max(1, Math.ceil(filtered.length / rows))
  const current = Math.min(page, pageCount)
  const visible = filtered.slice((current - 1) * rows, current * rows)

  const clearFilters = () => { setPayment('All'); setStatus('All'); setSort('Newest First'); setPage(1) }

  return (
    <Layout title="Order History" subtitle="View and track all your DTF transfer orders." searchPlaceholder="Search by order #, artwork, date…">
      {/* Stats */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
        <StatCard icon={ClipboardList} value={SUMMARY.orders} label="Orders" hint="View all orders" />
        <StatCard icon={ImageIcon} value={SUMMARY.artworks} label="Artworks" hint="Across all orders" tone="bg-violet-50 text-violet-600" />
        <StatCard icon={Repeat} value={num(SUMMARY.transfersQty)} label="Transfers Qty" hint="Across all orders" tone="bg-emerald-50 text-emerald-600" />
        <StatCard icon={Wallet} value={money(SUMMARY.orderValue)} label="Order Value" hint="Across all orders" tone="bg-amber-50 text-amber-600" />
        <StatCard icon={Settings2} value={SUMMARY.inProduction} label="In Production" hint="View orders" tone="bg-sky-50 text-sky-600" />
        <StatCard icon={CheckCircle2} value={SUMMARY.delivered} label="Delivered" hint="View orders" tone="bg-emerald-50 text-emerald-600" />
      </div>

      {/* Filters */}
      <div className="cp-card mt-4 p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <label className="block">
            <span className="cp-label">Date Range</span>
            <div className="relative">
              <CalendarDays size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input className="cp-input pl-10" defaultValue="04/01/2025 – 05/31/2026" readOnly />
            </div>
          </label>
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
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {PERIODS.map(p => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={cn('h-9 rounded-xl border px-4 text-sm font-medium transition',
                period === p ? 'border-brand bg-brand/10 text-brand' : 'border-line bg-white text-muted hover:bg-slate-50')}
            >
              {p}
            </button>
          ))}
          <button className="cp-btn ml-auto h-9" onClick={clearFilters}>
            <RotateCcw size={15} /> Clear Filters
          </button>
        </div>
      </div>

      {/* Table + detail panel */}
      <div className="mt-4 flex items-start gap-4">
        <div className="cp-card min-w-0 flex-1">
          <div className="cp-table-wrap">
            <table className="w-full min-w-[900px] border-collapse">
              <thead className="border-b border-line">
                <tr>
                  {['Order #', 'Order Date', 'Shipment Date', 'No. of Artworks', 'Artworks Qty', 'Order Value', 'Payment Status', 'Order Status', 'Action'].map(h => (
                    <th key={h} className="cp-th">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {visible.length === 0 && <EmptyRow colSpan={9} message="No orders match these filters." />}
                {visible.map(o => (
                  <tr
                    key={o.id}
                    onClick={() => setSelected(o)}
                    className={cn('cursor-pointer transition hover:bg-slate-50',
                      selected?.id === o.id && 'bg-brand/5')}
                  >
                    <td className="cp-td font-semibold text-brand">{o.number}</td>
                    <td className="cp-td">
                      <div>{o.orderDate}</div>
                      <div className="text-xs text-muted">{o.orderTime}</div>
                    </td>
                    <td className="cp-td">
                      <div>{o.shipmentDate ?? '—'}</div>
                      <div className="text-xs text-muted">{o.shipmentTime ?? '—'}</div>
                    </td>
                    <td className="cp-td">{o.artworkCount}</td>
                    <td className="cp-td">{o.transfersQty}</td>
                    <td className="cp-td font-semibold">{money(o.value)}</td>
                    <td className="cp-td"><PaymentBadge status={o.paymentStatus} /></td>
                    <td className="cp-td"><OrderStatusBadge status={o.status} /></td>
                    <td className="cp-td">
                      <div className="flex items-center gap-1">
                        <button
                          onClick={e => { e.stopPropagation(); setSelected(o) }}
                          aria-label={`View ${o.number}`}
                          className="grid h-8 w-8 place-items-center rounded-lg border border-line text-brand transition hover:bg-brand/5"
                        >
                          <Eye size={15} />
                        </button>
                        <button
                          onClick={e => e.stopPropagation()}
                          aria-label="More actions"
                          className="grid h-8 w-8 place-items-center rounded-lg text-muted transition hover:bg-slate-100"
                        >
                          <MoreVertical size={15} />
                        </button>
                      </div>
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
          title={<span className="text-brand">{selected?.number}</span>}
          subtitle={selected ? <OrderStatusBadge status={selected.status} /> : null}
        >
          {selected && (
            <div className="space-y-4">
              <div className="divide-y divide-line">
                <DetailRow label="Order Type" value={selected.orderType} />
                <DetailRow label="Order Date" value={`${selected.orderDate}, ${selected.orderTime}`} />
                <DetailRow label="Shipment Date" value={selected.shipmentDate ? `${selected.shipmentDate}${selected.shipmentTime ? `, ${selected.shipmentTime}` : ''}` : '—'} />
                <DetailRow label="Delivered On" value={selected.deliveredOn ?? '—'} />
              </div>

              <div className="divide-y divide-line border-t border-line pt-2">
                <DetailRow label="Payment Status" value={<span className="text-emerald-600">{selected.paymentStatus}</span>} />
                <DetailRow label="Payment Method" value={selected.paymentMethod} />
                <DetailRow label="Shipping Method" value={selected.shippingMethod} />
                <DetailRow label="Tracking No." value={selected.trackingNo ?? '—'} />
              </div>

              <div className="divide-y divide-line border-t border-line pt-2">
                <DetailRow label="Invoice No." value={<span className="text-brand">{selected.invoiceNo}</span>} />
                <DetailRow label="Sales Order No." value={<span className="text-brand">{selected.salesOrderNo}</span>} />
              </div>

              <PanelSection title="Documents">
                <div className="space-y-2">
                  {selected.documents.map(d => (
                    <div key={d.number} className="flex items-center gap-3 rounded-xl border border-line p-3">
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-rose-50 text-rose-600">
                        <FileText size={17} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px] font-semibold text-ink">{d.kind}</div>
                        <div className="truncate text-xs text-muted">{d.fileName}</div>
                        <div className="truncate text-[11px] text-muted">Created on {d.createdOn}</div>
                      </div>
                      <div className="flex shrink-0 gap-1">
                        <button aria-label={`Preview ${d.kind}`} className="grid h-8 w-8 place-items-center rounded-lg border border-line text-brand transition hover:bg-brand/5"><Eye size={14} /></button>
                        <button aria-label={`Download ${d.kind}`} className="grid h-8 w-8 place-items-center rounded-lg border border-line text-brand transition hover:bg-brand/5"><Download size={14} /></button>
                      </div>
                    </div>
                  ))}
                </div>
              </PanelSection>

              <PanelSection title="Order Summary">
                <div className="divide-y divide-line">
                  <DetailRow label="No. of Artworks" value={selected.artworkCount} />
                  <DetailRow label="Artworks Qty (Transfers)" value={selected.transfersQty} />
                  <DetailRow label="Total Quantity" value={`${selected.transfersQty} transfers`} />
                  <DetailRow label="Total Amount" value={money(selected.value)} />
                </div>
              </PanelSection>

              <button className="cp-btn w-full border-brand/40 text-brand hover:bg-brand/5">
                <ImageIcon size={16} /> View Artwork in Order
              </button>
            </div>
          )}
        </SidePanel>
      </div>

      {/* Shipped stat kept out of the top row on small screens for balance */}
      <div className="mt-4 grid grid-cols-1 gap-3 sm:hidden">
        <StatCard icon={Truck} value={SUMMARY.shipped} label="Shipped" hint="View orders" tone="bg-sky-50 text-sky-600" />
      </div>
    </Layout>
  )
}
