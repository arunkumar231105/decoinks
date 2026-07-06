import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { api } from '../services/api'

interface Hit {
  type: string
  id: string
  label: string
  sub: string
  to: string
}

// Debounce a changing value.
function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

export function GlobalSearch() {
  const navigate = useNavigate()
  const [term, setTerm] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const debounced = useDebounced(term.trim(), 250)
  const boxRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const { data: hits = [], isFetching } = useQuery({
    queryKey: ['global-search', debounced],
    queryFn: () => api.get(`/search?q=${encodeURIComponent(debounced)}`).then(r => (r.data.data?.results ?? []) as Hit[]),
    enabled: debounced.length >= 2,
    staleTime: 30_000,
  })

  // Ctrl+K / Cmd+K focuses the search; Esc clears/closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        inputRef.current?.focus()
        setOpen(true)
      }
      if (e.key === 'Escape') { setOpen(false); inputRef.current?.blur() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Close when clicking outside.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  useEffect(() => { setActive(0) }, [debounced])

  const go = (hit: Hit) => {
    navigate(hit.to)
    setOpen(false)
    setTerm('')
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open || !hits.length) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, hits.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); if (hits[active]) go(hits[active]) }
  }

  const showDropdown = open && debounced.length >= 2

  return (
    <div className="global-search" ref={boxRef} style={{ position: 'relative' }}>
      <Search size={18} />
      <input
        ref={inputRef}
        placeholder="Search jobs, customers, products"
        value={term}
        onChange={e => { setTerm(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />
      <kbd>Ctrl+K</kbd>

      {showDropdown && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 8px)', left: 0, right: 0, zIndex: 60,
          background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12,
          boxShadow: '0 16px 40px rgba(15,23,42,0.16)', overflow: 'hidden', maxHeight: 420, overflowY: 'auto',
        }}>
          {isFetching && hits.length === 0 && (
            <div style={{ padding: '14px 16px', fontSize: 13, color: '#94a3b8' }}>Searching…</div>
          )}
          {!isFetching && hits.length === 0 && (
            <div style={{ padding: '14px 16px', fontSize: 13, color: '#94a3b8' }}>
              No results for “{debounced}”
            </div>
          )}
          {hits.map((h, i) => (
            <button
              key={`${h.type}-${h.id}`}
              onMouseDown={() => go(h)}
              onMouseEnter={() => setActive(i)}
              style={{
                display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left',
                padding: '10px 16px', border: 'none', cursor: 'pointer',
                background: i === active ? '#f0fdfa' : '#fff',
              }}
            >
              <span style={{
                fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em',
                color: '#0d9488', background: '#ccfbf1', borderRadius: 6, padding: '3px 7px',
                flexShrink: 0, minWidth: 74, textAlign: 'center',
              }}>{h.type}</span>
              <span style={{ overflow: 'hidden' }}>
                <span style={{ display: 'block', fontSize: 13.5, fontWeight: 600, color: '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{h.label}</span>
                {h.sub && <span style={{ display: 'block', fontSize: 12, color: '#64748b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{h.sub}</span>}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
