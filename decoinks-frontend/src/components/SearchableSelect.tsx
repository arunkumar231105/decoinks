import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, Search } from 'lucide-react'

/**
 * A dropdown you can type into.
 *
 * A plain <select> of a hundred-odd customers has to be scrolled by eye, and
 * the name you want is always the one below the fold. This opens with a search
 * box already focused: type a few letters, arrow down, Enter. Accents are
 * ignored, so "alheli" finds "Alhelí AR".
 *
 * The panel is rendered into the document body rather than under the field, so
 * a card or scroll container around the form cannot clip it. index.css is
 * protected, so the styling is inline; the closed field keeps whatever class
 * the form already uses for its inputs, so it looks like its neighbours.
 */

export interface SearchableOption { value: string; label: string }

const fold = (s: string) =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()

const PANEL: React.CSSProperties = {
  position: 'fixed', zIndex: 4000, maxHeight: 340, display: 'flex', flexDirection: 'column',
  background: '#fff', border: '1px solid #d7dde5', borderRadius: 8,
  boxShadow: '0 12px 30px rgba(15,23,42,.16)', overflow: 'hidden',
}
const ROW: React.CSSProperties = {
  display: 'block', width: '100%', padding: '8px 12px', border: 0, background: 'none',
  font: 'inherit', fontSize: 14, textAlign: 'left', cursor: 'pointer', color: '#111827',
}

export function SearchableSelect({
  value, options, onChange,
  placeholder = '— Select —', searchPlaceholder = 'Search…', className = 'al-input', disabled = false,
}: {
  value: string
  options: SearchableOption[]
  onChange: (value: string) => void
  placeholder?: string
  searchPlaceholder?: string
  className?: string
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [active, setActive] = useState(0)
  const [at, setAt] = useState({ top: 0, left: 0, width: 0 })
  const box = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLDivElement>(null)

  const selected = options.find(o => o.value === value)

  // The empty choice leads the list only while nothing is typed; once searching,
  // every row is a match and Enter should take the first one.
  const rows = useMemo(() => {
    const q = fold(search)
    const hits = q ? options.filter(o => fold(o.label).includes(q)) : options
    return q ? hits : [{ value: '', label: placeholder }, ...hits]
  }, [options, search, placeholder])

  useEffect(() => { setActive(0) }, [search, open])

  // Anchored to the viewport, and kept there while the page scrolls under it.
  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const r = box.current?.getBoundingClientRect()
      if (!r) return
      const below = window.innerHeight - r.bottom
      const top = below < 300 && r.top > below ? Math.max(8, r.top - 344) : r.bottom + 4
      setAt({ top, left: r.left, width: r.width })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open])

  // A click anywhere else closes it.
  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent) => {
      const t = e.target as Node
      if (!box.current?.contains(t) && !panel.current?.contains(t)) setOpen(false)
    }
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [open])

  // Keep the highlighted row in view as the arrows walk the list.
  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-row="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const choose = (v: string) => { onChange(v); setOpen(false); setSearch(''); box.current?.focus() }

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, rows.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); if (rows[active]) choose(rows[active].value) }
    else if (e.key === 'Escape' || e.key === 'Tab') { setOpen(false); setSearch('') }
  }

  return (
    <>
      <button
        ref={box}
        type="button"
        className={className}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        onKeyDown={e => { if (!open && (e.key === 'ArrowDown' || e.key === 'Enter')) { e.preventDefault(); setOpen(true) } }}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                 width: '100%', textAlign: 'left', cursor: disabled ? 'not-allowed' : 'pointer' }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                       color: selected ? undefined : '#6b7280' }}>
          {selected?.label ?? placeholder}
        </span>
        <ChevronDown size={16} style={{ flex: '0 0 auto', color: '#6b7280' }} />
      </button>

      {open && createPortal(
        <div ref={panel} style={{ ...PANEL, top: at.top, left: at.left, width: at.width }} role="listbox">
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px',
                          borderBottom: '1px solid #eef1f5', color: '#6b7280' }}>
            <Search size={15} />
            <input
              autoFocus
              value={search}
              placeholder={searchPlaceholder}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={onKey}
              style={{ flex: 1, border: 0, outline: 0, font: 'inherit', fontSize: 14, color: '#111827', background: 'none' }}
            />
          </label>
          <div ref={list} style={{ overflowY: 'auto' }}>
            {rows.length === 0 && (
              <div style={{ padding: '12px', fontSize: 13.5, color: '#6b7280' }}>No customer matches "{search}"</div>
            )}
            {rows.map((o, i) => (
              <button
                key={o.value || '__none'}
                type="button"
                data-row={i}
                role="option"
                aria-selected={o.value === value}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(o.value)}
                style={{
                  ...ROW,
                  background: i === active ? '#eff6ff' : o.value === value ? '#f8fafc' : 'none',
                  color: o.value ? '#111827' : '#6b7280',
                  fontWeight: o.value === value && o.value ? 650 : 400,
                }}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}
