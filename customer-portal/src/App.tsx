import { Navigate, Route, Routes } from 'react-router-dom'
import DashboardPage from './pages/DashboardPage'
import OrderHistoryPage from './pages/OrderHistoryPage'
import ArtworksPage from './pages/ArtworksPage'
import ProfilePage from './pages/ProfilePage'
import InvoicesPage from './pages/InvoicesPage'
import InvoiceDetailPage from './pages/InvoiceDetailPage'
import InvoicePrintPage from './pages/InvoicePrintPage'
import PayPage from './pages/PayPage'
import LoginPage from './pages/LoginPage'
import { useAuth } from './store/auth'

export default function App() {
  const { token } = useAuth()

  return (
    <Routes>
      {/*
        The pay page is outside the sign-in gate, above it, on purpose. Its
        token in the URL is its own credential and it must work for a customer
        who was sent a link and has no portal account at all — sending them to
        a login screen would make the link useless. It is listed before the
        signed-out catch-all so that branch cannot swallow it.
      */}
      <Route path="/pay/:token" element={<PayPage />} />

      {token ? (
        <>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/orders" element={<OrderHistoryPage />} />
          <Route path="/artworks" element={<ArtworksPage />} />
          <Route path="/invoices" element={<InvoicesPage />} />
          <Route path="/invoices/:id" element={<InvoiceDetailPage />} />
          <Route path="/invoices/:id/print" element={<InvoicePrintPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </>
      ) : (
        <Route path="*" element={<LoginPage />} />
      )}
    </Routes>
  )
}
