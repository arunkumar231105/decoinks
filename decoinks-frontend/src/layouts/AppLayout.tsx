import { useEffect, useMemo, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
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
  CircleDollarSign,
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
  KeyRound,
  ShieldAlert,
  Search,
  Download,
  WifiOff,
  LayoutGrid,
  Sun,
  Moon,
  MonitorSmartphone,
} from 'lucide-react'
import { usePageMeta } from '../hooks/usePageMeta'
import { useAuthStore } from '../store/authStore'
import { notReady } from '../utils/actions'
import { cn } from '../utils/cn'
import { ErrorBoundary } from '../components/ErrorBoundary'
import { GlobalSearch } from '../components/GlobalSearch'
import { GlobalImportModal } from '../components/GlobalImportModal'
import { NotificationBell } from '../components/NotificationBell'
import { getThemeMode, setThemeMode, type ThemeMode } from '../utils/themeMode'

const mainNav = [
  { label: 'Dashboard', path: '/dashboard', icon: Home },
  { label: 'Leads', path: '/leads', icon: ClipboardList },
  { label: 'Artwork Vault', path: '/artwork-library', icon: Image },
  { label: 'Customers', path: '/customers', icon: UserCheck },
  { label: 'Quotes', path: '/quotes', icon: FileText },
  { label: 'Invoices', path: '/invoices', icon: ReceiptText },
  { label: 'Orders', path: '/orders', icon: Package },
  { label: 'Payments', path: '/payments', icon: CircleDollarSign },
  { label: 'Purchase Orders', path: '/purchase-orders', icon: ShoppingCart },
  { label: 'Supplier Management', path: '/supplier-management', icon: Truck },
  { label: 'Shipments', path: '/shipments', icon: Truck },
  { label: 'Claims', path: '/claims', icon: ShieldAlert },
  { label: 'Suppliers', path: '/suppliers', icon: Users },
  { label: 'Products', path: '/products', icon: Boxes },
]

const boardNav = [
  { label: 'Lead Board', path: '/leads/board', icon: Layers3 },
]

const systemNav = [
  { label: 'Prompt Management', path: '/prompts', icon: Sparkles },
  { label: 'Users & Roles', path: '/settings/users', icon: Users },
  { label: 'Portal Access', path: '/settings/portal-access', icon: KeyRound },
  { label: 'Settings', path: '/settings/general', icon: Settings },
]

// The phone's tab bar: the four places an agent goes most, and More for the
// rest (it opens the full menu). Hidden on form screens (new / edit), which
// have their own save bar at the bottom.
const tabNav = [
  { label: 'Home', path: '/dashboard', icon: Home },
  { label: 'Orders', path: '/orders', icon: Package },
  { label: 'POs', path: '/purchase-orders', icon: ShoppingCart },
  { label: 'Shipments', path: '/shipments', icon: Truck },
]
const FORM_SCREEN = /\/(new|edit|new-order|link|artwork)$/

// "Add to Home Screen": Chrome/Edge/Android hand over an install prompt; iPhone
// and iPad have none, so the menu says how to do it from Safari's Share button.
type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }
const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || (navigator as any).standalone === true
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

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
            // The tooltip wraps a plain box, not the link: MUI's Tooltip clones its
            // child and merges className with clsx, which drops NavLink's function
            // className — every link lost .sidebar-link and the sidebar fell apart.
            <Tooltip key={item.label} title={collapsed ? item.label : ''} placement="right">
              <div className="sidebar-link-slot">
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
              </div>
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
    boards: true,
    system: true,
  })
  const [userAnchor, setUserAnchor] = useState<null | HTMLElement>(null)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const { title, subtitle } = usePageMeta()
  const { user, logout } = useAuthStore()
  const navigate = useNavigate()
  const location = useLocation()
  const [searchOpen, setSearchOpen] = useState(false)
  const [installPrompt, setInstallPrompt] = useState<InstallPrompt | null>(null)
  const [installed, setInstalled] = useState(isStandalone)
  const [online, setOnline] = useState(() => navigator.onLine)
  const [theme, setTheme] = useState<ThemeMode>(getThemeMode)
  const chooseTheme = (mode: ThemeMode) => { setThemeMode(mode); setTheme(mode) }
  const onFormScreen = FORM_SCREEN.test(location.pathname)

  useEffect(() => {
    const onPrompt = (e: Event) => { e.preventDefault(); setInstallPrompt(e as InstallPrompt) }
    const onInstalled = () => { setInstalled(true); setInstallPrompt(null) }
    const up = () => setOnline(true)
    const down = () => setOnline(false)
    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
      window.removeEventListener('online', up)
      window.removeEventListener('offline', down)
    }
  }, [])
  // Opening the phone search puts the cursor straight in the box.
  useEffect(() => {
    if (searchOpen) window.setTimeout(() => document.querySelector<HTMLInputElement>('.topbar .global-search input')?.focus(), 30)
  }, [searchOpen])
  // A new screen starts with the menu and the phone search closed.
  useEffect(() => { setMobileOpen(false); setSearchOpen(false) }, [location.pathname])

  const installApp = async () => {
    setUserAnchor(null)
    if (installPrompt) {
      await installPrompt.prompt()
      await installPrompt.userChoice.catch(() => null)
      setInstallPrompt(null)
      return
    }
    window.alert(isIos()
      ? 'To install Printshop: open it in Safari, tap the Share button, then "Add to Home Screen".'
      : 'To install Printshop: open the browser menu (⋮) and choose "Install app" or "Add to Home screen".')
  }

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
    <div className={cn('app-shell', onFormScreen && 'app-shell-form', installed && 'app-shell-standalone')}>
      {!online && (
        <div className="app-offline" role="status"><WifiOff size={14} /> You are offline — changes will not save until the connection is back.</div>
      )}
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
        <header className={cn('topbar', searchOpen && 'topbar-search-open')}>
          <IconButton className="mobile-menu" onClick={() => setMobileOpen((value) => !value)}>
            <MenuIcon size={22} />
          </IconButton>
          <div className="page-heading">
            <h1>{title}</h1>
            <p>{subtitle}</p>
          </div>

          <div className="topbar-actions">
            {/* On a phone the search is a button; it opens a full-width row. */}
            <button type="button" className="topbar-search-toggle" aria-label={searchOpen ? 'Close search' : 'Search'}
              aria-expanded={searchOpen} onClick={() => setSearchOpen(v => !v)}>
              <Search size={20} />
            </button>
            <GlobalSearch />
            {!['Leads', 'Quotations', 'Invoices', 'Sales Orders', 'Purchase Orders'].includes(title) && (
              <button
                className="lb-action-btn"
                onClick={() => setImportOpen(true)}
                style={{ gap: 6, whiteSpace: 'nowrap' }}
                title="Import any CSV — AI routes it to the right module"
              >
                <Sparkles size={15} /> Import CSV
              </button>
            )}
            <NotificationBell />
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

      {!onFormScreen && (
        <nav className="app-tabbar" aria-label="Main">
          {tabNav.map(({ label, path, icon: Icon }) => (
            <NavLink key={path} to={path} className={({ isActive }) => cn('app-tab', isActive && 'app-tab-active')}>
              <Icon size={21} strokeWidth={2} />
              <span>{label}</span>
            </NavLink>
          ))}
          <button type="button" className={cn('app-tab', mobileOpen && 'app-tab-active')} onClick={() => setMobileOpen(v => !v)}
            aria-label="More" aria-expanded={mobileOpen}>
            <LayoutGrid size={21} strokeWidth={2} />
            <span>More</span>
          </button>
        </nav>
      )}

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
        {/* Light / Dark / Auto — this browser's own choice. */}
        <Box sx={{ px: 2, pt: 1, pb: 0.5 }}>
          <div className="theme-pick" role="radiogroup" aria-label="Appearance">
            {([['light', 'Light', Sun], ['dark', 'Dark', Moon], ['system', 'Auto', MonitorSmartphone]] as const).map(([mode, label, Icon]) => (
              <button key={mode} type="button" role="radio" aria-checked={theme === mode}
                className={cn('theme-pick-opt', theme === mode && 'on')} onClick={() => chooseTheme(mode)}>
                <Icon size={15} /> {label}
              </button>
            ))}
          </div>
        </Box>
        {!installed && (
          <MenuItem onClick={installApp} sx={{ gap: 1.5 }}>
            <Download size={16} />
            Install app
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
