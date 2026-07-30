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
  MapPin,
  MoreVertical,
  Package,
  Plus,
  RefreshCw,
  Search,
  Tag,
  Truck,
  Upload,
} from 'lucide-react'
import { Menu, MenuItem, Drawer } from '@mui/material'
import { useQuery, keepPreviousData, useMutation, useQueryClient } from '@tanstack/react-query'
import { cn } from '../utils/cn'
import { api } from '../services/api'
import toast from '../utils/toast'
import { downloadCsv, printPanel } from '../utils/actions'
import { ShipmentImportModal } from '../components/ShipmentImportModal'
import { LabelModal } from '../components/LabelModal'

interface TrackingScan {
  status: string | null
  substatus: string | null
  status_details: string | null
  status_date: string | null
  location: { city: string | null; state: string | null; zip: string | null; country: string | null } | null
}

interface Shipment {
  id: string
  shipment_number: string
  order_number: string | null
  po_number: string | null
  po_shipping_address: string | null
  customer_name: string | null
  status: string
  tracking_status: string | null
  substatus: string | null
  status_details: string | null
  carrier: string | null
  service_type: string | null
  tracking_number: string | null
  address: string | null
  ship_to_city: string | null
  ship_to_state: string | null
  ship_to_postal_code: string | null
  address_from_city: string | null
  address_from_state: string | null
  address_from_postal_code: string | null
  last_scan_city: string | null
  last_scan_state: string | null
  shipping_cost: number | null
  ship_date: string | null
  estimated_delivery: string | null
  original_eta: string | null
  delivered_date: string | null
  recipient_name: string | null
  tracking_history: TrackingScan[] | null
  tracking_messages: unknown[] | null
  tracking_synced_at: string | null
  label_url: string | null
  label_status: string | null
  shippo_transaction_id: string | null
}

// The effective status a row shows: live carrier/Shippo status if present,
// otherwise the internal workflow status.
const effectiveStatus = (s: Shipment) => s.tracking_status || s.status || '-'

// Map both internal statuses and Shippo statuses to a colour class.
function statusClass(raw: string): string {
  const v = (raw || '').toUpperCase()
  if (v.includes('DELIVER')) return 'sh-status-delivered'
  if (v.includes('TRANSIT') || v.includes('PICKED') || v.includes('OUT_FOR')) return 'sh-status-transit'
  if (v.includes('FAIL') || v.includes('RETURN') || v.includes('EXCEPTION')) return 'sh-status-label'
  return 'sh-status-label'
}

const PAGE_SIZE = 10

export function ShipmentsPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [statusFilter, setStatusFilter] = useState<string>('All')
  const [menuAnchor, setMenuAnchor] = useState<{ el: HTMLElement; id: string } | null>(null)
  const [detailShipment, setDetailShipment] = useState<Shipment | null>(null)
  const [showImport, setShowImport] = useState(false)
  const [showLabel, setShowLabel] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['shipments', { page }],
    queryFn: () => api.get('/shipments', { params: { page, limit: PAGE_SIZE } }).then(r => r.data.data),
    placeholderData: keepPreviousData,
  })
  // Dashboard-card counts aggregated across ALL shipments (not just this page).
  const { data: statsData } = useQuery({
    queryKey: ['shipments-stats'],
    queryFn: () => api.get('/shipments/stats').then(r => r.data.data),
  })

  const allShipments: Shipment[] = data?.rows ?? []
  const total: number = data?.total ?? 0
  const totalPages = Math.ceil(total / PAGE_SIZE)

  const filtered = allShipments.filter((s) => {
    const matchesStatus = statusFilter === 'All' || effectiveStatus(s) === statusFilter
    const q = search.toLowerCase()
    const matchesSearch =
      (s.order_number ?? '').toLowerCase().includes(q) ||
      (s.customer_name ?? '').toLowerCase().includes(q) ||
      (s.tracking_number ?? '').toLowerCase().includes(q)
    return matchesStatus && matchesSearch
  })

  const selectedShipment = allShipments.find(s => s.id === menuAnchor?.id)
  const cancelMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/shipments/${id}/status`, { status: 'Exception' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['shipments'] }),
  })
  const refreshMutation = useMutation({
    mutationFn: (id: string) => api.post(`/shipments/${id}/track`).then(r => r.data.data),
    onSuccess: (updated: Shipment) => {
      queryClient.invalidateQueries({ queryKey: ['shipments'] })
      setDetailShipment(prev => (prev && prev.id === updated.id ? updated : prev))
      toast.success(`Tracking updated: ${updated.tracking_status ?? updated.status}`)
    },
    onError: (err: any) => toast.error(err.response?.data?.message ?? 'Could not refresh tracking'),
  })
  // Refresh live tracking for every shipment on the current page (that has a tracking #).
  const refreshAllMutation = useMutation({
    mutationFn: async () => {
      const targets = allShipments.filter(s => s.tracking_number)
      const results = await Promise.allSettled(targets.map(s => api.post(`/shipments/${s.id}/track`)))
      return { ok: results.filter(r => r.status === 'fulfilled').length, total: targets.length }
    },
    onSuccess: ({ ok, total }) => {
      queryClient.invalidateQueries({ queryKey: ['shipments'] })
      toast.success(`Refreshed ${ok}/${total} shipments`)
    },
    onError: () => toast.error('Could not refresh tracking'),
  })
  const voidMutation = useMutation({
    mutationFn: (id: string) => api.post(`/shipments/${id}/void-label`).then(r => r.data.data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['shipments'] }); toast.success('Label void requested') },
    onError: (err: any) => toast.error(err.response?.data?.message ?? 'Could not void label'),
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

  const isDelivered = (s: Shipment) => effectiveStatus(s).toUpperCase().includes('DELIVER')
  const isTransit = (s: Shipment) => effectiveStatus(s).toUpperCase().includes('TRANSIT')
  // Promised delivery date: the original ETA if known, else the current estimate.
  const promisedEta = (s: Shipment) => s.original_eta || s.estimated_delivery
  const todayStr = new Date().toISOString().slice(0, 10)
  const isOnTime = (s: Shipment) => {
    const eta = promisedEta(s)
    return Boolean(s.delivered_date && eta && s.delivered_date <= eta)
  }
  const isDelayed = (s: Shipment) => {
    const eta = promisedEta(s)
    if (!eta) return false
    if (s.delivered_date) return s.delivered_date > eta          // delivered late
    return !isDelivered(s) && todayStr > eta                     // overdue, still not delivered
  }
  // Prefer the server-side aggregate (all shipments); fall back to page-computed.
  const stats = statsData ? {
    total: statsData.total,
    active: statsData.active,
    inTransit: statsData.in_transit,
    delivered: statsData.delivered,
    onTime: statsData.on_time,
    delayed: statsData.delayed,
    needsAttention: statsData.needs_attention,
  } : {
    total,
    active: allShipments.filter(s => !isDelivered(s)).length,
    inTransit: allShipments.filter(s => isTransit(s)).length,
    delivered: allShipments.filter(s => isDelivered(s)).length,
    onTime: allShipments.filter(isOnTime).length,
    delayed: allShipments.filter(isDelayed).length,
    needsAttention: allShipments.filter(s => effectiveStatus(s).toUpperCase().match(/FAIL|EXCEPTION|RETURN/)).length,
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
        <button className="lb-action-btn" onClick={() => setShowLabel(true)}>
          <Tag size={13} /> Create Label
        </button>
        <button className="lb-action-btn" onClick={() => setShowImport(true)}>
          <Upload size={13} /> Import CSV
        </button>
        <button
          className="lb-action-btn"
          onClick={() => refreshAllMutation.mutate()}
          disabled={refreshAllMutation.isPending || allShipments.length === 0}
        >
          <RefreshCw size={13} /> {refreshAllMutation.isPending ? 'Refreshing…' : 'Refresh All'}
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
              <th>Ship Date</th>
              <th>Tracking ID</th>
              <th>Customer Name</th>
              <th>PO #</th>
              <th>Carrier</th>
              <th>Service Type</th>
              <th>Ship-To Address</th>
              <th>City</th>
              <th>State</th>
              <th>Postal Code</th>
              <th>Status</th>
              <th>Last Scan City</th>
              <th>Last Scan State</th>
              <th>Estimated Delivery</th>
              <th>Delivered Date</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={16} className="sh-empty">Loading…</td>
              </tr>
            )}
            {!isLoading && filtered.length === 0 && (
              <tr>
                <td colSpan={16} className="sh-empty">No shipments found.</td>
              </tr>
            )}
            {!isLoading && filtered.map(s => (
              <tr key={s.id} className="sh-row" style={{ cursor: 'pointer' }} onClick={() => setDetailShipment(s)}>
                <td className="sh-muted">{s.ship_date ?? '-'}</td>
                <td><span className="sh-awb">{s.tracking_number ?? '-'}</span></td>
                <td className="sh-customer">{s.customer_name ?? '-'}</td>
                <td className="sh-muted">{s.po_number ?? '-'}</td>
                <td className="sh-muted">{s.carrier ?? '-'}</td>
                <td className="sh-muted">{s.service_type ?? '-'}</td>
                <td className="sh-muted">{s.address ?? '-'}</td>
                <td className="sh-muted">{s.ship_to_city ?? '-'}</td>
                <td className="sh-muted">{s.ship_to_state ?? '-'}</td>
                <td className="sh-muted">{s.ship_to_postal_code ?? '-'}</td>
                <td>
                  <span className={cn('sh-status', statusClass(effectiveStatus(s)))}>
                    {effectiveStatus(s)}
                  </span>
                </td>
                <td className="sh-muted">{s.last_scan_city ?? '-'}</td>
                <td className="sh-muted">{s.last_scan_state ?? '-'}</td>
                <td className="sh-muted">{s.estimated_delivery ?? '-'}</td>
                <td className="sh-muted">{s.delivered_date ?? '-'}</td>
                <td onClick={e => e.stopPropagation()}>
                  <button
                    className="lb-icon-btn"
                    onClick={e => { e.stopPropagation(); setMenuAnchor({ el: e.currentTarget, id: s.id }) }}
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
        <MenuItem onClick={() => { if (selectedShipment) setDetailShipment(selectedShipment); setMenuAnchor(null) }}>View Details</MenuItem>
        <MenuItem
          disabled={refreshMutation.isPending}
          onClick={() => { if (menuAnchor?.id) refreshMutation.mutate(menuAnchor.id); setMenuAnchor(null) }}
        >
          Refresh Tracking
        </MenuItem>
        {selectedShipment?.label_url && (
          <MenuItem onClick={() => { window.open(selectedShipment.label_url!, '_blank'); setMenuAnchor(null) }}>Download Label</MenuItem>
        )}
        <MenuItem onClick={() => { if (selectedShipment) printShipment(selectedShipment); setMenuAnchor(null) }}>Print Summary</MenuItem>
        {selectedShipment?.label_status === 'PURCHASED' && (
          <MenuItem
            onClick={() => { if (menuAnchor?.id && window.confirm('Void / refund this label?')) voidMutation.mutate(menuAnchor.id); setMenuAnchor(null) }}
            style={{ color: '#b45309' }}
          >
            Void Label
          </MenuItem>
        )}
        <MenuItem onClick={() => { if (menuAnchor?.id) cancelMutation.mutate(menuAnchor.id); setMenuAnchor(null) }} style={{ color: '#ef4444' }}>Cancel Shipment</MenuItem>
      </Menu>

      <ShipmentDetailDialog
        shipment={detailShipment}
        onClose={() => setDetailShipment(null)}
        onRefresh={id => refreshMutation.mutate(id)}
        refreshing={refreshMutation.isPending}
      />

      {showImport && <ShipmentImportModal onClose={() => setShowImport(false)} />}
      {showLabel && <LabelModal onClose={() => setShowLabel(false)} />}
    </div>
  )
}

// ─── Detail dialog: full Shippo fields + scan-by-scan tracking timeline ──────

const fmtLoc = (c?: string | null, st?: string | null, zip?: string | null) =>
  [c, st, zip].filter(Boolean).join(', ') || '—'

function ShipmentDetailDialog({ shipment, onClose, onRefresh, refreshing }: {
  shipment: Shipment | null
  onClose: () => void
  onRefresh: (id: string) => void
  refreshing: boolean
}) {
  if (!shipment) return null
  const s = shipment
  const rows: [string, string][] = [
    ['Shipment #', s.shipment_number],
    ['Order #', s.order_number ?? '—'],
    ['PO #', s.po_number ?? '—'],
    ['Customer', s.customer_name ?? '—'],
    ['Carrier', s.carrier ?? '—'],
    ['Service', s.service_type ?? '—'],
    ['Tracking #', s.tracking_number ?? '—'],
    ['Status', effectiveStatus(s)],
    ['Sub-status', s.substatus ?? '—'],
    ['Details', s.status_details ?? '—'],
    ['From', fmtLoc(s.address_from_city, s.address_from_state, s.address_from_postal_code)],
    ['Ship To', fmtLoc(s.ship_to_city, s.ship_to_state, s.ship_to_postal_code)],
    ['Last Scan', fmtLoc(s.last_scan_city, s.last_scan_state)],
    ['Original ETA', s.original_eta ?? '—'],
    ['Estimated Delivery', s.estimated_delivery ?? '—'],
    ['Delivered', s.delivered_date ?? '—'],
    ['Last Synced', s.tracking_synced_at ? new Date(s.tracking_synced_at).toLocaleString() : 'Never'],
  ]
  const history = Array.isArray(s.tracking_history) ? s.tracking_history : []

  return (
    <Drawer anchor="right" open={Boolean(shipment)} onClose={onClose}>
      <div style={{ padding: 24, width: 'min(560px, 100vw)', boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Shipment {s.shipment_number}</h3>
          <div style={{ display: 'flex', gap: 8 }}>
            {s.label_url && (
              <button className="lb-action-btn" onClick={() => window.open(s.label_url!, '_blank')}>Download Label</button>
            )}
            <button
              className="lb-action-btn lb-action-primary"
              disabled={refreshing || !s.tracking_number}
              onClick={() => onRefresh(s.id)}
              title={!s.tracking_number ? 'Add a tracking number first' : 'Pull latest status from Shippo'}
            >
              <RefreshCw size={14} /> {refreshing ? 'Refreshing…' : 'Refresh Tracking'}
            </button>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 24px', marginBottom: 20 }}>
          {rows.map(([label, val]) => (
            <div key={label} style={{ display: 'flex', gap: 8, fontSize: 13 }}>
              <span style={{ color: '#64748b', minWidth: 130 }}>{label}</span>
              <span style={{ fontWeight: 500, wordBreak: 'break-word' }}>{val}</span>
            </div>
          ))}
        </div>

        <h4 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Tracking Timeline</h4>
        {history.length === 0 ? (
          <p style={{ color: '#94a3b8', fontSize: 13 }}>
            No scan history yet. Click “Refresh Tracking” to pull the latest from Shippo.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {history.slice().reverse().map((h, i) => (
              <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <MapPin size={15} style={{ color: '#0ea5e9', marginTop: 2, flexShrink: 0 }} />
                <div style={{ fontSize: 13 }}>
                  <div style={{ fontWeight: 600 }}>
                    {h.status ?? '—'}{h.substatus ? ` · ${h.substatus}` : ''}
                  </div>
                  {h.status_details && <div style={{ color: '#475569' }}>{h.status_details}</div>}
                  <div style={{ color: '#94a3b8' }}>
                    {fmtLoc(h.location?.city, h.location?.state, h.location?.zip)}
                    {h.status_date ? ` — ${new Date(h.status_date).toLocaleString()}` : ''}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Drawer>
  )
}
