/**
 * How a Stripe charge was paid, as the method's name only: "Card", "Apple Pay",
 * "Google Pay", "Link", "Cash App Pay", "Bank (ACH)".
 *
 * No card or account number, no last four digits, no brand — the owner, 15 Sep
 * 2026: the method is enough. Read from the charge's payment_method_details.
 * Never throws: an unexpected shape gives null, and the payment is recorded all
 * the same.
 */
const WALLETS = {
  apple_pay: 'Apple Pay', google_pay: 'Google Pay', samsung_pay: 'Samsung Pay', link: 'Link',
  amex_express_checkout: 'Amex Express Checkout', masterpass: 'Masterpass', visa_checkout: 'Visa Checkout',
}
const TYPES = {
  card: 'Card', link: 'Link', us_bank_account: 'Bank (ACH)', cashapp: 'Cash App Pay', klarna: 'Klarna',
  affirm: 'Affirm', afterpay_clearpay: 'Afterpay', amazon_pay: 'Amazon Pay', paypal: 'PayPal',
  revolut_pay: 'Revolut Pay', zip: 'Zip', customer_balance: 'Bank transfer', ach_credit_transfer: 'Bank transfer',
}
const words = value => String(value).split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')

function describePaidVia(charge) {
  try {
    const details = charge && typeof charge === 'object' ? charge.payment_method_details : null
    if (!details || !details.type) return null
    if (details.type === 'card') {
      // A wallet pays with a card underneath; the wallet is what the customer chose.
      const wallet = details.card && details.card.wallet && details.card.wallet.type
      return wallet ? (WALLETS[wallet] || words(wallet)) : 'Card'
    }
    return (TYPES[details.type] || words(details.type)).slice(0, 120)
  } catch {
    return null
  }
}

module.exports = { describePaidVia }
