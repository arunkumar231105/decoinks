import { useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '../services/api'
import { useAuthStore } from '../store/authStore'

// ── Types ─────────────────────────────────────────────────────────────────────
interface Payment { paid_at: string; method: string; amount: number; reference: string | null }
interface Invoice {
  id: string; invoice_number: string; status: string
  issue_date: string | null; due_date: string | null
  subtotal: number; discount_amt: number; tax_amt: number; total_amount: number
  notes: string | null; supplier_name: string | null
  quote_id: string | null; order_id: string | null
  payments: Payment[]
}
interface QuoteItem {
  id: string; description: string; qty: number
  unit_price: number; amount: number
  sizes: string | null; colors: string | null; artwork_count: number
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
const fmt     = (n: number | string | null | undefined) =>
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
  return r.trim() + ` and ${cents.toString().padStart(2, '0')}/100 US Dollars Only`
}

// ── Company constants ─────────────────────────────────────────────────────────
const CO = {
  name: 'decoinks', tagline: 'PRINTSHOP OS',
  address: 'Suite 111, 1218 Magnolia Avenue',
  city: 'Corona, CA 92881, United States',
  email: 'info@decoinks.com', phone: '+1 (714) 790-1460',
  zelle: 'info@decoinks.com', paypal: 'paypal.me/decoinks',
}

// ── CSS ───────────────────────────────────────────────────────────────────────
const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Inter', sans-serif; font-size: 12px; color: #111827; background: #fff; }
  .page { max-width: 960px; margin: 0 auto; padding: 32px 28px; }
  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .no-print { display: none !important; }
    .page { padding: 16px; }
    @page { margin: 8mm; size: A4 landscape; }
  }

  /* ── Header ── */
  .hdr { display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: 16px; border-bottom: 3px solid #1a2b5c; margin-bottom: 20px; }
  .logo-name { font-size: 26px; font-weight: 900; color: #1a2b5c; letter-spacing: -1px; text-transform: lowercase; display: flex; align-items: center; gap: 4px; }
  .logo-dots { display: flex; gap: 3px; align-items: center; margin-left: 2px; }
  .logo-dots span { width: 7px; height: 7px; border-radius: 50%; }
  .logo-tag { font-size: 9px; font-weight: 700; letter-spacing: 2.5px; color: #6b7280; margin-top: 2px; text-transform: uppercase; }
  .inv-title { font-size: 44px; font-weight: 900; color: #1a2b5c; letter-spacing: 4px; line-height: 1; align-self: center; }
  .inv-meta table { border-collapse: collapse; }
  .inv-meta td { padding: 3px 8px; font-size: 12px; }
  .inv-meta .lbl { color: #6b7280; font-weight: 500; white-space: nowrap; }
  .inv-meta .val { color: #1a2b5c; font-weight: 700; }
  .inv-meta .sep { color: #9ca3af; }

  /* ── Info + Summary row ── */
  .info-summary-row { display: flex; justify-content: space-between; gap: 24px; margin-bottom: 20px; }
  .co-info p { font-size: 11.5px; color: #374151; line-height: 1.8; }
  .co-info .ic-line { display: flex; align-items: center; gap: 5px; }
  .co-info .ic-line svg { flex-shrink: 0; }
  .summary-box { background: #f8faff; border: 1.5px solid #c7d7f5; border-radius: 10px; padding: 14px 18px; min-width: 250px; }
  .summary-box h4 { font-size: 10px; font-weight: 800; letter-spacing: 1.5px; color: #1a2b5c; text-transform: uppercase; display: flex; align-items: center; gap: 6px; margin-bottom: 10px; }
  .summary-box table { width: 100%; border-collapse: collapse; }
  .summary-box td { padding: 3px 0; font-size: 12px; }
  .summary-box .s-lbl { color: #6b7280; }
  .summary-box .s-val { text-align: right; font-weight: 500; color: #111827; }
  .summary-box .s-val.neg { color: #dc2626; }
  .summary-box .total-row td { border-top: 1.5px solid #c7d7f5; padding-top: 8px; margin-top: 4px; font-weight: 800; font-size: 13px; color: #1a2b5c; }

  /* ── Info cards ── */
  .info-cards { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; margin-bottom: 20px; }
  .info-card { border: 1.5px solid #e5e7eb; border-radius: 10px; padding: 12px 14px; }
  .card-hdr { display: flex; align-items: center; gap: 7px; margin-bottom: 8px; }
  .card-icon { background: #1a2b5c; color: #fff; border-radius: 6px; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; font-size: 12px; flex-shrink: 0; }
  .card-lbl { font-size: 9px; font-weight: 800; letter-spacing: 1.5px; color: #9ca3af; text-transform: uppercase; }
  .card-body p { font-size: 11.5px; color: #374151; line-height: 1.65; }
  .card-body .name { font-size: 13px; font-weight: 700; color: #111827; }

  /* ── Items table ── */
  .tbl-wrap { margin-bottom: 0; }
  .items-tbl { width: 100%; border-collapse: collapse; font-size: 11px; }
  .items-tbl thead tr { background: #1a2b5c; color: #fff; }
  .items-tbl thead th { padding: 9px 6px; text-align: center; font-size: 9.5px; font-weight: 700; letter-spacing: 0.4px; text-transform: uppercase; white-space: nowrap; }
  .items-tbl thead th:nth-child(2) { text-align: left; }
  .items-tbl tbody tr { border-bottom: 1px solid #f3f4f6; }
  .items-tbl tbody tr:nth-child(even) { background: #f9fafb; }
  .items-tbl tbody td { padding: 8px 6px; text-align: center; vertical-align: middle; }
  .items-tbl tbody td:nth-child(2) { text-align: left; font-weight: 500; }
  .items-tbl .art-thumb { width: 54px; height: 54px; object-fit: contain; border-radius: 4px; border: 1px solid #e5e7eb; background: #fff; }
  .items-tbl .art-empty { width: 54px; height: 54px; display: flex; align-items: center; justify-content: center; color: #9ca3af; font-size: 18px; margin: 0 auto; }
  .color-dot { width: 14px; height: 14px; border-radius: 50%; display: inline-block; vertical-align: middle; margin-right: 4px; border: 1px solid #d1d5db; }

  /* ── Table footer row ── */
  .tbl-footer { background: #f1f5ff; border: 1.5px solid #c7d7f5; border-top: none; }
  .tbl-footer td { padding: 9px 12px; font-size: 11px; }
  .tbl-footer .tf-cell { display: flex; align-items: center; gap: 6px; }
  .tbl-footer .tf-icon { font-size: 16px; }
  .tbl-footer .tf-lbl { color: #6b7280; font-size: 10px; }
  .tbl-footer .tf-val { font-weight: 700; color: #1a2b5c; font-size: 12px; }

  /* ── Bottom ── */
  .bottom-row { display: grid; grid-template-columns: 1fr 1.4fr; gap: 16px; margin-top: 18px; margin-bottom: 0; }
  .words-box { border: 1.5px solid #e5e7eb; border-radius: 8px; padding: 12px 14px; }
  .words-box h5 { font-size: 9px; font-weight: 800; letter-spacing: 1.5px; color: #6b7280; text-transform: uppercase; display: flex; align-items: center; gap: 5px; margin-bottom: 5px; }
  .words-box p { font-size: 11.5px; color: #374151; font-weight: 500; line-height: 1.5; }
  .pay-methods { border: 1.5px solid #e5e7eb; border-radius: 8px; padding: 12px 14px; }
  .pay-methods h5 { font-size: 9px; font-weight: 800; letter-spacing: 1.5px; color: #6b7280; text-transform: uppercase; display: flex; align-items: center; gap: 5px; margin-bottom: 10px; }
  .pay-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
  .pay-card { border: 1px solid #e5e7eb; border-radius: 7px; padding: 8px 6px; text-align: center; }
  .pay-brand { font-size: 13px; font-weight: 900; margin-bottom: 3px; }
  .pay-brand.zelle { color: #6d28d9; }
  .pay-brand.paypal { color: #003087; }
  .pay-brand.cards { color: #111827; }
  .pay-brand.bank { color: #1a2b5c; }
  .pay-detail { font-size: 9.5px; color: #6b7280; line-height: 1.4; }
  .card-logos { display: flex; gap: 3px; justify-content: center; margin-top: 3px; }
  .card-logos span { font-size: 8.5px; font-weight: 700; padding: 1px 4px; border-radius: 3px; }
  .visa { background: #1a1f71; color: #fff; }
  .mc   { background: #eb001b; color: #fff; }
  .amex { background: #007bc1; color: #fff; }
  .disc { background: #f76f20; color: #fff; }

  /* ── Thank you footer ── */
  .ty-footer { background: #1a2b5c; color: #fff; text-align: center; padding: 12px; border-radius: 8px; font-style: italic; font-size: 14px; font-weight: 600; margin-top: 16px; letter-spacing: 0.5px; }

  /* ── Print button ── */
  .print-btn { position: fixed; top: 16px; right: 16px; background: #1a2b5c; color: #fff; border: none; padding: 10px 20px; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; z-index: 999; display: flex; align-items: center; gap: 7px; box-shadow: 0 4px 12px rgba(0,0,0,0.2); }
  .print-btn:hover { background: #243d82; }
`

// ── Dot colors ────────────────────────────────────────────────────────────────
function colorDot(colorStr: string | null) {
  if (!colorStr) return null
  const c = colorStr.toLowerCase()
  const hex = c.includes('white') ? '#ffffff'
    : c.includes('black') ? '#000000'
    : c.includes('red') ? '#ef4444'
    : c.includes('blue') ? '#3b82f6'
    : c.includes('green') ? '#22c55e'
    : c.includes('yellow') ? '#eab308'
    : c.includes('grey') || c.includes('gray') ? '#9ca3af'
    : c.includes('navy') ? '#1a2b5c'
    : '#d1d5db'
  return <span className="color-dot" style={{ background: hex }} />
}

// ── Main component ────────────────────────────────────────────────────────────
export function InvoicePrintPage() {
  const { id }    = useParams<{ id: string }>()
  const navigate  = useNavigate()
  const { isAuthenticated } = useAuthStore()

  useEffect(() => {
    if (!isAuthenticated) navigate('/login')
  }, [isAuthenticated, navigate])

  const { data: invoice, isLoading: invLoading } = useQuery<Invoice>({
    queryKey: ['invoice', id],
    queryFn:  () => api.get(`/invoices/${id}`).then(r => r.data.invoice ?? r.data),
    enabled: !!id,
  })

  const { data: quotation } = useQuery<Quotation>({
    queryKey: ['quotation', invoice?.quote_id],
    queryFn:  () => api.get(`/quotations/${invoice!.quote_id}`).then(r => r.data.quotation ?? r.data),
    enabled:  !!invoice?.quote_id,
  })

  const { data: artworkData } = useQuery<{ artworks: Artwork[] }>({
    queryKey: ['quote-artworks', invoice?.quote_id],
    queryFn:  () => api.get(`/quotations/${invoice!.quote_id}/artworks`).then(r => r.data),
    enabled:  !!invoice?.quote_id,
  })

  if (invLoading) return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', fontFamily: 'Inter, sans-serif', fontSize: 15, color: '#6b7280' }}>
      Loading invoice…
    </div>
  )
  if (!invoice) return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', fontFamily: 'Inter, sans-serif', fontSize: 15, color: '#ef4444' }}>
      Invoice not found.
    </div>
  )

  const items    = quotation?.items ?? []
  const artworks = artworkData?.artworks ?? []
  const totalQty = items.reduce((s, i) => s + (i.qty || 0), 0)
  const payMethod = invoice.payments?.[0]?.method?.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase()) ?? '—'

  // Customer info — prefer quotation fields, fall back to supplier
  const billName    = quotation?.customer_name || quotation?.company_name || invoice.supplier_name || '—'
  const billAddr    = quotation?.billing_address || '—'
  const shipAddr    = quotation?.shipping_address || '—'
  const shipCityLine = [quotation?.shipping_city, quotation?.shipping_state, quotation?.zip_code].filter(Boolean).join(', ')
  const shipCountry = quotation?.shipping_country || ''

  const orderTypeLabel = quotation?.order_type
    ? quotation.order_type === 'dtf' ? 'DTF Transfers'
    : quotation.order_type === 'apparel' ? 'Apparel'
    : 'Gangsheet'
    : 'Items'

  return (
    <>
      <style>{CSS}</style>

      {/* Print button */}
      <button className="print-btn no-print" onClick={() => window.print()}>
        🖨️ Download / Print PDF
      </button>

      <div className="page">

        {/* ── HEADER ── */}
        <div className="hdr">
          {/* Logo */}
          <div>
            <div className="logo-name">
              decoinks
              <span className="logo-dots">
                <span style={{ background: '#ec4899' }} />
                <span style={{ background: '#f97316' }} />
                <span style={{ background: '#eab308' }} />
                <span style={{ background: '#111827' }} />
              </span>
            </div>
            <div className="logo-tag">PRINTSHOP OS</div>
          </div>

          {/* Invoice title */}
          <div className="inv-title">INVOICE</div>

          {/* Invoice meta */}
          <div className="inv-meta">
            <table>
              <tbody>
                <tr>
                  <td className="lbl">Invoice #</td>
                  <td className="sep">:</td>
                  <td className="val">{invoice.invoice_number}</td>
                </tr>
                <tr>
                  <td className="lbl">Invoice Date</td>
                  <td className="sep">:</td>
                  <td className="val">{fmtDate(invoice.issue_date)}</td>
                </tr>
                <tr>
                  <td className="lbl">Due Date</td>
                  <td className="sep">:</td>
                  <td className="val">{fmtDate(invoice.due_date)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* ── COMPANY INFO + SUMMARY ── */}
        <div className="info-summary-row">
          <div className="co-info">
            <p className="ic-line">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#1a2b5c" strokeWidth="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
              {CO.address}
            </p>
            <p style={{ paddingLeft: 17 }}>{CO.city}</p>
            <p className="ic-line" style={{ marginTop: 4 }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#1a2b5c" strokeWidth="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
              {CO.email}
            </p>
            <p className="ic-line" style={{ marginTop: 3 }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#1a2b5c" strokeWidth="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.71 3.18 2 2 0 0 1 3.68 1h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 8.91a16 16 0 0 0 6 6l.91-.91a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
              {CO.phone}
            </p>
          </div>

          {/* Invoice Summary */}
          <div className="summary-box">
            <h4>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#1a2b5c" strokeWidth="2.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
              INVOICE SUMMARY
            </h4>
            <table>
              <tbody>
                <tr>
                  <td className="s-lbl">Items Total</td>
                  <td className="s-val">{fmt(invoice.subtotal)}</td>
                </tr>
                {Number(invoice.discount_amt) > 0 && (
                  <tr>
                    <td className="s-lbl">Bulk Discount</td>
                    <td className="s-val neg">-{fmt(invoice.discount_amt)}</td>
                  </tr>
                )}
                {Number(invoice.tax_amt) > 0 && (
                  <tr>
                    <td className="s-lbl">Tax</td>
                    <td className="s-val">{fmt(invoice.tax_amt)}</td>
                  </tr>
                )}
              </tbody>
              <tfoot>
                <tr className="total-row">
                  <td>TOTAL DUE (USD)</td>
                  <td style={{ textAlign: 'right' }}>{fmt(invoice.total_amount)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        {/* ── INFO CARDS ── */}
        <div className="info-cards">
          {/* Bill To */}
          <div className="info-card">
            <div className="card-hdr">
              <div className="card-icon">👤</div>
              <div className="card-lbl">Bill To</div>
            </div>
            <div className="card-body">
              <p className="name">{billName}</p>
              {quotation?.billing_email && <p>{quotation.billing_email}</p>}
              {billAddr !== '—' && <p>{billAddr}</p>}
            </div>
          </div>

          {/* Shipping Address */}
          <div className="info-card">
            <div className="card-hdr">
              <div className="card-icon">🚚</div>
              <div className="card-lbl">Shipping Address</div>
            </div>
            <div className="card-body">
              <p className="name">{billName}</p>
              {shipAddr !== '—' && <p>{shipAddr}</p>}
              {shipCityLine && <p>{shipCityLine}</p>}
              {shipCountry && <p>{shipCountry}</p>}
            </div>
          </div>

          {/* Payment Method */}
          <div className="info-card">
            <div className="card-hdr">
              <div className="card-icon">💳</div>
              <div className="card-lbl">Payment Method</div>
            </div>
            <div className="card-body">
              <p className="name">{payMethod}</p>
              {invoice.payments?.[0]?.reference && (
                <p>Ref: {invoice.payments[0].reference}</p>
              )}
            </div>
          </div>
        </div>

        {/* ── ITEMS TABLE ── */}
        <div className="tbl-wrap">
          <table className="items-tbl">
            <thead>
              <tr>
                <th style={{ width: 36 }}>S.No</th>
                <th style={{ minWidth: 140, textAlign: 'left' }}>
                  Item Description<br />
                  <span style={{ fontSize: 8, fontWeight: 500, opacity: 0.8 }}>({orderTypeLabel})</span>
                </th>
                <th style={{ width: 70 }}>Color</th>
                <th style={{ width: 110 }}>Size &amp; QTY</th>
                <th style={{ width: 70 }}>Artwork Front</th>
                <th style={{ width: 64 }}>Size (IN)</th>
                <th style={{ width: 70 }}>Artwork Back</th>
                <th style={{ width: 64 }}>Size (IN)</th>
                <th style={{ width: 76 }}>Unit Rate (USD)</th>
                <th style={{ width: 76 }}>Amount (USD)</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr>
                  <td colSpan={10} style={{ padding: '20px', textAlign: 'center', color: '#9ca3af' }}>
                    No items found
                  </td>
                </tr>
              ) : items.map((item, idx) => {
                const art = artworks[idx] ?? null
                const artBack = artworks[idx + items.length] ?? null
                const artSize = art?.width_inches && art?.height_inches
                  ? `${art.width_inches} x ${art.height_inches}` : '—'
                const artBackSize = artBack?.width_inches && artBack?.height_inches
                  ? `${artBack.width_inches} x ${artBack.height_inches}` : '—'
                return (
                  <tr key={item.id}>
                    <td>{idx + 1}</td>
                    <td>{item.description}</td>
                    <td>
                      {colorDot(item.colors)}
                      <span style={{ fontSize: 11 }}>{item.colors || '—'}</span>
                    </td>
                    <td style={{ fontSize: 10, lineHeight: 1.5 }}>
                      {item.sizes || '—'}
                      {item.qty ? <><br /><span style={{ color: '#6b7280' }}>Qty: {item.qty}</span></> : null}
                    </td>
                    <td>
                      {art?.file_url && art.file_type !== 'pdf' ? (
                        <img src={art.file_url} alt={art.name} className="art-thumb" />
                      ) : (
                        <div className="art-empty">—</div>
                      )}
                    </td>
                    <td style={{ fontSize: 10 }}>{artSize}</td>
                    <td>
                      {artBack?.file_url && artBack.file_type !== 'pdf' ? (
                        <img src={artBack.file_url} alt={artBack.name} className="art-thumb" />
                      ) : (
                        <div className="art-empty">—</div>
                      )}
                    </td>
                    <td style={{ fontSize: 10 }}>{artBackSize}</td>
                    <td style={{ fontWeight: 500 }}>{fmt(item.unit_price)}</td>
                    <td style={{ fontWeight: 700 }}>{fmt(item.amount)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          {/* Table footer */}
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>
              <tr className="tbl-footer">
                <td style={{ width: '25%' }}>
                  <div className="tf-cell">
                    <span className="tf-icon">👕</span>
                    <div>
                      <div className="tf-lbl">TOTAL ITEMS</div>
                      <div className="tf-val">{items.length}</div>
                    </div>
                  </div>
                </td>
                <td style={{ width: '25%' }}>
                  <div className="tf-cell">
                    <span className="tf-icon">🖼️</span>
                    <div>
                      <div className="tf-lbl">TOTAL ARTWORKS</div>
                      <div className="tf-val">{artworks.length}</div>
                    </div>
                  </div>
                </td>
                <td style={{ width: '25%' }}>
                  <div className="tf-cell">
                    <span className="tf-icon">📦</span>
                    <div>
                      <div className="tf-lbl">TOTAL QTY</div>
                      <div className="tf-val">{totalQty} pcs</div>
                    </div>
                  </div>
                </td>
                <td style={{ width: '25%' }}>
                  <div className="tf-cell">
                    <span className="tf-icon">🧾</span>
                    <div>
                      <div className="tf-lbl">ITEMS TOTAL</div>
                      <div className="tf-val">{fmt(invoice.subtotal)}</div>
                    </div>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* ── BOTTOM ROW ── */}
        <div className="bottom-row">
          {/* Amount in words */}
          <div className="words-box">
            <h5>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
              Total Amount in Words
            </h5>
            <p>{numberToWords(Number(invoice.total_amount ?? 0))}</p>
          </div>

          {/* Payment methods */}
          <div className="pay-methods">
            <h5>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>
              Payment Methods
            </h5>
            <div className="pay-grid">
              <div className="pay-card">
                <div className="pay-brand zelle">Zelle</div>
                <div className="pay-detail">{CO.zelle}</div>
              </div>
              <div className="pay-card">
                <div className="pay-brand paypal">PayPal</div>
                <div className="pay-detail">{CO.paypal}</div>
              </div>
              <div className="pay-card">
                <div className="pay-brand cards">Debit / Credit Cards</div>
                <div className="card-logos">
                  <span className="visa">VISA</span>
                  <span className="mc">MC</span>
                  <span className="amex">AMEX</span>
                  <span className="disc">DISC</span>
                </div>
                <div className="pay-detail" style={{ marginTop: 3 }}>All major cards accepted</div>
              </div>
              <div className="pay-card">
                <div className="pay-brand bank">Bank Transfer</div>
                <div className="pay-detail">Use invoice number as reference</div>
              </div>
            </div>
          </div>
        </div>

        {/* ── THANK YOU FOOTER ── */}
        <div className="ty-footer">✦ Thank you for your business! ✦</div>

      </div>
    </>
  )
}
