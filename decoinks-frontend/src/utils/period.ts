// Shared date-period presets used by every list page (Leads, Customers,
// Quotes, Invoices, Sales Orders, Purchase Orders, Payments, Shipments) so the
// quick-range tabs behave identically everywhere.

export type PeriodKey =
  | 'today' | 'week' | 'month' | 'quarter' | 'year' | 'custom' | 'all'
  | 'yesterday' | 'last5' | 'last15' | 'last30' | 'last45' | 'last60'

export const PERIOD_TABS: ReadonlyArray<readonly [PeriodKey, string]> = [
  ['today', 'Today'],
  ['week', 'This Week'],
  ['month', 'This Month'],
  ['quarter', 'This Quarter'],
  ['year', 'This Year'],
  ['custom', 'Custom'],
  ['all', 'All Time'],
]

// The rolling ranges. They are a dropdown rather than seven more tabs because
// the row is already full, and because these are the ones reached for now and
// then rather than every time.
export const RECENT_PERIODS: ReadonlyArray<readonly [PeriodKey, string]> = [
  ['yesterday', 'Yesterday'],
  ['last5', 'Last 5 days'],
  ['last15', 'Last 15 days'],
  ['last30', 'Last 30 days'],
  ['last45', 'Last 45 days'],
  ['last60', 'Last 60 days'],
]

// How many days back each rolling range starts. Yesterday is the odd one: it is
// a single day, not a window ending today, and is handled on its own below.
const DAYS_BACK: Partial<Record<PeriodKey, number>> = {
  last5: 5, last15: 15, last30: 30, last45: 45, last60: 60,
}

export const isRecentPeriod = (p: PeriodKey) =>
  p === 'yesterday' || p in DAYS_BACK

export const periodLabel = (p: PeriodKey) =>
  [...PERIOD_TABS, ...RECENT_PERIODS].find(([k]) => k === p)?.[1] ?? ''

// Local-time YYYY-MM-DD (never UTC — avoids off-by-one at day boundaries).
export const toIsoDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

// Resolve a preset to an inclusive [from, to] pair. 'all' → ['','']; 'custom'
// echoes the caller's own dates. Quarter = start of the current 3-month block;
// Year = Jan 1.
export function periodRange(period: PeriodKey, from = '', to = ''): [string, string] {
  if (period === 'all') return ['', '']
  if (period === 'custom') return [from, to]

  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())

  // Yesterday is one day, both ends. A window ending today would include today,
  // which is the one day someone asking for yesterday does not want.
  if (period === 'yesterday') {
    const d = new Date(today)
    d.setDate(today.getDate() - 1)
    return [toIsoDate(d), toIsoDate(d)]
  }

  const back = DAYS_BACK[period]
  if (back !== undefined) {
    const start = new Date(today)
    start.setDate(today.getDate() - back)
    return [toIsoDate(start), toIsoDate(today)]
  }

  const start = new Date(today)
  // Calendar week starts on Monday (Sunday belongs to the week ending today).
  if (period === 'week') start.setDate(now.getDate() - ((now.getDay() + 6) % 7))
  else if (period === 'month') start.setDate(1)
  else if (period === 'quarter') { start.setMonth(Math.floor(now.getMonth() / 3) * 3); start.setDate(1) }
  else if (period === 'year') { start.setMonth(0); start.setDate(1) }
  return [toIsoDate(start), toIsoDate(today)]
}
