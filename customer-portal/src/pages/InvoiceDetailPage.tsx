import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  AlertCircle, ArrowLeft, CheckCircle2, CreditCard, Download, Loader2, Package, Truck,
} from 'lucide-react'
import { Layout } from '../components/Layout'
import { Badge } from '../components/ui'
import { useResource } from '../hooks/useResource'
import { money, fmtDate, dash } from '../services/api'
import { createPayLink, INVOICE_TONE, type InvoiceDetail } from '../services/payments'
import { cn } from '../utils/cn'

/**
 * One invoice: what it is for, what the order behind it is doing, and — when
 * anything is still owed — the way to pay it.
 *
 * Pay Now does not take the payment here. It asks the server for a payment link
 * and sends the customer to it, because the pay page is a separate, sessionless
 * page that the same link also reaches when we send it by WhatsApp or email.
 */
export default function InvoiceDetailPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const invoice = useResource<InvoiceDetail>(`/invoices/${id}`)
  const [paying, setPaying] = useState(false)
  const [payError, setPayError] = useState<string | null>(null)

  const inv = invoice.data

  async function handlePayNow() {
    if (!inv) return
    setPaying(true)
    setPayError(null)
    try {
      const { url } = await createPayLink(inv.id)
      window.location.href = url
    } catch (e) {
      setPayError((e as Error).message)
      setPaying(false)
    }
  }

  if (invoice.loading) {
    return (
      <Layout title="Invoice" subtitle="Loading…">
        <div className="cp-card space-y-3 p-6">
          {Array.from({ length: 6 }).map((_, i) => <div key={i} className="cp-skeleton h-6 w-full" />)}
        </div>
      </Layout>
    )
  }

  if (invoice.error || !inv) {
    return (
      <Layout title="Invoice" subtitle="This invoice could not be opened.">
        <div className="cp-card flex flex-col items-center p-10 text-center">
          <span className="grid h-11 w-11 place-items-center rounded-full bg-rose-50 text-rose-600">
            <AlertCircle size={20} />
          </span>
          <p className="mt-3 text-sm font-semibold text-ink">Couldn't load this invoice</p>
          <p className="mt-1 text-[13px] text-muted">{invoice.error ?? 'It may have been removed.'}</p>
          <button className="cp-btn mt-4" onClick={() => navigate('/invoices')}>
            <ArrowLeft size={15} /> Back to invoices
          </button>
        </div>
      </Layout>
    )
  }

  return (
    <Layout title={`Invoice ${inv.invoiceNumber}`} subtitle={inv.orderNumber ? `For order ${inv.orderNumber}` : undefined}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Link to="/invoices" className="cp-btn cp-btn-sm">
          <ArrowLeft size={15} /> All invoices
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <a
            className="cp-btn cp-btn-sm"
            href={`/invoices/${inv.id}/print`}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Download size={15} /> Download invoice
          </a>
          {inv.payable && (
            <button className="cp-btn cp-btn-sm cp-btn-primary" onClick={handlePayNow} disabled={paying}>
              {paying ? <Loader2 size={15} className="animate-spin" /> : <CreditCard size={15} />}
              {paying ? 'Opening…' : `Pay ${money(inv.balanceDue)}`}
            </button>
          )}
        </div>
      </div>

      {payError && (
        <div className="mb-4 flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4">
          <AlertCircle size={19} className="mt-0.5 shrink-0 text-rose-600" />
          <div className="text-[13px] text-rose-900">{payError}</div>
        </div>
      )}

      {inv.status === 'Paid' && (
        <div className="mb-4 flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
          <CheckCircle2 size={19} className="mt-0.5 shrink-0 text-emerald-600" />
          <div className="text-[13px] text-emerald-900">
            <span className="font-semibold">This invoice is paid in full.</span> Thank you.
          </div>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Invoice body */}
        <div className="space-y-4 lg:col-span-2">
          <div className="cp-card p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-lg font-bold text-ink">{inv.invoiceNumber}</div>
                <div className="mt-0.5 text-[13px] text-muted">
                  Issued {fmtDate(inv.issueDate)} · Due {fmtDate(inv.dueDate)}
                </div>
              </div>
              <Badge tone={INVOICE_TONE[inv.status]}>{inv.status}</Badge>
            </div>

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <div>
                <div className="cp-label">Billed to</div>
                <div className="mt-1 text-sm font-medium text-ink">{dash(inv.billTo.name)}</div>
                <div className="whitespace-pre-line text-[13px] text-muted">{dash(inv.billTo.address)}</div>
                {inv.billTo.email && <div className="text-[13px] text-muted">{inv.billTo.email}</div>}
              </div>
              {inv.shipTo && (
                <div>
                  <div className="cp-label">Shipping to</div>
                  <div className="mt-1 whitespace-pre-line text-[13px] text-muted">{inv.shipTo}</div>
                </div>
              )}
            </div>
          </div>

          <div className="cp-card overflow-hidden">
            <div className="cp-table-wrap">
              <table className="w-full min-w-[560px] text-left">
                <thead>
                  <tr>
                    <th className="cp-th">Description</th>
                    <th className="cp-th">Qty</th>
                    <th className="cp-th">Unit price</th>
                    <th className="cp-th text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {inv.items.length === 0 && (
                    <tr><td className="cp-td text-muted" colSpan={4}>No line items were recorded on this invoice.</td></tr>
                  )}
                  {inv.items.map(line => (
                    <tr key={line.id}>
                      <td className="cp-td">
                        <div className="font-medium text-ink">{dash(line.description)}</div>
                        {(line.sizes || line.colors) && (
                          <div className="text-xs text-muted">
                            {[line.sizes, line.colors].filter(Boolean).join(' · ')}
                          </div>
                        )}
                      </td>
                      <td className="cp-td tabular-nums">{line.qty}</td>
                      <td className="cp-td tabular-nums">{money(line.unitPrice)}</td>
                      <td className="cp-td text-right tabular-nums">{money(line.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <dl className="space-y-2 border-t border-line px-4 py-4 text-sm">
              <Row label="Subtotal" value={money(inv.subtotal)} />
              {inv.discount > 0 && <Row label="Discount" value={`− ${money(inv.discount)}`} />}
              {inv.rush > 0 && <Row label="Rush services" value={money(inv.rush)} />}
              {inv.shipping > 0 && <Row label="Shipping" value={money(inv.shipping)} />}
              {inv.tax > 0 && <Row label="Tax" value={money(inv.tax)} />}
              <Row label="Total" value={money(inv.total)} strong />
              <Row label="Paid" value={money(inv.amountPaid)} />
              <Row
                label="Balance due"
                value={money(inv.balanceDue)}
                strong
                tone={inv.balanceDue > 0 ? 'text-amber-700' : 'text-emerald-700'}
              />
            </dl>
          </div>

          {inv.notes && (
            <div className="cp-card p-5">
              <div className="cp-label">Notes</div>
              <p className="mt-1 whitespace-pre-line text-[13px] text-muted">{inv.notes}</p>
            </div>
          )}
        </div>

        {/* Order behind the invoice */}
        <div className="space-y-4">
          {inv.payable && (
            <div className="cp-card border-brand/30 bg-indigo-50/50 p-5">
              <div className="text-[13px] font-semibold uppercase tracking-wide text-brand">Amount due</div>
              <div className="mt-1 text-3xl font-bold tabular-nums text-ink">{money(inv.balanceDue)}</div>
              <p className="mt-1 text-[13px] text-muted">
                Pay securely by card, Apple&nbsp;Pay or Google&nbsp;Pay. The amount is fixed and cannot be changed.
              </p>
              <button
                className="cp-btn cp-btn-primary mt-4 w-full justify-center"
                onClick={handlePayNow}
                disabled={paying}
              >
                {paying ? <Loader2 size={16} className="animate-spin" /> : <CreditCard size={16} />}
                {paying ? 'Opening secure page…' : 'Pay now'}
              </button>
            </div>
          )}

          {inv.order && (
            <div className="cp-card p-5">
              <div className="flex items-center gap-2 text-ink">
                <Package size={17} className="text-brand" />
                <span className="text-sm font-semibold">Order {dash(inv.order.number)}</span>
              </div>
              <dl className="mt-3 space-y-2 text-[13px]">
                <Row label="Order date" value={fmtDate(inv.order.date)} />
                <Row label="Required by" value={fmtDate(inv.order.dueDate)} />
                <Row label="Type" value={dash(inv.order.type)} />
                <Row label="Status" value={dash(inv.order.status)} />
                <Row label="Payment" value={dash(inv.order.paymentStatus)} />
              </dl>

              {inv.order.trackingNumber && (
                <div className="mt-4 flex items-start gap-2 rounded-lg bg-slate-50 p-3">
                  <Truck size={16} className="mt-0.5 shrink-0 text-muted" />
                  <div className="text-[13px]">
                    <div className="font-medium text-ink">{inv.order.trackingNumber}</div>
                    <div className="text-muted">{dash(inv.order.courier)}</div>
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="cp-card p-5">
            <div className="cp-label">Payment terms</div>
            <div className="mt-1 text-sm text-ink">{dash(inv.paymentTerms)}</div>
          </div>
        </div>
      </div>
    </Layout>
  )
}

function Row({ label, value, strong, tone }: { label: string; value: string; strong?: boolean; tone?: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className={cn('text-muted', strong && 'font-semibold text-ink')}>{label}</dt>
      <dd className={cn('tabular-nums text-ink', strong && 'font-bold', tone)}>{value}</dd>
    </div>
  )
}
