// One list of payment methods for the payment form and the sales order form.
//
// A sales order's method is its payment's — migration 137 holds the two equal —
// so both forms offer the same names. The order form used to store codes
// ('zelle', 'bank_transfer', 'other') and had no Shopify, Cash App, Venmo or
// Apple Pay to choose, which is how 53 paid orders came to read "other".
export const PAYMENT_METHODS = [
  'Zelle', 'PayPal', 'Stripe', 'Shopify', 'Cash App', 'Venmo', 'Apple Pay',
  'Bank Transfer', 'Bank Deposit', 'Credit Card', 'Cash', 'Cheque', 'Other',
] as const

export const isListedPaymentMethod = (value: string) =>
  (PAYMENT_METHODS as readonly string[]).includes(value)

// Old codes and loose spellings, read as the name the lists use.
const NAMES: Record<string, string> = {
  zelle: 'Zelle', paypal: 'PayPal', stripe: 'Stripe', shopify: 'Shopify',
  cashapp: 'Cash App', venmo: 'Venmo', applepay: 'Apple Pay',
  banktransfer: 'Bank Transfer', bankdeposit: 'Bank Deposit',
  creditcard: 'Credit Card', card: 'Credit Card', cash: 'Cash', cheque: 'Cheque', check: 'Cheque', other: 'Other',
}
export function paymentMethodName(value?: string | null): string {
  const raw = String(value ?? '').trim()
  if (!raw) return ''
  return NAMES[raw.toLowerCase().replace(/[\s_-]+/g, '')] ?? raw
}
