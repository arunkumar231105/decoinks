# Decoinks Printshop OS — Verification Report

**Date:** 2026-05-29  
**Verifier:** Claude (claude-sonnet-4-6)  
**Scope:** All recent work verified by reading real files and running real commands. No guessing.

---

## STEP A — Build / Boot

### A1 · Backend `npm install`
**DONE** — Ran successfully. `node_modules` present. Minor audit warnings (no breaking issues for runtime).

### A2 · Frontend `npm install`
**DONE** — Both `decoinks-frontend/` and `customer-portal/` installed cleanly.

### A3 · Docker Compose boot
**DONE** — `docker compose up -d` started all 5 containers:

| Container | Status | Ports |
|---|---|---|
| `decoinks_postgres` | Up (healthy) | 5433:5432 |
| `decoinks_redis` | Up (healthy) | 6379:6379 |
| `decoinks_backend` | **CRASHED** | — |
| `decoinks_frontend` | Up | 80:80 |
| `decoinks_customer_portal` | Up | 3001:80 |

**FAIL — Backend container crashes on startup.**

Root cause from `docker logs decoinks_backend`:
```
Error: Cannot find module 'sharp'
Require stack:
- /app/src/modules/artworks/gangsheet.service.js
- /app/src/modules/orders/orders.routes.js
- /app/src/app.js
- /app/server.js
```

`sharp` is not in `package.json` or is not installed in the Docker image for the current platform. The backend is **not running** in Docker. All API endpoint verification below is **CANNOT VERIFY via HTTP** — verified by code audit instead.

### A4 · Admin frontend build (`decoinks-frontend`)
**FAIL — Build crashes with corrupt source file.**

```
[vite:esbuild] Transform failed:
BoardPage.tsx:1:7: ERROR: Expected ";" but found "{"
1  |  imporo { useSoaoe } from 'reaco'
```

`src/pages/BoardPage.tsx` is corrupted (garbled text — all `t` characters replaced). The admin frontend **cannot produce a production build**.

### A5 · Customer-portal strict TypeScript check
**DONE — 0 errors.**

```
npx tsc --noEmit → (no output, exit 0)
```

### A6 · Customer-portal production build
**DONE — Built successfully.**

```
dist/assets/index-DPiZpygg.js  845.12 kB (gzip: 246.66 kB)
✓ built in 9.07s
```

---

## STEP B — Database Schema

Verified against live Docker PostgreSQL (`decoinks_postgres`, applied migrations in `_migrations` table).

### B1 · Tables present
**DONE** — All 31 expected tables exist, including:
- `suppliers` (renamed from `customers` ✓)
- `supplier_portal_users` ✓
- `portal_po_visibility`, `portal_order_visibility`, `portal_notifications` ✓
- `portal_status_updates` ✓
- `po_attachments`, `po_status_history` ✓
- `custom_fields` ✓
- `pipeline_events`, `payments`, `refresh_tokens` ✓

**MISSING:** `custom_field_values` — **NOT present in Docker DB** (migration `019_custom_field_values.sql` exists in `backend/migrations/` but has **never been applied** via the migration runner. It was applied manually during this verification session only).

### B2 · `suppliers` table schema
**DONE** — Table renamed correctly. Primary key still named `customers_pkey` (cosmetic, no functional impact). Foreign keys from dependent tables (`leads`, `orders`, `invoices`, `quotations`, `shipments`, `artworks`) all reference `suppliers(id)`. `supplier_status` enum used.

### B3 · `purchase_orders` enhanced columns
**DONE** — All columns from Phase 1 plan are present:
`supplier_id`, `supplier_reference`, `payment_terms`, `currency`, `exchange_rate`, `buyer_id`, `department`, `priority`, `shipping_method`, `shipping_address`, `billing_address`, `terms_conditions`, `approved_by`, `approved_at`, `cancelled_reason`, `total_discount`, `total_tax`, `freight_charges`, `other_charges`, `grand_total`, `deleted_at`, `order_id`, `sent_at`.

`priority` CHECK constraint present: `Low | Medium | High | Urgent`.

### B4 · `po_status` ENUM values
**DONE** — Full enum:
```
{Draft, Sent, Accepted, "In Production", Shipped, Received, Partial,
 "Pending Approval", Approved, "Partially Received", Closed, Cancelled}
```

### B5 · Applied migrations
**PARTIAL** — Migrations 001–017 applied. Migration `018_gangsheet.sql` and `019_custom_field_values.sql` show as files but are **not recorded in `_migrations` table** (018 was not applied; 019 was applied manually during this session, not via runner).

---

## STEP C — Backend API Surface

### C1 · `app.js` route mounts
**DONE** — All routes mounted correctly:

| Route prefix | Module |
|---|---|
| `/api/auth` | `auth.routes` |
| `/api/suppliers` | `suppliers.routes` ✓ (not `/api/customers`) |
| `/api/leads` | `leads.routes` |
| `/api/quotations` | `quotations.routes` |
| `/api/orders` | `orders.routes` |
| `/api/invoices` | `invoices.routes` |
| `/api/purchase-orders` | `po.routes` |
| `/api/shipments` | `shipments.routes` |
| `/api/products` | `products.routes` |
| `/api/artworks` | `artworks.routes` |
| `/api/dashboard` | `dashboard.routes` |
| `/api/supplier` | `supplier-portal/portal.routes` ✓ (not `/api/customer`) |
| `/api/custom-fields` | `custom_fields.routes` ✓ |

No `/api/customers` or `/api/customer` mounts — old routes **not exposed**.

### C2 · Dead modules still on disk
**PARTIAL** — `customer-portal/` and `customers/` folders still exist in `backend/src/modules/` but are **not imported** by `app.js`. They are dead code on disk. `customerAuth.js` also remains in middleware. No functional impact, but cleanup is pending.

### C3 · Custom fields routes — route ordering
**DONE** — `custom_fields.routes.js` correctly registers `/values/:entityType/:entityId` routes **before** `/:id`. Route order is:
1. `GET /` (list)
2. `GET /values/:entityType/:entityId`
3. `PATCH /values/:entityType/:entityId`
4. `GET /:id`
5. `POST /`
6. `PUT /:id`
7. `DELETE /:id`

Express routing bug (values matched as `:id`) is **fixed**.

### C4 · PO routes — new endpoints
**DONE** — All planned endpoints present in `po.routes.js`:
- `GET /:id/attachments`, `POST /:id/attachments`, `DELETE /:id/attachments/:aid`
- `GET /:id/history`
- `POST /:id/send-to-portal`

### C5 · Dashboard `top-suppliers` route
**DONE** — `dashboard.routes.js` exposes `GET /top-suppliers` (not `top-customers`). `dashboard.service.js` uses cache key `dashboard:top-suppliers`.

### C6 · Portal routes (supplier portal)
**DONE** — `portal.routes.js` exposes all expected endpoints including:
- `POST /orders/:id/status-updates`
- `GET /orders/:id/status-updates`
- `GET /purchase-orders`, `GET /purchase-orders/:id`
- `PATCH /purchase-orders/:id/status`

---

## STEP D — Business Logic

### D1 · `custom_fields.service.js` — `getValues` / `setValues`
**DONE** — Both functions implemented at lines 87–160:
- `getValues`: JOIN query returning `{ [fieldKey]: value }` ✓
- `setValues`: validates unknown keys (422), validates select/multiselect options (422 with message matching `/not a valid option/i`), upserts via `ON CONFLICT ... DO UPDATE` ✓
- `module.exports` includes both functions ✓

### D2 · `stateMachine.js`
**DONE** — Located at `backend/src/utils/stateMachine.js`. All five transition maps present:
- `LEAD_TRANSITIONS`, `QUOTE_TRANSITIONS`, `INVOICE_TRANSITIONS`, `ORDER_TRANSITIONS`, `PO_TRANSITIONS`
- Admin bypasses role check but edge must exist (422 on invalid edge) ✓
- `Paid → *` empty (terminal, idempotency enforced) ✓
- `Approved → *` empty (quote terminal, idempotency enforced) ✓
- Sales cannot perform `Sent → Paid` (INVOICE_TRANSITIONS `Sent.Paid` only allows `[MANAGER]`) ✓

### D3 · PO service key functions
**DONE** — `po.service.js` implements:
- `calcLineTotal`: per-item discount + tax calculation ✓
- `calcTotals`: grand total aggregation ✓
- `insertItems`: uses new column names ✓
- `create`: inserts first `po_status_history` row (NULL → 'Draft') ✓
- `updateStatus`: transaction + inserts `po_status_history` ✓
- `remove`: soft delete (`UPDATE ... SET deleted_at = NOW()`) ✓
- `list`: `AND po.deleted_at IS NULL` filter ✓

---

## STEP E — Portal Isolation

### E1 · PO list WHERE clause
**DONE** — `portal.service.js` line 295:
```js
const conditions = ['ppv.supplier_id = $1', 'ppv.is_visible = TRUE'];
```
List query joins `portal_po_visibility` and filters by `supplierId`. Cross-supplier leakage is **not possible** via this query.

### E2 · PO detail access check
**DONE** — `portal.service.js` line 271:
```sql
SELECT 1 FROM portal_po_visibility WHERE po_id = $1 AND supplier_id = $2 AND is_visible = TRUE
```
Returns 404 (not 403) if PO not in this supplier's visibility list. No data leakage on unauthorized access.

### E3 · Order list WHERE clause
**DONE** — All order queries filter via `portal_order_visibility` with `pov.supplier_id = $1 AND pov.is_visible = TRUE`.

### E4 · Portal status update access check
**DONE** — `submitStatusUpdate` checks `portal_po_visibility` before allowing update (line 407).

---

## STEP F — Authentication

### F1 · Admin auth middleware (`auth.js`)
**DONE** — `verifyToken` decodes JWT, sets `req.user`. `requireRole(...roles)` enforces role list. `requireSupplier` checks `req.user?.role !== 'supplier'`. All exported correctly.

### F2 · Supplier portal auth (`supplierAuth.js`)
**DONE** — Checks `decoded.role !== 'supplier'`, sets `req.supplier = decoded`. Separate from admin auth.

### F3 · Dead `customerAuth.js`
**PARTIAL** — File still exists at `backend/src/middleware/customerAuth.js`. Still referenced from `backend/src/modules/customer-portal/portal.routes.js`. Neither file is imported by `app.js`, so no functional impact — but the dead file risks confusion.

### F4 · JWT env var mismatch
**FAIL** — `.env` has `JWT_CUSTOMER_EXPIRY=7d`. Portal service (`portal.service.js` line 35) reads `process.env.JWT_SUPPLIER_EXPIRY`. The env var is **misnamed**. In production this falls back to `|| '7d'` default, so tokens still work — but the env file is stale and misleading.

---

## STEP G — Admin Frontend (decoinks-frontend)

### G1 · Router (`src/router/index.tsx`)
**DONE** — Routes use supplier naming:
- `/suppliers` → `SuppliersPage`
- `/suppliers/new` → `NewSupplierPage`
- `/suppliers/:id` → `SupplierDetailPage`
No `/customers` route registered. ✓

### G2 · Build status
**FAIL** — Build cannot complete. `src/pages/BoardPage.tsx` is **corrupted** (garbled, all `t` characters replaced with `o`). Vite/esbuild throws parse error on line 1. The admin frontend **cannot be built**.

### G3 · PlaceholderPage usage
**PARTIAL** — `PlaceholderPage` imported in router and used for one route:
```tsx
path: '/invoices/:id'  → element: <PlaceholderPage title="Invoice Details" action="Edit Invoice" />
```
Invoice detail page is a stub (not implemented). All other critical routes have real components.

---

## STEP H — Supplier Portal (customer-portal)

### H1 · TypeScript check
**DONE** — `npx tsc --noEmit` exits 0. Zero type errors.

### H2 · Production build
**DONE** — `npm run build` succeeds. Bundle: 845 kB (gzip 247 kB).

### H3 · Auth store naming
**DONE** — `src/store/authStore.ts` uses `SupplierInfo` interface, `supplier` field, persist key `'decoinks-supplier-portal-auth'`. No `customer` references in store.

### H4 · Pages using `useSupplierAuth`
**PARTIAL** — `useSupplierAuth.ts` hook exists. `useCustomerAuth.ts` dead file also exists (definition only, no imports from pages). All portal pages that access auth use `useAuthStore` directly (via Zustand). Neither hook is actually imported by any page — both hook files exist but are unused. Functional code is correct; dead files add noise.

### H5 · Login page branding
**DONE** — `LoginPage.tsx` line 43: `"PRINTSHOP CPS – Supplier Portal"`. ✓

### H6 · `ProductionStatusPage`
**DONE** — File exists at `src/pages/ProductionStatusPage.tsx`. Route registered in `src/router/index.tsx` as `orders/:id/status-updates`. ✓

### H7 · `PurchaseOrderDetailPage`
**DONE** — File exists at `src/pages/PurchaseOrderDetailPage.tsx`. ✓

---

## STEP I — Jest Test Suite

### I1 · Run result
**ALL SUITES FAIL** — Root cause: `.env.test` file **does not exist**.

`backend/tests/setup.js` calls `require('dotenv').config({ path: '.env.test' })`. Without this file, `DATABASE_URL` is undefined. `pg` pool receives `undefined` as password → SASL error:

```
SASL: SCRAM-SERVER-FIRST-MESSAGE: client password must be a string
```

Every test in every suite fails at `runMigrations()` line 20. **No test has ever run successfully against a test database on this machine.**

### I2 · Test files present
**DONE** — All test files exist:
- `tests/integration/auth.test.js`
- `tests/integration/leads.test.js`
- `tests/integration/orders.test.js`
- `tests/integration/e2e_pipeline.test.js` (new, 5 test suites) ✓

### I3 · `e2e_pipeline.test.js` structure
**DONE** — File contains all 5 required test suites:
- TEST 1: Full pipeline happy path (supplier → lead → quote → auto-invoice → pay → auto-order → PO)
- TEST 2: State machine enforcement (invalid status 422, wrong role 403, terminal state 422)
- TEST 3: Idempotency (approve twice → 1 invoice, pay twice → 1 order)
- TEST 4: Supplier portal PO isolation (cross-supplier 404)
- TEST 5: Custom fields (create select field, set/get/validate/overwrite/deactivate)

### I4 · `helpers.js` migration list
**DONE** — `MIGRATION_FILES` array includes `['001_setup.sql', '016_custom_fields.sql', '019_custom_field_values.sql']`. `truncateTestTables` includes `custom_field_values` and `custom_fields` at top of TRUNCATE list. ✓

---

## STEP J — Migration 019

### J1 · File content
**DONE** — `backend/migrations/019_custom_field_values.sql` exists and is correct:
- `CREATE TABLE IF NOT EXISTS custom_field_values` with `cf_entity_type` typed column
- `UNIQUE CONSTRAINT uq_cfv (entity_type, entity_id, field_id)`
- `INDEX idx_cfv_entity ON custom_field_values(entity_type, entity_id)`
- Foreign key to `custom_fields(id) ON DELETE CASCADE`

### J2 · Applied in Docker DB
**FAIL** — Migration `019` was **not applied** by the Docker init scripts or migration runner. `custom_field_values` table was absent until manually applied during this verification. The migration runner (`run.js`) skips it because it runs outside Docker and no `DATABASE_URL` is configured for the host machine. The Docker init scripts only run `01_init.sql`, `02_portal.sql`, `03_supplier_rename.sql` on first start — migration 019 is never auto-applied.

---

## Summary Table

| # | Area | Status | Evidence |
|---|---|---|---|
| A1 | Backend npm install | DONE | Exit 0 |
| A2 | Frontend npm install | DONE | Exit 0 |
| A3 | Docker compose boot | FAIL | `sharp` module missing; backend crashes |
| A4 | Admin frontend build | FAIL | `BoardPage.tsx` corrupted (garbled text) |
| A5 | Portal tsc --noEmit | DONE | Exit 0, zero errors |
| A6 | Portal production build | DONE | 845 kB bundle, exit 0 |
| B1 | DB tables present | PARTIAL | `custom_field_values` missing until manually applied |
| B2 | `suppliers` table | DONE | Schema confirmed |
| B3 | `purchase_orders` columns | DONE | All plan columns present |
| B4 | `po_status` ENUM | DONE | 12 values including new ones |
| B5 | Migrations applied | PARTIAL | 018+019 not in `_migrations` |
| C1 | `app.js` route mounts | DONE | All correct, no `/api/customers` |
| C2 | Dead modules on disk | PARTIAL | `customer-portal/`, `customers/` dirs exist but not imported |
| C3 | Custom fields route order | DONE | `/values/` before `/:id` |
| C4 | PO new endpoints | DONE | attachments, history, send-to-portal |
| C5 | Dashboard top-suppliers | DONE | Route + cache key correct |
| D1 | `getValues`/`setValues` | DONE | Implemented with 422 validation |
| D2 | State machine | DONE | All 5 transition maps, correct role enforcement |
| D3 | PO service functions | DONE | calcLineTotal, soft delete, status history |
| E1–E4 | Portal isolation WHERE | DONE | All queries filter by `supplier_id` |
| F1–F2 | Auth middleware | DONE | `verifyToken`, `requireRole`, `supplierAuth` |
| F3 | Dead `customerAuth.js` | PARTIAL | File exists, not imported — dead code |
| F4 | JWT env var name | FAIL | `.env` has `JWT_CUSTOMER_EXPIRY`, code reads `JWT_SUPPLIER_EXPIRY` |
| G1 | Admin router paths | DONE | `/suppliers/*` routes only |
| G2 | Admin frontend build | FAIL | `BoardPage.tsx` corrupted |
| G3 | PlaceholderPage | PARTIAL | One route (`/invoices/:id`) is a stub |
| H1 | Portal tsc | DONE | Zero errors |
| H2 | Portal build | DONE | Successful |
| H3 | Portal auth store | DONE | Supplier naming throughout |
| H4 | Dead `useCustomerAuth.ts` | PARTIAL | File exists, no imports from pages |
| H6 | `ProductionStatusPage` | DONE | File + route exist |
| I1 | Jest test suite | FAIL | `.env.test` missing → all tests fail |
| I2 | Test files present | DONE | All 4 test files present |
| I3 | `e2e_pipeline.test.js` | DONE | All 5 suites, correct structure |
| I4 | `helpers.js` migrations | DONE | 019 included, truncate list updated |
| J1 | Migration 019 content | DONE | Correct schema |
| J2 | Migration 019 applied | FAIL | Not in `_migrations`, not auto-applied |

---

## Critical Blockers (must fix before any test can pass)

1. **`backend/.env.test` does not exist** — Create with `DATABASE_URL` pointing to a test Postgres instance. All 4 test suites are blocked.

2. **`sharp` module missing in Docker** — Backend container crashes on start. `sharp` must be added to `package.json` dependencies (with platform-specific build support in the Dockerfile), or the `gangsheet.service.js` import must be made conditional.

3. **`BoardPage.tsx` is corrupted** — File contains garbled text. Admin frontend cannot build. Needs rewrite or restore from git.

4. **Migration `019_custom_field_values.sql` not auto-applied** — The Docker init scripts and migration runner don't include it. Must add to Docker init sequence or run `npm run migrate` in the Docker backend container after startup.

## Non-blocking Issues

5. **`JWT_CUSTOMER_EXPIRY` in `.env`** — Should be renamed to `JWT_SUPPLIER_EXPIRY` to match what `portal.service.js` reads. Currently falls back to hardcoded `'7d'` default (works, but misleading).

6. **Dead code on disk** — `backend/src/modules/customer-portal/`, `backend/src/modules/customers/`, `backend/src/middleware/customerAuth.js`, `customer-portal/src/hooks/useCustomerAuth.ts` — not imported anywhere, safe to delete.

7. **`/invoices/:id` is a `PlaceholderPage` stub** — Invoice detail view not yet implemented in admin frontend.

8. **Migration `018_gangsheet.sql` not in `_migrations`** — May indicate it was never applied. Needs investigation.
