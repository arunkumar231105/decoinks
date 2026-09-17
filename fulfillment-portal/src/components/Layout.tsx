import { useEffect, useState, type ReactNode } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { Bell, Menu, X } from 'lucide-react'
import { Sidebar } from './Sidebar'

/**
 * App shell for the fulfillment portal: fixed navy rail on desktop, off-canvas
 * drawer below lg. Pages render inside <Outlet/> and supply their own headers
 * via <PageHeader/> so each screen controls its own actions.
 */
export default function Layout() {
  const [navOpen, setNavOpen] = useState(false)
  const { pathname } = useLocation()

  useEffect(() => { setNavOpen(false) }, [pathname])

  return (
    <div className="flex min-h-screen bg-canvas">
      <aside className="sticky top-0 hidden h-screen shrink-0 lg:block">
        <Sidebar />
      </aside>

      {navOpen && (
        <>
          <div className="fixed inset-0 z-40 bg-slate-900/50 lg:hidden" onClick={() => setNavOpen(false)} aria-hidden />
          <aside className="fixed inset-y-0 left-0 z-50 lg:hidden">
            <div className="relative h-full">
              <Sidebar onNavigate={() => setNavOpen(false)} />
              <button
                onClick={() => setNavOpen(false)}
                aria-label="Close menu"
                className="absolute right-3 top-6 rounded-lg p-1.5 text-slate-400 hover:bg-white/10 hover:text-white"
              >
                <X size={18} />
              </button>
            </div>
          </aside>
        </>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Compact bar that only exists to open the nav on small screens */}
        <div className="sticky top-0 z-30 flex items-center gap-3 border-b border-line bg-white px-4 py-3 lg:hidden">
          <button onClick={() => setNavOpen(true)} aria-label="Open menu" className="fp-btn h-10 w-10 px-0">
            <Menu size={18} />
          </button>
          <span className="text-base font-bold text-heading">Decoinks</span>
          <button className="relative ml-auto grid h-10 w-10 place-items-center rounded-xl text-muted hover:bg-slate-100" aria-label="Notifications">
            <Bell size={19} />
          </button>
        </div>

        <main className="min-w-0 flex-1 px-4 py-5 sm:px-6 lg:px-8 lg:py-7">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

/** Standard page heading: breadcrumb, title, subtitle and right-aligned actions. */
export function PageHeader({
  breadcrumb, title, subtitle, actions,
}: {
  breadcrumb?: ReactNode
  title: string
  subtitle?: string
  actions?: ReactNode
}) {
  return (
    <header className="mb-5 flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
      <div className="min-w-0">
        {breadcrumb ? <div className="mb-1.5 flex items-center gap-2 text-[13px] text-muted">{breadcrumb}</div> : null}
        <h1 className="truncate text-[26px] font-bold leading-tight text-heading">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-muted">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2.5">{actions}</div> : null}
    </header>
  )
}
