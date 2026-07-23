import { useParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '../services/api'
import { usePrintAuth } from '../hooks/usePrintAuth'
import { ArtworkLightboxOverlay, ArtworkLightboxProvider, ArtworkThumb } from '../components/print/ArtworkLightbox'

// ── Types ─────────────────────────────────────────────────────────────────────
interface Order {
  id: string
  order_number: string
  order_type: string
  status: string
  payment_status: string
  payment_method: string | null
  payment_terms: string | null
  order_date: string
  due_date: string | null
  total: number
  subtotal: number
  discount_pct: number
  discount_amt: number
  tax_amt: number
  rush_services: number
  shipping_charges: number
  notes: string | null
  quotation_id: string | null
  invoice_id: string | null
  invoice_number: string | null
  supplier_name: string | null
  contact_name: string | null
  contact_email: string | null
  contact_phone: string | null
  shipping_name: string | null
  shipping_address: string | null
  shipping_method: string | null
  production_notes?: string | null
  packing_instructions?: string | null
  shipping_instructions?: string | null
  production_priority?: string | null
  production_method?: string | null
  production_facility?: string | null
  assigned_team?: string | null
  estimated_production_time?: string | null
  total_print_locations?: number
  purchase_orders?: Array<{ po_number: string; status: string }>
  shipments?: Array<{ status: string; carrier?: string|null; tracking_number?: string|null }>
  agent_name: string | null
  items: ApparelItem[] | DtfItem[] | GangsheetItem[]
}

interface ApparelItem {
  id: string; category?: string | null; item: string; color: string | null; size: string | null
  brand?: string | null; model?: string | null; catalog_sku?: string | null
  qty: number; artwork_no: string | null; artwork_size: string | null
  unit_price: number; amount: number
  front_image: string | null; back_image: string | null
  product_image?: string | null; style_description?: string | null
  front_mockup?: string | null; back_mockup?: string | null
}

interface OrderInvoice {
  id: string; invoice_number: string; total: number; amount_paid: number; balance_due: number
  status: string
  payments?: Array<{ amount: number; payment_method: string | null; reference_no: string | null; paid_at: string }>
}

interface DtfItem {
  id: string; artwork_name: string; size: string | null
  artwork_no?: string | null
  width_inches?: number | string | null; height_inches?: number | string | null
  qty: number; unit_price: number; amount: number
  artwork_image: string | null; front_image?: string | null; back_image?: string | null
}

interface GangsheetItem {
  id: string; size: string | null; no_artworks: number
  qty: number; price_per_sheet: number; amount: number; front_image: string | null; back_image?: string | null
}

interface ArtworkItem {
  id: string; artwork_no: string; name: string
  file_url: string | null; file_type: string | null
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmt = (n: number | string | null | undefined) =>
  '$' + Number(n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const fmtDate = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' }) : '—'

function numberToWords(amount: number): string {
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
    'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
    'Seventeen', 'Eighteen', 'Nineteen']
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']
  const whole = Math.floor(amount)
  const cents = Math.round((amount - whole) * 100)
  function below1000(n: number): string {
    if (n === 0) return ''
    if (n < 20) return ones[n] + ' '
    if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[n % 10] : '') + ' '
    return ones[Math.floor(n / 100)] + ' Hundred ' + below1000(n % 100)
  }
  let r = ''
  if (whole >= 1000000) r += below1000(Math.floor(whole / 1000000)) + 'Million '
  if (whole >= 1000)    r += below1000(Math.floor((whole % 1000000) / 1000)) + 'Thousand '
  r += below1000(whole % 1000)
  const centsStr = cents > 0 ? ` and ${cents.toString().padStart(2, '0')}/100` : ''
  return r.trim() + centsStr + ' US Dollars Only'
}

function colorHex(c: string | null): string {
  if (!c) return '#d1d5db'
  const l = c.toLowerCase()
  if (l.includes('white'))  return '#ffffff'
  if (l.includes('black'))  return '#111827'
  if (l.includes('red'))    return '#ef4444'
  if (l.includes('blue'))   return '#3b82f6'
  if (l.includes('green'))  return '#22c55e'
  if (l.includes('yellow')) return '#eab308'
  if (l.includes('grey') || l.includes('gray')) return '#9ca3af'
  if (l.includes('navy'))   return '#1a2b5c'
  if (l.includes('pink'))   return '#ec4899'
  if (l.includes('orange')) return '#f97316'
  return '#d1d5db'
}

// Parse "S-3, M-8, L-10, XL-3, 2XL-1, 3XL-0" → { S:3, M:8, L:10, XL:3, 2XL:1, 3XL:0 }
const SIZE_COLS = ['S', 'M', 'L', 'XL', '2XL', '3XL']

function parseSizes(sizeStr: string | null, totalQty: number): Record<string, number> {
  const r: Record<string, number> = {}
  SIZE_COLS.forEach(s => { r[s] = 0 })
  if (!sizeStr) return r
  if (sizeStr.includes('-')) {
    sizeStr.split(/[,;]/).forEach(part => {
      const m = part.trim().match(/^(S|M|L|XL|2XL|3XL|4XL|5XL)-(\d+)$/i)
      if (m && SIZE_COLS.includes(m[1].toUpperCase())) {
        r[m[1].toUpperCase()] = parseInt(m[2])
      }
    })
  } else {
    const sz = sizeStr.trim().toUpperCase()
    if (SIZE_COLS.includes(sz)) r[sz] = totalQty
  }
  return r
}

// ── Company ───────────────────────────────────────────────────────────────────
const CO = {
  address: 'Suite 111, 1218 Magnolia Avenue',
  city: 'Corona, CA 92881, United States',
  email: 'info@decoinks.com',
  phone: '+1 (714) 790-1460',
}

// ── CSS ───────────────────────────────────────────────────────────────────────
const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Inter', sans-serif; font-size: 12px; color: #111827; background: #fff; }
  .page { max-width: 1040px; margin: 0 auto; padding: 28px; }
  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .no-print { display: none !important; }
    .page { padding: 12px; }
    @page { margin: 6mm; size: A4 landscape; }
    a.art-link, a.art-link:visited { text-decoration: none; color: inherit; border: none; display: block; }
  }
  a.art-link { cursor: zoom-in; }

  /* ── Header ── */
  .hdr {
    display: grid;
    grid-template-columns: 240px 1px 1fr auto;
    gap: 0 22px;
    margin-bottom: 18px;
    padding-bottom: 20px;
    border-bottom: 2px solid #e5e7eb;
    align-items: start;
  }
  .hdr-left { display: flex; flex-direction: column; gap: 10px; }
  .hdr-divider { background: #d1d5db; align-self: stretch; }
  .hdr-center { padding-left: 4px; }
  .hdr-right { min-width: 240px; }

  .print-logo-img { height: 42px; width: auto; object-fit: contain; display: block; }
  .logo-tag { font-size: 8.5px; font-weight: 700; letter-spacing: 2.5px; color: #6b7280; text-transform: uppercase; margin-top: 2px; }
  .co-info { display: flex; flex-direction: column; }
  .co-line { display: flex; align-items: center; gap: 6px; font-size: 11px; color: #4b5563; line-height: 1.85; }
  .co-line svg { flex-shrink: 0; }

  .so-title { font-size: 46px; font-weight: 900; color: #1a2b5c; letter-spacing: 4px; line-height: 1; margin-bottom: 6px; }
  .so-underline { display: flex; gap: 6px; margin-bottom: 12px; }
  .so-underline span { height: 3px; border-radius: 2px; }
  .so-meta-tbl { border-collapse: collapse; }
  .so-meta-tbl td { padding: 3px 7px; font-size: 11.5px; }
  .so-meta-tbl .ml { color: #374151; font-weight: 500; white-space: nowrap; }
  .so-meta-tbl .ms { color: #9ca3af; }
  .so-meta-tbl .mv { color: #1a2b5c; font-weight: 700; }

  /* PAYMENT SUMMARY box (apparel) */
  .pay-summary { border: 1.5px solid #c7d7f5; border-radius: 10px; padding: 14px 16px; min-width: 220px; }
  .pay-summary h4 { font-size: 10px; font-weight: 800; letter-spacing: 1.2px; color: #1a2b5c; text-transform: uppercase; margin-bottom: 10px; display: flex; align-items: center; gap: 6px; }
  .pay-summary table { width: 100%; border-collapse: collapse; }
  .pay-summary td { padding: 3px 0; font-size: 12px; }
  .pay-summary .pl { color: #374151; }
  .pay-summary .pv { text-align: right; font-weight: 600; color: #111827; }
  .pay-summary .tr-bal td { border-top: 1.5px solid #e5e7eb; padding-top: 8px; font-weight: 800; font-size: 14px; color: #1a2b5c; }
  .bal-green { color: #16a34a !important; }

  /* ORDER SUMMARY box (dtf) */
  .ord-summary { background: #f8faff; border: 1.5px solid #c7d7f5; border-radius: 10px; padding: 12px 16px; min-width: 220px; }
  .ord-summary h4 { font-size: 9px; font-weight: 800; letter-spacing: 1.5px; color: #1a2b5c; text-transform: uppercase; display: flex; align-items: center; gap: 6px; margin-bottom: 8px; }
  .ord-summary table { width: 100%; border-collapse: collapse; }
  .ord-summary td { padding: 2.5px 0; font-size: 11.5px; }
  .ord-summary .ol { color: #374151; }
  .ord-summary .ov { text-align: right; font-weight: 500; color: #111827; }
  .ord-summary .ov.neg { color: #dc2626; }
  .ord-summary .tr-total td { border-top: 1.5px solid #1a2b5c; padding-top: 7px; font-weight: 800; font-size: 14px; color: #1a2b5c; }

  /* ── Info cards (4-column) ── */
  .info-cards { display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 12px; margin-bottom: 18px; }
  .ic { border: 1.5px solid #c7d7f5; border-radius: 10px; padding: 12px 14px; }
  .ic-head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
  .ic-icon { background: #1a2b5c; border-radius: 7px; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
  .ic-label { font-size: 9px; font-weight: 800; letter-spacing: 1.5px; color: #9ca3af; text-transform: uppercase; }
  .ic-body p { font-size: 11.5px; color: #4b5563; line-height: 1.7; }
  .ic-body .ic-name { font-size: 13px; font-weight: 700; color: #111827; margin-bottom: 2px; }
  .ic-body .ic-method { font-size: 13px; font-weight: 700; color: #111827; }
  .ic-body .ic-sub { font-size: 11px; color: #6b7280; margin-top: 1px; }
  .status-check { display: flex; align-items: center; gap: 7px; padding: 3px 0; font-size: 12px; font-weight: 500; color: #374151; }
  .chk-yes { color: #16a34a; font-size: 16px; font-weight: 900; }
  .chk-no  { color: #d1d5db; font-size: 16px; }

  /* ── Apparel table ── */
  .tbl-wrap { margin-bottom: 0; overflow-x: auto; }
  .so-tbl { width: 100%; border-collapse: collapse; font-size: 10.5px; }
  .so-tbl thead tr { background: #1a2b5c; color: #fff; }
  .so-tbl thead th {
    padding: 9px 5px; text-align: center;
    font-size: 9px; font-weight: 700; letter-spacing: 0.3px;
    text-transform: uppercase; white-space: nowrap;
    border-right: 1px solid rgba(255,255,255,0.12);
    vertical-align: middle;
  }
  .so-tbl thead th:last-child { border-right: none; }
  .th-l { text-align: left !important; }
  .so-tbl tbody tr { border-bottom: 1px solid #dbe4f5; }
  .so-tbl tbody td { padding: 7px 5px; text-align: center; vertical-align: middle; border-right: 1px solid #dbe4f5; }
  .so-tbl tbody td:last-child { border-right: none; }
  .td-l { text-align: left !important; }
  .td-span { background: #eef2ff !important; }
  .td-desc { font-weight: 700; color: #1a2b5c; font-size: 13px; text-align: center !important; line-height: 1.3; }
  .art-img { width: 52px; height: 52px; object-fit: contain; border-radius: 4px; border: 1px solid #e5e7eb; background: #fff; display: block; margin: 0 auto; }
  .art-empty { width: 52px; height: 52px; display: flex; align-items: center; justify-content: center; color: #d1d5db; font-size: 18px; margin: 0 auto; background: #f9fafb; border-radius: 4px; border: 1px dashed #e5e7eb; }
  .clr-dot { width: 12px; height: 12px; border-radius: 50%; display: inline-block; vertical-align: middle; margin-right: 3px; border: 1px solid rgba(0,0,0,0.12); }
  .sz-num { font-weight: 600; color: #111827; }
  .sz-zero { color: #d1d5db; }

  /* ── Stats bar ── */
  .stats-bar { width: 100%; border-collapse: collapse; }
  .stats-bar td { background: #1a2b5c; padding: 10px 14px; }
  .stats-bar td + td { border-left: 1px solid rgba(255,255,255,0.15); }
  .stats-bar .stat-last { background: #0f1f4e; }
  .stat-cell { display: flex; align-items: center; gap: 10px; }
  .stat-icon { background: rgba(255,255,255,0.1); border-radius: 6px; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; font-size: 17px; flex-shrink: 0; }
  .stat-lbl { font-size: 9px; font-weight: 600; letter-spacing: 0.8px; color: rgba(255,255,255,0.6); text-transform: uppercase; }
  .stat-val { font-size: 15px; font-weight: 800; color: #fff; margin-top: 1px; }

  /* ── Footer section ── */
  .footer-section { margin-top: 16px; display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .footer-box { border: 1.5px solid #c7d7f5; border-radius: 8px; padding: 12px 14px; }
  .footer-lbl { font-size: 9px; font-weight: 800; letter-spacing: 1.2px; text-transform: uppercase; color: #6b7280; margin-bottom: 8px; display: flex; align-items: center; gap: 5px; }
  .footer-words { font-size: 12px; font-weight: 600; color: #111827; line-height: 1.55; }
  .footer-bullets { list-style: none; }
  .footer-bullets li { display: flex; align-items: flex-start; gap: 6px; font-size: 11.5px; color: #374151; line-height: 1.6; }
  .footer-bullets li::before { content: '•'; color: #1a2b5c; font-weight: 700; flex-shrink: 0; margin-top: 1px; }
  .pay-detail-row { font-size: 12px; color: #374151; line-height: 1.7; }
  .pay-detail-row strong { color: #1a2b5c; }

  /* ── Thank you footer ── */
  .ty-footer { background: #1a2b5c; color: #fff; text-align: center; padding: 13px; border-radius: 8px; font-style: italic; font-size: 14px; font-weight: 600; margin-top: 14px; letter-spacing: 1px; }
  .ty-lines { font-size: 10px; opacity: 0.5; letter-spacing: 3px; }

  /* ── Print button ── */
  .print-btn { position: fixed; top: 16px; right: 16px; background: #1a2b5c; color: #fff; border: none; padding: 10px 20px; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; z-index: 999; display: flex; align-items: center; gap: 7px; box-shadow: 0 4px 12px rgba(0,0,0,0.2); }
  .print-btn:hover { background: #243d82; }
  .back-btn { position: fixed; top: 16px; left: 16px; background: #fff; color: #374151; border: 1.5px solid #d1d5db; padding: 9px 18px; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; z-index: 999; display: flex; align-items: center; gap: 6px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
  .back-btn:hover { background: #f9fafb; }

  /* ── Artworks section ── */
  .aw-section { margin-top: 16px; margin-bottom: 0; }
  .aw-section-hdr { display: flex; align-items: center; gap: 10px; background: #0f1f3d; color: #fff; padding: 10px 16px; border-radius: 8px 8px 0 0; }
  .aw-section-num { width: 26px; height: 26px; border-radius: 50%; background: rgba(255,255,255,0.15); display: flex; align-items: center; justify-content: center; font-size: 13px; flex-shrink: 0; }
  .aw-section-title { font-size: 11px; font-weight: 800; letter-spacing: 1.5px; text-transform: uppercase; }
  .aw-grid { border: 1.5px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px; background: #fff; }
  .aw-card { background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 8px; overflow: hidden; }
  .aw-img-wrap { width: 100%; background: #f8fafc; border-radius: 6px; overflow: hidden; display: flex; align-items: center; justify-content: center; margin-bottom: 6px; }
  .aw-img { width: 100%; object-fit: contain; display: block; }
  .aw-no-img { width: 100%; display: flex; align-items: center; justify-content: center; font-size: 10px; color: #9ca3af; font-style: italic; }
  .aw-meta { text-align: center; }
  .aw-no { font-size: 10px; font-weight: 700; color: #1a2b5c; letter-spacing: 0.3px; margin-bottom: 2px; }
  .aw-name { font-size: 10px; color: #6b7280; line-height: 1.3; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
`

// ── DTF group types ───────────────────────────────────────────────────────────
interface DtfRow { item: DtfItem; artNo: string; width: string; height: string }

// ── Main component ────────────────────────────────────────────────────────────
export function OrderPrintPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { authReady, authFailed } = usePrintAuth()

  // staleTime 0 + always refetch: edits made on the order form must show up
  // immediately when the preview is reopened.
  const { data: order, isLoading } = useQuery<Order>({
    queryKey: ['order', id],
    queryFn:  () => api.get(`/orders/${id}`).then(r => r.data.data ?? r.data.order ?? r.data),
    enabled: !!id && authReady,
    staleTime: 0, refetchOnMount: 'always',
  })

  // Linked invoice (if any) supplies the real amount-paid / balance / payment refs
  const { data: invoice } = useQuery<OrderInvoice | null>({
    queryKey: ['order-invoice-print', id, order?.invoice_id],
    queryFn:  () => api.get(`/invoices/${order!.invoice_id}`).then(r => r.data.data ?? r.data).catch(() => null),
    enabled:  !!order?.invoice_id && authReady,
    staleTime: 0, refetchOnMount: 'always',
  })

  const { data: artworkData } = useQuery<{ artworks: ArtworkItem[] }>({
    queryKey: ['order-artworks-print', id],
    queryFn:  () => api.get(`/orders/${id}/artworks`).then(r => r.data),
    enabled:  !!id && authReady,
    staleTime: 0, refetchOnMount: 'always',
  })
  const orderArtworks = artworkData?.artworks ?? []

  if (authFailed) return (
    <div style={{ display:'flex', flexDirection:'column', justifyContent:'center', alignItems:'center', height:'100vh', fontFamily:'Inter,sans-serif', gap:12 }}>
      <span style={{ fontSize:15, color:'#ef4444' }}>Session expired.</span>
      <a href="/login" style={{ fontSize:13, color:'#1a2b5c', fontWeight:600 }}>Log in again →</a>
    </div>
  )
  if (!authReady || isLoading) return (
    <div style={{ display:'flex', justifyContent:'center', alignItems:'center', height:'100vh', fontFamily:'Inter,sans-serif', fontSize:15, color:'#6b7280' }}>
      Loading order…
    </div>
  )
  if (!order) return (
    <div style={{ display:'flex', justifyContent:'center', alignItems:'center', height:'100vh', fontFamily:'Inter,sans-serif', fontSize:15, color:'#ef4444' }}>
      Order not found.
    </div>
  )

  const isApparel   = order.order_type === 'apparel'
  const isDtf       = order.order_type === 'dtf'
  const isGangsheet = order.order_type === 'gangsheet'

  const allItems    = order.items ?? []
  const apparelItems = isApparel ? (allItems as ApparelItem[]) : []
  // Mockup columns only render when at least one item actually has a mockup
  const hasFrontMockup = apparelItems.some(i => i.front_mockup)
  const hasBackMockup  = apparelItems.some(i => i.back_mockup)
  const apparelCols = 14 + (hasFrontMockup ? 1 : 0) + (hasBackMockup ? 1 : 0)
  const dtfItems     = isDtf     ? (allItems as DtfItem[])     : []
  const gsItems      = isGangsheet ? (allItems as GangsheetItem[]) : []

  const totalQty   = allItems.reduce((s: number, i: any) => s + (Number(i.qty) || 0), 0)
  const itemsTotal = allItems.reduce((s: number, i: any) => s + (Number(i.amount) || 0), 0)
  const shippingAmt = Number(order.shipping_charges ?? 0)
  const subtotalPlus = itemsTotal + shippingAmt

  // PAYMENT SUMMARY — prefer the linked invoice's real ledger figures; fall
  // back to the order's own payment_status (Paid = fully paid, else unpaid).
  const isPaid = order.payment_status === 'Paid' || invoice?.status === 'Paid'
  const amountPaid = isPaid
    ? Number(order.total)
    : invoice
      ? Number(invoice.amount_paid || 0)
      : 0
  const balanceDue = isPaid
    ? 0
    : Math.max(0, invoice ? Number(invoice.balance_due || 0) : Number(order.total) - amountPaid)
  const lastPayment = invoice?.payments?.length ? invoice.payments[invoice.payments.length - 1] : null

  // ORDER STATUS checks
  const statusOrder = ['Draft', 'Confirmed', 'In Production', 'Ready to Ship', 'Shipped', 'Delivered']
  const statusIdx = statusOrder.indexOf(order.status)
  const paymentReceived     = order.payment_status === 'Paid' || order.payment_status === 'Partial'
  const approvedProduction  = statusIdx >= 1   // Confirmed or beyond
  const artworksApproved    = statusIdx >= 1

  // Customer/shipping info
  const custName    = order.supplier_name || order.contact_name || '—'
  const shipName    = order.shipping_name || custName
  const shipAddr    = order.shipping_address || '—'
  const shipMethod  = order.shipping_method || 'Standard Shipping'

  // Payment method display
  const payMethodDisplay = order.payment_method
    ?.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()) ?? '—'

  // ── Build DTF rows using the same field model as the quotation ──────────────
  const dtfFlat: DtfRow[] = dtfItems.map((item, idx) => {
    const legacy = String(item.size ?? '').match(/([\d.]+)\s*(?:"|in)?\s*[x×]\s*([\d.]+)/i)
    return {
      item,
      artNo: item.artwork_no || (!legacy && item.artwork_name !== 'DTF Transfer' ? item.artwork_name : '') || `AW-TF-${String(idx + 1).padStart(3, '0')}`,
      width: String(item.width_inches ?? legacy?.[1] ?? '—'),
      height: String(item.height_inches ?? legacy?.[2] ?? '—'),
    }
  })

  return (
    <ArtworkLightboxProvider>
      <style>{CSS}</style>
      <button className="back-btn no-print" onClick={() => navigate(-1)}>
        ← Back
      </button>
      <button className="print-btn no-print" onClick={() => window.print()}>
        🖨️ Download / Print PDF
      </button>

      <div className="page">

        {/* ══ HEADER ══ */}
        <div className="hdr">

          {/* Left: Logo + Company */}
          <div className="hdr-left">
            <div>
              <img src="/decoinks-logo.png" alt="Decoinks" className="print-logo-img" />
              <div className="logo-tag">PRINTSHOP OS</div>
            </div>
            <div className="co-info">
              <span className="co-line">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#1a2b5c" strokeWidth="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                {CO.address}
              </span>
              <span className="co-line" style={{ paddingLeft: 18 }}>{CO.city}</span>
              <span className="co-line">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#1a2b5c" strokeWidth="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
                {CO.email}
              </span>
              <span className="co-line">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#1a2b5c" strokeWidth="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.71 3.18 2 2 0 0 1 3.68 1h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 8.91a16 16 0 0 0 6 6l.91-.91a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
                {CO.phone}
              </span>
            </div>
          </div>

          {/* Divider */}
          <div className="hdr-divider" />

          {/* Center: SALES ORDER + meta */}
          <div className="hdr-center">
            <div className="so-title">SALES ORDER</div>
            <div className="so-underline">
              <span style={{ width: 60, background: '#1a2b5c' }} />
              <span style={{ width: 20, background: '#06b6d4' }} />
            </div>
            <table className="so-meta-tbl">
              <tbody>
                <tr>
                  <td className="ml">Sales Order #</td>
                  <td className="ms">:</td>
                  <td className="mv">{order.order_number}</td>
                </tr>
                <tr>
                  <td className="ml">Order Date</td>
                  <td className="ms">:</td>
                  <td className="mv">{fmtDate(order.order_date)}</td>
                </tr>
                <tr>
                  <td className="ml">Customer Ref #</td>
                  <td className="ms">:</td>
                  <td className="mv">{order.contact_name || order.supplier_name || '—'}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Right: financial summary — Payment Summary for apparel, Order
              Summary for DTF / gangsheet (matches the approved templates) */}
          <div className="hdr-right">
            {isApparel ? (
              <div className="pay-summary">
                <h4>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#1a2b5c" strokeWidth="2.5"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>
                  PAYMENT SUMMARY
                </h4>
                <table>
                  <tbody>
                    <tr><td className="pl">Order Total</td><td className="pv">{fmt(order.total)}</td></tr>
                    <tr><td className="pl">Amount Paid</td><td className="pv">{fmt(amountPaid)}</td></tr>
                    <tr className="tr-bal">
                      <td>Balance Due</td>
                      <td className={`pv ${balanceDue <= 0 ? 'bal-green' : ''}`} style={balanceDue > 0 ? { color: '#dc2626' } : undefined}>{fmt(balanceDue)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="ord-summary">
                <h4>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#1a2b5c" strokeWidth="2.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                  ORDER SUMMARY
                </h4>
                <table>
                  <tbody>
                    <tr><td className="ol">Items Total</td><td className="ov">{fmt(itemsTotal)}</td></tr>
                    <tr><td className="ol">Shipping Charges</td><td className="ov">{fmt(shippingAmt)}</td></tr>
                    <tr><td className="ol">Subtotal</td><td className="ov">{fmt(subtotalPlus)}</td></tr>
                    {Number(order.discount_amt) > 0 && (
                      <tr><td className="ol">Bulk Discount</td><td className="ov neg">{'-' + fmt(order.discount_amt)}</td></tr>
                    )}
                    <tr><td className="ol">Tax</td><td className="ov">{fmt(order.tax_amt)}</td></tr>
                    <tr className="tr-total"><td>TOTAL DUE</td><td className="ov" style={{ fontWeight: 800 }}>{fmt(balanceDue)}</td></tr>
                  </tbody>
                </table>
              </div>
            )}
          </div>

        </div>

        {/* ══ INFO CARDS (4 columns) ══ */}
        <div className="info-cards">

          <div className="ic">
            <div className="ic-head">
              <div className="ic-icon">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
              </div>
              <span className="ic-label">Customer</span>
            </div>
            <div className="ic-body">
              <p className="ic-name">{custName}</p>
              {order.contact_email && <p>{order.contact_email}</p>}
              {order.contact_phone && <p>{order.contact_phone}</p>}
            </div>
          </div>

          <div className="ic">
            <div className="ic-head">
              <div className="ic-icon">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>
              </div>
              <span className="ic-label">Shipping Address</span>
            </div>
            <div className="ic-body">
              <p className="ic-name">{shipName}</p>
              {shipAddr !== '—' && <p>{shipAddr}</p>}
              <p>United States</p>
            </div>
          </div>

          <div className="ic">
            <div className="ic-head">
              <div className="ic-icon">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>
              </div>
              <span className="ic-label">Shipping Method</span>
            </div>
            <div className="ic-body">
              <p className="ic-method">{shipMethod}</p>
              <p className="ic-sub">(5–7 Business Days)</p>
            </div>
          </div>

          <div className="ic">
            <div className="ic-head">
              <div className="ic-icon">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
              </div>
              <span className="ic-label">Order Status</span>
            </div>
            <div className="ic-body">
              <div className="status-check">
                <span className={paymentReceived ? 'chk-yes' : 'chk-no'}>✓</span>
                Payment Received
              </div>
              <div className="status-check">
                <span className={approvedProduction ? 'chk-yes' : 'chk-no'}>✓</span>
                Approved for Production
              </div>
              <div className="status-check">
                <span className={artworksApproved ? 'chk-yes' : 'chk-no'}>✓</span>
                Artworks Approved
              </div>
            </div>
          </div>

        </div>

        {/* ══ ITEMS TABLE ══ */}
        <div className="tbl-wrap">
          {isApparel && (
            <table className="so-tbl">
              <thead>
                <tr>
                  <th rowSpan={2} style={{ width: 34 }}>#</th>
                  <th rowSpan={2} className="th-l" style={{ minWidth: 130 }}>Item Description</th>
                  <th rowSpan={2} style={{ width: 84 }}>Color</th>
                  <th rowSpan={2} style={{ width: 62 }}>Qty<br />(Pcs)</th>
                  <th colSpan={6} style={{ borderBottom: '1px solid rgba(255,255,255,0.25)' }}>Size Breakdown</th>
                  <th rowSpan={2} style={{ width: 74 }}>Front Artwork<br />(Thumbnail)</th>
                  <th rowSpan={2} style={{ width: 74 }}>Back Artwork<br />(Thumbnail)</th>
                  {hasFrontMockup && <th rowSpan={2} style={{ width: 74 }}>Front Mockup</th>}
                  {hasBackMockup && <th rowSpan={2} style={{ width: 74 }}>Back Mockup</th>}
                  <th rowSpan={2} style={{ width: 74 }}>Unit Price<br />(USD)</th>
                  <th rowSpan={2} style={{ width: 78 }}>Total<br />(USD)</th>
                </tr>
                <tr>
                  {SIZE_COLS.map(s => <th key={s} style={{ width: 34 }}>{s}</th>)}
                </tr>
              </thead>
              <tbody>
                {apparelItems.length === 0 ? (
                  <tr><td colSpan={apparelCols} style={{ padding: 24, textAlign: 'center', color: '#9ca3af' }}>No items</td></tr>
                ) : apparelItems.map((item, idx) => {
                  const sizes = parseSizes(item.size, Number(item.qty) || 0)
                  return (
                    <tr key={item.id}>
                      <td style={{ fontWeight: 600 }}>{idx + 1}</td>
                      <td className="td-l">
                        <strong style={{ color: '#1a2b5c' }}>{item.item}</strong>
                        {(item.brand || item.model || item.catalog_sku) && (
                          <><br /><small style={{ color: '#6b7280' }}>{[item.brand, item.model, item.catalog_sku].filter(Boolean).join(' · ')}</small></>
                        )}
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <span className="clr-dot" style={{ background: colorHex(item.color) }} />
                        {item.color || '—'}
                      </td>
                      <td style={{ fontWeight: 700 }}>{item.qty}</td>
                      {SIZE_COLS.map(s => (
                        <td key={s} className={sizes[s] ? 'sz-num' : 'sz-zero'}>{sizes[s]}</td>
                      ))}
                      <td><ArtworkThumb src={item.front_image} alt="front artwork" label={`${item.artwork_no || item.item} — Front`} className="art-img" fallback={<div className="art-empty">—</div>} /></td>
                      <td><ArtworkThumb src={item.back_image} alt="back artwork" label={`${item.artwork_no || item.item} — Back`} className="art-img" fallback={<div className="art-empty">—</div>} /></td>
                      {hasFrontMockup && <td><ArtworkThumb src={item.front_mockup} alt="front mockup" label={`${item.artwork_no || item.item} — Front Mockup`} className="art-img" fallback={<div className="art-empty">—</div>} /></td>}
                      {hasBackMockup && <td><ArtworkThumb src={item.back_mockup} alt="back mockup" label={`${item.artwork_no || item.item} — Back Mockup`} className="art-img" fallback={<div className="art-empty">—</div>} /></td>}
                      <td style={{ fontWeight: 500 }}>{fmt(item.unit_price)}</td>
                      <td style={{ fontWeight: 700 }}>{fmt(item.amount)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}

          {isDtf && (
            /* DTF — same fields and sequence as the quotation */
            <table className="so-tbl">
              <thead>
                <tr>
                  <th style={{ width: 40 }}>S.No</th>
                  <th style={{ width: 110 }}>Artwork No</th>
                  <th style={{ width: 80 }}>Width<br />(IN)</th>
                  <th style={{ width: 80 }}>Height<br />(IN)</th>
                  <th style={{ width: 80 }}>Qty<br />(Transfers)</th>
                  <th style={{ width: 88 }}>Artwork</th>
                  <th style={{ width: 76 }}>Rate<br />(USD)</th>
                  <th style={{ width: 82 }}>Amount<br />(USD)</th>
                </tr>
              </thead>
              <tbody>
                {dtfFlat.length === 0 ? (
                  <tr><td colSpan={8} style={{ padding: 24, textAlign: 'center', color: '#9ca3af' }}>No items</td></tr>
                ) : dtfFlat.map((r, sno) => (
                  <tr key={r.item.id}>
                    <td style={{ fontWeight: 600, color: '#374151' }}>{sno + 1}</td>
                    <td style={{ fontWeight: 600, color: '#374151', fontSize: 10.5 }}>{r.artNo}</td>
                    <td style={{ fontWeight: 500 }}>{r.width}</td>
                    <td style={{ fontWeight: 500 }}>{r.height}</td>
                    <td style={{ fontWeight: 600 }}>{r.item.qty}</td>
                    <td>
                      <ArtworkThumb src={r.item.front_image ?? r.item.artwork_image} alt={r.artNo} label={r.artNo} className="art-img" fallback={<div className="art-empty">🖼</div>} />
                    </td>
                    <td style={{ fontWeight: 700 }}>{fmt(r.item.unit_price)}</td>
                    <td style={{ fontWeight: 600 }}>{fmt(r.item.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {isGangsheet && (
            /* Gangsheet table */
            <table className="so-tbl">
              <thead>
                <tr>
                  <th style={{ width: 40 }}>#</th>
                  <th className="th-l">Size</th>
                  <th style={{ width: 80 }}>No. Artworks</th>
                  <th style={{ width: 70 }}>Qty</th>
                  <th style={{ width: 80 }}>Price/Sheet</th>
                  <th style={{ width: 80 }}>Amount</th>
                  <th style={{ width: 68 }}>Front Art</th>
                  <th style={{ width: 68 }}>Back Art</th>
                </tr>
              </thead>
              <tbody>
                {gsItems.length === 0 ? (
                  <tr><td colSpan={8} style={{ padding: 24, textAlign: 'center', color: '#9ca3af' }}>No items</td></tr>
                ) : gsItems.map((item, idx) => (
                  <tr key={item.id}>
                    <td>{idx + 1}</td>
                    <td className="td-l" style={{ fontWeight: 500 }}>{item.size || '—'}</td>
                    <td>{item.no_artworks}</td>
                    <td style={{ fontWeight: 600 }}>{item.qty}</td>
                    <td>{fmt(item.price_per_sheet)}</td>
                    <td style={{ fontWeight: 700 }}>{fmt(item.amount)}</td>
                    <td>
                      <ArtworkThumb src={item.front_image} alt="front" label={`Gangsheet ${idx + 1} — Front`} className="art-img" fallback={<div className="art-empty">—</div>} />
                    </td>
                    <td>
                      <ArtworkThumb src={item.back_image} alt="back" label={`Gangsheet ${idx + 1} — Back`} className="art-img" fallback={<div className="art-empty" style={{ color: '#d1d5db' }}>—</div>} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {/* ══ STATS BAR ══ */}
          <table className="stats-bar">
            <tbody>
              <tr>
                <td style={{ width: isApparel ? '33%' : '25%' }}>
                  <div className="stat-cell">
                    <div className="stat-icon">👕</div>
                    <div>
                      <div className="stat-lbl">Total Items</div>
                      <div className="stat-val">{isDtf ? dtfItems.length : allItems.length}</div>
                    </div>
                  </div>
                </td>
                {isDtf && (
                  <td style={{ width: '25%' }}>
                    <div className="stat-cell">
                      <div className="stat-icon">🖼</div>
                      <div>
                        <div className="stat-lbl">Total Artworks</div>
                        <div className="stat-val">{dtfItems.length}</div>
                      </div>
                    </div>
                  </td>
                )}
                <td style={{ width: isApparel ? '33%' : '25%' }}>
                  <div className="stat-cell">
                    <div className="stat-icon">📦</div>
                    <div>
                      <div className="stat-lbl">{isDtf ? 'Total Qty (Transfers)' : 'Total Quantity'}</div>
                      <div className="stat-val">{totalQty}{!isDtf ? ' PCS' : ''}</div>
                    </div>
                  </div>
                </td>
                <td className="stat-last" style={{ width: isApparel ? '33%' : '25%' }}>
                  <div className="stat-cell">
                    <div className="stat-icon">🧮</div>
                    <div>
                      <div className="stat-lbl">{isDtf ? 'Items Total' : 'Total Amount'}</div>
                      <div className="stat-val">{fmt(isDtf ? itemsTotal : order.total)}</div>
                    </div>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* ══ ARTWORKS SECTION (gangsheet only — apparel/DTF tables carry thumbnails inline) ══ */}
        {isGangsheet && orderArtworks.length > 0 && (
          <div className="aw-section">
            <div className="aw-section-hdr">
              <div className="aw-section-num">★</div>
              <div className="aw-section-title">ARTWORKS ({orderArtworks.length})</div>
            </div>
            <div className="aw-grid" style={{
              display: 'grid',
              gridTemplateColumns: `repeat(${orderArtworks.length <= 2 ? 2 : orderArtworks.length <= 6 ? 3 : orderArtworks.length <= 12 ? 4 : 5}, 1fr)`,
              gap: 8,
              padding: '12px',
            }}>
              {orderArtworks.slice(0, 20).map((aw) => {
                const imgHeight = orderArtworks.length <= 2 ? 120 : orderArtworks.length <= 6 ? 90 : orderArtworks.length <= 12 ? 70 : 55
                return (
                  <div key={aw.id} className="aw-card">
                    <div className="aw-img-wrap" style={{ height: imgHeight }}>
                      {aw.file_url && aw.file_type !== 'pdf'
                        ? <ArtworkThumb src={aw.file_url} alt={aw.name} label={`${aw.artwork_no} — ${aw.name}`} className="aw-img" style={{ height: imgHeight }} />
                        : <div className="aw-no-img" style={{ height: imgHeight }}>No Image</div>
                      }
                    </div>
                    <div className="aw-meta">
                      <div className="aw-no">{aw.artwork_no}</div>
                      <div className="aw-name">{aw.name}</div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* ══ FOOTER ══ */}
        <div className="footer-section">
          {/* Left: amount in words (DTF/gangsheet) or notes (apparel) */}
          {isApparel ? (
            <div className="footer-box">
              <div className="footer-lbl">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
                Notes
              </div>
              <ul className="footer-bullets">
                {order.notes
                  ? order.notes.split(/\r?\n/).filter(Boolean).map((line, i) => <li key={i}>{line}</li>)
                  : <>
                      <li>Please review and confirm all details before production.</li>
                      <li>Colors may vary slightly due to monitor settings.</li>
                    </>}
              </ul>
            </div>
          ) : (
            <div className="footer-box">
              <div className="footer-lbl">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
                Total Amount in Words
              </div>
              <div className="footer-words">{numberToWords(Number(order.total || 0))}</div>
            </div>
          )}

          {/* Right: payment details from the real ledger */}
          <div className="footer-box">
            <div className="footer-lbl">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>
              Payment Details
            </div>
            {lastPayment ? (
              <>
                <div className="pay-detail-row">
                  <strong>Paid thru {(lastPayment.payment_method || 'payment').replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}</strong> as on {fmtDate(lastPayment.paid_at)}
                </div>
                {lastPayment.reference_no && (
                  <div className="pay-detail-row"><strong>Transaction ID:</strong> {lastPayment.reference_no}</div>
                )}
              </>
            ) : (
              <>
                <div className="pay-detail-row"><strong>Payment Status:</strong> {order.payment_status}</div>
                <div className="pay-detail-row"><strong>Payment Terms:</strong> {order.payment_terms || 'Due on Receipt'}</div>
                {order.payment_method && <div className="pay-detail-row"><strong>Method:</strong> {payMethodDisplay}</div>}
              </>
            )}
            {order.invoice_number && (
              <div className="pay-detail-row"><strong>Invoice Reference:</strong> {order.invoice_number}</div>
            )}
            <div className="pay-detail-row" style={{ marginTop: 4, color: '#6b7280', fontSize: 10.5 }}>
              {CO.email}
            </div>
          </div>
        </div>

        {/* ══ THANK YOU ══ */}
        <div className="ty-footer">
          <span className="ty-lines">—————</span>
          {' '}Thank you for your business!{' '}
          <span className="ty-lines">—————</span>
        </div>

      </div>
      <ArtworkLightboxOverlay />
    </ArtworkLightboxProvider>
  )
}
