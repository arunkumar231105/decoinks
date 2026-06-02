export type UserRole = 'Admin' | 'Manager' | 'Sales' | 'Production' | 'Viewer'

export interface AuthUser {
  id: string
  name: string
  email: string
  role: UserRole
  avatarUrl?: string
}
