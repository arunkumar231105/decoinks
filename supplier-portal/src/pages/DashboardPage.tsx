import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { BarChart2, CheckCircle, Package, Truck, TrendingUp, TrendingDown } from 'lucide-react'
import {
  PieChart, Pie, Cell, LineChart, Line,
  XAxis, YAxis, Tooltip, ResponsiveContainer,
} from 'recharts'
import api from '../services/api'
import { cn } from '../utils/cn'

// ─── Types ────────────────────────────────────────────────────────────────────

interface StatusEntry  { name: string; value: number; color: string }
interface TrendEntry   { date: string; orders: number }
interface RecentOrder  { id: string; order_number: string; status: string; order_type: string; order_date: string; due_date: string | null }
interface SnapshotItem { label: string; count: number; color: string; pct: number }

interface DashData {
  totalOrders: number
  inProduction: number
  shipped: number
  completed: number
  weekDelta: number
  ordersByStatus: StatusEntry[]
  ordersByType:   StatusEntry[]
  trendData:      TrendEntry[]
  recentOrders:   RecentOrder[]
  productionSnapshot: SnapshotItem[]
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_BADGE: Record<string, string> = {
  'In Production': 'bg-blue-50 text-blue-700',
  Shipped:         'bg-orange-50 text-orange-700',
  Completed:       'bg-green-50 text-green-700',
  'On Hold':       'bg-yellow-50 text-yellow-700',
  Cancelled:       'bg-red-50 text-red-700',
  Draft:           'bg-gray-100 text-gray-600',
  Confirmed:       'bg-emerald-50 text-emerald-700',
}

const fmt = (d: string) =>
  new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

// ─── Sub-components ───────────────────────────────────────────────────────────

function DonutChart({ data, label }: { data: StatusEntry[]; label: string }) {
  const total = data.reduce((s, d) => s + d.value, 0)
  return (
    <div className="card h-full">
      <h3 className="text-sm font-semibold text-gray-800 mb-3">{label}</h3>
      {total === 0 ? (
        <p className="text-sm text-gray-400 py-6">No data</p>
      ) : (
        <div className="flex items-center gap-4">
          <div className="relative flex-shrink-0">
            <ResponsiveContainer width={100} height={100}>
              <PieChart>
                <Pie data={data} dataKey="value" innerRadius={30} outerRadius={46} strokeWidth={0}>
                  {data.map((e, i) => <Cell key={i} fill={e.color} />)}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-xs font-bold text-gray-700">{total}</span>
            </div>
          </div>
          <div className="flex-1 space-y-1.5 min-w-0">
            {data.map((e) => (
              <div key={e.name} className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: e.color }} />
                <span className="text-xs text-gray-600 truncate flex-1">{e.name}</span>
                <span className="text-xs font-semibold text-gray-900">{e.value}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { data, isLoading } = useQuery<DashData>({
    queryKey: ['dashboard'],
    queryFn: () => api.get('/dashboard').then((r) => r.data),
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin w-8 h-8 border-2 border-accent border-t-transparent rounded-full" />
      </div>
    )
  }

  const d: DashData = data ?? {
    totalOrders: 0, inProduction: 0, shipped: 0, completed: 0,
    weekDelta: 0, ordersByStatus: [], ordersByType: [], trendData: [],
    recentOrders: [], productionSnapshot: [],
  }

  const statCards = [
    {
      label: 'Total Orders',
      value: d.totalOrders,
      icon: BarChart2,
      bg: 'bg-blue-50',
      color: 'text-blue-600',
      delta: d.weekDelta,
    },
    {
      label: 'In Production',
      value: d.inProduction,
      icon: Package,
      bg: 'bg-orange-50',
      color: 'text-orange-600',
      delta: null,
    },
    {
      label: 'Shipped',
      value: d.shipped,
      icon: Truck,
      bg: 'bg-green-50',
      color: 'text-green-600',
      delta: null,
    },
    {
      label: 'Completed',
      value: d.completed,
      icon: CheckCircle,
      bg: 'bg-purple-50',
      color: 'text-purple-600',
      delta: null,
    },
  ]

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Dashboard</h2>
        <p className="text-sm text-gray-500 mt-1">Overview of your orders and production activities.</p>
      </div>

      {/* ── Row 1: Stat cards ── */}
      <div className="grid grid-cols-4 gap-4">
        {statCards.map(({ label, value, icon: Icon, bg, color, delta }) => (
          <div key={label} className="card">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-gray-500 font-medium">{label}</p>
                <p className="text-3xl font-bold text-gray-900 mt-1">{value}</p>
                {delta !== null && (
                  <div className={cn('flex items-center gap-1 mt-1 text-xs font-medium', delta >= 0 ? 'text-green-600' : 'text-red-500')}>
                    {delta >= 0
                      ? <TrendingUp size={11} />
                      : <TrendingDown size={11} />}
                    {delta >= 0 ? '+' : ''}{delta} vs last week
                  </div>
                )}
              </div>
              <div className={cn('p-2.5 rounded-xl', bg)}>
                <Icon size={20} className={color} />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* ── Row 2: Charts ── */}
      <div className="grid grid-cols-3 gap-4">
        {/* Orders by Status donut */}
        <DonutChart data={d.ordersByStatus} label="Orders by Status" />

        {/* Orders Trend line chart */}
        <div className="card">
          <h3 className="text-sm font-semibold text-gray-800 mb-3">Orders Trend (Last 7 Days)</h3>
          {d.trendData.length === 0 ? (
            <p className="text-sm text-gray-400 py-6">No data</p>
          ) : (
            <ResponsiveContainer width="100%" height={120}>
              <LineChart data={d.trendData}>
                <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={fmt} />
                <YAxis tick={{ fontSize: 10 }} allowDecimals={false} width={24} />
                <Tooltip
                  labelFormatter={(v) => fmt(String(v))}
                  contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid #e5e7eb' }}
                />
                <Line
                  type="monotone"
                  dataKey="orders"
                  stroke="#3B82F6"
                  strokeWidth={2}
                  dot={{ fill: '#3B82F6', r: 3 }}
                  activeDot={{ r: 5 }}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Orders by Type donut */}
        <DonutChart data={d.ordersByType} label="Orders by Type" />
      </div>

      {/* ── Row 3: Summary + Recent Orders + Production Snapshot ── */}
      <div className="grid grid-cols-3 gap-4">
        {/* Order Summary this week */}
        <div className="card">
          <h3 className="text-sm font-semibold text-gray-800 mb-3">Order Summary This Week</h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left text-xs text-gray-500 font-medium pb-2">Status</th>
                <th className="text-right text-xs text-gray-500 font-medium pb-2">Count</th>
                <th className="text-right text-xs text-gray-500 font-medium pb-2">Share</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {d.ordersByStatus.length === 0 ? (
                <tr><td colSpan={3} className="py-6 text-center text-xs text-gray-400">No orders</td></tr>
              ) : (
                d.ordersByStatus.map((s) => (
                  <tr key={s.name}>
                    <td className="py-2 flex items-center gap-1.5">
                      <div className="w-2 h-2 rounded-full" style={{ background: s.color }} />
                      <span className="text-xs text-gray-700">{s.name}</span>
                    </td>
                    <td className="py-2 text-right text-xs font-semibold text-gray-900">{s.value}</td>
                    <td className="py-2 text-right text-xs text-gray-500">
                      {d.totalOrders > 0 ? Math.round((s.value / d.totalOrders) * 100) : 0}%
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Recent Orders */}
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-800">Recent Orders</h3>
            <Link to="/orders" className="text-xs text-accent hover:underline">View all →</Link>
          </div>
          <div className="space-y-0">
            {d.recentOrders.length === 0 ? (
              <p className="text-xs text-gray-400 py-4">No recent orders</p>
            ) : (
              d.recentOrders.map((o) => (
                <Link
                  key={o.id}
                  to={`/orders/${o.id}`}
                  className="flex items-center justify-between py-2.5 border-b border-gray-50 last:border-0 hover:bg-gray-50 -mx-2 px-2 rounded transition-colors"
                >
                  <div>
                    <p className="text-xs font-medium text-accent">{o.order_number}</p>
                    <p className="text-[10px] text-gray-400 capitalize mt-0.5">{o.order_type} · {fmt(o.order_date)}</p>
                  </div>
                  <span className={cn('badge text-[10px]', STATUS_BADGE[o.status] ?? 'bg-gray-100 text-gray-600')}>
                    {o.status}
                  </span>
                </Link>
              ))
            )}
          </div>
        </div>

        {/* Production Snapshot */}
        <div className="card">
          <h3 className="text-sm font-semibold text-gray-800 mb-3">Production Snapshot</h3>
          {d.productionSnapshot.length === 0 ? (
            <p className="text-xs text-gray-400 py-4">No data</p>
          ) : (
            <div className="space-y-3">
              {d.productionSnapshot.map((s) => (
                <div key={s.label}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-gray-600">{s.label}</span>
                    <span className="text-xs font-semibold text-gray-900">{s.count} <span className="text-gray-400 font-normal">({s.pct}%)</span></span>
                  </div>
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{ width: `${s.pct}%`, background: s.color }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
