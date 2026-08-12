import type { ReactNode } from 'react'
import { ChevronLeft, ChevronRight, type LucideIcon } from 'lucide-react'
import { cn } from '../utils/cn'
import type { OrderStatus, PaymentStatus } from '../data/mock'

/* ── Status badges ─────────────────────────────────────────────────────── */

const ORDER_TONE: Record<OrderStatus, string> = {
  'In Production': 'bg-violet-100 text-violet-700',
  Shipped: 'bg-sky-100 text-sky-700',
  Delivered: 'bg-emerald-100 text-emerald-700',
}

const PAYMENT_TONE: Record<PaymentStatus, string> = {
  Paid: 'bg-emerald-100 text-emerald-700',
  'Partially Paid': 'bg-amber-100 text-amber-700',
  Unpaid: 'bg-rose-100 text-rose-700',
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold',
      tone === 'neutral' ? 'bg-slate-100 text-slate-600' : tone)}>
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
  icon: Icon, value, label, hint, tone = 'bg-indigo-50 text-brand',
}: {
  icon: LucideIcon
  value: ReactNode
  label: string
  hint?: string
  tone?: string
}) {
  return (
    <div className="cp-card flex items-center gap-3.5 p-4">
      <span className={cn('grid h-11 w-11 shrink-0 place-items-center rounded-xl', tone)}>
        <Icon size={20} />
      </span>
      <div className="min-w-0">
        <div className="truncate text-xl font-bold leading-tight text-ink">{value}</div>
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

/**
 * Deterministic placeholder tile. Real thumbnails replace this once the artwork
 * files are served by the API — the shape and sizing stay the same.
 */
export function Thumb({ name, className }: { name: string; className?: string }) {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0
  const initials = name.split(' ').filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase()
  return (
    <span
      className={cn('grid shrink-0 place-items-center rounded-lg bg-gradient-to-br font-bold text-white',
        TONES[hash % TONES.length], className ?? 'h-10 w-10 text-xs')}
      aria-hidden
    >
      {initials}
    </span>
  )
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
  // Compact window of page numbers so long lists never overflow on mobile.
  const pages: (number | '…')[] = []
  for (let p = 1; p <= pageCount; p++) {
    if (p === 1 || p === pageCount || Math.abs(p - page) <= 1) pages.push(p)
    else if (pages[pages.length - 1] !== '…') pages.push('…')
  }

  return (
    <div className="flex flex-col gap-3 border-t border-line px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
      <p className="text-[13px] text-muted">
        Showing {from} to {to} of {total}
      </p>

      <div className="flex flex-wrap items-center gap-1.5">
        <button className="cp-btn h-9 w-9 px-0" onClick={() => onPage(Math.max(1, page - 1))} disabled={page === 1} aria-label="Previous page">
          <ChevronLeft size={16} />
        </button>
        {pages.map((p, i) =>
          p === '…' ? (
            <span key={`gap-${i}`} className="px-1.5 text-muted">…</span>
          ) : (
            <button
              key={p}
              onClick={() => onPage(p)}
              aria-current={p === page ? 'page' : undefined}
              className={cn('h-9 min-w-9 rounded-xl border px-3 text-sm font-medium transition',
                p === page ? 'border-brand bg-brand text-white' : 'border-line bg-white text-ink hover:bg-slate-50')}
            >
              {p}
            </button>
          ),
        )}
        <button className="cp-btn h-9 w-9 px-0" onClick={() => onPage(Math.min(pageCount, page + 1))} disabled={page === pageCount || pageCount === 0} aria-label="Next page">
          <ChevronRight size={16} />
        </button>

        <label className="ml-1 flex items-center gap-2 text-[13px] text-muted">
          <span className="hidden sm:inline">Rows per page</span>
          <select
            className="h-9 rounded-xl border border-line bg-white px-2 text-sm text-ink outline-none focus:border-brand"
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

/* ── Empty state ───────────────────────────────────────────────────────── */

export const EmptyRow = ({ colSpan, message }: { colSpan: number; message: string }) => (
  <tr>
    <td colSpan={colSpan} className="px-4 py-12 text-center text-sm text-muted">{message}</td>
  </tr>
)
