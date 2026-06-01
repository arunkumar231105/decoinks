/// <reference types="vite/client" />

declare module 'lucide-react' {
  import type { ComponentType, SVGProps } from 'react'

  export type LucideIcon = ComponentType<SVGProps<SVGSVGElement> & { size?: number | string }>
  export const AlertCircle: LucideIcon
  export const ArrowLeft: LucideIcon
  export const BarChart2: LucideIcon
  export const Bell: LucideIcon
  export const Calendar: LucideIcon
  export const CheckCircle: LucideIcon
  export const CheckCircle2: LucideIcon
  export const ChevronLeft: LucideIcon
  export const ChevronRight: LucideIcon
  export const Clock: LucideIcon
  export const Download: LucideIcon
  export const Eye: LucideIcon
  export const EyeOff: LucideIcon
  export const FileImage: LucideIcon
  export const FileText: LucideIcon
  export const Home: LucideIcon
  export const Image: LucideIcon
  export const LayoutDashboard: LucideIcon
  export const Lock: LucideIcon
  export const LogOut: LucideIcon
  export const Loader2: LucideIcon
  export const Maximize2: LucideIcon
  export const Menu: LucideIcon
  export const Package: LucideIcon
  export const PauseCircle: LucideIcon
  export const Receipt: LucideIcon
  export const RefreshCw: LucideIcon
  export const Search: LucideIcon
  export const Settings: LucideIcon
  export const ShieldCheck: LucideIcon
  export const ShoppingBag: LucideIcon
  export const ShoppingCart: LucideIcon
  export const TrendingDown: LucideIcon
  export const TrendingUp: LucideIcon
  export const Truck: LucideIcon
  export const User: LucideIcon
  export const X: LucideIcon
  export const XCircle: LucideIcon
  export const ZoomIn: LucideIcon
  export const ZoomOut: LucideIcon
}
