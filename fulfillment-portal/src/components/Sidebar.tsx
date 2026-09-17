import { Link, useLocation } from 'react-router-dom'
import {
  BarChart3, Boxes, ClipboardList, FileText, HelpCircle, Home, Package, Settings, Truck, type LucideIcon,
} from 'lucide-react'

/**
 * The navy rail, item for item as the owner's Supplier Order Management design.
 * Full width with labels, or a narrow icon rail when collapsed (desktop only —
 * the mobile drawer always shows labels).
 */

type Item = { to: string; label: string; icon: LucideIcon; isActive?: (path: string) => boolean }

const NAV: Item[] = [
  { to: '/', label: 'Dashboard', icon: Home, isActive: p => p === '/' },
  { to: '/orders', label: 'Orders', icon: ClipboardList },
  // The order grid lives at /purchase-orders (and a PO's page under it);
  // the plain list at /purchase-orders/list belongs to Purchase Orders.
  { to: '/purchase-orders', label: 'Supplier Management', icon: Truck,
    isActive: p => p.startsWith('/purchase-orders') && !p.startsWith('/purchase-orders/list') },
  { to: '/products', label: 'Products', icon: Package },
  { to: '/purchase-orders/list', label: 'Purchase Orders', icon: FileText, isActive: p => p.startsWith('/purchase-orders/list') },
  { to: '/inventory', label: 'Inventory', icon: Boxes },
  // Fulfillment is the production status updates the supplier sends per order.
  { to: '/status-update', label: 'Fulfillment', icon: Truck },
  { to: '/reports', label: 'Reports', icon: BarChart3 },
  { to: '/settings', label: 'Settings', icon: Settings },
]

export function Sidebar({ collapsed = false, onNavigate }: { collapsed?: boolean; onNavigate?: () => void }) {
  const { pathname } = useLocation()

  const itemClass = (active: boolean) => [
    'group flex items-center rounded-lg text-[14px] transition',
    collapsed ? 'h-11 w-11 justify-center [@media(max-height:760px)]:h-9' : 'h-[44px] gap-3 px-3 [@media(max-height:760px)]:h-9',
    active ? 'bg-[#233f8f] text-white' : 'text-slate-200 hover:bg-white/[0.07] hover:text-white',
  ].join(' ')

  return (
    <div className={`flex h-full flex-col bg-sidebar transition-[width] duration-200 ${collapsed ? 'w-[76px]' : 'w-[222px]'}`}>
      {/* Brand */}
      <div className={`flex h-[72px] shrink-0 items-center [@media(max-height:760px)]:h-14 ${collapsed ? 'justify-center' : 'px-5'}`}>
        <Link to="/" onClick={onNavigate} className="select-none text-white" aria-label="decoinks — Dashboard">
          {collapsed
            ? <span className="text-[26px] font-extrabold leading-none tracking-tight">d</span>
            : <span className="text-[27px] font-extrabold leading-none tracking-tight">decoinks</span>}
        </Link>
      </div>

      <nav className={`flex-1 space-y-[3px] overflow-y-auto py-2 ${collapsed ? 'flex flex-col items-center px-2' : 'px-2.5'}`} aria-label="Main">
        {NAV.map(({ to, label, icon: Icon, isActive }) => {
          const active = isActive ? isActive(pathname) : pathname === to || pathname.startsWith(`${to}/`)
          return (
            // A plain Link: which item is current is worked out above (the grid owns
            // PO pages, the list owns /purchase-orders/list), and NavLink would
            // replace that aria-current with its own exact-path match.
            <Link key={to} to={to} onClick={onNavigate} className={itemClass(active)}
              title={collapsed ? label : undefined} aria-current={active ? 'page' : undefined}>
              <Icon size={20} strokeWidth={1.8} className="shrink-0" />
              {!collapsed && <span className="truncate">{label}</span>}
            </Link>
          )
        })}
      </nav>

      <div className={`shrink-0 py-4 [@media(max-height:760px)]:py-2 ${collapsed ? 'flex justify-center px-2' : 'px-3'}`}>
        <div className={`mb-3 border-t border-white/15 ${collapsed ? 'hidden' : 'mx-1'}`} />
        <a href="mailto:support@decoinks.com" className={itemClass(false)} title={collapsed ? 'Help & Support' : undefined}>
          <HelpCircle size={20} strokeWidth={1.8} className="shrink-0" />
          {!collapsed && <span className="truncate">Help &amp; Support</span>}
        </a>
      </div>
    </div>
  )
}
