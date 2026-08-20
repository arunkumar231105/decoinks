import { useEffect, useState, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { Bell, ChevronDown, LogOut, Menu, Search, UserRound, X } from 'lucide-react'
import { Sidebar } from './Sidebar'
import { cn } from '../utils/cn'
import { useResource } from '../hooks/useResource'
import { endpoints } from '../services/api'
import type { Profile } from '../types'
import { auth, useAuth } from '../store/auth'

/**
 * App shell: fixed navy rail on desktop, off-canvas drawer below lg.
 * Pages provide their own title/subtitle and optional search placeholder.
 */
export function Layout({
  title, subtitle, searchPlaceholder, actions, children,
}: {
  title: string
  subtitle?: string
  searchPlaceholder?: string
  actions?: ReactNode
  children: ReactNode
}) {
  const [navOpen, setNavOpen] = useState(false)
  // Desktop rail collapse (mobile uses the off-canvas drawer via navOpen).
  const [collapsed, setCollapsed] = useState(false)
  const { pathname } = useLocation()
  // The signed-in customer, shown in the top bar on every page.
  const { data: profile } = useResource<Profile>(endpoints.profile)
  const { customer } = useAuth()
  const [menuOpen, setMenuOpen] = useState(false)
  const name = profile?.name ?? customer?.name ?? ''
  const initials = name.split(' ').filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase()

  // Close the mobile nav whenever the route changes.
  useEffect(() => { setNavOpen(false) }, [pathname])

  return (
    <div className="flex min-h-full bg-canvas">
      {/* Desktop rail — collapsible */}
      <aside className={cn('sticky top-0 hidden h-screen shrink-0', collapsed ? 'lg:hidden' : 'lg:block')}>
        <Sidebar />
      </aside>

      {/* Mobile drawer */}
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

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 border-b border-line bg-white/95 backdrop-blur">
          <div className="flex items-center gap-3 px-4 py-3.5 sm:px-6">
            <button
              onClick={() =>
                window.matchMedia('(min-width: 1024px)').matches
                  ? setCollapsed((c) => !c)
                  : setNavOpen(true)
              }
              aria-label="Toggle menu"
              className="cp-btn h-10 w-10 px-0"
            >
              <Menu size={18} />
            </button>

            <div className="min-w-0 flex-1">
              <h1 className="truncate text-lg font-bold leading-tight text-ink sm:text-xl">{title}</h1>
              {subtitle ? <p className="truncate text-[13px] text-muted">{subtitle}</p> : null}
            </div>

            {searchPlaceholder ? (
              <label className="relative hidden min-w-0 flex-1 max-w-md md:block">
                <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input className="cp-input pl-10" placeholder={searchPlaceholder} />
              </label>
            ) : null}

            {actions}

            <button className="relative hidden h-10 w-10 shrink-0 place-items-center rounded-xl text-muted transition hover:bg-slate-100 hover:text-ink sm:grid" aria-label="Notifications">
              <Bell size={19} />
              <span className="absolute right-1.5 top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-brand px-1 text-[10px] font-bold text-white">3</span>
            </button>

            <div className="relative shrink-0">
              <button
                onClick={() => setMenuOpen(o => !o)}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                className="flex items-center gap-2 rounded-xl px-1.5 py-1.5 transition hover:bg-slate-100"
              >
                <span className="grid h-9 w-9 place-items-center rounded-full bg-brand text-xs font-bold text-white">
                  {initials || <UserRound size={16} />}
                </span>
                <span className="hidden text-sm font-semibold text-ink lg:inline">{name || 'My Account'}</span>
                <ChevronDown size={16} className="hidden text-muted lg:inline" />
              </button>

              {menuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} aria-hidden />
                  <div role="menu" className="absolute right-0 z-50 mt-2 w-56 overflow-hidden rounded-xl border border-line bg-white shadow-lg">
                    <div className="border-b border-line px-4 py-3">
                      <div className="truncate text-sm font-semibold text-ink">{name || 'My Account'}</div>
                      {customer?.username && <div className="truncate text-xs text-muted">{customer.username}</div>}
                    </div>
                    <button
                      onClick={() => { setMenuOpen(false); auth.signOut() }}
                      className="flex w-full items-center gap-2.5 px-4 py-3 text-left text-sm font-medium text-rose-600 transition hover:bg-rose-50"
                    >
                      <LogOut size={16} /> Sign out
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </header>

        <main className="flex-1 px-4 py-5 sm:px-6">{children}</main>
      </div>
    </div>
  )
}
