import { useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '../services/api'
import { useAuthStore } from '../store/authStore'

// ── Types ─────────────────────────────────────────────────────────────────────
interface QuoteItem {
  id: string; description: string; qty: number; unit_price: number
  amount: number; sizes: string | null; colors: string | null; artwork_count: number
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
  tax_pct: number; tax_amt: number; total: number; notes: string | null
  quote_estimate: string | null; items: QuoteItem[]
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmt = (n: number) => '$ ' + Number(n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtDate = (d: string | null) => d ? new Date(d).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' }) : '—'

// ── Company info (Decoinks) ───────────────────────────────────────────────────
const CO = {
  name: 'decoinks',
  tagline: 'PRINTSHOP OS',
  address: 'Suite 111, 1218 Magnolia Avenue',
  city: 'Corona , CA 92881, United States',
  email: 'info@decoinks.com',
  phone: '+1 (714) 790-1460',
  zelle: 'decoinks.pay@gmail.com',
  paypal: 'paypal.me/decoinks',
}

// ── Print styles ──────────────────────────────────────────────────────────────
const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Inter', sans-serif; font-size: 12px; color: #1a1a2e; background: #fff; }
  .page { max-width: 900px; margin: 0 auto; padding: 32px 28px; }
  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .no-print { display: none !important; }
    .page { padding: 20px; }
    @page { margin: 10mm; size: A4; }
  }
  /* Header */
  .hdr { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 22px; }
  .logo-block .logo-name { font-size: 28px; font-weight: 800; color: #1a1a2e; letter-spacing: -1px; text-transform: lowercase; }
  .logo-dots { display: inline-flex; gap: 3px; margin-left: 4px; vertical-align: middle; }
  .logo-dots span { width: 7px; height: 7px; border-radius: 50%; display: inline-block; }
  .logo-tag { font-size: 10px; font-weight: 700; letter-spacing: 2px; color: #64748b; margin-top: 2px; }
  .hdr-title { font-size: 38px; font-weight: 900; color: #1a1a2e; letter-spacing: 2px; }
  /* Top meta */
  .meta-row { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px; }
  .co-info p { font-size: 11.5px; color: #374151; line-height: 1.7; }
  .co-info .icon-line { display: flex; align-items: center; gap: 6px; }
  .quote-meta { text-align: right; }
  .quote-meta table { border-collapse: collapse; margin-left: auto; }
  .quote-meta td { padding: 2px 6px; font-size: 12.5px; }
  .quote-meta .lbl { color: #64748b; font-weight: 500; }
  .quote-meta .val { color: #1d4ed8; font-weight: 700; }
  .validity-note { font-size: 11px; color: #9ca3af; text-align: right; margin-top: 4px; }
  /* Info cards */
  .info-cards { display: grid; grid-template-columns: 1fr 1.4fr 1.4fr 1fr; gap: 12px; margin-bottom: 24px; }
  .info-card { border: 1.5px solid #e5e7eb; border-radius: 10px; padding: 12px 14px; }
  .info-card-icon { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; }
  .info-card-icon .ic { background: #1d4ed8; color: #fff; border-radius: 6px; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; font-size: 11px; }
  .info-card-icon .lbl { font-size: 9px; font-weight: 700; letter-spacing: 1px; color: #9ca3af; text-transform: uppercase; }
  .info-card .big-val { font-size: 18px; font-weight: 800; color: #1d4ed8; margin-bottom: 4px; }
  .info-card .sub { font-size: 10.5px; color: #6b7280; }
  .info-card .cust-name { font-size: 13px; font-weight: 700; color: #1a1a2e; margin-bottom: 3px; }
  .info-card .cust-detail { font-size: 11px; color: #374151; line-height: 1.7; }
  .info-card .term-val { font-size: 14px; font-weight: 700; color: #1a1a2e; margin-bottom: 10px; }
  .info-card .method-label { font-size: 8.5px; font-weight: 700; letter-spacing: 1px; color: #9ca3af; text-transform: uppercase; margin-bottom: 4px; }
  .info-card .method-val { font-size: 13px; font-weight: 600; color: #1a1a2e; }
  .divider-h { border: none; border-top: 1.5px solid #e5e7eb; margin: 8px 0; }
  /* Items table */
  .items-table { width: 100%; border-collapse: collapse; margin-bottom: 0; }
  .items-table thead tr { background: #1a1a2e; }
  .items-table thead th { color: #fff; font-size: 10px; font-weight: 600; letter-spacing: 0.5px; padding: 10px 10px; text-align: left; text-transform: uppercase; }
  .items-table thead th.center { text-align: center; }
  .items-table tbody tr { border-bottom: 1px solid #f1f5f9; }
  .items-table tbody tr:last-child { border-bottom: none; }
  .items-table td { padding: 10px 10px; vertical-align: middle; font-size: 12px; }
  .items-table td.center { text-align: center; }
  .items-table td.right { text-align: right; }
  .items-table .item-desc-main { font-weight: 700; font-size: 13px; color: #1a1a2e; }
  .items-table .item-desc-sub { font-size: 10.5px; color: #6b7280; line-height: 1.6; }
  .items-table .aw-no { color: #1d4ed8; font-weight: 600; font-size: 11.5px; }
  .art-thumb { width: 54px; height: 54px; object-fit: contain; border: 1px solid #e5e7eb; border-radius: 6px; background: #f9fafb; }
  .art-thumb-placeholder { width: 54px; height: 54px; border: 1px solid #e5e7eb; border-radius: 6px; background: #f3f4f6; display: flex; align-items: center; justify-content: center; font-size: 9px; color: #9ca3af; text-align: center; }
  .color-dot { width: 12px; height: 12px; border-radius: 50%; display: inline-block; border: 1px solid #d1d5db; margin-right: 4px; vertical-align: middle; }
  .table-wrap { border: 1.5px solid #e5e7eb; border-radius: 10px; overflow: hidden; margin-bottom: 14px; }
  /* Summary stats */
  .stat-row { display: grid; grid-template-columns: repeat(4, 1fr); border: 1.5px solid #e5e7eb; border-radius: 10px; overflow: hidden; margin-bottom: 22px; }
  .stat-cell { padding: 14px 16px; border-right: 1px solid #e5e7eb; }
  .stat-cell:last-child { border-right: none; }
  .stat-icon { font-size: 18px; margin-bottom: 4px; color: #6b7280; }
  .stat-label { font-size: 10px; color: #9ca3af; font-weight: 500; margin-bottom: 3px; }
  .stat-value { font-size: 20px; font-weight: 800; color: #1a1a2e; }
  .stat-value.blue { color: #1d4ed8; }
  /* Bottom grid */
  .bottom-grid { display: grid; grid-template-columns: 1.1fr 1.3fr 1fr; gap: 18px; margin-top: 6px; }
  .pricing-section h4, .payment-section h4, .notes-section h4 { font-size: 12px; font-weight: 700; letter-spacing: 0.5px; color: #1a1a2e; margin-bottom: 10px; text-transform: uppercase; }
  .pricing-row { display: flex; justify-content: space-between; font-size: 12px; padding: 4px 0; color: #374151; }
  .pricing-row.divider { border-top: 1px solid #e5e7eb; margin-top: 4px; padding-top: 8px; }
  .pricing-row.total { font-size: 16px; font-weight: 800; color: #16a34a; border-top: 2px solid #e5e7eb; margin-top: 4px; padding-top: 8px; }
  .pricing-row .neg { color: #dc2626; }
  .pay-method { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
  .pay-method-icon { font-size: 16px; font-weight: 800; }
  .pay-method-icon.zelle { color: #6600cc; }
  .pay-method-icon.paypal { color: #003087; }
  .pay-method-info { font-size: 10.5px; color: #374151; }
  .pay-method-label { font-size: 10px; font-weight: 700; color: #9ca3af; letter-spacing: 0.5px; text-transform: uppercase; margin-bottom: 2px; }
  .pay-method-val { font-size: 11px; color: #374151; }
  .pay-other { font-size: 10.5px; color: #374151; margin-top: 4px; }
  .notes-box { border: 1.5px solid #e5e7eb; border-radius: 8px; min-height: 80px; padding: 10px 12px; font-size: 11.5px; color: #374151; line-height: 1.6; }
  .page-count { font-size: 10px; color: #9ca3af; text-align: right; margin-top: 4px; }
  /* Print button */
  .print-btn { position: fixed; top: 20px; right: 20px; background: #1d4ed8; color: #fff; border: none; border-radius: 8px; padding: 10px 20px; font-size: 14px; font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 8px; box-shadow: 0 4px 12px rgba(29,78,216,0.3); z-index: 999; }
  .print-btn:hover { background: #1e40af; }
`

// ── Color name → hex ──────────────────────────────────────────────────────────
const colorHex = (c: string): string => {
  const m: Record<string, string> = {
    black: '#1f2937', white: '#ffffff', 'navy blue': '#1e3a5f', navy: '#1e3a5f',
    red: '#ef4444', blue: '#3b82f6', green: '#16a34a', grey: '#9ca3af', gray: '#9ca3af',
    yellow: '#eab308', orange: '#f97316', pink: '#ec4899', purple: '#8b5cf6',
    'forest green': '#15803d',
  }
  return m[c.toLowerCase()] ?? '#d1d5db'
}

// ── Main component ────────────────────────────────────────────────────────────
export function QuotePrintPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { isAuthenticated } = useAuthStore()

  useEffect(() => {
    if (!isAuthenticated) navigate('/login')
  }, [isAuthenticated, navigate])

  const { data: quote, isLoading } = useQuery<Quote>({
    queryKey: ['quote-print', id],
    queryFn: () => api.get(`/quotations/${id}`).then(r => r.data.data),
    enabled: !!id,
  })

  const { data: artworkData } = useQuery<{ artworks: Artwork[] }>({
    queryKey: ['quote-artworks-print', id],
    queryFn: () => api.get(`/quotations/${id}/artworks`).then(r => r.data),
    enabled: !!id,
  })
  const artworks = artworkData?.artworks ?? []

  useEffect(() => {
    if (quote) {
      document.title = `${quote.quote_number} - Decoinks Quotation`
    }
  }, [quote])

  if (isLoading || !quote) {
    return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', fontFamily: 'Inter, sans-serif', color: '#64748b' }}>Loading quotation…</div>
  }

  const orderType = quote.order_type ?? 'dtf'
  const totalItems = quote.items.length
  const totalQty   = quote.items.reduce((s, i) => s + i.qty, 0)
  const shippingLine = [quote.shipping_address, quote.shipping_city, quote.shipping_state, quote.zip_code, quote.shipping_country].filter(Boolean).join(', ')
  const quoteDate = fmtDate(quote.created_at)
  const validUntil = fmtDate(quote.valid_until)

  return (
    <>
      <style>{CSS}</style>

      <button className="no-print print-btn" onClick={() => window.print()}>
        🖨️ Download / Print PDF
      </button>

      <div className="page">

        {/* ── Header ── */}
        <div className="hdr">
          <div className="logo-block">
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 0 }}>
              <span className="logo-name">decoinks</span>
              <span className="logo-dots">
                <span style={{ background: '#f97316' }} />
                <span style={{ background: '#22c55e' }} />
                <span style={{ background: '#1f2937' }} />
                <span style={{ background: '#f97316' }} />
              </span>
            </div>
            <div className="logo-tag">PRINTSHOP OS</div>
          </div>
          <div className="hdr-title">QUOTATION</div>
          <div>
            <div className="quote-meta">
              <table>
                <tbody>
                  <tr><td className="lbl">Quote No</td><td style={{ padding: '0 6px' }}>:</td><td className="val">{quote.quote_number}</td></tr>
                  <tr><td className="lbl">Quote Date</td><td style={{ padding: '0 6px' }}>:</td><td className="val">{quoteDate}</td></tr>
                  <tr><td className="lbl">Valid Until</td><td style={{ padding: '0 6px' }}>:</td><td className="val">{validUntil}</td></tr>
                </tbody>
              </table>
            </div>
            <div className="validity-note">( 7 days validity )</div>
          </div>
        </div>

        {/* ── Company info ── */}
        <div className="meta-row">
          <div className="co-info">
            <div className="icon-line"><span>📍</span>
              <div><p>{CO.address}</p><p>{CO.city}</p></div>
            </div>
            <div className="icon-line" style={{ marginTop: 4 }}><span>✉️</span><p>{CO.email}</p></div>
            <div className="icon-line" style={{ marginTop: 2 }}><span>📞</span><p>{CO.phone}</p></div>
          </div>
        </div>

        {/* ── Info cards ── */}
        <div className="info-cards">
          {/* Quote No */}
          <div className="info-card">
            <div className="info-card-icon">
              <div className="ic">🔖</div>
              <span className="lbl">Quote No</span>
            </div>
            <div className="big-val">{quote.quote_number}</div>
            <div className="sub">Auto generated</div>
          </div>
          {/* Customer */}
          <div className="info-card">
            <div className="info-card-icon">
              <div className="ic">👤</div>
              <span className="lbl">Customer</span>
            </div>
            <div className="cust-name">{quote.customer_name || quote.supplier_name || '—'}</div>
            <div className="cust-detail">
              {quote.billing_email && <div>{quote.billing_email}</div>}
              {quote.contact_number && <div>{quote.contact_number}</div>}
              {quote.company_name && <div style={{ color: '#9ca3af', fontSize: 10 }}>{quote.company_name}</div>}
            </div>
          </div>
          {/* Shipping */}
          <div className="info-card">
            <div className="info-card-icon">
              <div className="ic">🚚</div>
              <span className="lbl">Shipping Address</span>
            </div>
            <div className="cust-detail" style={{ lineHeight: 1.9 }}>
              {quote.customer_name || '—'}
              {shippingLine && <><br />{shippingLine}</>}
            </div>
          </div>
          {/* Payment */}
          <div className="info-card">
            <div className="info-card-icon">
              <div className="ic">🧾</div>
              <span className="lbl">Payment Terms</span>
            </div>
            <div className="term-val">Net 15</div>
            <hr className="divider-h" />
            <div className="method-label">Payment Method</div>
            <div className="method-val">Bank Transfer</div>
          </div>
        </div>

        {/* ── Items table ── */}
        <div className="table-wrap">
          {orderType === 'dtf' && <DtfTable items={quote.items} artworks={artworks} />}
          {orderType === 'apparel' && <ApparelTable items={quote.items} artworks={artworks} />}
          {orderType === 'gangsheet' && <GangsheetTable items={quote.items} />}
          {!['dtf','apparel','gangsheet'].includes(orderType) && <GenericTable items={quote.items} />}
        </div>

        {/* ── Summary stats ── */}
        <div className="stat-row">
          <div className="stat-cell">
            <div className="stat-icon">👕</div>
            <div className="stat-label">Total Items</div>
            <div className="stat-value">{totalItems}</div>
          </div>
          <div className="stat-cell">
            <div className="stat-icon">🖼️</div>
            <div className="stat-label">Total Artworks</div>
            <div className="stat-value">{artworks.length || quote.items.reduce((s, i) => s + (i.artwork_count || 0), 0)}</div>
          </div>
          <div className="stat-cell">
            <div className="stat-icon">📦</div>
            <div className="stat-label">Total Qty</div>
            <div className="stat-value">{totalQty} pcs</div>
          </div>
          <div className="stat-cell">
            <div className="stat-icon">🧮</div>
            <div className="stat-label">Total Amount</div>
            <div className="stat-value blue">{fmt(quote.subtotal)}</div>
          </div>
        </div>

        {/* ── Bottom grid ── */}
        <div className="bottom-grid">
          {/* Pricing summary */}
          <div className="pricing-section">
            <h4>Pricing Summary</h4>
            <div className="pricing-row"><span>Items Total</span><span>{fmt(quote.subtotal)}</span></div>
            <div className="pricing-row"><span>Rush Services ⓘ</span><span>$ 0.00</span></div>
            <div className="pricing-row"><span>Estimated Shipping</span><span>$ 0.00</span></div>
            <div className="pricing-row divider"><span>Subtotal</span><span>{fmt(quote.subtotal)}</span></div>
            <div className="pricing-row"><span>Discount</span><span className="neg">- {fmt(quote.discount_amt)}</span></div>
            <div className="pricing-row"><span>Tax ({quote.tax_pct}%)</span><span>{fmt(quote.tax_amt)}</span></div>
            <div className="pricing-row total"><span>Total</span><span>{fmt(quote.total)}</span></div>
          </div>

          {/* Payment information */}
          <div className="payment-section">
            <h4>Payment Information</h4>
            <div style={{ fontSize: 10, color: '#9ca3af', marginBottom: 8, textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.5px' }}>Payment Methods</div>
            <div className="pay-method">
              <div>
                <div className="pay-method-icon zelle" style={{ fontSize: 18, fontWeight: 900, fontFamily: 'Georgia, serif', letterSpacing: '-1px' }}>Zelle</div>
                <div className="pay-method-val">{CO.zelle}</div>
              </div>
            </div>
            <div className="pay-method">
              <div>
                <div style={{ fontSize: 13, fontWeight: 800, color: '#003087' }}>PayPal</div>
                <div className="pay-method-val">{CO.paypal}</div>
              </div>
            </div>
            <hr className="divider-h" />
            <div className="pay-other">
              <strong>Debit / Credit Cards</strong><br />
              <span style={{ color: '#6b7280' }}>We accept all major debit and credit cards</span>
            </div>
            <div className="pay-other" style={{ marginTop: 6 }}>
              <strong>Bank Deposit</strong><br />
              <span style={{ color: '#6b7280' }}>Please contact us for bank account details</span>
            </div>
          </div>

          {/* Notes */}
          <div className="notes-section">
            <h4>Notes</h4>
            <div className="notes-box">{quote.notes || 'Add your notes here...'}</div>
            <div className="page-count">0 / 500</div>
          </div>
        </div>

      </div>
    </>
  )
}

// ── Sub-tables per order type ─────────────────────────────────────────────────

function DtfTable({ items, artworks }: { items: QuoteItem[]; artworks: Artwork[] }) {
  const unitPrice = items[0]?.unit_price ?? 0
  return (
    <table className="items-table">
      <thead>
        <tr>
          <th style={{ width: 36 }}>S.No</th>
          <th>Item Description<br /><span style={{ fontWeight: 400, fontSize: 9 }}>(DTF Transfers)</span></th>
          <th>Artwork No</th>
          <th className="center">Artwork Thumbnail</th>
          <th>Artwork Size<br /><span style={{ fontWeight: 400, fontSize: 9 }}>(Width x Height)</span></th>
          <th className="center">Qty</th>
          <th className="center">Rate<br /><span style={{ fontWeight: 400, fontSize: 9 }}>(USD)</span></th>
          <th className="center">Amount<br /><span style={{ fontWeight: 400, fontSize: 9 }}>(USD)</span></th>
        </tr>
      </thead>
      <tbody>
        {artworks.length > 0 ? (
          artworks.map((aw, idx) => {
            const item = items[0]
            const rowQty = item ? Math.ceil(item.qty / Math.max(artworks.length, 1)) : 0
            const rowAmt = rowQty * unitPrice
            return (
              <tr key={aw.id}>
                {idx === 0 && (
                  <td rowSpan={artworks.length} style={{ verticalAlign: 'middle', fontWeight: 700, textAlign: 'center' }}>1</td>
                )}
                {idx === 0 && (
                  <td rowSpan={artworks.length} style={{ verticalAlign: 'middle' }}>
                    {item && <><div className="item-desc-main">{item.description}</div><div className="item-desc-sub">Premium Quality DTF<br />Ready to Press<br />Full Color</div></>}
                  </td>
                )}
                <td><span className="aw-no">{aw.artwork_no}</span></td>
                <td className="center">
                  {aw.file_url && aw.file_type !== 'pdf'
                    ? <img src={aw.file_url} alt={aw.name} className="art-thumb" />
                    : <div className="art-thumb-placeholder">No<br />Image</div>}
                </td>
                <td>{aw.width_inches && aw.height_inches ? `${aw.width_inches} in x ${aw.height_inches} in` : aw.name}</td>
                <td className="center">{rowQty} pcs</td>
                {idx === 0 && (
                  <td rowSpan={artworks.length} className="center" style={{ verticalAlign: 'middle', fontWeight: 700 }}>${unitPrice.toFixed(2)}</td>
                )}
                <td className="center">${rowAmt.toFixed(2)}</td>
              </tr>
            )
          })
        ) : (
          items.map((item, idx) => (
            <tr key={item.id}>
              <td className="center">{idx + 1}</td>
              <td><div className="item-desc-main">{item.description}</div></td>
              <td>—</td>
              <td className="center"><div className="art-thumb-placeholder">No<br />Image</div></td>
              <td>—</td>
              <td className="center">{item.qty} pcs</td>
              <td className="center">${item.unit_price.toFixed(2)}</td>
              <td className="center">${item.amount.toFixed(2)}</td>
            </tr>
          ))
        )}
      </tbody>
    </table>
  )
}

function ApparelTable({ items, artworks }: { items: QuoteItem[]; artworks: Artwork[] }) {
  return (
    <table className="items-table">
      <thead>
        <tr>
          <th style={{ width: 32 }}>#</th>
          <th>Item Description<br /><span style={{ fontWeight: 400, fontSize: 9 }}>Brand | Model</span></th>
          <th>Color</th>
          <th className="center">Qty<br /><span style={{ fontWeight: 400, fontSize: 9 }}>(Shirts)</span></th>
          <th>Sizes<br /><span style={{ fontWeight: 400, fontSize: 9 }}>(Size Ratio)</span></th>
          <th className="center">Front Artwork</th>
          <th className="center">Back Artwork</th>
          <th className="center">Unit Price<br /><span style={{ fontWeight: 400, fontSize: 9 }}>(USD)</span></th>
          <th className="center">Total Amount<br /><span style={{ fontWeight: 400, fontSize: 9 }}>(USD)</span></th>
        </tr>
      </thead>
      <tbody>
        {items.map((item, idx) => {
          const frontArt = artworks[idx * 2]
          const backArt  = artworks[idx * 2 + 1]
          const colors = item.colors?.split(',').map(c => c.trim()).filter(Boolean) ?? []
          return (
            <tr key={item.id}>
              <td className="center" style={{ fontWeight: 700 }}>{idx + 1}</td>
              <td><div className="item-desc-main">{item.description}</div></td>
              <td>
                {colors.length > 0
                  ? colors.map(c => (
                    <span key={c} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
                      <span className="color-dot" style={{ background: colorHex(c), border: c.toLowerCase() === 'white' ? '1px solid #d1d5db' : 'none' }} />
                      {c}
                    </span>
                  ))
                  : '—'}
              </td>
              <td className="center">{item.qty} pcs</td>
              <td style={{ fontSize: 11 }}>{item.sizes || '—'}</td>
              <td className="center">
                {frontArt?.file_url && frontArt.file_type !== 'pdf'
                  ? <img src={frontArt.file_url} alt={frontArt.name} className="art-thumb" />
                  : <div className="art-thumb-placeholder">—</div>}
              </td>
              <td className="center">
                {backArt?.file_url && backArt.file_type !== 'pdf'
                  ? <img src={backArt.file_url} alt={backArt.name} className="art-thumb" />
                  : <div className="art-thumb-placeholder">—</div>}
              </td>
              <td className="center">${item.unit_price.toFixed(2)}</td>
              <td className="center">${item.amount.toFixed(2)}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function GangsheetTable({ items }: { items: QuoteItem[] }) {
  return (
    <table className="items-table">
      <thead>
        <tr>
          <th style={{ width: 32 }}>#</th>
          <th>Gangsheet Size</th>
          <th className="center">No. of Artworks</th>
          <th className="center">Qty Sheets</th>
          <th className="center">Price / Sheet (USD)</th>
          <th className="center">Total (USD)</th>
        </tr>
      </thead>
      <tbody>
        {items.map((item, idx) => (
          <tr key={item.id}>
            <td className="center">{idx + 1}</td>
            <td><div className="item-desc-main">{item.description}</div></td>
            <td className="center">{item.artwork_count || 1}</td>
            <td className="center">{item.qty}</td>
            <td className="center">${item.unit_price.toFixed(2)}</td>
            <td className="center">${item.amount.toFixed(2)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function GenericTable({ items }: { items: QuoteItem[] }) {
  return (
    <table className="items-table">
      <thead>
        <tr>
          <th style={{ width: 32 }}>#</th>
          <th>Description</th>
          <th className="center">Qty</th>
          <th className="center">Unit Price (USD)</th>
          <th className="center">Amount (USD)</th>
        </tr>
      </thead>
      <tbody>
        {items.map((item, idx) => (
          <tr key={item.id}>
            <td className="center">{idx + 1}</td>
            <td><div className="item-desc-main">{item.description}</div></td>
            <td className="center">{item.qty}</td>
            <td className="center">${item.unit_price.toFixed(2)}</td>
            <td className="center">${item.amount.toFixed(2)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
