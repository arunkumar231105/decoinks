import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent } from 'react'
import '../styles/column-drag.css'

/**
 * Columns a grid's user can drag into any order by their headers.
 *
 *   - While a header is dragged the others slide aside to make room (each
 *     column's cells are animated from where they were to where they now are).
 *   - The first `frozen` columns (each page says how many; 0 for none) stay
 *     put while the grid scrolls sideways, whichever columns they are after a
 *     drag. Where each one ends is measured
 *     from the header as drawn, so any widths work; on a narrow screen fewer
 *     are frozen, so the frozen block never takes more than ~60% of the grid.
 *   - Columns can be hidden and shown again (`toggleHidden`, `showAll`); the
 *     page draws `visible`, which is `order` less the hidden ones. At least one
 *     column always stays.
 *   - Nothing is saved. A hard refresh brings back the page's own order, with
 *     every column shown.
 *
 * A page renders its columns in `visible`, spreads `headProps(key, i)` on each
 * header cell and `cellProps(key, i)` on each body cell, and puts `tableRef` on
 * the <table>. `i` is the column's position among the ones shown.
 */
export function useColumnDrag(
  keys: string[],
  { frozen = 3, cellBackground, headBackground }: {
    frozen?: number
    // Set when the table paints its row colour on the <tr> rather than the
    // cells: a frozen cell must be opaque or the scrolled cells show through.
    cellBackground?: string
    headBackground?: string
  } = {},
) {
  const signature = keys.join('|')
  const [stored, setStored] = useState<string[]>(keys)
  // A page that changes its columns starts again from its own order.
  useEffect(() => { setStored(keys) }, [signature]) // eslint-disable-line react-hooks/exhaustive-deps

  const order = useMemo(() => {
    const known = new Set(keys)
    return [...stored.filter(k => known.has(k)), ...keys.filter(k => !stored.includes(k))]
  }, [stored, signature]) // eslint-disable-line react-hooks/exhaustive-deps

  const [hidden, setHidden] = useState<Set<string>>(() => new Set())
  useEffect(() => { setHidden(new Set()) }, [signature]) // eslint-disable-line react-hooks/exhaustive-deps
  const visible = useMemo(() => order.filter(k => !hidden.has(k)), [order, hidden])
  const toggleHidden = (key: string) => setHidden(current => {
    const next = new Set(current)
    if (next.has(key)) next.delete(key)
    else if (keys.length - next.size > 1) next.add(key)
    return next
  })
  const showAll = () => setHidden(new Set())

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
    setStored(next)
  }

  // ── Frozen columns ────────────────────────────────────────────────────────
  const [lefts, setLefts] = useState<number[]>([])
  useLayoutEffect(() => {
    const table = tableRef.current
    if (!table) return
    const measure = () => {
      const heads = Array.from(table.querySelectorAll<HTMLElement>('thead tr:first-child > th'))
      const first = heads.findIndex(th => th.dataset.col)
      if (first < 0) return
      let x = heads.slice(0, first).reduce((w, th) => w + th.offsetWidth, 0)
      const budget = (table.parentElement?.clientWidth || window.innerWidth) * 0.6
      const next: number[] = []
      for (let i = first; i < heads.length && next.length < frozen; i++) {
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
    return () => observer.disconnect()
  })

  const frozenStyle = (index: number, head: boolean): CSSProperties | undefined => {
    if (index >= lefts.length) return undefined
    const bg = head ? headBackground : cellBackground
    return {
      position: 'sticky', left: lefts[index], zIndex: head ? 6 : 3,
      ...(bg ? { background: bg } : {}),
      boxShadow: index === lefts.length - 1 ? '1px 0 0 #e1e7ef' : 'none',
    }
  }

  const headProps = (key: string, index: number, style?: CSSProperties) => ({
    'data-col': key,
    'data-dragging': dragKey === key ? 'true' : undefined,
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
    style: { ...style, ...frozenStyle(index, false) },
  })

  return { order, visible, hidden, toggleHidden, showAll, tableRef, headProps, cellProps }
}
