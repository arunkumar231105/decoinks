import { Link } from 'react-router-dom'
import {
  ClipboardList, Image as ImageIcon, Repeat, Wallet, Settings2, Truck, CheckCircle2, ArrowRight,
} from 'lucide-react'
import { Layout } from '../components/Layout'
import { OrderStatusBadge, PaymentBadge, StatCard, Thumb } from '../components/ui'
import { ARTWORKS, CUSTOMER, ORDERS, SUMMARY, money, num } from '../data/mock'

export default function DashboardPage() {
  const recent = ORDERS.slice(0, 5)
  const latestArtworks = ARTWORKS.slice(0, 6)

  return (
    <Layout
      title={`Welcome back, ${CUSTOMER.name.split(' ')[0]}`}
      subtitle="Here's what's happening with your orders."
      searchPlaceholder="Search by order #, artwork, date…"
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={ClipboardList} value={SUMMARY.orders} label="Orders" hint="All time" />
        <StatCard icon={ImageIcon} value={SUMMARY.artworks} label="Artworks" hint="Total uploaded" tone="bg-violet-50 text-violet-600" />
        <StatCard icon={Repeat} value={num(SUMMARY.transfersQty)} label="Transfers Qty" hint="Across all orders" tone="bg-emerald-50 text-emerald-600" />
        <StatCard icon={Wallet} value={money(SUMMARY.orderValue)} label="Order Value" hint="Across all orders" tone="bg-amber-50 text-amber-600" />
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard icon={Settings2} value={SUMMARY.inProduction} label="In Production" tone="bg-sky-50 text-sky-600" />
        <StatCard icon={Truck} value={SUMMARY.shipped} label="Shipped" tone="bg-indigo-50 text-brand" />
        <StatCard icon={CheckCircle2} value={SUMMARY.delivered} label="Delivered" tone="bg-emerald-50 text-emerald-600" />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        {/* Recent orders */}
        <section className="cp-card min-w-0">
          <div className="flex items-center justify-between border-b border-line px-5 py-4">
            <h2 className="text-sm font-semibold text-ink">Recent Orders</h2>
            <Link to="/orders" className="inline-flex items-center gap-1 text-[13px] font-medium text-brand hover:underline">
              View all <ArrowRight size={14} />
            </Link>
          </div>
          <div className="cp-table-wrap">
            <table className="w-full min-w-[620px] border-collapse">
              <thead className="border-b border-line">
                <tr>{['Order #', 'Order Date', 'Value', 'Payment', 'Status'].map(h => <th key={h} className="cp-th">{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-line">
                {recent.map(o => (
                  <tr key={o.id} className="transition hover:bg-slate-50">
                    <td className="cp-td font-semibold text-brand">{o.number}</td>
                    <td className="cp-td">{o.orderDate}</td>
                    <td className="cp-td font-semibold">{money(o.value)}</td>
                    <td className="cp-td"><PaymentBadge status={o.paymentStatus} /></td>
                    <td className="cp-td"><OrderStatusBadge status={o.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Latest artworks */}
        <section className="cp-card">
          <div className="flex items-center justify-between border-b border-line px-5 py-4">
            <h2 className="text-sm font-semibold text-ink">Latest Artworks</h2>
            <Link to="/artworks" className="inline-flex items-center gap-1 text-[13px] font-medium text-brand hover:underline">
              View all <ArrowRight size={14} />
            </Link>
          </div>
          <ul className="divide-y divide-line">
            {latestArtworks.map(a => (
              <li key={a.id} className="flex items-center gap-3 px-5 py-3">
                <Thumb name={a.name} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-medium text-ink">{a.name}</div>
                  <div className="truncate text-xs text-muted">{a.size} · {a.transfersQty} transfers</div>
                </div>
                <span className="shrink-0 text-xs text-muted">{a.dateAdded}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </Layout>
  )
}
