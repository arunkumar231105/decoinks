import { NavLink } from 'react-router-dom'
import { Droplet, Headphones, Image, LayoutDashboard, ClipboardList, Receipt, UserRound } from 'lucide-react'
import { cn } from '../utils/cn'

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/orders', label: 'Order History', icon: ClipboardList },
  { to: '/artworks', label: 'Artworks', icon: Image },
  { to: '/invoices', label: 'Invoices', icon: Receipt },
  { to: '/profile', label: 'Profile', icon: UserRound },
]

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <div className="flex h-full w-[264px] flex-col bg-sidebar text-slate-300">
      {/* Brand */}
      <div className="flex items-center gap-3 px-5 py-6">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-logo text-white">
          <Droplet size={22} fill="currentColor" />
        </span>
        <div className="min-w-0">
          <div className="truncate text-lg font-bold leading-tight text-white">Decoinks</div>
          <div className="truncate text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
            Customer Portal
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 px-3 py-2">
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn('flex items-center gap-3 rounded-xl px-3.5 py-3 text-sm font-medium transition',
                isActive ? 'bg-brand text-white shadow-sm' : 'text-slate-300 hover:bg-sidebarHover hover:text-white')
            }
          >
            <Icon size={19} />
            <span className="truncate">{label}</span>
          </NavLink>
        ))}
      </nav>

      {/* Support */}
      <div className="px-3 pb-3">
        <div className="rounded-2xl bg-sidebarHover/70 p-4">
          <div className="flex items-center gap-2 text-white">
            <Headphones size={17} />
            <span className="text-sm font-semibold">Need Help?</span>
          </div>
          <p className="mt-1 text-xs text-slate-400">We're here to assist you.</p>
          <a
            href="mailto:support@decoinks.com"
            className="mt-3 flex h-10 items-center justify-center rounded-xl border border-brand/70 text-sm font-medium text-white transition hover:bg-brand"
          >
            Contact Support
          </a>
        </div>
      </div>

      <div className="px-5 pb-5 text-[11px] leading-relaxed text-slate-500">
        © 2026 Decoinks LLC
        <br />
        All rights reserved.
      </div>
    </div>
  )
}
