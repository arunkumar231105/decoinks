import { useQuery } from '@tanstack/react-query'
import {
  ArrowDownRight,
  ArrowUpRight,
  ClipboardList,
  Images,
  ReceiptText,
  ShoppingCart,
  Users,
  DollarSign,
  FileCheck2,
  PackageCheck,
} from 'lucide-react'
import {
  Bar,
  BarChart,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { api } from '../services/api'

// Keys must match the lead_stage enum the backend returns.
const LEAD_STAGES = [
  { key: 'initiated', label: 'Initiated', color: '#0D9488' },
  { key: 'quotation', label: 'Quotation', color: '#14B8A6' },
  { key: 'artwork',   label: 'Artwork',   color: '#2563EB' },
  { key: 'gangsheet', label: 'Gangsheet', color: '#F59E0B' },
  { key: 'payment',   label: 'Payment',   color: '#8B5CF6' },
  { key: 'confirmed', label: 'Confirmed', color: '#22C55E' },
]

// Keys must match the order_status enum.
const ORDER_STATUS_COLORS: Record<string, string> = {
  'Draft':          '#94A3B8',
  'Confirmed':      '#0D9488',
  'In Production':  '#2563EB',
  'QC':             '#8B5CF6',
  'Ready to Ship':  '#F59E0B',
  'Shipped':        '#14B8A6',
  'Delivered':      '#22C55E',
  'Cancelled':      '#EF4444',
}

export function DashboardPage() {
  const { data: stats } = useQuery({
    queryKey: ['dashboard', 'stats'],
    queryFn: () => api.get('/dashboard/stats').then(r => r.data.data),
  })

  const { data: pipeline = [] } = useQuery({
    queryKey: ['dashboard', 'lead-pipeline'],
    queryFn: () => api.get('/dashboard/lead-pipeline').then(r => r.data.data),
  })

  const { data: ordersByStatus = [] } = useQuery({
    queryKey: ['dashboard', 'orders-by-status'],
    queryFn: () => api.get('/dashboard/orders-by-status').then(r => r.data.data),
  })

  const { data: topSuppliers = [] } = useQuery({
    queryKey: ['dashboard', 'top-suppliers'],
    queryFn: () => api.get('/dashboard/top-suppliers').then(r => r.data.data),
  })

  const { data: recentActivity = [] } = useQuery({
    queryKey: ['dashboard', 'recent-activity'],
    queryFn: () => api.get('/dashboard/recent-activity').then(r => r.data.data),
  })

  const pipelineChartData = pipeline.length
    ? [Object.fromEntries([['name', 'Lead pipeline'], ...pipeline.map((p: any) => [p.stage, p.count])])]
    : []

  const donutData: { name: string; value: number; color: string }[] = ordersByStatus.map((o: any) => ({
    name: o.status,
    value: o.count,
    color: ORDER_STATUS_COLORS[o.status] ?? '#94A3B8',
  }))

  const statCards = stats ? [
    {
      label: 'Total Leads',
      value: Number(stats.total_leads ?? 0).toLocaleString(),
      note: `${stats.leads_today ?? 0} added today`,
      trend: `${stats.leads_today_change_pct >= 0 ? '+' : ''}${stats.leads_today_change_pct ?? 0}%`,
      direction: (stats.leads_today_change_pct ?? 0) >= 0 ? 'up' : 'down',
      icon: ClipboardList,
      color: '#0D9488',
      bg: '#CCFBF1',
    },
    {
      label: 'Customers',
      value: Number(stats.total_customers ?? 0).toLocaleString(),
      note: 'active customer records',
      trend: '',
      direction: 'up',
      icon: Users,
      color: '#2563EB',
      bg: '#DBEAFE',
    },
    {
      label: 'Quotations',
      value: Number(stats.total_quotes ?? 0).toLocaleString(),
      note: `${stats.approved_quotes ?? 0} approved`,
      trend: '',
      direction: 'up',
      icon: FileCheck2,
      color: '#F59E0B',
      bg: '#FEF3C7',
    },
    {
      label: 'Orders',
      value: Number(stats.total_orders ?? 0).toLocaleString(),
      note: `${stats.delivered_orders ?? 0} delivered`,
      trend: '', direction: 'up', icon: ShoppingCart,
      color: '#7C3AED', bg: '#EDE9FE',
    },
    {
      label: 'Invoices',
      value: Number(stats.total_invoices ?? 0).toLocaleString(),
      note: `${stats.paid_invoices ?? 0} paid`,
      trend: '', direction: 'up', icon: ReceiptText,
      color: '#0891B2', bg: '#CFFAFE',
    },
    {
      label: 'Purchase Orders',
      value: Number(stats.total_purchase_orders ?? 0).toLocaleString(),
      note: 'vendor fulfillment records',
      trend: '', direction: 'up', icon: PackageCheck,
      color: '#EA580C', bg: '#FFEDD5',
    },
    {
      label: 'Paid Revenue',
      value: `$${Number(stats.lifetime_revenue ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
      note: `$${Number(stats.outstanding_revenue ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2 })} outstanding`,
      trend: '', direction: 'up', icon: DollarSign,
      color: '#7C3AED',
      bg: '#EDE9FE',
    },
    {
      label: 'Production Volume',
      value: Number(stats.total_artworks ?? 0).toLocaleString(),
      note: `${stats.total_gangsheets ?? 0} gangsheets`,
      trend: '', direction: 'up', icon: Images,
      color: '#0D9488', bg: '#CCFBF1',
    },
  ] : []

  return (
    <div className="dashboard-page">
      <section className="metric-row">
        {statCards.map((stat) => {
          const Icon = stat.icon
          const TrendIcon = stat.direction === 'up' ? ArrowUpRight : ArrowDownRight

          return (
            <article className="metric-card" key={stat.label}>
              <div className="metric-card-top">
                <span className="metric-icon" style={{ backgroundColor: stat.bg, color: stat.color }}>
                  <Icon size={21} />
                </span>
                {stat.trend && (
                  <span className={`trend-pill trend-${stat.direction}`}>
                    <TrendIcon size={15} />
                    {stat.trend}
                  </span>
                )}
              </div>
              <p>{stat.label}</p>
              <strong>{stat.value}</strong>
              <small>{stat.note}</small>
            </article>
          )
        })}

        {!stats && [1, 2, 3, 4].map((i) => (
          <article className="metric-card" key={i} style={{ opacity: 0.4 }}>
            <div className="metric-card-top">
              <span className="metric-icon" style={{ backgroundColor: '#F3F4F6', color: '#9CA3AF' }}>
                <ClipboardList size={21} />
              </span>
            </div>
            <p>Loading…</p>
            <strong>—</strong>
            <small>&nbsp;</small>
          </article>
        ))}
      </section>

      <section className="dashboard-two-column">
        <article className="panel chart-panel">
          <div className="panel-header">
            <div>
              <h2>Lead Board Summary</h2>
              <p>Pipeline volume by current stage</p>
            </div>
          </div>
          {pipelineChartData.length > 0 ? (
            <>
              <div className="stacked-chart-wrap">
                <ResponsiveContainer width="100%" height={150}>
                  <BarChart data={pipelineChartData} layout="vertical" margin={{ top: 16, right: 18, left: 0, bottom: 8 }}>
                    <XAxis type="number" hide />
                    <YAxis dataKey="name" type="category" hide />
                    <Tooltip cursor={{ fill: 'transparent' }} />
                    <Legend iconType="circle" />
                    {LEAD_STAGES.filter(s => pipelineChartData[0]?.[s.key] !== undefined).map((stage) => (
                      <Bar
                        key={stage.key}
                        dataKey={stage.key}
                        name={stage.label}
                        stackId="lead-stage"
                        fill={stage.color}
                        radius={[0, 0, 0, 0]}
                      />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="stage-breakdown">
                {pipeline.map((p: any) => {
                  const cfg = LEAD_STAGES.find(s => s.key === p.stage)
                  return (
                    <span key={p.stage}>
                      <i style={{ backgroundColor: cfg?.color ?? '#94A3B8' }} />
                      {cfg?.label ?? p.stage} ({p.count})
                    </span>
                  )
                })}
              </div>
            </>
          ) : (
            <p style={{ color: '#9CA3AF', fontSize: 13, padding: '24px 0', textAlign: 'center' }}>No lead data yet</p>
          )}
        </article>

        <article className="panel chart-panel">
          <div className="panel-header">
            <div>
              <h2>Order Production Status</h2>
              <p>All-time order status mix</p>
            </div>
          </div>
          {donutData.length > 0 ? (
            <div className="donut-layout">
              <ResponsiveContainer width="100%" height={230}>
                <PieChart>
                  <Pie data={donutData} dataKey="value" nameKey="name" innerRadius={62} outerRadius={92} paddingAngle={3}>
                    {donutData.map((entry) => (
                      <Cell key={entry.name} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
              <div className="donut-legend">
                {donutData.map((s) => (
                  <div key={s.name}>
                    <span>
                      <i style={{ backgroundColor: s.color }} />
                      {s.name}
                    </span>
                    <strong>{s.value}</strong>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p style={{ color: '#9CA3AF', fontSize: 13, padding: '24px 0', textAlign: 'center' }}>No orders yet</p>
          )}
        </article>
      </section>

      <section className="dashboard-two-column">
        <article className="panel activity-panel">
          <div className="panel-header">
            <div>
              <h2>Recent Activity</h2>
              <p>Latest updates across leads, invoices, and orders</p>
            </div>
          </div>
          <div className="activity-feed">
            {recentActivity.length === 0 && (
              <p style={{ color: '#9CA3AF', fontSize: 13, padding: '8px 0' }}>No recent activity</p>
            )}
            {recentActivity.map((item: any) => (
              <div className="activity-item" key={item.id}>
                <span />
                <p>
                  <strong>{item.entity_type}</strong> — {item.action}
                  {item.user_name ? ` by ${item.user_name}` : ''}
                  {' · '}
                  <span style={{ color: '#9CA3AF' }}>
                    {new Date(item.created_at).toLocaleString()}
                  </span>
                </p>
              </div>
            ))}
          </div>
        </article>

        <article className="panel quick-stats-panel">
          <div className="panel-header">
            <div>
              <h2>Quick Stats</h2>
              <p>Order status and top customer accounts</p>
            </div>
          </div>
          <div className="quick-stats-grid">
            <div>
              <h3>Orders by Status</h3>
              <table>
                <tbody>
                  {ordersByStatus.length === 0 && (
                    <tr><td colSpan={2} style={{ color: '#9CA3AF', fontSize: 13 }}>No orders this week</td></tr>
                  )}
                  {ordersByStatus.map((row: any) => (
                    <tr key={row.status}>
                      <td>{row.status}</td>
                      <td>{row.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div>
              <h3>Top Customers by Revenue</h3>
              <table>
                <tbody>
                  {topSuppliers.length === 0 && (
                    <tr><td colSpan={2} style={{ color: '#9CA3AF', fontSize: 13 }}>No data yet</td></tr>
                  )}
                  {topSuppliers.map((row: any) => (
                    <tr key={row.supplier}>
                      <td>{row.supplier}</td>
                      <td>${Number(row.revenue).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </article>
      </section>
    </div>
  )
}
