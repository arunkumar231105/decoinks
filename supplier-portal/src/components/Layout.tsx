import { Outlet, useLocation } from 'react-router-dom'
import Sidebar from './Sidebar'
import TopBar from './TopBar'

const PAGE_TITLES: Record<string, string> = {
  '/':                'Dashboard',
  '/orders':          'Orders',
  '/purchase-orders': 'Purchase Orders',
  '/artworks':        'Artworks',
  '/profile':         'Profile',
}

export default function Layout() {
  const { pathname } = useLocation()
  const title = PAGE_TITLES[pathname] ?? PAGE_TITLES[Object.keys(PAGE_TITLES).find(k => pathname.startsWith(k) && k !== '/') ?? '/'] ?? 'Decoinks'

  return (
    <div className="min-h-screen bg-gray-50">
      <Sidebar />
      <TopBar title={title} />
      <main className="ml-[220px] pt-16 min-h-screen">
        <div className="p-6">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
