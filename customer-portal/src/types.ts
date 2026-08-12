/** Shapes returned by the customer-facing API (`/api/portal/*`). */

export type OrderStatus = 'In Production' | 'Shipped' | 'Delivered' | 'Draft' | 'Confirmed' | 'Cancelled'
export type PaymentStatus = 'Paid' | 'Partially Paid' | 'Unpaid'

export interface OrderDocument {
  kind: string
  number: string
  fileName: string
  createdOn: string | null
  url: string | null
}

export interface Order {
  id: string
  number: string
  orderDate: string | null
  orderTime: string | null
  shipmentDate: string | null
  shipmentTime: string | null
  deliveredOn: string | null
  artworkCount: number
  transfersQty: number
  value: number
  paymentStatus: PaymentStatus
  status: OrderStatus
  orderType: string | null
  paymentMethod: string | null
  shippingMethod: string | null
  trackingNo: string | null
  invoiceNo: string | null
  salesOrderNo: string | null
  documents: OrderDocument[]
}

export interface ArtworkUsage {
  orderNo: string
  orderDate: string | null
  transfersQty: number
}

export interface Artwork {
  id: string
  artworkId: string
  name: string
  fileName: string
  previewUrl: string | null
  downloadUrl: string | null
  size: string | null
  transfersQty: number
  fileType: string | null
  fileSize: string | null
  dateAdded: string | null
  timeAdded: string | null
  createdBy: string | null
  usedInOrders: ArtworkUsage[]
}

export interface Summary {
  orders: number
  artworks: number
  transfersQty: number
  orderValue: number
  inProduction: number
  shipped: number
  delivered: number
  artworksUsedInOrders: number
}

export interface Address {
  line1?: string | null
  line2?: string | null
  city?: string | null
  state?: string | null
  zip?: string | null
  country?: string | null
}

export interface Profile {
  name: string
  email: string | null
  phone: string | null
  jobTitle: string | null
  country: string | null
  timeZone: string | null
  status: string | null
  customerSince: string | null
  company: {
    name: string | null
    contactEmail: string | null
    businessType: string | null
    taxId: string | null
    website: string | null
    notes: string | null
  }
  billingAddress: Address | null
  shippingAddress: Address | null
  social: { network: string; handle: string | null }[]
  communication: { email: boolean; sms: boolean; whatsapp: boolean; phone: boolean }
  account: {
    totalOrders: number
    totalArtworks: number
    totalTransfersQty: number
    totalSpent: number
    outstanding: number
  }
}
