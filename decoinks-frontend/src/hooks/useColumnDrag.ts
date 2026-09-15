import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent } from 'react'
import { useAuthStore } from '../store/authStore'
import '../styles/column-drag.css'

// A grid's layout as this browser remembers it for one user: the column order,
// the hidden columns and how many are frozen. Anything unreadable — an old
// shape, a column since removed — is dropped rather than trusted.
const LAYOUT_PREFIX = 'decoinks:grid-layout:'
type SavedLayout = { order?: unknown; hidden?: unknown; frozen?: unknown }
function readLayout(key: string | null): SavedLayout | null {
  if (!key) return null
  try {
    const raw = localStorage.getItem(key)
    const saved = raw ? JSON.parse(raw) : null
    return saved && typeof saved === 'object' ? saved as SavedLayout : null
  } catch {
    return null
  }
}

/**
 * Columns a grid's user can drag into any order by their headers.
 *
 *   - While a header is dragged the others slide aside to make room (each
 *     column's cells are animated from where they were to where they now are).
 *   - The first `frozenCount` columns stay put while the grid scrolls
 *     sideways, whichever columns they are after a drag. The page gives the
 *     starting number (`frozen`; 0 for none) and the user changes it from the
 *     filter bar (`setFrozenCount`, components/ColumnFreezeField). Where each
 *     one ends is measured from the header as drawn, so any widths work; on a
 *     narrow screen fewer are frozen, so the frozen block never takes more than
 *     ~70% of the grid — `frozenShown` says how many actually are. The last
 *     frozen column carries a line on its right edge, which turns blue while
 *     the grid is scrolled sideways, and the frozen block flashes when the
 *     number changes, so the user sees where the still part ends.
 *   - Columns can be hidden and shown again (`toggleHidden`, `showAll`); the
 *     page draws `visible`, which is `order` less the hidden ones. At least one
 *     column always stays.
 *   - With a `storageKey` the layout is remembered — order, hidden columns and
 *     the frozen number — for the signed-in user in this browser, and comes
 *     back after a refresh or a redeploy until the user changes it again.
 *     `resetLayout` returns to the page's own; `customised` says whether there
 *     is anything to reset. A column added to the page later appears at the
 *     end; one removed is forgotten. Without a key nothing is kept.
 *
 * A page renders its columns in `visible`, spreads `headProps(key, i)` on each
 * header cell and `cellProps(key, i)` on each body cell, and puts `tableRef` on
 * the <table>. `i` is the column's position among the ones shown.
 */
export function useColumnDrag(
  keys: string[],
  { frozen = 3, cellBackground, headBackground, storageKey }: {
    frozen?: number
    // Names the grid whose layout is remembered, e.g. 'purchase-orders'.
    storageKey?: string
    // Set when the table paints its row colour on the <tr> rather than the
    // cells: a frozen cell must be opaque or the scrolled cells show through.
    cellBackground?: string
    headBackground?: string
  } = {},
) {
  const signature = keys.join('|')
  const userId = useAuthStore(state => state.user?.id)
  const layoutKey = storageKey ? `${LAYOUT_PREFIX}${userId ?? 'signed-out'}:${storageKey}` : null

  // The layout the grid opens in: the one this user left it in, else the page's own.
  const startingLayout = () => {
    const saved = readLayout(layoutKey)
    const known = new Set(keys)
    const names = (value: unknown) =>
      Array.isArray(value) ? value.filter((k): k is string => typeof k === 'string' && known.has(k)) : []
    const savedOrder = names(saved?.order)
    const savedHidden = names(saved?.hidden)
    return {
      order: savedOrder.length ? savedOrder : keys,
      // At least one column always stays on show.
      hidden: new Set(savedHidden.length < keys.length ? savedHidden : []),
      frozen: typeof saved?.frozen === 'number' && Number.isFinite(saved.frozen)
        ? Math.max(0, Math.trunc(saved.frozen)) : frozen,
    }
  }
  const [stored, setStored] = useState<string[]>(() => startingLayout().order)
  const [hidden, setHidden] = useState<Set<string>>(() => startingLayout().hidden)
  const [frozenWanted, setFrozenWanted] = useState(() => startingLayout().frozen)

  // Only what the user does is written back — opening a grid is not a change,
  // so a grid nobody has touched keeps following the page's own defaults.
  const touched = useRef(false)
  // Another grid, another user, or a page whose columns changed: load its layout.
  const loadedFor = useRef(`${layoutKey}|${signature}|${frozen}`)
  useEffect(() => {
    const id = `${layoutKey}|${signature}|${frozen}`
    if (loadedFor.current === id) return
    loadedFor.current = id
    touched.current = false
    const next = startingLayout()
    setStored(next.order)
    setHidden(next.hidden)
    setFrozenWanted(next.frozen)
  }, [layoutKey, signature, frozen]) // eslint-disable-line react-hooks/exhaustive-deps

  const order = useMemo(() => {
    const known = new Set(keys)
    return [...stored.filter(k => known.has(k)), ...keys.filter(k => !stored.includes(k))]
  }, [stored, signature]) // eslint-disable-line react-hooks/exhaustive-deps

  const visible = useMemo(() => order.filter(k => !hidden.has(k)), [order, hidden])
  const toggleHidden = (key: string) => {
    touched.current = true
    setHidden(current => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else if (keys.length - next.size > 1) next.add(key)
      return next
    })
  }
  const showAll = () => { touched.current = true; setHidden(new Set()) }

  useEffect(() => {
    if (!layoutKey || !touched.current) return
    try {
      localStorage.setItem(layoutKey, JSON.stringify({ order, hidden: [...hidden], frozen: frozenWanted }))
    } catch {
      // Storage full or blocked: the layout still applies, it just is not kept.
    }
  }, [layoutKey, order, hidden, frozenWanted])

  const [dragKey, setDragKey] = useState<string | null>(null)
  const tableRef = useRef<HTMLTableElement>(null)
  const before = useRef<Map<string, number> | null>(null)

  const columnCells = (table: HTMLTableElement, key: string) =>
    Array.from(table.querySelectorAll<HTMLElement>('[data-col]')).filter(el => el.dataset.col === key)

  // Where every header is now, taken just before the order changes, so the
  // columns can be slid from there to their new place.
  const snapshot = () => {
    const table = tableRef.current
    if (!table) return
    const at = new Map<string, number>()
    table.querySelectorAll<HTMLElement>('thead [data-col]').forEach(th => at.set(th.dataset.col!, th.offsetLeft))
    before.current = at
  }

  useLayoutEffect(() => {
    const table = tableRef.current
    const was = before.current
    before.current = null
    if (!table || !was) return
    const moved: HTMLElement[] = []
    table.querySelectorAll<HTMLElement>('thead [data-col]').forEach(th => {
      const key = th.dataset.col!
      const dx = (was.get(key) ?? th.offsetLeft) - th.offsetLeft
      if (!dx) return
      for (const el of columnCells(table, key)) {
        el.style.transition = 'none'
        el.style.transform = `translateX(${dx}px)`
        moved.push(el)
      }
    })
    if (!moved.length) return
    void table.offsetWidth                      // commit the start position
    for (const el of moved) {
      el.style.transition = 'transform 220ms cubic-bezier(.2,.8,.2,1)'
      el.style.transform = ''
    }
  }, [order])

  const move = (from: string, to: string) => {
    const next = [...order]
    const target = next.indexOf(to), source = next.indexOf(from)
    if (target < 0 || source < 0 || from === to) return
    next.splice(source, 1)
    next.splice(target, 0, from)
    snapshot()
    touched.current = true
    setStored(next)
  }

  const customised = order.join('|') !== signature || hidden.size > 0 || frozenWanted !== frozen
  const resetLayout = () => {
    touched.current = false
    if (layoutKey) {
      try { localStorage.removeItem(layoutKey) } catch { /* nothing kept to remove */ }
    }
    snapshot()
    flashAsked.current = Date.now()
    setStored(keys)
    setHidden(new Set())
    setFrozenWanted(frozen)
  }

  // ── Frozen columns ────────────────────────────────────────────────────────
  // Never more than the columns on show: hiding columns lowers it with them.
  const frozenCount = Math.max(0, Math.min(frozenWanted, visible.length))
  // A change the user makes flashes the frozen block once it is drawn.
  const flashAsked = useRef(0)
  const flashTimer = useRef<number | undefined>(undefined)
  const setFrozenCount = (n: number) => {
    touched.current = true
    flashAsked.current = Date.now()
    setFrozenWanted(Number.isFinite(n) ? Math.max(0, Math.min(Math.trunc(n), visible.length)) : 0)
  }

  const [lefts, setLefts] = useState<number[]>([])
  useLayoutEffect(() => {
    const table = tableRef.current
    if (!table) return
    const measure = () => {
      const heads = Array.from(table.querySelectorAll<HTMLElement>('thead tr:first-child > th'))
      const first = heads.findIndex(th => th.dataset.col)
      if (first < 0) return
      let x = heads.slice(0, first).reduce((w, th) => w + th.offsetWidth, 0)
      const budget = (table.parentElement?.clientWidth || window.innerWidth) * 0.7
      const next: number[] = []
      for (let i = first; i < heads.length && next.length < frozenCount; i++) {
        if (!heads[i].dataset.col) break
        if (next.length && x + heads[i].offsetWidth > budget) break
        next.push(x)
        x += heads[i].offsetWidth
      }
      setLefts(prev => (prev.length === next.length && prev.every((v, i) => v === next[i]) ? prev : next))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(table)
    if (table.parentElement) observer.observe(table.parentElement)

    // Marked while scrolled sideways: the frozen edge then shows it is holding
    // columns still over the ones sliding under it.
    let scroller: HTMLElement | null = table.parentElement
    while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowX)) scroller = scroller.parentElement
    const onScroll = () => { if (scroller) table.toggleAttribute('data-col-scrolled', scroller.scrollLeft > 0) }
    onScroll()
    scroller?.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      observer.disconnect()
      scroller?.removeEventListener('scroll', onScroll)
    }
  })

  useEffect(() => {
    const table = tableRef.current
    if (!table || !lefts.length || Date.now() - flashAsked.current > 1000) return
    flashAsked.current = 0
    window.clearTimeout(flashTimer.current)
    table.removeAttribute('data-freeze-flash')
    void table.offsetWidth                      // restart the animation
    table.setAttribute('data-freeze-flash', '')
    flashTimer.current = window.setTimeout(() => table.removeAttribute('data-freeze-flash'), 900)
  }, [lefts])

  const frozenStyle = (index: number, head: boolean): CSSProperties | undefined => {
    if (index >= lefts.length) {
      // Past the frozen block. A list's own stylesheet may pin a column
      // (leads-table pins its second); the user's number decides instead.
      return head ? undefined : { left: 'auto', boxShadow: 'none' }
    }
    const bg = head ? headBackground : cellBackground
    // The colour only: the edge line is a background image (column-drag.css),
    // which a `background` shorthand here would wipe out.
    return { position: 'sticky', left: lefts[index], zIndex: head ? 6 : 3, ...(bg ? { backgroundColor: bg } : {}) }
  }
  const frozenMarks = (index: number) => ({
    'data-frozen': index < lefts.length ? 'true' : undefined,
    'data-frozen-edge': index === lefts.length - 1 ? 'true' : undefined,
  })

  const headProps = (key: string, index: number, style?: CSSProperties) => ({
    'data-col': key,
    'data-dragging': dragKey === key ? 'true' : undefined,
    ...frozenMarks(index),
    draggable: true,
    title: 'Drag to move this column',
    style: { ...style, ...frozenStyle(index, true) },
    onDragStart: (e: DragEvent<HTMLElement>) => {
      setDragKey(key)
      e.dataTransfer.effectAllowed = 'move'
      e.dataTransfer.setData('text/plain', key)
    },
    // The others move out of the way as soon as the dragged column passes the
    // middle of one — not on first touch, which would flick two columns of
    // different widths back and forth under the pointer.
    onDragOver: (e: DragEvent<HTMLElement>) => {
      if (!dragKey) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      if (key === dragKey) return
      const box = e.currentTarget.getBoundingClientRect()
      const middle = box.left + box.width / 2
      const from = order.indexOf(dragKey), to = order.indexOf(key)
      if ((from < to && e.clientX < middle) || (from > to && e.clientX > middle)) return
      move(dragKey, key)
    },
    onDrop: (e: DragEvent<HTMLElement>) => { e.preventDefault(); setDragKey(null) },
    onDragEnd: () => setDragKey(null),
  })

  const cellProps = (key: string, index: number, style?: CSSProperties) => ({
    'data-col': key,
    'data-dragging': dragKey === key ? 'true' : undefined,
    ...frozenMarks(index),
    style: { ...style, ...frozenStyle(index, false) },
  })

  return {
    order, visible, hidden, toggleHidden, showAll, tableRef, headProps, cellProps,
    frozenCount, frozenShown: lefts.length, setFrozenCount,
    customised, resetLayout,
  }
}
