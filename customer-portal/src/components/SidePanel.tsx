import { useEffect, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { cn } from '../utils/cn'

/**
 * The detail panel that opens when a row is clicked.
 *
 * One element, two behaviours:
 *  - xl and up  → it sits beside the table as its own column (as in the design)
 *  - below xl   → it becomes a full-height drawer over the page with a backdrop,
 *                 so the same panel stays usable on tablets and phones.
 */
export function SidePanel({
  open,
  title,
  subtitle,
  onClose,
  children,
}: {
  open: boolean
  title: ReactNode
  subtitle?: ReactNode
  onClose: () => void
  children: ReactNode
}) {
  // Escape closes the panel; while it is a drawer the page behind must not scroll.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    const isDrawer = window.matchMedia('(max-width: 1279px)').matches
    const previous = document.body.style.overflow
    if (isDrawer) document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previous
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <>
      {/* Backdrop — drawer mode only */}
      <div
        className="fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-[1px] xl:hidden"
        onClick={onClose}
        aria-hidden
      />

      <aside
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : 'Details'}
        className={cn(
          // drawer (mobile / tablet)
          'fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col overflow-y-auto',
          'border-l border-line bg-white shadow-panel',
          // column (desktop)
          'xl:static xl:z-auto xl:max-h-[calc(100vh-8rem)] xl:w-[380px] xl:shrink-0',
          'xl:rounded-2xl xl:border xl:shadow-card',
        )}
      >
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-line bg-white px-5 py-4 xl:rounded-t-2xl">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-ink">{title}</h2>
            {subtitle ? <div className="mt-0.5">{subtitle}</div> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close details"
            className="-mr-1 rounded-lg p-1.5 text-muted transition hover:bg-slate-100 hover:text-ink"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 px-5 py-4">{children}</div>
      </aside>
    </>
  )
}

/** Label / value row used throughout the detail panels. */
export function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5">
      <span className="shrink-0 text-[13px] text-muted">{label}</span>
      <span className="min-w-0 break-words text-right text-[13px] font-medium text-ink">{value}</span>
    </div>
  )
}

/** Small section heading inside a detail panel. */
export function PanelSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-line pt-4">
      <h3 className="mb-1 text-sm font-semibold text-ink">{title}</h3>
      {children}
    </section>
  )
}
