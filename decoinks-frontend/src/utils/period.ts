// Shared date-period presets used by every list page (Leads, Customers,
// Quotes, Invoices, Sales Orders, Purchase Orders) so the quick-range tabs
// behave identically everywhere.

export type PeriodKey = 'today' | 'week' | 'month' | 'quarter' | 'year' | 'custom' | 'all'

export const PERIOD_TABS: ReadonlyArray<readonly [PeriodKey, string]> = [
  ['today', 'Today'],
  ['week', 'This Week'],
  ['month', 'This Month'],
  ['quarter', 'This Quarter'],
  ['year', 'This Year'],
  ['custom', 'Custom'],
  ['all', 'All Time'],
]

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
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  if (period === 'week') start.setDate(now.getDate() - 6)
  else if (period === 'month') start.setDate(1)
  else if (period === 'quarter') { start.setMonth(Math.floor(now.getMonth() / 3) * 3); start.setDate(1) }
  else if (period === 'year') { start.setMonth(0); start.setDate(1) }
  return [toIsoDate(start), toIsoDate(now)]
}
