import { useEffect, useState } from 'react'
import { Minus, Plus, Snowflake } from 'lucide-react'
import '../styles/column-freeze.css'

/**
 * How many of a grid's first columns stay put while it scrolls sideways — a
 * number the user types (or steps with − / +) in the filter bar, from 0 for
 * none up to every column on show. Works with the `frozenCount`,
 * `frozenShown` and `setFrozenCount` that hooks/useColumnDrag hands back.
 *
 * When the screen is too narrow for all of them the grid freezes fewer, and
 * the field says so rather than quietly ignoring the number.
 */
export function ColumnFreezeField({
  value, max, shown, onChange, label = 'Freeze Columns', className = 'cf-field',
}: {
  value: number
  max: number
  shown: number
  onChange: (n: number) => void
  label?: string
  // 'cf-field' carries its own caption style; list pages whose filters are
  // 'leads-filter' pass that so the caption matches the fields beside it.
  className?: string
}) {
  // What is typed, kept apart from the number in force so the field can be
  // cleared on the way to typing a new one.
  const [draft, setDraft] = useState(String(value))
  useEffect(() => { setDraft(String(value)) }, [value])

  const apply = (n: number) => onChange(Math.max(0, Math.min(n, max)))
  const clipped = value > 0 && shown < value

  return (
    <div className={className}>
      <span>{label}</span>
      <div className="cf-stepper" title={`Keep the first ${value} column${value === 1 ? '' : 's'} in place while the grid scrolls`}>
        <Snowflake size={13} className="cf-icon" aria-hidden />
        <button type="button" className="cf-step" aria-label="Freeze one column fewer"
          disabled={value <= 0} onClick={() => apply(value - 1)}><Minus size={13} /></button>
        <input className="cf-input" type="number" inputMode="numeric" min={0} max={max} step={1}
          aria-label={label} value={draft}
          onChange={e => {
            setDraft(e.target.value)
            const n = Number(e.target.value)
            if (e.target.value !== '' && Number.isInteger(n)) apply(n)
          }}
          onBlur={() => setDraft(String(value))}
          onKeyDown={e => {
            if (e.key === 'ArrowUp') { e.preventDefault(); apply(value + 1) }
            if (e.key === 'ArrowDown') { e.preventDefault(); apply(value - 1) }
          }} />
        <button type="button" className="cf-step" aria-label="Freeze one column more"
          disabled={value >= max} onClick={() => apply(value + 1)}><Plus size={13} /></button>
      </div>
      {clipped && <small className="cf-note">{shown} fit on this screen</small>}
    </div>
  )
}
