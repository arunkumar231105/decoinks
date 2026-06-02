# Decoinks Admin Frontend — UI Layout Audit

Generated: 2026-06-01  
Scope: `decoinks-frontend/src/` — layout & responsiveness only (no business logic changes)

---

## Pages audited

| # | Page | Route |
|---|---|---|
| 1 | AppLayout (sidebar + topbar) | all routes |
| 2 | DashboardPage | /dashboard |
| 3 | LeadsListPage | /leads |
| 4 | LeadBoardPage | /leads/board |
| 5 | AddLeadPage | /leads/new |
| 6 | QuotesListPage | /quotes |
| 7 | NewQuotationPage | /quotes/new, /quotes/:id |
| 8 | WorkflowListPage (Invoices/Orders/POs) | /invoices, /orders, /purchase-orders |
| 9 | NewInvoicePage | /invoices/new |
| 10 | InvoiceDetailPage | /invoices/:id |
| 11 | NewOrderPage | /orders/new |
| 12 | OrderDetailPage | /orders/:id |
| 13 | NewPurchaseOrderPage | /purchase-orders/new |
| 14 | PurchaseOrderDetailPage | /purchase-orders/:id |
| 15 | NewShipmentPage | /shipments/new |
| 16 | ShipmentsPage | /shipments |
| 17 | SuppliersPage | /suppliers |
| 18 | SupplierDetailPage | /suppliers/:id |
| 19 | NewSupplierPage | /suppliers/new |
| 20 | ProductsPage | /products |
| 21 | ArtworkLibraryPage | /artwork-library |
| 22 | ArtworkFormPage | /quotes/:id/artwork |
| 23 | FulfillmentBoardPage | /fulfillment/board |
| 24 | BoardPage | /design/board |
| 25 | SettingsUsersPage | /settings/users |
| 26 | UserEditPage | /settings/users/:id |
| 27 | Settings* pages | /settings/* |
| 28 | LoginPage / ForgotPassword / ResetPassword | auth routes |

---

## Issue Table

| # | Page / CSS class | Problem | Root cause | Fix planned | Fixed |
|---|---|---|---|---|---|
| 1 | AddLeadPage / `.al-body` | 3-panel layout (`al-left` 280px + `al-center` flex-1 + `al-right` 240px) never collapses; `overflow: hidden` clips content at ≤768px | `.al-body` has no `@media` rules; `al-left`/`al-right` have fixed pixel widths with no responsive override | CSS: add `@media` breakpoints to stack panels vertically, remove `overflow:hidden` at mobile | ✅ |
| 2 | AddLeadPage / `.al-grid-2`, `.al-grid-3` | 2- and 3-column form grids never collapse; inputs too narrow at ≤768px | No responsive `@media` on these classes | CSS: collapse to 1 column at ≤640px, 2-col at ≤860px for 3-col grid | ✅ |
| 3 | NewPurchaseOrderPage inline layout | Main + sidebar uses `display:flex` with no `flex-wrap`; sidebar width `260px` `flexShrink:0` never wraps on narrow screens | Inline `style={{ display:'flex' }}` lacks `flex-wrap:wrap` and responsive class | CSS: add `.resp-two-col` utility; replace inline style in page | ✅ |
| 4 | PurchaseOrderDetailPage inline layout | Same pattern as #3; also `gridTemplaoeColumns` (corrupted `gridTemplateColumns`) breaks a 2-col info grid; `animaoion` (corrupted `animation`) breaks spinner | Inline style corruption; no `flex-wrap` | Fix property names + add flex-wrap via `.resp-two-col` | ✅ |
| 5 | DashboardPage bare `<table>` ×2 | Two unstyled tables in `.quick-stats-grid` cells have no scroll wrapper; overflow at ≤640px | Tables lack `overflow-x:auto` wrapper and `min-width` | Wrap in `<div style={{ overflowX:'auto' }}>` | ✅ |
| 6 | SupplierDetailPage orders `<table>` | Table uses `width:100%` inside a card but no scroll wrapper; on narrow widths the many columns squeeze then overflow the card | No `overflow-x:auto` on parent div | Wrap in overflow div | ✅ |
| 7 | NewQuotationPage / `.nq-cinfo-grid` | 3-column customer-info grid never collapses on tablet/mobile | `repeat(3,1fr)` with no `@media` rules on this class | CSS: add 2-col at ≤860px, 1-col at ≤640px | ✅ |
| 8 | DashboardPage / `.quick-stats-grid` | 2-col grid is fine on tablet but never collapses on mobile (≤480px) | No `@media (max-width:640px)` rule | CSS: collapse to 1 col at ≤480px | ✅ |
| 9 | WorkflowListPage / `.wf-table-wrap` | `overflow-x:auto` only set inside `@media (max-width:860px)`; at 900–1366px with wide table content can overflow | Conditional scroll instead of always-on | CSS: move `overflow-x:auto` to base `.wf-table-wrap` rule | ✅ |
| 10 | LeadsListPage / `.cust-table` | Table has no `min-width`; 8 columns collapse/squeeze badly at ≤768px | `.cust-table` is `width:100%` with no minimum | CSS: add `min-width:640px` to `.cust-table` so it scrolls in its wrapper | ✅ |
| 11 | LeadBoardPage list view / `.lb-list-table` | `.lb-list-table` has no `min-width`; 8 columns squeeze unreadably; `.lb-list-view` has `overflow:auto` ready but no min-width to trigger scrolling | No `min-width` on table | CSS: add `min-width:720px` | ✅ |
| 12 | AppLayout sidebar | Already has full mobile/collapse responsive handling; `sidebar-scrim`, `mobile-menu` all wired — no fix needed | — | No change | N/A |
| 13 | NewInvoicePage `.ni-table` | Already has `overflow-x:auto` wrapper + `min-width:860px`; ni-mobile-stack-table applies; already responsive | — | No change | N/A |
| 14 | NewOrderPage `.no-table-wrap` | Already has `overflow-x:auto`; no-body-cols already collapses at 900px | — | No change | N/A |
| 15 | OrderDetailPage `.od-table-wrap` | `overflow-x:auto`; od-body grid collapses at 900px | — | No change | N/A |
| 16 | ShipmentsPage `.sh-table-wrap` | `overflow-x:auto` + responsive at 640px | — | No change | N/A |
| 17 | QuotesListPage `.ql-table-wrap` | `overflow-x:auto`; ql-toolbar responsive at 900px | — | No change | N/A |
| 18 | Settings pages | Simple single-column layouts; headings wrap; no overflow issues | — | No change | N/A |
| 19 | SuppliersPage / `.cust-table-wrap` | `overflow-x:auto` wrapper; table is data-dense but cust-table min-width fix (#10) covers it | — | Covered by #10 | ✅ |
| 20 | ProductsPage / `.cust-table prod-table` | `prod-table { min-width: 860px }` already set in CSS; cust-table-wrap has overflow-x:auto | — | No change | N/A |

---

## Root-cause groups

| Group | Pages affected | Single fix |
|---|---|---|
| A. Tables without min-width (scroll never triggers) | LeadsListPage, LeadBoardPage list view, DashboardPage | Add min-width in index.css |
| B. Multi-column grids missing `@media` breakpoints | AddLeadPage (al-grid-2/3), NewQuotationPage (nq-cinfo-grid), DashboardPage (quick-stats-grid) | Add responsive rules in index.css |
| C. Fixed 3/2-panel layouts with no flex-wrap/collapse | AddLeadPage (al-body/al-left/al-right), NewPurchaseOrderPage, PurchaseOrderDetailPage | Add responsive rules in index.css + `.resp-two-col` utility |
| D. Tables with no scroll wrapper | DashboardPage (2 bare tables), SupplierDetailPage | Wrap in `<div style={{ overflowX:'auto' }}>` in page |
| E. Corruption in style property names | PurchaseOrderDetailPage (`gridTemplaoeColumns`, `animaoion`) | Fix property names in page file |

---

## Files changed

| File | Change |
|---|---|
| `src/index.css` | Added responsive rules: al-body/al-left/al-right/al-grid-2/al-grid-3; nq-cinfo-grid; quick-stats-grid; wf-table-wrap base rule; cust-table/lb-list-table min-width; `.resp-two-col` utility class |
| `src/pages/DashboardPage.tsx` | Wrapped 2 bare `<table>` elements in `<div style={{ overflowX:'auto' }}>` |
| `src/pages/SupplierDetailPage.tsx` | Wrapped orders `<table>` in `<div style={{ overflowX:'auto' }}>` |
| `src/pages/NewPurchaseOrderPage.tsx` | Replaced inline flex wrapper with `.resp-two-col` class; sidebar col uses `.resp-sidebar-col` |
| `src/pages/PurchaseOrderDetailPage.tsx` | Fixed `gridTemplaoeColumns` → `gridTemplateColumns`; fixed `animaoion` → `animation`; `infinioe` → `infinite`; added `.resp-two-col` wrapper class |
