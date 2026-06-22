import { useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '../services/api'
import { usePrintAuth } from '../hooks/usePrintAuth'

// ── Types ─────────────────────────────────────────────────────────────────────
interface QuoteItem {
  id: string; description: string; qty: number; unit_price: number
  amount: number; sizes: string | null; colors: string | null; artwork_count: number
  artwork_image: string | null; front_image: string | null; back_image: string | null
}
interface Artwork {
  id: string; artwork_no: string; name: string; file_url: string | null
  file_type: string | null; width_inches: number | null; height_inches: number | null
}
interface Quote {
  id: string; quote_number: string; status: string; order_type: string | null
  created_at: string; valid_until: string | null
  customer_name: string | null; company_name: string | null
  billing_email: string | null; contact_number: string | null
  shipping_address: string | null; shipping_city: string | null
  shipping_state: string | null; zip_code: string | null; shipping_country: string | null
  billing_address: string | null; supplier_name: string | null
  subtotal: number; discount_pct: number; discount_amt: number
  total: number; notes: string | null; customer_notes: string | null
  rush_services: number | null; estimated_shipping: number | null
  payment_terms: string | null; payment_method: string | null; items: QuoteItem[]
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmt     = (n: number | null | undefined) =>
  '$ ' + Number(n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtDate = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' }) : '—'

const CO = {
  address: 'Suite 111, 1218 Magnolia Avenue',
  city: 'Corona , CA 92881, United States',
  email: 'info@decoinks.com',
  phone: '+1 (714) 790-1460',
  zelle: 'decoinks.pay@gmail.com',
  paypal: 'paypal.me/decoinks',
}

const colorHex = (c: string): string => {
  const m: Record<string, string> = {
    black: '#1f2937', white: '#ffffff', 'navy blue': '#1e3a5f', navy: '#1e3a5f',
    red: '#ef4444', blue: '#3b82f6', green: '#16a34a', grey: '#9ca3af', gray: '#9ca3af',
    yellow: '#eab308', orange: '#f97316', pink: '#ec4899', purple: '#8b5cf6',
    'forest green': '#15803d', 'royal blue': '#1d4ed8', teal: '#0d9488',
  }
  return m[c.toLowerCase()] ?? '#d1d5db'
}

// ── CSS ───────────────────────────────────────────────────────────────────────
const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap');
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Inter', sans-serif; font-size: 12px; color: #111827; background: #f8fafc; }
  .page { max-width: 920px; margin: 0 auto; padding: 28px 28px 24px; background: #fff; }

  @media print {
    body { background: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .no-print { display: none !important; }
    .page { padding: 18px; max-width: 100%; }
    @page { margin: 8mm; size: A4; }
  }

  /* ── Print button ── */
  .print-btn {
    position: fixed; top: 16px; right: 16px; z-index: 999;
    background: #1d4ed8; color: #fff; border: none;
    padding: 10px 22px; border-radius: 8px;
    font-size: 13px; font-weight: 600; cursor: pointer;
    display: flex; align-items: center; gap: 8px;
    box-shadow: 0 4px 14px rgba(29,78,216,0.3);
  }
  .print-btn:hover { background: #1e40af; }
  .back-btn {
    position: fixed; top: 16px; left: 16px; z-index: 999;
    background: #fff; color: #374151; border: 1.5px solid #d1d5db;
    padding: 9px 18px; border-radius: 8px;
    font-size: 13px; font-weight: 600; cursor: pointer;
    display: flex; align-items: center; gap: 6px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.08);
  }
  .back-btn:hover { background: #f9fafb; }

  /* ── HEADER ── */
  .hdr {
    display: flex; align-items: flex-start; gap: 0;
    padding-bottom: 18px; margin-bottom: 18px;
    border-bottom: 2px solid #e5e7eb;
  }
  .logo-block { display: flex; flex-direction: column; padding-right: 24px; min-width: 160px; }
  .print-logo-img { height: 42px; width: auto; object-fit: contain; display: block; }
  .logo-tag { font-size: 9px; font-weight: 700; letter-spacing: 2.5px; color: #94a3b8; margin-top: 4px; text-transform: uppercase; }

  .hdr-sep { width: 1.5px; background: #e5e7eb; align-self: stretch; margin: 0 24px; flex-shrink: 0; }

  .hdr-title-block { flex: 1; display: flex; align-items: center; justify-content: center; }
  .hdr-title { font-size: 46px; font-weight: 900; color: #0f1f3d; letter-spacing: 3px; text-transform: uppercase; }

  .hdr-meta { text-align: right; padding-left: 20px; }
  .hdr-meta table { border-collapse: collapse; margin-left: auto; }
  .hdr-meta td { padding: 3px 0; font-size: 12.5px; }
  .hm-lbl { color: #64748b; font-weight: 500; white-space: nowrap; }
  .hm-sep { color: #cbd5e1; padding: 0 8px; }
  .hm-val { color: #1d4ed8; font-weight: 700; }
  .validity-note { font-size: 10.5px; color: #94a3b8; text-align: right; margin-top: 5px; }

  /* ── COMPANY INFO ROW ── */
  .co-info { margin-bottom: 18px; }
  .co-info .ic-line { display: flex; align-items: center; gap: 6px; font-size: 11.5px; color: #374151; margin-bottom: 3px; }
  .co-info .ic-line span { font-size: 12px; }

  /* ── INFO CARDS ── */
  .info-cards {
    display: grid;
    grid-template-columns: 0.8fr 1fr 1.1fr 0.9fr;
    gap: 10px;
    margin-bottom: 22px;
  }
  .info-card {
    border: 1.5px solid #e5e7eb; border-radius: 10px;
    padding: 12px 14px; background: #fff;
  }
  .ic-hdr { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
  .ic-box {
    background: #1d4ed8; color: #fff; border-radius: 7px;
    width: 26px; height: 26px;
    display: flex; align-items: center; justify-content: center;
    font-size: 12px; flex-shrink: 0;
  }
  .ic-label {
    font-size: 8.5px; font-weight: 800; letter-spacing: 1.2px;
    color: #94a3b8; text-transform: uppercase;
  }
  .big-qno { font-size: 19px; font-weight: 900; color: #1d4ed8; margin-bottom: 3px; }
  .sub-auto { font-size: 10px; color: #9ca3af; }
  .cust-name { font-size: 13px; font-weight: 700; color: #111827; margin-bottom: 3px; }
  .cust-detail { font-size: 11px; color: #374151; line-height: 1.75; }
  .ship-name  { font-size: 13px; font-weight: 600; color: #111827; margin-bottom: 3px; }
  .ship-line  { font-size: 11px; color: #374151; line-height: 1.75; }
  .term-val   { font-size: 15px; font-weight: 700; color: #111827; margin-bottom: 8px; }
  .pay-divider { border: none; border-top: 1.5px solid #e5e7eb; margin: 8px 0; }
  .pay-meth-lbl { font-size: 8px; font-weight: 800; letter-spacing: 1px; color: #94a3b8; text-transform: uppercase; margin-bottom: 3px; }
  .pay-meth-val { font-size: 12.5px; font-weight: 600; color: #111827; }

  /* ── TABLE WRAP ── */
  .tbl-wrap { border: 1.5px solid #e2e8f0; border-radius: 10px; overflow: hidden; margin-bottom: 14px; }

  /* ── ITEMS TABLE ── */
  .items-tbl { width: 100%; border-collapse: collapse; }
  .items-tbl thead tr { background: #1a2b5c; }
  .items-tbl thead th {
    color: #fff; font-size: 9.5px; font-weight: 700;
    letter-spacing: 0.4px; padding: 10px 8px;
    text-align: center; text-transform: uppercase; white-space: nowrap;
  }
  .items-tbl thead th.left { text-align: left; }
  .items-tbl tbody tr { border-bottom: 1px solid #f1f5f9; }
  .items-tbl tbody tr:last-child { border-bottom: none; }
  .items-tbl tbody tr:nth-child(even) { background: #f8fafc; }
  .items-tbl tbody td {
    padding: 9px 8px; vertical-align: middle;
    text-align: center; font-size: 12px;
  }
  .items-tbl tbody td.left { text-align: left; }
  .item-main { font-size: 13px; font-weight: 700; color: #111827; }
  .item-sub  { font-size: 10.5px; color: #6b7280; line-height: 1.65; margin-top: 2px; }
  .aw-no     { color: #1d4ed8; font-weight: 700; font-size: 12px; }
  .color-dot { width: 12px; height: 12px; border-radius: 50%; display: inline-block; vertical-align: middle; margin-right: 4px; }
  .art-img   { width: 58px; height: 58px; object-fit: contain; border-radius: 6px; border: 1px solid #e5e7eb; background: #fff; display: block; margin: 0 auto; }
  .art-empty {
    width: 58px; height: 58px; border: 1px solid #e5e7eb; border-radius: 6px;
    background: #f9fafb; display: flex; align-items: center; justify-content: center;
    font-size: 18px; color: #d1d5db; margin: 0 auto;
  }

  /* ── STATS BAR ── */
  .stats-bar {
    display: grid; grid-template-columns: repeat(4, 1fr);
    border: 1.5px solid #dde4f5; border-radius: 10px; overflow: hidden;
    margin-bottom: 20px; background: #eef2ff;
  }
  .stat-cell {
    padding: 14px 18px; border-right: 1.5px solid #dde4f5;
    display: flex; align-items: center; gap: 14px;
  }
  .stat-cell:last-child { border-right: none; }
  .stat-icon-wrap {
    width: 42px; height: 42px; flex-shrink: 0;
    background: #fff; border: 2px solid #dde4f5; border-radius: 50%;
    display: flex; align-items: center; justify-content: center; font-size: 18px;
  }
  .stat-lbl { font-size: 10px; color: #94a3b8; font-weight: 500; text-transform: uppercase; letter-spacing: 0.4px; margin-bottom: 3px; }
  .stat-val { font-size: 22px; font-weight: 900; color: #1a2b5c; line-height: 1; }
  .stat-val.blue { color: #1d4ed8; }

  /* ── BOTTOM GRID ── */
  .bottom-grid {
    display: grid; grid-template-columns: 1.05fr 1.3fr 0.9fr;
    gap: 18px; margin-top: 6px;
  }

  /* Pricing */
  .section-title {
    font-size: 11px; font-weight: 800; letter-spacing: 1px;
    color: #0f1f3d; text-transform: uppercase; margin-bottom: 12px;
  }
  .pr-row { display: flex; justify-content: space-between; font-size: 12px; padding: 4px 0; }
  .pr-row .lbl { color: #374151; }
  .pr-row .val { font-weight: 500; color: #111827; }
  .pr-row .neg { color: #dc2626; font-weight: 600; }
  .pr-divider { border: none; border-top: 1px solid #e5e7eb; margin: 6px 0; }
  .pr-row.total { font-size: 16px; font-weight: 900; padding-top: 8px; margin-top: 2px; border-top: 2px solid #e5e7eb; }
  .pr-row.total .lbl { color: #16a34a; }
  .pr-row.total .val { color: #16a34a; }

  /* Payment */
  .pay-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 6px; }
  .pay-card {
    border: 1px solid #e5e7eb; border-radius: 8px;
    padding: 8px 8px; text-align: center;
    display: flex; flex-direction: column; align-items: center; gap: 4px;
  }
  .pay-brand-zelle  { font-size: 16px; font-weight: 900; color: #6600cc; font-family: Georgia, serif; font-style: italic; letter-spacing: -0.5px; }
  .pay-brand-paypal { font-size: 14px; font-weight: 900; color: #003087; font-style: italic; }
  .pay-brand-cards  { font-size: 11px; font-weight: 700; color: #111827; }
  .pay-brand-bank   { font-size: 11px; font-weight: 700; color: #111827; }
  .qr-box {
    width: 52px; height: 52px; border: 1px solid #e5e7eb; border-radius: 4px;
    background: #f9fafb; display: flex; align-items: center; justify-content: center;
    font-size: 7px; color: #94a3b8; text-align: center; line-height: 1.3;
  }
  .pay-detail { font-size: 9px; color: #6b7280; line-height: 1.4; }
  .card-logos { display: flex; gap: 3px; justify-content: center; margin-top: 2px; }
  .card-logos span { font-size: 8.5px; font-weight: 700; padding: 2px 5px; border-radius: 3px; }
  .visa { background: #1a1f71; color: #fff; }
  .mc   { background: #eb001b; color: #fff; }
  .bank-icon { font-size: 22px; }
  .pay-terms-select {
    width: 100%; border: 1.5px solid #e5e7eb; border-radius: 6px;
    padding: 6px 10px; font-size: 12px; font-weight: 600; color: #111827;
    margin-bottom: 10px; background: #fff; appearance: none;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%236b7280' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E");
    background-repeat: no-repeat; background-position: right 10px center;
    padding-right: 28px;
  }
  .pay-methods-lbl { font-size: 9px; font-weight: 700; letter-spacing: 1px; color: #94a3b8; text-transform: uppercase; margin-bottom: 8px; }

  /* Notes */
  .notes-box {
    border: 1.5px solid #e5e7eb; border-radius: 8px;
    min-height: 82px; padding: 10px 12px;
    font-size: 11.5px; color: #374151; line-height: 1.6;
  }
  .page-count { font-size: 10px; color: #9ca3af; text-align: right; margin-top: 4px; }
`

// ── Main ──────────────────────────────────────────────────────────────────────

export function QuotePrintPage() {
  const { id }   = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { authReady, authFailed } = usePrintAuth()

  const { data: quote, isLoading } = useQuery<Quote>({
    queryKey: ['quote-print', id],
    queryFn:  () => api.get(`/quotations/${id}`).then(r => r.data.data),
    enabled:  !!id && authReady,
  })

  const { data: artworkData } = useQuery<{ artworks: Artwork[] }>({
    queryKey: ['quote-artworks-print', id],
    queryFn:  () => api.get(`/quotations/${id}/artworks`).then(r => r.data),
    enabled:  !!id && authReady,
  })
  const artworks = artworkData?.artworks ?? []

  useEffect(() => {
    if (quote) document.title = `${quote.quote_number} – Decoinks Quotation`
  }, [quote])

  if (authFailed) {
    return (
      <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', height:'100vh', fontFamily:'Inter,sans-serif', gap:12 }}>
        <span style={{ fontSize:15, color:'#ef4444' }}>Session expired.</span>
        <a href="/login" style={{ fontSize:13, color:'#1a2b5c', fontWeight:600 }}>Log in again →</a>
      </div>
    )
  }
  if (!authReady || isLoading || !quote) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', fontFamily: 'Inter, sans-serif', color: '#64748b', fontSize: 15 }}>
        Loading quotation…
      </div>
    )
  }

  const orderType    = quote.order_type ?? 'dtf'
  const totalItems   = quote.items.length
  const totalQty     = quote.items.reduce((s, i) => s + i.qty, 0)
  const totalArt     = artworks.length || quote.items.reduce((s, i) => s + (i.artwork_count || 0), 0)
  const custName     = quote.customer_name || quote.supplier_name || '—'
  const termStr      = quote.payment_terms || 'Net 15'
  const rushAmt      = Number(quote.rush_services ?? 0)
  const shippingAmt  = Number(quote.estimated_shipping ?? 0)

  // Build full shipping address lines
  const shipLines = [
    quote.shipping_address,
    [quote.shipping_city, quote.shipping_state, quote.zip_code].filter(Boolean).join(', '),
    quote.shipping_country,
  ].filter(Boolean)

  return (
    <>
      <style>{CSS}</style>

      <button className="no-print back-btn" onClick={() => navigate(-1)}>
        ← Back
      </button>
      <button className="no-print print-btn" onClick={() => window.print()}>
        🖨️ Download / Print PDF
      </button>

      <div className="page">

        {/* ── HEADER ── */}
        <div className="hdr">
          {/* Logo */}
          <div className="logo-block">
            <img src="/decoinks-logo.png" alt="Decoinks" className="print-logo-img" />
            <div className="logo-tag">PRINTSHOP OS</div>
          </div>

          {/* Separator */}
          <div className="hdr-sep" />

          {/* Title */}
          <div className="hdr-title-block">
            <div className="hdr-title">QUOTATION</div>
          </div>

          {/* Meta */}
          <div className="hdr-meta">
            <table>
              <tbody>
                <tr>
                  <td className="hm-lbl">Quote No</td>
                  <td className="hm-sep">:</td>
                  <td className="hm-val">{quote.quote_number}</td>
                </tr>
                <tr>
                  <td className="hm-lbl">Quote Date</td>
                  <td className="hm-sep">:</td>
                  <td className="hm-val">{fmtDate(quote.created_at)}</td>
                </tr>
                <tr>
                  <td className="hm-lbl">Valid Until</td>
                  <td className="hm-sep">:</td>
                  <td className="hm-val">{fmtDate(quote.valid_until)}</td>
                </tr>
              </tbody>
            </table>
            <div className="validity-note">( 7 days validity )</div>
          </div>
        </div>

        {/* ── COMPANY INFO ── */}
        <div className="co-info">
          <div className="ic-line">
            <span>📍</span>
            <span>{CO.address},&nbsp;</span>
            <span>{CO.city}</span>
          </div>
          <div className="ic-line">
            <span>✉️</span>
            <span>{CO.email}</span>
          </div>
          <div className="ic-line">
            <span>📞</span>
            <span>{CO.phone}</span>
          </div>
        </div>

        {/* ── INFO CARDS ── */}
        <div className="info-cards">

          {/* Quote No */}
          <div className="info-card">
            <div className="ic-hdr">
              <div className="ic-box">📋</div>
              <span className="ic-label">Quote No</span>
            </div>
            <div className="big-qno">{quote.quote_number}</div>
            <div className="sub-auto">Auto generated</div>
          </div>

          {/* Customer */}
          <div className="info-card">
            <div className="ic-hdr">
              <div className="ic-box">👤</div>
              <span className="ic-label">Customer</span>
            </div>
            <div className="cust-name">{custName}</div>
            <div className="cust-detail">
              {quote.billing_email   && <div>{quote.billing_email}</div>}
              {quote.contact_number  && <div>{quote.contact_number}</div>}
              {quote.company_name    && <div style={{ color: '#9ca3af', fontSize: 10 }}>{quote.company_name}</div>}
            </div>
          </div>

          {/* Shipping */}
          <div className="info-card">
            <div className="ic-hdr">
              <div className="ic-box">🚚</div>
              <span className="ic-label">Shipping Address</span>
            </div>
            <div className="ship-line">
              {shipLines.length > 0
                ? shipLines.map((l, i) => <div key={i}>{l}</div>)
                : <span style={{ color: '#9ca3af', fontSize: 11 }}>—</span>}
            </div>
          </div>

          {/* Payment */}
          <div className="info-card">
            <div className="ic-hdr">
              <div className="ic-box">🧾</div>
              <span className="ic-label">Payment Terms</span>
            </div>
            <div className="term-val">{termStr}</div>
            <hr className="pay-divider" />
            <div className="ic-hdr" style={{ marginBottom: 4 }}>
              <div className="ic-box" style={{ background: '#0891b2', fontSize: 10 }}>💳</div>
              <span className="ic-label">Payment Method</span>
            </div>
            <div className="pay-meth-val">{quote.payment_method || 'Bank Transfer'}</div>
          </div>

        </div>

        {/* ── ITEMS TABLE ── */}
        <div className="tbl-wrap">
          {orderType === 'apparel' && <ApparelTable items={quote.items} artworks={artworks} />}
          {orderType === 'dtf'     && <DtfTable     items={quote.items} artworks={artworks} />}
          {orderType === 'gangsheet' && <GangsheetTable items={quote.items} />}
          {!['dtf', 'apparel', 'gangsheet'].includes(orderType) && <GenericTable items={quote.items} />}
        </div>

        {/* ── STATS BAR ── */}
        <div className="stats-bar">
          <div className="stat-cell">
            <div className="stat-icon-wrap">👕</div>
            <div>
              <div className="stat-lbl">Total Items</div>
              <div className="stat-val">{totalItems}</div>
            </div>
          </div>
          <div className="stat-cell">
            <div className="stat-icon-wrap">🖼️</div>
            <div>
              <div className="stat-lbl">Total Artworks</div>
              <div className="stat-val">{totalArt}</div>
            </div>
          </div>
          <div className="stat-cell">
            <div className="stat-icon-wrap">📦</div>
            <div>
              <div className="stat-lbl">Total Qty</div>
              <div className="stat-val">{totalQty} pcs</div>
            </div>
          </div>
          <div className="stat-cell">
            <div className="stat-icon-wrap">🧮</div>
            <div>
              <div className="stat-lbl">Total Amount</div>
              <div className="stat-val blue">{fmt(quote.total)}</div>
            </div>
          </div>
        </div>

        {/* ── BOTTOM GRID ── */}
        <div className="bottom-grid">

          {/* Pricing Summary */}
          <div>
            <div className="section-title">Pricing Summary</div>
            <div className="pr-row"><span className="lbl">Items Total</span><span className="val">{fmt(quote.subtotal - rushAmt - shippingAmt)}</span></div>
            {rushAmt > 0 && <div className="pr-row"><span className="lbl">Rush Services ⓘ</span><span className="val">{fmt(rushAmt)}</span></div>}
            {shippingAmt > 0 && <div className="pr-row"><span className="lbl">Estimated Shipping</span><span className="val">{fmt(shippingAmt)}</span></div>}
            <hr className="pr-divider" />
            <div className="pr-row"><span className="lbl">Subtotal</span><span className="val">{fmt(quote.subtotal)}</span></div>
            {Number(quote.discount_amt) > 0 && <div className="pr-row"><span className="lbl">Discount</span><span className="val neg">- {fmt(quote.discount_amt)}</span></div>}
            <div className="pr-row total"><span className="lbl">Total</span><span className="val">{fmt(quote.total)}</span></div>
          </div>

          {/* Payment Information */}
          <div>
            <div className="section-title">Payment Information</div>
            <div style={{ marginBottom: 6 }}>
              <div className="pay-meth-lbl" style={{ fontSize: 9, fontWeight: 700, color: '#94a3b8', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: 4 }}>Payment Terms</div>
              <div className="pay-terms-select" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', border: '1.5px solid #e5e7eb', borderRadius: 6, padding: '6px 10px', fontSize: 12, fontWeight: 600, marginBottom: 10 }}>
                <span>{termStr}</span>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2"><polyline points="6 9 12 15 18 9"/></svg>
              </div>
            </div>
            <div className="pay-methods-lbl">Payment Methods</div>
            <div className="pay-grid">
              {/* Zelle */}
              <div className="pay-card">
                <div className="pay-brand-zelle">Zelle</div>
                <div className="qr-box">QR Code</div>
                <div className="pay-detail">{CO.zelle}</div>
              </div>
              {/* PayPal */}
              <div className="pay-card">
                <div className="pay-brand-paypal">
                  <span style={{ color: '#009cde' }}>Pay</span><span style={{ color: '#003087' }}>Pal</span>
                </div>
                <div className="qr-box">QR Code</div>
                <div className="pay-detail">{CO.paypal}</div>
              </div>
              {/* Cards */}
              <div className="pay-card">
                <div className="pay-brand-cards">Debit / Credit Cards</div>
                <div className="card-logos">
                  <span className="visa">VISA</span>
                  <span className="mc">MC</span>
                </div>
                <div className="pay-detail">We accept all major debit and credit cards</div>
              </div>
              {/* Bank */}
              <div className="pay-card">
                <div className="pay-brand-bank">Bank Deposit</div>
                <div className="bank-icon">🏦</div>
                <div className="pay-detail">Please contact us for bank account details</div>
              </div>
            </div>
          </div>

          {/* Notes */}
          <div>
            <div className="section-title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#0f1f3d" strokeWidth="2.5"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
              Notes
            </div>
            <div className="notes-box">
              {(quote.customer_notes || quote.notes) || <span style={{ color: '#94a3b8' }}>Add your notes here...</span>}
            </div>
            <div className="page-count">0 / 500</div>
          </div>

        </div>
      </div>
    </>
  )
}

// ── APPAREL TABLE ─────────────────────────────────────────────────────────────

function ApparelTable({ items, artworks }: { items: QuoteItem[]; artworks: Artwork[] }) {
  return (
    <table className="items-tbl">
      <thead>
        <tr>
          <th style={{ width: 32 }}>#</th>
          <th className="left" style={{ minWidth: 160 }}>
            Item Description<br />
            <span style={{ fontWeight: 400, fontSize: 8, opacity: 0.75 }}>Brand | Model</span>
          </th>
          <th style={{ width: 80 }}>Color</th>
          <th style={{ width: 68 }}>
            QTY<br />
            <span style={{ fontWeight: 400, fontSize: 8, opacity: 0.75 }}>(Shirts)</span>
          </th>
          <th style={{ width: 110 }}>
            Sizes<br />
            <span style={{ fontWeight: 400, fontSize: 8, opacity: 0.75 }}>(Size Ratio)</span>
          </th>
          <th style={{ width: 76 }}>Front Artwork</th>
          <th style={{ width: 76 }}>Back Artwork</th>
          <th style={{ width: 84 }}>
            Unit Price<br />
            <span style={{ fontWeight: 400, fontSize: 8, opacity: 0.75 }}>(USD)</span>
          </th>
          <th style={{ width: 90 }}>
            Total Amount<br />
            <span style={{ fontWeight: 400, fontSize: 8, opacity: 0.75 }}>(USD)</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {items.length === 0 ? (
          <tr>
            <td colSpan={9} style={{ padding: 24, textAlign: 'center', color: '#9ca3af' }}>No items</td>
          </tr>
        ) : items.map((item, idx) => {
          // Apparel front/back images are stored inline on the item row,
          // not in the artworks table — use them directly.
          const frontUrl = item.front_image ?? null
          const backUrl  = item.back_image  ?? null
          const colors   = item.colors?.split(',').map(c => c.trim()).filter(Boolean) ?? []

          return (
            <tr key={item.id}>
              <td style={{ fontWeight: 700, color: '#374151' }}>{idx + 1}</td>
              <td className="left">
                <div className="item-main">{item.description}</div>
              </td>
              <td>
                {colors.length > 0 ? colors.map(c => (
                  <div key={c} style={{ display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'center', fontSize: 11 }}>
                    <span className="color-dot"
                      style={{
                        background: colorHex(c),
                        border: c.toLowerCase() === 'white' ? '1px solid #d1d5db' : 'none',
                      }} />
                    {c}
                  </div>
                )) : <span style={{ color: '#9ca3af' }}>—</span>}
              </td>
              <td style={{ fontWeight: 600 }}>
                {item.qty}<br />
                <span style={{ fontSize: 10, color: '#6b7280', fontWeight: 400 }}>pcs</span>
              </td>
              <td style={{ fontSize: 11, lineHeight: 1.6 }}>{item.sizes || '—'}</td>
              <td>
                {frontUrl
                  ? <img src={frontUrl} alt="front artwork" className="art-img" />
                  : <div className="art-empty">—</div>}
              </td>
              <td>
                {backUrl
                  ? <img src={backUrl} alt="back artwork" className="art-img" />
                  : <div className="art-empty">—</div>}
              </td>
              <td style={{ fontWeight: 600 }}>$ {item.unit_price.toFixed(2)}</td>
              <td style={{ fontWeight: 700 }}>$ {item.amount.toFixed(2)}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

// ── DTF TABLE ─────────────────────────────────────────────────────────────────

function DtfTable({ items, artworks }: { items: QuoteItem[]; artworks: Artwork[] }) {
  if (artworks.length > 0) {
    // Group artworks by item — distribute evenly if no direct mapping
    const artPerItem = Math.ceil(artworks.length / Math.max(items.length, 1))
    const rows: { item: QuoteItem; itemIdx: number; art: Artwork; artIdxInItem: number; totalArtsForItem: number }[] = []

    let artIdx = 0
    items.forEach((item, itemIdx) => {
      const countForItem = item.artwork_count || artPerItem
      const myArts = artworks.slice(artIdx, artIdx + countForItem)
      if (myArts.length === 0) myArts.push(artworks[artIdx % artworks.length])
      myArts.forEach((art, ai) => {
        rows.push({ item, itemIdx, art, artIdxInItem: ai, totalArtsForItem: myArts.length })
      })
      artIdx += countForItem
    })

    return (
      <table className="items-tbl">
        <thead>
          <tr>
            <th style={{ width: 40 }}>S.No</th>
            <th className="left" style={{ minWidth: 150 }}>
              Item Description<br />
              <span style={{ fontWeight: 400, fontSize: 8, opacity: 0.75 }}>(DTF Transfers)</span>
            </th>
            <th style={{ width: 80 }}>Artwork No</th>
            <th style={{ width: 78 }}>Artwork Thumbnail</th>
            <th style={{ width: 120 }}>
              Artwork Size<br />
              <span style={{ fontWeight: 400, fontSize: 8, opacity: 0.75 }}>(Width x Height)</span>
            </th>
            <th style={{ width: 70 }}>QTY</th>
            <th style={{ width: 80 }}>
              Rate<br />
              <span style={{ fontWeight: 400, fontSize: 8, opacity: 0.75 }}>(USD)</span>
            </th>
            <th style={{ width: 90 }}>
              Amount<br />
              <span style={{ fontWeight: 400, fontSize: 8, opacity: 0.75 }}>(USD)</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => {
            const rowQty = Math.ceil(r.item.qty / r.totalArtsForItem)
            const rowAmt = +(rowQty * r.item.unit_price).toFixed(2)
            // Use the transfer size stored in the item description (e.g. '12" x 12"')
            const artSize = r.item.description || r.art.name
            return (
              <tr key={ri}>
                {r.artIdxInItem === 0 && (
                  <td rowSpan={r.totalArtsForItem} style={{ fontWeight: 700, color: '#374151', verticalAlign: 'middle' }}>
                    {r.itemIdx + 1}
                  </td>
                )}
                {r.artIdxInItem === 0 && (
                  <td rowSpan={r.totalArtsForItem} className="left" style={{ verticalAlign: 'middle' }}>
                    <div className="item-main">{r.item.description}</div>
                    <div className="item-sub">
                      Premium Quality DTF<br />
                      Ready to Press<br />
                      Full Color
                    </div>
                  </td>
                )}
                <td><span className="aw-no">{r.art.artwork_no}</span></td>
                <td>
                  {r.art.file_url && r.art.file_type !== 'pdf'
                    ? <img src={r.art.file_url} alt={r.art.name} className="art-img" />
                    : <div className="art-empty">—</div>}
                </td>
                <td style={{ fontSize: 11 }}>{artSize}</td>
                <td style={{ fontWeight: 600 }}>{rowQty} pcs</td>
                {r.artIdxInItem === 0 && (
                  <td rowSpan={r.totalArtsForItem} style={{ verticalAlign: 'middle', fontWeight: 700 }}>
                    $ {r.item.unit_price.toFixed(2)}
                  </td>
                )}
                <td style={{ fontWeight: 700 }}>$ {rowAmt.toFixed(2)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    )
  }

  // Fallback: no artworks uploaded yet
  return (
    <table className="items-tbl">
      <thead>
        <tr>
          <th style={{ width: 40 }}>S.No</th>
          <th className="left">Item Description <span style={{ fontWeight: 400, fontSize: 8 }}>(DTF Transfers)</span></th>
          <th style={{ width: 80 }}>Artwork No</th>
          <th style={{ width: 78 }}>Artwork Thumbnail</th>
          <th style={{ width: 120 }}>Artwork Size</th>
          <th style={{ width: 70 }}>QTY</th>
          <th style={{ width: 80 }}>Rate (USD)</th>
          <th style={{ width: 90 }}>Amount (USD)</th>
        </tr>
      </thead>
      <tbody>
        {items.map((item, idx) => (
          <tr key={item.id}>
            <td style={{ fontWeight: 700 }}>{idx + 1}</td>
            <td className="left">
              <div className="item-main">{item.description}</div>
              <div className="item-sub">Premium Quality DTF · Ready to Press · Full Color</div>
            </td>
            <td style={{ color: '#9ca3af' }}>—</td>
            <td>
              {item.artwork_image
                ? <img src={item.artwork_image} alt="artwork" className="art-img" />
                : <div className="art-empty">—</div>}
            </td>
            <td style={{ fontWeight: 600, fontSize: 11 }}>{item.description}</td>
            <td style={{ fontWeight: 600 }}>{item.qty} pcs</td>
            <td style={{ fontWeight: 600 }}>$ {item.unit_price.toFixed(2)}</td>
            <td style={{ fontWeight: 700 }}>$ {item.amount.toFixed(2)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// ── GANGSHEET TABLE ───────────────────────────────────────────────────────────

function GangsheetTable({ items }: { items: QuoteItem[] }) {
  return (
    <table className="items-tbl">
      <thead>
        <tr>
          <th style={{ width: 36 }}>#</th>
          <th className="left">Gangsheet Size</th>
          <th style={{ width: 100 }}>No. of Artworks</th>
          <th style={{ width: 90 }}>Qty Sheets</th>
          <th style={{ width: 110 }}>Price / Sheet (USD)</th>
          <th style={{ width: 100 }}>Total (USD)</th>
        </tr>
      </thead>
      <tbody>
        {items.map((item, idx) => (
          <tr key={item.id}>
            <td style={{ fontWeight: 700 }}>{idx + 1}</td>
            <td className="left"><div className="item-main">{item.description}</div></td>
            <td>{item.artwork_count || 1}</td>
            <td style={{ fontWeight: 600 }}>{item.qty}</td>
            <td>$ {item.unit_price.toFixed(2)}</td>
            <td style={{ fontWeight: 700 }}>$ {item.amount.toFixed(2)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// ── GENERIC TABLE ─────────────────────────────────────────────────────────────

function GenericTable({ items }: { items: QuoteItem[] }) {
  return (
    <table className="items-tbl">
      <thead>
        <tr>
          <th style={{ width: 36 }}>#</th>
          <th className="left">Description</th>
          <th style={{ width: 70 }}>QTY</th>
          <th style={{ width: 110 }}>Unit Price (USD)</th>
          <th style={{ width: 110 }}>Amount (USD)</th>
        </tr>
      </thead>
      <tbody>
        {items.map((item, idx) => (
          <tr key={item.id}>
            <td style={{ fontWeight: 700 }}>{idx + 1}</td>
            <td className="left"><div className="item-main">{item.description}</div></td>
            <td style={{ fontWeight: 600 }}>{item.qty}</td>
            <td>$ {item.unit_price.toFixed(2)}</td>
            <td style={{ fontWeight: 700 }}>$ {item.amount.toFixed(2)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
