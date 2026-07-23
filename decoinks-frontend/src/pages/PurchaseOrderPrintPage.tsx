import { useParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '../services/api'
import { usePrintAuth } from '../hooks/usePrintAuth'
import { ArtworkLightboxOverlay, ArtworkLightboxProvider, ArtworkThumb } from '../components/print/ArtworkLightbox'

// ── Types ─────────────────────────────────────────────────────────────────────

interface POItem {
  id: string
  category?: string | null
  brand?: string | null
  color?: string | null
  size?: string | null
  catalog_sku?: string | null
  item_name: string
  description: string | null
  qty_ordered: number
  unit_price: number
  line_total: number
  hsn_code: string | null
  uom: string
  remarks: string | null
  required_by_date: string | null
  sort_order: number
  artwork_count?: number
  artwork_size?: string | null
  front_image?: string | null
  back_image?: string | null
  front_mockup?: string | null
  back_mockup?: string | null
  product_image?: string | null
  artwork_no?: string | null
  artwork_file_url?: string | null
  artwork_thumbnail_url?: string | null
}

interface CoveredOrder {
  id: string; order_number: string; status: string; order_type: string
  no_artworks: number; qty: number; gangsheet_sizes: string | null
}

interface POFragment {
  id: string; fragment_no: string; covers_order_number?: string | null
  width_inches: number | null; length_inches: number | null
  artworks_count: number; qty: number
}

interface PurchaseOrder {
  id: string
  po_number: string
  status: string
  priority: string | null
  currency: string
  order_date: string | null
  expected_date: string | null
  created_at: string
  order_id: string | null
  order_number?: string | null
  supplier_name: string | null
  supplier_email: string | null
  supplier_phone: string | null
  supplier_city: string | null
  supplier_company: string | null
  supplier_reference: string | null
  buyer_name: string | null
  shipping_method: string | null
  shipping_address: string | null
  billing_address: string | null
  payment_terms: string | null
  payment_method: string | null
  notes: string | null
  terms_conditions: string | null
  subtotal: number
  total_discount: number
  total_tax: number
  freight_charges: number
  other_charges: number
  grand_total: number
  items: POItem[]
  order_total_artworks?: number
  po_type?: string | null
  payment_status?: string | null
  communication_method?: string | null
  customer_name?: string | null
  contact_name?: string | null
  contact_email?: string | null
  contact_phone?: string | null
  contact_wechat?: string | null
  orders?: CoveredOrder[]
  fragments?: POFragment[]
  artworks?: Artwork[]
}

interface Artwork {
  id: string
  artwork_no: string
  name: string
  file_url: string | null
  file_type: string | null
  thumbnail_url?: string | null
  width_inches?: number | null
  height_inches?: number | null
  qty?: number | null
  artwork_size?: string | null
  source_order_id?: string | null
  location: string | null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmtDate = (d: string | null | undefined) => {
  if (!d) return '—'
  const dt = new Date(d)
  return dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).replace(/ /g, '-')
}

const CO = {
  name: 'decoinks',
  tagline: 'PRINTSHOP OS',
  address: 'Suite 111, 1218 Magnolia Avenue',
  city: 'Corona, CA 92881, United States',
  email: 'info@decoinks.com',
  phone: '+1 (714) 790-1460',
}

// Parse gangsheet width from item_name like '22" x 60"' → '22"'
function parseGsWidth(name: string | null): string {
  if (!name) return '—'
  const m = name.match(/^([\d.]+[""]?)/i)
  return m ? m[1].replace(/['"]/g, '"') : name
}

// Parse gangsheet length from item_name like '22" x 60"' → '60"'
function parseGsLength(name: string | null): string {
  if (!name) return '—'
  const m = name.match(/[×xX]\s*([\d."]+)/)
  return m ? m[1].replace(/['"]/g, '"') : '—'
}

// Apparel size breakdown: "S-3, M-8, L-10" → { S:3, M:8, L:10 }
const SIZE_COLS = ['S', 'M', 'L', 'XL', '2XL', '3XL']
function parseSizes(sizeStr: string | null | undefined, totalQty: number): Record<string, number> {
  const r: Record<string, number> = {}
  SIZE_COLS.forEach(s => { r[s] = 0 })
  if (!sizeStr) return r
  if (sizeStr.includes('-')) {
    sizeStr.split(/[,;]/).forEach(part => {
      const m = part.trim().match(/^(S|M|L|XL|2XL|3XL|4XL|5XL)-(\d+)$/i)
      if (m && SIZE_COLS.includes(m[1].toUpperCase())) r[m[1].toUpperCase()] = parseInt(m[2])
    })
  } else {
    const sz = sizeStr.trim().toUpperCase()
    if (SIZE_COLS.includes(sz)) r[sz] = totalQty
  }
  return r
}

function colorHex(c: string | null | undefined): string {
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

// ── CSS ───────────────────────────────────────────────────────────────────────

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap');
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Inter', sans-serif; font-size: 11px; color: #111827; background: #f1f5f9; }
  .page { max-width: 900px; margin: 0 auto; background: #fff; box-shadow: 0 0 40px rgba(0,0,0,0.12); }

  @media print {
    body { background: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .no-print { display: none !important; }
    .page { max-width: 100%; box-shadow: none; }
    @page { margin: 8mm; size: A4 portrait; }
    a.art-link, a.art-link:visited { text-decoration: none; color: inherit; border: none; display: block; }
  }
  a.art-link { cursor: zoom-in; }

  /* ── Print button ── */
  .print-btn {
    position: fixed; top: 16px; right: 16px; z-index: 999;
    background: #0f1f3d; color: #fff; border: none;
    padding: 10px 22px; border-radius: 8px;
    font-size: 13px; font-weight: 600; cursor: pointer;
    box-shadow: 0 4px 14px rgba(0,0,0,0.25);
  }
  .back-btn {
    position: fixed; top: 16px; left: 16px; z-index: 999;
    background: #fff; color: #374151; border: 1.5px solid #d1d5db;
    padding: 9px 18px; border-radius: 8px;
    font-size: 13px; font-weight: 600; cursor: pointer;
    box-shadow: 0 2px 8px rgba(0,0,0,0.08);
  }
  .back-btn:hover { background: #f9fafb; }

  /* ══════════════════════════════════════════
     HEADER — white background
  ══════════════════════════════════════════ */
  .po-header {
    display: grid;
    grid-template-columns: 220px 1fr 230px;
    gap: 0;
    padding: 22px 24px 18px;
    border-bottom: 2px solid #e5e7eb;
    align-items: flex-start;
  }

  /* Left: Logo */
  .po-logo-col {}
  .print-logo-img { height: 42px; width: auto; object-fit: contain; display: block; }
  .po-logo-tag {
    font-size: 8px; font-weight: 700; letter-spacing: 2.5px;
    color: #6b7280; text-transform: uppercase; margin-top: 6px;
  }
  .po-addr { margin-top: 12px; display: flex; flex-direction: column; gap: 4px; }
  .po-addr-row { display: flex; align-items: flex-start; gap: 6px; font-size: 10px; color: #374151; }
  .po-addr-icon { font-size: 11px; flex-shrink: 0; margin-top: 0px; }

  /* Center: Title */
  .po-title-col {
    display: flex; flex-direction: column; align-items: center;
    justify-content: center; padding: 0 12px;
  }
  .po-main-title {
    font-size: 36px; font-weight: 900; color: #0f1f3d;
    letter-spacing: 4px; text-transform: uppercase; line-height: 1;
    text-align: center;
  }
  .po-subtitle-row {
    display: flex; align-items: center; gap: 8px;
    margin-top: 8px; width: 100%;
  }
  .po-subtitle-line { flex: 1; height: 1px; background: #9ca3af; }
  .po-subtitle-text { font-size: 10px; color: #6b7280; white-space: nowrap; font-weight: 500; }

  /* Right: Meta box */
  .po-meta-box {
    border: 1px solid #d1d5db; border-radius: 6px;
    overflow: hidden;
  }
  .po-meta-table { width: 100%; border-collapse: collapse; }
  .po-meta-table tr { border-bottom: 1px solid #e5e7eb; }
  .po-meta-table tr:last-child { border-bottom: none; }
  .po-meta-table td { padding: 5px 8px; font-size: 10px; }
  .pm-label { color: #6b7280; font-weight: 500; width: 52%; }
  .pm-colon { color: #9ca3af; width: 6px; padding: 0 0 0 2px; }
  .pm-value { color: #111827; font-weight: 600; }

  /* ══════════════════════════════════════════
     3 INFO CARDS
  ══════════════════════════════════════════ */
  .info-cards {
    display: grid; grid-template-columns: repeat(3, 1fr);
    border-top: none; border-bottom: 2px solid #e5e7eb;
  }
  .info-card {
    padding: 14px 16px;
    border-right: 1px solid #e5e7eb;
  }
  .info-card:last-child { border-right: none; }

  .card-head {
    display: flex; align-items: center; gap: 8px;
    margin-bottom: 10px; padding-bottom: 8px;
    border-bottom: 1.5px solid currentColor;
  }
  .card-icon {
    width: 28px; height: 28px; border-radius: 6px;
    display: flex; align-items: center; justify-content: center;
    font-size: 14px; flex-shrink: 0;
  }
  .card-title {
    font-size: 9.5px; font-weight: 800;
    letter-spacing: 1px; text-transform: uppercase;
  }

  /* color themes */
  .theme-green .card-head { color: #15803d; border-color: #16a34a; }
  .theme-green .card-icon { background: #dcfce7; }
  .theme-blue  .card-head { color: #1d4ed8; border-color: #2563eb; }
  .theme-blue  .card-icon { background: #dbeafe; }
  .theme-orange .card-head { color: #c2410c; border-color: #ea580c; }
  .theme-orange .card-icon { background: #ffedd5; }

  .card-field { display: flex; gap: 0; align-items: flex-start; margin-bottom: 4px; }
  .card-field-label { font-size: 10px; color: #6b7280; font-weight: 500; width: 110px; flex-shrink: 0; }
  .card-field-sep { color: #9ca3af; padding: 0 4px; font-size: 10px; }
  .card-field-value { font-size: 10px; color: #111827; font-weight: 600; line-height: 1.5; }
  .card-notes ul { padding-left: 14px; }
  .card-notes li { font-size: 10px; color: #374151; line-height: 1.6; }

  /* ══════════════════════════════════════════
     SECTION HEADERS
  ══════════════════════════════════════════ */
  .sec-hdr {
    background: #0f1f3d;
    display: flex; align-items: center; gap: 10px;
    padding: 8px 14px;
    margin: 0;
  }
  .sec-num {
    width: 22px; height: 22px; border-radius: 50%;
    background: rgba(255,255,255,0.15); border: 1.5px solid rgba(255,255,255,0.3);
    display: flex; align-items: center; justify-content: center;
    font-size: 11px; font-weight: 800; color: #fff; flex-shrink: 0;
  }
  .sec-title {
    font-size: 12px; font-weight: 800; color: #fff;
    letter-spacing: 0.5px; text-transform: uppercase;
  }

  /* ══════════════════════════════════════════
     TABLES
  ══════════════════════════════════════════ */
  .po-table {
    width: 100%; border-collapse: collapse; font-size: 10.5px;
  }
  .po-table thead th {
    background: #1a3260; color: #c7d7f5;
    padding: 7px 10px; text-align: center;
    font-size: 9.5px; font-weight: 700; letter-spacing: 0.3px;
    border: 1px solid rgba(255,255,255,0.08);
    white-space: nowrap;
  }
  .po-table thead th.left { text-align: left; }
  .po-table tbody tr { border-bottom: 1px solid #f1f5f9; }
  .po-table tbody tr:nth-child(even) { background: #f8fafc; }
  .po-table tbody td {
    padding: 8px 10px; text-align: center;
    font-size: 10.5px; border-right: 1px solid #f1f5f9;
    vertical-align: middle;
  }
  .po-table tbody td.left { text-align: left; }
  .po-table tfoot td {
    background: #f1f5f9; font-weight: 800;
    font-size: 10.5px; padding: 7px 10px;
    text-align: center; border-top: 2px solid #e5e7eb;
    color: #0f1f3d;
  }
  .po-table tfoot td.left { text-align: left; }

  .order-no-link { color: #16a34a; font-weight: 700; text-decoration: none; }
  .td-sno { font-weight: 700; color: #6b7280; width: 36px; }

  /* ══════════════════════════════════════════
     RESPONSIVE GANGSHEET ARTWORK SHEET
  ══════════════════════════════════════════ */
  .artworks-grid {
    display: grid; gap: 8px; padding: 9px;
    border: 1px solid #dbe3ef; border-top: 0; background: #f8fafc;
  }
  .artworks-grid.art-count-large { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .artworks-grid.art-count-medium { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .artworks-grid.art-count-dense { grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 6px; }
  .art-card {
    min-width: 0; display: grid; grid-template-columns: auto 1fr; gap: 9px;
    align-items: center; padding: 8px; background: #fff;
    border: 1px solid #dbe3ef; border-radius: 6px; break-inside: avoid;
  }
  .art-card-thumb {
    width: 82px; height: 82px; object-fit: contain; border-radius: 5px;
    border: 1px solid #e2e8f0; background: #fff;
  }
  .art-count-medium .art-card-thumb { width: 66px; height: 66px; }
  .art-count-dense .art-card { grid-template-columns: 1fr; gap: 5px; padding: 6px; text-align: center; }
  .art-count-dense .art-card-thumb { width: 54px; height: 54px; margin: 0 auto; }
  .art-card-empty {
    display: flex; align-items: center; justify-content: center;
    color: #cbd5e1; font-size: 20px; border-style: dashed;
  }
  .art-card-no { font-size: 10.5px; font-weight: 800; color: #0f1f3d; line-height: 1.25; word-break: break-word; }
  .art-card-meta { margin-top: 4px; display: grid; gap: 2px; font-size: 8.5px; color: #64748b; }
  .art-card-meta strong { color: #334155; font-weight: 700; }
  .art-count-dense .art-card-no { font-size: 9px; }
  .art-count-dense .art-card-meta { font-size: 7.5px; }
  .art-thumb {
    width: 52px; height: 52px; object-fit: contain;
    border: 1px solid #e2e8f0; border-radius: 4px;
    background: #fff; display: block; margin: 0 auto;
  }
  .art-empty-thumb {
    width: 52px; height: 52px; display: flex; align-items: center; justify-content: center;
    color: #d1d5db; font-size: 20px; margin: 0 auto;
    border: 1px dashed #e2e8f0; border-radius: 4px; background: #fafafa;
  }

  /* ══════════════════════════════════════════
     STATS BAR
  ══════════════════════════════════════════ */
  .stats-bar {
    display: flex; align-items: stretch;
    border: 1px solid #e5e7eb; border-top: none;
  }
  .stat-cell {
    flex: 1; display: flex; align-items: center; gap: 14px;
    padding: 16px 20px;
    border-right: 1px solid #e5e7eb;
  }
  .stat-cell:last-child { border-right: none; }
  .stat-icon-box {
    width: 44px; height: 44px; background: #0f1f3d;
    border-radius: 8px; display: flex; align-items: center;
    justify-content: center; font-size: 20px; flex-shrink: 0;
  }
  .stat-text {}
  .stat-label { font-size: 9px; font-weight: 700; color: #6b7280; letter-spacing: 0.5px; text-transform: uppercase; }
  .stat-value { font-size: 26px; font-weight: 900; color: #0f1f3d; line-height: 1.1; }

  /* ══════════════════════════════════════════
     PRODUCTION NOTES
  ══════════════════════════════════════════ */
  .prod-notes {
    border-top: 2px solid #e5e7eb; padding: 14px 20px;
  }
  .prod-notes-hdr {
    display: flex; align-items: center; gap: 8px;
    margin-bottom: 10px;
  }
  .prod-notes-icon {
    width: 22px; height: 22px; background: #fff7ed;
    border-radius: 4px; display: flex; align-items: center;
    justify-content: center; font-size: 12px;
  }
  .prod-notes-title {
    font-size: 11px; font-weight: 800; color: #c2410c;
    text-transform: uppercase; letter-spacing: 0.5px;
  }
  .prod-notes-cols {
    display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px 20px;
  }
  .prod-notes-item {
    display: flex; gap: 6px; align-items: flex-start;
    font-size: 10px; color: #374151; line-height: 1.5;
  }
  .prod-notes-dot { color: #ea580c; font-size: 10px; margin-top: 1px; flex-shrink: 0; }

  /* ── Apparel PO template ── */
  .info-cards.cards-4 { grid-template-columns: 1fr 1fr 1.4fr 1fr; }
  .info-card.theme-purple { border-color: #ddd6fe; }
  .info-card.theme-purple .card-head { background: #f5f3ff; }
  .info-card.theme-purple .card-title { color: #6d28d9; }
  .neck-grid { display: grid; grid-template-columns: auto 1fr; gap: 10px; }
  .neck-sub { font-size: 8px; font-weight: 800; letter-spacing: 0.8px; text-transform: uppercase; color: #6b7280; margin-bottom: 5px; }
  .neck-label-box { width: 72px; height: 62px; background: #111827; border-radius: 6px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; }
  .neck-brand { color: #fff; font-size: 12px; font-weight: 800; letter-spacing: 0.3px; }
  .neck-tag { color: rgba(255,255,255,0.7); font-size: 5.5px; font-weight: 700; letter-spacing: 1.4px; }
  .neck-size { margin-top: 5px; font-size: 9px; font-weight: 700; color: #0f1f3d; text-align: center; }
  .neck-list { list-style: none; display: grid; gap: 3px; }
  .neck-list li { display: flex; gap: 5px; font-size: 9.5px; color: #374151; line-height: 1.45; }
  .neck-list li::before { content: '•'; color: #6d28d9; font-weight: 700; flex-shrink: 0; }
  .apparel-tbl thead th { vertical-align: middle; }
  .clr-dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; vertical-align: middle; margin-right: 4px; border: 1px solid rgba(0,0,0,0.15); }
  .po-footer-band { background: #0f1f3d; min-height: 34px; margin: 0 14px 14px; border-radius: 4px; display: flex; align-items: center; justify-content: space-around; }
  .pfb-line { width: 110px; height: 2px; background: rgba(255,255,255,0.35); border-radius: 2px; }
`

// ── Main component ────────────────────────────────────────────────────────────

export function PurchaseOrderPrintPage() {
  const { id }      = useParams<{ id: string }>()
  const navigate    = useNavigate()
  const { authReady, authFailed } = usePrintAuth()

  // staleTime 0 + always refetch: PO edits must show immediately when the
  // preview is reopened.
  const { data: po, isLoading, isError, refetch } = useQuery<PurchaseOrder>({
    queryKey: ['purchase-order-print', id],
    queryFn:  () => api.get(`/purchase-orders/${id}`).then(r => r.data.po ?? r.data.data ?? r.data),
    enabled: !!id && authReady,
    staleTime: 0, refetchOnMount: 'always',
  })

  const { data: artworkData } = useQuery<{ artworks: Artwork[] }>({
    queryKey: ['order-artworks-for-po', po?.order_id],
    queryFn:  () => api.get(`/orders/${po!.order_id}/artworks`).then(r => r.data),
    enabled:  !!po?.order_id && authReady && !(po?.artworks?.length),
    staleTime: 0, refetchOnMount: 'always',
  })

  if (authFailed) return (
    <div style={{ display:'flex', flexDirection:'column', justifyContent:'center', alignItems:'center', height:'100vh', fontFamily:'Inter,sans-serif', gap:12 }}>
      <span style={{ fontSize:15, color:'#ef4444' }}>Session expired.</span>
      <a href="/login" style={{ fontSize:13, color:'#1a2b5c', fontWeight:600 }}>Log in again →</a>
    </div>
  )
  if (!authReady || isLoading) return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', fontFamily: 'Inter, sans-serif', fontSize: 15, color: '#6b7280' }}>
      Loading purchase order…
    </div>
  )
  if (isError) return (
    <div style={{ display:'flex', flexDirection:'column', justifyContent:'center', alignItems:'center', height:'100vh', fontFamily:'Inter,sans-serif', gap:12 }}>
      <span style={{ fontSize:15, color:'#ef4444' }}>Purchase order preview could not be loaded.</span>
      <button onClick={() => void refetch()} style={{ minHeight:40, padding:'0 18px', border:'1px solid #cbd5e1', borderRadius:8, background:'#fff', color:'#1a2b5c', fontWeight:700, cursor:'pointer' }}>Try again</button>
    </div>
  )
  if (!po) return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', fontFamily: 'Inter, sans-serif', fontSize: 15, color: '#ef4444' }}>
      Purchase order not found.
    </div>
  )

  const items    = po.items ?? []
  const artworks = (po.artworks?.length ? po.artworks : artworkData?.artworks) ?? []
  const coveredOrders = po.orders ?? []
  const fragments = po.fragments ?? []

  // Template branch: apparel POs render the shirt-production layout,
  // gangsheet POs the gangsheet layout.
  const isApparelPO = po.po_type === 'apparel' || (!po.po_type && items.some(it => it.color || it.size))
  const hasFrontMockup = items.some(it => it.front_mockup)
  const hasBackMockup  = items.some(it => it.back_mockup)
  const apparelCols = 12 + (hasFrontMockup ? 1 : 0) + (hasBackMockup ? 1 : 0)
  const itemFrontArt = (it: POItem) => it.front_image || it.artwork_thumbnail_url || it.artwork_file_url || null

  // Totals
  const totalArtworks = artworks.length
    || items.reduce((s, it) => s + (it.artwork_count ?? 0), 0)
    || po.order_total_artworks
    || 0
  const totalQty      = items.reduce((s, it) => s + (it.qty_ordered ?? 0), 0)

  // Gangsheet totals prefer the live covered-order aggregates
  const gsTotalArtworks = coveredOrders.length
    ? coveredOrders.reduce((s, o) => s + (o.no_artworks || 0), 0) || totalArtworks
    : totalArtworks
  const gsTotalQty = coveredOrders.length
    ? coveredOrders.reduce((s, o) => s + (o.qty || 0), 0) || totalQty
    : totalQty

  // Artwork range string e.g. "AW1001 – AW1076"
  const artRange = artworks.length > 0
    ? `${artworks[0].artwork_no} – ${artworks[artworks.length - 1].artwork_no}`
    : '—'

  // For the Gangsheet Order summary row (section 1) – aggregate all items
  const gsOrderNo   = po.order_id ? (po.order_number || `ORD-${po.po_number}`) : po.po_number

  // Notes as bullet list — per-type defaults matching the approved templates
  const noteLines: string[] = po.notes
    ? po.notes.split('\n').map(l => l.trim()).filter(Boolean)
    : isApparelPO
      ? [
          'Poly bag individually',
          'Sort by color and size',
          'Apply neck label',
          'Verify artwork placement',
          'Seal and label cartons',
        ]
      : [
          'All gangsheets are print-ready.',
          'Please verify quantities before production.',
          'Refer to Gangsheet Numbers listed above.',
          'Artwork revisions are not permitted after approval.',
          'Ensure all measurements and artwork placements are accurate.',
        ]

  const artworkDensity = artworks.length <= 4
    ? 'art-count-large'
    : artworks.length <= 7
      ? 'art-count-medium'
      : 'art-count-dense'

  const itemArtworkSize = items.find(it => it.artwork_size)?.artwork_size ?? null

  const artSize = (art: Artwork) => {
    if (art.width_inches && art.height_inches) return `${art.width_inches}" × ${art.height_inches}"`
    if (art.artwork_size) return art.artwork_size
    if (itemArtworkSize) return itemArtworkSize
    return '—'
  }

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
        <div className="po-header">

          {/* Left — Logo + address */}
          <div className="po-logo-col">
            <img src="/decoinks-logo.png" alt="Decoinks" className="print-logo-img" />
            <div className="po-logo-tag">PRINTSHOP OS</div>
            <div className="po-addr">
              <div className="po-addr-row">
                <span className="po-addr-icon">📍</span>
                <span>{CO.address}<br />{CO.city}</span>
              </div>
              <div className="po-addr-row">
                <span className="po-addr-icon">✉</span>
                <span>{CO.email}</span>
              </div>
              <div className="po-addr-row">
                <span className="po-addr-icon">📞</span>
                <span>{CO.phone}</span>
              </div>
            </div>
          </div>

          {/* Center — Title */}
          <div className="po-title-col">
            <div className="po-main-title">PURCHASE ORDER</div>
            <div className="po-subtitle-row">
              <div className="po-subtitle-line" />
              <div className="po-subtitle-text">Request materials from suppliers</div>
              <div className="po-subtitle-line" />
            </div>
          </div>

          {/* Right — PO meta */}
          <div className="po-meta-box">
            <table className="po-meta-table">
              <tbody>
                <tr>
                  <td className="pm-label">PO Number</td>
                  <td className="pm-colon">:</td>
                  <td className="pm-value">{po.po_number}</td>
                </tr>
                <tr>
                  <td className="pm-label">PO Date</td>
                  <td className="pm-colon">:</td>
                  <td className="pm-value">{fmtDate(po.order_date || po.created_at)}</td>
                </tr>
                <tr>
                  <td className="pm-label">Production Priority</td>
                  <td className="pm-colon">:</td>
                  <td className="pm-value">{po.priority || 'Standard'}</td>
                </tr>
                <tr>
                  <td className="pm-label">Required Dispatch Date</td>
                  <td className="pm-colon">:</td>
                  <td className="pm-value">{fmtDate(po.expected_date)}</td>
                </tr>
                <tr>
                  <td className="pm-label">Order Date</td>
                  <td className="pm-colon">:</td>
                  <td className="pm-value">{fmtDate(po.order_date || po.created_at)}</td>
                </tr>
                <tr>
                  <td className="pm-label">Need By Date</td>
                  <td className="pm-colon">:</td>
                  <td className="pm-value">{fmtDate(po.expected_date)}</td>
                </tr>
              </tbody>
            </table>
          </div>

        </div>

        {/* ══ INFO CARDS ══ */}
        {isApparelPO ? (
        <div className="info-cards cards-4">

          {/* Card 1 — Fulfillment Supplier */}
          <div className="info-card theme-green">
            <div className="card-head">
              <div className="card-icon">🤝</div>
              <div className="card-title">Fulfillment Supplier</div>
            </div>
            <div style={{ fontSize: 13, fontWeight: 800, color: '#0f1f3d', marginBottom: 6 }}>{po.supplier_name || po.supplier_company || '—'}</div>
            {(po.contact_name || po.buyer_name) && (
              <div className="card-field"><span className="card-field-label">Contact</span><span className="card-field-sep">:</span><span className="card-field-value">{po.contact_name || po.buyer_name}</span></div>
            )}
            {(po.contact_email || po.supplier_email) && (
              <div className="card-field"><span className="card-field-label">Email</span><span className="card-field-sep">:</span><span className="card-field-value">{po.contact_email || po.supplier_email}</span></div>
            )}
            {po.contact_wechat && (
              <div className="card-field"><span className="card-field-label">WeChat</span><span className="card-field-sep">:</span><span className="card-field-value">{po.contact_wechat}</span></div>
            )}
            {(po.contact_phone || po.supplier_phone) && (
              <div className="card-field"><span className="card-field-label">Phone</span><span className="card-field-sep">:</span><span className="card-field-value">{po.contact_phone || po.supplier_phone}</span></div>
            )}
          </div>

          {/* Card 2 — Shipping Information */}
          <div className="info-card theme-blue">
            <div className="card-head">
              <div className="card-icon">🚚</div>
              <div className="card-title">Shipping Information</div>
            </div>
            {po.customer_name && (
              <div className="card-field"><span className="card-field-label">Name</span><span className="card-field-sep">:</span><span className="card-field-value">{po.customer_name}</span></div>
            )}
            {po.shipping_address && (
              <div className="card-field"><span className="card-field-label">Address</span><span className="card-field-sep">:</span><span className="card-field-value" style={{ whiteSpace: 'pre-line' }}>{po.shipping_address}</span></div>
            )}
            <div className="card-field"><span className="card-field-label">Shipping Method</span><span className="card-field-sep">:</span><span className="card-field-value">{po.shipping_method || 'Standard Shipping (5–7 Business Days)'}</span></div>
          </div>

          {/* Card 3 — Neck Label Artwork & Application (standard brand label) */}
          <div className="info-card theme-purple">
            <div className="card-head">
              <div className="card-icon">🏷️</div>
              <div className="card-title">Neck Label Artwork &amp; Application</div>
            </div>
            <div className="neck-grid">
              <div>
                <div className="neck-sub">Neck Label Artwork</div>
                <div className="neck-label-box">
                  <div className="neck-brand">decoinks</div>
                  <div className="neck-tag">PRINTSHOP OS</div>
                </div>
                <div className="neck-size">Size: Neck Label 2" × 2"</div>
              </div>
              <div>
                <div className="neck-sub">Application Instructions</div>
                <ul className="neck-list">
                  <li>Apply inside neck area.</li>
                  <li>Center horizontally.</li>
                  <li>Position 1 inch below collar seam.</li>
                  <li>Use approved neck label artwork only.</li>
                  <li>Verify orientation before pressing.</li>
                </ul>
              </div>
            </div>
          </div>

          {/* Card 4 — Notes & Packing */}
          <div className="info-card theme-orange">
            <div className="card-head">
              <div className="card-icon">📋</div>
              <div className="card-title">Notes &amp; Packing</div>
            </div>
            <div className="card-notes">
              <ul>
                {noteLines.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            </div>
          </div>

        </div>
        ) : (
        <div className="info-cards">

          {/* Card 1 — Supplier Information */}
          <div className="info-card theme-green">
            <div className="card-head">
              <div className="card-icon">🤝</div>
              <div className="card-title">Supplier Information</div>
            </div>
            <div className="card-field">
              <span className="card-field-label">Supplier Name</span>
              <span className="card-field-sep">:</span>
              <span className="card-field-value">{po.supplier_name || po.supplier_company || '—'}</span>
            </div>
            {po.buyer_name && (
              <div className="card-field">
                <span className="card-field-label">Contact Person</span>
                <span className="card-field-sep">:</span>
                <span className="card-field-value">{po.buyer_name}</span>
              </div>
            )}
            {po.supplier_email && (
              <div className="card-field">
                <span className="card-field-label">Email</span>
                <span className="card-field-sep">:</span>
                <span className="card-field-value">{po.supplier_email}</span>
              </div>
            )}
            {po.supplier_phone && (
              <div className="card-field">
                <span className="card-field-label">Phone</span>
                <span className="card-field-sep">:</span>
                <span className="card-field-value">{po.supplier_phone}</span>
              </div>
            )}
            {po.supplier_reference && (
              <div className="card-field">
                <span className="card-field-label">Supplier Ref</span>
                <span className="card-field-sep">:</span>
                <span className="card-field-value">{po.supplier_reference}</span>
              </div>
            )}
            {po.payment_terms && (
              <div className="card-field">
                <span className="card-field-label">Payment Terms</span>
                <span className="card-field-sep">:</span>
                <span className="card-field-value">{po.payment_terms}</span>
              </div>
            )}
            {po.payment_method && (
              <div className="card-field">
                <span className="card-field-label">Payment Method</span>
                <span className="card-field-sep">:</span>
                <span className="card-field-value">{po.payment_method}</span>
              </div>
            )}
          </div>

          {/* Card 2 — Shipping & Billing */}
          <div className="info-card theme-blue">
            <div className="card-head">
              <div className="card-icon">🚚</div>
              <div className="card-title">Shipping &amp; Billing</div>
            </div>
            {po.buyer_name && (
              <div className="card-field">
                <span className="card-field-label">Attn</span>
                <span className="card-field-sep">:</span>
                <span className="card-field-value">{po.buyer_name}</span>
              </div>
            )}
            {po.shipping_address && (
              <div className="card-field">
                <span className="card-field-label">Ship To</span>
                <span className="card-field-sep">:</span>
                <span className="card-field-value" style={{ whiteSpace: 'pre-line' }}>{po.shipping_address}</span>
              </div>
            )}
            {po.billing_address && (
              <div className="card-field">
                <span className="card-field-label">Bill To</span>
                <span className="card-field-sep">:</span>
                <span className="card-field-value" style={{ whiteSpace: 'pre-line' }}>{po.billing_address}</span>
              </div>
            )}
            {po.shipping_method && (
              <div className="card-field">
                <span className="card-field-label">Shipping Method</span>
                <span className="card-field-sep">:</span>
                <span className="card-field-value">{po.shipping_method}</span>
              </div>
            )}
            {(po.freight_charges > 0 || po.other_charges > 0) && (
              <div className="card-field">
                <span className="card-field-label">Freight / Other</span>
                <span className="card-field-sep">:</span>
                <span className="card-field-value">
                  {po.currency} {(Number(po.freight_charges) + Number(po.other_charges)).toFixed(2)}
                </span>
              </div>
            )}
          </div>

          {/* Card 3 — Notes & Instructions */}
          <div className="info-card theme-orange">
            <div className="card-head">
              <div className="card-icon">📋</div>
              <div className="card-title">Notes &amp; Instructions</div>
            </div>
            <div className="card-notes">
              <ul>
                {noteLines.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            </div>
          </div>

        </div>
        )}

        {!isApparelPO && <>
        {/* ══ SECTION 1: GANGSHEET ORDER ══ */}
        <div className="sec-hdr">
          <div className="sec-num">1</div>
          <div className="sec-title">Gangsheet Order</div>
        </div>
        <table className="po-table">
          <thead>
            <tr>
              <th className="left" style={{ width: 40 }}>S.No</th>
              <th className="left">Order No</th>
              <th>Gangsheet Width (inch)</th>
              <th>Total Length (inch)</th>
              <th>No. of Artworks</th>
              <th>Qty (Artworks)</th>
            </tr>
          </thead>
          <tbody>
            {coveredOrders.length > 0 ? coveredOrders.map((ord, idx) => (
              <tr key={ord.id}>
                <td className="td-sno left">{idx + 1}</td>
                <td className="left"><span className="order-no-link">{ord.order_number}</span></td>
                <td>{parseGsWidth(ord.gangsheet_sizes)}</td>
                <td>{parseGsLength(ord.gangsheet_sizes)}</td>
                <td style={{ fontWeight: 700 }}>{ord.no_artworks || '—'}</td>
                <td style={{ fontWeight: 700, color: '#0f1f3d' }}>{ord.qty || '—'}</td>
              </tr>
            )) : items.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ padding: '18px', textAlign: 'center', color: '#9ca3af' }}>No items</td>
              </tr>
            ) : items.map((item, idx) => (
              <tr key={item.id}>
                <td className="td-sno left">{idx + 1}</td>
                <td className="left">
                  <span className="order-no-link">{gsOrderNo}</span>
                </td>
                <td>{parseGsWidth(item.item_name)}</td>
                <td>{parseGsLength(item.item_name)}</td>
                <td style={{ fontWeight: 700 }}>{item.artwork_count || totalArtworks}</td>
                <td style={{ fontWeight: 700, color: '#0f1f3d' }}>{item.qty_ordered}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td className="left" colSpan={2} style={{ fontWeight: 800, color: '#0f1f3d' }}>TOTAL</td>
              <td>—</td>
              <td>—</td>
              <td style={{ fontWeight: 800 }}>{gsTotalArtworks}</td>
              <td style={{ fontWeight: 800 }}>{gsTotalQty}</td>
            </tr>
          </tfoot>
        </table>

        {/* ══ SECTION 2: GANGSHEETS BREAKDOWN ══ */}
        <div className="sec-hdr" style={{ marginTop: 2 }}>
          <div className="sec-num">2</div>
          <div className="sec-title">Gangsheets Breakdown</div>
        </div>
        <table className="po-table">
          <thead>
            <tr>
              <th className="left" style={{ width: 40 }}>S.No</th>
              <th className="left">Gangsheet No</th>
              <th>Gangsheet Size (W × L)</th>
              <th>No. of Artworks</th>
              <th>Artworks Covered</th>
              <th>Qty (Artworks)</th>
            </tr>
          </thead>
          <tbody>
            {fragments.length > 0 ? fragments.map((f, idx) => (
              <tr key={f.id}>
                <td className="td-sno left">{idx + 1}</td>
                <td className="left" style={{ fontWeight: 600 }}>{f.fragment_no}</td>
                <td>{f.width_inches && f.length_inches ? `${f.width_inches}" × ${f.length_inches}"` : '—'}</td>
                <td style={{ fontWeight: 700 }}>{f.artworks_count}</td>
                <td style={{ color: '#374151' }}>{f.covers_order_number || artRange}</td>
                <td style={{ fontWeight: 700, color: '#0f1f3d' }}>{f.qty}</td>
              </tr>
            )) : items.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ padding: '18px', textAlign: 'center', color: '#9ca3af' }}>No items</td>
              </tr>
            ) : items.map((item, idx) => {
              const gsNo = `GS-${po.po_number}-${String(idx + 1).padStart(2, '0')}`
              const gsSize = item.item_name || '—'
              const artCount = item.artwork_count || totalArtworks
              return (
                <tr key={item.id}>
                  <td className="td-sno left">{idx + 1}</td>
                  <td className="left" style={{ fontWeight: 600 }}>{gsNo}</td>
                  <td>{gsSize}</td>
                  <td style={{ fontWeight: 700 }}>{artCount}</td>
                  <td style={{ color: '#374151' }}>{artRange}</td>
                  <td style={{ fontWeight: 700, color: '#0f1f3d' }}>{item.qty_ordered}</td>
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr>
              <td className="left" colSpan={2} style={{ fontWeight: 800, color: '#0f1f3d' }}>TOTAL</td>
              <td>—</td>
              <td style={{ fontWeight: 800 }}>{fragments.length ? fragments.reduce((s, f) => s + (f.artworks_count || 0), 0) : gsTotalArtworks}</td>
              <td>—</td>
              <td style={{ fontWeight: 800 }}>{fragments.length ? fragments.reduce((s, f) => s + (f.qty || 0), 0) : gsTotalQty}</td>
            </tr>
          </tfoot>
        </table>

        </>}

        {/* ══ APPAREL ITEMS TABLE (matches the approved template) ══ */}
        {isApparelPO && (
          <table className="po-table apparel-tbl">
            <thead>
              <tr>
                <th rowSpan={2} style={{ width: 32 }}>#</th>
                <th rowSpan={2} className="left" style={{ minWidth: 130 }}>Item Description<br /><span style={{ fontSize: 8, opacity: 0.75 }}>(T-Shirts)</span></th>
                <th rowSpan={2} style={{ width: 76 }}>Color</th>
                <th rowSpan={2} style={{ width: 56 }}>Qty<br />(T-Shirts)</th>
                <th colSpan={6} style={{ borderBottom: '1px solid rgba(255,255,255,0.25)' }}>Size Breakdown (T-Shirts)</th>
                <th rowSpan={2} style={{ width: 72 }}>Front Artwork<br />(Thumbnail)</th>
                <th rowSpan={2} style={{ width: 72 }}>Back Artwork<br />(Thumbnail)</th>
                {hasFrontMockup && <th rowSpan={2} style={{ width: 72 }}>Front Mockup</th>}
                {hasBackMockup && <th rowSpan={2} style={{ width: 72 }}>Back Mockup</th>}
              </tr>
              <tr>
                {SIZE_COLS.map(s => <th key={s} style={{ width: 32 }}>{s}</th>)}
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr><td colSpan={apparelCols} style={{ padding: '18px', textAlign: 'center', color: '#9ca3af' }}>No items</td></tr>
              ) : items.map((it, idx) => {
                const sizes = parseSizes(it.size, Number(it.qty_ordered) || 0)
                return (
                  <tr key={it.id}>
                    <td style={{ textAlign: 'center', fontWeight: 600, color: '#374151' }}>{idx + 1}</td>
                    <td className="left">
                      <div style={{ fontWeight: 600, fontSize: 11, color: '#0f1f3d' }}>{it.item_name}</div>
                      <div style={{ fontSize: 9, color: '#64748b' }}>{[it.brand, it.catalog_sku].filter(Boolean).join(' · ')}</div>
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}><span className="clr-dot" style={{ background: colorHex(it.color) }} />{it.color || '—'}</td>
                    <td style={{ textAlign: 'center', fontWeight: 700 }}>{it.qty_ordered}</td>
                    {SIZE_COLS.map(s => (
                      <td key={s} style={{ textAlign: 'center', fontWeight: sizes[s] ? 600 : 400, color: sizes[s] ? '#111827' : '#d1d5db' }}>{sizes[s]}</td>
                    ))}
                    <td style={{ textAlign: 'center' }}>
                      <ArtworkThumb src={itemFrontArt(it)} alt="front artwork" label={`${it.artwork_no || it.item_name} — Front`} className="art-thumb" fallback={<div className="art-empty-thumb">—</div>} />
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <ArtworkThumb src={it.back_image} alt="back artwork" label={`${it.artwork_no || it.item_name} — Back`} className="art-thumb" fallback={<div className="art-empty-thumb" style={{ color: '#d1d5db' }}>—</div>} />
                    </td>
                    {hasFrontMockup && (
                      <td style={{ textAlign: 'center' }}>
                        <ArtworkThumb src={it.front_mockup} alt="front mockup" label={`${it.artwork_no || it.item_name} — Front Mockup`} className="art-thumb" fallback={<div className="art-empty-thumb">—</div>} />
                      </td>
                    )}
                    {hasBackMockup && (
                      <td style={{ textAlign: 'center' }}>
                        <ArtworkThumb src={it.back_mockup} alt="back mockup" label={`${it.artwork_no || it.item_name} — Back Mockup`} className="art-thumb" fallback={<div className="art-empty-thumb">—</div>} />
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}

        {/* ══ ARTWORKS GRID (gangsheet only) ══ */}
        {!isApparelPO && <>
        <div className="sec-hdr" style={{ marginTop: 2 }}>
          <div className="sec-num">3</div>
          <div className="sec-title">Artworks ({totalArtworks} Artworks)</div>
        </div>

        {artworks.length === 0 ? (
          <div style={{ padding: '20px', textAlign: 'center', color: '#9ca3af', fontSize: 11 }}>
            No artworks linked — attach an order with artworks to this PO to see them here.
          </div>
        ) : (
          <div className={`artworks-grid ${artworkDensity}`}>
            {artworks.map((art, index) => {
              const image = art.thumbnail_url || art.file_url
              const canPreview = image && art.file_type !== 'pdf'
              return (
                <div className="art-card" key={art.id}>
                  <ArtworkThumb
                    src={canPreview ? image : null}
                    alt={art.artwork_no}
                    label={`${art.artwork_no} — ${art.name}`}
                    className="art-card-thumb"
                    fallback={<div className="art-card-thumb art-card-empty">🖼</div>}
                  />
                  <div>
                    <div className="art-card-no">{index + 1}. {art.artwork_no}</div>
                    <div className="art-card-meta">
                      <span>Size <strong>{artSize(art)}</strong></span>
                      <span>Qty <strong>{art.qty ?? 1}</strong></span>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
        </>}

        {/* ══ STATS BAR ══ */}
        {isApparelPO ? (
        <div className="stats-bar">
          <div className="stat-cell">
            <div className="stat-icon-box">👕</div>
            <div className="stat-text">
              <div className="stat-label">Total Items</div>
              <div className="stat-value">{items.length}</div>
            </div>
          </div>
          <div className="stat-cell">
            <div className="stat-icon-box">🖼</div>
            <div className="stat-text">
              <div className="stat-label">Total Artworks</div>
              <div className="stat-value">{new Set(items.map(it => itemFrontArt(it) || it.artwork_no).filter(Boolean)).size || totalArtworks}</div>
            </div>
          </div>
          <div className="stat-cell">
            <div className="stat-icon-box">📦</div>
            <div className="stat-text">
              <div className="stat-label">Total Quantity</div>
              <div className="stat-value">{totalQty} PCS</div>
            </div>
          </div>
        </div>
        ) : (
        <div className="stats-bar">
          <div className="stat-cell">
            <div className="stat-icon-box">📐</div>
            <div className="stat-text">
              <div className="stat-label">Total Artworks</div>
              <div className="stat-value">{fragments.length ? fragments.reduce((s, f) => s + (f.artworks_count || 0), 0) || gsTotalArtworks : gsTotalArtworks}</div>
            </div>
          </div>
          <div className="stat-cell">
            <div className="stat-icon-box">🖼</div>
            <div className="stat-text">
              <div className="stat-label">Total Gangsheets</div>
              <div className="stat-value">{fragments.length || items.length}</div>
            </div>
          </div>
          <div className="stat-cell">
            <div className="stat-icon-box">📦</div>
            <div className="stat-text">
              <div className="stat-label">Total Qty (Artworks)</div>
              <div className="stat-value">{gsTotalQty}</div>
            </div>
          </div>
        </div>
        )}

        {/* ══ FOOTER BAND (apparel) ══ */}
        {isApparelPO && <div className="po-footer-band"><span className="pfb-line" /><span className="pfb-line" /></div>}

        {/* ══ PRODUCTION NOTES (gangsheet) ══ */}
        {!isApparelPO && (
        <div className="prod-notes">
          <div className="prod-notes-hdr">
            <div className="prod-notes-icon">📋</div>
            <div className="prod-notes-title">Production Notes</div>
          </div>
          <div className="prod-notes-cols">
            {noteLines.map((line, i) => (
              <div key={i} className="prod-notes-item">
                <span className="prod-notes-dot">•</span>
                <span>{line}</span>
              </div>
            ))}
          </div>
        </div>
        )}

      </div>
      <ArtworkLightboxOverlay />
    </ArtworkLightboxProvider>
  )
}
