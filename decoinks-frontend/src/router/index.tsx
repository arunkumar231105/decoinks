import { lazy, type ComponentType } from 'react'
import { Navigate, createBrowserRouter } from 'react-router-dom'
import App from '../App'
import { AppLayout } from '../layouts/AppLayout'
import { ProtectedRoute } from '../layouts/ProtectedRoute'

// Pages are code-split: each becomes its own chunk loaded on demand, so the
// initial download is just the shell + the first page, not all ~45 screens.
// (React.lazy needs a default export; pages use named exports, hence the map.)
// A redeploy replaces the hashed chunk files this tab was built against, so an
// already-open tab that navigates afterwards hits "Failed to fetch dynamically
// imported module" and used to land on the error screen. Retry once (covers a
// transient network blip), then reload the page so the browser picks up the new
// index.html and the new chunk names. A sessionStorage guard makes sure a
// genuinely broken chunk can never cause a reload loop.
const RELOAD_GUARD = 'decoinks:chunk-reloaded'

export function recoverFromStaleChunk() {
  if (sessionStorage.getItem(RELOAD_GUARD)) return false
  sessionStorage.setItem(RELOAD_GUARD, String(Date.now()))
  window.location.reload()
  return true
}

// Once the app has successfully booted, clear the guard so a future deploy can
// recover again.
window.addEventListener('load', () => {
  setTimeout(() => sessionStorage.removeItem(RELOAD_GUARD), 5_000)
})

const page = <T extends ComponentType<any> = ComponentType<any>>(
  loader: () => Promise<Record<string, unknown>>, name: string,
) => lazy(() =>
  loader()
    .catch(async () => {
      // One quick retry — a momentary network hiccup shouldn't break the route.
      await new Promise((r) => setTimeout(r, 600))
      return loader().catch((err) => {
        // Still failing: the chunk is gone (new deploy). Reload to recover.
        // In-progress form data is safe — drafts live in localStorage.
        if (recoverFromStaleChunk()) return new Promise<never>(() => {})
        throw err
      })
    })
    .then((m) => ({ default: (m as Record<string, unknown>)[name] as T })))

const ArtworkFormPage        = page(() => import('../pages/ArtworkFormPage'), 'ArtworkFormPage')
const DashboardPage          = page(() => import('../pages/DashboardPage'), 'DashboardPage')
const ForgotPasswordPage     = page(() => import('../pages/ForgotPasswordPage'), 'ForgotPasswordPage')
const AddLeadPage            = page(() => import('../pages/AddLeadPage'), 'AddLeadPage')
const LeadBoardPage          = page(() => import('../pages/LeadBoardPage'), 'LeadBoardPage')
const LeadsListPage          = page(() => import('../pages/LeadsListPage'), 'LeadsListPage')
const LoginPage              = page(() => import('../pages/LoginPage'), 'LoginPage')
const NewInvoicePage         = page(() => import('../pages/NewInvoicePage'), 'NewInvoicePage')
const SuppliersPage          = page(() => import('../pages/SuppliersPage'), 'SuppliersPage')
const NewSupplierPage        = page(() => import('../pages/NewSupplierPage'), 'NewSupplierPage')
const NewOrderPage           = page(() => import('../pages/NewOrderPage'), 'NewOrderPage')
const OrderDetailPage        = page(() => import('../pages/OrderDetailPage'), 'OrderDetailPage')
const NewShipmentPage        = page(() => import('../pages/NewShipmentPage'), 'NewShipmentPage')
const NewPurchaseOrderPage   = page(() => import('../pages/NewPurchaseOrderPage'), 'NewPurchaseOrderPage')
const NewPaymentPage         = page(() => import('../pages/NewPaymentPage'), 'NewPaymentPage')
const PurchaseOrderDetailPage= page(() => import('../pages/PurchaseOrderDetailPage'), 'PurchaseOrderDetailPage')
const ProductsPage           = page(() => import('../pages/ProductsPage'), 'ProductsPage')
const ResetPasswordPage      = page(() => import('../pages/ResetPasswordPage'), 'ResetPasswordPage')
const SettingsGeneralPage    = page(() => import('../pages/SettingsGeneralPage'), 'SettingsGeneralPage')
const SettingsUsersPage      = page(() => import('../pages/SettingsUsersPage'), 'SettingsUsersPage')
const UserEditPage           = page(() => import('../pages/UserEditPage'), 'UserEditPage')
const WorkflowListPage       = page(() => import('../pages/WorkflowListPage'), 'WorkflowListPage')
const QuotesListPage         = page(() => import('../pages/QuotesListPage'), 'QuotesListPage')
const NewQuotationPage       = page(() => import('../pages/NewQuotationPage'), 'NewQuotationPage')
const ShipmentsPage          = page(() => import('../pages/ShipmentsPage'), 'ShipmentsPage')
const ArtworkLibraryPage     = page(() => import('../pages/ArtworkLibraryPage'), 'ArtworkLibraryPage')
const SetupPage              = page(() => import('../pages/SetupPage'), 'SetupPage')
const SupplierDetailPage     = page(() => import('../pages/SupplierDetailPage'), 'SupplierDetailPage')
const InvoiceDetailPage      = page(() => import('../pages/InvoiceDetailPage'), 'InvoiceDetailPage')
const QuotePrintPage         = page(() => import('../pages/QuotePrintPage'), 'QuotePrintPage')
const InvoicePrintPage       = page(() => import('../pages/InvoicePrintPage'), 'InvoicePrintPage')
const PurchaseOrderPrintPage = page(() => import('../pages/PurchaseOrderPrintPage'), 'PurchaseOrderPrintPage')
const OrderPrintPage         = page(() => import('../pages/OrderPrintPage'), 'OrderPrintPage')
const InvoiceReceiptPage     = page(() => import('../pages/InvoiceReceiptPage'), 'InvoiceReceiptPage')
const CustomersPage          = page(() => import('../pages/CustomersPage'), 'CustomersPage')
const NewCustomerPage        = page(() => import('../pages/NewCustomerPage'), 'NewCustomerPage')
const CustomerDetailPage     = page(() => import('../pages/CustomerDetailPage'), 'CustomerDetailPage')

export const router = createBrowserRouter([
  {
    element: <App />,
    children: [
      { path: '/setup', element: <SetupPage /> },
      { path: '/login', element: <LoginPage /> },
      { path: '/forgot-password', element: <ForgotPasswordPage /> },
      { path: '/reset-password', element: <ResetPasswordPage /> },
      // ── Standalone print pages (outside ProtectedRoute — handle own silent auth) ──
      {
        path: '/quotes/:id/print',
        element: <QuotePrintPage />,
      },
      {
        path: '/invoices/:id/print',
        element: <InvoicePrintPage />,
      },
      {
        path: '/purchase-orders/:id/print',
        element: <PurchaseOrderPrintPage />,
      },
      {
        path: '/orders/:id/print',
        element: <OrderPrintPage />,
      },
      {
        path: '/invoices/:id/receipt',
        element: <InvoiceReceiptPage />,
      },
      {
        element: <ProtectedRoute />,
        children: [
          {
            element: <AppLayout />,
            children: [
              { index: true, element: <Navigate to="/dashboard" replace /> },
              {
                path: '/dashboard',
                element: <DashboardPage />,
                handle: {
                  title: 'Dashboard',
                  subtitle: 'A clean view of sales, artwork, and production health.',
                },
              },
              {
                path: '/leads',
                element: <LeadsListPage />,
                handle: { title: 'Leads', subtitle: '' },
              },
              {
                path: '/leads/new',
                element: <AddLeadPage />,
                handle: { title: 'New Lead', subtitle: 'Capture customer details and job intent.' },
              },
              {
                path: '/leads/board',
                element: <LeadBoardPage />,
                handle: { title: 'Lead Board', subtitle: 'Kanban view of all leads by stage.' },
              },
              {
                path: '/customers',
                element: <CustomersPage />,
                handle: { title: 'Customers', subtitle: 'Manage customer accounts, contacts, order history and outstanding balances.' },
              },
              {
                path: '/customers/new',
                element: <NewCustomerPage />,
                handle: { title: 'New Customer', subtitle: 'Create a customer profile.' },
              },
              {
                path: '/customers/:id/edit',
                element: <NewCustomerPage />,
                handle: { title: 'Edit Customer', subtitle: 'Update customer profile.' },
              },
              {
                path: '/customers/:id',
                element: <CustomerDetailPage />,
                handle: { title: 'Customer Detail', subtitle: 'View and manage customer information.' },
              },
              {
                path: '/quotes',
                element: <QuotesListPage />,
                handle: { title: 'Quotations', subtitle: 'Manage and track quotations for leads and customers.' },
              },
              {
                path: '/quotes/new',
                element: <NewQuotationPage />,
                handle: { title: 'New Quotation', subtitle: 'Create, review and send quotation to customer.' },
              },
              {
                path: '/quotes/:id',
                element: <NewQuotationPage />,
                handle: { title: 'Edit Quotation', subtitle: 'Review and update the quotation.' },
              },
              {
                path: '/quotes/:id/artwork',
                element: <ArtworkFormPage />,
                handle: { title: 'Artwork Form', subtitle: 'Review files, proofs, and customer approvals.' },
              },
              {
                path: '/invoices',
                element: <WorkflowListPage kind="invoices" />,
                handle: { title: 'Invoices', subtitle: 'Track billing and payment status.' },
              },
              {
                path: '/invoices/new',
                element: <NewInvoicePage />,
                handle: { title: 'New Invoice', subtitle: 'Generate a customer invoice.' },
              },
              {
                path: '/invoices/:id',
                element: <InvoiceDetailPage />,
                handle: { title: 'Invoice Details', subtitle: 'Review invoice details and payment status.' },
              },
              {
                path: '/orders',
                element: <WorkflowListPage kind="orders" />,
                handle: { title: 'Sales Orders', subtitle: 'Manage and track sales orders from confirmation to delivery.' },
              },
              {
                path: '/orders/new',
                element: <NewOrderPage />,
                handle: { title: 'New Order', subtitle: 'Start a print production order.' },
              },
              {
                path: '/orders/:id',
                element: <OrderDetailPage />,
                handle: { title: 'Order Details', subtitle: 'View and manage order details.' },
              },
              {
                path: '/payments',
                element: <WorkflowListPage kind="payments" />,
                handle: { title: 'Payments', subtitle: 'Record and track customer payments.' },
              },
              {
                path: '/payments/new',
                element: <NewPaymentPage />,
                handle: { title: 'New Payment', subtitle: 'Record a customer payment.' },
              },
              {
                path: '/payments/:id',
                element: <NewPaymentPage />,
                handle: { title: 'Edit Payment', subtitle: 'Update a recorded payment.' },
              },
              {
                path: '/purchase-orders',
                element: <WorkflowListPage kind="purchase-orders" />,
                handle: { title: 'Purchase Orders', subtitle: 'Coordinate vendor purchasing.' },
              },
              {
                path: '/purchase-orders/new',
                element: <NewPurchaseOrderPage />,
                handle: { title: 'New Purchase Order', subtitle: 'Request materials from suppliers.' },
              },
              {
                path: '/purchase-orders/:id',
                element: <PurchaseOrderDetailPage />,
                handle: { title: 'Purchase Order Details', subtitle: 'Review vendor order status and materials.' },
              },
              {
                path: '/purchase-orders/:id/edit',
                element: <NewPurchaseOrderPage />,
                handle: { title: 'Edit Purchase Order', subtitle: 'Update vendor order details.' },
              },
              {
                path: '/shipments',
                element: <ShipmentsPage />,
                handle: { title: 'Shipments', subtitle: 'Monitor outgoing packages and pickups.' },
              },
              {
                path: '/shipments/new',
                element: <NewShipmentPage />,
                handle: { title: 'New Shipment', subtitle: 'Prepare a delivery record.' },
              },
              {
                path: '/suppliers',
                element: <SuppliersPage />,
                handle: { title: 'Suppliers', subtitle: 'Find vendor accounts, contacts, and activity.' },
              },
              {
                path: '/suppliers/new',
                element: <NewSupplierPage />,
                handle: { title: 'New Supplier', subtitle: 'Add a vendor supplier account.' },
              },
              {
                path: '/suppliers/:id',
                element: <SupplierDetailPage />,
                handle: { title: 'Supplier Profile', subtitle: 'Review account details and orders.' },
              },
              {
                path: '/products',
                element: <ProductsPage />,
                handle: { title: 'Products', subtitle: 'Manage catalog items and print blanks.' },
              },
              {
                path: '/artwork-library',
                element: <ArtworkLibraryPage />,
                handle: { title: 'Artwork Vault', subtitle: 'Create, manage and finalize artworks for leads and orders.' },
              },
              {
                path: '/settings/general',
                element: <SettingsGeneralPage />,
                handle: { title: 'General Settings', subtitle: 'Configure company and workflow defaults.' },
              },
              {
                path: '/settings/users',
                element: <SettingsUsersPage />,
                handle: { title: 'Users', subtitle: 'Manage access and team roles.' },
              },
              {
                path: '/settings/users/:id',
                element: <UserEditPage />,
                handle: { title: 'Edit User', subtitle: 'Manage user access, roles, and security.' },
              },
            ],
          },
        ],
      },
    ],
  },
])
