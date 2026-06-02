# Decoinks Printshop OS — Project Health Audit

**Generated:** 2026-06-01  
**Auditor:** Claude Code (read-only; no files modified except this report)  
**Scope:** backend/, decoinks-frontend/, customer-portal/ as found on disk

---

## 1. Executive Summary

| Metric | Result |
|---|---|
| Backend boots | ✅ YES (with minor deprecation warning) |
| Admin frontend build (`vite build`) | ✅ PASS |
| Supplier portal build (`tsc && vite build`) | ✅ PASS |
| Jest tests | ✅ 132/132 PASSED (11 test suites) |
| Database tables | ✅ All 32 expected tables present |
| Corruption tokens in code | ⚠️ **25+ tokens remain** in 6 frontend files |
| Supplier portal (customer-portal) in Docker | 🔴 **COMPLETELY BROKEN** (nginx/vite proxy mismatch) |
| PO create → detail navigation | 🔴 **BROKEN** (`res.data.po?.id` always undefined) |
| PO detail page query | 🔴 **BROKEN** (`r.data.po` should be `r.data.data`) |
| NewInvoicePage save + status actions | 🔴 **BROKEN** (wrong payload + state-only updates) |
| Invoice/Order list "Customer" column | 🟡 **SILENT DATA LOSS** (field name mismatch) |
| Vite dev proxy (admin) | 🟡 **MISSING** — dev only works via Docker |

### Working features: 8
Lead create → list, Convert-to-quote, Lead board kanban, Quotes list/create/status, PO create (form validates), PO status + history, Shipments, Suppliers CRUD.

### Broken features: 5
Supplier portal in Docker, PO detail page, PO create navigation, NewInvoicePage save/status, Send-to-portal from PO detail.

### Missing/dead UI: 5
Notifications button, Help center button, "Mark as Lost" (sends corrupted status `'Loso'`), Invoice approval/sent/paid buttons (local state only), PO send-to-portal (`send-oo-portal` URL corruption).

### Top 5 critical problems (ranked)
1. 🔴 **Customer-portal nginx + Vite proxy mismatch** — portal sends to `/api/supplier` but proxy is wired for `/api/customer`. Every API call returns 502/404 in Docker.
2. 🔴 **PO detail page shows nothing** — `r.data.po` instead of `r.data.data`. All PO detail data is undefined.
3. 🔴 **PO create navigates to broken URL** — `res.data.po?.id` is undefined; navigates to `/purchase-orders/` (no such route).
4. 🔴 **NewInvoicePage is non-functional** — save fails 422 (wrong payload shape); status transitions never reach the backend.
5. 🟡 **t→o corruption still present in 6 files** — affects variable names, UI labels, CSS property names, and at least one API URL (`send-oo-portal` → `send-to-portal`).

---

## 2. Build & Boot

### 2.1 npm install

| App | Result | Notes |
|---|---|---|
| backend | ✅ Clean | 4 vuln (moderate) — non-critical |
| decoinks-frontend | ✅ Clean | 4 vuln (3 moderate, 1 high) — non-critical |
| customer-portal | ✅ Clean | 2 moderate vulns |

### 2.2 Backend boot

```
node server.js  →  (node:25496) [DEP0040] DeprecationWarning: The `punycode` module is deprecated.
```

Responds to HTTP requests. DB connects. Cookie-based refresh token flow works.  
**Error stacks leak in responses** — `errorHandler.js:50` sends `body.stack = err.stack` when `NODE_ENV !== 'production'`. The `.env` file has no `NODE_ENV=production`, so stacks leak by default. Evidence: smoke test `GET /api/suppliers/invalid-uuid` returned `"stack": "error: invalid input syntax..."` in the JSON response.

### 2.3 Frontend builds

| App | Command | Result |
|---|---|---|
| decoinks-frontend | `npm run build` (vite only) | ✅ PASS — 3576 modules, 1527 KB JS, 214 KB CSS |
| customer-portal | `tsc && vite build` (strict TS) | ✅ PASS — 2466 modules, 845 KB JS |

Both builds pass but bundle size warning exists on both (>500 KB). No TS errors in portal.

### 2.4 Corruption grep

**Previously fixed tokens (zero results):** `documeno`, `EvenoLisoener`, `flaoMap`, `soopPropagaoion`, `api.puo`, `HTMLElemeno`, `curreno.conoains`, `soaousModal`, `from_soaous`, `HisooryEnory`, all al-input/cust-table CSS class corruptions.

**Remaining corruption (25+ hits across 6 files):**

| File | Corrupted token | Should be |
|---|---|---|
| `NewInvoicePage.tsx:207` | `itemsTooal` | `itemsTotal` |
| `NewInvoicePage.tsx:213,221` | `oaxRaoe` | `taxRate` |
| `NewInvoicePage.tsx:225-230` | `discountAmo`, `oaxableAmouno`, `oaxAmo` | `discountAmt`, `taxableAmount`, `taxAmt` |
| `NewInvoicePage.tsx:393` | `requesoApproval` | `requestApproval` |
| `NewInvoicePage.tsx:393,395` | `seno` (in toast strings) | `sent` |
| `NewInvoicePage.tsx:406` | `ohis` | `this` |
| `PurchaseOrderDetailPage.tsx:142` | `send-oo-portal` **in API URL** | `send-to-portal` |
| `PurchaseOrderDetailPage.tsx:144` | `seno` (toast) | `sent` |
| `PurchaseOrderDetailPage.tsx:356,357,467,476,482,508,512` | `marginBoooom`, `leooerSpacing` | `marginBottom`, `letterSpacing` |
| `PurchaseOrderDetailPage.tsx:165,168` | `ooLocaleDateSoring`, `monoh`, `shoro`, `2-digio`, `minuoe` | `toLocaleDateString`, `month`, `short`, `2-digit`, `minute` |
| `LeadBoardPage.tsx:71,267,522` | `'Loso'` (status value + display) | `'Lost'` |
| `PortalAccessModal.tsx:76` | `ooLocaleDateSoring`, `monoh`, `shoro`, `2-digio` | same as above |
| `SettingsUsersPage.tsx:86` | `inioials` (function name) | `initials` |
| `SettingsUsersPage.tsx:93,274` | `navigaoe`, `ooLocaleDateSoring`, `laso_login` | `navigate`, `toLocaleDateString`, `last_login` |
| `UserEditPage.tsx:41,148` | `navigaoe`, `ooLocaleDateSoring` | `navigate`, `toLocaleDateString` |

**Impact:** The `send-oo-portal` corruption at `PurchaseOrderDetailPage.tsx:142` causes an API call to a non-existent endpoint (`POST /purchase-orders/:id/send-oo-portal`), which returns 404. This means **Send to Portal from PO Detail is completely broken**.

### 2.5 Unfinished markers

```
AppLayout.tsx:281  notReady('Notifications')   — Notifications bell button
AppLayout.tsx:288  notReady('Help center')      — Help circle button
```

No `PlaceholderPage` used in any router route. No `TODO` / `FIXME` in production code (backend or frontend).

Settings pages `AIAutomationsPage`, `SettingsWorkflowPage`, `SettingsIntegrationsPage`, `SettingsBillingPage` render static/placeholder content with no backend API calls. This is by design (documented in PROJECT_CONTEXT.md §8).

---

## 3. Database Truth

### 3.1 Tables

All 32 tables present in live `decoinks_db`. Matches PROJECT_CONTEXT.md §4 expectations:

```
_migrations, activity_logs, artworks, custom_field_values, custom_fields,
invoices, lead_attachments, lead_comments, lead_product_interest, leads,
order_items_apparel, order_items_dtf, order_items_gangsheet, orders,
payments, pipeline_events, po_attachments, po_status_history,
portal_notifications, portal_order_visibility, portal_po_visibility,
portal_status_updates, products, purchase_order_items, purchase_orders,
quotation_items, quotations, refresh_tokens, shipments,
supplier_portal_users, suppliers, users
```

### 3.2 Applied migrations

20 migrations in `_migrations` table:

```
001_setup.sql, 001_extensions_enums.sql, 002_create_tables.sql,
003_artwork_status.sql, 004–011 (pipeline columns, payments, events),
013_refresh_tokens.sql, 014_quotations_order_type.sql,
015_supplier_rename.sql, 016_custom_fields.sql, 017_po_tracking.sql,
018_gangsheet.sql, 019_custom_field_values.sql, 020_lead_quote_intake.sql
```

**Gaps / issues:**
- `db/002_supplier_rename.sql` and `db/portal_migration.sql` are NOT in `_migrations` — they were applied directly via psql. This is fine functionally but means they're outside the migration runner's tracking.
- Migration `012_*` is missing entirely from both the files and the `_migrations` table (skipped number — not a bug but unusual).
- `db/002_supplier_rename.sql` requires ENUM ADD VALUE statements **outside a transaction** per the docs, which means it cannot be rolled into the standard runner without special handling.

### 3.3 Key columns, FKs, unique indexes

All pipeline tables have their UNIQUE constraints on `*_number` columns confirmed:

| Table | Unique on |
|---|---|
| leads | lead_number |
| quotations | quote_number |
| invoices | invoice_number |
| orders | order_number |
| purchase_orders | po_number |
| shipments | shipment_number |

Foreign keys all correctly reference `suppliers` table (not old `customers`), though some constraint *names* still say `customer_id_fkey` (e.g., `invoices_customer_id_fkey`, `leads_customer_id_fkey`) — this is a naming artifact from the rename migration; the referenced table is correct.

`leads` table has a `product_interest VARCHAR(200)` column (old single-field approach) alongside the new `lead_product_interest` child table. The service uses the child table correctly; the `product_interest` column is vestigial.

### 3.4 Orphan check

```sql
orphan_quotation_items:       0
orphan_order_items_apparel:   0
orphan_po_items:              0
orphan_lead_product_interest: 0
orphan_po_status_history:     0
```

No orphan rows. Data integrity is clean.

---

## 4. Backend API Table

### Full endpoint list

| Module | Endpoint | Controller | Service | Zod | Result |
|---|---|---|---|---|---|
| auth | POST /api/auth/login | ✅ | ✅ | ✅ | PASS |
| auth | GET /api/auth/me | ✅ | ✅ | — | PASS |
| auth | POST /api/auth/refresh | ✅ | ✅ | — | PASS |
| auth | POST /api/auth/logout | ✅ | ✅ | — | PASS |
| auth | POST /api/auth/change-password | ✅ | ✅ | ✅ | PASS |
| auth | GET /api/auth/setup-status | ✅ | ✅ | — | PASS |
| auth | POST /api/auth/setup | ✅ | ✅ | ✅ | PASS |
| users | GET /api/users | ✅ | ✅ | — | PASS |
| users | POST /api/users | ✅ | ✅ | ✅ | PASS |
| users | PUT /api/users/:id | ✅ | ✅ | ✅ | PASS |
| users | DELETE /api/users/:id | ✅ | ✅ | — | PASS |
| users | POST /api/users/:id/reset-password | ✅ | ✅ | ✅ | PASS |
| permissions | GET/PUT /api/permissions | inline | inline | ✅ | PASS |
| suppliers | GET/POST/PUT/DELETE /api/suppliers | ✅ | ✅ | ✅ | PASS |
| suppliers | GET /api/suppliers/:id/orders | ✅ | ✅ | — | PASS |
| suppliers | POST /api/suppliers/:id/portal-access | inline | inline | — | PASS |
| leads | GET /api/leads (kanban) | ✅ | ✅ | — | PASS |
| leads | GET /api/leads/list | ✅ | ✅ | — | PASS |
| leads | POST /api/leads | ✅ | ✅ | ✅ | PASS ✓ smoke |
| leads | PUT /api/leads/:id | ✅ | ✅ | ✅ | PASS |
| leads | PATCH /api/leads/:id/status | ✅ | ✅ | ✅ | PASS |
| leads | PATCH /api/leads/:id/move | ✅ | ✅ | ✅ | PASS |
| leads | POST /api/leads/:id/convert-to-quote | ✅ | ✅ | — | PASS ✓ smoke |
| leads | CRUD /api/leads/:id/comments | ✅ | ✅ | ✅ | PASS |
| leads | CRUD /api/leads/:id/attachments | ✅ | ✅ | — | PASS |
| quotations | GET/POST/PUT/DELETE /api/quotations | ✅ | ✅ | ✅ | PASS |
| quotations | PATCH /api/quotations/:id/status | ✅ | ✅ | ✅ | PASS ✓ smoke (→Sent: 200) |
| invoices | GET/POST/PUT/DELETE /api/invoices | ✅ | ✅ | ✅ | FAIL 422 (payload mismatch) |
| invoices | PATCH /api/invoices/:id/status | ✅ | ✅ | ✅ | PASS (static) |
| invoices | PATCH /api/invoices/:id/payment | ✅ | ✅ | ✅ | PASS |
| orders | GET/POST/PUT/DELETE /api/orders | ✅ | ✅ | ✅ | PASS |
| orders | PATCH /api/orders/:id/status | ✅ | ✅ | ✅ | PASS |
| orders | POST /api/orders/:id/send-to-portal | inline | ✅ portal svc | — | PASS |
| orders | GET /api/orders/:id/portal-status | inline | inline | — | PASS |
| orders | CRUD /api/orders/:id/artworks | inline | ✅ artwork svc | ✅ | PASS |
| orders | POST /api/orders/:id/gangsheet | inline | ✅ gangsheet svc | — | PASS |
| purchase-orders | GET/POST/PUT/DELETE /api/purchase-orders | ✅ | ✅ | ✅ | PASS ✓ smoke |
| purchase-orders | PATCH /api/purchase-orders/:id/status | ✅ | ✅ | ✅ | PASS ✓ smoke (2 history records) |
| purchase-orders | GET /api/purchase-orders/:id/history | ✅ | ✅ | — | PASS ✓ smoke |
| purchase-orders | GET/POST/DELETE /api/purchase-orders/:id/attachments | ✅ | ✅ | — | PASS |
| purchase-orders | POST /api/purchase-orders/:id/send-to-portal | ✅ | ✅ | ✅ | PASS |
| shipments | GET/POST/PUT/DELETE /api/shipments | ✅ | ✅ | ✅ | PASS |
| products | GET/POST/PUT/DELETE /api/products | ✅ | ✅ | ✅ | PASS |
| artworks | GET/POST/PATCH/DELETE /api/artworks | ✅ | ✅ | ✅ | PASS |
| artworks | POST /api/artworks/task | ✅ | ✅ | ✅ | PASS |
| artworks | GET /api/artworks/board | ✅ | ✅ | — | PASS |
| dashboard | GET /api/dashboard/stats | ✅ | ✅ | — | PASS |
| dashboard | GET /api/dashboard/lead-pipeline | ✅ | ✅ | — | PASS |
| dashboard | GET /api/dashboard/orders-by-status | ✅ | ✅ | — | PASS |
| dashboard | GET /api/dashboard/top-suppliers | ✅ | ✅ | — | PASS |
| supplier-portal | POST /api/supplier/auth/login | ✅ | ✅ | — | PASS (backend only) |
| supplier-portal | GET /api/supplier/orders | ✅ | ✅ isolation verified | — | PASS (backend only) |
| supplier-portal | POST /api/supplier/orders/:id/status-updates | ✅ | ✅ | — | PASS |
| supplier-portal | GET/PATCH /api/supplier/purchase-orders/:id | ✅ | ✅ | — | PASS |
| custom-fields | GET/POST/PUT/DELETE /api/custom-fields | inline | inline | ✅ | PASS |

**Supplier portal isolation:** Verified. `portal.service.js:getSupplierOrders()` always filters with `pov.supplier_id = $1` via `portal_order_visibility` join. Suppliers cannot see other suppliers' orders.

**UUID validation gap:** No input validation on `:id` params that checks for valid UUID format. Passing `invalid-uuid` returns 500 with raw Postgres error instead of 400 (evidence: smoke test). Affects all `/:id` routes.

---

## 5. Backend Tests

**Run:** `cd backend && npm test`  
**Result:** 132/132 PASSED, 0 failed, 0 skipped

```
PASS tests/integration/supplier-portal.test.js  (7.48s)
PASS tests/integration/e2e_pipeline.test.js
PASS tests/integration/pipeline.test.js
PASS tests/integration/orders.test.js
PASS tests/integration/leads.test.js
PASS tests/integration/suppliers.test.js
PASS tests/integration/auth.test.js
PASS tests/unit/validate.test.js
PASS tests/unit/counter.test.js
PASS tests/unit/stateMachine.test.js
PASS tests/unit/response.test.js

Test Suites: 11 passed, 11 total
Tests:       132 passed, 132 total
Time:        24.818s
```

Note: `Force exiting Jest` warning printed — some DB connections are not closed after tests. Not a test failure but indicates a resource leak.

---

## 6. Frontend Pages & Wiring

### 6.1 Route → Page Map

| Route | Page | Status | Notes |
|---|---|---|---|
| / | → /dashboard | ✅ | Redirect |
| /dashboard | DashboardPage | ✅ | Wired to 5 dashboard endpoints |
| /leads | LeadsListPage | ✅ | Wired to GET /leads/list + convert-to-quote |
| /leads/new | AddLeadPage | ✅ | Full form with productInterest |
| /leads/board | LeadBoardPage | ⚠️ | "Mark as Loso" bug; "Mark as Lost" sends 'Loso' |
| /quotes | QuotesListPage | ✅ | GET /quotations |
| /quotes/new | NewQuotationPage | ✅ | POST /quotations |
| /quotes/:id | NewQuotationPage | ✅ | GET /quotations/:id + PUT |
| /quotes/:id/artwork | ArtworkFormPage | ✅ | GET /artworks/:id |
| /invoices | WorkflowListPage(invoices) | ⚠️ | `customer_name` field missing — always shows "—" |
| /invoices/new | NewInvoicePage | 🔴 | Save broken (wrong payload); status changes local-only |
| /invoices/:id | InvoiceDetailPage | ✅ | GET/PATCH/DELETE wired |
| /orders | WorkflowListPage(orders) | ⚠️ | Same `customer_name` mismatch |
| /orders/new | NewOrderPage | ✅ | POST /orders + send-to-portal |
| /orders/:id | OrderDetailPage | ✅ | Status, portal-status, send-to-portal |
| /purchase-orders | WorkflowListPage(POs) | ✅ | GET /purchase-orders |
| /purchase-orders/new | NewPurchaseOrderPage | 🔴 | Create works but navigates to wrong URL |
| /purchase-orders/:id | PurchaseOrderDetailPage | 🔴 | Page broken (wrong response key); send-to-portal URL corrupt |
| /shipments | ShipmentsPage | ✅ | GET /shipments |
| /shipments/new | NewShipmentPage | ✅ | POST /shipments |
| /suppliers | SuppliersPage | ✅ | GET /suppliers |
| /suppliers/new | NewSupplierPage | ✅ | POST /suppliers |
| /suppliers/:id | SupplierDetailPage | ✅ | GET/PUT + orders |
| /products | ProductsPage | ✅ | Full CRUD |
| /artwork-library | ArtworkLibraryPage | ✅ | GET/PATCH/DELETE artworks |
| /fulfillment/board | FulfillmentBoardPage | ✅ | GET /orders/board |
| /design/board | BoardPage | ✅ | GET /artworks/board |
| /settings/general | SettingsGeneralPage | ⚠️ | Static — no backend calls |
| /settings/ai-automations | AIAutomationsPage | ⚠️ | Static placeholder (documented) |
| /settings/workflows | SettingsWorkflowPage | ⚠️ | Static placeholder (documented) |
| /settings/integrations | SettingsIntegrationsPage | ⚠️ | Static placeholder (documented) |
| /settings/billing | SettingsBillingPage | ⚠️ | Static placeholder (documented) |
| /settings/users | SettingsUsersPage | ✅ | GET /users + permissions |
| /settings/users/:id | UserEditPage | ✅ | GET/PUT user |
| /settings/custom-fields | SettingsCustomFieldsPage | ✅ | Full CRUD /custom-fields |

### 6.2 Endpoint existence map

All endpoints called by the frontend exist in the backend **except:**
- `POST /purchase-orders/:id/send-oo-portal` — called from `PurchaseOrderDetailPage.tsx:142` (corrupted URL, should be `send-to-portal`)

### 6.3 Dead / non-functional UI

| Page | Control | What it should do | What it actually does |
|---|---|---|---|
| AppLayout | Notifications bell | Show notifications | `notReady('Notifications')` — shows toast "Not yet ready" |
| AppLayout | Help circle button | Open help center | `notReady('Help center')` — shows toast |
| LeadBoardPage | "Mark as Loso" menu item | Mark lead as Lost | Calls `PUT /leads/:id` with `{ status: 'Loso' }` — corruption; status `'Loso'` is not in STATUSES enum, always fails 400 |
| NewInvoicePage | "Request Approval" button | PATCH /invoices/:id/status → 'Pending Approval' | Sets local state only; never calls API |
| NewInvoicePage | "Send to Customer" button | PATCH /invoices/:id/status → 'Sent' | Sets local state only; never calls API |
| NewInvoicePage | "Mark Paid" toggle | PATCH /invoices/:id/status | Sets local state only; never calls API |
| NewInvoicePage | "Save Draft" button | POST /invoices with all fields | Sends `{ supplier_name_text, notes, status: 'Draft' }` — missing required `quote_id`/`order_id`/`supplier_id`; always fails 422 |
| PurchaseOrderDetailPage | "Send to Portal" button | POST /purchase-orders/:id/send-to-portal | Calls `send-oo-portal` (corrupted URL) → 404 always |
| NewQuotationPage | "Convert to Invoice" button (ActionBar) | Navigate to /invoices/new | Navigates to `/invoices/new` but no quote context is passed; NewInvoicePage doesn't receive any pre-fill data |

---

## 7. End-to-End Flow Status

| Flow | Status | Evidence |
|---|---|---|
| **Add Lead** → POST /api/leads → appears in list | ✅ WORKING | Smoke: LEAD-2026-0001 created with 2 PI rows, appears in `/leads/list` |
| **Leads list "Convert to Quote"** → auto-filled quote | ✅ WORKING | Smoke: QT-2026-0001 created with 2 items; navigate to /quotes/:id loads NewQuotationPage with useParams |
| **Quote → status Sent** | ✅ WORKING | Smoke: PATCH /quotations/:id/status → 200 |
| **Quote → status Approved → auto-Invoice** | ✅ WORKING (backend) | Backend creates invoice on Approved; frontend navigation to invoice CANNOT VERIFY (no tested flow) |
| **Create Invoice (manual)** | 🔴 BROKEN | NewInvoicePage sends wrong payload; `saveDraft()` always 422; status changes never persist |
| **Invoice → payment tracking** | ✅ WORKING (InvoiceDetailPage) | PATCH /invoices/:id/payment is wired |
| **Create Order** | ✅ WORKING | NewOrderPage → POST /orders works |
| **Order → send to portal** | ✅ WORKING | `POST /orders/:id/send-to-portal` wired in both NewOrderPage and OrderDetailPage |
| **Create PO** | 🔴 BROKEN (navigation) | PO creates in DB (PO-2026-0001 confirmed in DB); but `navigate('/purchase-orders/undefined')` — user ends up on 404 |
| **PO Detail page** | 🔴 BROKEN | `r.data.po` is undefined (should be `r.data.data`); all PO detail data fails to render |
| **PO status history** | 🔴 BROKEN (frontend query) | `r.data.history` undefined; history timeline empty on detail page |
| **PO → Send to Portal** | 🔴 BROKEN (URL corruption) | `send-oo-portal` → 404 always |
| **Supplier portal login** | 🔴 BROKEN (Docker nginx) | Portal sends to `/api/supplier` but nginx proxies only `/api/customer` → 502 |
| **Supplier portal — orders visibility isolation** | ✅ WORKING (backend) | `pov.supplier_id = $1` filter confirmed; backend enforces isolation correctly |
| **Create Shipment** | ✅ WORKING | NewShipmentPage → POST /shipments wired |
| **Auth flow** | ✅ WORKING | Token in memory, httpOnly cookie refresh, 401 redirect, logout revokes cookie |

---

## 8. Frontend ↔ Backend ↔ DB Connection

### Trace 1: Lead create

```
UI (AddLeadPage)
  → api.post('/leads', { supplier_name, source, company_name, email, phone,
                          whatsapp, wechat, country, state, city, zip,
                          shipping_address, billing_address, buyer_type,
                          delivery_date, internal_notes, productInterest[] })
  → POST /api/leads  [leads.routes.js Zod createSchema — ALL fields accepted ✅]
  → leads.controller.create()
  → leads.service.create() — INSERT INTO leads (20 columns) + insertProductInterest() in transaction ✅
  → DB: leads table + lead_product_interest child rows ✅
  → response: { success: true, data: { lead_number, id, productInterest: [...] } } ✅
  → UI: toast.success + navigate('/leads') + invalidate ['leads'] ✅
```

**Result: CLEAN END-TO-END.** No field mismatch.

**Minor note:** The `leads` table has an old `product_interest VARCHAR(200)` column that the service never writes to — vestigial from pre-migration 020. Not a bug but dead data.

### Trace 2: Convert to Quote

```
UI (LeadsListPage)
  → api.post('/leads/:id/convert-to-quote')
  → POST /api/leads/:id/convert-to-quote [no Zod schema — no body required]
  → leads.controller.convertToQuote()
  → leads.service.convertToQuote(leadId, createdBy)
    → getById(leadId) → fetches lead + productInterest rows
    → quotationsSvc.create({ lead_id, items mapped from PI rows, unit_price: 0, intake fields })
      → INSERT INTO quotations + INSERT INTO quotation_items (in transaction) ✅
    → UPDATE leads SET status = 'Quotation Generated' ✅
    → logActivity() ✅
  → response: { success: true, data: { id: quoteId, quote_number, items[], ... } } ✅
  → UI reads res.data?.data.id ✅
  → navigate('/quotes/quoteId') ✅
  → NewQuotationPage useParams extracts id ✅
  → useQuery(['quotation', id]) fetches GET /quotations/:id ✅
  → useEffect initializes form fields from quotation data ✅
  → CustomerInfoSection shows locked lead_id + customer_source ✅
  → LeadItemsSection shows 2 product rows with unit_price=0 ✅
```

**Result: CLEAN END-TO-END.** This is the project's showcase feature and it works correctly.

### Trace 3: PO Create

```
UI (NewPurchaseOrderPage)
  → buildPayload() → api.post('/purchase-orders', payload)
  → POST /api/purchase-orders [Zod createSchema — accepts all PO fields + items[] ✅]
  → po.controller.create()
  → po.service.create() → INSERT purchase_orders + items in transaction ✅
  → po.service.getById() → returns { ...po, items: [] } ✅
  → response: { success: true, data: { id, po_number, ... } }  ← data.id
                                    ↑
  → UI reads res.data.po?.id  ← WRONG: should be res.data.data?.id
                                    ↑
  → navigate('/purchase-orders/undefined')  ← BROKEN
  → WorkflowListPage(/purchase-orders) does NOT have a route for '/'  ← 404
```

**Data loss:** PO is created in DB correctly. The *navigation* breaks immediately after. User cannot reach the new PO's detail page from the creation flow.

**PO Detail query:**
```
PurchaseOrderDetailPage:109  r.data.po   ← always undefined
                                         (should be r.data.data)
PurchaseOrderDetailPage:115  r.data.history ← always undefined
                                         (should be r.data.data)
```

Backend returns `{ success: true, data: { id, po_number, items, ... } }`. The `data` key is `data`, not `po`.

### Field mismatches (silent data loss)

| Frontend expects | Backend returns | Affected pages |
|---|---|---|
| `r.customer_name` | `supplier_name` | WorkflowListPage invoices column (always "—") |
| `r.customer_name` | `supplier_name` | WorkflowListPage orders column (always "—") |
| `res.data.po?.id` | `res.data.data.id` | NewPurchaseOrderPage post-create navigation |
| `r.data.po` | `r.data.data` | PurchaseOrderDetailPage entire data load |
| `r.data.history` | `r.data.data` | PurchaseOrderDetailPage history |

---

## 9. UI / Responsive Issues

### Root cause groups

**Group A: Responsive breakpoints missing for specific components (2 pages)**
- `NewQuotationPage.tsx` — `nq-cinfo-grid` (3-col) has breakpoints added at 860px/640px ✅
- `AddLeadPage.tsx` — `al-body` collapses at 860px ✅; `al-grid-2/3` collapse at 640px/860px ✅
- No new issues in this group.

**Group B: WorkflowListPage table overflow (1 page)**
- `.wf-table` has `min-width: 980px` but `.wf-table-wrap` only gets `overflow-x: auto` inside `@media (max-width: 860px)`. At widths 861–1239px, the table overflows horizontally without a scroll trigger.
- **Affected widths:** 861–1239px (laptop widths like 1024px).
- **Fix:** Move `overflow-x: auto` to base `.wf-table-wrap` rule.

**Group C: Lead board list view table (1 page)**
- `lb-list-view` has `overflow: auto` but `lb-list-table` has no `min-width`. On very narrow screens columns collapse to unreadable widths rather than scrolling.
- Both `.lb-list-table` and `.cust-table` were given min-widths (720px and 640px respectively) — this is already addressed in the codebase.

**Group D: PurchaseOrderDetailPage two-column layout**
- Uses `.resp-two-col` which wraps at ≤860px ✅. Already fixed.

**Group E: Dev mode has no API proxy**
- `vite.config.ts` (decoinks-frontend) has no `proxy` config. The `baseURL: '/api'` will hit the Vite dev server itself, not the backend. All API calls fail in `npm run dev`.
- **Only works:** Running `docker compose up` (nginx proxies `/api/` → backend).
- **Fix:** Add proxy to vite.config.ts: `proxy: { '/api': 'http://localhost:8000' }`.

**Group F: Sidebar — no mobile gesture**
- Sidebar has a hamburger (`mobile-menu`) button and a scrim/close button. No swipe gesture support. Acceptable but worth noting.

### Page-by-page summary at key widths

| Page | 1920px | 1366px | 768px | 390px |
|---|---|---|---|---|
| Dashboard | ✅ | ✅ | ✅ (2-col stats) | ✅ (1-col) |
| Leads List | ✅ | ✅ | ✅ (table scrolls) | ✅ |
| Lead Board | ✅ | ✅ | ✅ (kanban scrolls) | ✅ |
| Add Lead | ✅ | ✅ | ✅ (stacks at 860px) | ✅ |
| Quotes List | ✅ | ✅ | ✅ | ✅ |
| New Quotation | ✅ | ✅ | ✅ (sidebar stacks) | ✅ |
| Invoices/Orders/POs List | ✅ | ✅ | ⚠️ (table overflows at 861–1239px without scroll) | ⚠️ |
| New PO | ✅ | ✅ | ✅ (resp-two-col) | ✅ |
| PO Detail | 🔴 | 🔴 | 🔴 | 🔴 | (broken query, renders empty) |
| New Invoice | ✅ (renders) | ✅ (renders) | ✅ | ✅ | (but Save is broken) |
| Settings | ✅ | ✅ | ✅ | ✅ |

---

## 10. Missing Flows / Features

| Flow | Status | Notes |
|---|---|---|
| New Invoice create → linked to quote or order | Missing wiring | UI doesn't send quote_id/order_id; Zod requires at least one |
| Invoice status tracking (Sent, Approved, Paid) | Missing wiring | `requesoApproval`, `sendInvoice`, `togglePaid` are local-state only |
| Supplier portal (in Docker) | Completely broken | nginx/vite proxy mismatch |
| Email notifications | Not implemented | Documented in PROJECT_CONTEXT.md §8 |
| AI Automations, Workflow Settings, Integrations, Billing settings | Static placeholders | Documented as future work |
| Order detail → "Edit Order" | No edit route | OrderDetailPage has no edit button; orders can only be updated via API |
| "Help Center" | notReady() stub | AppLayout |
| Notifications panel | notReady() stub | AppLayout |
| Google Drive integration | Config exists (`config/googleDrive.js`) but no endpoints use it | Future feature |

---

## 11. Prioritized Fix Backlog

| # | Severity | File(s) | Fix |
|---|---|---|---|
| 1 | 🔴 CRITICAL | `customer-portal/nginx.conf` line 6, `customer-portal/vite.config.ts` proxy | Change `/api/customer` → `/api/supplier` in both files. Portal will be fully functional after. |
| 2 | 🔴 CRITICAL | `decoinks-frontend/src/pages/PurchaseOrderDetailPage.tsx:109,115` | Change `r.data.po` → `r.data.data` and `r.data.history` → `r.data.data`. PO detail page will render. |
| 3 | 🔴 CRITICAL | `decoinks-frontend/src/pages/NewPurchaseOrderPage.tsx:208` | Change `res.data.po?.id` → `res.data.data?.id`. Post-create navigation will work. |
| 4 | 🔴 CRITICAL | `decoinks-frontend/src/pages/PurchaseOrderDetailPage.tsx:142` | Fix `send-oo-portal` → `send-to-portal` (t→o corruption). Send-to-portal button will work. |
| 5 | 🔴 CRITICAL | `decoinks-frontend/src/pages/NewInvoicePage.tsx` | Rewrite `saveDraft()` to send `{ supplier_id, quote_id, subtotal, tax_amt, discount_amt, notes }` matching the Zod schema. Wire status buttons to `PATCH /invoices/:id/status`. |
| 6 | 🟡 HIGH | `decoinks-frontend/src/pages/LeadBoardPage.tsx:267,522` | Change `'Loso'` → `'Lost'` in both the mutation payload and the menu item label. |
| 7 | 🟡 HIGH | `decoinks-frontend/src/pages/WorkflowListPage.tsx:73,96` | Change `r.customer_name` → `r.supplier_name` for invoices and orders mapRow functions. |
| 8 | 🟡 HIGH | `decoinks-frontend/vite.config.ts` | Add `proxy: { '/api': { target: 'http://localhost:8000', changeOrigin: true } }` so dev mode works without Docker. |
| 9 | 🟡 HIGH | `decoinks-frontend/src/pages/NewInvoicePage.tsx` (25 corruption hits) | Fix: `itemsTooal`→`itemsTotal`, `oaxRaoe`→`taxRate`, `discountAmo`→`discountAmt`, `oaxAmo`→`taxAmt`, `oaxableAmouno`→`taxableAmount`, `requesoApproval`→`requestApproval`, `seno`→`sent`, `ohis`→`this`. All internal to the file — no DB/API impact but they make the code unmaintainable. |
| 10 | 🟡 HIGH | `decoinks-frontend/src/pages/PurchaseOrderDetailPage.tsx` (multiple) | Fix remaining corruption: `marginBoooom`→`marginBottom`, `leooerSpacing`→`letterSpacing`, `ooLocaleDateSoring`→`toLocaleDateString`, `monoh`→`month`, `shoro`→`short`, `2-digio`→`2-digit`, `minuoe`→`minute`, `seno`→`sent`. |
| 11 | 🟡 MEDIUM | `decoinks-frontend/src/pages/LeadBoardPage.tsx:71` | Remove `'Loso'` from `STATUS_COLORS` map (was added due to corruption); add `'Lost'` if not present. |
| 12 | 🟡 MEDIUM | `decoinks-frontend/src/pages/PortalAccessModal.tsx:76`, `SettingsUsersPage.tsx:274`, `UserEditPage.tsx:148` | Fix `ooLocaleDateSoring`→`toLocaleDateString`, `monoh`→`month`, `shoro`→`short`, `2-digio`→`2-digit`. These affect all date displays in user/supplier tables. |
| 13 | 🟡 MEDIUM | `decoinks-frontend/src/pages/SettingsUsersPage.tsx:86,93` | Fix `inioials`→`initials`, `navigaoe`→`navigate`. Functions work (JS is dynamic) but misleading. |
| 14 | 🟡 MEDIUM | `decoinks-frontend/src/index.css` — `.wf-table-wrap` | Move `overflow-x: auto` out of the `@media (max-width: 860px)` block and into the base `.wf-table-wrap` rule. Fixes table overflow at laptop widths. |
| 15 | 🟢 LOW | `backend/src/.env` | Add `NODE_ENV=development` or ensure it's set before running in prod to prevent stack leaks. Already conditional in `errorHandler.js` — just need env var set. |
| 16 | 🟢 LOW | All `/:id` route handlers in backend | Add UUID format validation before DB query (e.g., Zod `z.string().uuid()` on `req.params.id`) to return 400 instead of 500 on invalid UUID inputs. Affects all `getById`-based routes. |
| 17 | 🟢 LOW | `backend/src/modules/leads/leads.service.js` | The `leads` table has an old `product_interest VARCHAR(200)` column never written by the service. Clean up or document as vestigial. |
| 18 | 🟢 LOW | `backend/package.json`, `tests/setup.js` | The `Force exiting Jest` warning indicates unclosed DB connections in tests. Call `pool.end()` in a global `afterAll` hook in `helpers.js`. |
| 19 | 🟢 LOW | `backend/migrations/` | Add `012_*` migration or document the gap (current range is 001–020 with no 012). Prevents confusion about missing migration. |

---

*Audit completed: 2026-06-01 | Files inspected: ~80 source files + DB live state | No files modified (read-only audit)*
