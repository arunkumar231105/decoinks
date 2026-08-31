/**
 * Invoices and payments.
 *
 * Two audiences in one file, kept apart on purpose:
 *
 *   - the signed-in customer, whose calls go to /api/portal/* and carry the
 *     portal token;
 *   - the pay page, which has no session at all. Its calls go to /api/pay/*
 *     and are authorised by the link token in the URL, because the pay page is
 *     destined for its own host where the portal's token does not travel.
 */

import { auth } from '../store/auth'
import { ApiError } from './api'

const PORTAL = '/api/portal'
const PAY = '/api/pay'

async function readBody(res: Response) {
  const body = await res.json().catch(() => null)
  if (!res.ok) {
    // Two shapes reach here. Routes that answer directly send `{ error }`;
    // anything thrown inside a service goes through the shared error handler,
    // which sends `{ success: false, message }`. Reading only one of them left
    // the customer looking at "This link can't be used" with no reason under
    // it — which is precisely the case where the reason matters most.
    const reason = body?.error || body?.message
    throw new ApiError(reason || `Request failed (${res.status}). Please try again.`, res.status)
  }
  return body?.data ?? body
}

/** Authenticated POST. `api.ts` only offers GET, and it is a protected file. */
async function portalPost<T>(path: string, payload?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${PORTAL}${path}`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(auth.getToken() ? { Authorization: `Bearer ${auth.getToken()}` } : {}),
      },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    })
  } catch {
    throw new ApiError('Could not reach the server. Check your connection and try again.', 0)
  }
  if (res.status === 401 || res.status === 403) {
    auth.signOut()
    throw new ApiError('Your session has expired. Please sign in again.', res.status)
  }
  return readBody(res) as Promise<T>
}

/* ── Signed-in customer ─────────────────────────────────────────────────── */

export interface InvoiceSummary {
  id: string
  invoiceNumber: string
  status: string
  issueDate: string | null
  dueDate: string | null
  total: number
  amountPaid: number
  balanceDue: number
  currency: string
  paymentTerms: string | null
  orderId: string | null
  orderNumber: string | null
  orderStatus: string | null
  payable: boolean
}

export interface InvoiceLine {
  id: string
  description: string | null
  qty: number
  unitPrice: number
  amount: number
  sizes: string | null
  colors: string | null
}

export interface InvoiceDetail extends InvoiceSummary {
  subtotal: number
  discount: number
  tax: number
  rush: number
  shipping: number
  billTo: { name: string | null; email: string | null; phone: string | null; address: string | null }
  shipTo: string | null
  notes: string | null
  order: {
    id: string
    number: string | null
    date: string | null
    dueDate: string | null
    type: string | null
    status: string | null
    paymentStatus: string | null
    shippingName: string | null
    trackingNumber: string | null
    courier: string | null
  } | null
  items: InvoiceLine[]
}

/** Ask for a pay link and get back the URL to send the customer to. */
export const createPayLink = (invoiceId: string) =>
  portalPost<{ url: string; reissued: boolean }>(`/invoices/${invoiceId}/pay-link`)

/* ── Pay page (no session) ──────────────────────────────────────────────── */

export interface PayLinkView {
  invoiceNumber: string
  orderNumber: string | null
  customerName: string | null
  amount: number
  currency: string
  issueDate: string | null
  dueDate: string | null
  expiresAt: string | null
  publishableKey: string
  testMode: boolean
}

export async function fetchPayLink(token: string): Promise<PayLinkView> {
  const res = await fetch(`${PAY}/${encodeURIComponent(token)}`, { headers: { Accept: 'application/json' } })
  return readBody(res)
}

export async function createPaymentIntent(token: string): Promise<{ clientSecret: string }> {
  const res = await fetch(`${PAY}/${encodeURIComponent(token)}/intent`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
  })
  return readBody(res)
}

export interface PayStatus {
  paid: boolean
  linkStatus: string
  invoiceNumber: string | null
  amount: number
  currency: string
  paidAt: string | null
}

export async function fetchPayStatus(token: string): Promise<PayStatus> {
  const res = await fetch(`${PAY}/${encodeURIComponent(token)}/status`, { headers: { Accept: 'application/json' } })
  return readBody(res)
}

/* ── Shared ─────────────────────────────────────────────────────────────── */

export const INVOICE_TONE: Record<string, string> = {
  Paid: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  Sent: 'bg-sky-50 text-sky-700 ring-sky-600/20',
  Overdue: 'bg-rose-50 text-rose-700 ring-rose-600/20',
  'Partially Paid': 'bg-amber-50 text-amber-700 ring-amber-600/20',
  Void: 'bg-slate-100 text-slate-600 ring-slate-500/20',
}
