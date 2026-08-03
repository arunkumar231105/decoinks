import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '../services/api'
import { usePrintAuth } from '../hooks/usePrintAuth'

// ── Types ─────────────────────────────────────────────────────────────────────
interface Invoice {
  id: string; invoice_number: string; issue_date: string; due_date: string | null
  supplier_name: string | null; contact_name: string | null; contact_email: string | null
  contact_phone: string | null; shipping_name: string | null; shipping_address: string | null
  customer_name?: string | null; billing_email?: string | null; contact_number?: string | null
  billing_address?: string | null; payment_method?: string | null
  customer_billing_address?: string | null; customer_shipping_address?: string | null
  quote_billing_address?: string | null; quote_shipping_address?: string | null
  subtotal: number; discount_pct: number; discount_amt: number
  rush_services: number; shipping_charges: number
  total: number; notes: string | null; quote_id: string | null; order_type: string | null
  currency?: string | null
  items?: QuoteItem[]
  payments: Array<{ payment_method?: string | null; method?: string | null }>
}
interface Quotation {
  order_type: string; items: QuoteItem[]
  customer_name?: string | null; company_name?: string | null
  billing_email?: string | null; contact_number?: string | null
  billing_address?: string | null; shipping_address?: string | null
}
interface QuoteItem {
  id: string; artwork_name?: string; description?: string; item?: string
  color?: string; size?: string; qty: number; unit_price: number; amount: number
  artwork_image?: string; front_image?: string
}
// ── CSS ───────────────────────────────────────────────────────────────────────
const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Inter', -apple-system, sans-serif; background: #f5f5f5; color: #111; }

  .receipt-wrap {
    max-width: 480px;
    margin: 0 auto;
    background: #fff;
    min-height: 100vh;
    padding: 0 0 48px;
  }

  /* Header */
  .rc-header {
    background: #1a2b5c;
    padding: 22px 24px 20px;
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .rc-logo-name { font-size: 22px; font-weight: 900; color: #fff; letter-spacing: -0.5px; }
  .rc-logo-dots { display: flex; gap: 4px; }
  .rc-logo-dots span { width: 8px; height: 8px; border-radius: 50%; display: block; }
  .rc-inv-num { margin-left: auto; font-size: 11px; color: rgba(255,255,255,0.6); letter-spacing: 0.5px; }

  /* Section labels */
  .rc-section-title {
    font-size: 20px;
    font-weight: 700;
    padding: 24px 24px 16px;
    color: #111;
  }

  /* Items */
  .rc-items { padding: 0 24px; }
  .rc-item {
    display: flex;
    align-items: flex-start;
    gap: 14px;
    padding: 14px 0;
    border-bottom: 1px solid #e5e7eb;
  }
  .rc-item:last-child { border-bottom: none; }
  .rc-item-img {
    width: 64px;
    height: 64px;
    object-fit: contain;
    border-radius: 8px;
    border: 1px solid #e5e7eb;
    background: #f9fafb;
    flex-shrink: 0;
  }
  .rc-item-img-placeholder {
    width: 64px;
    height: 64px;
    border-radius: 8px;
    border: 1px solid #e5e7eb;
    background: #f9fafb;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 24px;
    flex-shrink: 0;
  }
  .rc-item-body { flex: 1; }
  .rc-item-name { font-size: 14px; font-weight: 600; color: #111; line-height: 1.4; }
  .rc-item-sub  { font-size: 12px; color: #6b7280; margin-top: 3px; }
  .rc-item-coupon {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    background: #f0fdf4;
    border: 1px solid #bbf7d0;
    border-radius: 20px;
    padding: 2px 8px;
    font-size: 11px;
    font-weight: 600;
    color: #16a34a;
    margin-top: 5px;
  }
  .rc-item-price { text-align: right; flex-shrink: 0; }
  .rc-item-price .original { font-size: 12px; color: #9ca3af; text-decoration: line-through; }
  .rc-item-price .final    { font-size: 14px; font-weight: 700; color: #111; margin-top: 2px; }

  /* Totals */
  .rc-totals { padding: 16px 24px 0; }
  .rc-totals-divider { border: none; border-top: 1px solid #e5e7eb; margin: 12px 0; }
  .rc-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 5px 0;
    font-size: 14px;
    color: #374151;
  }
  .rc-row .lbl { }
  .rc-row .val { font-weight: 500; }
  .rc-row.discount .val { color: #16a34a; }
  .rc-total-row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    padding: 14px 0 6px;
    border-top: 2px solid #111;
    margin-top: 4px;
  }
  .rc-total-row .tl { font-size: 15px; font-weight: 700; color: #111; }
  .rc-total-row .tv { font-size: 22px; font-weight: 800; color: #111; }
  .rc-total-row .tv .currency { font-size: 14px; font-weight: 600; color: #6b7280; margin-left: 4px; }
  .rc-saved {
    text-align: right;
    font-size: 12px;
    color: #16a34a;
    font-weight: 600;
    padding: 0 0 10px;
  }

  /* Customer info */
  .rc-customer { padding: 0 24px; margin-top: 24px; }
  .rc-cust-title { font-size: 18px; font-weight: 700; color: #111; margin-bottom: 16px; }
  .rc-cust-group { margin-bottom: 16px; }
  .rc-cust-group-lbl { font-size: 12px; font-weight: 700; color: #111; margin-bottom: 5px; }
  .rc-cust-group-val { font-size: 13px; color: #374151; line-height: 1.7; }
  .rc-cust-group-val a { color: #2563eb; text-decoration: underline; }

  /* Payment method badge */
  .rc-payment-badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: #f9fafb;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    padding: 8px 14px;
    font-size: 13px;
    font-weight: 600;
    color: #111;
    margin-top: 8px;
  }

  /* Footer */
  /* Bank transfer details */
  .rc-bank { margin-top: 14px; border: 1px solid #dbe3f1; border-radius: 8px; padding: 10px 12px; background: #f8faff; }
  .rc-bank-lbl { font-size: 10px; font-weight: 800; letter-spacing: .8px; text-transform: uppercase; color: #6b7280; margin-bottom: 6px; }
  .rc-bank-grid div { display: flex; justify-content: space-between; gap: 10px; font-size: 11.5px; padding: 2px 0; border-bottom: 1px dotted #d7deea; }
  .rc-bank-grid div:last-child { border-bottom: none; }
  .rc-bank-grid span { color: #6b7280; }
  .rc-bank-grid strong { color: #1a2b5c; font-weight: 700; text-align: right; word-break: break-all; }
  .rc-bank-note { margin-top: 6px; font-size: 10.5px; color: #6b7280; font-style: italic; }

  .rc-footer {
    background: #1a2b5c;
    margin: 32px 0 0;
    padding: 18px 24px;
    text-align: center;
    color: rgba(255,255,255,0.7);
    font-size: 12px;
  }
  .rc-footer strong { color: #fff; }

  /* Back button */
  .back-btn {
    position: fixed; top: 12px; left: 12px;
    background: #fff; color: #374151; border: 1.5px solid #d1d5db;
    padding: 8px 16px; border-radius: 8px;
    font-size: 12px; font-weight: 600; cursor: pointer; z-index: 999;
    box-shadow: 0 2px 8px rgba(0,0,0,0.08);
  }
  .back-btn:hover { background: #f9fafb; }
  @media print { .back-btn { display: none; } }

  /* Print button */
  .print-btn {
    position: fixed; top: 12px; right: 12px;
    background: #1a2b5c; color: #fff;
    border: none; padding: 9px 16px;
    border-radius: 8px; font-size: 12px;
    font-weight: 600; cursor: pointer;
    z-index: 999; display: flex; align-items: center; gap: 6px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.2);
  }
  .dl-btn {
    position: fixed; top: 68px; right: 20px; z-index: 10;
    background: #0d9488; color: #fff; border: none; border-radius: 8px;
    padding: 10px 16px; font-size: 13px; font-weight: 700; cursor: pointer;
    box-shadow: 0 4px 12px rgba(0,0,0,0.2);
  }
  .dl-btn:disabled { opacity: .6; cursor: progress; }
  @media print {
    .print-btn, .dl-btn { display: none; }
    body { background: #fff; }
    /* The sheet is 480px wide (~127mm). Match the page to it exactly so there
       is no A4 side margin, and let the height run so it stays on one page. */
    @page { margin: 0; size: 127mm auto; }
    .receipt-wrap { min-height: 0; max-width: 100%; width: 100%; padding-bottom: 8mm; box-shadow: none; }
    .rc-bank, .rc-footer { break-inside: avoid; page-break-inside: avoid; }
  }
`

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmt = (n: number | string | null | undefined) =>
  '$' + Number(n ?? 0).toFixed(2)

const fmtDate = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '—'

function bestAddress(...candidates: Array<string | null | undefined>) {
  const addresses = candidates.map(value => value?.trim()).filter((value): value is string => Boolean(value))
  const detailed = addresses.find(value =>
    !/^(?:united states(?: of america)?|usa|us)$/i.test(value.replace(/[,\s]+/g, ' ').trim())
  )
  return detailed || addresses[0] || null
}

// ── Component ─────────────────────────────────────────────────────────────────
export function InvoiceReceiptPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { authReady, authFailed } = usePrintAuth()
  const [downloading, setDownloading] = useState(false)

  // Download exactly what is on screen: rasterise the receipt sheet and wrap it
  // in a PDF page of the same aspect ratio, so the file matches the preview.
  const downloadPdf = async () => {
    const sheet = document.querySelector('.receipt-wrap') as HTMLElement | null
    if (!sheet) return
    setDownloading(true)
    try {
      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
        import('html2canvas'),
        import('jspdf'),
      ])
      const canvas = await html2canvas(sheet, { scale: 2, backgroundColor: '#ffffff', useCORS: true })
      const image = canvas.toDataURL('image/png')
      const widthMm = 127
      const heightMm = (canvas.height / canvas.width) * widthMm
      const pdf = new jsPDF({ orientation: heightMm > widthMm ? 'portrait' : 'landscape', unit: 'mm', format: [widthMm, heightMm] })
      pdf.addImage(image, 'PNG', 0, 0, widthMm, heightMm)
      pdf.save(`${invoice?.invoice_number ?? 'receipt'}.pdf`)
    } finally {
      setDownloading(false)
    }
  }

  const { data: invoice, isLoading } = useQuery<Invoice>({
    queryKey: ['invoice-receipt', id],
    queryFn:  () => api.get(`/invoices/${id}`).then(r => r.data.data ?? r.data.invoice ?? r.data),
    enabled:  !!id && authReady,
  })

  const { data: quotation } = useQuery<Quotation>({
    queryKey: ['quotation-for-receipt', invoice?.quote_id],
    queryFn:  () => api.get(`/quotations/${invoice!.quote_id}`).then(r => r.data.data ?? r.data.quotation ?? r.data),
    enabled:  !!invoice?.quote_id && authReady,
  })

  if (authFailed) return (
    <div style={{ display:'flex', flexDirection:'column', justifyContent:'center', alignItems:'center', height:'100vh', fontFamily:'Inter,sans-serif', gap:12 }}>
      <span style={{ fontSize:15, color:'#ef4444' }}>Session expired.</span>
      <a href="/login" style={{ fontSize:13, color:'#1a2b5c', fontWeight:600 }}>Log in again →</a>
    </div>
  )
  if (!authReady || isLoading) return (
    <div style={{ display:'flex', justifyContent:'center', alignItems:'center', height:'100vh', fontFamily:'Inter,sans-serif', fontSize:14, color:'#6b7280' }}>
      Loading…
    </div>
  )
  if (!invoice) return (
    <div style={{ display:'flex', justifyContent:'center', alignItems:'center', height:'100vh', fontFamily:'Inter,sans-serif', fontSize:14, color:'#ef4444' }}>
      Invoice not found.
    </div>
  )

  // Prefer the quotation's items; fall back to the invoice's own line items
  // (direct/converted invoices with no linked quote) — same as the full invoice view.
  const items: QuoteItem[] = (quotation?.items?.length ? quotation.items : invoice.items) ?? []

  const subtotal      = Number(invoice.subtotal)
  const discountAmt   = Number(invoice.discount_amt)
  const shippingAmt   = Number(invoice.shipping_charges ?? 0)
  const rushAmt       = Number(invoice.rush_services ?? 0)
  const total         = Number(invoice.total)
  const savedAmt      = discountAmt

  const custName = invoice.customer_name || invoice.supplier_name || invoice.contact_name
    || quotation?.customer_name || quotation?.company_name || '—'
  const billAddress = bestAddress(
    invoice.billing_address,
    quotation?.billing_address,
    invoice.quote_billing_address,
    invoice.customer_billing_address,
    invoice.shipping_address,
    quotation?.shipping_address,
    invoice.customer_shipping_address,
  )
  const contactEmail = invoice.billing_email || invoice.contact_email || quotation?.billing_email
  const contactPhone = invoice.contact_number || invoice.contact_phone || quotation?.contact_number
  const isDtf       = (quotation?.order_type ?? invoice.order_type) === 'dtf'

  // Item display label
  const itemLabel = (item: QuoteItem) => {
    if (isDtf) return item.artwork_name || item.description || `DTF Transfer`
    return item.item || item.description || 'Item'
  }

  // Item sub-label (size, color, etc.)
  const itemSub = (item: QuoteItem) => {
    const parts: string[] = []
    if (item.size)  parts.push(item.size)
    if (item.color) parts.push(item.color)
    return parts.join(' · ')
  }

  // Original price (before discount, estimate per item)
  const origPrice = (item: QuoteItem) => {
    const amt = Number(item.amount)
    if (discountAmt > 0 && subtotal > 0) {
      return amt / (1 - discountAmt / (subtotal + discountAmt))
    }
    return amt
  }

  return (
    <>
      <style>{CSS}</style>
      <button className="back-btn" onClick={() => navigate(`/invoices/${id}`)}>
        ← Back
      </button>
      <button className="print-btn" onClick={() => window.print()}>
        🖨️ Print / Save PDF
      </button>
      <button className="dl-btn" onClick={downloadPdf} disabled={downloading}>
        {downloading ? 'Preparing…' : '⬇️ Download PDF'}
      </button>

      <div className="receipt-wrap">

        {/* ── HEADER ── */}
        <div className="rc-header">
          <div>
            <div style={{ display:'flex', alignItems:'center', gap:8 }}>
              <span className="rc-logo-name">decoinks</span>
              <div className="rc-logo-dots">
                <span style={{ background:'#06b6d4' }} />
                <span style={{ background:'#ec4899' }} />
                <span style={{ background:'#f97316' }} />
                <span style={{ background:'rgba(255,255,255,0.5)' }} />
              </div>
            </div>
            <div style={{ fontSize:10, color:'rgba(255,255,255,0.5)', letterSpacing:2, marginTop:2 }}>PRINTSHOP OS</div>
          </div>
          <div className="rc-inv-num">
            #{invoice.invoice_number}<br />
            <span>{fmtDate(invoice.issue_date)}</span>
          </div>
        </div>

        {/* ── ORDER SUMMARY ── */}
        <div className="rc-section-title">Order summary</div>

        <div className="rc-items">
          {items.length === 0 ? (
            <div style={{ padding:'16px 0', color:'#9ca3af', fontSize:13 }}>No items</div>
          ) : items.map((item, idx) => {
            const orig   = origPrice(item)
            const final  = Number(item.amount)
            const hasDisc = discountAmt > 0 && Math.abs(orig - final) > 0.01

            return (
              <div className="rc-item" key={item.id || idx}>

                {/* Info */}
                <div className="rc-item-body">
                  <div className="rc-item-name">
                    {itemLabel(item)} × {item.qty}
                  </div>
                  {itemSub(item) && (
                    <div className="rc-item-sub">{itemSub(item)}</div>
                  )}
                  {hasDisc && (
                    <div className="rc-item-coupon">
                      🏷 {invoice.discount_pct > 0 ? `${invoice.discount_pct}% OFF` : 'Discount'}
                      &nbsp;(-{fmt(orig - final)})
                    </div>
                  )}
                </div>

                {/* Price */}
                <div className="rc-item-price">
                  {hasDisc && <div className="original">{fmt(orig)}</div>}
                  <div className="final">{fmt(final)}</div>
                </div>
              </div>
            )
          })}
        </div>

        {/* ── TOTALS ── */}
        <div className="rc-totals">
          <hr className="rc-totals-divider" />

          <div className="rc-row">
            <span className="lbl">Subtotal</span>
            <span className="val">{fmt(subtotal + discountAmt)}</span>
          </div>

          {discountAmt > 0 && (
            <div className="rc-row discount">
              <span className="lbl">
                Discount {invoice.discount_pct > 0 ? `(${invoice.discount_pct}%)` : ''}
              </span>
              <span className="val">-{fmt(discountAmt)}</span>
            </div>
          )}

          {shippingAmt > 0 ? (
            <div className="rc-row">
              <span className="lbl">Shipping</span>
              <span className="val">{fmt(shippingAmt)}</span>
            </div>
          ) : (
            <div className="rc-row">
              <span className="lbl">Shipping</span>
              <span className="val" style={{ color:'#16a34a' }}>$0.00</span>
            </div>
          )}

          {rushAmt > 0 && (
            <div className="rc-row">
              <span className="lbl">Rush Services</span>
              <span className="val">{fmt(rushAmt)}</span>
            </div>
          )}

          <hr className="rc-totals-divider" />

          {/* Total */}
          <div className="rc-total-row">
            <span className="tl">Total</span>
            <span className="tv">
              {fmt(total)}<span className="currency">{invoice.currency || 'USD'}</span>
            </span>
          </div>

          {savedAmt > 0 && (
            <div className="rc-saved">You saved {fmt(savedAmt)}</div>
          )}
        </div>

        {/* ── CUSTOMER INFORMATION ── */}
        <div className="rc-customer">
          <div className="rc-cust-title">Customer information</div>

          <div className="rc-cust-group">
            <div className="rc-cust-group-lbl">Billing address</div>
            <div className="rc-cust-group-val">
              <strong>{custName}</strong><br />
              {billAddress
                ? billAddress.split('\n').map((line, i) => <span key={i}>{line}<br /></span>)
                : <span style={{ color:'#9ca3af' }}>—</span>
              }
            </div>
          </div>

          {(contactEmail || contactPhone) && (
            <div className="rc-cust-group">
              <div className="rc-cust-group-lbl">Contact</div>
              <div className="rc-cust-group-val">
                {contactEmail && (
                  <a href={`mailto:${contactEmail}`}>{contactEmail}</a>
                )}
                {contactEmail && contactPhone && <br />}
                {contactPhone && <span>{contactPhone}</span>}
              </div>
            </div>
          )}

          <div className="rc-cust-group">
            <div className="rc-cust-group-lbl">Payment</div>
            <div className="rc-payment-badge">
              💳 {(invoice.payments?.[0]?.payment_method ?? invoice.payments?.[0]?.method ?? invoice.payment_method ?? 'Pending').replace(/_/g,' ').replace(/\b\w/g, (l:string) => l.toUpperCase())}
            </div>
          </div>
        </div>

        {/* ── BANK TRANSFER DETAILS ── */}
        <div className="rc-bank">
          <div className="rc-bank-lbl">Bank Transfer Details</div>
          <div className="rc-bank-grid">
            <div><span>Bank Name</span><strong>Bank of America</strong></div>
            <div><span>Account Title</span><strong>Decoinks LLC</strong></div>
            <div><span>Account Number</span><strong>325207480603</strong></div>
            <div><span>Routing / ACH · Direct Deposit</span><strong>121000358</strong></div>
          </div>
          <div className="rc-bank-note">Please use the invoice number as the payment reference.</div>
        </div>

        {/* ── FOOTER ── */}
        <div className="rc-footer">
          <strong>decoinks</strong> · info@decoinks.com · +1 (714) 790-1460<br />
          Suite 111, 1218 Magnolia Avenue, Corona, CA 92881
        </div>

      </div>
    </>
  )
}
