import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, EyeOff } from 'lucide-react'
import '../styles/column-hide.css'

/**
 * Hide and show a grid's columns from its filter bar.
 *
 * Every column is listed; ticking one hides it from the grid, unticking brings
 * it back. The last visible column cannot be hidden. Works with the `hidden`,
 * `toggleHidden` and `showAll` that hooks/useColumnDrag hands back.
 *
 * The list opens in a panel drawn into the document body, so a filter bar that
 * scrolls or clips its contents cannot cut it off.
 */
export function ColumnHideMenu({
  columns, hidden, onToggle, onShowAll,
  label = 'Hide Columns', variant = 'field', wrapperClassName, buttonClassName,
}: {
  columns: { key: string; label: string }[]
  hidden: Set<string>
  onToggle: (key: string) => void
  onShowAll: () => void
  label?: string
  // 'field' sits in a filter row with a small caption above it, like the
  // selects beside it; 'button' is a toolbar button.
  variant?: 'field' | 'button'
  wrapperClassName?: string
  buttonClassName?: string
}) {
  const [open, setOpen] = useState(false)
  const [at, setAt] = useState({ top: 0, left: 0 })
  const trigger = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const count = columns.filter(c => hidden.has(c.key)).length
  const shown = columns.length - count

  const place = () => {
    const box = trigger.current?.getBoundingClientRect()
    if (!box) return
    const width = 270
    setAt({ top: box.bottom + 6, left: Math.max(8, Math.min(box.left, window.innerWidth - width - 8)) })
  }
  useLayoutEffect(() => { if (open) place() }, [open])
  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent) => {
      const target = e.target as Node
      if (!panel.current?.contains(target) && !trigger.current?.contains(target)) setOpen(false)
    }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', key)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      document.removeEventListener('mousedown', away)
      document.removeEventListener('keydown', key)
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open])

  const button = (
    <button type="button" ref={trigger} aria-expanded={open} onClick={() => setOpen(v => !v)}
      className={variant === 'field' ? 'ch-trigger' : buttonClassName}>
      <EyeOff size={14} />
      <span>{variant === 'field' ? (count ? `${count} hidden` : 'None hidden') : label}</span>
      {variant === 'button' && count > 0 && <b className="ch-count">{count}</b>}
      <ChevronDown size={14} />
    </button>
  )

  return <>
    {variant === 'field'
      ? <div className={wrapperClassName ?? 'ch-field'}><span>{label}</span>{button}</div>
      : button}
    {open && createPortal(
      <div ref={panel} className="ch-panel" style={{ top: at.top, left: at.left }} role="dialog" aria-label={label}>
        <header>
          <strong>{label}</strong>
          <button type="button" onClick={onShowAll} disabled={!count}>Show all</button>
        </header>
        <p>Tick a column to hide it from the grid; untick it to bring it back.</p>
        <div className="ch-list">
          {columns.map(c => {
            const isHidden = hidden.has(c.key)
            return (
              <label key={c.key} className={isHidden ? 'is-hidden' : ''}>
                <input type="checkbox" checked={isHidden} disabled={!isHidden && shown <= 1}
                  onChange={() => onToggle(c.key)} />
                <span>{c.label}</span>
              </label>
            )
          })}
        </div>
      </div>,
      document.body,
    )}
  </>
}
