import { useParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '../services/api'
import { usePrintAuth } from '../hooks/usePrintAuth'

// ── Types ─────────────────────────────────────────────────────────────────────
interface Payment { paid_at: string; method: string; amount: number; reference: string | null }
interface InvoiceItem {
  id: string; description: string; qty: number
  unit_price: number; amount: number; artwork_count: number
  sizes?: string | null; colors?: string | null
  front_image?: string | null; back_image?: string | null; artwork_image?: string | null
}
interface Invoice {
  id: string; invoice_number: string; status: string
  issue_date: string | null; due_date: string | null
  subtotal: number; discount_amt: number
  total: number
  shipping_charges?: number | null
  payment_method?: string | null
  payment_terms?: string | null
  notes: string | null; supplier_name: string | null
  customer_name: string | null
  billing_email: string | null; contact_number: string | null
  billing_address: string | null; shipping_address: string | null
  order_type: string | null
  quote_id: string | null; order_id: string | null
  payments: Payment[]
  items: InvoiceItem[]
}
interface QuoteItem {
  id: string; description: string; qty: number
  unit_price: number; amount: number
  sizes: string | null; colors: string | null; artwork_count: number
  front_image?: string | null; back_image?: string | null; artwork_image?: string | null
}
interface Quotation {
  id: string; order_type: string | null
  company_name: string | null; customer_name: string | null
  billing_email: string | null; contact_number: string | null
  billing_address: string | null; shipping_address: string | null
  shipping_city: string | null; shipping_state: string | null
  shipping_country: string | null; zip_code: string | null
  items: QuoteItem[]
}
interface Artwork {
  id: string; artwork_no: string; name: string
  file_url: string | null; file_type: string | null
  width_inches: number | null; height_inches: number | null
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
  const centsStr = cents > 0 ? ` and ${below1000(cents).trim()} Cents` : ''
  return r.trim() + ' Dollars' + centsStr + ' Only'
}

function colorHex(c: string | null) {
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

// ── Company constants ─────────────────────────────────────────────────────────
const CO = {
  address: 'Suite 111, 1218 Magnolia Avenue',
  city: 'Corona, CA 92881, United States',
  email: 'info@decoinks.com',
  phone: '+1 (714) 790-1460',
  zelle: 'info@decoinks.com',
  paypal: 'info@decoinks.com',
}

// ── Simple QR placeholder SVG ─────────────────────────────────────────────────
function QrBox() {
  const cells: JSX.Element[] = []
  // Deterministic "QR-like" pattern using a fixed seed
  const pattern = [
    1,1,1,0,1,0,1, 1,0,1,0,1,1,1, 0,1,1,0,1,0,1, 1,0,1,1,0,1,0,
    1,1,1,0,0,1,1, 0,1,0,1,0,1,0, 1,1,1,0,1,1,1, 1,0,0,1,0,0,1,
    0,1,0,1,1,0,0, 1,0,1,1,0,1,1, 0,0,1,0,0,1,0, 1,1,0,1,1,0,1,
    1,0,1,0,1,0,0, 0,1,1,0,1,0,1, 1,1,0,1,0,1,1, 0,1,0,0,1,1,0,
  ]
  for (let r = 0; r < 9; r++) {
    for (let c2 = 0; c2 < 9; c2++) {
      let fill = '#f9fafb'
      // Top-left finder
      if (r < 3 && c2 < 3) fill = '#111827'
      else if (r >= 1 && r <= 2 && c2 >= 1 && c2 <= 2 && !(r===2&&c2===2)) fill = '#fff'
      else if (r === 1 && c2 === 1) fill = '#111827'
      // Top-right finder
      else if (r < 3 && c2 > 5) fill = '#111827'
      else if (r >= 1 && r <= 2 && c2 >= 6 && c2 <= 7) fill = '#fff'
      else if (r === 1 && c2 === 7) fill = '#111827'
      // Bottom-left finder
      else if (r > 5 && c2 < 3) fill = '#111827'
      else if (r >= 6 && r <= 7 && c2 >= 1 && c2 <= 2) fill = '#fff'
      else if (r === 7 && c2 === 1) fill = '#111827'
      // Data cells
      else fill = pattern[(r * 9 + c2) % pattern.length] ? '#111827' : '#f9fafb'
      cells.push(
        <rect key={`${r}-${c2}`} x={c2 * 6 + 1} y={r * 6 + 1} width={5} height={5} fill={fill} />
      )
    }
  }
  return (
    <svg width="56" height="56" viewBox="0 0 56 56" style={{ display: 'block', margin: '0 auto' }}>
      <rect width="56" height="56" fill="#fff" rx="3"/>
      {cells}
    </svg>
  )
}

// ── CSS ───────────────────────────────────────────────────────────────────────
const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Inter', sans-serif; font-size: 12px; color: #111827; background: #fff; }
  .page { max-width: 980px; margin: 0 auto; padding: 28px; }
  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .no-print { display: none !important; }
    .page { padding: 14px; }
    @page { margin: 7mm; size: A4 landscape; }
  }

  /* ── Header ── */
  .hdr {
    display: grid;
    grid-template-columns: 240px 1px 1fr;
    gap: 0 24px;
    margin-bottom: 18px;
    padding-bottom: 20px;
    border-bottom: 2px solid #e5e7eb;
  }
  .hdr-left { display: flex; flex-direction: column; gap: 10px; }
  .hdr-divider { background: #d1d5db; }
  .hdr-right { padding-left: 4px; display: flex; flex-direction: column; gap: 12px; }

  .print-logo-img { height: 42px; width: auto; object-fit: contain; display: block; }
  .logo-tag { font-size: 8.5px; font-weight: 700; letter-spacing: 2.5px; color: #6b7280; text-transform: uppercase; margin-top: 2px; }
  .co-info { display: flex; flex-direction: column; }
  .co-line { display: flex; align-items: center; gap: 6px; font-size: 11px; color: #4b5563; line-height: 1.85; }
  .co-line svg { flex-shrink: 0; }

  .inv-title { font-size: 56px; font-weight: 900; color: #1a2b5c; letter-spacing: 8px; line-height: 1; }
  .inv-meta-row { display: flex; gap: 16px; align-items: flex-start; }
  .inv-meta-tbl { border-collapse: collapse; }
  .inv-meta-tbl td { padding: 3px 8px; font-size: 12px; }
  .inv-meta-tbl .ml { color: #374151; font-weight: 500; white-space: nowrap; }
  .inv-meta-tbl .ms { color: #9ca3af; }
  .inv-meta-tbl .mv { color: #1a2b5c; font-weight: 700; }
  .inv-meta-tbl tr:last-child td { border-bottom: 1.5px solid #1a2b5c; padding-bottom: 6px; }

  .summary-box { background: #f8faff; border: 1.5px solid #c7d7f5; border-radius: 10px; padding: 12px 16px; min-width: 220px; flex: 1; }
  .summary-box h4 { font-size: 9px; font-weight: 800; letter-spacing: 1.5px; color: #1a2b5c; text-transform: uppercase; display: flex; align-items: center; gap: 6px; margin-bottom: 9px; }
  .summary-box table { width: 100%; border-collapse: collapse; }
  .summary-box td { padding: 2.5px 0; font-size: 11.5px; }
  .summary-box .sl { color: #374151; }
  .summary-box .sv { text-align: right; font-weight: 500; color: #111827; }
  .summary-box .sv.neg { color: #dc2626; }
  .summary-box .tr-total td { border-top: 1.5px solid #1a2b5c; padding-top: 8px; font-weight: 800; font-size: 14px; color: #1a2b5c; }

  /* ── Info cards ── */
  .info-cards { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; margin-bottom: 18px; }
  .ic { border: 1.5px solid #e5e7eb; border-radius: 10px; padding: 12px 14px; }
  .ic-head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
  .ic-icon { background: #1a2b5c; border-radius: 7px; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
  .ic-label { font-size: 9px; font-weight: 800; letter-spacing: 1.5px; color: #9ca3af; text-transform: uppercase; }
  .ic-body p { font-size: 11.5px; color: #4b5563; line-height: 1.7; }
  .ic-body .ic-name { font-size: 13px; font-weight: 700; color: #111827; margin-bottom: 2px; }

  /* ── Table ── */
  .tbl-wrap { margin-bottom: 0; }
  .inv-tbl { width: 100%; border-collapse: collapse; font-size: 11px; }
  .inv-tbl thead tr { background: #1a2b5c; color: #fff; }
  .inv-tbl thead th {
    padding: 10px 7px; text-align: center;
    font-size: 9.5px; font-weight: 700; letter-spacing: 0.4px;
    text-transform: uppercase; white-space: nowrap;
    border-right: 1px solid rgba(255,255,255,0.12);
  }
  .inv-tbl thead th:last-child { border-right: none; }
  .th-l { text-align: left !important; }
  .inv-tbl tbody tr { border-bottom: 1px solid #f0f0f0; }
  .inv-tbl tbody td { padding: 7px 7px; text-align: center; vertical-align: middle; border-right: 1px solid #f0f0f0; }
  .inv-tbl tbody td:last-child { border-right: none; }
  .td-l { text-align: left !important; }
  .td-span { background: #eef2ff !important; }
  .td-desc { font-weight: 700; color: #1a2b5c; font-size: 13px; line-height: 1.3; text-align: center !important; }
  .art-thumb { width: 54px; height: 54px; object-fit: contain; border-radius: 4px; border: 1px solid #e5e7eb; background: #fff; display: block; margin: 0 auto; }
  .art-empty { width: 54px; height: 54px; display: flex; align-items: center; justify-content: center; color: #d1d5db; font-size: 22px; margin: 0 auto; background: #f9fafb; border-radius: 4px; border: 1px dashed #e5e7eb; }
  .color-dot { width: 13px; height: 13px; border-radius: 50%; display: inline-block; vertical-align: middle; margin-right: 3px; border: 1px solid rgba(0,0,0,0.15); }

  /* ── Stats bar (dark navy) ── */
  .stats-bar { width: 100%; border-collapse: collapse; border-radius: 0 0 6px 6px; overflow: hidden; }
  .stats-bar td { background: #1a2b5c; padding: 10px 14px; }
  .stats-bar td + td { border-left: 1px solid rgba(255,255,255,0.15); }
  .stat-cell { display: flex; align-items: center; gap: 10px; }
  .stat-icon { background: rgba(255,255,255,0.1); border-radius: 6px; width: 34px; height: 34px; display: flex; align-items: center; justify-content: center; font-size: 17px; flex-shrink: 0; }
  .stat-lbl { font-size: 9px; font-weight: 600; letter-spacing: 0.8px; color: rgba(255,255,255,0.6); text-transform: uppercase; }
  .stat-val { font-size: 15px; font-weight: 800; color: #fff; margin-top: 1px; }

  /* ── Payment footer ── */
  .pay-section { margin-top: 16px; }
  .pay-footer { display: grid; grid-template-columns: 1.7fr 1fr 1fr 1fr 1fr; gap: 10px; }
  .pay-box { border: 1.5px solid #e5e7eb; border-radius: 8px; padding: 10px 12px; }
  .pay-lbl { font-size: 8.5px; font-weight: 800; letter-spacing: 1px; text-transform: uppercase; color: #6b7280; margin-bottom: 6px; display: flex; align-items: center; gap: 5px; }
  .pay-words { font-size: 12px; color: #111827; font-weight: 600; line-height: 1.55; }
  .zelle-txt  { font-size: 26px; font-weight: 900; color: #6d28d9; letter-spacing: -1px; font-style: italic; line-height: 1; }
  .paypal-txt { font-size: 18px; font-weight: 900; color: #003087; line-height: 1; }
  .paypal-txt span { color: #009cde; }
  .pay-email  { font-size: 10px; color: #1a2b5c; font-weight: 600; margin-top: 3px; }
  .pay-note   { font-size: 9.5px; color: #6b7280; margin-top: 2px; line-height: 1.4; }
  .card-logos { display: flex; gap: 4px; flex-wrap: wrap; margin-top: 5px; }
  .card-logos span { font-size: 7.5px; font-weight: 800; padding: 2px 5px; border-radius: 3px; }
  .lv { background: #1a1f71; color: #fff; }
  .lm { background: #eb001b; color: #fff; }
  .la { background: #007bc1; color: #fff; }
  .ld { background: #f76f20; color: #fff; }
  .bank-lbl { font-size: 12px; font-weight: 800; color: #1a2b5c; display: flex; align-items: center; gap: 5px; }

  /* ── Thank you footer ── */
  .ty-footer { background: #1a2b5c; color: #fff; text-align: center; padding: 13px; border-radius: 8px; font-style: italic; font-size: 14px; font-weight: 600; margin-top: 14px; letter-spacing: 1px; }
  .ty-lines { font-size: 10px; opacity: 0.5; letter-spacing: 2px; margin: 0 8px; }

  /* ── Print button ── */
  .print-btn { position: fixed; top: 16px; right: 16px; background: #1a2b5c; color: #fff; border: none; padding: 10px 20px; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; z-index: 999; display: flex; align-items: center; gap: 7px; box-shadow: 0 4px 12px rgba(0,0,0,0.2); }
  .print-btn:hover { background: #243d82; }
  .back-btn { position: fixed; top: 16px; left: 16px; background: #fff; color: #374151; border: 1.5px solid #d1d5db; padding: 9px 18px; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; z-index: 999; display: flex; align-items: center; gap: 6px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
  .back-btn:hover { background: #f9fafb; }

  /* ── Artworks section ── */
  .aw-section { margin-bottom: 18px; }
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
interface DtfRow  { item: QuoteItem | InvoiceItem; art: Artwork | null; artNo: string; sizeStr: string }
interface DtfGroup { desc: string; rate: number; rowSpan: number; rows: DtfRow[] }

// ── Main component ────────────────────────────────────────────────────────────
export function InvoicePrintPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { authReady, authFailed } = usePrintAuth()

  const { data: invoice, isLoading } = useQuery<Invoice>({
    queryKey: ['invoice', id],
    queryFn:  () => api.get(`/invoices/${id}`).then(r => r.data.data ?? r.data.invoice ?? r.data),
    enabled: !!id && authReady,
  })

  const { data: quotation } = useQuery<Quotation>({
    queryKey: ['quotation', invoice?.quote_id],
    queryFn:  () => api.get(`/quotations/${invoice!.quote_id}`).then(r => r.data.data ?? r.data.quotation ?? r.data),
    enabled:  !!invoice?.quote_id && authReady,
  })

  const { data: artworkData } = useQuery<{ artworks: Artwork[] }>({
    queryKey: ['quote-artworks', invoice?.quote_id],
    queryFn:  () => api.get(`/quotations/${invoice!.quote_id}/artworks`).then(r => r.data),
    enabled:  !!invoice?.quote_id && authReady,
  })

  const { data: invoiceArtworkData } = useQuery<{ artworks: Artwork[] }>({
    queryKey: ['invoice-artworks-print', id],
    queryFn:  () => api.get(`/invoices/${id}/artworks`).then(r => r.data),
    enabled:  !!id && authReady,
  })

  if (authFailed) return (
    <div style={{ display:'flex', flexDirection:'column', justifyContent:'center', alignItems:'center', height:'100vh', fontFamily:'Inter,sans-serif', gap:12 }}>
      <span style={{ fontSize:15, color:'#ef4444' }}>Session expired.</span>
      <a href="/login" style={{ fontSize:13, color:'#1a2b5c', fontWeight:600 }}>Log in again →</a>
    </div>
  )
  if (!authReady || isLoading) return (
    <div style={{ display:'flex', justifyContent:'center', alignItems:'center', height:'100vh', fontFamily:'Inter,sans-serif', fontSize:15, color:'#6b7280' }}>
      Loading invoice…
    </div>
  )
  if (!invoice) return (
    <div style={{ display:'flex', justifyContent:'center', alignItems:'center', height:'100vh', fontFamily:'Inter,sans-serif', fontSize:15, color:'#ef4444' }}>
      Invoice not found.
    </div>
  )

  // Items: prefer quotation items, fall back to invoice's own items
  const items       = (quotation?.items?.length ? quotation.items : invoice.items) ?? []
  const invoiceArtworks = invoiceArtworkData?.artworks ?? artworkData?.artworks ?? []
  const artworks    = artworkData?.artworks ?? []
  const effectiveOrderType = quotation?.order_type ?? invoice.order_type
  const isDtf       = effectiveOrderType === 'dtf'
  const isGangsheet = effectiveOrderType === 'gangsheet'
  const totalQty    = items.reduce((s, i) => s + (Number(i.qty) || 0), 0)
  const totalSheets = isGangsheet ? items.reduce((s, i) => s + (Number(i.qty) || 0), 0) : 0
  const totalArts   = isGangsheet ? items.reduce((s, i) => s + (Number(i.artwork_count) || 0), 0) : 0

  const payMethod = invoice.payments?.[0]?.method
    ?.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()) ?? '—'

  // Bill To: prefer quotation data, fall back to invoice's own fields
  const billName     = quotation?.customer_name || quotation?.company_name || invoice.customer_name || invoice.supplier_name || '—'
  const billAddr     = quotation?.billing_address || invoice.billing_address || '—'
  const billEmail    = quotation?.billing_email || invoice.billing_email || ''
  const billPhone    = quotation?.contact_number || invoice.contact_number || ''
  const shipAddr     = quotation?.shipping_address || invoice.shipping_address || '—'
  const shipCityLine = [quotation?.shipping_city, quotation?.shipping_state, quotation?.zip_code].filter(Boolean).join(', ')
  const shipCountry  = quotation?.shipping_country || ''

  const shippingAmt = Number(invoice.shipping_charges ?? 0)
  const itemsOnly   = Number(invoice.subtotal) - shippingAmt

  // ── Build DTF groups — consecutive items sharing desc + rate ───────────────
  const dtfGroups: DtfGroup[] = []
  items.forEach((item, idx) => {
    const art = artworks[idx] ?? null
    const invSuffix = invoice.invoice_number.replace(/\D/g, '').slice(-4) || '0001'
    const artNo  = art?.artwork_no || `DTF-${invSuffix}-${String(idx + 1).padStart(3, '0')}`
    const sizeStr = art?.width_inches && art?.height_inches
      ? `${art.width_inches} x ${art.height_inches}`
      : (item.sizes || '—')
    const row: DtfRow = { item, art, artNo, sizeStr }
    const last = dtfGroups[dtfGroups.length - 1]
    if (last && last.desc === item.description && Math.abs(last.rate - Number(item.unit_price)) < 0.01) {
      last.rows.push(row)
      last.rowSpan++
    } else {
      dtfGroups.push({ desc: item.description, rate: Number(item.unit_price), rowSpan: 1, rows: [row] })
    }
  })

  // Flatten for sequential S.No
  const dtfFlat = dtfGroups.flatMap((g, gi) =>
    g.rows.map((row, ri) => ({ ...row, group: g, groupIdx: gi, rowIdx: ri }))
  )

  return (
    <>
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

          {/* Left: Logo + Company info */}
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

          {/* Right: INVOICE + meta + summary */}
          <div className="hdr-right">
            <div className="inv-title">INVOICE</div>
            <div className="inv-meta-row">
              <div>
                <table className="inv-meta-tbl">
                  <tbody>
                    <tr>
                      <td className="ml">Invoice #</td>
                      <td className="ms" style={{ padding: '3px 4px' }}>:</td>
                      <td className="mv">{invoice.invoice_number}</td>
                    </tr>
                    <tr>
                      <td className="ml">Invoice Date</td>
                      <td className="ms" style={{ padding: '3px 4px' }}>:</td>
                      <td className="mv">{fmtDate(invoice.issue_date)}</td>
                    </tr>
                    <tr>
                      <td className="ml">Due Date</td>
                      <td className="ms" style={{ padding: '3px 4px' }}>:</td>
                      <td className="mv">{fmtDate(invoice.due_date)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="summary-box">
                <h4>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#1a2b5c" strokeWidth="2.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
                  INVOICE SUMMARY
                </h4>
                <table>
                  <tbody>
                    <tr>
                      <td className="sl">Items Total</td>
                      <td className="sv">{fmt(itemsOnly)}</td>
                    </tr>
                    {shippingAmt > 0 && <>
                      <tr>
                        <td className="sl">Shipping Charges</td>
                        <td className="sv">{fmt(shippingAmt)}</td>
                      </tr>
                      <tr>
                        <td className="sl">Subtotal</td>
                        <td className="sv">{fmt(invoice.subtotal)}</td>
                      </tr>
                    </>}
                    {Number(invoice.discount_amt) > 0 && (
                      <tr>
                        <td className="sl">Bulk Discount</td>
                        <td className="sv neg">-{fmt(invoice.discount_amt)}</td>
                      </tr>
                    )}
                  </tbody>
                  <tfoot>
                    <tr className="tr-total">
                      <td>TOTAL DUE</td>
                      <td style={{ textAlign: 'right' }}>{fmt(invoice.total)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          </div>

        </div>

        {/* ══ INFO CARDS ══ */}
        <div className="info-cards">
          <div className="ic">
            <div className="ic-head">
              <div className="ic-icon">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
              </div>
              <span className="ic-label">Bill To</span>
            </div>
            <div className="ic-body">
              <p className="ic-name">{billName}</p>
              {billEmail && <p>{billEmail}</p>}
              {billAddr !== '—' && <p>{billAddr}</p>}
              {billPhone && <p>{billPhone}</p>}
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
              <p className="ic-name">{billName}</p>
              {shipAddr !== '—' && <p>{shipAddr}</p>}
              {shipCityLine && <p>{shipCityLine}</p>}
              {shipCountry && <p>{shipCountry}</p>}
            </div>
          </div>

          <div className="ic">
            <div className="ic-head">
              <div className="ic-icon">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>
              </div>
              <span className="ic-label">Payment</span>
            </div>
            <div className="ic-body">
              <p className="ic-name">{invoice.payment_method || payMethod || '—'}</p>
              {invoice.payment_terms && <p style={{ color: '#6b7280', fontSize: 11 }}>{invoice.payment_terms}</p>}
              {invoice.payments?.[0]?.reference && <p>Ref: {invoice.payments[0].reference}</p>}
            </div>
          </div>

          {/* Show Paid stamp only when invoice is actually Paid */}
          {invoice.status === 'Paid' && (
            <div className="ic" style={{ flex: '0 0 auto' }}>
              <div className="ic-head" style={{ background: '#16a34a' }}>
                <div className="ic-icon" style={{ background: 'transparent' }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                </div>
                <span className="ic-label">Status</span>
              </div>
              <div className="ic-body">
                <p className="ic-name" style={{ color: '#16a34a', fontWeight: 700 }}>Paid</p>
              </div>
            </div>
          )}
        </div>

        {/* ══ ARTWORKS SECTION ══ */}
        {invoiceArtworks.length > 0 && (
          <div className="aw-section">
            <div className="aw-section-hdr">
              <div className="aw-section-num">★</div>
              <div className="aw-section-title">ARTWORKS ({invoiceArtworks.length})</div>
            </div>
            <div className="aw-grid" style={{
              display: 'grid',
              gridTemplateColumns: `repeat(${invoiceArtworks.length <= 2 ? 2 : invoiceArtworks.length <= 6 ? 3 : invoiceArtworks.length <= 12 ? 4 : 5}, 1fr)`,
              gap: 8,
              padding: '12px',
            }}>
              {invoiceArtworks.slice(0, 20).map((aw) => {
                const imgHeight = invoiceArtworks.length <= 2 ? 120 : invoiceArtworks.length <= 6 ? 90 : invoiceArtworks.length <= 12 ? 70 : 55
                return (
                  <div key={aw.id} className="aw-card">
                    <div className="aw-img-wrap" style={{ height: imgHeight }}>
                      {aw.file_url && aw.file_type !== 'pdf'
                        ? <img src={aw.file_url} alt={aw.name} className="aw-img" style={{ height: imgHeight }} />
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

        {/* ══ ITEMS TABLE ══ */}
        <div className="tbl-wrap">
          {isGangsheet ? (
            /* Gangsheet — Size, No. Artworks, Qty Sheets, FR Image, Price/Sheet, Amount */
            <table className="inv-tbl">
              <thead>
                <tr>
                  <th style={{ width: 40 }}>S.No</th>
                  <th style={{ minWidth: 120 }}>Gangsheet Size</th>
                  <th style={{ width: 100 }}>No. Artworks</th>
                  <th style={{ width: 90 }}>Qty Sheets</th>
                  <th style={{ width: 78 }}>Front Art</th>
                  <th style={{ width: 78 }}>Back Art</th>
                  <th style={{ width: 90 }}>Price/Sheet<br />(USD)</th>
                  <th style={{ width: 90 }}>Amount<br />(USD)</th>
                </tr>
              </thead>
              <tbody>
                {items.length === 0 ? (
                  <tr><td colSpan={8} style={{ padding: 24, textAlign: 'center', color: '#9ca3af' }}>No items found</td></tr>
                ) : items.map((item, idx) => {
                  const art = artworks[idx] ?? null
                  const frontUrl = (art?.file_url && art.file_type !== 'pdf') ? art.file_url : (item.front_image ?? null)
                  const backUrl  = item.back_image ?? null
                  return (
                    <tr key={item.id}>
                      <td style={{ fontWeight: 600, color: '#374151' }}>{idx + 1}</td>
                      <td style={{ fontWeight: 700, color: '#1a2b5c', fontSize: 13 }}>{item.description || '—'}</td>
                      <td style={{ fontWeight: 600 }}>{item.artwork_count || '—'}</td>
                      <td style={{ fontWeight: 600 }}>{item.qty}</td>
                      <td>
                        {frontUrl
                          ? <img src={frontUrl} alt="front" className="art-thumb" />
                          : <div className="art-empty">🖼</div>}
                      </td>
                      <td>
                        {backUrl
                          ? <img src={backUrl} alt="back" className="art-thumb" />
                          : <div className="art-empty">—</div>}
                      </td>
                      <td style={{ fontWeight: 500 }}>{fmt(item.unit_price)}</td>
                      <td style={{ fontWeight: 700 }}>{fmt(item.amount)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          ) : isDtf ? (
            /* DTF — S.No sequential per row, only Item Desc + Rate rowSpan */
            <table className="inv-tbl">
              <thead>
                <tr>
                  <th style={{ width: 40 }}>S.No</th>
                  <th style={{ minWidth: 110 }}>
                    Item Description<br />
                    <span style={{ fontSize: 8, opacity: 0.75 }}>(DTF Transfers)</span>
                  </th>
                  <th style={{ width: 90 }}>Artwork No</th>
                  <th style={{ width: 70 }}>Front Art</th>
                  <th style={{ width: 70 }}>Back Art</th>
                  <th style={{ width: 100 }}>Artwork Size<br />(IN)</th>
                  <th style={{ width: 82 }}>Qty<br />(Transfers)</th>
                  <th style={{ width: 68 }}>Rate</th>
                  <th style={{ width: 72 }}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {dtfFlat.length === 0 ? (
                  <tr><td colSpan={9} style={{ padding: 24, textAlign: 'center', color: '#9ca3af' }}>No items found</td></tr>
                ) : dtfFlat.map((r, sno) => {
                  const frontUrl = (r.art?.file_url && r.art.file_type !== 'pdf') ? r.art.file_url : (r.item.front_image ?? r.item.artwork_image ?? null)
                  const backUrl  = r.item.back_image ?? null
                  return (
                  <tr key={`${r.item.id}-${sno}`}>
                    <td style={{ fontWeight: 600, color: '#374151' }}>{sno + 1}</td>
                    {r.rowIdx === 0 && (
                      <td rowSpan={r.group.rowSpan} className="td-span td-desc">
                        {r.group.desc || 'DTF Transfers'}
                      </td>
                    )}
                    <td style={{ fontWeight: 600, color: '#374151', fontSize: 10.5 }}>{r.artNo}</td>
                    <td>
                      {frontUrl
                        ? <img src={frontUrl} alt="front" className="art-thumb" />
                        : <div className="art-empty">🖼</div>}
                    </td>
                    <td>
                      {backUrl
                        ? <img src={backUrl} alt="back" className="art-thumb" />
                        : <div className="art-empty">—</div>}
                    </td>
                    <td style={{ fontWeight: 500 }}>{r.sizeStr}</td>
                    <td style={{ fontWeight: 600, color: '#111827' }}>{r.item.qty}</td>
                    {r.rowIdx === 0 && (
                      <td rowSpan={r.group.rowSpan} className="td-span" style={{ fontWeight: 700, color: '#111827' }}>
                        {r.group.rate.toFixed(2)}
                      </td>
                    )}
                    <td style={{ fontWeight: 600, color: '#374151' }}>
                      {Number(r.item.amount).toFixed(2)}
                    </td>
                  </tr>
                  )
                })}
              </tbody>
            </table>
          ) : (
            /* Apparel / Gangsheet — independent rows with color, size, front/back artwork */
            <table className="inv-tbl">
              <thead>
                <tr>
                  <th style={{ width: 40 }}>S.No</th>
                  <th className="th-l" style={{ minWidth: 150 }}>
                    Item Description<br />
                    <span style={{ fontSize: 8, opacity: 0.75 }}>
                      ({quotation?.order_type === 'gangsheet' ? 'Gangsheet' : 'DTF Transfers'})
                    </span>
                  </th>
                  <th style={{ width: 68 }}>Color</th>
                  <th style={{ width: 110 }}>Size &amp; QTY</th>
                  <th style={{ width: 70 }}>Artwork Front</th>
                  <th style={{ width: 62 }}>Size (IN)</th>
                  <th style={{ width: 70 }}>Artwork Back</th>
                  <th style={{ width: 62 }}>Size (IN)</th>
                  <th style={{ width: 74 }}>Unit Rate<br />(USD)</th>
                  <th style={{ width: 74 }}>Amount<br />(USD)</th>
                </tr>
              </thead>
              <tbody>
                {items.length === 0 ? (
                  <tr><td colSpan={10} style={{ padding: 24, textAlign: 'center', color: '#9ca3af' }}>No items found</td></tr>
                ) : items.map((item, idx) => {
                  const art     = artworks[idx] ?? null
                  const artBack = artworks[idx + items.length] ?? null
                  const frontUrl = (art?.file_url && art.file_type !== 'pdf') ? art.file_url : (item.front_image ?? null)
                  const backUrl  = (artBack?.file_url && artBack.file_type !== 'pdf') ? artBack.file_url : (item.back_image ?? null)
                  const artSz   = art?.width_inches && art?.height_inches ? `${art.width_inches} x ${art.height_inches}` : '—'
                  const artBSz  = artBack?.width_inches && artBack?.height_inches ? `${artBack.width_inches} x ${artBack.height_inches}` : '—'
                  const dotColor = colorHex(item.colors ?? null)
                  const isWhite  = item.colors?.toLowerCase().includes('white')
                  return (
                    <tr key={item.id}>
                      <td>{idx + 1}</td>
                      <td className="td-l" style={{ fontWeight: 500 }}>{item.description}</td>
                      <td>
                        <span className="color-dot" style={{ background: dotColor, border: isWhite ? '1.5px solid #d1d5db' : `1px solid ${dotColor}` }} />
                        <span style={{ fontSize: 11 }}>{item.colors || '—'}</span>
                      </td>
                      <td style={{ fontSize: 10, lineHeight: 1.6, textAlign: 'left' }}>{item.sizes || '—'}</td>
                      <td>
                        {frontUrl
                          ? <img src={frontUrl} alt="front" className="art-thumb" />
                          : <div className="art-empty">—</div>}
                      </td>
                      <td style={{ fontSize: 10 }}>{artSz}</td>
                      <td>
                        {backUrl
                          ? <img src={backUrl} alt="back" className="art-thumb" />
                          : <div className="art-empty">—</div>}
                      </td>
                      <td style={{ fontSize: 10 }}>{artBSz}</td>
                      <td style={{ fontWeight: 500 }}>{fmt(item.unit_price)}</td>
                      <td style={{ fontWeight: 700 }}>{fmt(item.amount)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}

          {/* ══ STATS BAR ══ */}
          <table className="stats-bar">
            <tbody>
              <tr>
                <td style={{ width: '25%' }}>
                  <div className="stat-cell">
                    <div className="stat-icon">{isGangsheet ? '🗂' : '👕'}</div>
                    <div>
                      <div className="stat-lbl">{isGangsheet ? 'Gangsheet Sizes' : 'Total Items'}</div>
                      <div className="stat-val">{isDtf ? dtfGroups.length : items.length}</div>
                    </div>
                  </div>
                </td>
                <td style={{ width: '25%' }}>
                  <div className="stat-cell">
                    <div className="stat-icon">🖼</div>
                    <div>
                      <div className="stat-lbl">Total Artworks</div>
                      <div className="stat-val">{isGangsheet ? totalArts : isDtf ? items.length : artworks.length}</div>
                    </div>
                  </div>
                </td>
                <td style={{ width: '25%' }}>
                  <div className="stat-cell">
                    <div className="stat-icon">📦</div>
                    <div>
                      <div className="stat-lbl">{isGangsheet ? 'Total Sheets' : isDtf ? 'Total Qty (Transfers)' : 'Total Qty'}</div>
                      <div className="stat-val">{isGangsheet ? totalSheets : totalQty}{!isDtf && !isGangsheet && ' pcs'}</div>
                    </div>
                  </div>
                </td>
                <td style={{ width: '25%' }}>
                  <div className="stat-cell">
                    <div className="stat-icon">🧮</div>
                    <div>
                      <div className="stat-lbl">Items Total</div>
                      <div className="stat-val">{fmt(invoice.subtotal)}</div>
                    </div>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* ══ PAYMENT FOOTER ══ */}
        <div className="pay-section">
          <div className="pay-footer">

            {/* 1 — Total amount in words */}
            <div className="pay-box">
              <div className="pay-lbl">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
                Total Amount in Words
              </div>
              <div className="pay-words">
                {numberToWords(Number(invoice.total ?? 0))}
              </div>
            </div>

            {/* 2 — Zelle */}
            <div className="pay-box" style={{ textAlign: 'center' }}>
              <div className="pay-lbl" style={{ justifyContent: 'center' }}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>
                Payment Methods
              </div>
              <div className="zelle-txt">Zelle</div>
              <div style={{ marginTop: 4 }}><QrBox /></div>
              <div className="pay-email">{CO.zelle}</div>
            </div>

            {/* 3 — PayPal */}
            <div className="pay-box" style={{ textAlign: 'center' }}>
              <div className="pay-lbl" style={{ justifyContent: 'center', opacity: 0 }}>‎</div>
              <div className="paypal-txt"><span>P</span>ay<span>P</span>al</div>
              <div style={{ marginTop: 4 }}><QrBox /></div>
              <div className="pay-email">{CO.paypal}</div>
            </div>

            {/* 4 — Cards */}
            <div className="pay-box" style={{ textAlign: 'center' }}>
              <div className="pay-lbl" style={{ justifyContent: 'center' }}>Debit / Credit Cards</div>
              <div className="card-logos" style={{ justifyContent: 'center' }}>
                <span className="lv">VISA</span>
                <span className="lm">MC</span>
                <span className="la">AMEX</span>
                <span className="ld">DISCOVER</span>
              </div>
              <div className="pay-note" style={{ marginTop: 6 }}>We accept all major<br />debit and credit cards.</div>
            </div>

            {/* 5 — Bank Transfer */}
            <div className="pay-box" style={{ textAlign: 'center' }}>
              <div className="pay-lbl" style={{ justifyContent: 'center' }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2"><line x1="3" y1="22" x2="21" y2="22"/><line x1="6" y1="18" x2="6" y2="11"/><line x1="10" y1="18" x2="10" y2="11"/><line x1="14" y1="18" x2="14" y2="11"/><line x1="18" y1="18" x2="18" y2="11"/><polygon points="12 2 20 7 4 7"/></svg>
                Bank Transfer
              </div>
              <div className="bank-lbl" style={{ justifyContent: 'center', marginTop: 4 }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#1a2b5c" strokeWidth="2"><line x1="3" y1="22" x2="21" y2="22"/><line x1="6" y1="18" x2="6" y2="11"/><line x1="10" y1="18" x2="10" y2="11"/><line x1="14" y1="18" x2="14" y2="11"/><line x1="18" y1="18" x2="18" y2="11"/><polygon points="12 2 20 7 4 7"/></svg>
                Bank Transfer
              </div>
              <div className="pay-note" style={{ marginTop: 5 }}>
                Please use invoice number<br />as reference.
              </div>
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
    </>
  )
}
