import { PERIOD_TABS, RECENT_PERIODS, isRecentPeriod, type PeriodKey } from '../utils/period'

/**
 * The quick-range row every list page shares.
 *
 * The seven tabs are calendar periods — today, this week, this month. The
 * dropdown beside them holds the rolling ones: yesterday, and the last 5, 15,
 * 30, 45 or 60 days. They are a dropdown because the tab row is already full,
 * and because a rolling range is reached for now and then rather than every
 * time. Picking one clears the tabs, and picking a tab clears it, so only one
 * range is ever in force and the row cannot lie about what is on screen.
 *
 * `className` lets each page keep the class its own stylesheet already styles
 * — the workflow pages use ew-period, the leads-style pages leads-period — so
 * this changes what the row contains without changing how any page looks.
 */
export function PeriodTabs({
  period, onChange, className = 'leads-period',
}: {
  period: PeriodKey
  onChange: (p: PeriodKey) => void
  className?: string
}) {
  const recent = isRecentPeriod(period)

  return (
    <nav className={className} role="group" aria-label="Date period">
      {PERIOD_TABS.map(([value, label]) => (
        <button key={value} className={period === value ? 'active' : ''}
          onClick={() => onChange(value)}>
          {label}
        </button>
      ))}

      <select
        aria-label="Rolling date range"
        className={recent ? 'active' : ''}
        value={recent ? period : ''}
        onChange={e => { if (e.target.value) onChange(e.target.value as PeriodKey) }}
        style={{
          height: 34, marginLeft: 6, padding: '0 10px',
          border: `1px solid ${recent ? '#2563eb' : '#e2e8f0'}`,
          borderRadius: 8,
          background: recent ? '#2563eb' : '#fff',
          color: recent ? '#fff' : '#334155',
          font: 'inherit', fontSize: 13.5, fontWeight: 650,
          cursor: 'pointer', maxWidth: 150,
        }}
      >
        <option value="">Recent…</option>
        {RECENT_PERIODS.map(([value, label]) => (
          <option key={value} value={value} style={{ color: '#0f172a', background: '#fff' }}>
            {label}
          </option>
        ))}
      </select>
    </nav>
  )
}
