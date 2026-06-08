import { useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '../services/api'
import { useAuthStore } from '../store/authStore'

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
}

interface PurchaseOrder {
  id: string
  po_number: string
  status: string
  priority: string
  currency: string
  order_date: string | null
  expected_date: string | null
  created_at: string
  supplier_id: string | null
  supplier_name: string | null
  supplier_email: string | null
  supplier_phone: string | null
  supplier_city: string | null
  supplier_company: string | null
  supplier_reference: string | null
  payment_terms: string | null
  buyer_name: string | null
  department: string | null
  shipping_method: string | null
  shipping_address: string | null
  billing_address: string | null
  notes: string | null
  terms_conditions: string | null
  subtotal: number
  total_discount: number
  total_tax: number
  freight_charges: number
  other_charges: number
  grand_total: number
  order_id: string | null
  items: POItem[]
}

interface Artwork {
  id: string
  artwork_no: string
  name: string
  file_url: string | null
  file_type: string | null
  location: string | null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmtDate = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' }) : '—'

const fmt = (n: number | null | undefined) =>
  '$' + Number(n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function parseSizes(raw: string | null): Record<string, number> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed
  } catch {}
  const result: Record<string, number> = {}
  const rx = /([A-Z0-9/]+)\s*[-:]\s*(\d+)/gi
  let m: RegExpExecArray | null
  while ((m = rx.exec(raw)) !== null) {
    result[m[1].toUpperCase()] = parseInt(m[2], 10)
  }
  return result
}

const SIZE_KEYS = ['S', 'M', 'L', 'XL', '2XL', '3XL']

// ── Company constants ─────────────────────────────────────────────────────────

const CO = {
  name: 'decoinks',
  tagline: 'PRINTSHOP OS',
  address: 'Suite 111, 1218 Magnolia Avenue',
  city: 'Corona, CA 92881',
  country: 'United States',
  email: 'info@decoinks.com',
  phone: '+1 (714) 790-1460',
  website: 'www.decoinks.com',
}

// ── CSS ───────────────────────────────────────────────────────────────────────

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap');
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Inter', sans-serif; font-size: 11px; color: #111827; background: #f1f5f9; }
  .page { max-width: 1100px; margin: 0 auto; background: #fff; }

  @media print {
    body { background: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .no-print { display: none !important; }
    .page { max-width: 100%; }
    @page { margin: 6mm; size: A4 landscape; }
  }

  /* ── Print button ── */
  .print-btn {
    position: fixed; top: 16px; right: 16px; z-index: 999;
    background: #0f1f3d; color: #fff; border: none;
    padding: 10px 22px; border-radius: 8px;
    font-size: 13px; font-weight: 600; cursor: pointer;
    display: flex; align-items: center; gap: 8px;
    box-shadow: 0 4px 14px rgba(0,0,0,0.25);
  }
  .print-btn:hover { background: #1a3260; }

  /* ── HEADER ── */
  .po-header {
    background: #0f1f3d;
    padding: 22px 28px;
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 20px;
  }
  .po-logo-wrap { display: flex; flex-direction: column; gap: 2px; }
  .po-logo-name {
    font-size: 28px; font-weight: 900; color: #fff;
    letter-spacing: -1px; text-transform: lowercase;
    display: flex; align-items: center; gap: 4px;
  }
  .logo-dots { display: flex; gap: 3px; align-items: center; margin-left: 2px; }
  .logo-dots span { width: 7px; height: 7px; border-radius: 50%; }
  .po-logo-tag { font-size: 9px; font-weight: 700; letter-spacing: 2.5px; color: #94a3b8; text-transform: uppercase; margin-top: 2px; }
  .po-co-addr { margin-top: 10px; }
  .po-co-addr p { font-size: 10px; color: #94a3b8; line-height: 1.7; }

  .po-title-center { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; flex: 1; }
  .po-title-text {
    font-size: 38px; font-weight: 900; color: #fff;
    letter-spacing: 6px; text-transform: uppercase; line-height: 1;
  }
  .po-status-badge {
    background: rgba(255,255,255,0.12); color: #e2e8f0;
    padding: 3px 12px; border-radius: 20px;
    font-size: 10px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase;
  }
  .po-priority-badge {
    padding: 3px 10px; border-radius: 20px;
    font-size: 10px; font-weight: 700; letter-spacing: 0.5px;
  }
  .pri-urgent { background: #fef2f2; color: #dc2626; }
  .pri-high   { background: #fff7ed; color: #ea580c; }
  .pri-medium { background: #eff6ff; color: #2563eb; }
  .pri-low    { background: #f0fdf4; color: #16a34a; }

  .po-meta-box {
    background: rgba(255,255,255,0.07);
    border: 1px solid rgba(255,255,255,0.15);
    border-radius: 10px; padding: 12px 16px; min-width: 210px;
  }
  .po-meta-box table { border-collapse: collapse; width: 100%; }
  .po-meta-box td { padding: 3.5px 0; font-size: 11px; }
  .pm-lbl { color: #94a3b8; font-weight: 500; width: 110px; }
  .pm-val { color: #fff; font-weight: 700; }
  .pm-sep { color: #475569; padding: 0 6px; }

  /* ── Info cards ── */
  .info-cards-row {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 0;
    border-bottom: 1px solid #e2e8f0;
  }
  .info-card-po {
    padding: 14px 16px;
    border-right: 1px solid #e2e8f0;
  }
  .info-card-po:last-child { border-right: none; }
  .card-po-hdr {
    display: flex; align-items: center; gap: 7px;
    margin-bottom: 10px; padding-bottom: 8px;
    border-bottom: 2px solid;
  }
  .card-po-icon {
    width: 26px; height: 26px; border-radius: 6px;
    display: flex; align-items: center; justify-content: center;
    font-size: 13px; flex-shrink: 0; color: #fff;
  }
  .card-po-title {
    font-size: 9px; font-weight: 800; letter-spacing: 1.5px;
    text-transform: uppercase;
  }
  .card-po-body p { font-size: 11px; color: #374151; line-height: 1.65; }
  .card-po-body .val-name { font-size: 13px; font-weight: 700; color: #111827; }
  .card-po-body .val-sub  { font-size: 10.5px; color: #6b7280; }

  /* Card color themes */
  .theme-green .card-po-hdr { border-color: #16a34a; }
  .theme-green .card-po-icon { background: #16a34a; }
  .theme-green .card-po-title { color: #16a34a; }

  .theme-blue .card-po-hdr { border-color: #2563eb; }
  .theme-blue .card-po-icon { background: #2563eb; }
  .theme-blue .card-po-title { color: #2563eb; }

  .theme-purple .card-po-hdr { border-color: #7c3aed; }
  .theme-purple .card-po-icon { background: #7c3aed; }
  .theme-purple .card-po-title { color: #7c3aed; }

  .theme-orange .card-po-hdr { border-color: #ea580c; }
  .theme-orange .card-po-icon { background: #ea580c; }
  .theme-orange .card-po-title { color: #ea580c; }

  /* ── Neck label mockup ── */
  .neck-label {
    width: 80px; height: 80px;
    background: #0f1f3d;
    border-radius: 6px;
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    gap: 2px; margin: 4px 0;
  }
  .neck-label-name {
    font-size: 11px; font-weight: 900; color: #fff;
    letter-spacing: -0.5px; text-transform: lowercase;
    display: flex; align-items: center; gap: 2px;
  }
  .neck-dots { display: flex; gap: 2px; }
  .neck-dots span { width: 5px; height: 5px; border-radius: 50%; }
  .neck-label-tag { font-size: 7px; color: #94a3b8; letter-spacing: 1.5px; text-transform: uppercase; }
  .neck-label-sub { font-size: 7px; color: #64748b; margin-top: 2px; }

  /* ── Items table ── */
  .tbl-section { padding: 0; overflow-x: auto; }
  .items-tbl {
    width: 100%; border-collapse: collapse;
    font-size: 10.5px;
  }
  .items-tbl thead tr.hdr-row1 { background: #0f1f3d; color: #fff; }
  .items-tbl thead tr.hdr-row2 { background: #1a3260; color: #c7d7f5; }
  .items-tbl thead th {
    padding: 8px 5px; text-align: center;
    font-size: 9px; font-weight: 700;
    letter-spacing: 0.4px; text-transform: uppercase;
    white-space: nowrap; border: 1px solid rgba(255,255,255,0.08);
  }
  .items-tbl thead th.left { text-align: left; }
  .items-tbl thead th.size-group {
    background: #1e3a5f; font-size: 9.5px; letter-spacing: 1px;
  }
  .items-tbl thead th.art-group { background: #1a3260; }
  .items-tbl tbody tr { border-bottom: 1px solid #f1f5f9; }
  .items-tbl tbody tr:nth-child(even) { background: #f8fafc; }
  .items-tbl tbody td {
    padding: 7px 5px; text-align: center;
    vertical-align: middle; border-right: 1px solid #f1f5f9;
    font-size: 10.5px;
  }
  .items-tbl tbody td.left { text-align: left; }
  .items-tbl tbody td.item-num {
    font-weight: 700; color: #6b7280; width: 30px;
  }
  .items-tbl .item-name-cell .name { font-weight: 600; color: #111827; font-size: 11px; }
  .items-tbl .item-name-cell .desc { font-size: 9.5px; color: #6b7280; margin-top: 1px; }
  .items-tbl .size-val { font-weight: 700; color: #1a3260; font-size: 11px; }
  .items-tbl .size-zero { color: #d1d5db; }
  .art-thumb-cell { width: 60px; }
  .art-thumb {
    width: 52px; height: 52px; object-fit: contain;
    border: 1px solid #e2e8f0; border-radius: 4px;
    background: #fff; display: block; margin: 0 auto;
  }
  .art-empty {
    width: 52px; height: 52px;
    display: flex; align-items: center; justify-content: center;
    color: #d1d5db; font-size: 18px; margin: 0 auto;
    border: 1px dashed #e2e8f0; border-radius: 4px; background: #fafafa;
  }

  /* ── Totals bar ── */
  .totals-bar {
    background: #0f1f3d;
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    border-top: 3px solid #1e3a5f;
  }
  .totals-cell {
    padding: 12px 16px;
    border-right: 1px solid rgba(255,255,255,0.08);
    display: flex; align-items: center; gap: 12px;
  }
  .totals-cell:last-child { border-right: none; }
  .totals-icon { font-size: 22px; }
  .totals-lbl { font-size: 9px; font-weight: 700; letter-spacing: 1px; color: #94a3b8; text-transform: uppercase; }
  .totals-val { font-size: 16px; font-weight: 900; color: #fff; line-height: 1; }

  /* ── Financial summary row ── */
  .fin-row {
    display: flex; justify-content: flex-end;
    padding: 14px 24px;
    border-bottom: 1px solid #e2e8f0;
    background: #f8fafc;
    gap: 32px; align-items: center;
  }
  .fin-item { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; }
  .fin-lbl { font-size: 9px; font-weight: 600; color: #9ca3af; text-transform: uppercase; letter-spacing: 0.5px; }
  .fin-val { font-size: 12px; font-weight: 700; color: #374151; }
  .fin-total .fin-val { font-size: 16px; font-weight: 900; color: #0f1f3d; }
  .fin-divider { width: 1px; height: 36px; background: #e2e8f0; }

  /* ── Footer ── */
  .po-footer {
    background: #0f1f3d; color: #fff;
    padding: 12px 28px;
    display: flex; justify-content: space-between; align-items: center;
  }
  .footer-brand { font-size: 12px; color: #94a3b8; }
  .footer-msg { font-size: 13px; font-weight: 600; font-style: italic; color: #e2e8f0; letter-spacing: 0.4px; }
  .footer-contact { font-size: 11px; color: #64748b; text-align: right; line-height: 1.6; }
`

// ── Priority badge helper ─────────────────────────────────────────────────────

function priorityClass(p: string | null): string {
  if (!p) return 'pri-medium'
  if (p === 'Urgent') return 'pri-urgent'
  if (p === 'High')   return 'pri-high'
  if (p === 'Low')    return 'pri-low'
  return 'pri-medium'
}

// ── Main component ────────────────────────────────────────────────────────────

export function PurchaseOrderPrintPage() {
  const { id }      = useParams<{ id: string }>()
  const navigate    = useNavigate()
  const { isAuthenticated } = useAuthStore()

  useEffect(() => {
    if (!isAuthenticated) navigate('/login')
  }, [isAuthenticated, navigate])

  const { data: po, isLoading } = useQuery<PurchaseOrder>({
    queryKey: ['purchase-order-print', id],
    queryFn:  () => api.get(`/purchase-orders/${id}`).then(r => r.data.po ?? r.data),
    enabled: !!id,
  })

  const { data: artworkData } = useQuery<{ artworks: Artwork[] }>({
    queryKey: ['order-artworks-for-po', po?.order_id],
    queryFn:  () => api.get(`/orders/${po!.order_id}/artworks`).then(r => r.data),
    enabled:  !!po?.order_id,
  })

  if (isLoading) return (
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
  const currency = po.currency || 'USD'

  const totalQty = items.reduce((s, it) => {
    const sizes = parseSizes(it.remarks)
    const sizeSum = Object.values(sizes).reduce((a, b) => a + b, 0)
    return s + (sizeSum > 0 ? sizeSum : (it.qty_ordered || 0))
  }, 0)

  const frontArtworks = artworks.filter(a => !a.location || a.location?.toLowerCase().includes('front'))
  const backArtworks  = artworks.filter(a => a.location?.toLowerCase().includes('back'))

  const supplierLine1 = po.supplier_name || po.supplier_company || '—'
  const shipAddr = po.shipping_address || '—'

  return (
    <>
      <style>{CSS}</style>

      <button className="print-btn no-print" onClick={() => window.print()}>
        🖨️ Download / Print PDF
      </button>

      <div className="page">

        {/* ── HEADER ── */}
        <div className="po-header">

          {/* Left: Logo + company info */}
          <div className="po-logo-wrap">
            <div className="po-logo-name">
              decoinks
              <span className="logo-dots">
                <span style={{ background: '#ec4899' }} />
                <span style={{ background: '#f97316' }} />
                <span style={{ background: '#eab308' }} />
                <span style={{ background: '#f1f5f9' }} />
              </span>
            </div>
            <div className="po-logo-tag">PRINTSHOP OS</div>
            <div className="po-co-addr" style={{ marginTop: 10 }}>
              <p>{CO.address}</p>
              <p>{CO.city}, {CO.country}</p>
              <p style={{ marginTop: 3 }}>{CO.email}</p>
              <p>{CO.phone}</p>
            </div>
          </div>

          {/* Center: PO title */}
          <div className="po-title-center">
            <div className="po-title-text">Purchase Order</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4 }}>
              <span className="po-status-badge">{po.status}</span>
              {po.priority && (
                <span className={`po-priority-badge ${priorityClass(po.priority)}`}>
                  {po.priority}
                </span>
              )}
            </div>
          </div>

          {/* Right: PO meta */}
          <div className="po-meta-box">
            <table>
              <tbody>
                <tr>
                  <td className="pm-lbl">PO Number</td>
                  <td className="pm-sep">:</td>
                  <td className="pm-val">{po.po_number}</td>
                </tr>
                <tr>
                  <td className="pm-lbl">PO Date</td>
                  <td className="pm-sep">:</td>
                  <td className="pm-val">{fmtDate(po.order_date || po.created_at)}</td>
                </tr>
                <tr>
                  <td className="pm-lbl">Need By Date</td>
                  <td className="pm-sep">:</td>
                  <td className="pm-val">{fmtDate(po.expected_date)}</td>
                </tr>
                {po.payment_terms && (
                  <tr>
                    <td className="pm-lbl">Payment Terms</td>
                    <td className="pm-sep">:</td>
                    <td className="pm-val">{po.payment_terms}</td>
                  </tr>
                )}
                <tr>
                  <td className="pm-lbl">Currency</td>
                  <td className="pm-sep">:</td>
                  <td className="pm-val">{currency}</td>
                </tr>
                {po.buyer_name && (
                  <tr>
                    <td className="pm-lbl">Buyer</td>
                    <td className="pm-sep">:</td>
                    <td className="pm-val">{po.buyer_name}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

        </div>

        {/* ── 4 INFO CARDS ── */}
        <div className="info-cards-row">

          {/* Card 1: Fulfillment Supplier */}
          <div className="info-card-po theme-green">
            <div className="card-po-hdr">
              <div className="card-po-icon">🏭</div>
              <div className="card-po-title">Fulfillment Supplier</div>
            </div>
            <div className="card-po-body">
              <p className="val-name">{supplierLine1}</p>
              {po.supplier_email && <p className="val-sub">✉ {po.supplier_email}</p>}
              {po.supplier_phone && <p className="val-sub">📞 {po.supplier_phone}</p>}
              {po.supplier_city  && <p className="val-sub">📍 {po.supplier_city}</p>}
              {po.supplier_reference && <p className="val-sub">Ref: {po.supplier_reference}</p>}
            </div>
          </div>

          {/* Card 2: Shipping Info */}
          <div className="info-card-po theme-blue">
            <div className="card-po-hdr">
              <div className="card-po-icon">🚚</div>
              <div className="card-po-title">Shipping Info</div>
            </div>
            <div className="card-po-body">
              {po.shipping_method && <p className="val-name">{po.shipping_method}</p>}
              <p style={{ whiteSpace: 'pre-line', fontSize: 11 }}>{shipAddr}</p>
              {po.department && <p className="val-sub">Dept: {po.department}</p>}
            </div>
          </div>

          {/* Card 3: Neck Label */}
          <div className="info-card-po theme-purple">
            <div className="card-po-hdr">
              <div className="card-po-icon">🏷️</div>
              <div className="card-po-title">Neck Label</div>
            </div>
            <div className="card-po-body">
              <div className="neck-label">
                <div className="neck-label-name">
                  decoinks
                  <span className="neck-dots">
                    <span style={{ background: '#ec4899' }} />
                    <span style={{ background: '#f97316' }} />
                    <span style={{ background: '#eab308' }} />
                  </span>
                </div>
                <div className="neck-label-tag">PRINTSHOP OS</div>
                <div className="neck-label-sub">{CO.website}</div>
              </div>
              <p className="val-sub" style={{ marginTop: 4 }}>Standard decoinks neck label</p>
              <p className="val-sub">Include on all garments</p>
            </div>
          </div>

          {/* Card 4: Notes & Packing */}
          <div className="info-card-po theme-orange">
            <div className="card-po-hdr">
              <div className="card-po-icon">📦</div>
              <div className="card-po-title">Notes &amp; Packing</div>
            </div>
            <div className="card-po-body">
              {po.notes ? (
                <p style={{ whiteSpace: 'pre-line', fontSize: 11 }}>{po.notes}</p>
              ) : (
                <p className="val-sub">No special packing instructions.</p>
              )}
              {po.terms_conditions && (
                <p className="val-sub" style={{ marginTop: 6, borderTop: '1px solid #fed7aa', paddingTop: 6 }}>
                  {po.terms_conditions}
                </p>
              )}
            </div>
          </div>

        </div>

        {/* ── ITEMS TABLE ── */}
        <div className="tbl-section">
          <table className="items-tbl">
            <thead>
              {/* Row 1: group headers */}
              <tr className="hdr-row1">
                <th rowSpan={2} style={{ width: 32 }}>#</th>
                <th rowSpan={2} className="left" style={{ minWidth: 160 }}>Item Description</th>
                <th rowSpan={2} style={{ width: 44 }}>Qty</th>
                <th rowSpan={2} style={{ width: 64 }}>Unit Price</th>
                <th colSpan={6} className="size-group">Size Breakdown</th>
                <th rowSpan={2} className="art-group" style={{ width: 62 }}>Front Artwork</th>
                <th rowSpan={2} className="art-group" style={{ width: 62 }}>Back Artwork</th>
                <th rowSpan={2} className="art-group" style={{ width: 62 }}>Front Mockup</th>
                <th rowSpan={2} className="art-group" style={{ width: 62 }}>Back Mockup</th>
                <th rowSpan={2} style={{ width: 76 }}>Line Total</th>
              </tr>
              {/* Row 2: size sub-headers */}
              <tr className="hdr-row2">
                {SIZE_KEYS.map(s => (
                  <th key={s} style={{ width: 34 }}>{s}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr>
                  <td colSpan={15} style={{ padding: '24px', textAlign: 'center', color: '#9ca3af' }}>
                    No line items found
                  </td>
                </tr>
              ) : items.map((item, idx) => {
                const sizes     = parseSizes(item.remarks)
                const frontArt  = frontArtworks[idx] ?? null
                const backArt   = backArtworks[idx] ?? null

                const renderArt = (art: Artwork | null) => {
                  if (art?.file_url && art.file_type !== 'pdf') {
                    return <img src={art.file_url} alt={art.name} className="art-thumb" />
                  }
                  return <div className="art-empty">—</div>
                }

                return (
                  <tr key={item.id}>
                    <td className="item-num">{idx + 1}</td>
                    <td className="left item-name-cell">
                      <div className="name">{item.item_name}</div>
                      {item.description && <div className="desc">{item.description}</div>}
                      {item.hsn_code && <div className="desc">HSN: {item.hsn_code}</div>}
                    </td>
                    <td style={{ fontWeight: 700 }}>{item.qty_ordered}</td>
                    <td>{currency} {fmt(item.unit_price)}</td>
                    {SIZE_KEYS.map(s => {
                      const qty = sizes[s] ?? 0
                      return (
                        <td key={s} className={qty > 0 ? 'size-val' : 'size-zero'}>
                          {qty > 0 ? qty : '—'}
                        </td>
                      )
                    })}
                    <td className="art-thumb-cell">{renderArt(frontArt)}</td>
                    <td className="art-thumb-cell">{renderArt(backArt)}</td>
                    <td className="art-thumb-cell">
                      <div className="art-empty" style={{ fontSize: 10, color: '#94a3b8' }}>
                        Mockup
                      </div>
                    </td>
                    <td className="art-thumb-cell">
                      <div className="art-empty" style={{ fontSize: 10, color: '#94a3b8' }}>
                        Mockup
                      </div>
                    </td>
                    <td style={{ fontWeight: 700 }}>{currency} {fmt(item.line_total)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* ── TOTALS BAR ── */}
        <div className="totals-bar">
          <div className="totals-cell">
            <span className="totals-icon">👕</span>
            <div>
              <div className="totals-lbl">Total Items</div>
              <div className="totals-val">{items.length}</div>
            </div>
          </div>
          <div className="totals-cell">
            <span className="totals-icon">🖼️</span>
            <div>
              <div className="totals-lbl">Total Artworks</div>
              <div className="totals-val">{artworks.length}</div>
            </div>
          </div>
          <div className="totals-cell">
            <span className="totals-icon">📦</span>
            <div>
              <div className="totals-lbl">Total Quantity</div>
              <div className="totals-val">{totalQty} pcs</div>
            </div>
          </div>
          <div className="totals-cell">
            <span className="totals-icon">💰</span>
            <div>
              <div className="totals-lbl">Grand Total</div>
              <div className="totals-val">{currency} {fmt(po.grand_total)}</div>
            </div>
          </div>
        </div>

        {/* ── FINANCIAL SUMMARY ── */}
        <div className="fin-row">
          <div className="fin-item">
            <span className="fin-lbl">Subtotal</span>
            <span className="fin-val">{currency} {fmt(po.subtotal)}</span>
          </div>
          {Number(po.total_discount) > 0 && (
            <>
              <div className="fin-divider" />
              <div className="fin-item">
                <span className="fin-lbl">Discount</span>
                <span className="fin-val" style={{ color: '#dc2626' }}>- {currency} {fmt(po.total_discount)}</span>
              </div>
            </>
          )}
          {Number(po.total_tax) > 0 && (
            <>
              <div className="fin-divider" />
              <div className="fin-item">
                <span className="fin-lbl">Tax</span>
                <span className="fin-val">{currency} {fmt(po.total_tax)}</span>
              </div>
            </>
          )}
          {Number(po.freight_charges) > 0 && (
            <>
              <div className="fin-divider" />
              <div className="fin-item">
                <span className="fin-lbl">Freight</span>
                <span className="fin-val">{currency} {fmt(po.freight_charges)}</span>
              </div>
            </>
          )}
          {Number(po.other_charges) > 0 && (
            <>
              <div className="fin-divider" />
              <div className="fin-item">
                <span className="fin-lbl">Other</span>
                <span className="fin-val">{currency} {fmt(po.other_charges)}</span>
              </div>
            </>
          )}
          <div className="fin-divider" />
          <div className="fin-item fin-total">
            <span className="fin-lbl">Grand Total</span>
            <span className="fin-val">{currency} {fmt(po.grand_total)}</span>
          </div>
        </div>

        {/* ── FOOTER ── */}
        <div className="po-footer">
          <div className="footer-brand">
            decoinks Printshop OS &nbsp;·&nbsp; {CO.website}
          </div>
          <div className="footer-msg">✦ Thank you for your business! ✦</div>
          <div className="footer-contact">
            {CO.email} &nbsp;|&nbsp; {CO.phone}
          </div>
        </div>

      </div>
    </>
  )
}
