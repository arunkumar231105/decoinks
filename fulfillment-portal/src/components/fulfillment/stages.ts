import {
  AlertTriangle, Box, CheckCircle2, Clock, FileText, Plane, Search, Send, Settings, Truck, XCircle, type LucideIcon,
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
  'To be Pushed': 'bg-orange-100 text-orange-600',
  'Factory Audit': 'bg-purple-100 text-purple-600',
  'In Production': 'bg-blue-100 text-blue-600',
  Exception: 'bg-red-100 text-red-600',
  Shipped: 'bg-green-100 text-green-700',
  'Pre-Transit': 'bg-cyan-100 text-cyan-700',
  'In Transit': 'bg-sky-100 text-sky-700',
  Delivered: 'bg-green-100 text-green-700',
  Cancelled: 'bg-slate-100 text-slate-600',
}

export const STAGE_TEXT: Record<string, string> = {
  Exception: 'text-red-600',
  Delivered: 'text-green-700',
  'In Transit': 'text-blue-600',
  'Pre-Transit': 'text-blue-600',
  Shipped: 'text-blue-600',
}

/** The summary cards, in the order the design lays them out. `filter` is what a click applies. */
export const CARDS: { label: string; filter: string; icon: LucideIcon; tone: string; solid?: boolean; key: 'total' | 'issued' | 'pending' | Stage }[] = [
  { label: 'Total PO', filter: '', icon: FileText, tone: 'bg-blue-50 text-blue-600', key: 'total' },
  { label: 'Issued', filter: 'Issued', icon: CheckCircle2, tone: 'bg-green-50 text-green-600', key: 'issued' },
  { label: 'Pending', filter: 'Pending', icon: Clock, tone: 'bg-orange-50 text-orange-500', key: 'pending' },
  { label: 'To be Pushed', filter: 'To be Pushed', icon: Send, tone: 'bg-blue-50 text-blue-600', key: 'To be Pushed' },
  { label: 'Factory Audit', filter: 'Factory Audit', icon: Search, tone: 'bg-purple-50 text-purple-600', key: 'Factory Audit' },
  { label: 'In Production', filter: 'In Production', icon: Settings, tone: 'bg-blue-50 text-blue-600', key: 'In Production' },
  { label: 'Exceptions', filter: 'Exception', icon: AlertTriangle, tone: 'bg-red-50 text-red-600', key: 'Exception' },
  { label: 'Shipped', filter: 'Shipped', icon: Truck, tone: 'bg-teal-50 text-teal-600', key: 'Shipped' },
  { label: 'Pre-Transit', filter: 'Pre-Transit', icon: Box, tone: 'bg-cyan-50 text-cyan-700', key: 'Pre-Transit' },
  { label: 'Transit', filter: 'In Transit', icon: Plane, tone: 'bg-indigo-50 text-indigo-600', key: 'In Transit' },
  { label: 'Delivered', filter: 'Delivered', icon: CheckCircle2, tone: 'bg-green-50 text-green-600', solid: true, key: 'Delivered' },
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
