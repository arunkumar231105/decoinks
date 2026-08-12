import { Navigate, Route, Routes } from 'react-router-dom'
import DashboardPage from './pages/DashboardPage'
import OrderHistoryPage from './pages/OrderHistoryPage'
import ArtworksPage from './pages/ArtworksPage'
import ProfilePage from './pages/ProfilePage'
import LoginPage from './pages/LoginPage'
import { useAuth } from './store/auth'

export default function App() {
  const { token } = useAuth()

  // Signed out: the login screen is the only thing reachable.
  if (!token) {
    return (
      <Routes>
        <Route path="*" element={<LoginPage />} />
      </Routes>
    )
  }

  return (
    <Routes>
      <Route path="/" element={<DashboardPage />} />
      <Route path="/orders" element={<OrderHistoryPage />} />
      <Route path="/artworks" element={<ArtworksPage />} />
      <Route path="/profile" element={<ProfilePage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
