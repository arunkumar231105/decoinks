import { useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { useColumnDrag } from '../hooks/useColumnDrag'
import { ColumnHideMenu } from '../components/ColumnHideMenu'
import { ColumnFreezeField } from '../components/ColumnFreezeField'
import '../styles/shipment-filters.css'
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
  MapPin,
  MoreVertical,
  Package,
  Plus,
  RefreshCw,
  Search,
  ArrowDown,
  ArrowDownUp,
  ArrowUp,
  Tag,
  Truck,
  Upload,
} from 'lucide-react'

// index.css is protected, so the header button carries its own reset.
const SORT_BTN: React.CSSProperties = {
  border: 0, background: 'none', padding: 0, color: 'inherit', font: 'inherit',
  fontWeight: 'inherit', textTransform: 'inherit', display: 'flex',
  alignItems: 'center', gap: 4, cursor: 'pointer', width: '100%', whiteSpace: 'nowrap',
}
import { Menu, MenuItem, Drawer } from '@mui/material'
import { useQuery, keepPreviousData, useMutation, useQueryClient } from '@tanstack/react-query'
import { cn } from '../utils/cn'
import { api } from '../services/api'
import toast from '../utils/toast'
import { downloadCsv, printPanel } from '../utils/actions'
import { periodRange, toIsoDate, type PeriodKey } from '../utils/period'
import { PeriodTabs } from '../components/PeriodTabs'
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
  supplier_name?: string | null
  ship_source?: string | null
  allocated_count?: number | null
  weight_lbs?: number | null
  is_return?: boolean | null
  notes?: string | null
  created_at?: string | null
}

// A delivery date the way a person says it: 4 Sep 26.
//
// Split rather than parsed. These are DATE columns and arrive as 2026-09-08,
// which new Date() reads as midnight UTC — west of Greenwich that formats as
// the 7th, so a promise made for Tuesday would read as Monday.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const fmtDay = (value?: string | null) => {
  const m = String(value ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return value || '-'
  const [, year, month, day] = m
  return `${Number(day)} ${MONTHS[Number(month) - 1] ?? month} ${year.slice(2)}`
}

// The effective status a row shows: live carrier/Shippo status if present,
// otherwise the internal workflow status.
const effectiveStatus = (s: Shipment) => s.tracking_status || s.status || '-'

// The stage a parcel is at, as the Status filter and the cards count it. The
// carrier's word wins when Shippo has one; before the first scan the shop's own
// status stands in. Pre Transit — a label made, waiting for the carrier's first
// scan — is a stage of its own and not a kind of in transit: the In Transit
// card used to match "TRANSIT" inside "PRE_TRANSIT" and counted both.
const STAGES = ['Pending', 'Pre Transit', 'In Transit', 'Delivered', 'Failure', 'Returned'] as const
type Stage = typeof STAGES[number]
const stageOf = (s: Shipment): Stage => {
  switch ((s.tracking_status || '').trim().toUpperCase()) {
    case 'DELIVERED': return 'Delivered'
    case 'TRANSIT': return 'In Transit'
    case 'PRE_TRANSIT': return 'Pre Transit'
    case 'FAILURE': return 'Failure'
    case 'RETURNED': return 'Returned'
  }
  switch (s.status) {
    case 'Delivered': return 'Delivered'
    case 'In Transit': case 'Picked Up': return 'In Transit'
    case 'Label Created': return 'Pre Transit'
    case 'Exception': return 'Failure'
    default: return 'Pending'
  }
}

// Promised delivery date: the original ETA if known, else the current estimate.
const promisedEta = (s: Shipment) => s.original_eta || s.estimated_delivery
const isOnTime = (s: Shipment) => {
  const eta = promisedEta(s)
  return Boolean(s.delivered_date && eta && s.delivered_date <= eta)
}
const isDelayed = (s: Shipment, today: string) => {
  const eta = promisedEta(s)
  if (!eta) return false
  if (s.delivered_date) return s.delivered_date > eta             // delivered late
  return stageOf(s) !== 'Delivered' && today > eta                // overdue, still not delivered
}

const NO_FILTERS = { stage: 'All', timing: 'All', carrier: 'All', service: 'All', customer: 'All', state: 'All' }
type Filters = typeof NO_FILTERS

// The export file: the same readable columns the server's export has always
// used, taken from the rows the filters leave.
const EXPORT_COLUMNS: ReadonlyArray<readonly [string, (s: Shipment) => unknown]> = [
  ['Shipment No', s => s.shipment_number], ['Ship Date', s => s.ship_date],
  ['Stage', s => stageOf(s)], ['Status', s => effectiveStatus(s)], ['Tracking Status', s => s.tracking_status],
  ['Details', s => s.status_details], ['Carrier', s => s.carrier], ['Service Type', s => s.service_type],
  ['Tracking No', s => s.tracking_number],
  ['Customer Name', s => s.customer_name], ['Recipient Name', s => s.recipient_name],
  ['Ship To Address', s => (s.address ?? '').trim() || s.po_shipping_address], ['Ship To City', s => s.ship_to_city],
  ['Ship To State', s => s.ship_to_state], ['Ship To Postal Code', s => s.ship_to_postal_code],
  ['Order No', s => s.order_number], ['PO No', s => s.po_number],
  ['Orders On Parcel', s => s.allocated_count],
  ['Supplier', s => s.supplier_name], ['Ship Source', s => s.ship_source],
  ['Weight (lbs)', s => s.weight_lbs], ['Shipping Cost', s => s.shipping_cost],
  ['Estimated Delivery', s => s.estimated_delivery], ['Original ETA', s => s.original_eta],
  ['Delivered Date', s => s.delivered_date],
  ['Last Scan City', s => s.last_scan_city], ['Last Scan State', s => s.last_scan_state],
  ['Is Return', s => s.is_return], ['Notes', s => s.notes], ['Created At', s => s.created_at],
]

// The courier's line can run long ("ARRIVED AT USPS REGIONAL FACILITY"), so the
// cell holds one line and the full text — details and the sub-status sentence
// behind it — is on hover. index.css is protected, so this rides here.
const DETAILS_CELL: React.CSSProperties = {
  maxWidth: 190, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
}

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
  const [filters, setFilters] = useState<Filters>(NO_FILTERS)
  const setFilter = (key: keyof Filters, value: string) => { setFilters(f => ({ ...f, [key]: value })); setPage(1) }
  const [period, setPeriod] = useState<PeriodKey>('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  // Newest ship date first by default, matching the other modules; the SHP
  // series is one pick away for reading the list in sequence.
  const [sortBy, setSortBy] = useState<'date_desc' | 'date_asc' | 'num_desc' | 'num_asc'>('date_desc')
  const [colSort, setColSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(null)
  // Header label -> the value that column shows, so a click sorts by what is
  // on screen. Status is derived, not stored.
  const SORT_COLUMNS: ReadonlyArray<readonly [string, (s: Shipment) => any]> = [
    ['Ship Date', s => s.ship_date], ['Customer Name', s => s.customer_name],
    ['PO #', s => s.po_number], ['Carrier', s => s.carrier],
    ['Service Type', s => s.service_type], ['Ship-To Address', s => s.address],
    ['City', s => s.ship_to_city], ['State', s => s.ship_to_state],
    ['Postal Code', s => s.ship_to_postal_code], ['Status', s => effectiveStatus(s)],
    // TRANSIT says the parcel is moving; it does not say whether it is sitting
    // in a hub or already on the van. That is the courier's own line — "Loaded
    // on Delivery Vehicle", "On the Way", "Out For Delivery" — and it was only
    // readable by opening the row, so it goes next to the status it explains.
    ['Details', s => s.status_details],
    ['Last Scan City', s => s.last_scan_city], ['Last Scan State', s => s.last_scan_state],
    ['Estimated Delivery', s => s.estimated_delivery], ['Delivered Date', s => s.delivered_date],
    ['Tracking ID', s => s.tracking_number],
  ]
  // What each column draws, by the same label. The columns can be dragged into
  // another order by their headers (hooks/useColumnDrag).
  const CELLS: Record<string, { className?: string; style?: CSSProperties; title?: (s: Shipment) => string | undefined; render: (s: Shipment) => ReactNode }> = {
    'Ship Date': { className: 'sh-muted', render: s => s.ship_date ?? '-' },
    'Customer Name': { className: 'sh-customer', render: s => s.customer_name ?? '-' },
    'PO #': { className: 'sh-muted', render: s => s.po_number ?? '-' },
    'Carrier': { className: 'sh-muted', render: s => s.carrier ?? '-' },
    'Service Type': { className: 'sh-muted', render: s => s.service_type ?? '-' },
    'Ship-To Address': { className: 'sh-muted', render: s => s.address ?? '-' },
    'City': { className: 'sh-muted', render: s => s.ship_to_city ?? '-' },
    'State': { className: 'sh-muted', render: s => s.ship_to_state ?? '-' },
    'Postal Code': { className: 'sh-muted', render: s => s.ship_to_postal_code ?? '-' },
    'Status': { render: s => <span className={cn('sh-status', statusClass(effectiveStatus(s)))}>{effectiveStatus(s)}</span> },
    'Details': { className: 'sh-muted', style: DETAILS_CELL,
      title: s => [s.status_details, s.substatus].filter(Boolean).join(' — ') || undefined,
      render: s => s.status_details ?? '-' },
    'Last Scan City': { className: 'sh-muted', render: s => s.last_scan_city ?? '-' },
    'Last Scan State': { className: 'sh-muted', render: s => s.last_scan_state ?? '-' },
    'Estimated Delivery': { className: 'sh-muted', render: s => fmtDay(s.estimated_delivery) },
    'Delivered Date': { className: 'sh-muted', render: s => s.delivered_date ?? '-' },
    'Tracking ID': { render: s => <span className="sh-awb">{s.tracking_number ?? '-'}</span> },
  }
  // Shipments starts with no column frozen; the filter bar sets how many.
  const columnDrag = useColumnDrag(SORT_COLUMNS.map(([label]) => label), { frozen: 0 })
  const [menuAnchor, setMenuAnchor] = useState<{ el: HTMLElement; id: string } | null>(null)
  const [detailShipment, setDetailShipment] = useState<Shipment | null>(null)
  const [showImport, setShowImport] = useState(false)
  const [showLabel, setShowLabel] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['shipments', 'all'],
    queryFn: () => api.get('/shipments', { params: { page: 1, limit: 1000 } }).then(r => r.data.data),
    placeholderData: keepPreviousData,
    // The courier sync runs every ten minutes; this picks up what it brought
    // without anyone reloading the page.
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  })

  const allShipments: Shipment[] = data?.rows ?? []

  // The chosen range as two dates. Empty ends mean no bound, which is what
  // "All Time" resolves to; Custom takes the two dates in the filter bar.
  const [periodFrom, periodTo] = periodRange(period, dateFrom, dateTo)
  const todayStr = toIsoDate(new Date())

  // What each dropdown offers comes from every parcel on file, so a choice
  // never disappears from its own list once another filter is set.
  const choices = useMemo(() => {
    const unique = (pick: (s: Shipment) => string | null | undefined) =>
      [...new Set(allShipments.map(s => (pick(s) ?? '').trim()).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b))
    return {
      carriers: unique(s => s.carrier), services: unique(s => s.service_type),
      customers: unique(s => s.customer_name), states: unique(s => s.ship_to_state?.toUpperCase()),
    }
  }, [allShipments])

  // Every filter but Stage. The cards and the counts beside each stage are
  // taken from these rows, so choosing In Transit narrows the table to the
  // parcels on the move while the cards still say how many sit at every stage.
  const q = search.trim().toLowerCase()
  const scoped = allShipments.filter((s) => {
    const matchesSearch = !q || [s.shipment_number, s.order_number, s.po_number, s.customer_name, s.tracking_number]
      .some(v => (v ?? '').toLowerCase().includes(q))
    // A parcel with no ship date has no place in a dated range, so it shows
    // only when no range is set rather than being quietly counted in every one.
    const day = (s.ship_date ?? '').slice(0, 10)
    const matchesPeriod =
      (!periodFrom && !periodTo) ||
      (!!day && (!periodFrom || day >= periodFrom) && (!periodTo || day <= periodTo))
    const same = (value: string | null | undefined, chosen: string) =>
      chosen === 'All' || (value ?? '').trim().toUpperCase() === chosen.toUpperCase()
    const matchesTiming = filters.timing === 'All'
      || (filters.timing === 'On Time' ? isOnTime(s) : isDelayed(s, todayStr))
    return matchesSearch && matchesPeriod && matchesTiming
      && same(s.carrier, filters.carrier) && same(s.service_type, filters.service)
      && same(s.customer_name, filters.customer) && same(s.ship_to_state, filters.state)
  })
  const stageCounts = Object.fromEntries(STAGES.map(st => [st, 0])) as Record<Stage, number>
  for (const s of scoped) stageCounts[stageOf(s)]++
  const filtered = filters.stage === 'All' ? scoped : scoped.filter(s => stageOf(s) === filters.stage)
  const anyFilter = Object.values(filters).some(v => v !== 'All') || Boolean(q) || period !== 'all'
  const clearFilters = () => {
    setFilters(NO_FILTERS); setSearch(''); setPeriod('all'); setDateFrom(''); setDateTo('')
    setColSort(null); setPage(1)
  }

  // Rows with no value for the chosen key stay at the bottom either way, rather
  // than jumping to the top of an ascending list.
  const seqOf = (s: Shipment) => {
    const m = String(s.shipment_number ?? '').match(/(\d+)\s*$/)
    return m ? Number(m[1]) : null
  }
  const sortedAll = [...filtered].sort((a, b) => {
    if (colSort) {
      const col = SORT_COLUMNS.find(([label]) => label === colSort.key)
      if (col) {
        const x = col[1](a), y = col[1](b)
        const xb = x === null || x === undefined || x === ''
        const yb = y === null || y === undefined || y === ''
        if (xb && yb) return 0
        if (xb) return 1                      // blanks stay at the bottom both ways
        if (yb) return -1
        const cmp = String(x).localeCompare(String(y), undefined, { numeric: true, sensitivity: 'base' })
        return colSort.dir === 'asc' ? cmp : -cmp
      }
    }
    if (sortBy === 'num_desc' || sortBy === 'num_asc') {
      const x = seqOf(a), y = seqOf(b)
      if (x === null && y === null) return 0
      if (x === null) return 1
      if (y === null) return -1
      return sortBy === 'num_asc' ? x - y : y - x
    }
    const x = (a.ship_date ?? '').slice(0, 10), y = (b.ship_date ?? '').slice(0, 10)
    if (!x && !y) return 0
    if (!x) return 1
    if (!y) return -1
    return sortBy === 'date_asc' ? x.localeCompare(y) : y.localeCompare(x)
  })
  const total = sortedAll.length
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const rowsToShow = sortedAll.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

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

  // Counted from the rows the filters leave (all but Stage, see `scoped`), so
  // the cards describe the same parcels as the table below them. They used to
  // come from a separate call that knew nothing of the filters.
  const stats = {
    total: scoped.length,
    active: scoped.length - stageCounts.Delivered,
    preTransit: stageCounts['Pre Transit'],
    inTransit: stageCounts['In Transit'],
    delivered: stageCounts.Delivered,
    onTime: scoped.filter(isOnTime).length,
    delayed: scoped.filter(s => isDelayed(s, todayStr)).length,
    needsAttention: stageCounts.Failure + stageCounts.Returned,
  }

  // Every parcel the filters leave, in the order the table shows — every page
  // of it, not only the ten on screen. Made here rather than by /shipments/export
  // because the filters live on this page and the server knows none of them.
  const exportAll = () => downloadCsv(`shipments-${todayStr}.csv`,
    sortedAll.map(s => Object.fromEntries(EXPORT_COLUMNS.map(([head, get]) => [head, get(s) ?? '']))))

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
        <button className="lb-action-btn" onClick={() => setShowLabel(true)}>
          <Tag size={13} /> Create Label
        </button>
        <button className="lb-action-btn" onClick={() => setShowImport(true)}>
          <Upload size={13} /> Import CSV
        </button>
        <button className="lb-action-btn" onClick={exportAll}>
          <Download size={13} /> Export
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
          <span>{periodFrom || periodTo
            ? `${fmtDay(periodFrom)} – ${fmtDay(periodTo)}`
            : 'All dates'}</span>
        </div>
      </div>

      <PeriodTabs className="leads-period" period={period}
        onChange={p => { setPeriod(p); setPage(1) }} />

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
          <div className="sh-stat-icon sh-stat-icon-amber"><Tag size={18} /></div>
          <div>
            <span>Pre Transit</span>
            <strong>{stats.preTransit}</strong>
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

      {/* Filters */}
      <section className="sh-filters" aria-label="Shipment filters">
        <label><span>Stage</span>
          <select value={filters.stage} onChange={e => setFilter('stage', e.target.value)}>
            <option value="All">All stages ({scoped.length})</option>
            {STAGES.map(st => <option key={st} value={st}>{st} ({stageCounts[st]})</option>)}
          </select>
        </label>
        <label><span>Delivery</span>
          <select value={filters.timing} onChange={e => setFilter('timing', e.target.value)}>
            <option value="All">All</option>
            <option value="On Time">Delivered on time</option>
            <option value="Delayed">Delayed or overdue</option>
          </select>
        </label>
        <label><span>Carrier</span>
          <select value={filters.carrier} onChange={e => setFilter('carrier', e.target.value)}>
            <option value="All">All carriers</option>
            {choices.carriers.map(v => <option key={v}>{v}</option>)}
          </select>
        </label>
        <label><span>Service Type</span>
          <select value={filters.service} onChange={e => setFilter('service', e.target.value)}>
            <option value="All">All services</option>
            {choices.services.map(v => <option key={v}>{v}</option>)}
          </select>
        </label>
        <label><span>Customer</span>
          <select value={filters.customer} onChange={e => setFilter('customer', e.target.value)}>
            <option value="All">All customers</option>
            {choices.customers.map(v => <option key={v}>{v}</option>)}
          </select>
        </label>
        <label><span>Ship-To State</span>
          <select value={filters.state} onChange={e => setFilter('state', e.target.value)}>
            <option value="All">All states</option>
            {choices.states.map(v => <option key={v}>{v}</option>)}
          </select>
        </label>
        {period === 'custom' && <>
          <label><span>Ship Date From</span>
            <input type="date" value={dateFrom} max={dateTo || undefined} onChange={e => { setDateFrom(e.target.value); setPage(1) }} />
          </label>
          <label><span>Ship Date To</span>
            <input type="date" value={dateTo} min={dateFrom || undefined} onChange={e => { setDateTo(e.target.value); setPage(1) }} />
          </label>
        </>}
        <label><span>Sort By</span>
          <select aria-label="Sort shipments" value={colSort ? '' : sortBy}
            onChange={e => { setColSort(null); setSortBy(e.target.value as typeof sortBy); setPage(1) }}>
            {colSort && <option value="" disabled>Sorted by {colSort.key}</option>}
            <option value="date_desc">Ship date: newest first</option>
            <option value="date_asc">Ship date: oldest first</option>
            <option value="num_desc">Number: high to low</option>
            <option value="num_asc">Number: low to high</option>
          </select>
        </label>
        <ColumnHideMenu columns={SORT_COLUMNS.map(([label]) => ({ key: label, label }))}
          hidden={columnDrag.hidden} onToggle={columnDrag.toggleHidden} onShowAll={columnDrag.showAll} />
        <ColumnFreezeField value={columnDrag.frozenCount} max={columnDrag.visible.length}
          shown={columnDrag.frozenShown} onChange={columnDrag.setFrozenCount} />
        <button type="button" className="sh-clear" onClick={clearFilters} disabled={!anyFilter}>Clear Filters</button>
      </section>

      {/* Table */}
      <div className="sh-table-wrap">
        <table ref={columnDrag.tableRef} className="sh-table">
          <thead>
            <tr>
              {columnDrag.visible.map((label, i) => (
                <th key={label} {...columnDrag.headProps(label, i)}>
                  <button style={SORT_BTN} aria-label={`Sort by ${label}`}
                    onClick={() => setColSort(c => ({ key: label, dir: c?.key === label && c.dir === 'desc' ? 'asc' : 'desc' }))}>
                    {label} {colSort?.key !== label ? <ArrowDownUp size={11}/> : colSort.dir === 'asc' ? <ArrowUp size={11}/> : <ArrowDown size={11}/>}
                  </button>
                </th>
              ))}
              <th></th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={17} className="sh-empty">Loading…</td>
              </tr>
            )}
            {!isLoading && rowsToShow.length === 0 && (
              <tr>
                <td colSpan={17} className="sh-empty">No shipments found.</td>
              </tr>
            )}
            {!isLoading && rowsToShow.map(s => (
              <tr key={s.id} className="sh-row" style={{ cursor: 'pointer' }} onClick={() => setDetailShipment(s)}>
                {columnDrag.visible.map((label, i) => {
                  const c = CELLS[label]
                  return <td key={label} {...columnDrag.cellProps(label, i, c.style)} className={c.className} title={c.title?.(s)}>{c.render(s)}</td>
                })}
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
    ['Estimated Delivery', s.estimated_delivery ? fmtDay(s.estimated_delivery) : '—'],
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
