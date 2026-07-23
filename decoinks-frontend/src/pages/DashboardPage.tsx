import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Skeleton } from '@mui/material'
import {
  ArrowDownRight, ArrowUpRight, BadgeCheck, CircleDollarSign, ClipboardList,
  Factory, FileText, PackageCheck, RefreshCw, ShoppingCart, Truck, UserPlus, Users,
} from 'lucide-react'
import {
  CartesianGrid, Cell, Line, LineChart, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { api } from '../services/api'

// ── Types (mirror /dashboard/overview) ──────────────────────────────────────
type Metric = { count: number; prev: number; dtf: number; shirt: number; value?: number; value_prev?: number; pending?: number }
type Split = { new: number; existing: number; new_value?: number; existing_value?: number }
type Overview = {
  period: { from: string; to: string; prev_from: string; prev_to: string; days: number }
  pipeline: Record<'leads' | 'qualified' | 'quotes' | 'payments' | 'sales_orders' | 'po' | 'production' | 'shipped' | 'delivered', Metric>
  customers: { total: number; new: number; existing: number; new_prev: number } &
    Record<'payments' | 'sales_orders' | 'po' | 'production' | 'shipped' | 'delivered', Split>
  sales_by_type: Array<{ key: string; label: string; value: number; count: number }>
  sales_by_customer: Array<{ key: string; label: string; value: number; count: number }>
  trend: { current: Array<{ date: string; revenue: number; orders: number }>; previous: Array<{ date: string; revenue: number; orders: number }> }
  recent: {
    payments: Array<{ paid_at: string; amount: number; method: string; customer: string; invoice_number: string; invoice_id: string; order_number: string | null }>
    pos: Array<{ id: string; po_number: string; po_date: string; status: string; source_order: string | null; vendor: string | null }>
    shipments: Array<{ id: string; ship_date: string; tracking_number: string | null; carrier: string | null; status: string; customer: string }>
    payments_total: { count: number; value: number }
    pos_total: number
    shipments_total: number
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────
const money = (v?: number | string | null) => '$' + Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtDay = (v: string) => new Date(v + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
const fmtRange = (a: string, b: string) => `${fmtDay(a)} – ${fmtDay(b)}`
const pctOf = (part: number, total: number) => (total > 0 ? `${Math.round((part / total) * 1000) / 10}%` : '0%')
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

type Tab = 'daily' | 'weekly' | 'monthly' | 'custom'
function tabRange(tab: Tab): { from: string; to: string } {
  const today = new Date()
  if (tab === 'daily') return { from: iso(today), to: iso(today) }
  if (tab === 'weekly') { const f = new Date(today); f.setDate(f.getDate() - 6); return { from: iso(f), to: iso(today) } }
  return { from: iso(new Date(today.getFullYear(), today.getMonth(), 1)), to: iso(today) }
}

const STATUS_TONES: Record<string, string> = {
  Delivered: 'ok', Shipped: 'ok', Paid: 'ok', Received: 'ok', Closed: 'ok', Approved: 'ok',
  'In Production': 'info', 'In Transit': 'info', Sent: 'info', Confirmed: 'info', 'Label Created': 'info', 'Picked Up': 'info',
  Draft: 'muted', Pending: 'warn', 'Pending Approval': 'warn', Partial: 'warn', 'Partially Received': 'warn',
  Cancelled: 'bad', Exception: 'bad', Overdue: 'bad', Void: 'bad',
}
const StatusPill = ({ value }: { value: string }) => (
  <span className={`dsb-pill ${STATUS_TONES[value] || 'muted'}`}>{value}</span>
)

// Change chip vs previous period — shows a real % only when the previous
// period has data; never invents growth.
function DeltaChip({ cur, prev, label }: { cur: number; prev: number; label: string }) {
  if (prev <= 0) return <em className="dsb-delta muted">vs {label}: 0</em>
  const pct = Math.round(((cur - prev) / prev) * 1000) / 10
  const up = pct >= 0
  return (
    <em className={`dsb-delta ${up ? 'up' : 'down'}`}>
      {up ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />} {Math.abs(pct)}% <span>vs {label}</span>
    </em>
  )
}

// One KPI card: headline, delta, two-row breakdown, optional pending footer.
function StatCard({ icon: Icon, tone = 'blue', title, count, unit, value, prev, prevLabel, rows, pending }: {
  icon: any; tone?: string; title: string; count: number; unit?: string; value?: number
  prev: number; prevLabel: string
  rows: Array<{ label: string; count: number; value?: number }>
  pending?: number
}) {
  const total = rows.reduce((s, r) => s + r.count, 0)
  const valueTotal = rows.reduce((s, r) => s + (r.value || 0), 0)
  const hasValues = rows.some(r => r.value !== undefined)
  return (
    <article className="dsb-card">
      <header><span className={`dsb-ic ${tone}`}><Icon size={16} /></span><small>{title}</small></header>
      <strong>{count.toLocaleString()}{unit && <i>{unit}</i>}</strong>
      <DeltaChip cur={count} prev={prev} label={prevLabel} />
      {value !== undefined && <b className="dsb-value">{money(value)}</b>}
      <ul>
        {rows.map(r => (
          <li key={r.label}>
            <span>{r.label}</span>
            <b>{hasValues ? money(r.value || 0) : r.count.toLocaleString()}</b>
            <small>({hasValues ? pctOf(r.value || 0, valueTotal) : pctOf(r.count, total)})</small>
          </li>
        ))}
      </ul>
      {pending !== undefined && (
        <footer className="dsb-pending"><span>Total Pending</span><b>{pending} Orders</b></footer>
      )}
    </article>
  )
}

const DONUT_TYPE = ['#7c3aed', '#2563eb']
const DONUT_CUST = ['#16a34a', '#f59e0b']

function DonutPanel({ title, data, colors }: { title: string; data: Array<{ label: string; value: number; count: number }>; colors: string[] }) {
  const total = data.reduce((s, d) => s + d.value, 0)
  const chartData = data.filter(d => d.value > 0)
  return (
    <section className="dsb-panel">
      <h3>{title} <small>(Sales Orders Value)</small></h3>
      {total <= 0 ? <p className="dsb-empty">No sales in this period.</p> : (
        <div className="dsb-donut">
          <div className="dsb-donut-chart">
            <ResponsiveContainer width="100%" height={150}>
              <PieChart>
                <Pie data={chartData} dataKey="value" nameKey="label" innerRadius={44} outerRadius={66} paddingAngle={2} strokeWidth={0}>
                  {chartData.map(d => <Cell key={d.label} fill={colors[data.findIndex(x => x.label === d.label) % colors.length]} />)}
                </Pie>
                <Tooltip formatter={(v: any) => money(v)} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <ul className="dsb-legend">
            {data.map((d, i) => (
              <li key={d.label}>
                <i style={{ background: colors[i % colors.length] }} />
                <div><span>{d.label}</span><b>{money(d.value)} ({pctOf(d.value, total)})</b></div>
              </li>
            ))}
          </ul>
        </div>
      )}
      <footer className="dsb-panel-foot"><span>Total Sales Value</span><b>{money(total)}</b></footer>
    </section>
  )
}

const FUNNEL_COLORS = ['#1d4ed8', '#2563eb', '#0891b2', '#0d9488', '#f59e0b', '#dc2626']

function FunnelPanel({ stages }: { stages: Array<{ label: string; count: number }> }) {
  const max = Math.max(1, ...stages.map(s => s.count))
  return (
    <section className="dsb-panel">
      <h3>Order Status Funnel <small>(By Orders)</small></h3>
      <div className="dsb-funnel">
        {stages.map((s, i) => (
          <div key={s.label} className="dsb-funnel-row">
            <i style={{ width: `${Math.max(8, (s.count / max) * 100)}%`, background: FUNNEL_COLORS[i] }} />
            <span>{s.label}</span>
            <b>{s.count} <small>({pctOf(s.count, max)})</small></b>
          </div>
        ))}
      </div>
    </section>
  )
}

function TrendPanel({ trend }: { trend: Overview['trend'] }) {
  const [mode, setMode] = useState<'revenue' | 'orders'>('revenue')
  const data = trend.current.map((d, i) => ({
    label: fmtDay(d.date),
    current: mode === 'revenue' ? Number(d.revenue) : d.orders,
    previous: trend.previous[i] ? (mode === 'revenue' ? Number(trend.previous[i].revenue) : trend.previous[i].orders) : null,
  }))
  return (
    <section className="dsb-panel">
      <h3>Revenue Trend
        <span className="dsb-toggle">
          <button className={mode === 'revenue' ? 'on' : ''} onClick={() => setMode('revenue')}>By Revenue</button>
          <button className={mode === 'orders' ? 'on' : ''} onClick={() => setMode('orders')}>By Orders</button>
        </span>
      </h3>
      <ResponsiveContainer width="100%" height={168}>
        <LineChart data={data} margin={{ top: 6, right: 8, left: -14, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} minTickGap={22} />
          <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false}
            tickFormatter={(v: any) => mode === 'revenue' ? `$${Number(v) >= 1000 ? `${Math.round(Number(v) / 100) / 10}K` : v}` : v} />
          <Tooltip formatter={(v: any) => (mode === 'revenue' ? money(v) : v)} />
          <Line type="monotone" dataKey="current" name="This Period" stroke="#2563eb" strokeWidth={2.2} dot={false} />
          <Line type="monotone" dataKey="previous" name="Last Period" stroke="#b6c2d4" strokeWidth={1.8} strokeDasharray="5 4" dot={false} />
        </LineChart>
      </ResponsiveContainer>
      <footer className="dsb-trend-legend">
        <span><i style={{ background: '#2563eb' }} /> This Period</span>
        <span><i className="dash" /> Last Period</span>
      </footer>
    </section>
  )
}

// ── Page ────────────────────────────────────────────────────────────────────
export function DashboardPage() {
  const qc = useQueryClient()
  const [tab, setTab] = useState<Tab>('monthly')
  const [custom, setCustom] = useState(tabRange('monthly'))
  const range = useMemo(() => (tab === 'custom' ? custom : tabRange(tab)), [tab, custom])

  const { data, isLoading, isError, refetch, isFetching } = useQuery<Overview>({
    queryKey: ['dashboard', 'overview', range],
    queryFn: () => api.get('/dashboard/overview', { params: { date_from: range.from, date_to: range.to } }).then(r => r.data.data),
    placeholderData: p => p,
  })

  const prevLabel = data ? fmtRange(data.period.prev_from, data.period.prev_to) : ''
  const P = data?.pipeline
  const C = data?.customers

  const typeRows = (m?: Metric) => [
    { label: 'DTF Transfers', count: m?.dtf || 0 },
    { label: 'Custom Shirts', count: m?.shirt || 0 },
  ]
  const custRows = (s?: Split, withValue = false) => [
    { label: 'New Customers', count: s?.new || 0, ...(withValue ? { value: s?.new_value || 0 } : {}) },
    { label: 'Existing Customers', count: s?.existing || 0, ...(withValue ? { value: s?.existing_value || 0 } : {}) },
  ]

  return (
    <div className="dsb-page">

      {/* ── Period controls ── */}
      <div className="dsb-controls">
        <div className="dsb-tabs">
          {(['daily', 'weekly', 'monthly', 'custom'] as Tab[]).map(t => (
            <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
        {tab === 'custom' && (
          <div className="dsb-dates">
            <input aria-label="From date" type="date" value={custom.from} onChange={e => setCustom(c => ({ ...c, from: e.target.value }))} />
            <span>–</span>
            <input aria-label="To date" type="date" value={custom.to} onChange={e => setCustom(c => ({ ...c, to: e.target.value }))} />
          </div>
        )}
        {data && <span className="dsb-period">{fmtRange(data.period.from, data.period.to)}</span>}
        <button className="dsb-refresh" onClick={() => { qc.invalidateQueries({ queryKey: ['dashboard'] }); refetch() }} disabled={isFetching}>
          <RefreshCw size={14} className={isFetching ? 'spin' : ''} /> Refresh
        </button>
      </div>

      {isError && (
        <div className="dsb-error"><strong>Unable to load dashboard.</strong><button onClick={() => refetch()}>Retry</button></div>
      )}

      {/* ── Row 1: pipeline KPIs ── */}
      <section className="dsb-grid cols-9">
        {isLoading || !P ? Array.from({ length: 9 }).map((_, i) => <article key={i} className="dsb-card"><Skeleton height={120} /></article>) : <>
          <StatCard icon={Users} title="New Leads" count={P.leads.count} prev={P.leads.prev} prevLabel={prevLabel} rows={typeRows(P.leads)} />
          <StatCard icon={BadgeCheck} tone="green" title="Qualified Leads" count={P.qualified.count} prev={P.qualified.prev} prevLabel={prevLabel} rows={typeRows(P.qualified)} />
          <StatCard icon={FileText} tone="violet" title="Quotations Sent" count={P.quotes.count} prev={P.quotes.prev} prevLabel={prevLabel} rows={typeRows(P.quotes)} />
          <StatCard icon={CircleDollarSign} tone="green" title="Payment Received" count={P.payments.count} unit="Orders" value={P.payments.value} prev={P.payments.prev} prevLabel={prevLabel} rows={typeRows(P.payments)} />
          <StatCard icon={ShoppingCart} tone="orange" title="Sales Orders Issued" count={P.sales_orders.count} unit="Orders" value={P.sales_orders.value} prev={P.sales_orders.prev} prevLabel={prevLabel} rows={typeRows(P.sales_orders)} pending={P.sales_orders.pending} />
          <StatCard icon={ClipboardList} tone="red" title="PO Issued" count={P.po.count} unit="Orders" prev={P.po.prev} prevLabel={prevLabel} rows={typeRows(P.po)} pending={P.po.pending} />
          <StatCard icon={Factory} tone="violet" title="In Production" count={P.production.count} unit="Orders" prev={P.production.prev} prevLabel={prevLabel} rows={typeRows(P.production)} pending={P.production.pending} />
          <StatCard icon={Truck} title="Shipped" count={P.shipped.count} unit="Orders" prev={P.shipped.prev} prevLabel={prevLabel} rows={typeRows(P.shipped)} pending={P.shipped.pending} />
          <StatCard icon={PackageCheck} tone="green" title="Delivered" count={P.delivered.count} unit="Orders" prev={P.delivered.prev} prevLabel={prevLabel} rows={typeRows(P.delivered)} pending={P.delivered.pending} />
        </>}
      </section>

      {/* ── Row 2: customer split ── */}
      <section className="dsb-grid cols-7">
        {isLoading || !C || !P ? Array.from({ length: 7 }).map((_, i) => <article key={i} className="dsb-card"><Skeleton height={110} /></article>) : <>
          <StatCard icon={UserPlus} title="Customers" count={C.total} prev={C.total - C.new + C.new_prev} prevLabel={prevLabel}
            rows={[{ label: 'New Customers', count: C.new }, { label: 'Existing Customers', count: C.existing }]} />
          <StatCard icon={CircleDollarSign} tone="green" title="Payment Received" count={P.payments.count} unit="Orders" value={P.payments.value} prev={P.payments.prev} prevLabel={prevLabel} rows={custRows(C.payments, true)} />
          <StatCard icon={ShoppingCart} tone="orange" title="Sales Orders Issued" count={P.sales_orders.count} unit="Orders" value={P.sales_orders.value} prev={P.sales_orders.prev} prevLabel={prevLabel} rows={custRows(C.sales_orders)} />
          <StatCard icon={ClipboardList} tone="red" title="PO Issued" count={P.po.count} unit="Orders" prev={P.po.prev} prevLabel={prevLabel} rows={custRows(C.po)} pending={P.po.pending} />
          <StatCard icon={Factory} tone="violet" title="In Production" count={P.production.count} unit="Orders" prev={P.production.prev} prevLabel={prevLabel} rows={custRows(C.production)} pending={P.production.pending} />
          <StatCard icon={Truck} title="Shipped" count={P.shipped.count} unit="Orders" prev={P.shipped.prev} prevLabel={prevLabel} rows={custRows(C.shipped)} pending={P.shipped.pending} />
          <StatCard icon={PackageCheck} tone="green" title="Delivered" count={P.delivered.count} unit="Orders" prev={P.delivered.prev} prevLabel={prevLabel} rows={custRows(C.delivered)} pending={P.delivered.pending} />
        </>}
      </section>

      {/* ── Row 3: charts ── */}
      <section className="dsb-charts">
        {isLoading || !data || !P ? Array.from({ length: 4 }).map((_, i) => <section key={i} className="dsb-panel"><Skeleton height={200} /></section>) : <>
          <DonutPanel title="Sales by Product Type" data={data.sales_by_type} colors={DONUT_TYPE} />
          <DonutPanel title="Sales by Customers" data={data.sales_by_customer} colors={DONUT_CUST} />
          <FunnelPanel stages={[
            { label: 'Payment Received', count: P.payments.count },
            { label: 'Sales Orders Issued', count: P.sales_orders.count },
            { label: 'PO Issued', count: P.po.count },
            { label: 'In Production', count: P.production.count },
            { label: 'Shipped', count: P.shipped.count },
            { label: 'Delivered', count: P.delivered.count },
          ]} />
          <TrendPanel trend={data.trend} />
        </>}
      </section>

      {/* ── Row 4: recent tables ── */}
      <section className="dsb-tables">
        {isLoading || !data ? Array.from({ length: 3 }).map((_, i) => <section key={i} className="dsb-panel"><Skeleton height={220} /></section>) : <>
          <section className="dsb-panel">
            <h3>Recent Payments <Link to="/invoices" className="dsb-viewall">View All</Link></h3>
            <table className="dsb-table">
              <thead><tr><th>Date</th><th>Customer</th><th>Amount</th><th>Method</th><th>Invoice</th></tr></thead>
              <tbody>
                {data.recent.payments.length === 0 && <tr><td colSpan={5} className="dsb-empty">No payments recorded yet.</td></tr>}
                {data.recent.payments.map((r, i) => (
                  <tr key={`${r.invoice_id}-${i}`}>
                    <td>{fmtDay(String(r.paid_at).slice(0, 10))}</td>
                    <td className="dsb-strong">{r.customer}</td>
                    <td className="dsb-strong">{money(r.amount)}</td>
                    <td style={{ textTransform: 'capitalize' }}>{(r.method || '—').replace(/_/g, ' ')}</td>
                    <td><Link className="dsb-link" to={`/invoices/${r.invoice_id}`}>{r.invoice_number}</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <footer className="dsb-panel-foot"><span>Total Payments (Period)</span><b>{data.recent.payments_total.count} Orders · {money(data.recent.payments_total.value)}</b></footer>
          </section>

          <section className="dsb-panel">
            <h3>Recent PO Issued <Link to="/purchase-orders" className="dsb-viewall">View All</Link></h3>
            <table className="dsb-table">
              <thead><tr><th>Date</th><th>PO #</th><th>Source Order</th><th>Vendor</th><th>Status</th></tr></thead>
              <tbody>
                {data.recent.pos.length === 0 && <tr><td colSpan={5} className="dsb-empty">No purchase orders yet.</td></tr>}
                {data.recent.pos.map(r => (
                  <tr key={r.id}>
                    <td>{fmtDay(String(r.po_date).slice(0, 10))}</td>
                    <td><Link className="dsb-link" to={`/purchase-orders/${r.id}`}>{r.po_number}</Link></td>
                    <td>{r.source_order || '—'}</td>
                    <td>{r.vendor || '—'}</td>
                    <td><StatusPill value={r.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <footer className="dsb-panel-foot"><span>Total PO Issued (Period)</span><b>{data.recent.pos_total} Orders</b></footer>
          </section>

          <section className="dsb-panel">
            <h3>Recent Shipments <Link to="/shipments" className="dsb-viewall">View All</Link></h3>
            <table className="dsb-table">
              <thead><tr><th>Ship Date</th><th>Tracking ID</th><th>Customer</th><th>Carrier</th><th>Status</th></tr></thead>
              <tbody>
                {data.recent.shipments.length === 0 && <tr><td colSpan={5} className="dsb-empty">No shipments yet.</td></tr>}
                {data.recent.shipments.map(r => (
                  <tr key={r.id}>
                    <td>{fmtDay(String(r.ship_date).slice(0, 10))}</td>
                    <td className="dsb-mono">{r.tracking_number || '—'}</td>
                    <td className="dsb-strong">{r.customer}</td>
                    <td>{r.carrier || '—'}</td>
                    <td><StatusPill value={r.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <footer className="dsb-panel-foot"><span>Total Shipments (Period)</span><b>{data.recent.shipments_total} Shipments</b></footer>
          </section>
        </>}
      </section>

      <p className="dsb-note">All dates and times are shown in your local time zone.</p>
    </div>
  )
}
