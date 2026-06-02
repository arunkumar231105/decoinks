import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AlertTriangle,
  Calendar,
  CheckCircle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Download,
  Filter,
  MoreVertical,
  Package,
  Plus,
  Search,
  Truck,
} from 'lucide-react'
import { Menu, MenuItem } from '@mui/material'
import { useQuery, keepPreviousData, useMutation, useQueryClient } from '@tanstack/react-query'
import { cn } from '../utils/cn'
import { api } from '../services/api'
import { downloadCsv, printPanel } from '../utils/actions'

interface Shipment {
  id: string
  shipment_number: string
  order_number: string | null
  customer_name: string | null
  status: 'Label Created' | 'In Transit' | 'Delivered' | 'Returned'
  carrier: string | null
  tracking_number: string | null
  shipping_cost: number | null
  ship_date: string | null
  estimated_delivery: string | null
  recipient_name: string | null
}

const STATUS_STYLES: Record<string, string> = {
  'Label Created': 'sh-status-label',
  'In Transit': 'sh-status-transit',
  'Delivered': 'sh-status-delivered',
  'Returned': 'sh-status-label',
}

const fmt = (n: number) =>
  n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const PAGE_SIZE = 10

export function ShipmentsPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [statusFilter, setStatusFilter] = useState<'All' | Shipment['status']>('All')
  const [menuAnchor, setMenuAnchor] = useState<{ el: HTMLElement; id: string } | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['shipments', { page }],
    queryFn: () => api.get('/shipments', { params: { page, limit: PAGE_SIZE } }).then(r => r.data.data),
    placeholderData: keepPreviousData,
  })

  const allShipments: Shipment[] = data?.rows ?? []
  const total: number = data?.total ?? 0
  const totalPages = Math.ceil(total / PAGE_SIZE)

  const filtered = allShipments.filter((s) => {
    const matchesStatus = statusFilter === 'All' || s.status === statusFilter
    const q = search.toLowerCase()
    const matchesSearch =
      (s.order_number ?? '').toLowerCase().includes(q) ||
      (s.customer_name ?? '').toLowerCase().includes(q) ||
      (s.tracking_number ?? '').toLowerCase().includes(q)
    return matchesStatus && matchesSearch
  })

  const selectedShipment = allShipments.find(s => s.id === menuAnchor?.id)
  const cancelMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/shipments/${id}/status`, { status: 'Returned' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['shipments'] }),
  })
  const printShipment = (shipment: Shipment) => printPanel(
    `Shipment ${shipment.shipment_number}`,
    [
      `Order: ${shipment.order_number ?? '-'}`,
      `Customer: ${shipment.customer_name ?? '-'}`,
      `Carrier: ${shipment.carrier ?? '-'}`,
      `Tracking: ${shipment.tracking_number ?? '-'}`,
      `Status: ${shipment.status}`,
      `Recipient: ${shipment.recipient_name ?? '-'}`,
    ].join('\n'),
  )

  const stats = {
    total,
    active: allShipments.filter(s => s.status !== 'Delivered').length,
    inTransit: allShipments.filter(s => s.status === 'In Transit').length,
    delivered: allShipments.filter(s => s.status === 'Delivered').length,
    onTime: 0,
    delayed: 0,
    needsAttention: 0,
  }

  return (
    <div className="sh-page">

      {/* Toolbar */}
      <div className="sh-toolbar">
        <div className="sh-search">
          <Search size={14} />
          <input
            placeholder="Search shipment, order, customer..."
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1) }}
          />
        </div>
        <button className="lb-action-btn" onClick={() => setStatusFilter(statusFilter === 'All' ? 'In Transit' : 'All')}>
          <Filter size={13} /> {statusFilter === 'All' ? 'Filter' : statusFilter}
        </button>
        <button
          className="lb-action-btn lb-action-primary"
          onClick={() => navigate('/shipments/new')}
        >
          <Plus size={14} /> New Shipment
        </button>
        <div className="sh-date-range">
          <Calendar size={13} />
          <span>Apr 1, 2026 - May 3, 2026</span>
          <ChevronDown size={12} />
        </div>
        <button className="lb-action-btn sh-export-btn" onClick={() => downloadCsv('shipments.csv', filtered as unknown as Record<string, unknown>[])}>
          <Download size={13} /> Export
          <ChevronDown size={12} />
        </button>
      </div>

      {/* Stats */}
      <div className="sh-stats">
        <div className="sh-stat">
          <div className="sh-stat-icon sh-stat-icon-blue"><Package size={18} /></div>
          <div>
            <span>Total Shipments</span>
            <strong>{stats.total}</strong>
          </div>
        </div>
        <div className="sh-stat">
          <div className="sh-stat-icon sh-stat-icon-teal"><Truck size={18} /></div>
          <div>
            <span>Active</span>
            <strong>{stats.active}</strong>
          </div>
        </div>
        <div className="sh-stat">
          <div className="sh-stat-icon sh-stat-icon-purple"><Truck size={18} /></div>
          <div>
            <span>In Transit</span>
            <strong>{stats.inTransit}</strong>
          </div>
        </div>
        <div className="sh-stat">
          <div className="sh-stat-icon sh-stat-icon-green"><CheckCircle size={18} /></div>
          <div>
            <span>Delivered</span>
            <strong>{stats.delivered}</strong>
          </div>
        </div>
        <div className="sh-stat">
          <div className="sh-stat-icon sh-stat-icon-green"><CheckCircle size={18} /></div>
          <div>
            <span>Delivery (On Time)</span>
            <strong>{stats.onTime}</strong>
          </div>
        </div>
        <div className="sh-stat">
          <div className="sh-stat-icon sh-stat-icon-amber"><Clock size={18} /></div>
          <div>
            <span>Delivery (Delayed)</span>
            <strong>{stats.delayed}</strong>
          </div>
        </div>
        <div className="sh-stat">
          <div className="sh-stat-icon sh-stat-icon-red"><AlertTriangle size={18} /></div>
          <div>
            <span>Needs Attention</span>
            <strong>{stats.needsAttention}</strong>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="sh-table-wrap">
        <table className="sh-table">
          <thead>
            <tr>
              <th>Shipment #</th>
              <th>Order No</th>
              <th>Customer</th>
              <th>Status</th>
              <th>Carrier</th>
              <th>Tracking #</th>
              <th>Cost</th>
              <th>Ship Date</th>
              <th>ETA</th>
              <th>Recipient</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={11} className="sh-empty">Loading…</td>
              </tr>
            )}
            {!isLoading && filtered.length === 0 && (
              <tr>
                <td colSpan={11} className="sh-empty">No shipments found.</td>
              </tr>
            )}
            {!isLoading && filtered.map(s => (
              <tr key={s.id} className="sh-row">
                <td>
                  <span className="sh-awb">{s.shipment_number}</span>
                </td>
                <td>
                  <button className="sh-order-link" onClick={() => navigate('/orders')}>{s.order_number ?? '-'}</button>
                </td>
                <td className="sh-customer">{s.customer_name ?? '-'}</td>
                <td>
                  <span className={cn('sh-status', STATUS_STYLES[s.status] ?? '')}>
                    {s.status}
                  </span>
                </td>
                <td className="sh-muted">{s.carrier ?? '-'}</td>
                <td>
                  <span className="sh-awb">{s.tracking_number ?? '-'}</span>
                </td>
                <td className="sh-cost">{s.shipping_cost != null ? `$${fmt(s.shipping_cost)}` : '-'}</td>
                <td className="sh-muted">{s.ship_date ?? '-'}</td>
                <td className="sh-muted">{s.estimated_delivery ?? '-'}</td>
                <td className="sh-muted">{s.recipient_name ?? '-'}</td>
                <td>
                  <button
                    className="lb-icon-btn"
                    onClick={e => setMenuAnchor({ el: e.currentTarget, id: s.id })}
                  >
                    <MoreVertical size={15} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="sh-pagination">
        <span>
          {total === 0
            ? 'No shipments'
            : `Showing ${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, total)} of ${total} shipments`}
        </span>
        <div className="sh-page-size">
          <select defaultValue="10" className="sh-per-page">
            <option>10</option>
            <option>25</option>
            <option>50</option>
          </select>
          <span>/ page</span>
          <ChevronDown size={12} />
        </div>
        <div className="sh-pag-controls">
          <button
            className="sh-pag-btn"
            disabled={page === 1}
            onClick={() => setPage(p => p - 1)}
          >
            <ChevronLeft size={14} />
          </button>
          {Array.from({ length: totalPages }, (_, i) => i + 1).map(n => (
            <button
              key={n}
              className={cn('sh-pag-btn', n === page && 'sh-pag-btn-active')}
              onClick={() => setPage(n)}
            >
              {n}
            </button>
          ))}
          <button
            className="sh-pag-btn"
            disabled={page === totalPages || totalPages === 0}
            onClick={() => setPage(p => p + 1)}
          >
            <ChevronRight size={14} />
          </button>
        </div>
      </div>

      <Menu anchorEl={menuAnchor?.el} open={Boolean(menuAnchor)} onClose={() => setMenuAnchor(null)}>
        <MenuItem onClick={() => { if (selectedShipment) printShipment(selectedShipment); setMenuAnchor(null) }}>View Details</MenuItem>
        <MenuItem onClick={() => { if (selectedShipment?.tracking_number) window.open(`https://www.google.com/search?q=${encodeURIComponent(selectedShipment.tracking_number)}`, '_blank'); setMenuAnchor(null) }}>Track Shipment</MenuItem>
        <MenuItem onClick={() => { if (selectedShipment) printShipment(selectedShipment); setMenuAnchor(null) }}>Print Label</MenuItem>
        <MenuItem onClick={() => { if (menuAnchor?.id) cancelMutation.mutate(menuAnchor.id); setMenuAnchor(null) }} style={{ color: '#ef4444' }}>Cancel Shipment</MenuItem>
      </Menu>
    </div>
  )
}
