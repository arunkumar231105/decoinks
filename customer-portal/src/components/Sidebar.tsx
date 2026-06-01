import { NavLink, useNavigate } from 'react-router-dom'
import { Home, ShoppingCart, FileText, Image, User, LogOut } from 'lucide-react'
import { useAuthStore } from '../store/authStore'
import { cn } from '../utils/cn'

const NAV = [
  { to: '/',                label: 'Dashboard',       icon: Home,          end: true },
  { to: '/orders',          label: 'Orders',          icon: ShoppingCart,  end: false },
  { to: '/purchase-orders', label: 'Purchase Orders', icon: FileText,      end: false },
  { to: '/artworks',        label: 'Artworks',        icon: Image,         end: false },
  { to: '/profile',         label: 'Profile',         icon: User,          end: false },
]

export default function Sidebar() {
  const { supplier, logout } = useAuthStore()
  const navigate = useNavigate()

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  return (
    <aside className="fixed left-0 top-0 h-full w-[220px] bg-sidebar flex flex-col z-30">
      {/* Logo */}
      <div className="px-5 py-6 border-b border-white/10">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-accent rounded-lg flex items-center justify-center">
            <span className="text-white font-bold text-sm">D</span>
          </div>
          <div>
            <p className="text-white font-bold text-sm leading-tight">Decoinks</p>
            <p className="text-white/50 text-[10px] uppercase tracking-wide">PRINTSHOP CPS</p>
          </div>
        </div>
      </div>

      {/* Supplier name */}
      {supplier && (
        <div className="px-5 py-3 border-b border-white/10">
          <p className="text-white/40 text-[10px] uppercase tracking-wide mb-0.5">Company</p>
          <p className="text-white text-sm font-medium truncate">{supplier.name}</p>
        </div>
      )}

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors',
                isActive
                  ? 'bg-accent/20 text-white border-l-2 border-accent'
                  : 'text-white/60 hover:text-white hover:bg-white/5',
              )
            }
          >
            <Icon size={16} />
            {label}
          </NavLink>
        ))}
      </nav>

      {/* Logout */}
      <div className="px-3 pb-6">
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-white/60 hover:text-white hover:bg-white/5 transition-colors"
        >
          <LogOut size={16} />
          Logout
        </button>
      </div>
    </aside>
  )
}
