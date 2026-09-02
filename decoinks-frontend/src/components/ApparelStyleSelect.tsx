import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, Package, Search } from 'lucide-react'
import toast from '../utils/toast'
import { api } from '../services/api'
import type { ApparelCatalogStyle } from './ApparelCatalogPicker'

/**
 * The style code, chosen on the line it belongs to.
 *
 * A single search box above the table could only ever add a new row, so a line
 * already typed out had no way to gain a style. This sits in the row's own
 * Style cell: open it, find the code, and the item name, colours and sizes fill
 * in on that line.
 *
 * index.css is protected, so the styling is inline.
 *
 * The panel is rendered into the document body rather than beside the button.
 * The row lives inside a table that scrolls sideways, and a scroll container
 * clips whatever overflows it — anchored to the cell, the list was sliced off
 * after the first style. Anchored to the viewport instead, it opens in full.
 */

const BTN: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6, width: '100%', minWidth: 132,
  padding: '5px 8px', border: '1px solid #d7dde5', borderRadius: 6,
  background: '#fff', font: 'inherit', fontSize: 12.5, cursor: 'pointer',
  color: '#111827', textAlign: 'left',
}
const PANEL: React.CSSProperties = {
  position: 'fixed', zIndex: 4000, width: 210, maxHeight: 300,
  overflow: 'hidden', display: 'flex',
  flexDirection: 'column', background: '#fff', border: '1px solid #d7dde5',
  borderRadius: 8, boxShadow: '0 12px 30px rgba(15,23,42,.16)',
}
const ROW: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '7px 10px',
  border: 0, borderBottom: '1px solid #f1f4f8', background: 'none', font: 'inherit',
  fontSize: 12.5, cursor: 'pointer', textAlign: 'left',
}

export function ApparelStyleSelect({
  value, disabled = false, onSelect,
}: {
  value?: string
  disabled?: boolean
  onSelect: (style: ApparelCatalogStyle) => void
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState('')
  const [at, setAt] = useState<{ top: number; left: number }>({ top: 0, left: 0 })
  const box = useRef<HTMLDivElement>(null)
  const panel = useRef<HTMLDivElement>(null)

  // Every apparel style, once. The list is small enough to filter in the
  // browser, so typing does not wait on the network.
  const { data: styles = [], isLoading } = useQuery<ApparelCatalogStyle[]>({
    queryKey: ['apparel-styles-all'],
    queryFn: () => api.get('/products', { params: { page: 1, limit: 500, product_type: 'Apparel' } })
      .then(r => r.data.data?.rows ?? []),
    staleTime: 5 * 60 * 1000,
  })

  // The panel is no longer a descendant of the button, so a click inside it
  // would otherwise read as a click away.
  useEffect(() => {
    const away = (e: MouseEvent) => {
      const t = e.target as Node
      if (box.current?.contains(t) || panel.current?.contains(t)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [])

  // Anchored to the viewport, the panel has to be told where the button went.
  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const r = box.current?.getBoundingClientRect()
      if (!r) return
      const H = 300, W = 210
      const below = window.innerHeight - r.bottom
      setAt({
        top: below < H + 8 && r.top > below ? Math.max(8, r.top - H - 4) : r.bottom + 4,
        left: Math.max(8, Math.min(r.left, window.innerWidth - W - 8)),
      })
    }
    place()
    // Scrolling the table sideways moves the button out from under the panel.
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [open])

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return styles
    return styles.filter(s =>
      [s.sku, s.name, s.brand].filter(Boolean).some(v => String(v).toLowerCase().includes(q)))
  }, [styles, search])

  const choose = async (style: ApparelCatalogStyle) => {
    setBusy(style.id)
    try {
      // The list row carries the name, brand, code and image but no colours or
      // sizes; the detail call brings those.
      const detail = (await api.get(`/products/${style.id}`)).data.data as ApparelCatalogStyle
      onSelect(detail)
    } catch (err: any) {
      // Take the style anyway. The line keeps the name, brand and code it can
      // already see, and only the colour and size lists are missing — far better
      // than a click that appears to do nothing.
      onSelect({ ...style, colors: [], sizes: [], variants: [] })
      const why = err?.response?.status === 401 || err?.response?.status === 302
        ? 'your session has ended — sign in again'
        : err?.response?.data?.message || 'could not reach the catalogue'
      toast.error(`${style.sku} added, but its colours and sizes did not load: ${why}`)
    } finally {
      setBusy('')
      setOpen(false)
      setSearch('')
    }
  }

  return (
    <div ref={box} style={{ position: 'relative' }}>
      <button type="button" disabled={disabled} style={{ ...BTN, opacity: disabled ? .55 : 1 }}
        onClick={() => setOpen(o => !o)} aria-haspopup="listbox" aria-expanded={open}>
        <Package size={13} style={{ flex: '0 0 auto', color: '#6b7280' }} />
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                       color: value ? '#111827' : '#9ca3af', fontWeight: value ? 600 : 400 }}>
          {value || 'Select style'}
        </span>
        <ChevronDown size={13} style={{ flex: '0 0 auto', color: '#6b7280' }} />
      </button>

      {open && !disabled && createPortal(
        <div ref={panel} style={{ ...PANEL, top: at.top, left: at.left }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 10px',
                        borderBottom: '1px solid #e8edf3' }}>
            <Search size={13} style={{ color: '#6b7280' }} />
            <input autoFocus value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Style code, name or brand…"
              style={{ flex: 1, border: 0, outline: 'none', font: 'inherit', fontSize: 12.5 }} />
          </div>
          <div style={{ overflowY: 'auto' }}>
            {isLoading && <div style={{ padding: '10px', fontSize: 12, color: '#6b7280' }}>Loading…</div>}
            {!isLoading && shown.length === 0 &&
              <div style={{ padding: '10px', fontSize: 12, color: '#6b7280' }}>No matching style.</div>}
            {shown.map(s => (
              // The code alone. Everything else about the style lands on the
              // line the moment it is picked, so repeating it here is noise.
              <button type="button" key={s.id} style={ROW} disabled={busy === s.id}
                onMouseDown={() => choose(s)}>
                <strong style={{ fontSize: 12.5 }}>{s.sku}</strong>
              </button>
            ))}
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}
