import { useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { useResource } from '../hooks/useResource'
import { money, fmtDate, dash } from '../services/api'
import type { InvoiceDetail } from '../services/payments'

/**
 * The downloadable invoice.
 *
 * There is no PDF generator in this stack, and adding one would mean a headless
 * browser in the container for a document the browser can already produce. This
 * page is the document; the print dialog's "Save as PDF" is the download. It
 * works on every desktop and mobile browser, needs no new dependency, and the
 * customer gets a file named after their own invoice.
 *
 * Print rules are scoped to this component rather than added to index.css,
 * which this project protects.
 */
export default function InvoicePrintPage() {
  const { id = '' } = useParams()
  const invoice = useResource<InvoiceDetail>(`/invoices/${id}`)
  const inv = invoice.data

  // Give the layout a beat to paint before the dialog steals the thread,
  // otherwise some browsers print a half-rendered page.
  useEffect(() => {
    if (!inv) return
    document.title = `Invoice ${inv.invoiceNumber} — Decoinks`
    const t = setTimeout(() => window.print(), 400)
    return () => clearTimeout(t)
  }, [inv])

  if (invoice.loading) {
    return <div className="p-10 text-center text-sm text-slate-500">Preparing your invoice…</div>
  }
  if (invoice.error || !inv) {
    return (
      <div className="p-10 text-center">
        <p className="text-sm font-semibold text-slate-900">This invoice could not be opened.</p>
        <p className="mt-1 text-sm text-slate-500">{invoice.error ?? 'It may have been removed.'}</p>
      </div>
    )
  }

  return (
    <>
      <style>{`
        @media print {
          .no-print { display: none !important; }
          @page { margin: 14mm; size: auto; }
          body { background: #fff !important; }
        }
        .inv-sheet { color: #0F172A; }
        .inv-sheet table { border-collapse: collapse; width: 100%; }
        .inv-sheet th, .inv-sheet td { padding: 8px 10px; }
        .inv-sheet thead th {
          border-bottom: 1.5px solid #0F172A; text-align: left;
          font-size: 11px; letter-spacing: .06em; text-transform: uppercase;
        }
        .inv-sheet tbody td { border-bottom: 1px solid #E2E8F0; font-size: 13px; vertical-align: top; }
        .num { text-align: right; font-variant-numeric: tabular-nums; }
      `}</style>

      <div className="mx-auto min-h-screen max-w-[820px] bg-white p-8 inv-sheet">
        <div className="no-print mb-6 flex items-center justify-between gap-3 rounded-xl bg-slate-100 px-4 py-3">
          <p className="text-[13px] text-slate-600">
            Your print dialog should open automatically. Choose <b>Save as PDF</b> to download.
          </p>
          <button
            onClick={() => window.print()}
            className="rounded-lg bg-indigo-600 px-3.5 py-2 text-[13px] font-medium text-white hover:bg-indigo-700"
          >
            Print / Save as PDF
          </button>
        </div>

        {/* Masthead */}
        <div className="flex items-start justify-between gap-6 border-b-2 border-slate-900 pb-5">
          <div>
            <div className="text-2xl font-bold tracking-tight">Decoinks</div>
            <div className="mt-0.5 text-[12px] uppercase tracking-[0.14em] text-slate-500">
              Custom Printing &amp; DTF Transfers
            </div>
          </div>
          <div className="text-right">
            <div className="text-[12px] uppercase tracking-[0.14em] text-slate-500">Invoice</div>
            <div className="text-xl font-bold">{inv.invoiceNumber}</div>
            <div className="mt-1 text-[12px] text-slate-500">
              Issued {fmtDate(inv.issueDate)}<br />Due {fmtDate(inv.dueDate)}
            </div>
          </div>
        </div>

        {/* Parties */}
        <div className="mt-6 grid grid-cols-2 gap-8">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-500">Billed to</div>
            <div className="mt-1.5 text-sm font-semibold">{dash(inv.billTo.name)}</div>
            <div className="whitespace-pre-line text-[13px] text-slate-600">{dash(inv.billTo.address)}</div>
            {inv.billTo.email && <div className="text-[13px] text-slate-600">{inv.billTo.email}</div>}
            {inv.billTo.phone && <div className="text-[13px] text-slate-600">{inv.billTo.phone}</div>}
          </div>
          <div>
            {inv.order && (
              <>
                <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-500">Order</div>
                <div className="mt-1.5 text-sm font-semibold">{dash(inv.order.number)}</div>
                <div className="text-[13px] text-slate-600">Ordered {fmtDate(inv.order.date)}</div>
                {inv.order.type && <div className="text-[13px] text-slate-600">{inv.order.type}</div>}
              </>
            )}
            {inv.shipTo && (
              <div className="mt-3">
                <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-500">Ship to</div>
                <div className="mt-1 whitespace-pre-line text-[13px] text-slate-600">{inv.shipTo}</div>
              </div>
            )}
          </div>
        </div>

        {/* Lines */}
        <table className="mt-7">
          <thead>
            <tr>
              <th>Description</th>
              <th className="num">Qty</th>
              <th className="num">Unit price</th>
              <th className="num">Amount</th>
            </tr>
          </thead>
          <tbody>
            {inv.items.length === 0 && (
              <tr><td colSpan={4} className="text-slate-500">No line items were recorded on this invoice.</td></tr>
            )}
            {inv.items.map(line => (
              <tr key={line.id}>
                <td>
                  <div className="font-medium">{dash(line.description)}</div>
                  {(line.sizes || line.colors) && (
                    <div className="text-[11px] text-slate-500">
                      {[line.sizes, line.colors].filter(Boolean).join(' · ')}
                    </div>
                  )}
                </td>
                <td className="num">{line.qty}</td>
                <td className="num">{money(line.unitPrice)}</td>
                <td className="num">{money(line.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Totals */}
        <div className="mt-5 flex justify-end">
          <dl className="w-full max-w-[300px] space-y-1.5 text-[13px]">
            <PrintRow label="Subtotal" value={money(inv.subtotal)} />
            {inv.discount > 0 && <PrintRow label="Discount" value={`− ${money(inv.discount)}`} />}
            {inv.rush > 0 && <PrintRow label="Rush services" value={money(inv.rush)} />}
            {inv.shipping > 0 && <PrintRow label="Shipping" value={money(inv.shipping)} />}
            {inv.tax > 0 && <PrintRow label="Tax" value={money(inv.tax)} />}
            <div className="border-t border-slate-900 pt-1.5">
              <PrintRow label="Total" value={money(inv.total)} strong />
            </div>
            <PrintRow label="Paid" value={money(inv.amountPaid)} />
            <PrintRow label="Balance due" value={money(inv.balanceDue)} strong />
          </dl>
        </div>

        {inv.notes && (
          <div className="mt-7 border-t border-slate-200 pt-4">
            <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-500">Notes</div>
            <p className="mt-1 whitespace-pre-line text-[13px] text-slate-600">{inv.notes}</p>
          </div>
        )}

        <div className="mt-8 border-t border-slate-200 pt-4 text-[11px] text-slate-500">
          Payment terms: {dash(inv.paymentTerms)}. Questions about this invoice? Email support@decoinks.com.
        </div>
      </div>
    </>
  )
}

function PrintRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className={strong ? 'font-semibold' : 'text-slate-600'}>{label}</dt>
      <dd className={`num ${strong ? 'font-bold' : ''}`}>{value}</dd>
    </div>
  )
}
