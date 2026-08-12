import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft, CheckCircle2, Factory, ClipboardCheck, Search, Truck, Package, PauseCircle,
  UploadCloud, Loader2,
} from 'lucide-react'
import { PageHeader } from '../components/Layout'
import { Panel, Pill, TableStates, fmtDate, dash } from '../components/ui'
import api from '../services/api'

/** The fulfillment milestones, in the order they happen. */
const STEPS = [
  { key: 'Order Confirmed', icon: CheckCircle2 },
  { key: 'Production Started', icon: Factory },
  { key: 'Production Completed', icon: ClipboardCheck },
  { key: 'Quality Check', icon: Search },
  { key: 'Shipped', icon: Truck },
  { key: 'Delivered', icon: Package },
  { key: 'Completed', icon: ClipboardCheck },
] as const

const HOLD_REASONS = [
  'Awaiting artwork approval', 'Artwork issue', 'Stock unavailable',
  'Machine downtime', 'Customer requested hold', 'Payment pending', 'Other',
]

const CARRIERS = ['UPS', 'FedEx', 'USPS', 'DHL', 'Other']

interface OrderInfo {
  id: string
  order_number: string
  po_number?: string | null
  order_type: string
  order_date: string | null
  due_date: string | null
  total_qty?: number | null
  status: string
}

interface HistoryRow {
  id: string
  status: string
  notes: string | null
  created_at: string
  supplier_name?: string | null
  order_number?: string | null
}

export default function StatusUpdatePage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [order, setOrder] = useState<OrderInfo | null>(null)
  const [history, setHistory] = useState<HistoryRow[]>([])
  const [loading, setLoading] = useState(!!id)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null)

  // Order picker (when the screen is opened from the sidebar without an order)
  const [orders, setOrders] = useState<OrderInfo[]>([])

  const [prodStart, setProdStart] = useState('')
  const [prodDone, setProdDone] = useState('')
  const [holdDate, setHoldDate] = useState('')
  const [holdReason, setHoldReason] = useState('')
  const [holdNotes, setHoldNotes] = useState('')
  const [shipDate, setShipDate] = useState('')
  const [tracking, setTracking] = useState('')
  const [carrier, setCarrier] = useState('')
  const [billName, setBillName] = useState('')

  const load = () => {
    if (!id) {
      api.get('/orders', { params: { limit: 100 } })
        .then(r => setOrders(r.data?.orders ?? r.data?.data ?? r.data ?? []))
        .catch(() => setError('Orders could not be loaded.'))
        .finally(() => setLoading(false))
      return
    }
    setLoading(true)
    Promise.all([
      api.get(`/orders/${id}`),
      api.get(`/orders/${id}/status-updates`),
    ])
      .then(([o, h]) => {
        setOrder(o.data?.order ?? o.data?.data ?? o.data)
        setHistory(h.data?.updates ?? h.data?.data ?? h.data ?? [])
        setError(null)
      })
      .catch(() => setError('This order could not be loaded.'))
      .finally(() => setLoading(false))
  }
  useEffect(load, [id])

  /** A milestone is reached once an update with that status exists. */
  const reached = useMemo(() => {
    const map = new Map<string, string>()
    for (const h of history) if (!map.has(h.status)) map.set(h.status, h.created_at)
    return map
  }, [history])

  const activeIndex = useMemo(() => {
    let last = -1
    STEPS.forEach((s, i) => { if (reached.has(s.key)) last = i })
    return last
  }, [reached])

  const submit = async (status: string, notes: string, key: string) => {
    if (!id) return
    setSaving(key)
    setNotice(null)
    try {
      await api.post(`/orders/${id}/status-updates`, { status, notes })
      const h = await api.get(`/orders/${id}/status-updates`)
      setHistory(h.data?.updates ?? h.data?.data ?? h.data ?? [])
      setNotice({ tone: 'ok', text: `${status} recorded.` })
    } catch {
      setNotice({ tone: 'bad', text: 'That update could not be saved. Please try again.' })
    } finally {
      setSaving(null)
    }
  }

  const onProduction = (e: FormEvent) => {
    e.preventDefault()
    if (prodDone) submit('Production Completed', `Production completed on ${prodDone}.`, 'prod')
    else if (prodStart) submit('Production Started', `Production started on ${prodStart}.`, 'prod')
  }
  const onHold = (e: FormEvent) => {
    e.preventDefault()
    submit('On Hold', [`On hold from ${holdDate}.`, `Reason: ${holdReason}.`, holdNotes].filter(Boolean).join(' '), 'hold')
  }
  const onShip = (e: FormEvent) => {
    e.preventDefault()
    submit('Shipped', [`Shipped ${shipDate} via ${carrier}.`, `Tracking ${tracking}.`, billName && `Bill: ${billName}.`].filter(Boolean).join(' '), 'ship')
  }

  /* ── Order picker ─────────────────────────────────────────────────── */
  if (!id) {
    return (
      <>
        <PageHeader title="Status Update" subtitle="Choose an order to track and update its production and fulfillment status." />
        <Panel title={`Orders (${orders.length})`}>
          <div className="fp-table-wrap">
            <table className="w-full min-w-[720px] border-collapse">
              <thead><tr>{['Order ID', 'PO Number', 'Order Type', 'Order Date', 'Due Date', 'Status', ''].map(h => <th key={h} className="fp-th">{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-line">
                <TableStates colSpan={7} loading={loading} error={error} onRetry={load}
                  empty={orders.length === 0} emptyMessage="Orders assigned to you will appear here." />
                {!loading && !error && orders.map(o => (
                  <tr key={o.id} className="cursor-pointer transition-colors hover:bg-brand/[0.04]" onClick={() => navigate(`/status-update/${o.id}`)}>
                    <td className="fp-td"><span className="fp-link">{o.order_number}</span></td>
                    <td className="fp-td">{dash(o.po_number)}</td>
                    <td className="fp-td capitalize">{o.order_type}</td>
                    <td className="fp-td">{fmtDate(o.order_date)}</td>
                    <td className="fp-td">{fmtDate(o.due_date)}</td>
                    <td className="fp-td"><Pill>{o.status}</Pill></td>
                    <td className="fp-td"><span className="fp-link">Update status</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </>
    )
  }

  /* ── Single-order status screen ───────────────────────────────────── */
  return (
    <>
      <PageHeader
        breadcrumb={<><Link to="/" className="hover:underline">Dashboard</Link><span>›</span><span className="font-medium text-ink">Status Update</span></>}
        title="Status Update"
        subtitle="Track and update the production and fulfillment status of the order."
        actions={<Link to="/orders" className="fp-btn"><ArrowLeft size={16} /> Back to Orders</Link>}
      />

      {notice && (
        <div className={`mb-4 rounded-xl px-4 py-3 text-sm ring-1 ring-inset ${
          notice.tone === 'ok' ? 'bg-emerald-50 text-emerald-800 ring-emerald-600/20' : 'bg-rose-50 text-rose-800 ring-rose-600/20'}`}>
          {notice.text}
        </div>
      )}

      {/* Order info bar */}
      <div className="fp-card mb-4 grid grid-cols-2 divide-line md:grid-cols-3 md:divide-x xl:grid-cols-6">
        {[
          { label: 'Purchase Order (PO)', value: <span className="fp-link">{dash(order?.po_number)}</span> },
          { label: 'Order ID', value: <Link to={`/orders/${id}`} className="fp-link">{dash(order?.order_number)}</Link> },
          { label: 'Order Type', value: <span className="capitalize">{dash(order?.order_type)}</span> },
          { label: 'Order Date', value: fmtDate(order?.order_date) },
          { label: 'Due Date', value: fmtDate(order?.due_date) },
          { label: 'Total Qty', value: dash(order?.total_qty) },
        ].map(f => (
          <div key={f.label} className="px-5 py-4">
            <div className="text-[12px] text-muted">{f.label}</div>
            <div className="mt-1 truncate text-[15px] font-semibold text-ink">{loading ? <span className="fp-skeleton block h-5 w-24" /> : f.value}</div>
          </div>
        ))}
      </div>

      {/* Progress stepper */}
      <Panel title="Order Status Progress" className="mb-4">
        <div className="overflow-x-auto px-5 py-6">
          <ol className="flex min-w-[760px] items-start">
            {STEPS.map((s, i) => {
              const done = i <= activeIndex
              const isCurrent = i === activeIndex
              const Icon = s.icon
              return (
                <li key={s.key} className="flex flex-1 flex-col items-center">
                  <div className="flex w-full items-center">
                    <span className={`h-[3px] flex-1 rounded ${i === 0 ? 'bg-transparent' : done ? 'bg-emerald-500' : 'bg-slate-200'}`} />
                    <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-full ring-4 ring-white ${
                      isCurrent ? 'bg-brand text-white' : done ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-slate-400'}`}>
                      <Icon size={20} />
                    </span>
                    <span className={`h-[3px] flex-1 rounded ${i === STEPS.length - 1 ? 'bg-transparent' : i < activeIndex ? 'bg-emerald-500' : 'bg-slate-200'}`} />
                  </div>
                  <span className={`mt-2 text-center text-[13px] font-semibold ${
                    isCurrent ? 'text-brand' : done ? 'text-emerald-600' : 'text-muted'}`}>{s.key}</span>
                  <span className="text-xs text-muted">{reached.get(s.key) ? fmtDate(reached.get(s.key)!) : '--'}</span>
                </li>
              )
            })}
          </ol>
        </div>
      </Panel>

      {/* Action cards */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* 1 — Production */}
        <form onSubmit={onProduction} className="fp-card flex flex-col bg-sky-50/40 p-5">
          <h3 className="flex items-center gap-2.5 text-[15px] font-bold text-brand">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand text-white"><Factory size={17} /></span>
            1. Production (Start &amp; Completion)
          </h3>
          <p className="mt-2 text-[13px] text-muted">Update the start date when production begins and the completion date when it is finished.</p>
          <label className="mt-4 block"><span className="fp-label">Production Start Date *</span>
            <input type="date" className="fp-input" value={prodStart} onChange={e => setProdStart(e.target.value)} required />
          </label>
          <label className="mt-3 block"><span className="fp-label">Production Completion Date</span>
            <input type="date" className="fp-input" value={prodDone} onChange={e => setProdDone(e.target.value)} min={prodStart || undefined} />
          </label>
          <button className="fp-btn fp-btn-primary mt-auto w-full !mt-5" disabled={saving === 'prod' || !prodStart}>
            {saving === 'prod' ? <Loader2 size={16} className="animate-spin" /> : null} Update Production Status
          </button>
        </form>

        {/* 2 — On hold */}
        <form onSubmit={onHold} className="fp-card flex flex-col bg-amber-50/40 p-5">
          <h3 className="flex items-center gap-2.5 text-[15px] font-bold text-orange-600">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-orange-500 text-white"><PauseCircle size={17} /></span>
            2. On Hold
          </h3>
          <p className="mt-2 text-[13px] text-muted">Put the order on hold and provide the reason.</p>
          <label className="mt-4 block"><span className="fp-label">On Hold Date *</span>
            <input type="date" className="fp-input" value={holdDate} onChange={e => setHoldDate(e.target.value)} required />
          </label>
          <label className="mt-3 block"><span className="fp-label">Reason for Hold *</span>
            <select className="fp-input" value={holdReason} onChange={e => setHoldReason(e.target.value)} required>
              <option value="">Select a reason</option>
              {HOLD_REASONS.map(r => <option key={r}>{r}</option>)}
            </select>
          </label>
          <label className="mt-3 block"><span className="fp-label">Additional Details (Optional)</span>
            <textarea className="fp-input h-24 py-2.5" maxLength={500} placeholder="Enter additional details…"
              value={holdNotes} onChange={e => setHoldNotes(e.target.value)} />
            <span className="mt-1 block text-right text-xs text-muted">{holdNotes.length}/500</span>
          </label>
          <button className="mt-auto w-full rounded-lg bg-orange-500 px-4 py-3 text-sm font-semibold text-white transition hover:bg-orange-600 disabled:opacity-50"
            disabled={saving === 'hold' || !holdDate || !holdReason}>
            {saving === 'hold' ? 'Saving…' : 'Hold Order'}
          </button>
        </form>

        {/* 3 — Shipment */}
        <form onSubmit={onShip} className="fp-card flex flex-col bg-violet-50/40 p-5">
          <h3 className="flex items-center gap-2.5 text-[15px] font-bold text-violet-700">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-violet-600 text-white"><Truck size={17} /></span>
            3. Shipment
          </h3>
          <p className="mt-2 text-[13px] text-muted">Update shipment details for the order.</p>
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block"><span className="fp-label">Shipment Date *</span>
              <input type="date" className="fp-input" value={shipDate} onChange={e => setShipDate(e.target.value)} required />
            </label>
            <label className="block"><span className="fp-label">Tracking Number *</span>
              <input className="fp-input" placeholder="Enter tracking number" value={tracking} onChange={e => setTracking(e.target.value)} required />
            </label>
          </div>
          <label className="mt-3 block"><span className="fp-label">Carrier / Courier *</span>
            <select className="fp-input" value={carrier} onChange={e => setCarrier(e.target.value)} required>
              <option value="">Select carrier</option>
              {CARRIERS.map(c => <option key={c}>{c}</option>)}
            </select>
          </label>
          <label className="mt-3 block"><span className="fp-label">Shipping Bill / Invoice</span>
            <div className="flex cursor-pointer flex-col items-center gap-1 rounded-xl border-2 border-dashed border-line bg-white px-4 py-6 text-center transition hover:border-brand/40">
              <UploadCloud size={22} className="text-brand" />
              <span className="text-[13px] font-medium text-ink">Click to upload or drag and drop</span>
              <span className="text-xs text-muted">{billName || 'PDF, JPG, PNG (max. 10 MB)'}</span>
              <input type="file" accept=".pdf,.jpg,.jpeg,.png" className="sr-only"
                onChange={e => setBillName(e.target.files?.[0]?.name ?? '')} />
            </div>
          </label>
          <button className="mt-auto w-full rounded-lg bg-violet-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-violet-700 disabled:opacity-50 !mt-5"
            disabled={saving === 'ship' || !shipDate || !tracking || !carrier}>
            {saving === 'ship' ? 'Saving…' : 'Mark as Shipped'}
          </button>
        </form>
      </div>

      {/* History */}
      <Panel title="Status Update History" className="mt-4">
        <div className="fp-table-wrap">
          <table className="w-full min-w-[760px] border-collapse">
            <thead><tr>{['Date & Time', 'Order No.', 'Action', 'By', 'Comments'].map(h => <th key={h} className="fp-th">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-line">
              <TableStates colSpan={5} loading={loading} error={error} onRetry={load} rows={4}
                empty={history.length === 0} emptyMessage="Status updates you record will be listed here." />
              {!loading && !error && history.map(h => (
                <tr key={h.id}>
                  <td className="fp-td whitespace-nowrap">{new Date(h.created_at).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}</td>
                  <td className="fp-td">{dash(h.order_number ?? order?.order_number)}</td>
                  <td className="fp-td"><Pill>{h.status}</Pill></td>
                  <td className="fp-td">{dash(h.supplier_name)}</td>
                  <td className="fp-td whitespace-normal text-muted">{dash(h.notes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  )
}
