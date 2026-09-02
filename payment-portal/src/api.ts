/**
 * The payment portal's only conversation with the server.
 *
 * There is no session and no login. The token in the URL is the credential, and
 * it reaches exactly one invoice — nothing else on the server is addressable
 * from this app, which is why it can safely be its own public site.
 */

const BASE = '/api/pay'

export class PayError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
    this.name = 'PayError'
  }
}

async function read(res: Response) {
  const body = await res.json().catch(() => null)
  if (!res.ok) {
    // Routes answer with { error }; anything thrown inside a service comes back
    // through the shared handler as { message }. Read both, or the customer is
    // shown a blank reason at the exact moment the reason matters most.
    const reason = body?.error || body?.message
    throw new PayError(reason || `Something went wrong (${res.status}).`, res.status)
  }
  return body?.data ?? body
}

export interface PayView {
  // Null on a payment taken before any invoice exists — `description` names it
  // instead.
  invoiceNumber: string | null
  description: string | null
  orderNumber: string | null
  customerName: string | null
  amount: number
  currency: string
  issueDate: string | null
  dueDate: string | null
  expiresAt: string | null
  publishableKey: string
  testMode: boolean
  // Present when PayPal is configured. `enabled: false` simply means the button
  // is not offered — the card path is untouched either way.
  paypal?: { enabled: boolean; clientId: string | null; sandbox: boolean }
}

const PAYPAL = '/api/paypal'

/** Ask our server for a PayPal order. The amount comes from the link, not here. */
export const createPaypalOrder = (t: string): Promise<{ orderId: string }> =>
  fetch(`${PAYPAL}/${encodeURIComponent(t)}/order`, { method: 'POST', ...j }).then(read)

/**
 * Ask our server to capture it.
 *
 * The browser saying "approved" is not evidence — the server captures through
 * PayPal and records only what PayPal itself confirms.
 */
export const capturePaypalOrder = (t: string, orderId: string): Promise<{ status: string }> =>
  fetch(`${PAYPAL}/${encodeURIComponent(t)}/capture`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ orderId }),
  }).then(read)

export interface PayStatus {
  paid: boolean
  linkStatus: string
  invoiceNumber: string | null
  description?: string | null
  amount: number
  currency: string
  paidAt: string | null
}

const j = { headers: { Accept: 'application/json' } }

export const fetchLink = (t: string): Promise<PayView> =>
  fetch(`${BASE}/${encodeURIComponent(t)}`, j).then(read)

export const createIntent = (t: string): Promise<{ clientSecret: string }> =>
  fetch(`${BASE}/${encodeURIComponent(t)}/intent`, { method: 'POST', ...j }).then(read)

export const fetchStatus = (t: string): Promise<PayStatus> =>
  fetch(`${BASE}/${encodeURIComponent(t)}/status`, j).then(read)

export const money = (n: number, currency = 'USD') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(Number(n ?? 0))

export const fmtDate = (v: string | null | undefined) => {
  if (!v) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null
    : d.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' })
}
