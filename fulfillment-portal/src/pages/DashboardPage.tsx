import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ClipboardList, CalendarDays, LayoutGrid, Shirt, Hourglass, PlayCircle, Factory,
  Truck, CheckCircle2, XCircle, PauseCircle, ArrowRight,
} from 'lucide-react'
import {
  Area, AreaChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { PageHeader } from '../components/Layout'
import { Panel, Pill, StatCard, TableStates, fmtDate, num } from '../components/ui'
import api from '../services/api'

interface Dashboard {
  counts: Record<string, number>
  trend: { date: string; orders: number }[]
  recent: { id: string; order_number: string; status: string; order_type: string; order_date: string }[]
  byType: { order_type: string; count: number }[]
  weekChange: number
  thisWeek: number
}

const STATUS_COLORS: Record<string, string> = {
  'In Production': '#F59E0B',
  Shipped: '#16A34A',
  Completed: '#2563EB',
  'On Hold': '#7C3AED',
  Cancelled: '#DC2626',
  Delivered: '#16A34A',
  Confirmed: '#0EA5E9',
  Draft: '#94A3B8',
}

const TYPE_COLORS = ['#7C3AED', '#0891B2', '#2563EB', '#F59E0B']

export default function DashboardPage() {
  const [data, setData] = useState<Dashboard | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setLoading(true)
    api.get('/dashboard')
      .then(r => { if (alive) { setData(r.data); setError(null) } })
      .catch(() => { if (alive) setError('The dashboard could not be loaded.') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [])

  const counts = data?.counts ?? {}
  const total = Object.values(counts).reduce((a, b) => a + b, 0)
  const get = (k: string) => counts[k] ?? 0

  const statusData = Object.entries(counts)
    .filter(([, v]) => v > 0)
    .map(([name, value]) => ({ name, value }))

  const typeData = (data?.byType ?? []).map(t => ({
    name: t.order_type === 'gangsheet' ? 'Gangsheet Orders'
      : t.order_type === 'apparel' ? 'Custom T-Shirts'
      : t.order_type === 'dtf' ? 'DTF Transfers' : t.order_type,
    value: Number(t.count),
  }))

  const trend = (data?.trend ?? []).map(t => ({
    label: fmtDate(t.date).replace(/, \d{4}$/, ''),
    orders: Number(t.orders),
  }))

  const production = [
    { label: 'Yet to Start', value: get('Draft') + get('Confirmed'), icon: PlayCircle, color: 'bg-slate-500' },
    { label: 'In Production', value: get('In Production'), icon: Factory, color: 'bg-amber-500' },
    { label: 'Shipped', value: get('Shipped'), icon: Truck, color: 'bg-emerald-500' },
    { label: 'Completed', value: get('Completed') + get('Delivered'), icon: CheckCircle2, color: 'bg-brand' },
  ]

  return (
    <>
      <PageHeader title="Dashboard" subtitle="Overview of your orders and production activities." />

      {/* Headline row */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={ClipboardList} label="Orders This Week" value={num(data?.thisWeek)} loading={loading}
          tone="bg-brand" trend={data ? { value: data.weekChange, note: 'vs last week' } : null} />
        <StatCard icon={CalendarDays} label="Total Orders" value={num(total)} loading={loading} tone="bg-emerald-600" />
        <StatCard icon={LayoutGrid} label="Gangsheet Orders" loading={loading} tone="bg-violet-600"
          value={num(typeData.find(t => t.name === 'Gangsheet Orders')?.value)} />
        <StatCard icon={Shirt} label="Custom T-Shirts" loading={loading} tone="bg-cyan-600"
          value={num(typeData.find(t => t.name === 'Custom T-Shirts')?.value)} />
      </div>

      {/* Status row */}
      <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-3 2xl:grid-cols-6">
        <StatCard icon={Hourglass} label="Pending" value={num(get('Draft') + get('Confirmed'))} loading={loading} tone="bg-amber-500" />
        <StatCard icon={Factory} label="In Production" value={num(get('In Production'))} loading={loading} tone="bg-orange-500" />
        <StatCard icon={Truck} label="Shipped" value={num(get('Shipped'))} loading={loading} tone="bg-emerald-600" />
        <StatCard icon={CheckCircle2} label="Completed" value={num(get('Completed') + get('Delivered'))} loading={loading} tone="bg-brand" />
        <StatCard icon={XCircle} label="Cancelled" value={num(get('Cancelled'))} loading={loading} tone="bg-rose-600" />
        <StatCard icon={PauseCircle} label="On Hold" value={num(get('On Hold'))} loading={loading} tone="bg-violet-600" />
      </div>

      {/* Charts */}
      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Panel title="Orders by Status">
          <div className="p-5">
            {statusData.length === 0
              ? <p className="py-12 text-center text-sm text-muted">{error ?? 'No orders yet.'}</p>
              : (
                <>
                  <div className="relative h-56">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={statusData} dataKey="value" innerRadius={62} outerRadius={88} paddingAngle={2} stroke="none">
                          {statusData.map(s => <Cell key={s.name} fill={STATUS_COLORS[s.name] ?? '#94A3B8'} />)}
                        </Pie>
                        <Tooltip />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="pointer-events-none absolute inset-0 grid place-items-center">
                      <div className="text-center">
                        <div className="text-2xl font-bold text-ink">{num(total)}</div>
                        <div className="text-xs text-muted">Total</div>
                      </div>
                    </div>
                  </div>
                  <ul className="mt-4 space-y-2">
                    {statusData.map(s => (
                      <li key={s.name} className="flex items-center gap-2 text-[13px]">
                        <span className="h-2.5 w-2.5 rounded-full" style={{ background: STATUS_COLORS[s.name] ?? '#94A3B8' }} />
                        <span className="flex-1 text-ink">{s.name}</span>
                        <span className="font-semibold text-ink">{s.value}</span>
                        <span className="text-muted">({total ? ((s.value / total) * 100).toFixed(1) : '0.0'}%)</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
          </div>
        </Panel>

        <Panel title="Orders Trend (Last 7 Days)">
          <div className="h-[300px] p-5">
            {trend.length === 0
              ? <p className="py-12 text-center text-sm text-muted">No orders in the last 7 days.</p>
              : (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={trend} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                    <defs>
                      <linearGradient id="fpTrend" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#2563EB" stopOpacity={0.25} />
                        <stop offset="100%" stopColor="#2563EB" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: '#64748B' }} />
                    <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: '#64748B' }} allowDecimals={false} />
                    <Tooltip />
                    <Area type="monotone" dataKey="orders" stroke="#2563EB" strokeWidth={2.5} fill="url(#fpTrend)" />
                  </AreaChart>
                </ResponsiveContainer>
              )}
          </div>
        </Panel>

        <Panel title="Orders by Type">
          <div className="p-5">
            {typeData.length === 0
              ? <p className="py-12 text-center text-sm text-muted">No orders yet.</p>
              : (
                <>
                  <div className="relative h-56">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={typeData} dataKey="value" innerRadius={62} outerRadius={88} paddingAngle={2} stroke="none">
                          {typeData.map((t, i) => <Cell key={t.name} fill={TYPE_COLORS[i % TYPE_COLORS.length]} />)}
                        </Pie>
                        <Tooltip />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="pointer-events-none absolute inset-0 grid place-items-center">
                      <div className="text-center">
                        <div className="text-2xl font-bold text-ink">{num(typeData.reduce((a, b) => a + b.value, 0))}</div>
                        <div className="text-xs text-muted">Total</div>
                      </div>
                    </div>
                  </div>
                  <ul className="mt-4 space-y-2">
                    {typeData.map((t, i) => (
                      <li key={t.name} className="flex items-center gap-2 text-[13px]">
                        <span className="h-2.5 w-2.5 rounded-full" style={{ background: TYPE_COLORS[i % TYPE_COLORS.length] }} />
                        <span className="flex-1 text-ink">{t.name}</span>
                        <span className="font-semibold text-ink">{t.value}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
          </div>
        </Panel>
      </div>

      {/* Recent orders + production snapshot */}
      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Panel
          title="Recent Orders"
          action={<Link to="/orders" className="inline-flex items-center gap-1 text-[13px] font-medium text-brand hover:underline">View all <ArrowRight size={14} /></Link>}
        >
          <div className="fp-table-wrap">
            <table className="w-full min-w-[560px] border-collapse">
              <thead><tr>{['Order ID', 'Type', 'Order Date', 'Status'].map(h => <th key={h} className="fp-th">{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-line">
                <TableStates colSpan={4} loading={loading} error={error} rows={5}
                  empty={(data?.recent ?? []).length === 0}
                  emptyMessage="Orders assigned to you will appear here." />
                {!loading && !error && (data?.recent ?? []).map(o => (
                  <tr key={o.id} className="transition-colors hover:bg-brand/[0.04]">
                    <td className="fp-td"><Link to={`/orders/${o.id}`} className="fp-link">{o.order_number}</Link></td>
                    <td className="fp-td capitalize">{o.order_type}</td>
                    <td className="fp-td">{fmtDate(o.order_date)}</td>
                    <td className="fp-td"><Pill>{o.status}</Pill></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel title="Production Snapshot">
          <div className="space-y-4 p-5">
            {production.map(({ label, value, icon: Icon, color }) => {
              const pct = total ? (value / total) * 100 : 0
              return (
                <div key={label}>
                  <div className="mb-1.5 flex items-center gap-2.5">
                    <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg text-white ${color}`}><Icon size={16} /></span>
                    <span className="flex-1 text-[13px] font-medium text-ink">{label}</span>
                    <span className="text-[13px] font-bold text-ink">{value}</span>
                    <span className="w-12 text-right text-xs text-muted">{pct.toFixed(1)}%</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                    <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              )
            })}
          </div>
        </Panel>
      </div>
    </>
  )
}
