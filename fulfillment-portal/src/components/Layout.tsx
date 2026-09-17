import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, Outlet, useLocation } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Bell, ChevronDown, KeyRound, LogOut, Menu, PanelLeftClose, PanelLeftOpen, User, X } from 'lucide-react'
import { Sidebar } from './Sidebar'
import { useAuthStore } from '../store/authStore'
import { useSupplierAuth } from '../hooks/useSupplierAuth'
import api from '../services/api'

/**
 * App shell for the fulfillment portal.
 *
 * Desktop (lg and up): a navy rail that collapses to icons (remembered per
 * browser) beside a white top bar with notifications and the account menu.
 * Below lg: the rail becomes an off-canvas drawer that closes on the overlay,
 * the close button, Escape, or moving to another page.
 * Pages render inside <Outlet/> and supply their own headers via <PageHeader/>.
 */

const COLLAPSE_KEY = 'fp-sidebar-collapsed'

function useClickAway(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) close() }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open, close])
  return ref
}

interface Notification { id: string; title: string; message: string | null; is_read: boolean; created_at: string }

function Notifications() {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const ref = useClickAway(open, () => setOpen(false))
  const { data } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.get('/notifications').then(r => (Array.isArray(r.data) ? r.data : r.data?.notifications ?? []) as Notification[]),
    refetchInterval: 60000,
  })
  const list = data ?? []
  const unread = list.filter(n => !n.is_read).length
  const markRead = useMutation({
    mutationFn: (id: string) => api.patch(`/notifications/${id}/read`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  })

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(o => !o)} aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'} aria-expanded={open}
        className="relative grid h-10 w-10 place-items-center rounded-full text-slate-600 transition hover:bg-slate-100">
        <Bell size={20} />
        {unread > 0 && <span className="absolute right-2 top-2 h-2.5 w-2.5 rounded-full bg-rose-500 ring-2 ring-white" />}
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-2 w-[min(340px,calc(100vw-24px))] overflow-hidden rounded-xl border border-line bg-white shadow-pop">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <span className="text-sm font-semibold text-ink">Notifications</span>
            {unread > 0 && <span className="text-xs text-muted">{unread} unread</span>}
          </div>
          <ul className="max-h-80 divide-y divide-line overflow-y-auto">
            {list.length === 0 && <li className="px-4 py-8 text-center text-sm text-muted">You're all caught up.</li>}
            {list.slice(0, 8).map(n => (
              <li key={n.id}>
                <button className={`w-full px-4 py-3 text-left transition hover:bg-slate-50 ${n.is_read ? '' : 'bg-blue-50/40'}`}
                  onClick={() => { if (!n.is_read) markRead.mutate(n.id) }}>
                  <span className="flex items-start gap-2">
                    {!n.is_read && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand" />}
                    <span className="min-w-0">
                      <span className="block text-[13px] font-semibold text-ink">{n.title}</span>
                      {n.message && <span className="mt-0.5 block text-[13px] text-muted">{n.message}</span>}
                      <span className="mt-1 block text-[11px] text-slate-400">{new Date(n.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function AccountMenu() {
  const supplier = useAuthStore(s => s.supplier)
  const { signOut } = useSupplierAuth()
  const [open, setOpen] = useState(false)
  const ref = useClickAway(open, () => setOpen(false))
  const name = supplier?.name?.trim() || 'Supplier'
  const initials = name.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase()

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(o => !o)} aria-expanded={open} aria-haspopup="menu"
        className="flex items-center gap-2 rounded-full py-1 pl-1 pr-2 transition hover:bg-slate-100">
        <span className="grid h-9 w-9 place-items-center rounded-full bg-slate-200 text-[13px] font-semibold text-slate-700">{initials}</span>
        <span className="hidden max-w-[160px] truncate text-sm font-medium text-ink sm:block">{name}</span>
        <ChevronDown size={15} className="text-slate-500" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-50 mt-2 w-56 overflow-hidden rounded-xl border border-line bg-white py-1 shadow-pop">
          <div className="border-b border-line px-4 py-3">
            <div className="truncate text-sm font-semibold text-ink">{name}</div>
            {supplier?.email && <div className="truncate text-xs text-muted">{supplier.email}</div>}
          </div>
          <Link role="menuitem" to="/profile" onClick={() => setOpen(false)} className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-ink hover:bg-slate-50"><User size={16} /> Profile</Link>
          <Link role="menuitem" to="/change-password" onClick={() => setOpen(false)} className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-ink hover:bg-slate-50"><KeyRound size={16} /> Change password</Link>
          <button role="menuitem" onClick={signOut} className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm text-rose-600 hover:bg-rose-50"><LogOut size={16} /> Logout</button>
        </div>
      )}
    </div>
  )
}

export default function Layout() {
  const [navOpen, setNavOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(() => {
    // Until someone picks, laptops (under 1440px) start with the icon rail so
    // the order grid has room for every column.
    try {
      const saved = localStorage.getItem(COLLAPSE_KEY)
      return saved === null ? window.innerWidth < 1440 : saved === '1'
    } catch { return window.innerWidth < 1440 }
  })
  const { pathname } = useLocation()

  useEffect(() => { setNavOpen(false) }, [pathname])
  const toggleCollapsed = () => setCollapsed(c => {
    try { localStorage.setItem(COLLAPSE_KEY, c ? '0' : '1') } catch { /* private mode */ }
    return !c
  })
  useEffect(() => {
    if (!navOpen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setNavOpen(false) }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'   // no scrolling the page behind the drawer
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [navOpen])
  // Growing past lg with the drawer open leaves nothing to close it with.
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)')
    const onChange = () => { if (mq.matches) setNavOpen(false) }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  return (
    <div className="flex min-h-screen bg-canvas">
      {/* Navy all the way down however long the page is; the rail itself stays in view. */}
      <aside className="hidden shrink-0 bg-sidebar lg:block">
        <div className="sticky top-0 h-screen">
          <Sidebar collapsed={collapsed} />
        </div>
      </aside>

      {navOpen && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="absolute inset-0 bg-slate-900/50" onClick={() => setNavOpen(false)} aria-hidden />
          <aside className="absolute inset-y-0 left-0 shadow-2xl">
            <div className="relative h-full">
              <Sidebar onNavigate={() => setNavOpen(false)} />
              <button onClick={() => setNavOpen(false)} aria-label="Close menu"
                className="absolute right-3 top-5 grid h-9 w-9 place-items-center rounded-lg text-slate-300 hover:bg-white/10 hover:text-white">
                <X size={19} />
              </button>
            </div>
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-[60px] items-center gap-2 bg-canvas/95 px-3 backdrop-blur sm:px-5 lg:px-6">
          <button onClick={() => setNavOpen(true)} aria-label="Open menu"
            className="grid h-10 w-10 place-items-center rounded-lg text-slate-600 hover:bg-slate-100 lg:hidden">
            <Menu size={21} />
          </button>
          <button onClick={toggleCollapsed} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="hidden h-10 w-10 place-items-center rounded-lg text-slate-600 hover:bg-slate-100 lg:grid">
            {collapsed ? <PanelLeftOpen size={20} /> : <PanelLeftClose size={20} />}
          </button>
          <Link to="/" className="text-[21px] font-extrabold tracking-tight text-sidebar lg:hidden">decoinks</Link>
          <div className="ml-auto flex items-center gap-1.5 sm:gap-3">
            <Notifications />
            <AccountMenu />
          </div>
        </header>

        <main className="min-w-0 flex-1 px-4 pb-6 pt-2 sm:px-6 lg:pb-8">
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
