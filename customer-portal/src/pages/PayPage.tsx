import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { loadStripe, type Stripe } from '@stripe/stripe-js'
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js'
import {
  AlertCircle, CheckCircle2, Droplet, Loader2, Lock, ShieldCheck,
} from 'lucide-react'
import { money, fmtDate } from '../services/api'
import {
  createPaymentIntent, fetchPayLink, fetchPayStatus, type PayLinkView,
} from '../services/payments'

/**
 * The payment page.
 *
 * Public and sessionless: the token in the URL is the only credential, and it
 * reaches exactly one invoice. That is what lets the same page serve both ways
 * of paying — the customer who pressed Pay Now in the portal and the customer
 * who was sent a link — and what lets the page move to its own host later
 * without any of this changing.
 *
 * The amount shown is the amount the server stored when the link was made. It
 * is never sent from here, so there is nothing on this page for a customer to
 * edit that would change what they are charged.
 */
export default function PayPage() {
  const { token = '' } = useParams()
  const [view, setView] = useState<PayLinkView | null>(null)
  const [clientSecret, setClientSecret] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [paid, setPaid] = useState(false)

  // One Stripe instance per publishable key, kept out of render.
  const stripePromise = useMemo<Promise<Stripe | null> | null>(
    () => (view?.publishableKey ? loadStripe(view.publishableKey) : null),
    [view?.publishableKey],
  )

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const link = await fetchPayLink(token)
        if (cancelled) return
        setView(link)
        const { clientSecret: secret } = await createPaymentIntent(token)
        if (cancelled) return
        setClientSecret(secret)
      } catch (e) {
        if (cancelled) return
        // A link that is already paid is not an error worth alarming anyone
        // about — show the thank-you instead.
        const status = await fetchPayStatus(token).catch(() => null)
        if (status?.paid) { setPaid(true); setView(v => v ?? asView(status)) }
        else setError((e as Error).message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [token])

  if (loading) return <Shell><Centered><Loader2 className="animate-spin text-white/70" size={28} /></Centered></Shell>

  if (paid) return <Shell><SuccessCard view={view} /></Shell>

  if (error || !view) {
    return (
      <Shell>
        <Card>
          <div className="flex flex-col items-center px-7 py-12 text-center">
            <span className="grid h-14 w-14 place-items-center rounded-full bg-rose-50 text-rose-600">
              <AlertCircle size={26} />
            </span>
            <h2 className="mt-4 text-lg font-bold text-slate-900">This link can't be used</h2>
            <p className="mt-2 max-w-sm text-sm text-slate-500">{error}</p>
            <p className="mt-6 text-[13px] text-slate-400">
              Need a new link? Email <a className="font-medium text-indigo-600" href="mailto:support@decoinks.com">support@decoinks.com</a>
            </p>
          </div>
        </Card>
      </Shell>
    )
  }

  return (
    <Shell>
      <Card>
        <InvoiceHeader view={view} />
        <div className="px-6 py-6 sm:px-7">
          {clientSecret && stripePromise ? (
            <Elements
              stripe={stripePromise}
              options={{
                clientSecret,
                appearance: {
                  theme: 'stripe',
                  variables: {
                    colorPrimary: '#4F46E5',
                    colorText: '#0F172A',
                    fontFamily: 'Inter, system-ui, sans-serif',
                    borderRadius: '10px',
                    spacingUnit: '4px',
                  },
                },
              }}
            >
              <PayForm token={token} view={view} onPaid={() => setPaid(true)} />
            </Elements>
          ) : (
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <Loader2 className="animate-spin" size={16} /> Preparing secure payment…
            </div>
          )}
        </div>
      </Card>
    </Shell>
  )
}

/* ── The form inside Stripe's context ───────────────────────────────────── */

function PayForm({ token, view, onPaid }: { token: string; view: PayLinkView; onPaid: () => void }) {
  const stripe = useStripe()
  const elements = useElements()
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const pollRef = useRef<number | null>(null)

  useEffect(() => () => { if (pollRef.current) window.clearInterval(pollRef.current) }, [])

  /**
   * Stripe telling this browser the card succeeded is not the same as the
   * money being recorded. The webhook does that, a moment later. So the page
   * waits for our own server to confirm before saying "paid" — and if the
   * webhook is slow, it says so honestly rather than claiming nothing happened.
   */
  const waitForOurBooks = useCallback(() => {
    setConfirming(true)
    let tries = 0
    pollRef.current = window.setInterval(async () => {
      tries += 1
      const status = await fetchPayStatus(token).catch(() => null)
      if (status?.paid) {
        if (pollRef.current) window.clearInterval(pollRef.current)
        onPaid()
      } else if (tries >= 15) {
        if (pollRef.current) window.clearInterval(pollRef.current)
        setConfirming(false)
        setMessage(
          'Your payment went through, but we are still recording it. ' +
          'You do not need to pay again — refresh this page in a minute, or contact us and we will confirm.',
        )
      }
    }, 2000)
  }, [token, onPaid])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!stripe || !elements) return

    setSubmitting(true)
    setMessage(null)

    const { error, paymentIntent } = await stripe.confirmPayment({
      elements,
      confirmParams: {
        // Only used by methods that must leave the page (some bank redirects
        // and 3-D Secure challenges). They come back here and the poll below
        // picks up where this left off.
        return_url: window.location.href,
      },
      redirect: 'if_required',
    })

    if (error) {
      setMessage(error.message ?? 'That payment could not be completed. Please try another card.')
      setSubmitting(false)
      return
    }

    if (paymentIntent && ['succeeded', 'processing'].includes(paymentIntent.status)) {
      waitForOurBooks()
      return
    }

    setSubmitting(false)
  }

  // Coming back from a redirect-based method: no form submit happened here, so
  // pick the result up from the URL and start waiting for our own confirmation.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('redirect_status') === 'succeeded') waitForOurBooks()
  }, [waitForOurBooks])

  if (confirming) {
    return (
      <div className="flex flex-col items-center py-10 text-center">
        <Loader2 className="animate-spin text-indigo-600" size={30} />
        <p className="mt-4 text-sm font-semibold text-slate-900">Confirming your payment…</p>
        <p className="mt-1 text-[13px] text-slate-500">Please don't close this page.</p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <PaymentElement options={{ layout: 'tabs' }} />

      {message && (
        <div className="flex items-start gap-2.5 rounded-xl border border-rose-200 bg-rose-50 p-3.5">
          <AlertCircle size={17} className="mt-0.5 shrink-0 text-rose-600" />
          <p className="text-[13px] text-rose-900">{message}</p>
        </div>
      )}

      <button
        type="submit"
        disabled={!stripe || submitting}
        className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 text-[15px] font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {submitting ? <Loader2 className="animate-spin" size={18} /> : <Lock size={17} />}
        {submitting ? 'Processing…' : `Pay ${money(view.amount)}`}
      </button>

      <p className="flex items-center justify-center gap-1.5 text-[12px] text-slate-400">
        <ShieldCheck size={14} />
        Secured by Stripe. Decoinks never sees your card number.
      </p>
    </form>
  )
}

/* ── Presentation ───────────────────────────────────────────────────────── */

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#0B1226] bg-[radial-gradient(60rem_40rem_at_50%_-10%,#1E2A55_0%,#0B1226_60%)] px-4 py-10 sm:py-14">
      <div className="mx-auto flex max-w-lg flex-col items-center">
        <div className="mb-7 flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-[#F97316] text-white">
            <Droplet size={22} fill="currentColor" />
          </span>
          <div>
            <div className="text-lg font-bold leading-tight text-white">Decoinks</div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">
              Secure Payment
            </div>
          </div>
        </div>
        {children}
        <p className="mt-7 text-center text-[12px] text-slate-500">
          Questions? Email{' '}
          <a className="text-slate-300 hover:text-white" href="mailto:support@decoinks.com">support@decoinks.com</a>
        </p>
      </div>
    </div>
  )
}

const Card = ({ children }: { children: React.ReactNode }) => (
  <div className="w-full overflow-hidden rounded-2xl bg-white shadow-2xl shadow-black/30">{children}</div>
)

const Centered = ({ children }: { children: React.ReactNode }) => (
  <div className="flex h-40 w-full items-center justify-center">{children}</div>
)

function InvoiceHeader({ view }: { view: PayLinkView }) {
  return (
    <div className="border-b border-slate-100 bg-slate-50 px-6 py-6 sm:px-7">
      {view.testMode && (
        <div className="mb-4 rounded-lg bg-amber-100 px-3 py-2 text-center text-[11px] font-bold uppercase tracking-[0.12em] text-amber-800">
          Test mode — no real money will be charged
        </div>
      )}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
            Invoice {view.invoiceNumber}
          </div>
          {view.customerName && (
            <div className="mt-1 truncate text-sm font-medium text-slate-700">{view.customerName}</div>
          )}
          {view.orderNumber && (
            <div className="text-[13px] text-slate-500">Order {view.orderNumber}</div>
          )}
        </div>
        <div className="shrink-0 text-right">
          <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">Amount due</div>
          <div className="text-3xl font-bold tabular-nums text-slate-900">{money(view.amount)}</div>
          <div className="text-[12px] text-slate-400">{view.currency}</div>
        </div>
      </div>
      {view.dueDate && (
        <div className="mt-3 text-[12px] text-slate-500">Due {fmtDate(view.dueDate)}</div>
      )}
    </div>
  )
}

function SuccessCard({ view }: { view: PayLinkView | null }) {
  return (
    <Card>
      <div className="flex flex-col items-center px-7 py-12 text-center">
        <span className="grid h-16 w-16 place-items-center rounded-full bg-emerald-50 text-emerald-600">
          <CheckCircle2 size={32} />
        </span>
        <h2 className="mt-5 text-xl font-bold text-slate-900">Payment received</h2>
        {view && (
          <p className="mt-2 text-sm text-slate-500">
            Thank you. <span className="font-semibold text-slate-900">{money(view.amount)}</span> has been paid
            {view.invoiceNumber ? <> against invoice <span className="font-semibold text-slate-900">{view.invoiceNumber}</span></> : null}.
          </p>
        )}
        <p className="mt-4 max-w-sm text-[13px] text-slate-400">
          A receipt is on its way to your email. Your invoice is now marked as paid in your Decoinks account.
        </p>
      </div>
    </Card>
  )
}

/** A status response is enough to render the thank-you when the link is spent. */
function asView(status: { invoiceNumber: string | null; amount: number; currency: string }): PayLinkView {
  return {
    invoiceNumber: status.invoiceNumber ?? '',
    orderNumber: null,
    customerName: null,
    amount: status.amount,
    currency: status.currency,
    issueDate: null,
    dueDate: null,
    expiresAt: null,
    publishableKey: '',
    testMode: false,
  }
}
