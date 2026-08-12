import { useEffect, type ReactNode } from 'react'
import { X } from 'lucide-react'

/**
 * Record drawer — the same interaction the Decoinks admin app uses for leads,
 * quotations, invoices and sales orders: a fixed panel that slides in from the
 * right over a dimmed page, 440px wide on desktop and full width on phones.
 * It never resizes the table behind it.
 */
export function Drawer({
  open, caption, title, badges, actions, onClose, children,
}: {
  open: boolean
  caption: string
  title: ReactNode
  badges?: ReactNode
  actions?: ReactNode
  onClose: () => void
  children: ReactNode
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previous
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <>
      <button className="cp-scrim" aria-label="Close details" onClick={onClose} />

      <aside className="cp-drawer" role="dialog" aria-modal="true" aria-label={caption}>
        <header className="flex items-start gap-3 border-b border-line px-5 py-5 sm:px-6">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">{caption}</p>
            <h2 className="mt-1 truncate text-[22px] font-bold leading-tight text-ink">{title}</h2>
            {badges ? <div className="mt-2.5 flex flex-wrap items-center gap-2">{badges}</div> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-line text-muted transition hover:bg-slate-50 hover:text-ink"
          >
            <X size={20} />
          </button>
        </header>

        {actions ? (
          <div className="flex flex-wrap gap-2.5 border-b border-line px-5 py-3.5 sm:px-6">{actions}</div>
        ) : null}

        <div className="pb-8">{children}</div>
      </aside>
    </>
  )
}

/** A bordered block of related fields, matching the admin drawer's sections. */
export function DrawerSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-b border-line px-5 py-5 sm:px-6">
      <h3 className="mb-3 text-[13px] font-semibold uppercase tracking-wide text-muted">{title}</h3>
      {children}
    </section>
  )
}

/** Label on the left, value on the right — the drawer's standard row. */
export function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <span className="shrink-0 text-[13px] text-muted">{label}</span>
      <span className="min-w-0 break-words text-right text-[13px] font-semibold text-ink">{value ?? '—'}</span>
    </div>
  )
}
