/**
 * Placeholder data for the UI phase.
 *
 * Everything here mirrors the shape the customer-facing API will return, so
 * wiring the real endpoints later is a swap of the data source, not a rewrite
 * of the pages.
 */

export type OrderStatus = 'In Production' | 'Shipped' | 'Delivered'
export type PaymentStatus = 'Paid' | 'Partially Paid' | 'Unpaid'

export interface OrderDocument {
  kind: 'Invoice' | 'Sales Order'
  number: string
  fileName: string
  createdOn: string
}

export interface Order {
  id: string
  number: string
  orderDate: string
  orderTime: string
  shipmentDate: string | null
  shipmentTime: string | null
  deliveredOn: string | null
  artworkCount: number
  transfersQty: number
  value: number
  paymentStatus: PaymentStatus
  status: OrderStatus
  orderType: string
  paymentMethod: string
  shippingMethod: string
  trackingNo: string | null
  invoiceNo: string
  salesOrderNo: string
  documents: OrderDocument[]
}

export interface ArtworkUsage {
  orderNo: string
  orderDate: string
  transfersQty: number
}

export interface Artwork {
  id: string
  artworkId: string
  name: string
  fileName: string
  size: string
  transfersQty: number
  fileType: string
  fileSize: string
  dateAdded: string
  timeAdded: string
  createdBy: string
  usedInOrders: ArtworkUsage[]
}

export const CUSTOMER = {
  name: 'John Carter',
  initials: 'JC',
  email: 'john.carter@demo.com',
  phone: '+1 (555) 123-4567',
  jobTitle: 'Owner',
  country: 'United States',
  timeZone: '(GMT-08:00) Pacific Time (US & Canada)',
  status: 'Active',
  customerSince: 'May 12, 2026',
  company: {
    name: 'C.A. Truthwell Collection™',
    contactEmail: 'info@truthwellcollection.com',
    businessType: 'Apparel / Fashion',
    taxId: '12-3456789',
    website: 'https://www.truthwellcollection.com',
    notes: 'Premium apparel brand focused on quality and customer satisfaction.',
  },
  billingAddress: ['John Carter', '123 Main Street', 'Suite 200', 'Los Angeles, CA 90012', 'United States'],
  shippingAddress: ['John Carter', '456 Industrial Ave', 'Unit 5', 'City of Industry, CA 91748', 'United States'],
  social: [
    { network: 'Instagram', handle: '@truthwell.collection' },
    { network: 'Facebook', handle: 'Truthwell Collection' },
    { network: 'TikTok', handle: '@truthwell.collection' },
    { network: 'YouTube', handle: 'Truthwell Collection' },
    { network: 'LinkedIn', handle: 'Truthwell Collection' },
  ],
  communication: { email: true, sms: true, whatsapp: false, phone: false },
  account: {
    totalOrders: 50,
    totalArtworks: 96,
    totalTransfersQty: 1250,
    totalSpent: 2364.1,
    outstanding: 0,
  },
}

const doc = (kind: OrderDocument['kind'], number: string, createdOn: string): OrderDocument => ({
  kind,
  number,
  fileName: `${number}.pdf`,
  createdOn,
})

export const ORDERS: Order[] = [
  {
    id: 'o-44', number: 'OR-2026-0044', orderDate: 'May 02, 2026', orderTime: '09:20 AM',
    shipmentDate: 'May 02, 2026', shipmentTime: '05:15 PM', deliveredOn: 'May 02, 2026',
    artworkCount: 5, transfersQty: 70, value: 96.2, paymentStatus: 'Paid', status: 'Delivered',
    orderType: 'DTF Transfers', paymentMethod: 'Credit Card', shippingMethod: 'UPS Ground',
    trackingNo: '1Z9999AA1234567890', invoiceNo: 'INV-2026-0044', salesOrderNo: 'SO-2026-0044',
    documents: [doc('Invoice', 'INV-2026-0044', 'May 02, 2026'), doc('Sales Order', 'SO-2026-0044', 'May 02, 2026')],
  },
  {
    id: 'o-43', number: 'OR-2026-0043', orderDate: 'Apr 25, 2026', orderTime: '04:10 PM',
    shipmentDate: 'Apr 27, 2026', shipmentTime: '02:35 PM', deliveredOn: 'Apr 29, 2026',
    artworkCount: 3, transfersQty: 30, value: 420, paymentStatus: 'Paid', status: 'Delivered',
    orderType: 'DTF Transfers', paymentMethod: 'Bank Transfer', shippingMethod: 'UPS Ground',
    trackingNo: '1Z9999AA1234567891', invoiceNo: 'INV-2026-0043', salesOrderNo: 'SO-2026-0043',
    documents: [doc('Invoice', 'INV-2026-0043', 'Apr 25, 2026'), doc('Sales Order', 'SO-2026-0043', 'Apr 25, 2026')],
  },
  {
    id: 'o-42', number: 'OR-2026-0042', orderDate: 'Apr 18, 2026', orderTime: '01:30 PM',
    shipmentDate: 'Apr 20, 2026', shipmentTime: '11:20 AM', deliveredOn: null,
    artworkCount: 7, transfersQty: 110, value: 162.8, paymentStatus: 'Paid', status: 'Shipped',
    orderType: 'DTF Transfers', paymentMethod: 'Zelle', shippingMethod: 'UPS Ground',
    trackingNo: '1Z9999AA1234567892', invoiceNo: 'INV-2026-0042', salesOrderNo: 'SO-2026-0042',
    documents: [doc('Invoice', 'INV-2026-0042', 'Apr 18, 2026'), doc('Sales Order', 'SO-2026-0042', 'Apr 18, 2026')],
  },
  {
    id: 'o-41', number: 'OR-2026-0041', orderDate: 'Apr 18, 2026', orderTime: '11:05 AM',
    shipmentDate: 'Apr 19, 2026', shipmentTime: '04:10 PM', deliveredOn: null,
    artworkCount: 4, transfersQty: 60, value: 780, paymentStatus: 'Paid', status: 'Shipped',
    orderType: 'DTF Transfers', paymentMethod: 'Credit Card', shippingMethod: 'UPS 2nd Day Air',
    trackingNo: '1Z9999AA1234567893', invoiceNo: 'INV-2026-0041', salesOrderNo: 'SO-2026-0041',
    documents: [doc('Invoice', 'INV-2026-0041', 'Apr 18, 2026'), doc('Sales Order', 'SO-2026-0041', 'Apr 18, 2026')],
  },
  {
    id: 'o-40', number: 'OR-2026-0040', orderDate: 'Apr 15, 2026', orderTime: '02:45 PM',
    shipmentDate: 'Apr 16, 2026', shipmentTime: '03:25 PM', deliveredOn: 'Apr 18, 2026',
    artworkCount: 6, transfersQty: 95, value: 131.88, paymentStatus: 'Paid', status: 'Delivered',
    orderType: 'DTF Transfers', paymentMethod: 'PayPal', shippingMethod: 'UPS Ground',
    trackingNo: '1Z9999AA1234567894', invoiceNo: 'INV-2026-0040', salesOrderNo: 'SO-2026-0040',
    documents: [doc('Invoice', 'INV-2026-0040', 'Apr 15, 2026'), doc('Sales Order', 'SO-2026-0040', 'Apr 15, 2026')],
  },
  {
    id: 'o-39', number: 'OR-2026-0039', orderDate: 'Apr 05, 2026', orderTime: '09:30 AM',
    shipmentDate: 'Apr 06, 2026', shipmentTime: '01:40 PM', deliveredOn: 'Apr 09, 2026',
    artworkCount: 2, transfersQty: 20, value: 260, paymentStatus: 'Paid', status: 'Delivered',
    orderType: 'DTF Transfers', paymentMethod: 'Credit Card', shippingMethod: 'UPS Ground',
    trackingNo: '1Z9999AA1234567895', invoiceNo: 'INV-2026-0039', salesOrderNo: 'SO-2026-0039',
    documents: [doc('Invoice', 'INV-2026-0039', 'Apr 05, 2026'), doc('Sales Order', 'SO-2026-0039', 'Apr 05, 2026')],
  },
  {
    id: 'o-38', number: 'OR-2026-0038', orderDate: 'Apr 01, 2026', orderTime: '05:25 PM',
    shipmentDate: 'Apr 02, 2026', shipmentTime: '10:50 AM', deliveredOn: 'Apr 04, 2026',
    artworkCount: 4, transfersQty: 55, value: 78.5, paymentStatus: 'Paid', status: 'Delivered',
    orderType: 'DTF Transfers', paymentMethod: 'Cash App', shippingMethod: 'UPS Ground',
    trackingNo: '1Z9999AA1234567896', invoiceNo: 'INV-2026-0038', salesOrderNo: 'SO-2026-0038',
    documents: [doc('Invoice', 'INV-2026-0038', 'Apr 01, 2026'), doc('Sales Order', 'SO-2026-0038', 'Apr 01, 2026')],
  },
  {
    id: 'o-37', number: 'OR-2026-0037', orderDate: 'Mar 28, 2026', orderTime: '10:15 AM',
    shipmentDate: 'Mar 29, 2026', shipmentTime: '03:45 PM', deliveredOn: null,
    artworkCount: 6, transfersQty: 90, value: 123.3, paymentStatus: 'Paid', status: 'Shipped',
    orderType: 'DTF Transfers', paymentMethod: 'Credit Card', shippingMethod: 'UPS Ground',
    trackingNo: '1Z9999AA1234567897', invoiceNo: 'INV-2026-0037', salesOrderNo: 'SO-2026-0037',
    documents: [doc('Invoice', 'INV-2026-0037', 'Mar 28, 2026'), doc('Sales Order', 'SO-2026-0037', 'Mar 28, 2026')],
  },
  {
    id: 'o-36', number: 'OR-2026-0036', orderDate: 'Mar 25, 2026', orderTime: '11:25 AM',
    shipmentDate: 'Mar 26, 2026', shipmentTime: '12:30 PM', deliveredOn: null,
    artworkCount: 8, transfersQty: 160, value: 232, paymentStatus: 'Paid', status: 'In Production',
    orderType: 'DTF Transfers', paymentMethod: 'Bank Transfer', shippingMethod: 'UPS Ground',
    trackingNo: null, invoiceNo: 'INV-2026-0036', salesOrderNo: 'SO-2026-0036',
    documents: [doc('Invoice', 'INV-2026-0036', 'Mar 25, 2026'), doc('Sales Order', 'SO-2026-0036', 'Mar 25, 2026')],
  },
  {
    id: 'o-35', number: 'OR-2026-0035', orderDate: 'Mar 20, 2026', orderTime: '01:15 PM',
    shipmentDate: 'Mar 22, 2026', shipmentTime: null, deliveredOn: null,
    artworkCount: 5, transfersQty: 65, value: 88.4, paymentStatus: 'Paid', status: 'In Production',
    orderType: 'DTF Transfers', paymentMethod: 'Zelle', shippingMethod: 'UPS Ground',
    trackingNo: null, invoiceNo: 'INV-2026-0035', salesOrderNo: 'SO-2026-0035',
    documents: [doc('Invoice', 'INV-2026-0035', 'Mar 20, 2026'), doc('Sales Order', 'SO-2026-0035', 'Mar 20, 2026')],
  },
]

const usage = (orderNo: string, orderDate: string, transfersQty: number): ArtworkUsage => ({ orderNo, orderDate, transfersQty })

export const ARTWORKS: Artwork[] = [
  {
    id: 'a-1', artworkId: 'ART-2026-0158', name: 'Malcolm X Painting', fileName: 'malcolm_x_painting.png',
    size: '11" × 15"', transfersQty: 20, fileType: 'PNG', fileSize: '8.45 MB',
    dateAdded: 'May 02, 2026', timeAdded: '09:18 AM', createdBy: 'John Carter',
    usedInOrders: [
      usage('OR-2026-0044', 'May 02, 2026', 20), usage('OR-2026-0031', 'Apr 28, 2026', 10),
      usage('OR-2026-0022', 'Apr 18, 2026', 10), usage('OR-2026-0015', 'Apr 10, 2026', 5),
      usage('OR-2026-0007', 'Apr 02, 2026', 5), usage('OR-2026-0002', 'Mar 25, 2026', 5),
    ],
  },
  {
    id: 'a-2', artworkId: 'ART-2026-0159', name: 'Juneteenth Celebration', fileName: 'juneteenth_celebration.png',
    size: '11" × 15"', transfersQty: 20, fileType: 'PNG', fileSize: '7.12 MB',
    dateAdded: 'May 02, 2026', timeAdded: '09:20 AM', createdBy: 'John Carter',
    usedInOrders: [usage('OR-2026-0044', 'May 02, 2026', 20)],
  },
  {
    id: 'a-3', artworkId: 'ART-2026-0160', name: 'Betty Boop Sings Blues', fileName: 'betty_boop_sings_blues.png',
    size: '11" × 15"', transfersQty: 20, fileType: 'PNG', fileSize: '9.08 MB',
    dateAdded: 'May 02, 2026', timeAdded: '09:22 AM', createdBy: 'John Carter',
    usedInOrders: [usage('OR-2026-0044', 'May 02, 2026', 20)],
  },
  {
    id: 'a-4', artworkId: 'ART-2026-0161', name: 'Muhammad Ali Greatest', fileName: 'muhammad_ali_greatest.png',
    size: '11" × 15"', transfersQty: 20, fileType: 'PNG', fileSize: '6.75 MB',
    dateAdded: 'May 02, 2026', timeAdded: '09:23 AM', createdBy: 'John Carter',
    usedInOrders: [usage('OR-2026-0044', 'May 02, 2026', 20)],
  },
  {
    id: 'a-5', artworkId: 'ART-2026-0162', name: 'Cowboys Star', fileName: 'cowboys_star.png',
    size: '11" × 11"', transfersQty: 10, fileType: 'PNG', fileSize: '3.21 MB',
    dateAdded: 'May 02, 2026', timeAdded: '09:25 AM', createdBy: 'John Carter',
    usedInOrders: [usage('OR-2026-0044', 'May 02, 2026', 10)],
  },
  {
    id: 'a-6', artworkId: 'ART-2026-0157', name: 'Good Vibes', fileName: 'good_vibes.png',
    size: '10" × 10"', transfersQty: 10, fileType: 'PNG', fileSize: '2.84 MB',
    dateAdded: 'May 01, 2026', timeAdded: '04:15 PM', createdBy: 'John Carter',
    usedInOrders: [usage('OR-2026-0043', 'Apr 25, 2026', 10)],
  },
  {
    id: 'a-7', artworkId: 'ART-2026-0156', name: 'Freedom 1900', fileName: 'freedom_1900.png',
    size: '11" × 15"', transfersQty: 25, fileType: 'PNG', fileSize: '11.24 MB',
    dateAdded: 'Apr 30, 2026', timeAdded: '02:10 PM', createdBy: 'John Carter',
    usedInOrders: [usage('OR-2026-0042', 'Apr 18, 2026', 25)],
  },
  {
    id: 'a-8', artworkId: 'ART-2026-0155', name: 'Harriet Tubman', fileName: 'harriet_tubman.png',
    size: '15" × 18"', transfersQty: 12, fileType: 'PNG', fileSize: '10.31 MB',
    dateAdded: 'Apr 30, 2026', timeAdded: '01:05 PM', createdBy: 'John Carter',
    usedInOrders: [usage('OR-2026-0042', 'Apr 18, 2026', 12)],
  },
  {
    id: 'a-9', artworkId: 'ART-2026-0154', name: 'Bob Marley Get Up', fileName: 'bob_marley_get_up.png',
    size: '15" × 18"', transfersQty: 20, fileType: 'PNG', fileSize: '12.66 MB',
    dateAdded: 'Apr 29, 2026', timeAdded: '11:40 AM', createdBy: 'John Carter',
    usedInOrders: [usage('OR-2026-0041', 'Apr 18, 2026', 20)],
  },
  {
    id: 'a-10', artworkId: 'ART-2026-0153', name: 'I Am Woman', fileName: 'i_am_woman.png',
    size: '11" × 15"', transfersQty: 15, fileType: 'PNG', fileSize: '7.51 MB',
    dateAdded: 'Apr 29, 2026', timeAdded: '10:22 AM', createdBy: 'John Carter',
    usedInOrders: [usage('OR-2026-0041', 'Apr 18, 2026', 15)],
  },
]

/** Headline figures shown on the dashboard / list headers. */
export const SUMMARY = {
  orders: 18,
  artworks: 96,
  transfersQty: 1250,
  orderValue: 2364.1,
  inProduction: 4,
  shipped: 5,
  delivered: 9,
  artworksUsedInOrders: 88,
}

export const money = (n: number) =>
  `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export const num = (n: number) => n.toLocaleString('en-US')
