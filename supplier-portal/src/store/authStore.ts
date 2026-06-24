import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface SupplierInfo {
  id: string
  name: string
  email: string
}

interface AuthState {
  token: string | null
  supplier: SupplierInfo | null
  mustChangePw: boolean
  login: (token: string, supplier: SupplierInfo, mustChangePw: boolean) => void
  logout: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      supplier: null,
      mustChangePw: false,
      login: (token, supplier, mustChangePw) => set({ token, supplier, mustChangePw }),
      logout: () => set({ token: null, supplier: null, mustChangePw: false }),
    }),
    { name: 'decoinks-supplier-portal-auth' },
  ),
)
