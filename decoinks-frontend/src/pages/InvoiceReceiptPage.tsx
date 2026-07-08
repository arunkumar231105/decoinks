import { useParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '../services/api'
import { usePrintAuth } from '../hooks/usePrintAuth'

// ── Types ─────────────────────────────────────────────────────────────────────
interface Invoice {
  id: string; invoice_number: string; issue_date: string; due_date: string | null
  supplier_name: string | null; contact_name: string | null; contact_email: string | null
  contact_phone: string | null; shipping_name: string | null; shipping_address: string | null
  subtotal: number; discount_pct: number; discount_amt: number
  rush_services: number; shipping_charges: number
  total: number; notes: string | null; quote_id: string | null; order_type: string | null
  currency?: string | null
  items?: QuoteItem[]
  payments: any[]
}
interface Quotation {
  order_type: string; items: QuoteItem[]
}
interface QuoteItem {
  id: string; artwork_name?: string; description?: string; item?: string
  color?: string; size?: string; qty: number; unit_price: number; amount: number
  artwork_image?: string; front_image?: string
}
interface Artwork {
  id: string; artwork_no: string; artwork_name: string; width_inches: number
  height_inches: number; preview_url: string | null; thumbnail_url: string | null
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
  @media print {
    .print-btn { display: none; }
    body { background: #fff; }
    @page { margin: 4mm; size: 88mm auto; }
  }
`

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmt = (n: number | string | null | undefined) =>
  '$' + Number(n ?? 0).toFixed(2)

const fmtDate = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '—'

// ── Component ─────────────────────────────────────────────────────────────────
export function InvoiceReceiptPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { authReady, authFailed } = usePrintAuth()

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

  const { data: artworkData } = useQuery<{ artworks: Artwork[] }>({
    queryKey: ['artworks-for-receipt', invoice?.quote_id],
    queryFn:  () => api.get(`/quotations/${invoice!.quote_id}/artworks`).then(r => r.data),
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
  const artworks: Artwork[] = artworkData?.artworks ?? []

  const subtotal      = Number(invoice.subtotal)
  const discountAmt   = Number(invoice.discount_amt)
  const shippingAmt   = Number(invoice.shipping_charges ?? 0)
  const rushAmt       = Number(invoice.rush_services ?? 0)
  const total         = Number(invoice.total)
  const savedAmt      = discountAmt

  const custName    = invoice.supplier_name || invoice.contact_name || '—'
  const billAddress = invoice.shipping_address
  const isDtf       = (quotation?.order_type ?? invoice.order_type) === 'dtf'

  // Get artwork image for an item
  const artImg = (item: QuoteItem, idx: number): string | null => {
    if (item.artwork_image) return item.artwork_image
    if (item.front_image)   return item.front_image
    const art = artworks[idx]
    return art?.preview_url ?? art?.thumbnail_url ?? null
  }

  // Item display label
  const itemLabel = (item: QuoteItem) => {
    if (isDtf) return item.artwork_name || item.description || `DTF Transfer`
    return item.item || item.description || 'Item'
  }

  // Item sub-label (size, color, etc.)
  const itemSub = (item: QuoteItem) => {
    const parts: string[] = []
    if (item.size)  parts.push(item.size)
    if ((item as any).color) parts.push((item as any).color)
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
      <button className="back-btn" onClick={() => navigate(-1)}>
        ← Back
      </button>
      <button className="print-btn" onClick={() => window.print()}>
        🖨️ Print / Save PDF
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
            const img    = artImg(item, idx)
            const orig   = origPrice(item)
            const final  = Number(item.amount)
            const hasDisc = discountAmt > 0 && Math.abs(orig - final) > 0.01

            return (
              <div className="rc-item" key={item.id}>

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
              <span className="lbl">Pickup</span>
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

          {(invoice.contact_email || invoice.contact_phone) && (
            <div className="rc-cust-group">
              <div className="rc-cust-group-lbl">Contact</div>
              <div className="rc-cust-group-val">
                {invoice.contact_email && (
                  <a href={`mailto:${invoice.contact_email}`}>{invoice.contact_email}</a>
                )}
                {invoice.contact_email && invoice.contact_phone && <br />}
                {invoice.contact_phone && <span>{invoice.contact_phone}</span>}
              </div>
            </div>
          )}

          <div className="rc-cust-group">
            <div className="rc-cust-group-lbl">Payment</div>
            <div className="rc-payment-badge">
              💳 {(invoice.payments?.[0]?.payment_method ?? 'Pending').replace(/_/g,' ').replace(/\b\w/g, (l:string) => l.toUpperCase())}
            </div>
          </div>
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
