import {
  AlertTriangle, CheckCircle2, ClipboardList, Clock, FileCheck2, Package, PlaneTakeoff,
  Search, Send, Settings2, Truck, XCircle, type LucideIcon,
} from 'lucide-react'

/**
 * Where a purchase order stands, as the Supplier Order Management grid shows it.
 *
 * The first four are the supplier's to set. The rest come from the parcel's
 * courier tracking (or the shop closing the PO), so they are never picked by
 * hand — see backend/src/modules/supplier-portal/portal.fulfillment.js.
 */
export const SUPPLIER_STAGES = ['To be Pushed', 'Factory Audit', 'In Production', 'Exception'] as const
export type SupplierStage = typeof SUPPLIER_STAGES[number]

export const STAGES = [
  'To be Pushed', 'Factory Audit', 'In Production', 'Exception',
  'Shipped', 'Pre-Transit', 'In Transit', 'Delivered', 'Cancelled',
] as const
export type Stage = typeof STAGES[number]

export const STAGE_TONE: Record<string, string> = {
  'To be Pushed': 'bg-amber-50 text-amber-700 ring-amber-600/20',
  'Factory Audit': 'bg-violet-50 text-violet-700 ring-violet-600/20',
  'In Production': 'bg-sky-50 text-sky-700 ring-sky-600/20',
  Exception: 'bg-rose-50 text-rose-700 ring-rose-600/20',
  Shipped: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  'Pre-Transit': 'bg-cyan-50 text-cyan-700 ring-cyan-600/20',
  'In Transit': 'bg-indigo-50 text-indigo-700 ring-indigo-600/20',
  Delivered: 'bg-green-50 text-green-700 ring-green-600/20',
  Cancelled: 'bg-slate-100 text-slate-600 ring-slate-500/20',
}

export const STAGE_TEXT: Record<string, string> = {
  Exception: 'text-rose-600',
  Delivered: 'text-green-700',
  'In Transit': 'text-brand',
  'Pre-Transit': 'text-brand',
  Shipped: 'text-brand',
}

/** The summary cards, in the order the design lays them out. `filter` is what a click applies. */
export const CARDS: { label: string; filter: string; icon: LucideIcon; tone: string; key: 'total' | 'issued' | 'pending' | Stage }[] = [
  { label: 'Total PO', filter: '', icon: ClipboardList, tone: 'bg-blue-50 text-brand', key: 'total' },
  { label: 'Issued', filter: 'Issued', icon: FileCheck2, tone: 'bg-green-50 text-green-600', key: 'issued' },
  { label: 'Pending', filter: 'Pending', icon: Clock, tone: 'bg-amber-50 text-amber-600', key: 'pending' },
  { label: 'To be Pushed', filter: 'To be Pushed', icon: Send, tone: 'bg-blue-50 text-brand', key: 'To be Pushed' },
  { label: 'Factory Audit', filter: 'Factory Audit', icon: Search, tone: 'bg-violet-50 text-violet-600', key: 'Factory Audit' },
  { label: 'In Production', filter: 'In Production', icon: Settings2, tone: 'bg-sky-50 text-sky-600', key: 'In Production' },
  { label: 'Exceptions', filter: 'Exception', icon: AlertTriangle, tone: 'bg-rose-50 text-rose-600', key: 'Exception' },
  { label: 'Shipped', filter: 'Shipped', icon: Truck, tone: 'bg-emerald-50 text-emerald-600', key: 'Shipped' },
  { label: 'Pre-Transit', filter: 'Pre-Transit', icon: Package, tone: 'bg-cyan-50 text-cyan-600', key: 'Pre-Transit' },
  { label: 'Transit', filter: 'In Transit', icon: PlaneTakeoff, tone: 'bg-indigo-50 text-indigo-600', key: 'In Transit' },
  { label: 'Delivered', filter: 'Delivered', icon: CheckCircle2, tone: 'bg-green-50 text-green-600', key: 'Delivered' },
]

export const CANCELLED_ICON = XCircle

export interface GridRow {
  id: string
  po_number: string
  customer_name: string | null
  customer_location: string | null
  order_id: string | null
  order_number: string | null
  order_archived: boolean
  factory: { id: string; name: string; is_active: boolean } | null
  push_date: string | null
  issue_date: string | null
  stage: Stage
  stage_editable: boolean
  supplier_stage: SupplierStage | null
  stage_note: string | null
  items: string | null
  qty: number | null
  courier: string | null
  tracking_number: string | null
  tracking_status: string | null
  tracking_text: string | null
  tracking_synced_at: string | null
  po_status: string
}

export interface GridResponse {
  rows: GridRow[]
  total: number
  page: number
  limit: number
  summary: { total: number; issued: number; pending: number; stages: Record<string, number> }
  filters: { stages: string[]; factories: { id: string; name: string }[]; couriers: string[] }
}

export interface Factory {
  id: string
  name: string
  city: string | null
  country: string | null
  is_active: boolean
  po_count?: number
}

export function carrierUrl(carrier?: string | null, number?: string | null) {
  if (!number) return null
  const n = encodeURIComponent(number.trim())
  const c = String(carrier || '').toUpperCase()
  if (c.includes('USPS')) return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${n}`
  if (c.includes('UPS')) return `https://www.ups.com/track?tracknum=${n}`
  if (c.includes('FEDEX')) return `https://www.fedex.com/fedextrack/?trknbr=${n}`
  if (c.includes('DHL')) return `https://www.dhl.com/en/express/tracking.html?AWB=${n}`
  return null
}

export const apiError = (err: any, fallback: string) =>
  err?.response?.data?.error ?? err?.message ?? fallback
