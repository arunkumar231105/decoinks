import type { ReactNode } from 'react'
import { AlertCircle, ArrowDown, ArrowUp, Inbox, RotateCcw, type LucideIcon } from 'lucide-react'

const cx = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(' ')

/* ── Status pill ───────────────────────────────────────────────────────── */

const STATUS_TONE: Record<string, string> = {
  'in production': 'bg-amber-50 text-amber-700 ring-amber-600/20',
  completed: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  delivered: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  shipped: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  'on hold': 'bg-violet-50 text-violet-700 ring-violet-600/20',
  cancelled: 'bg-rose-50 text-rose-700 ring-rose-600/20',
  pending: 'bg-amber-50 text-amber-700 ring-amber-600/20',
  'not started': 'bg-slate-100 text-slate-600 ring-slate-500/20',
  'yet to start': 'bg-slate-100 text-slate-600 ring-slate-500/20',
  draft: 'bg-slate-100 text-slate-600 ring-slate-500/20',
  confirmed: 'bg-sky-50 text-sky-700 ring-sky-600/20',
  gangsheet: 'bg-violet-50 text-violet-700 ring-violet-600/20',
  'custom t-shirts': 'bg-sky-50 text-sky-700 ring-sky-600/20',
  'on time': 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  delayed: 'bg-rose-50 text-rose-700 ring-rose-600/20',
}

export function Pill({ children, tone }: { children: ReactNode; tone?: string }) {
  const key = String(children).toLowerCase()
  return (
    <span className={cx('inline-flex items-center whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-semibold ring-1 ring-inset',
      tone ?? STATUS_TONE[key] ?? 'bg-slate-100 text-slate-600 ring-slate-500/20')}>
      {children}
    </span>
  )
}

/* ── Stat card ─────────────────────────────────────────────────────────── */

export function StatCard({
  icon: Icon, label, value, tone = 'bg-brand', trend, loading,
}: {
  icon: LucideIcon
  label: string
  value: ReactNode
  tone?: string
  trend?: { value: number; note: string } | null
  loading?: boolean
}) {
  const up = (trend?.value ?? 0) >= 0
  return (
    <div className="fp-card flex items-start gap-3.5 p-4">
      <span className={cx('grid h-12 w-12 shrink-0 place-items-center rounded-xl text-white', tone)}>
        <Icon size={22} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium text-muted">{label}</div>
        {loading
          ? <div className="fp-skeleton mt-1.5 h-7 w-16" />
          : <div className="truncate text-2xl font-bold leading-tight text-ink">{value}</div>}
        {trend && !loading ? (
          <div className={cx('mt-0.5 flex items-center gap-1 text-xs font-medium', up ? 'text-emerald-600' : 'text-rose-600')}>
            {up ? <ArrowUp size={12} /> : <ArrowDown size={12} />}
            {Math.abs(trend.value)}% <span className="text-muted">{trend.note}</span>
          </div>
        ) : null}
      </div>
    </div>
  )
}

/* ── Card shell with a header ──────────────────────────────────────────── */

export function Panel({
  title, action, children, className,
}: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx('fp-card overflow-hidden', className)}>
      {title ? (
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
          <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
          {action}
        </div>
      ) : null}
      {children}
    </section>
  )
}

/** Numbered section heading used across the Order Details screen. */
export function StepTitle({ n, title, right }: { n: number; title: string; right?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
      <h2 className="flex items-center gap-2.5 text-[15px] font-semibold text-heading">
        <span className="grid h-6 w-6 place-items-center rounded-full bg-brand text-xs font-bold text-white">{n}</span>
        {title}
      </h2>
      {right}
    </div>
  )
}

/* ── Async states ──────────────────────────────────────────────────────── */

export function TableStates({
  colSpan, loading, error, empty, emptyMessage, onRetry, rows = 6,
}: {
  colSpan: number
  loading: boolean
  error: string | null
  empty: boolean
  emptyMessage: string
  onRetry?: () => void
  rows?: number
}) {
  if (loading) {
    return <>{Array.from({ length: rows }).map((_, i) => (
      <tr key={i}><td colSpan={colSpan} className="px-4 py-3.5"><div className="fp-skeleton h-5 w-full" /></td></tr>
    ))}</>
  }
  if (error) {
    return (
      <tr><td colSpan={colSpan} className="px-4 py-14">
        <div className="mx-auto flex max-w-sm flex-col items-center text-center">
          <span className="grid h-11 w-11 place-items-center rounded-full bg-rose-50 text-rose-600"><AlertCircle size={20} /></span>
          <p className="mt-3 text-sm font-semibold text-ink">Couldn't load this list</p>
          <p className="mt-1 text-[13px] text-muted">{error}</p>
          {onRetry && <button className="fp-btn mt-4 h-9" onClick={onRetry}><RotateCcw size={14} /> Try again</button>}
        </div>
      </td></tr>
    )
  }
  if (empty) {
    return (
      <tr><td colSpan={colSpan} className="px-4 py-14">
        <div className="mx-auto flex max-w-sm flex-col items-center text-center">
          <span className="grid h-11 w-11 place-items-center rounded-full bg-slate-100 text-slate-400"><Inbox size={20} /></span>
          <p className="mt-3 text-sm font-semibold text-ink">Nothing to show yet</p>
          <p className="mt-1 text-[13px] text-muted">{emptyMessage}</p>
        </div>
      </td></tr>
    )
  }
  return null
}

/* ── Formatters ────────────────────────────────────────────────────────── */

export const dash = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : String(v))

export const fmtDate = (v?: string | null) =>
  v ? new Date(v).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' }) : '—'

export const fmtDateTime = (v?: string | null) =>
  v ? `${fmtDate(v)}\n${new Date(v).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}` : '—'

export const num = (n?: number | null) => Number(n ?? 0).toLocaleString('en-US')
