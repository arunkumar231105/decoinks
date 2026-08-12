import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard, ShoppingCart, RefreshCw, BarChart3, Settings, LogOut, Share2,
} from 'lucide-react'
import { useSupplierAuth } from '../hooks/useSupplierAuth'

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/orders', label: 'Orders', icon: ShoppingCart },
  { to: '/status-update', label: 'Status Update', icon: RefreshCw },
  { to: '/reports', label: 'Reports', icon: BarChart3 },
]

const linkClass = ({ isActive }: { isActive: boolean }) =>
  [
    'flex items-center gap-3 rounded-xl px-4 py-3 text-[15px] font-medium transition',
    isActive ? 'bg-brand text-white shadow-sm' : 'text-slate-300 hover:bg-sidebarHover hover:text-white',
  ].join(' ')

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { signOut } = useSupplierAuth()

  return (
    <div className="flex h-full w-[248px] flex-col bg-sidebar">
      {/* Brand */}
      <div className="flex items-center gap-3 px-5 py-6">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-logo text-white">
          <Share2 size={22} />
        </span>
        <div className="min-w-0">
          <div className="truncate text-[19px] font-bold leading-tight text-white">Decoinks</div>
          <div className="truncate text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">
            Printshop CPS
          </div>
        </div>
      </div>

      <nav className="flex-1 space-y-1.5 px-3 py-4">
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end} onClick={onNavigate} className={linkClass}>
            <Icon size={20} />
            <span className="truncate">{label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="space-y-1.5 border-t border-white/10 px-3 py-4">
        <NavLink to="/profile" onClick={onNavigate} className={linkClass}>
          <Settings size={20} />
          <span>Settings</span>
        </NavLink>
        <button
          onClick={signOut}
          className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-[15px] font-medium text-slate-300 transition hover:bg-sidebarHover hover:text-white"
        >
          <LogOut size={20} />
          <span>Logout</span>
        </button>
      </div>
    </div>
  )
}
