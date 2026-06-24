export interface Order {
  id: string
  order_number: string
  status: string
  order_type: string
  order_date: string
  due_date: string | null
  total: number
  payment_status: string
  sent_at: string
}

export interface OrderDetail extends Order {
  items: ApparelItem[] | GangsheetItem[]
  artworks: Artwork[]
  shipping_name: string | null
  shipping_address: string | null
  notes: string | null
  purchase_order_number: string | null
  vendor_name: string | null
}

export interface ApparelItem {
  id: string
  item: string
  color: string
  qty: number
  front_artwork_id: string | null
  back_artwork_id: string | null
  sleeve_artwork_id: string | null
  label_artwork_id: string | null
}

export interface GangsheetItem {
  id: string
  gangsheet_number: string
  width: string
  height: string
  efficiency: number
  qty: number
}

export interface Artwork {
  id: string
  artwork_number: string
  name: string
  position: string
  width: number
  height: number
  file_url: string
  thumbnail_url: string | null
}

export interface PurchaseOrder {
  id: string
  po_number: string
  status: string
  issue_date: string
  due_date: string | null
  total: number
}

export interface Notification {
  id: string
  type: string
  title: string
  message: string | null
  reference_id: string | null
  is_read: boolean
  created_at: string
}

export interface DashboardData {
  totalOrders: number
  inProduction: number
  shipped: number
  completed: number
  ordersByStatus: { name: string; value: number; color: string }[]
  trendData: { date: string; orders: number }[]
  recentOrders: Order[]
}
