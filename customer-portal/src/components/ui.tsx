import type { ReactNode } from 'react'
import { AlertCircle, ChevronLeft, ChevronRight, Inbox, RotateCcw, type LucideIcon } from 'lucide-react'
import { cn } from '../utils/cn'
import type { OrderStatus, PaymentStatus } from '../types'

/* ── Badges ────────────────────────────────────────────────────────────── */

const ORDER_TONE: Record<string, string> = {
  'In Production': 'bg-violet-50 text-violet-700 ring-violet-600/20',
  Shipped: 'bg-sky-50 text-sky-700 ring-sky-600/20',
  Delivered: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  Confirmed: 'bg-indigo-50 text-indigo-700 ring-indigo-600/20',
  Draft: 'bg-slate-100 text-slate-600 ring-slate-500/20',
  Cancelled: 'bg-rose-50 text-rose-700 ring-rose-600/20',
}

const PAYMENT_TONE: Record<string, string> = {
  Paid: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  'Partially Paid': 'bg-amber-50 text-amber-700 ring-amber-600/20',
  Unpaid: 'bg-rose-50 text-rose-700 ring-rose-600/20',
}

export function Badge({ children, tone }: { children: ReactNode; tone?: string }) {
  return (
    <span className={cn('inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset',
      tone ?? 'bg-slate-100 text-slate-600 ring-slate-500/20')}>
      {children}
    </span>
  )
}

export const OrderStatusBadge = ({ status }: { status: OrderStatus }) => (
  <Badge tone={ORDER_TONE[status]}>{status}</Badge>
)

export const PaymentBadge = ({ status }: { status: PaymentStatus }) => (
  <Badge tone={PAYMENT_TONE[status]}>{status}</Badge>
)

/* ── Stat card ─────────────────────────────────────────────────────────── */

export function StatCard({
  icon: Icon, value, label, hint, tone = 'bg-indigo-50 text-brand', loading,
}: {
  icon: LucideIcon
  value: ReactNode
  label: string
  hint?: string
  tone?: string
  loading?: boolean
}) {
  return (
    <div className="cp-card flex items-center gap-3.5 p-4 transition hover:shadow-md">
      <span className={cn('grid h-11 w-11 shrink-0 place-items-center rounded-xl', tone)}>
        <Icon size={20} />
      </span>
      <div className="min-w-0 flex-1">
        {loading
          ? <div className="cp-skeleton h-6 w-16" />
          : <div className="truncate text-xl font-bold leading-tight text-ink">{value}</div>}
        <div className="truncate text-[13px] font-medium text-ink/80">{label}</div>
        {hint ? <div className="truncate text-xs text-muted">{hint}</div> : null}
      </div>
    </div>
  )
}

/* ── Artwork thumbnail ─────────────────────────────────────────────────── */

const TONES = [
  'from-orange-400 to-rose-500', 'from-emerald-400 to-teal-600', 'from-sky-400 to-indigo-600',
  'from-violet-400 to-fuchsia-600', 'from-amber-400 to-orange-600', 'from-rose-400 to-pink-600',
]

/** Shows the real preview when the API provides one; a stable colour tile otherwise. */
export function Thumb({ name, src, className }: { name: string; src?: string | null; className?: string }) {
  const box = className ?? 'h-10 w-10 text-xs'
  if (src) {
    return <img src={src} alt={name} loading="lazy" className={cn('shrink-0 rounded-lg object-cover', box)} />
  }
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0
  const initials = name.split(' ').filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase()
  return (
    <span className={cn('grid shrink-0 place-items-center rounded-lg bg-gradient-to-br font-bold text-white',
      TONES[hash % TONES.length], box)} aria-hidden>
      {initials}
    </span>
  )
}

/* ── Table states ──────────────────────────────────────────────────────── */

export function TableStates({
  colSpan, loading, error, empty, emptyMessage, onRetry, rows = 6,
}: {
  colSpan: number
  loading: boolean
  error: string | null
  empty: boolean
  emptyMessage: string
  onRetry: () => void
  rows?: number
}) {
  if (loading) {
    return (
      <>
        {Array.from({ length: rows }).map((_, i) => (
          <tr key={i}>
            <td colSpan={colSpan} className="px-4 py-3.5">
              <div className="cp-skeleton h-5 w-full" />
            </td>
          </tr>
        ))}
      </>
    )
  }
  if (error) {
    return (
      <tr>
        <td colSpan={colSpan} className="px-4 py-14">
          <div className="mx-auto flex max-w-sm flex-col items-center text-center">
            <span className="grid h-11 w-11 place-items-center rounded-full bg-rose-50 text-rose-600">
              <AlertCircle size={20} />
            </span>
            <p className="mt-3 text-sm font-semibold text-ink">Couldn't load this list</p>
            <p className="mt-1 text-[13px] text-muted">{error}</p>
            <button className="cp-btn cp-btn-sm mt-4" onClick={onRetry}><RotateCcw size={14} /> Try again</button>
          </div>
        </td>
      </tr>
    )
  }
  if (empty) {
    return (
      <tr>
        <td colSpan={colSpan} className="px-4 py-14">
          <div className="mx-auto flex max-w-sm flex-col items-center text-center">
            <span className="grid h-11 w-11 place-items-center rounded-full bg-slate-100 text-slate-400">
              <Inbox size={20} />
            </span>
            <p className="mt-3 text-sm font-semibold text-ink">Nothing to show yet</p>
            <p className="mt-1 text-[13px] text-muted">{emptyMessage}</p>
          </div>
        </td>
      </tr>
    )
  }
  return null
}

/* ── Pagination ────────────────────────────────────────────────────────── */

export function Pagination({
  page, pageCount, total, rows, onPage, onRows,
}: {
  page: number
  pageCount: number
  total: number
  rows: number
  onPage: (p: number) => void
  onRows: (r: number) => void
}) {
  const from = total === 0 ? 0 : (page - 1) * rows + 1
  const to = Math.min(page * rows, total)
  const pages: (number | '…')[] = []
  for (let p = 1; p <= pageCount; p++) {
    if (p === 1 || p === pageCount || Math.abs(p - page) <= 1) pages.push(p)
    else if (pages[pages.length - 1] !== '…') pages.push('…')
  }

  return (
    <div className="flex flex-col gap-3 border-t border-line px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-[13px] text-muted">Showing {from} to {to} of {total}</p>

      <div className="flex flex-wrap items-center gap-1.5">
        <button className="cp-icon-btn" onClick={() => onPage(Math.max(1, page - 1))} disabled={page <= 1} aria-label="Previous page">
          <ChevronLeft size={16} />
        </button>
        {pages.map((p, i) =>
          p === '…'
            ? <span key={`gap-${i}`} className="px-1.5 text-muted">…</span>
            : (
              <button
                key={p}
                onClick={() => onPage(p)}
                aria-current={p === page ? 'page' : undefined}
                className={cn('h-9 min-w-9 rounded-lg border px-3 text-[13px] font-medium transition',
                  p === page ? 'border-brand bg-brand text-white' : 'border-line bg-white text-ink hover:bg-slate-50')}
              >
                {p}
              </button>
            ),
        )}
        <button className="cp-icon-btn" onClick={() => onPage(Math.min(pageCount, page + 1))} disabled={page >= pageCount} aria-label="Next page">
          <ChevronRight size={16} />
        </button>

        <label className="ml-1 flex items-center gap-2 text-[13px] text-muted">
          <span className="hidden sm:inline">Rows per page</span>
          <select
            className="h-9 rounded-lg border border-line bg-white px-2 text-[13px] text-ink outline-none focus:border-brand"
            value={rows}
            onChange={e => { onRows(Number(e.target.value)); onPage(1) }}
          >
            {[10, 25, 50].map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </label>
      </div>
    </div>
  )
}
