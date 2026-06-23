import { useParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '../services/api'
import { usePrintAuth } from '../hooks/usePrintAuth'

// ── Types ─────────────────────────────────────────────────────────────────────

interface POItem {
  id: string
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
  front_image?: string | null
  back_image?: string | null
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
}

interface Artwork {
  id: string
  artwork_no: string
  name: string
  file_url: string | null
  file_type: string | null
  width?: number | null
  height?: number | null
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
  }

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
     ARTWORKS 2-COLUMN GRID
  ══════════════════════════════════════════ */
  .artworks-grid {
    display: grid; grid-template-columns: 1fr 1fr;
    border: none; gap: 0;
  }
  .art-col-table { width: 100%; border-collapse: collapse; font-size: 10.5px; }
  .art-col-table thead th {
    background: #1a3260; color: #c7d7f5;
    padding: 7px 8px; font-size: 9.5px; font-weight: 700;
    text-align: center; border: 1px solid rgba(255,255,255,0.08);
    white-space: nowrap;
  }
  .art-col-table tbody tr { border-bottom: 1px solid #f1f5f9; }
  .art-col-table tbody tr:nth-child(even) { background: #f8fafc; }
  .art-col-table tbody td {
    padding: 6px 8px; text-align: center;
    border-right: 1px solid #f1f5f9;
    vertical-align: middle; font-size: 10.5px;
  }
  .art-col-table tbody td:first-child { color: #6b7280; font-weight: 700; width: 30px; }
  .art-col-right thead th { border-left: 3px solid #0f1f3d; }

  .art-thumb {
    width: 52px; height: 52px; object-fit: contain;
    border: 1px solid #e2e8f0; border-radius: 4px;
    background: #fff; display: block; margin: 0 auto;
  }
  .art-empty-thumb {
    width: 52px; height: 52px;
    display: flex; align-items: center; justify-content: center;
    color: #d1d5db; font-size: 20px; margin: 0 auto;
    border: 1px dashed #e2e8f0; border-radius: 4px; background: #fafafa;
  }
  .more-artworks {
    text-align: center; padding: 10px;
    font-size: 11px; font-weight: 600; color: #6b7280;
    background: #f8fafc; border-top: 1px solid #e5e7eb;
    grid-column: 1 / -1;
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
`

// ── Main component ────────────────────────────────────────────────────────────

export function PurchaseOrderPrintPage() {
  const { id }      = useParams<{ id: string }>()
  const navigate    = useNavigate()
  const { authReady, authFailed } = usePrintAuth()

  const { data: po, isLoading } = useQuery<PurchaseOrder>({
    queryKey: ['purchase-order-print', id],
    queryFn:  () => api.get(`/purchase-orders/${id}`).then(r => r.data.po ?? r.data.data ?? r.data),
    enabled: !!id && authReady,
  })

  const { data: artworkData } = useQuery<{ artworks: Artwork[] }>({
    queryKey: ['order-artworks-for-po', po?.order_id],
    queryFn:  () => api.get(`/orders/${po!.order_id}/artworks`).then(r => r.data),
    enabled:  !!po?.order_id && authReady,
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
  if (!po) return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', fontFamily: 'Inter, sans-serif', fontSize: 15, color: '#ef4444' }}>
      Purchase order not found.
    </div>
  )

  const items    = po.items ?? []
  const artworks = artworkData?.artworks ?? []

  // Totals
  const totalArtworks = artworks.length
    || items.reduce((s, it) => s + (it.artwork_count ?? 0), 0)
    || po.order_total_artworks
    || 0
  const totalQty      = items.reduce((s, it) => s + (it.qty_ordered ?? 0), 0)

  // Artwork range string e.g. "AW1001 – AW1076"
  const artRange = artworks.length > 0
    ? `${artworks[0].artwork_no} – ${artworks[artworks.length - 1].artwork_no}`
    : '—'

  // For the Gangsheet Order summary row (section 1) – aggregate all items
  const totalWidth  = items[0] ? parseGsWidth(items[0].item_name) : '—'
  const gsOrderNo   = po.order_id ? (po.order_number || `ORD-${po.po_number}`) : po.po_number

  // Notes as bullet list
  const noteLines: string[] = po.notes
    ? po.notes.split('\n').map(l => l.trim()).filter(Boolean)
    : [
        'All gangsheets are print-ready.',
        'Please verify quantities before production.',
        'Refer to Gangsheet Numbers listed above.',
        'Artwork revisions are not permitted after approval.',
        'Ensure all measurements and artwork placements are accurate.',
      ]

  // Artworks to display (first 10 in 2 columns)
  const DISPLAY_COUNT = 10
  const leftArtworks  = artworks.slice(0, Math.ceil(Math.min(artworks.length, DISPLAY_COUNT) / 2))
  const rightArtworks = artworks.slice(leftArtworks.length, DISPLAY_COUNT)
  const remainingArt  = artworks.length > DISPLAY_COUNT ? artworks.length - DISPLAY_COUNT : 0

  const renderArtThumb = (art: Artwork) => {
    if (art.file_url && art.file_type !== 'pdf') {
      return <img src={art.file_url} alt={art.artwork_no} className="art-thumb" />
    }
    return <div className="art-empty-thumb">🖼</div>
  }

  const artSize = (art: Artwork) => {
    if (art.width && art.height) return `${art.width} × ${art.height}`
    return art.name || '—'
  }

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
                <tr>
                  <td className="pm-label">Currency</td>
                  <td className="pm-colon">:</td>
                  <td className="pm-value">{po.currency || 'USD'}</td>
                </tr>
                <tr>
                  <td className="pm-label">Grand Total</td>
                  <td className="pm-colon">:</td>
                  <td className="pm-value" style={{ color: '#15803d' }}>{po.currency || 'USD'} {Number(po.grand_total ?? 0).toFixed(2)}</td>
                </tr>
              </tbody>
            </table>
          </div>

        </div>

        {/* ══ 3 INFO CARDS ══ */}
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
            {items.length === 0 ? (
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
              <td style={{ fontWeight: 800 }}>{totalArtworks}</td>
              <td style={{ fontWeight: 800 }}>{totalQty}</td>
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
            {items.length === 0 ? (
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
              <td style={{ fontWeight: 800 }}>{totalArtworks}</td>
              <td>—</td>
              <td style={{ fontWeight: 800 }}>{totalQty}</td>
            </tr>
          </tfoot>
        </table>

        {/* ══ SECTION 3: LINE ITEMS WITH ARTWORK ══ */}
        {items.some(it => it.front_image || it.back_image) && (
          <>
            <div className="sec-hdr" style={{ marginTop: 2 }}>
              <div className="sec-num">3</div>
              <div className="sec-title">Line Items — Artwork Preview</div>
            </div>
            <table className="po-table">
              <thead>
                <tr>
                  <th style={{ width: 36 }}>S.No</th>
                  <th className="left">Item / Description</th>
                  <th style={{ width: 68 }}>Front Art</th>
                  <th style={{ width: 68 }}>Back Art</th>
                  <th style={{ width: 60 }}>Qty</th>
                  <th style={{ width: 76 }}>Unit Price</th>
                  <th style={{ width: 80 }}>Line Total</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it, idx) => (
                  <tr key={it.id}>
                    <td style={{ textAlign: 'center', fontWeight: 600, color: '#374151' }}>{idx + 1}</td>
                    <td className="left">
                      <div style={{ fontWeight: 600, fontSize: 11 }}>{it.item_name}</div>
                      {it.description && <div style={{ fontSize: 10, color: '#6b7280', marginTop: 2 }}>{it.description}</div>}
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      {it.front_image
                        ? <img src={it.front_image} alt="front" className="art-thumb" />
                        : <div className="art-empty-thumb">—</div>}
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      {it.back_image
                        ? <img src={it.back_image} alt="back" className="art-thumb" />
                        : <div className="art-empty-thumb" style={{ color: '#d1d5db' }}>—</div>}
                    </td>
                    <td style={{ textAlign: 'center', fontWeight: 600 }}>{it.qty_ordered}</td>
                    <td style={{ textAlign: 'right' }}>{Number(it.unit_price).toFixed(2)}</td>
                    <td style={{ textAlign: 'right', fontWeight: 700 }}>{Number(it.line_total).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        {/* ══ SECTION 4: ARTWORKS ══ */}
        <div className="sec-hdr" style={{ marginTop: 2 }}>
          <div className="sec-num">{items.some(it => it.front_image || it.back_image) ? 4 : 3}</div>
          <div className="sec-title">Artworks ({totalArtworks} Artworks)</div>
        </div>

        {artworks.length === 0 ? (
          <div style={{ padding: '20px', textAlign: 'center', color: '#9ca3af', fontSize: 11 }}>
            No artworks linked — attach an order with artworks to this PO to see them here.
          </div>
        ) : (
          <div className="artworks-grid">
            {/* Left column */}
            <table className="art-col-table art-col-left">
              <thead>
                <tr>
                  <th>S.No</th>
                  <th>Artwork No</th>
                  <th>Thumbnail</th>
                  <th>Artwork Size (inch)</th>
                  <th>Qty</th>
                </tr>
              </thead>
              <tbody>
                {leftArtworks.map((art, i) => (
                  <tr key={art.id}>
                    <td>{i + 1}</td>
                    <td style={{ fontWeight: 600 }}>{art.artwork_no}</td>
                    <td>{renderArtThumb(art)}</td>
                    <td style={{ fontSize: 10, color: '#374151' }}>{artSize(art)}</td>
                    <td style={{ fontWeight: 700, color: '#0f1f3d' }}>
                      {items[0]?.qty_ordered
                        ? Math.round(items[0].qty_ordered / Math.max(totalArtworks, 1))
                        : 5}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Right column */}
            <table className="art-col-table art-col-right">
              <thead>
                <tr>
                  <th>S.No</th>
                  <th>Artwork No</th>
                  <th>Thumbnail</th>
                  <th>Artwork Size (inch)</th>
                  <th>Qty</th>
                </tr>
              </thead>
              <tbody>
                {rightArtworks.map((art, i) => (
                  <tr key={art.id}>
                    <td>{leftArtworks.length + i + 1}</td>
                    <td style={{ fontWeight: 600 }}>{art.artwork_no}</td>
                    <td>{renderArtThumb(art)}</td>
                    <td style={{ fontSize: 10, color: '#374151' }}>{artSize(art)}</td>
                    <td style={{ fontWeight: 700, color: '#0f1f3d' }}>
                      {items[0]?.qty_ordered
                        ? Math.round(items[0].qty_ordered / Math.max(totalArtworks, 1))
                        : 5}
                    </td>
                  </tr>
                ))}
                {rightArtworks.length < leftArtworks.length && (
                  Array.from({ length: leftArtworks.length - rightArtworks.length }).map((_, i) => (
                    <tr key={`empty-${i}`}>
                      <td colSpan={5} style={{ background: '#fafafa' }}></td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>

            {remainingArt > 0 && (
              <div className="more-artworks">... and {remainingArt} more artworks</div>
            )}
          </div>
        )}

        {/* ══ STATS BAR ══ */}
        <div className="stats-bar">
          <div className="stat-cell">
            <div className="stat-icon-box">📐</div>
            <div className="stat-text">
              <div className="stat-label">Total Artworks</div>
              <div className="stat-value">{totalArtworks}</div>
            </div>
          </div>
          <div className="stat-cell">
            <div className="stat-icon-box">🖼</div>
            <div className="stat-text">
              <div className="stat-label">Total Gangsheets</div>
              <div className="stat-value">{items.length}</div>
            </div>
          </div>
          <div className="stat-cell">
            <div className="stat-icon-box">📦</div>
            <div className="stat-text">
              <div className="stat-label">Total Qty (Artworks)</div>
              <div className="stat-value">{totalQty}</div>
            </div>
          </div>
        </div>

        {/* ══ PRODUCTION NOTES ══ */}
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

      </div>
    </>
  )
}
