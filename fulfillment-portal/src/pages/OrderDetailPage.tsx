import { useState, type ReactNode } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Check, Download, Printer, X } from 'lucide-react'
import api from '../services/api'
import { cn } from '../utils/cn'
import { fmtDate, assetUrl, SafeImg } from '../components/ui'

/**
 * Order Details — the job as the shop sees it on its own order page, minus the
 * customer's money (totals, prices, payments, invoice) and the shop's internal
 * notes, which the API never sends.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

interface Artwork {
  id: string; artwork_number: string | null; name: string | null; file_url: string; thumbnail_url: string | null
  width: number | null; height: number | null; size?: string | null; position: string | null
  source?: string; lifecycle?: string | null; order_number?: string | null; match?: string
}
type Line = Record<string, any>
interface Shipment {
  id: string; shipment_number: string | null; carrier: string | null; tracking_number: string | null
  status: string | null; ship_date: string | null; estimated_delivery: string | null; delivered_date: string | null
}
interface PO { id: string; po_number: string; status: string; po_scope?: string | null; issue_date?: string | null; tracking_number?: string | null; carrier?: string | null }
interface Update { id: string; status: string; notes: string | null; submitted_at: string }

interface Order {
  id: string; order_number: string; status: string; order_type: string
  order_stage?: string | null; process_status?: string | null
  order_date: string | null; entry_date?: string | null; due_date: string | null; required_ship_date?: string | null
  customer_name?: string | null; customer_number?: string | null; vendor_name?: string | null
  contact_name: string | null; contact_email: string | null; contact_phone: string | null
  shipping_name: string | null; shipping_address: string | null; ship_to?: { source: string | null } | null
  shipping_method?: string | null; courier?: string | null; tracking_number?: string | null; shipped_at?: string | null
  print_type?: string | null; production_priority?: string | null; production_method?: string | null
  production_facility?: string | null; assigned_team?: string | null; estimated_production_time?: string | null
  production_notes?: string | null; packing_instructions?: string | null; shipping_instructions?: string | null
  size_summary?: string | null
  items: Line[]; artworks: Artwork[]; shipments: Shipment[]; purchase_orders: PO[]; updates: Update[]
  stats?: { total_pieces: number | null; total_weight_lbs: number | null; print_locations: number | null; artworks: number; shipments: number }
}

// ─── Config ───────────────────────────────────────────────────────────────────

const STATUS_BADGE: Record<string, string> = {
  Draft:           'bg-gray-100 text-gray-600',
  Confirmed:       'bg-emerald-50 text-emerald-700',
  'In Production': 'bg-blue-50 text-blue-700',
  QC:              'bg-violet-50 text-violet-700',
  'Ready to Ship': 'bg-amber-50 text-amber-700',
  Shipped:         'bg-orange-50 text-orange-700',
  Delivered:       'bg-green-50 text-green-700',
  Cancelled:       'bg-red-50 text-red-700',
}

const STEPS = ['Sales Order', 'Artwork', 'Purchase Order', 'Printing', 'QC', 'Packing', 'Shipment']

/** How far along the job is, read from what the order actually holds. */
function reachedStep(o: Order): number {
  if (['Shipped', 'Delivered'].includes(o.status) || o.shipments.length) return 6
  if (o.status === 'Ready to Ship') return 5
  if (o.status === 'QC') return 4
  if (o.status === 'In Production') return 3
  if (o.purchase_orders.length) return 2
  if (o.artworks.length) return 1
  return 0
}

const typeLabel = (t: string) =>
  t === 'apparel' ? 'Custom T-Shirts' : t === 'gangsheet' ? 'Gangsheet' : t === 'dtf' ? 'DTF Transfers' : t

const dash = (v: ReactNode) => (v === null || v === undefined || v === '' ? '—' : v)

const MATCH_NOTE: Record<string, string> = {
  customer: "From this customer's artwork folder in Printshop.",
  customer_dates: "From this customer's artwork folder in Printshop, dated to this order.",
}

// ─── Small pieces ─────────────────────────────────────────────────────────────

function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-gray-500 font-medium mb-0.5">{label}</p>
      <div className="text-sm font-semibold text-gray-900 break-words">{dash(value)}</div>
    </div>
  )
}

function Section({ n, title, right, children, className }: { n?: number; title: string; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('card p-0 overflow-hidden', className)}>
      <div className="px-5 py-3.5 border-b border-gray-100 flex items-center justify-between gap-3">
        <h3 className="font-semibold text-gray-900 flex items-center gap-2">
          {n != null && <span className="w-6 h-6 bg-accent text-white rounded-full text-xs font-bold flex items-center justify-center">{n}</span>}
          {title}
        </h3>
        {right}
      </div>
      {children}
    </section>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function OrderDetailPage() {
  const { id } = useParams()
  const [preview, setPreview] = useState<{ url: string; name: string; download?: string } | null>(null)

  const { data, isLoading, isError, refetch } = useQuery<Order>({
    queryKey: ['order', id],
    queryFn:  () => api.get(`/orders/${id}`).then((r) => r.data.order),
    enabled:  !!id,
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin w-8 h-8 border-2 border-accent border-t-transparent rounded-full" />
      </div>
    )
  }

  if (isError || !data) {
    return (
      <div className="text-center py-16 text-gray-500">
        <p className="text-lg font-medium">{isError ? 'This order could not be loaded.' : 'Order not found'}</p>
        <div className="mt-3 flex items-center justify-center gap-4 text-sm">
          {isError && <button className="text-accent hover:underline" onClick={() => refetch()}>Try again</button>}
          <Link to="/orders" className="text-accent hover:underline">← Back to Orders</Link>
        </div>
      </div>
    )
  }

  const o = data
  const step = reachedStep(o)
  const stats = o.stats
  const onOrder = (o.artworks ?? []).filter((a) => a.source !== 'vault')
  const fromVault = (o.artworks ?? []).filter((a) => a.source === 'vault')

  const open = (url?: string | null, name?: string | null) => {
    if (!url) return
    setPreview({
      url, name: name ?? '',
      download: url.includes('/vault/') ? `${url}?download=1` : url,
    })
  }

  const thumb = (src?: string | null, label?: string) => src
    ? <button type="button" onClick={() => open(src, label)} title={label}>
        <SafeImg src={src} alt={label} className="w-11 h-11 object-contain bg-gray-50 rounded border border-gray-100" fallback="—" />
      </button>
    : <span className="text-xs text-gray-300">—</span>

  return (
    <>
      <div className="space-y-5 print:space-y-3">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-sm text-gray-500 print:hidden">
          <Link to="/orders" className="hover:text-gray-700">Orders</Link>
          <span>/</span>
          <span className="text-gray-900 font-medium">{o.order_number}</span>
        </div>

        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">Order {o.order_number}</h2>
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-gray-500">
              <span>{typeLabel(o.order_type)}</span>
              <span className={cn('badge', STATUS_BADGE[o.status] ?? 'bg-gray-100 text-gray-600')}>{o.status}</span>
              {o.order_stage && o.order_stage !== o.status && <span className="badge bg-gray-100 text-gray-600">{o.order_stage}</span>}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 print:hidden">
            <Link to={`/status-update/${o.id}`} className="btn-primary flex items-center gap-2 text-sm">Submit Status Update</Link>
            <button className="btn-secondary flex items-center gap-2 text-sm" onClick={() => window.print()}>
              <Printer size={14} /> Print
            </button>
            <Link to="/orders" className="btn-secondary flex items-center gap-2 text-sm">
              <ArrowLeft size={14} /> Back
            </Link>
          </div>
        </div>

        {/* Progress */}
        <div className="card overflow-x-auto">
          <ol className="flex min-w-[640px] items-start">
            {STEPS.map((label, i) => {
              const done = i <= step
              return (
                <li key={label} className="flex flex-1 flex-col items-center">
                  <div className="flex w-full items-center">
                    <span className={cn('h-[3px] flex-1 rounded', i === 0 ? 'bg-transparent' : done ? 'bg-emerald-500' : 'bg-gray-200')} />
                    <span className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-bold',
                      done ? 'bg-emerald-500 text-white' : 'bg-gray-100 text-gray-400')}>
                      {done ? <Check size={15} /> : i + 1}
                    </span>
                    <span className={cn('h-[3px] flex-1 rounded', i === STEPS.length - 1 ? 'bg-transparent' : i < step ? 'bg-emerald-500' : 'bg-gray-200')} />
                  </div>
                  <span className={cn('mt-1.5 text-xs font-medium text-center', done ? 'text-emerald-700' : 'text-gray-400')}>{label}</span>
                </li>
              )
            })}
          </ol>
        </div>

        {/* Key facts */}
        <div className="card">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            <Field label="Purchase Order" value={o.purchase_orders?.length
              ? <span className="flex flex-wrap gap-x-2">{o.purchase_orders.map((p) =>
                  <Link key={p.id} to={`/purchase-orders/${p.id}`} className="text-accent hover:underline">{p.po_number}</Link>)}</span>
              : null} />
            <Field label="Order Date" value={fmtDate(o.order_date)} />
            <Field label="Entry Date" value={fmtDate(o.entry_date)} />
            <Field label="Required Ship Date" value={fmtDate(o.required_ship_date ?? o.due_date)} />
            <Field label="Print Type" value={o.print_type} />
            <Field label="Priority" value={o.production_priority} />
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {[
            ['Total Pieces', stats?.total_pieces],
            ['Total Weight', stats?.total_weight_lbs != null ? `${stats.total_weight_lbs} lbs` : null],
            ['Print Locations', stats?.print_locations],
            ['Artworks', stats?.artworks],
            ['Shipments', stats?.shipments],
          ].map(([label, value]) => (
            <div key={String(label)} className="card py-3">
              <p className="text-xs text-gray-500">{label}</p>
              <p className="text-xl font-bold text-gray-900">{dash(value as ReactNode)}</p>
            </div>
          ))}
        </div>

        {/* Contact, ship to, shipping, production */}
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-4">
          <Section title="Customer & Contact">
            <div className="px-5 py-4 text-sm space-y-1">
              <p className="font-semibold text-gray-900">{dash(o.customer_name ?? o.contact_name)}</p>
              {o.customer_number && <p className="text-gray-500">{o.customer_number}</p>}
              {o.contact_name && o.contact_name !== o.customer_name && <p className="text-gray-600">{o.contact_name}</p>}
              {o.contact_email && <p className="text-gray-600 break-all">{o.contact_email}</p>}
              {o.contact_phone && <p className="text-gray-600">{o.contact_phone}</p>}
            </div>
          </Section>
          <Section title="Ship To">
            <div className="px-5 py-4 text-sm space-y-1">
              <p className="font-semibold text-gray-900">{dash(o.shipping_name)}</p>
              <p className="text-gray-600 whitespace-pre-line">{dash(o.shipping_address)}</p>
              {o.ship_to?.source && o.ship_to.source !== 'order' && (
                <p className="text-[11px] text-gray-400">
                  {o.ship_to.source === 'address_book' ? "From the customer's address book" : "Customer's address on file"}
                </p>
              )}
            </div>
          </Section>
          <Section title="Shipping">
            <div className="px-5 py-4 grid grid-cols-1 gap-3">
              <Field label="Method" value={o.shipping_method ?? 'Standard Shipping'} />
              <Field label="Courier" value={o.courier} />
              <Field label="Tracking" value={o.tracking_number} />
              {o.shipping_instructions && <Field label="Instructions" value={<span className="font-normal whitespace-pre-line">{o.shipping_instructions}</span>} />}
            </div>
          </Section>
          <Section title="Production">
            <div className="px-5 py-4 grid grid-cols-2 gap-3">
              <Field label="Method" value={o.production_method ?? typeLabel(o.order_type)} />
              <Field label="Facility" value={o.production_facility} />
              <Field label="Team" value={o.assigned_team} />
              <Field label="Est. Time" value={o.estimated_production_time} />
            </div>
          </Section>
        </div>

        {(o.production_notes || o.packing_instructions) && (
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            {o.production_notes && (
              <Section title="Production Notes">
                <p className="px-5 py-4 text-sm text-gray-700 whitespace-pre-line">{o.production_notes}</p>
              </Section>
            )}
            {o.packing_instructions && (
              <Section title="Packing Instructions">
                <p className="px-5 py-4 text-sm text-gray-700 whitespace-pre-line">{o.packing_instructions}</p>
              </Section>
            )}
          </div>
        )}

        {/* Line items */}
        <Section n={1} title="Line Items"
          right={<span className="text-xs text-gray-500">{o.items?.length ?? 0} line{o.items?.length !== 1 ? 's' : ''}{o.size_summary ? ` · sizes ${o.size_summary}` : ''}</span>}>
          <div className="overflow-x-auto">
            {o.order_type === 'apparel' && (
              <table className="w-full min-w-[1100px]">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    {['#', 'Product', 'Color', 'Size', 'Qty', 'Decoration', 'Artwork No', 'Front', 'Back', 'Front Mockup', 'Back Mockup', 'Weight', 'Prod. Status'].map((h) => (
                      <th key={h} className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(o.items ?? []).length === 0 ? (
                    <tr><td colSpan={13} className="text-center py-8 text-sm text-gray-400">No items</td></tr>
                  ) : o.items.map((it, idx) => (
                    <tr key={it.id} className="border-b border-gray-50 hover:bg-gray-50 align-top">
                      <td className="px-3 py-3 text-sm text-gray-500">{idx + 1}</td>
                      <td className="px-3 py-3">
                        <div className="flex items-start gap-2.5">
                          {thumb(it.product_image, it.item)}
                          <div className="min-w-0">
                            <p className="text-sm text-gray-900">{dash(it.item)}</p>
                            <p className="text-xs text-gray-500">{[it.brand, it.model, it.catalog_sku].filter(Boolean).join(' · ') || '—'}</p>
                            {it.notes && <p className="text-xs text-gray-500 mt-0.5 whitespace-pre-line">{it.notes}</p>}
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-sm text-gray-700">{dash(it.color)}</td>
                      <td className="px-3 py-3 text-sm text-gray-700">{dash(it.size)}</td>
                      <td className="px-3 py-3 text-sm font-semibold text-gray-900">{dash(it.qty)}</td>
                      <td className="px-3 py-3 text-sm text-gray-700">{dash(it.decoration_method)}</td>
                      <td className="px-3 py-3 text-sm text-gray-700">{dash(it.artwork_no)}{it.artwork_size && <span className="block text-xs text-gray-400">{it.artwork_size}</span>}</td>
                      <td className="px-3 py-3">{thumb(it.front_image, 'Front artwork')}</td>
                      <td className="px-3 py-3">{thumb(it.back_image, 'Back artwork')}</td>
                      <td className="px-3 py-3">{thumb(it.front_mockup, 'Front mockup')}</td>
                      <td className="px-3 py-3">{thumb(it.back_mockup, 'Back mockup')}</td>
                      <td className="px-3 py-3 text-sm text-gray-700 whitespace-nowrap">{it.line_weight_lbs != null ? `${it.line_weight_lbs} lbs` : '—'}</td>
                      <td className="px-3 py-3 text-sm text-gray-700">{dash(it.production_status)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {o.order_type === 'dtf' && (
              <table className="w-full min-w-[760px]">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    {['#', 'Artwork', 'Artwork Name', 'Artwork No', 'Width × Height', 'Size', 'Qty', 'Back', 'Prod. Status'].map((h) => (
                      <th key={h} className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(o.items ?? []).map((it, idx) => (
                    <tr key={it.id} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="px-3 py-3 text-sm text-gray-500">{idx + 1}</td>
                      <td className="px-3 py-3">{thumb(it.front_image ?? it.artwork_image, it.artwork_name)}</td>
                      <td className="px-3 py-3 text-sm text-gray-900">{dash(it.artwork_name)}</td>
                      <td className="px-3 py-3 text-sm text-gray-700">{dash(it.artwork_no)}</td>
                      <td className="px-3 py-3 text-sm text-gray-700">{it.width_inches && it.height_inches ? `${it.width_inches}" × ${it.height_inches}"` : '—'}</td>
                      <td className="px-3 py-3 text-sm text-gray-700">{dash(it.size)}</td>
                      <td className="px-3 py-3 text-sm font-semibold text-gray-900">{dash(it.qty)}</td>
                      <td className="px-3 py-3">{thumb(it.back_image, 'Back')}</td>
                      <td className="px-3 py-3 text-sm text-gray-700">{dash(it.production_status)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {o.order_type === 'gangsheet' && (
              <table className="w-full min-w-[760px]">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    {['#', 'Preview', 'Size', 'Artworks', 'Qty', 'Designs on the sheet', 'Prod. Status'].map((h) => (
                      <th key={h} className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(o.items ?? []).map((it, idx) => (
                    <tr key={it.id} className="border-b border-gray-50 hover:bg-gray-50 align-top">
                      <td className="px-3 py-3 text-sm text-gray-500">{idx + 1}</td>
                      <td className="px-3 py-3">{thumb(it.front_image, `Gangsheet ${it.size ?? ''}`)}</td>
                      <td className="px-3 py-3 text-sm text-gray-700">{dash(it.size)}</td>
                      <td className="px-3 py-3 text-sm text-gray-700">{dash(it.no_artworks)}</td>
                      <td className="px-3 py-3 text-sm font-semibold text-gray-900">{dash(it.qty)}</td>
                      <td className="px-3 py-3">
                        <div className="flex flex-wrap gap-2">
                          {(Array.isArray(it.artworks) ? it.artworks : []).map((a: any, n: number) => (
                            <div key={n} className="flex items-center gap-1.5 text-xs text-gray-600">
                              {thumb(a?.image, a?.artwork_no)}
                              <span>{a?.artwork_no ?? `#${n + 1}`}{a?.size ? ` · ${a.size}` : ''}{a?.qty ? ` × ${a.qty}` : ''}</span>
                            </div>
                          ))}
                          {!(Array.isArray(it.artworks) && it.artworks.length) && <span className="text-xs text-gray-300">—</span>}
                        </div>
                      </td>
                      <td className="px-3 py-3 text-sm text-gray-700">{dash(it.production_status)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </Section>

        {/* Artwork */}
        <Section n={2} title={`Artwork (${o.artworks?.length ?? 0})`}>
          {(o.artworks ?? []).length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-gray-400">No artwork is on file for this order in Printshop.</p>
          ) : (
            <div className="px-5 py-4 space-y-5">
              {[
                { key: 'order', title: 'On the order', list: onOrder, note: null as string | null },
                { key: 'vault', title: 'From the Printshop artwork vault', list: fromVault,
                  note: fromVault[0]?.match ? MATCH_NOTE[fromVault[0].match] ?? null : null },
              ].filter((g) => g.list.length).map((g) => (
                <div key={g.key}>
                  <div className="mb-2 flex flex-wrap items-baseline gap-x-3">
                    <h4 className="text-sm font-semibold text-gray-800">{g.title} ({g.list.length})</h4>
                    {g.note && <p className="text-xs text-gray-400">{g.note}</p>}
                  </div>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
                    {g.list.map((a) => (
                      <button key={a.id} type="button" onClick={() => open(a.file_url, a.name ?? a.artwork_number)} className="text-left group">
                        <SafeImg src={a.thumbnail_url ?? a.file_url} alt={a.name ?? ''}
                          className="h-28 w-full rounded-lg bg-gray-900 object-contain group-hover:ring-2 group-hover:ring-accent" />
                        <p className="mt-1 truncate text-xs font-semibold text-accent">{a.artwork_number ?? a.name ?? '—'}</p>
                        <p className="truncate text-[11px] text-gray-500">
                          {[a.position, a.width && a.height ? `${a.width}×${a.height} in` : a.size].filter(Boolean).join(' · ') || '—'}
                        </p>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Section>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          {/* Purchase orders */}
          <Section n={3} title={`Purchase Orders (${o.purchase_orders?.length ?? 0})`}>
            {(o.purchase_orders ?? []).length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-gray-400">No purchase order shared with you for this order.</p>
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    {['PO Number', 'Issued', 'Status', 'Tracking'].map((h) => <th key={h} className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500">{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {o.purchase_orders.map((p) => (
                    <tr key={p.id} className="border-b border-gray-50">
                      <td className="px-4 py-2.5 text-sm"><Link to={`/purchase-orders/${p.id}`} className="text-accent hover:underline">{p.po_number}</Link>{p.po_scope === 'partial' && <span className="ml-1 text-xs text-gray-400">partial</span>}</td>
                      <td className="px-4 py-2.5 text-sm text-gray-600">{fmtDate(p.issue_date)}</td>
                      <td className="px-4 py-2.5 text-sm text-gray-600">{p.status}</td>
                      <td className="px-4 py-2.5 text-sm text-gray-600">{p.tracking_number ? `${p.tracking_number}${p.carrier ? ` · ${p.carrier}` : ''}` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>

          {/* Shipments */}
          <Section n={4} title={`Shipments (${o.shipments?.length ?? 0})`}>
            {(o.shipments ?? []).length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-gray-400">Nothing shipped yet.</p>
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    {['Tracking', 'Carrier', 'Status', 'Shipped', 'Delivered'].map((h) => <th key={h} className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500">{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {o.shipments.map((s) => (
                    <tr key={s.id} className="border-b border-gray-50">
                      <td className="px-4 py-2.5 text-sm font-medium text-gray-900">{s.tracking_number ?? s.shipment_number ?? '—'}</td>
                      <td className="px-4 py-2.5 text-sm text-gray-600">{dash(s.carrier)}</td>
                      <td className="px-4 py-2.5 text-sm text-gray-600">{dash(s.status)}</td>
                      <td className="px-4 py-2.5 text-sm text-gray-600">{fmtDate(s.ship_date)}</td>
                      <td className="px-4 py-2.5 text-sm text-gray-600">{fmtDate(s.delivered_date ?? s.estimated_delivery)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>
        </div>

        {/* Your updates */}
        <Section n={5} title={`Your Status Updates (${o.updates?.length ?? 0})`}
          right={<Link to={`/status-update/${o.id}`} className="text-xs text-accent hover:underline print:hidden">Add update</Link>}>
          {(o.updates ?? []).length === 0 ? (
            <p className="px-5 py-6 text-center text-sm text-gray-400">No updates recorded yet.</p>
          ) : (
            <ul className="divide-y divide-gray-50">
              {o.updates.map((u) => (
                <li key={u.id} className="px-5 py-3 text-sm flex flex-wrap gap-x-4 gap-y-1">
                  <span className="font-semibold text-gray-900">{u.status}</span>
                  <span className="text-gray-400">{new Date(u.submitted_at).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}</span>
                  {u.notes && <span className="w-full text-gray-600">{u.notes}</span>}
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      {/* Lightbox */}
      {preview && (
        <div className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center p-8" onClick={() => setPreview(null)}>
          <div className="relative max-w-5xl max-h-full" onClick={(e) => e.stopPropagation()}>
            <div className="absolute -top-10 right-0 flex items-center gap-4">
              {preview.download && (
                <a href={assetUrl(preview.download)} className="flex items-center gap-1 text-sm text-white hover:text-gray-300">
                  <Download size={15} /> Download
                </a>
              )}
              <button onClick={() => setPreview(null)} className="text-white hover:text-gray-300"><X size={22} /></button>
            </div>
            <SafeImg src={preview.url} alt={preview.name} className="max-w-full max-h-[85vh] object-contain rounded-lg bg-white" fallback="Preview unavailable" />
            {preview.name && <p className="text-white text-center text-sm mt-3">{preview.name}</p>}
          </div>
        </div>
      )}
    </>
  )
}
