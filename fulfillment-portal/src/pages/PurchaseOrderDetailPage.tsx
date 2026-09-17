import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import StageEditor from '../components/fulfillment/StageEditor'
import { STAGE_TONE, type GridRow } from '../components/fulfillment/stages'
import { ArrowLeft, Download, Truck } from 'lucide-react'
import api from '../services/api'
import { cn } from '../utils/cn'
import { fmtDate, assetUrl, SafeImg } from '../components/ui'

// ── PO status transitions available to the supplier role ─────────────────────
// Mirrors backend PO_TRANSITIONS for role 'supplier' only.
// Kept local to avoid a shared-utils dependency between the two apps.
const SUPPLIER_PO_TRANSITIONS: Record<string, string[]> = {
  'Sent':          ['Accepted'],
  'Accepted':      ['In Production'],
  'In Production': ['Shipped', 'Partially Received'],
}

const STATUS_BADGE: Record<string, string> = {
  Draft:               'bg-gray-100 text-gray-600',
  'Pending Approval':  'bg-yellow-50 text-yellow-700',
  Approved:            'bg-green-50 text-green-700',
  Sent:                'bg-blue-50 text-blue-700',
  Accepted:            'bg-teal-50 text-teal-700',
  'In Production':     'bg-blue-100 text-blue-800',
  'Partially Received':'bg-orange-50 text-orange-700',
  Shipped:             'bg-purple-50 text-purple-700',
  Received:            'bg-green-50 text-green-800',
  Closed:              'bg-gray-200 text-gray-700',
  Cancelled:           'bg-red-50 text-red-700',
}

interface Item {
  id: string; item_name: string | null; description?: string | null; hsn_code: string | null; uom: string | null
  qty_ordered: number | null; unit_price: number | null; discount_pct: number; tax_pct: number; line_total: number | null
  brand?: string | null; color?: string | null; size?: string | null; style?: string | null; artwork_no?: string | null
  print_type?: string | null; image?: string | null; product_image?: string | null; order_number?: string | null
}

interface Shipment {
  id: string; shipment_number: string | null; carrier: string | null; tracking_number: string | null
  status: string | null; ship_date: string | null; estimated_delivery: string | null; delivered_date: string | null
}

export default function PurchaseOrderDetailPage() {
  const { id }          = useParams()
  const queryClient     = useQueryClient()
  const { t, i18n }     = useTranslation()
  const locale          = i18n.language === 'zh' ? 'zh-CN' : 'en-US'

  const [statusModalOpen, setStatusModalOpen] = useState(false)
  const [newStatus, setNewStatus]             = useState('')
  const [trackingOpen, setTrackingOpen]       = useState(false)
  const [trackingNum, setTrackingNum]         = useState('')
  const [carrier, setCarrier]                 = useState('')
  const [trackingNotes, setTrackingNotes]     = useState('')
  const [preview, setPreview]                 = useState<string | null>(null)

  // ── Queries ──────────────────────────────────────────────────────────────────

  const { data, isLoading } = useQuery({
    queryKey: ['purchase-order', id],
    queryFn: () => api.get(`/purchase-orders/${id}`).then((r) => r.data.po),
    enabled: !!id,
    refetchInterval: 60_000,
  })

  // ── Mutations ────────────────────────────────────────────────────────────────

  // Where it stands in Supplier Order Management: stage, factory, push date.
  const [stageOpen, setStageOpen] = useState(false)
  const orderRow = useQuery({
    queryKey: ['order-row', id],
    queryFn: () => api.get(`/purchase-orders/${id}/stage`).then(r => r.data.row as GridRow),
    enabled: Boolean(id),
    refetchInterval: 60_000,
  })

  const statusMutation = useMutation({
    mutationFn: (status: string) =>
      api.patch(`/purchase-orders/${id}/status`, { status }),
    onSuccess: () => {
      toast.success(t('status.updated'))
      queryClient.invalidateQueries({ queryKey: ['purchase-order', id] })
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] })
      setStatusModalOpen(false)
      setNewStatus('')
    },
    onError: (err: any) =>
      toast.error(err?.response?.data?.error ?? t('status.error')),
  })

  const trackingMutation = useMutation({
    mutationFn: () =>
      api.post(`/purchase-orders/${id}/tracking`, {
        tracking_number: trackingNum.trim() || null,
        carrier:         carrier.trim() || null,
        tracking_notes:  trackingNotes.trim() || null,
      }),
    onSuccess: () => {
      toast.success(t('tracking.saved'))
      queryClient.invalidateQueries({ queryKey: ['purchase-order', id] })
      setTrackingOpen(false)
    },
    onError: (err: any) =>
      toast.error(err?.response?.data?.error ?? t('tracking.error')),
  })

  // ── Helpers ──────────────────────────────────────────────────────────────────

  const fmtMoney = (n: number | string | null | undefined, currency = 'USD') =>
    n != null && n !== ''
      ? Number(n).toLocaleString(locale, { style: 'currency', currency, minimumFractionDigits: 2 })
      : '—'

  // ── Loading / not found ───────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin w-8 h-8 border-2 border-accent border-t-transparent rounded-full" />
      </div>
    )
  }

  if (!data) {
    return (
      <div className="text-center py-16 text-gray-500">
        <p className="text-lg font-medium">{t('po.notFound')}</p>
        <Link to="/purchase-orders" className="text-accent hover:underline text-sm mt-2 inline-block">
          ← {t('common.back')}
        </Link>
      </div>
    )
  }

  const po = data
  const cur = po.currency || 'USD'
  const validTransitions = SUPPLIER_PO_TRANSITIONS[po.status] ?? []
  const items: Item[] = po.items ?? []
  const shipments: Shipment[] = po.shipments ?? []
  // Lines taken from the sales order carry no supplier cost of their own.
  const fromOrder = po.items_source === 'sales_order'

  // Pre-fill tracking form from existing data when opening
  const openTracking = () => {
    setTrackingNum(po.tracking_number ?? '')
    setCarrier(po.carrier ?? '')
    setTrackingNotes(po.tracking_notes ?? '')
    setTrackingOpen(true)
  }

  const itemHeads = fromOrder
    ? ['#', 'Image', t('po.itemName'), 'Style', 'Color', 'Size', t('po.qty'), 'Artwork', 'Order']
    : ['#', 'Image', t('po.itemName'), 'Color / Size', t('po.qty'), t('po.unitPrice'), t('po.discount'), t('po.tax'), t('po.amount')]

  return (
    <div className="space-y-5">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Link to="/purchase-orders" className="hover:text-gray-700">{t('po.title')}</Link>
        <span>/</span>
        <span className="text-gray-900 font-medium">{po.po_number}</span>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">{t('po.details')}</h2>
          <p className="text-sm text-gray-500 mt-1">{t('po.detailSubtitle')}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          {validTransitions.length > 0 && (
            <button
              className="btn-primary flex items-center gap-2"
              onClick={() => { setNewStatus(validTransitions[0]); setStatusModalOpen(true) }}
            >
              {t('status.label')}
            </button>
          )}
          <button className="btn-secondary flex items-center gap-2" onClick={openTracking}>
            <Truck size={14} />
            {t('tracking.title')}
          </button>
          <button className="btn-secondary flex items-center gap-2" onClick={() => window.print()}>
            <Download size={14} />
            {t('common.download')}
          </button>
          <Link to="/purchase-orders" className="btn-secondary flex items-center gap-2">
            <ArrowLeft size={14} />
            {t('common.back')}
          </Link>
        </div>
      </div>

      {/* Order management: stage, factory, push date */}
      {orderRow.data && (
        <div className="card">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="grid flex-1 grid-cols-2 gap-4 text-sm sm:grid-cols-4">
              <div>
                <p className="text-xs text-gray-500 font-medium mb-1">Stage</p>
                <span className={`inline-flex whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${STAGE_TONE[orderRow.data.stage] ?? ''}`}>
                  {orderRow.data.stage}
                </span>
              </div>
              <div>
                <p className="text-xs text-gray-500 font-medium mb-0.5">Factory</p>
                <p className="font-semibold text-gray-900">{orderRow.data.factory?.name ?? '—'}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 font-medium mb-0.5">Push Date</p>
                <p className="font-semibold text-gray-900">{orderRow.data.push_date ? fmtDate(orderRow.data.push_date) : '—'}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 font-medium mb-0.5">Tracking Status</p>
                <p className="font-semibold text-gray-900">{orderRow.data.tracking_text ?? '—'}</p>
              </div>
            </div>
            <button className="btn-primary flex items-center gap-2" onClick={() => setStageOpen(true)}>
              Update stage
            </button>
          </div>
          {orderRow.data.stage_note && orderRow.data.stage !== 'Exception' && (
            <p className="mt-3 text-sm text-gray-600"><span className="font-medium text-gray-900">Note:</span> {orderRow.data.stage_note}</p>
          )}
        </div>
      )}
      <StageEditor row={stageOpen ? orderRow.data ?? null : null} onClose={() => setStageOpen(false)} />

      {/* Info strip */}
      <div className="card">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 text-sm">
          {[
            { label: t('po.number'),       value: po.po_number },
            { label: t('po.issueDate'),    value: fmtDate(po.order_date ?? po.created_at) },
            { label: t('po.dueDate'),      value: fmtDate(po.due_date) },
            { label: t('po.orderId'),      value: (po.orders ?? []).length
                ? <span className="flex flex-wrap gap-x-2">{po.orders.map((o: { id: string; order_number: string; archived?: boolean }) =>
                    // An archived order has no page of its own any more; its lines still show below.
                    o.archived
                      ? <span key={o.id} className="text-gray-700" title="This sales order has been archived">{o.order_number}</span>
                      : <Link key={o.id} to={`/orders/${o.id}`} className="text-accent hover:underline">{o.order_number}</Link>)}</span>
                : '—' },
            { label: 'Type',               value: [po.po_type, po.po_scope === 'partial' ? 'partial' : null].filter(Boolean).join(' · ') || '—' },
            { label: t('common.status'),   value: null, badge: po.status },
          ].map(({ label, value, badge }) => (
            <div key={label}>
              <p className="text-xs text-gray-500 font-medium mb-0.5">{label}</p>
              {badge
                ? <span className={cn('badge', STATUS_BADGE[badge] ?? 'bg-gray-100 text-gray-600')}>
                    {String(t(`status.${badge}`, badge))}
                  </span>
                : <div className="font-semibold text-gray-900 capitalize">{value}</div>
              }
            </div>
          ))}
        </div>

        {/* Tracking info — shown when present */}
        {po.tracking_number && (
          <div className="mt-4 pt-4 border-t border-gray-100 flex items-start gap-6 text-sm">
            <div>
              <p className="text-xs text-gray-500 font-medium mb-0.5">{t('tracking.number')}</p>
              <p className="font-semibold text-gray-900">{po.tracking_number}</p>
            </div>
            {po.carrier && (
              <div>
                <p className="text-xs text-gray-500 font-medium mb-0.5">{t('tracking.carrier')}</p>
                <p className="font-semibold text-gray-900">{po.carrier}</p>
              </div>
            )}
            {po.tracking_notes && (
              <div className="flex-1">
                <p className="text-xs text-gray-500 font-medium mb-0.5">{t('tracking.notes')}</p>
                <p className="text-gray-700">{po.tracking_notes}</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Line items */}
      <div className="card p-0 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between gap-3">
          <h3 className="font-semibold text-gray-900">{t('po.lineItems')}</h3>
          <span className="text-xs text-gray-500">
            {items.length} line{items.length !== 1 ? 's' : ''} · {po.total_qty ?? 0} pcs
          </span>
        </div>
        {fromOrder && (
          <p className="px-5 py-2.5 text-xs text-sky-800 bg-sky-50 border-b border-sky-100">
            This purchase order has no lines of its own, so the garments below come from the sales order it was raised for.
            {po.po_scope === 'partial' && ' It covers only part of that order — check the PO total.'}
          </p>
        )}
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                {itemHeads.map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr>
                  <td colSpan={itemHeads.length} className="text-center py-10 text-gray-400">{t('po.noItems')}</td>
                </tr>
              ) : items.map((item, idx) => {
                const img = item.image ?? item.product_image
                const thumb = img
                  ? <button onClick={() => setPreview(img)}><SafeImg src={img} className="w-10 h-10 object-contain bg-gray-50 rounded" fallback="—" /></button>
                  : <span className="text-xs text-gray-300">—</span>
                return fromOrder ? (
                  <tr key={item.id} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm text-gray-500">{idx + 1}</td>
                    <td className="px-4 py-2">{thumb}</td>
                    <td className="px-4 py-3 text-sm text-gray-900">
                      {item.item_name ?? '—'}
                      {item.brand && <span className="block text-xs text-gray-400">{item.brand}{item.print_type ? ` · ${item.print_type}` : ''}</span>}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">{item.style ?? '—'}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{item.color ?? '—'}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{item.size ?? '—'}</td>
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">{item.qty_ordered ?? '—'}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{item.artwork_no ?? '—'}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{item.order_number ?? '—'}</td>
                  </tr>
                ) : (
                  <tr key={item.id} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm text-gray-500">{idx + 1}</td>
                    <td className="px-4 py-2">{thumb}</td>
                    <td className="px-4 py-3 text-sm text-gray-900">{item.item_name ?? '—'}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{[item.color, item.size].filter(Boolean).join(' / ') || '—'}</td>
                    <td className="px-4 py-3 text-sm text-gray-700">{item.qty_ordered ?? '—'} {item.uom ?? ''}</td>
                    <td className="px-4 py-3 text-sm text-gray-700">{fmtMoney(item.unit_price, cur)}</td>
                    <td className="px-4 py-3 text-sm text-gray-500">{item.discount_pct > 0 ? `${item.discount_pct}%` : '—'}</td>
                    <td className="px-4 py-3 text-sm text-gray-500">{item.tax_pct > 0 ? `${item.tax_pct}%` : '—'}</td>
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">{fmtMoney(item.line_total, cur)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* Financial summary — supplier's own costs only, NO customer totals */}
        <div className="px-5 py-4 border-t border-gray-100 flex justify-end">
          <div className="space-y-1 text-sm min-w-[220px]">
            {[
              { label: t('po.subtotal'),      value: po.subtotal },
              { label: t('po.totalDiscount'), value: po.total_discount },
              { label: t('po.totalTax'),      value: po.total_tax },
              { label: t('po.freight'),       value: po.freight_charges },
              { label: t('po.otherCharges'),  value: po.other_charges },
            ].map(({ label, value }) => (
              <div key={label} className="flex justify-between text-gray-600">
                <span>{label}</span>
                <span>{fmtMoney(value, cur)}</span>
              </div>
            ))}
            <div className="flex justify-between font-bold text-gray-900 text-base pt-2 border-t border-gray-200">
              <span>{t('po.grandTotal')}</span>
              <span>{fmtMoney(po.grand_total, cur)}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* Ship to */}
        <div className="card">
          <h3 className="font-semibold text-gray-900 mb-3">Ship To</h3>
          <div className="text-sm space-y-1">
            <p className="font-medium text-gray-900">{po.shipping_name ?? '—'}</p>
            <p className="text-gray-600 whitespace-pre-line">{po.shipping_address ?? '—'}</p>
            {(po.contact_name || po.contact_phone) && (
              <p className="text-gray-500">{[po.contact_name, po.contact_phone].filter(Boolean).join(' · ')}</p>
            )}
            {(po.shipping_method || po.delivery_type) && (
              <p className="text-gray-500">Method: {[po.shipping_method, po.delivery_type].filter(Boolean).join(' · ')}</p>
            )}
          </div>
        </div>

        {/* Shipments */}
        <div className="card p-0 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100">
            <h3 className="font-semibold text-gray-900">Shipments ({shipments.length})</h3>
          </div>
          {shipments.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-gray-400">Nothing shipped yet.</p>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  {['Tracking', 'Carrier', 'Status', 'Shipped', 'Delivered'].map((h) => (
                    <th key={h} className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shipments.map((s) => (
                  <tr key={s.id} className="border-b border-gray-50">
                    <td className="px-4 py-2.5 text-sm font-medium text-gray-900">{s.tracking_number ?? s.shipment_number ?? '—'}</td>
                    <td className="px-4 py-2.5 text-sm text-gray-600">{s.carrier ?? '—'}</td>
                    <td className="px-4 py-2.5 text-sm text-gray-600">{s.status ?? '—'}</td>
                    <td className="px-4 py-2.5 text-sm text-gray-600">{fmtDate(s.ship_date)}</td>
                    <td className="px-4 py-2.5 text-sm text-gray-600">{fmtDate(s.delivered_date ?? s.estimated_delivery)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Artwork */}
      {(po.artworks ?? []).length > 0 && (
        <div className="card">
          <h3 className="font-semibold text-gray-900 mb-3">Artwork ({po.artworks.length})</h3>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
            {po.artworks.map((a: { id: string; file_url: string; thumbnail_url: string | null; name: string | null; artwork_number: string | null; position: string | null; order_number?: string | null }) => (
              <button key={a.id} onClick={() => setPreview(a.file_url)} className="text-left group">
                <SafeImg src={a.thumbnail_url ?? a.file_url} alt={a.name ?? ''} className="h-28 w-full rounded-lg bg-gray-900 object-contain group-hover:ring-2 group-hover:ring-accent" />
                <p className="mt-1 truncate text-xs font-semibold text-accent">{a.artwork_number ?? a.name ?? '—'}</p>
                <p className="truncate text-[11px] text-gray-500">{[a.position, a.order_number].filter(Boolean).join(' · ') || '—'}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Notes */}
      {po.notes && (
        <div className="card">
          <h3 className="font-semibold text-gray-900 mb-2">{t('common.notes')}</h3>
          <p className="text-sm text-gray-600 whitespace-pre-line">{po.notes}</p>
        </div>
      )}

      {/* ── Image preview ── */}
      {preview && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-8" onClick={() => setPreview(null)}>
          <img src={assetUrl(preview)} alt="" className="max-w-full max-h-[85vh] object-contain rounded-lg bg-white" />
        </div>
      )}

      {/* ── Status modal ── */}
      {statusModalOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 w-80 shadow-2xl">
            <h3 className="text-base font-bold text-gray-900 mb-4">{t('status.label')}</h3>
            <div className="mb-4">
              <label className="block text-xs font-semibold text-gray-500 mb-1.5">{t('status.newStatus')}</label>
              <select
                className="input"
                value={newStatus}
                onChange={(e) => setNewStatus(e.target.value)}
              >
                {validTransitions.map((s) => (
                  <option key={s} value={s}>{t(`status.${s}`, s)}</option>
                ))}
              </select>
            </div>
            <div className="flex gap-2 justify-end">
              <button className="btn-secondary" onClick={() => setStatusModalOpen(false)}>
                {t('common.cancel')}
              </button>
              <button
                className="btn-primary"
                disabled={!newStatus || statusMutation.isPending}
                onClick={() => statusMutation.mutate(newStatus)}
              >
                {t('status.update')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Tracking modal ── */}
      {trackingOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 w-[420px] shadow-2xl">
            <h3 className="text-base font-bold text-gray-900 mb-4">{t('tracking.title')}</h3>
            <div className="space-y-3 mb-5">
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">{t('tracking.number')}</label>
                <input
                  className="input"
                  value={trackingNum}
                  onChange={(e) => setTrackingNum(e.target.value)}
                  placeholder={t('tracking.placeholder.number')}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">{t('tracking.carrier')}</label>
                <input
                  className="input"
                  value={carrier}
                  onChange={(e) => setCarrier(e.target.value)}
                  placeholder={t('tracking.placeholder.carrier')}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">{t('tracking.notes')}</label>
                <textarea
                  className="input"
                  rows={3}
                  value={trackingNotes}
                  onChange={(e) => setTrackingNotes(e.target.value)}
                  placeholder={t('tracking.placeholder.notes')}
                />
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button className="btn-secondary" onClick={() => setTrackingOpen(false)}>
                {t('common.cancel')}
              </button>
              <button
                className="btn-primary"
                disabled={!trackingNum.trim() || trackingMutation.isPending}
                onClick={() => trackingMutation.mutate()}
              >
                {t('tracking.submit')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
