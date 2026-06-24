import { createBrowserRouter, Navigate } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useAuthStore } from '../store/authStore'
import Layout from '../components/Layout'
import LoginPage from '../pages/LoginPage'
import ChangePasswordPage from '../pages/ChangePasswordPage'
import DashboardPage from '../pages/DashboardPage'
import OrdersPage from '../pages/OrdersPage'
import OrderDetailPage from '../pages/OrderDetailPage'
import PurchaseOrdersPage from '../pages/PurchaseOrdersPage'
import PurchaseOrderDetailPage from '../pages/PurchaseOrderDetailPage'
import ArtworksPage from '../pages/ArtworksPage'
import ProfilePage from '../pages/ProfilePage'
import ProductionStatusPage from '../pages/ProductionStatusPage'

function PrivateRoute({ children }: { children: ReactNode }) {
  const token       = useAuthStore((s) => s.token)
  const mustChangePw = useAuthStore((s) => s.mustChangePw)
  if (!token) return <Navigate to="/login" replace />
  if (mustChangePw) return <Navigate to="/change-password" replace />
  return <>{children}</>
}

export const router = createBrowserRouter([
  { path: '/login',           element: <LoginPage /> },
  { path: '/change-password', element: <ChangePasswordPage /> },
  {
    path: '/',
    element: (
      <PrivateRoute>
        <Layout />
      </PrivateRoute>
    ),
    children: [
      { index: true,             element: <DashboardPage /> },
      { path: 'orders',          element: <OrdersPage /> },
      { path: 'orders/:id',      element: <OrderDetailPage /> },
      { path: 'orders/:id/status-updates', element: <ProductionStatusPage /> },
      { path: 'purchase-orders',     element: <PurchaseOrdersPage /> },
      { path: 'purchase-orders/:id', element: <PurchaseOrderDetailPage /> },
      { path: 'artworks',        element: <ArtworksPage /> },
      { path: 'profile',         element: <ProfilePage /> },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
])
