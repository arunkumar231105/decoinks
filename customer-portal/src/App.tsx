import { Navigate, Route, Routes } from 'react-router-dom'
import DashboardPage from './pages/DashboardPage'
import OrderHistoryPage from './pages/OrderHistoryPage'
import ArtworksPage from './pages/ArtworksPage'
import ProfilePage from './pages/ProfilePage'

export default function App() {
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
