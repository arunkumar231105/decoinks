import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { loadStripe, type Stripe } from '@stripe/stripe-js'
import { Elements, ExpressCheckoutElement, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js'
import { AlertCircle, ArrowUpRight, CheckCircle2, Loader2, Lock, ShieldCheck } from 'lucide-react'
import { createIntent, fetchLink, fetchStatus, fmtDate, money, type PayView } from './api'

/**
 * Decoinks Payments.
 *
 * Dressed to match decoinks.com rather than the admin suite: white ground,
 * Poppins, black square-cornered buttons, and the wordmark's own CMYK inks as
 * the only colour. A customer arriving from an emailed link has usually never
 * seen our software — the page has to look like the company they bought from,
 * or it looks like a phishing attempt.
 *
 * Separate from the Customer Portal on purpose. No login, no account, no order
 * history: one token in the URL, one invoice, one amount the server decided.
 */

function tokenFromPath(): string {
  const parts = window.location.pathname.split('/').filter(Boolean)
  const i = parts.indexOf('pay')
  if (i !== -1 && parts[i + 1]) return decodeURIComponent(parts[i + 1])
  return parts.length === 1 ? decodeURIComponent(parts[0]) : ''
}

export default function App() {
  const token = useMemo(tokenFromPath, [])
  const [view, setView] = useState<PayView | null>(null)
  const [clientSecret, setClientSecret] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [paid, setPaid] = useState(false)

  const stripePromise = useMemo<Promise<Stripe | null> | null>(
    () => (view?.publishableKey ? loadStripe(view.publishableKey) : null),
    [view?.publishableKey],
  )

  useEffect(() => {
    // No token at all means somebody typed the bare address. That is not a
    // broken link and must not be dressed as one — it is simply the front door,
    // and the front door should explain itself.
    if (!token) { setLoading(false); return }

    let cancelled = false
    ;(async () => {
      try {
        const link = await fetchLink(token)
        if (cancelled) return
        setView(link)
        const { clientSecret: secret } = await createIntent(token)
        if (!cancelled) setClientSecret(secret)
      } catch (e) {
        if (cancelled) return
        const status = await fetchStatus(token).catch(() => null)
        if (status?.paid) {
          setPaid(true)
          setView(v => v ?? ({
            invoiceNumber: status.invoiceNumber ?? '', orderNumber: null, customerName: null,
            amount: status.amount, currency: status.currency, issueDate: null, dueDate: null,
            expiresAt: null, publishableKey: '', testMode: false,
          }))
        } else setError((e as Error).message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [token])

  if (loading) {
    return <Shell><Card><div className="flex h-52 items-center justify-center"><Loader2 className="animate-spin text-cyan" size={30} /></div></Card></Shell>
  }

  if (!token) return <Shell generic><FrontDoor /></Shell>
  if (paid) return <Shell><Success view={view} /></Shell>

  if (error || !view) {
    return (
      <Shell>
        <Card>
          <div className="flex flex-col items-center px-7 py-14 text-center">
            <span className="grid h-14 w-14 place-items-center rounded-full bg-magenta/10 text-magenta">
              <AlertCircle size={26} />
            </span>
            <h2 className="mt-5 text-lg font-semibold text-ink">This link can’t be used</h2>
            <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted">{error}</p>
            <a href="mailto:support@decoinks.com"
               className="mt-8 inline-flex h-11 items-center justify-center gap-2 rounded-btn bg-ink px-6 text-sm font-medium text-white transition hover:bg-black">
              Email us for a new link
            </a>
          </div>
        </Card>
      </Shell>
    )
  }

  return (
    <Shell>
      <Card>
        <Header view={view} />
        <div className="px-6 py-7 sm:px-9">
          {clientSecret && stripePromise ? (
            <Elements
              stripe={stripePromise}
              options={{
                clientSecret,
                appearance: {
                  theme: 'flat',
                  variables: {
                    colorPrimary: '#00B4E4',
                    colorText: '#121212',
                    colorTextSecondary: '#6B6B6B',
                    colorBackground: '#ffffff',
                    colorDanger: '#E45490',
                    fontFamily: 'Poppins, system-ui, sans-serif',
                    borderRadius: '2px',
                    spacingUnit: '4px',
                  },
                  rules: {
                    '.Input': { border: '1px solid #E4E4E4', boxShadow: 'none', padding: '11px 12px' },
                    '.Input:focus': { border: '1px solid #00B4E4', boxShadow: 'none' },
                    '.Tab': { border: '1px solid #E4E4E4', boxShadow: 'none' },
                    '.Tab--selected': { border: '1px solid #121212', color: '#121212' },
                    '.Label': { fontWeight: '500', color: '#6B6B6B' },
                  },
                },
              }}
            >
              <Form token={token} view={view} onPaid={() => setPaid(true)} />
            </Elements>
          ) : (
            <div className="flex items-center gap-2 py-8 text-sm text-muted">
              <Loader2 className="animate-spin" size={16} /> Preparing secure payment…
            </div>
          )}
        </div>
      </Card>
      <p className="mt-5 flex items-center justify-center gap-1.5 text-[12px] text-muted">
        <ShieldCheck size={14} />
        Payments processed by Stripe. Decoinks never sees your card number.
      </p>
    </Shell>
  )
}

/* ── Form ───────────────────────────────────────────────────────────────── */

function Form({ token, view, onPaid }: { token: string; view: PayView; onPaid: () => void }) {
  const stripe = useStripe()
  const elements = useElements()
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  // Undefined until the Express element reports back; false means this device
  // offers no wallet, and the whole block stays out of the way.
  const [walletsReady, setWalletsReady] = useState(false)
  const poll = useRef<number | null>(null)

  useEffect(() => () => { if (poll.current) window.clearInterval(poll.current) }, [])

  /**
   * Stripe telling this browser the card went through is not the same as the
   * money being in Decoinks' books — the webhook does that a moment later. The
   * page waits for our own server before saying "paid", and if that takes too
   * long it says so plainly rather than pretending nothing happened.
   */
  const waitForOurBooks = useCallback(() => {
    setConfirming(true)
    let tries = 0
    poll.current = window.setInterval(async () => {
      tries += 1
      const status = await fetchStatus(token).catch(() => null)
      if (status?.paid) {
        if (poll.current) window.clearInterval(poll.current)
        onPaid()
      } else if (tries >= 15) {
        if (poll.current) window.clearInterval(poll.current)
        setConfirming(false)
        setMessage(
          'Your payment went through, but we are still recording it. Please don’t pay again — ' +
          'refresh this page in a minute, or contact us and we’ll confirm it for you.',
        )
      }
    }, 2000)
  }, [token, onPaid])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('redirect_status') === 'succeeded') waitForOurBooks()
  }, [waitForOurBooks])

  /** Apple Pay / Google Pay confirm through the same intent as the card form. */
  async function onWalletConfirm() {
    if (!stripe || !elements) return
    setMessage(null)
    const { error, paymentIntent } = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: window.location.href },
      redirect: 'if_required',
    })
    if (error) {
      setMessage(error.message ?? 'That payment could not be completed. Please try another method.')
      return
    }
    if (paymentIntent && ['succeeded', 'processing'].includes(paymentIntent.status)) waitForOurBooks()
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!stripe || !elements) return
    setSubmitting(true)
    setMessage(null)

    const { error, paymentIntent } = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: window.location.href },
      redirect: 'if_required',
    })

    if (error) {
      setMessage(error.message ?? 'That payment could not be completed. Please try another method.')
      setSubmitting(false)
      return
    }
    if (paymentIntent && ['succeeded', 'processing'].includes(paymentIntent.status)) {
      waitForOurBooks()
      return
    }
    setSubmitting(false)
  }

  if (confirming) {
    return (
      <div className="flex flex-col items-center py-14 text-center">
        <Loader2 className="animate-spin text-cyan" size={32} />
        <p className="mt-5 text-sm font-medium text-ink">Confirming your payment…</p>
        <p className="mt-1 text-[13px] text-muted">Please don’t close this page.</p>
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      {/*
        Apple Pay and Google Pay live here, not in the Payment Element.
        They are wallets that ride on the card rail rather than payment methods
        of their own, so they never appear in payment_method_types and the
        Payment Element does not reliably surface them. The Express Checkout
        Element is Stripe's element for exactly this, and it renders only what
        the visitor's device actually supports — an Apple Pay button on an
        iPhone, Google Pay in Chrome, and nothing at all on a desktop with
        neither, which is why the divider below is conditional.
      */}
      <div className={walletsReady ? 'block' : 'hidden'}>
        <ExpressCheckoutElement
          options={{
            buttonTheme: { applePay: 'black', googlePay: 'black' },
            buttonHeight: 52,
            layout: { maxColumns: 1, maxRows: 3 },
          }}
          onReady={({ availablePaymentMethods }) => setWalletsReady(Boolean(availablePaymentMethods))}
          onConfirm={onWalletConfirm}
        />
        <div className="my-6 flex items-center gap-4">
          <span className="h-px flex-1 bg-hairline" />
          <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted">or pay by card</span>
          <span className="h-px flex-1 bg-hairline" />
        </div>
      </div>

      <PaymentElement options={{ layout: 'tabs' }} />

      {message && (
        <div className="flex items-start gap-2.5 border border-magenta/30 bg-magenta/5 p-3.5">
          <AlertCircle size={17} className="mt-0.5 shrink-0 text-magenta" />
          <p className="text-[13px] leading-relaxed text-ink">{message}</p>
        </div>
      )}

      <button
        type="submit"
        disabled={!stripe || submitting}
        className="flex h-[52px] w-full items-center justify-center gap-2 rounded-btn bg-ink text-[15px] font-medium tracking-wide text-white transition hover:bg-black disabled:cursor-not-allowed disabled:opacity-50"
      >
        {submitting ? <Loader2 className="animate-spin" size={18} /> : <Lock size={16} />}
        {submitting ? 'Processing…' : `Pay ${money(view.amount, view.currency)}`}
      </button>
    </form>
  )
}

/* ── Chrome ─────────────────────────────────────────────────────────────── */

function Shell({ children, generic }: { children: React.ReactNode; generic?: boolean }) {
  return (
    <div className="min-h-full bg-canvas px-4 py-10 sm:py-16">
      <div className="mx-auto flex w-full max-w-[520px] flex-col items-center">
        <a href="https://www.decoinks.com" className="mb-9 block">
          <img src="/decoinks-logo.png" alt="Decoinks" className="h-11 w-auto" />
        </a>
        {children}
        <footer className="mt-10 text-center text-[12px] leading-relaxed text-muted">
          {/* The front door has no invoice on it, so it must not ask about one. */}
          {generic ? 'Questions? Email ' : 'Questions about this invoice? Email '}
          <a className="font-medium text-ink underline decoration-cyan decoration-2 underline-offset-2"
             href="mailto:support@decoinks.com">support@decoinks.com</a>
          <br />© {new Date().getFullYear()} Decoinks LLC · Print Your Ideas
        </footer>
      </div>
    </div>
  )
}

const Card = ({ children }: { children: React.ReactNode }) => (
  <div className="w-full overflow-hidden rounded-card border border-hairline bg-white shadow-[0_1px_3px_rgba(0,0,0,0.04),0_8px_28px_-12px_rgba(0,0,0,0.12)]">
    <div className="cmyk-rule" />
    {children}
  </div>
)

function Header({ view }: { view: PayView }) {
  const due = fmtDate(view.dueDate)
  return (
    <div className="border-b border-hairline px-6 py-7 sm:px-9">
      {view.testMode && (
        <div className="mb-5 border border-yellow/50 bg-yellow/10 px-3 py-2 text-center text-[11px] font-semibold uppercase tracking-[0.14em] text-ink">
          Test mode — no real money will be charged
        </div>
      )}
      <div className="flex items-start justify-between gap-5">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">
            Invoice {view.invoiceNumber}
          </div>
          {view.customerName && <div className="mt-1.5 truncate text-[15px] font-medium text-ink">{view.customerName}</div>}
          {view.orderNumber && <div className="text-[13px] text-muted">Order {view.orderNumber}</div>}
          {due && <div className="mt-1 text-[12px] text-muted">Due {due}</div>}
        </div>
        <div className="shrink-0 text-right">
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">Amount due</div>
          <div className="mt-0.5 text-[34px] font-semibold leading-none tracking-tight text-ink">
            {money(view.amount, view.currency)}
          </div>
          <div className="mt-1 text-[12px] text-muted">{view.currency}</div>
        </div>
      </div>
    </div>
  )
}

/**
 * The bare address, with no token.
 *
 * Someone typing payments.decoinks.com is not holding a broken link, so this is
 * not an error — showing a red warning here made a working site look broken.
 */
function FrontDoor() {
  return (
    <Card>
      <div className="px-8 py-14 text-center">
        <h1 className="text-[22px] font-semibold tracking-tight text-ink">Decoinks Payments</h1>
        <p className="mx-auto mt-3 max-w-[22rem] text-sm leading-relaxed text-muted">
          This is where Decoinks invoices are paid. To pay one, open the payment link we sent you
          by email or WhatsApp — it opens your invoice here, with the amount already filled in.
        </p>

        <div className="mx-auto mt-9 max-w-[22rem] border-t border-hairline pt-7 text-left">
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">Don’t have a link?</div>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            Email <a className="font-medium text-ink underline decoration-cyan decoration-2 underline-offset-2"
                     href="mailto:support@decoinks.com">support@decoinks.com</a> with your order or
            invoice number and we’ll send you one.
          </p>
        </div>

        <a href="https://www.decoinks.com"
           className="mt-9 inline-flex h-11 items-center justify-center gap-1.5 rounded-btn bg-ink px-7 text-sm font-medium text-white transition hover:bg-black">
          Visit decoinks.com <ArrowUpRight size={15} />
        </a>
      </div>
    </Card>
  )
}

function Success({ view }: { view: PayView | null }) {
  return (
    <Card>
      <div className="flex flex-col items-center px-8 py-14 text-center">
        <span className="grid h-16 w-16 place-items-center rounded-full bg-cyan/10 text-cyan">
          <CheckCircle2 size={32} />
        </span>
        <h2 className="mt-6 text-[22px] font-semibold tracking-tight text-ink">Payment received</h2>
        {view && (
          <p className="mt-3 max-w-[24rem] text-sm leading-relaxed text-muted">
            Thank you. <span className="font-medium text-ink">{money(view.amount, view.currency)}</span> has been paid
            {view.invoiceNumber ? <> against invoice <span className="font-medium text-ink">{view.invoiceNumber}</span></> : null}.
          </p>
        )}
        <p className="mt-5 max-w-[24rem] text-[13px] leading-relaxed text-muted">
          A receipt is on its way to your email, and this invoice is now marked paid in your Decoinks account.
        </p>
        <a href="https://www.decoinks.com"
           className="mt-9 inline-flex h-11 items-center justify-center gap-1.5 rounded-btn bg-ink px-7 text-sm font-medium text-white transition hover:bg-black">
          Back to decoinks.com <ArrowUpRight size={15} />
        </a>
      </div>
    </Card>
  )
}
