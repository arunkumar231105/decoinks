import { useQuery } from '@tanstack/react-query'
import {
  ArrowRight,
  ArrowDownRight,
  ArrowUpRight,
  Clock3,
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
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from 'recharts'
import { Link } from 'react-router-dom'
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

  const pipelineTotal = pipeline.reduce((sum: number, row: any) => sum + Number(row.count || 0), 0)

  const donutData: { name: string; value: number; color: string }[] = ordersByStatus.map((o: any) => ({
    name: o.status,
    value: o.count,
    color: ORDER_STATUS_COLORS[o.status] ?? '#94A3B8',
  }))
  const orderTotal = donutData.reduce((sum, row) => sum + Number(row.value || 0), 0)
  const visibleActivity = recentActivity.slice(0, 8)

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
            <article className="metric-card" key={stat.label} style={{ borderTopColor: stat.color }}>
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
          {pipeline.length > 0 ? (
            <div className="pipeline-list">
              {LEAD_STAGES.map((stage) => {
                const row = pipeline.find((p: any) => p.stage === stage.key)
                const count = Number(row?.count || 0)
                const percentage = pipelineTotal ? (count / pipelineTotal) * 100 : 0
                return (
                  <div className="pipeline-row" key={stage.key}>
                    <div className="pipeline-row-head">
                      <span><i style={{ backgroundColor: stage.color }} />{stage.label}</span>
                      <strong>{count.toLocaleString()} <small>{percentage.toFixed(percentage > 0 && percentage < 1 ? 1 : 0)}%</small></strong>
                    </div>
                    <div className="pipeline-track"><span style={{ width: `${Math.max(percentage, count ? 2 : 0)}%`, backgroundColor: stage.color }} /></div>
                  </div>
                )
              })}
              <div className="pipeline-total"><span>Total pipeline</span><strong>{pipelineTotal.toLocaleString()} leads</strong></div>
            </div>
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
              <div className="donut-chart-wrap">
                <ResponsiveContainer width="100%" height={230}>
                  <PieChart>
                    <Pie data={donutData} dataKey="value" nameKey="name" innerRadius={66} outerRadius={92} paddingAngle={3} stroke="none">
                      {donutData.map((entry) => (
                        <Cell key={entry.name} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
                <div className="donut-center"><strong>{orderTotal}</strong><span>Total orders</span></div>
              </div>
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

      <section className="dashboard-two-column dashboard-bottom-grid">
        <article className="panel activity-panel">
          <div className="panel-header">
            <div>
              <h2>Recent Activity</h2>
              <p>Latest updates across leads, invoices, and orders</p>
            </div>
            <Link className="panel-link" to="/quotes">View records <ArrowRight size={14} /></Link>
          </div>
          <div className="activity-feed">
            {recentActivity.length === 0 && (
              <p style={{ color: '#9CA3AF', fontSize: 13, padding: '8px 0' }}>No recent activity</p>
            )}
            {visibleActivity.map((item: any) => (
              <div className="activity-item" key={item.id}>
                <span className="activity-dot" />
                <div className="activity-copy">
                  <p><span className="activity-type">{item.entity_type}</span>{item.action}</p>
                  <small><Clock3 size={12} />{new Date(item.created_at).toLocaleString()} {item.user_name ? `· ${item.user_name}` : ''}</small>
                </div>
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
            <div className="quick-stat-section">
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
            <div className="quick-stat-section">
              <h3>Top Customers by Revenue</h3>
              <div className="customer-ranking">
                {topSuppliers.length === 0 && <p className="empty-copy">No data yet</p>}
                {topSuppliers.map((row: any, index: number) => {
                  const max = Number(topSuppliers[0]?.revenue || 1)
                  return (
                    <div className="customer-rank" key={row.supplier}>
                      <span className="rank-number">{index + 1}</span>
                      <div><p><strong>{row.supplier}</strong><b>${Number(row.revenue).toLocaleString()}</b></p><div className="rank-track"><span style={{ width: `${Number(row.revenue) / max * 100}%` }} /></div></div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </article>
      </section>
    </div>
  )
}
