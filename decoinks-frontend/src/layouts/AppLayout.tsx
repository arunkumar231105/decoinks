import { useMemo, useState } from 'react'
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom'
import {
  Avatar,
  Badge,
  Box,
  Divider,
  IconButton,
  Menu,
  MenuItem,
  Tooltip,
} from '@mui/material'
import {
  Bell,
  Boxes,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  ClipboardList,
  FileText,
  Home,
  Image,
  Layers3,
  LogOut,
  Menu as MenuIcon,
  Package,
  ReceiptText,
  Settings,
  ShipWheel,
  Sparkles,
  ShoppingCart,
  Truck,
  User,
  UserCheck,
  Users,
} from 'lucide-react'
import { usePageMeta } from '../hooks/usePageMeta'
import { useAuthStore } from '../store/authStore'
import { notReady } from '../utils/actions'
import { cn } from '../utils/cn'
import { ErrorBoundary } from '../components/ErrorBoundary'
import { GlobalSearch } from '../components/GlobalSearch'
import { GlobalImportModal } from '../components/GlobalImportModal'

const mainNav = [
  { label: 'Dashboard', path: '/dashboard', icon: Home },
  { label: 'Leads', path: '/leads', icon: ClipboardList },
  { label: 'Customers', path: '/customers', icon: UserCheck },
  { label: 'Quotes', path: '/quotes', icon: FileText },
  { label: 'Invoices', path: '/invoices', icon: ReceiptText },
  { label: 'Orders', path: '/orders', icon: Package },
  { label: 'Purchase Orders', path: '/purchase-orders', icon: ShoppingCart },
  { label: 'Shipments', path: '/shipments', icon: Truck },
  { label: 'Suppliers', path: '/suppliers', icon: Users },
  { label: 'Products', path: '/products', icon: Boxes },
]

const artworkNav = [
  { label: 'Artwork Vault', path: '/artwork-library', icon: Image },
]

const boardNav = [
  { label: 'Lead Board', path: '/leads/board', icon: Layers3 },
]

const systemNav = [
  { label: 'Users & Roles', path: '/settings/users', icon: Users },
  { label: 'Settings', path: '/settings/general', icon: Settings },
]

function NavGroup({
  title,
  items,
  collapsed,
  onNavigate,
  open,
  onToggle,
}: {
  title: string
  items: typeof mainNav
  collapsed: boolean
  onNavigate: () => void
  open: boolean
  onToggle: () => void
}) {
  return (
    <section className="sidebar-group">
      <button
        type="button"
        className="sidebar-group-trigger"
        onClick={onToggle}
        aria-expanded={open}
      >
        {!collapsed && <span>{title}</span>}
        {!collapsed && (
          <ChevronDown
            size={16}
            className={cn('sidebar-group-chevron', open && 'sidebar-group-chevron-open')}
          />
        )}
      </button>

      <div className={cn('sidebar-links', !open && !collapsed && 'sidebar-links-closed')}>
        {items.map((item) => {
          const Icon = item.icon
          return (
            <Tooltip key={item.label} title={collapsed ? item.label : ''} placement="right">
              <NavLink
                to={item.path}
                onClick={onNavigate}
                className={({ isActive }) =>
                  cn('sidebar-link', isActive && 'sidebar-link-active')
                }
              >
                <Icon size={19} strokeWidth={2} />
                {!collapsed && <span>{item.label}</span>}
              </NavLink>
            </Tooltip>
          )
        })}
      </div>
    </section>
  )
}

export function AppLayout() {
  const [collapsed, setCollapsed] = useState(false)
  const [sectionsOpen, setSectionsOpen] = useState({
    main: true,
    artwork: true,
    boards: true,
    system: true,
  })
  const [userAnchor, setUserAnchor] = useState<null | HTMLElement>(null)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const { title, subtitle } = usePageMeta()
  const { user, logout } = useAuthStore()
  const navigate = useNavigate()

  const initials = useMemo(
    () =>
      user?.name
        .split(' ')
        .map((part) => part[0])
        .join('')
        .slice(0, 2)
        .toUpperCase() ?? 'DK',
    [user?.name],
  )

  const handleLogout = () => {
    logout()
    setUserAnchor(null)
    navigate('/login')
  }

  const toggleSection = (section: keyof typeof sectionsOpen) => {
    setSectionsOpen((value) => ({ ...value, [section]: !value[section] }))
  }

  return (
    <div className="app-shell">
      <aside
        className={cn(
          'sidebar',
          collapsed && 'sidebar-collapsed',
          mobileOpen && 'sidebar-mobile-open',
        )}
      >
        <div className="sidebar-head">
          <Link to="/dashboard" className="brand" onClick={() => setMobileOpen(false)}>
            <div className="brand-logo-wrap">
              <img src="/decoinks-logo.png" alt="Decoinks" className="brand-logo-img" />
              {!collapsed && <small className="brand-sub">Printshop OS</small>}
            </div>
          </Link>
          <button className="sidebar-close" onClick={() => setMobileOpen(false)}>
            <ChevronLeft size={18} />
          </button>
        </div>

        <nav className="sidebar-nav">
          <NavGroup
            title="Main"
            items={mainNav}
            collapsed={collapsed}
            onNavigate={() => setMobileOpen(false)}
            open={sectionsOpen.main}
            onToggle={() => toggleSection('main')}
          />

          <NavGroup
            title="Artwork"
            items={artworkNav}
            collapsed={collapsed}
            onNavigate={() => setMobileOpen(false)}
            open={sectionsOpen.artwork}
            onToggle={() => toggleSection('artwork')}
          />

          <NavGroup
            title="Boards"
            items={boardNav}
            collapsed={collapsed}
            onNavigate={() => setMobileOpen(false)}
            open={sectionsOpen.boards}
            onToggle={() => toggleSection('boards')}
          />

          <NavGroup
            title="System"
            items={systemNav}
            collapsed={collapsed}
            onNavigate={() => setMobileOpen(false)}
            open={sectionsOpen.system}
            onToggle={() => toggleSection('system')}
          />
        </nav>

        <div className="sidebar-footer">
          <button className="profile-card" onClick={(event) => setUserAnchor(event.currentTarget)}>
            <Avatar className="sidebar-avatar">
              {initials}
            </Avatar>
            {!collapsed && (
              <>
                <span className="profile-copy">
                  <strong>{user?.name ?? 'Decoinks User'}</strong>
                  <small>{user?.role ?? 'Admin'}</small>
                </span>
                <ChevronDown size={16} />
              </>
            )}
          </button>
          <Tooltip title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} placement="right">
            <button
              className="collapse-button"
              onClick={() => setCollapsed((value) => !value)}
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
            </button>
          </Tooltip>
        </div>
      </aside>
      {mobileOpen && <button className="sidebar-scrim" onClick={() => setMobileOpen(false)} />}

      <div className="main-column">
        <header className="topbar">
          <IconButton className="mobile-menu" onClick={() => setMobileOpen((value) => !value)}>
            <MenuIcon size={22} />
          </IconButton>
          <div className="page-heading">
            <h1>{title}</h1>
            <p>{subtitle}</p>
          </div>

          <div className="topbar-actions">
            <GlobalSearch />
            <button
              className="lb-action-btn"
              onClick={() => setImportOpen(true)}
              style={{ gap: 6, whiteSpace: 'nowrap' }}
              title="Import any CSV — AI routes it to the right module"
            >
              <Sparkles size={15} /> Import CSV
            </button>
            <Tooltip title="Notifications (Coming Soon)">
              <span>
                <IconButton disabled sx={{ opacity: 0.4 }}>
                  <Bell size={21} />
                </IconButton>
              </span>
            </Tooltip>
            <button className="topbar-user" onClick={(event) => setUserAnchor(event.currentTarget)}>
              <Avatar className="topbar-avatar">
                {initials}
              </Avatar>
              <span>{user?.name ?? 'Arun Kumar'}</span>
              <ChevronDown size={15} />
            </button>
          </div>
        </header>

        <Box component="main" className="content-area">
          <ErrorBoundary>
            <Outlet />
          </ErrorBoundary>
        </Box>
      </div>

      {importOpen && <GlobalImportModal onClose={() => setImportOpen(false)} />}

      <Menu
        anchorEl={userAnchor}
        open={Boolean(userAnchor)}
        onClose={() => setUserAnchor(null)}
        slotProps={{ paper: { sx: { minWidth: 200, mt: 1 } } }}
      >
        {/* User info header */}
        <Box sx={{ px: 2, py: 1.5, borderBottom: '1px solid #f1f5f9' }}>
          <div style={{ fontWeight: 600, fontSize: 14, color: '#0f172a' }}>{user?.name ?? 'User'}</div>
          <div style={{ fontSize: 12, color: '#64748b' }}>{user?.email ?? ''}</div>
          <div style={{ fontSize: 11, color: '#0D9488', fontWeight: 500, marginTop: 2 }}>{user?.role ?? ''}</div>
        </Box>
        <MenuItem onClick={() => { navigate(`/settings/users/${user?.id}`); setUserAnchor(null) }} sx={{ gap: 1.5, mt: 0.5 }}>
          <User size={16} />
          My Profile
        </MenuItem>
        <MenuItem onClick={() => { navigate('/settings/general'); setUserAnchor(null) }} sx={{ gap: 1.5 }}>
          <Settings size={16} />
          Settings
        </MenuItem>
        {user?.role === 'Admin' && (
          <MenuItem onClick={() => { navigate('/settings/users'); setUserAnchor(null) }} sx={{ gap: 1.5 }}>
            <Users size={16} />
            Users &amp; Roles
          </MenuItem>
        )}
        <Divider />
        <MenuItem onClick={handleLogout} sx={{ gap: 1.5, color: '#dc2626' }}>
          <LogOut size={16} />
          Sign Out
        </MenuItem>
      </Menu>
    </div>
  )
}
