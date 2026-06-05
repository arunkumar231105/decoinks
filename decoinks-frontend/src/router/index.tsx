import { Navigate, createBrowserRouter } from 'react-router-dom'
import App from '../App'
import { AppLayout } from '../layouts/AppLayout'
import { ProtectedRoute } from '../layouts/ProtectedRoute'
import { ArtworkFormPage } from '../pages/ArtworkFormPage'
import { BoardPage } from '../pages/BoardPage'
import { DashboardPage } from '../pages/DashboardPage'
import { ForgotPasswordPage } from '../pages/ForgotPasswordPage'
import { AddLeadPage } from '../pages/AddLeadPage'
import { LeadBoardPage } from '../pages/LeadBoardPage'
import { LeadsListPage } from '../pages/LeadsListPage'
import { LoginPage } from '../pages/LoginPage'
import { NewInvoicePage } from '../pages/NewInvoicePage'
import { SuppliersPage } from '../pages/SuppliersPage'
import { FulfillmentBoardPage } from '../pages/FulfillmentBoardPage'
import { NewSupplierPage } from '../pages/NewSupplierPage'
import { NewOrderPage } from '../pages/NewOrderPage'
import { OrderDetailPage } from '../pages/OrderDetailPage'
import { NewShipmentPage } from '../pages/NewShipmentPage'
import { NewPurchaseOrderPage } from '../pages/NewPurchaseOrderPage'
import { PurchaseOrderDetailPage } from '../pages/PurchaseOrderDetailPage'
import { ProductsPage } from '../pages/ProductsPage'
import { ResetPasswordPage } from '../pages/ResetPasswordPage'
import { SettingsGeneralPage } from '../pages/SettingsGeneralPage'
import { SettingsUsersPage } from '../pages/SettingsUsersPage'
import { UserEditPage } from '../pages/UserEditPage'
import { WorkflowListPage } from '../pages/WorkflowListPage'
import { QuotesListPage } from '../pages/QuotesListPage'
import { NewQuotationPage } from '../pages/NewQuotationPage'
import { ShipmentsPage } from '../pages/ShipmentsPage'
import { ArtworkLibraryPage } from '../pages/ArtworkLibraryPage'
import { AIAutomationsPage } from '../pages/AIAutomationsPage'
import { SettingsWorkflowPage } from '../pages/SettingsWorkflowPage'
import { SettingsIntegrationsPage } from '../pages/SettingsIntegrationsPage'
import { SettingsBillingPage } from '../pages/SettingsBillingPage'
import { SetupPage } from '../pages/SetupPage'
import { SupplierDetailPage } from '../pages/SupplierDetailPage'
import { SettingsCustomFieldsPage } from '../pages/SettingsCustomFieldsPage'
import { InvoiceDetailPage } from '../pages/InvoiceDetailPage'
import { QuotePrintPage } from '../pages/QuotePrintPage'
import { InvoicePrintPage } from '../pages/InvoicePrintPage'

export const router = createBrowserRouter([
  {
    element: <App />,
    children: [
      { path: '/setup', element: <SetupPage /> },
      { path: '/login', element: <LoginPage /> },
      { path: '/forgot-password', element: <ForgotPasswordPage /> },
      { path: '/reset-password', element: <ResetPasswordPage /> },
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
                handle: { title: 'Leads', subtitle: 'Track every prospect from first contact to confirmed order.' },
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
                path: '/quotes',
                element: <QuotesListPage />,
                handle: { title: 'Quotes', subtitle: 'Manage and send quotations to customers.' },
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
                handle: { title: 'Orders', subtitle: 'Manage production jobs from intake to delivery.' },
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
                handle: { title: 'Artwork Library', subtitle: 'Create, manage and finalize artworks for leads and orders.' },
              },
              {
                path: '/fulfillment/board',
                element: <FulfillmentBoardPage />,
                handle: {
                  title: 'Fulfillment Board',
                  subtitle: 'Track packing, shipping, and claim readiness.',
                },
              },
              {
                path: '/design/board',
                element: <BoardPage boardName="Design Board" />,
                handle: { title: 'Design Board', subtitle: 'Move artwork through proofing and approval.' },
              },
              {
                path: '/settings/general',
                element: <SettingsGeneralPage />,
                handle: { title: 'General Settings', subtitle: 'Configure company and workflow defaults.' },
              },
              {
                path: '/settings/ai-automations',
                element: <AIAutomationsPage />,
                handle: { title: 'AI Automations', subtitle: 'Configure AI extraction, drafting, and workflow assists.' },
              },
              {
                path: '/settings/workflows',
                element: <SettingsWorkflowPage />,
                handle: { title: 'Workflow Settings', subtitle: 'Control operational rules from lead to delivery.' },
              },
              {
                path: '/settings/integrations',
                element: <SettingsIntegrationsPage />,
                handle: { title: 'Integrations', subtitle: 'Connect chat, email, vendors, shipping, and file tools.' },
              },
              {
                path: '/settings/billing',
                element: <SettingsBillingPage />,
                handle: { title: 'Billing & Tax', subtitle: 'Manage invoice defaults, payments, and finance controls.' },
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
              {
                path: '/settings/custom-fields',
                element: <SettingsCustomFieldsPage />,
                handle: { title: 'Custom Fields', subtitle: 'Define additional fields for leads, quotes, orders, and more.' },
              },
            ],
          },
          // ── Standalone print pages (no AppLayout, no sidebar) ──────────────
          {
            path: '/quotes/:id/print',
            element: <QuotePrintPage />,
          },
          {
            path: '/invoices/:id/print',
            element: <InvoicePrintPage />,
          },
        ],
      },
    ],
  },
])
