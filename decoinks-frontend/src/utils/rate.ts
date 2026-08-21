// A per-unit RATE is quoted finer than a cent — 2.037 per transfer is a real
// price, not a rounding artefact. Money formatters cut everything to two
// decimals, so a rate printed through them read as $2.04 while the stored value
// and the line amount ($10.18 for five) said otherwise.
//
// Two decimals stay the norm; more show only when the rate carries more:
// 2 → "2.00", 2.04 → "2.04", 2.037 → "2.037", 2.0370 → "2.037".
//
// Only for rates. Amounts, subtotals and totals are money and stay on two
// decimals — a customer is billed whole cents.
const OPTS = { minimumFractionDigits: 2, maximumFractionDigits: 4 } as const

export const rate = (value: unknown, empty = '0.00'): string => {
  if (value === null || value === undefined || value === '') return empty
  const n = Number(value)
  if (!Number.isFinite(n)) return empty
  return n.toLocaleString('en-US', OPTS)
}

// Same precision, but carrying the document's currency symbol.
export const rateIn = (value: unknown, currency = 'USD'): string => {
  const n = Number(value ?? 0) || 0
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency, ...OPTS }).format(n)
  } catch {
    return `$${rate(n)}`
  }
}
