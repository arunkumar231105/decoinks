import { Link } from 'react-router-dom'
import {
  ClipboardList, Image as ImageIcon, Repeat, Wallet, Settings2, Truck, CheckCircle2, ArrowRight,
} from 'lucide-react'
import { Layout } from '../components/Layout'
import { OrderStatusBadge, PaymentBadge, StatCard, TableStates, Thumb } from '../components/ui'
import { useResource } from '../hooks/useResource'
import { endpoints, money, num, fmtDate, assetUrl } from '../services/api'
import type { Artwork, Order, Summary } from '../types'

const COLUMNS = ['Order #', 'Order Date', 'Value', 'Payment', 'Status']

export default function DashboardPage() {
  const summary = useResource<Summary>(endpoints.summary)
  const orders = useResource<Order[]>(endpoints.orders)
  const artworks = useResource<Artwork[]>(endpoints.artworks)

  const s = summary.data
  const recent = (orders.data ?? []).slice(0, 5)
  const latest = (artworks.data ?? []).slice(0, 6)

  return (
    <Layout title="Dashboard" subtitle="An overview of your orders and artwork." searchPlaceholder="Search by order #, artwork, date…">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard icon={ClipboardList} loading={summary.loading} value={num(s?.orders)} label="Orders" hint="All time" />
        <StatCard icon={ImageIcon} loading={summary.loading} value={num(s?.artworks)} label="Artworks" hint="Total uploaded" tone="bg-violet-50 text-violet-600" />
        <StatCard icon={Repeat} loading={summary.loading} value={num(s?.transfersQty)} label="Transfers Qty" hint="Across all orders" tone="bg-emerald-50 text-emerald-600" />
        <StatCard icon={Wallet} loading={summary.loading} value={money(s?.orderValue)} label="Order Value" hint="Across all orders" tone="bg-amber-50 text-amber-600" />
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard icon={Settings2} loading={summary.loading} value={num(s?.inProduction)} label="In Production" tone="bg-sky-50 text-sky-600" />
        <StatCard icon={Truck} loading={summary.loading} value={num(s?.shipped)} label="Shipped" tone="bg-indigo-50 text-brand" />
        <StatCard icon={CheckCircle2} loading={summary.loading} value={num(s?.delivered)} label="Delivered" tone="bg-emerald-50 text-emerald-600" />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <section className="cp-card min-w-0 overflow-hidden">
          <div className="flex items-center justify-between border-b border-line px-5 py-4">
            <h2 className="text-sm font-semibold text-ink">Recent Orders</h2>
            <Link to="/orders" className="inline-flex items-center gap-1 text-[13px] font-medium text-brand hover:underline">
              View all <ArrowRight size={14} />
            </Link>
          </div>
          <div className="cp-table-wrap">
            <table className="w-full min-w-[560px] border-collapse">
              <thead><tr>{COLUMNS.map(h => <th key={h} className="cp-th">{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-line">
                <TableStates
                  colSpan={COLUMNS.length}
                  loading={orders.loading}
                  error={orders.error}
                  empty={recent.length === 0}
                  emptyMessage="Your orders will appear here once they're placed."
                  onRetry={orders.reload}
                  rows={4}
                />
                {!orders.loading && !orders.error && recent.map(o => (
                  <tr key={o.id} className="transition-colors hover:bg-brand/[0.04]">
                    <td className="cp-td font-semibold text-brand">{o.number}</td>
                    <td className="cp-td">{fmtDate(o.orderDate)}</td>
                    <td className="cp-td font-semibold">{money(o.value)}</td>
                    <td className="cp-td"><PaymentBadge status={o.paymentStatus} /></td>
                    <td className="cp-td"><OrderStatusBadge status={o.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="cp-card overflow-hidden">
          <div className="flex items-center justify-between border-b border-line px-5 py-4">
            <h2 className="text-sm font-semibold text-ink">Latest Artworks</h2>
            <Link to="/artworks" className="inline-flex items-center gap-1 text-[13px] font-medium text-brand hover:underline">
              View all <ArrowRight size={14} />
            </Link>
          </div>
          {artworks.loading && (
            <div className="space-y-3 p-5">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="cp-skeleton h-10 w-full" />)}</div>
          )}
          {!artworks.loading && latest.length === 0 && (
            <p className="px-5 py-10 text-center text-[13px] text-muted">
              {artworks.error ?? 'Artwork files you send us will be listed here.'}
            </p>
          )}
          <ul className="divide-y divide-line">
            {!artworks.loading && latest.map(a => (
              <li key={a.id} className="flex items-center gap-3 px-5 py-3">
                <Thumb name={a.name} src={assetUrl(a.previewUrl)} className="h-11 w-11 rounded-lg object-cover text-xs" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-medium text-ink" title={a.fileName}>{a.name}</div>
                  <div className="truncate text-xs text-muted">{a.stage ?? a.fileType ?? '—'}</div>
                </div>
                <span className="shrink-0 text-xs text-muted">{fmtDate(a.dateAdded)}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </Layout>
  )
}
