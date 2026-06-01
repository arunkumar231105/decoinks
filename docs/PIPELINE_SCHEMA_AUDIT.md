# Decoinks POS — Pipeline Schema Audit

**Audited:** 2026-05-26  
**Auditor:** Claude (automated read of all SQL migration files)  
**Files read:**
- `backend/migrations/001_extensions_enums.sql`
- `backend/migrations/001_setup.sql`
- `backend/migrations/002_create_tables.sql`
- `backend/migrations/003_artwork_status.sql`
- `backend/migrations/004_leads_pipeline_columns.sql`
- `backend/migrations/005_quotations_revision_fields.sql`
- `backend/migrations/006_invoices_pipeline_columns.sql`
- `backend/migrations/007_orders_pipeline_columns.sql`
- `backend/migrations/008_purchase_orders_enhance.sql`
- `backend/migrations/009_create_vendors_table.sql`
- `backend/migrations/010_create_payments_table.sql`
- `backend/migrations/011_create_pipeline_events_table.sql`

---

## ⚠️ CRITICAL RUNNER BUG — READ FIRST

**The migration runner (`backend/migrations/run.js`) will self-cancel every migration from 004 onward.**

The runner reads all `.sql` files in the directory, sorts them alphabetically, and applies each once. The `_down.sql` rollback files live in the **same folder**. In ASCII-lexicographic sort, `.` (46) is less than `_` (95), so:

```
004_leads_pipeline_columns.sql          ← applied first  (adds columns)
004_leads_pipeline_columns_down.sql     ← applied second (drops them)
```

Net result: every up-migration from 004–011 is immediately followed by its own rollback. The DB ends up at the `003_artwork_status` state, as if migrations 004–011 were never written.

**Fix required before any migration work:**
```bash
mkdir backend/migrations/down
mv backend/migrations/*_down.sql backend/migrations/down/
```

Update `run.js` to only process files in the top-level `migrations/` directory (not subdirectories — the current `readdirSync` is fine; just move the down files). Or add a filter:

```js
.filter((f) => f.endsWith('.sql') && !f.includes('_down'))
```

**All findings in this document assume the runner bug is fixed and all up-migrations 001–011 are applied cleanly.**

---

## 1. Required Pipeline

```
Lead → Quotation → Invoice → Order → Purchase Order
          (Approved)  (Paid)
```

Auto-triggers required:
- Quote status → `Approved` ⟹ Invoice auto-created and linked via `invoices.quote_id`
- Invoice status → `Paid` ⟹ Order auto-created and linked via `orders.invoice_id`
- Order created ⟹ PO can be raised to print vendor (bilingual EN / ZH)

---

## 2. Actual Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 20 |
| Framework | Express.js |
| DB | PostgreSQL 15 |
| Schema management | Raw SQL files + custom `migrations/run.js` runner |
| ORM | **None** — plain `pg` pool queries |
| Auth | JWT (`jsonwebtoken`) |
| Validation | Zod |

> **Note:** The CONTEXT prompt described a FastAPI + SQLAlchemy stack. The actual codebase is Node.js/Express with raw SQL. There are no Python files, no Alembic versions, and no SQLAlchemy models. All schema is defined in `backend/migrations/*.sql`.

---

## 3. Complete Table Inventory

All tables that exist after migrations `001_setup.sql` through `011_create_pipeline_events_table.sql` are applied:

| # | Table | Introduced In | Notes |
|---|-------|--------------|-------|
| 1 | `users` | 001_setup | ✓ |
| 2 | `customers` | 001_setup | Decoinks client accounts. **NOT renamed to `suppliers`** in this migration chain. Service code calls them `suppliers` due to a separate rename layer, but the DB table is still `customers`. |
| 3 | `leads` | 001_setup + 004 | `product_interest`, `artwork_url` added in 004 |
| 4 | `lead_comments` | 001_setup | ✓ |
| 5 | `lead_attachments` | 001_setup | ✓ |
| 6 | `quotations` | 001_setup + 005 | `currency`, `revision_number`, `parent_quote_id`, `sent_at`, `approved_at` added in 005 |
| 7 | `quotation_items` | 001_setup | ✓ |
| 8 | `orders` | 001_setup + 007 | `invoice_id`, `gangsheet_url`, `artwork_locations`, `shipped_at` added in 007; `QC` enum added |
| 9 | `order_items_apparel` | 001_setup | ✓ |
| 10 | `order_items_gangsheet` | 001_setup | ✓ |
| 11 | `order_items_dtf` | 001_setup | ✓ |
| 12 | `invoices` | 001_setup + 006 | `quote_id`, `sent_at`, `paid_at` added in 006; `Partially Paid` enum added |
| 13 | `purchase_orders` | 001_setup + 008 | Heavily enhanced in 008: 23 new columns, expanded `po_status` enum |
| 14 | `purchase_order_items` | 001_setup + 008 | 4 columns renamed + 11 new columns in 008 |
| 15 | `po_attachments` | 008 | ✓ |
| 16 | `po_status_history` | 008 | ✓ |
| 17 | `shipments` | 001_setup | ✓ |
| 18 | `products` | 001_setup | ✓ |
| 19 | `artworks` | 001_setup + 003 | Status enum expanded in 003 |
| 20 | `activity_logs` | 001_setup | ✓ |
| 21 | `vendors` | 009 | Print suppliers with `preferred_language`, `name_zh`, currency |
| 22 | `payments` | 010 | Payment ledger per invoice |
| 23 | `pipeline_events` | 011 | Structured auto-trigger audit trail |

---

## 4. Table-by-Table Audit

### 4.1 `leads` ✓ Exists

**Full column list after migrations 001 + 004:**

| Column | Type | Pipeline Requirement | Status |
|--------|------|---------------------|--------|
| `id` | UUID PK | `id` | ✓ |
| `lead_number` | VARCHAR(30) UNIQUE | `lead_no` | ⚠️ Name deviation: `lead_number` ≠ `lead_no` |
| `customer_id` | UUID → customers(id) | `customer_id` | ✓ Present. Note: service code calls this `supplier_id` but DB column is `customer_id`. |
| `customer_name` | VARCHAR(150) | (denorm cache) | ✓ |
| `source` | `lead_source` ENUM | `source_channel` | ⚠️ Name deviation: `source` ≠ `source_channel`. Also type is ENUM (`Facebook Messenger/WhatsApp/Instagram/Email/Walk-in/Phone`), not a VARCHAR. |
| `description` | TEXT | — | Extra column ✓ |
| `stage` | `lead_stage` ENUM | — | Extra column ✓ (`initiated/quotation/artwork/gangsheet/payment/confirmed`) |
| `status` | `lead_status` ENUM | `status` | ✓ (`New/Quotation/Pending/Payment Sent/Partial/Confirmed`) |
| `stage_position` | INTEGER | — | ✓ |
| `assigned_to` | UUID → users(id) | `agent_id` | ⚠️ Name deviation: `assigned_to` ≠ `agent_id` |
| `has_artwork` | BOOLEAN | — | Superceded by `artwork_url` below |
| `comment_count` | INTEGER | — | ✓ |
| `attachment_count` | INTEGER | — | ✓ |
| `product_interest` | VARCHAR(200) | `product_interest` | ✓ Added in 004 |
| `artwork_url` | TEXT | `artwork_url` | ✓ Added in 004 |
| `created_at` | TIMESTAMPTZ | `created_at` | ✓ |
| `updated_at` | TIMESTAMPTZ | — | ✓ |
| `deleted_at` | TIMESTAMPTZ | — | Soft-delete ✓ |

**Missing columns:** None — all pipeline-required fields exist (some with name deviations).

**Name deviations (column exists, name differs from pipeline spec):**

| Actual Column | Pipeline Expects | Impact |
|--------------|-----------------|--------|
| `lead_number` | `lead_no` | Service code and API consumers must use `lead_number` |
| `assigned_to` | `agent_id` | Same |
| `source` | `source_channel` | Same |

**Indexes:**

| Index | Exists? | Notes |
|-------|---------|-------|
| `idx_leads_stage` | ✓ | Partial (WHERE deleted_at IS NULL) |
| `idx_leads_status` | ✓ | Partial |
| `idx_leads_customer` | ✓ | On `customer_id` |
| `idx_leads_assigned` | ✓ | On `assigned_to` |
| `idx_leads_source` | ✓ | Added in 004, partial |
| `idx_leads_deleted` | ✓ | ✓ |

**Unique index on `lead_number`:** Enforced via `UNIQUE` constraint on column definition ✓

---

### 4.2 `quotations` ✓ Exists

**Full column list after migrations 001 + 005:**

| Column | Type | Pipeline Requirement | Status |
|--------|------|---------------------|--------|
| `id` | UUID PK | `id` | ✓ |
| `quote_number` | VARCHAR(30) UNIQUE | `quote_no` | ⚠️ Name deviation: `quote_number` ≠ `quote_no` |
| `lead_id` | UUID → leads(id) | `lead_id (FK)` | ✓ |
| `customer_id` | UUID → customers(id) | `customer_id` | ✓ |
| `status` | `quote_status` ENUM | `status` | ✓ Values: `Draft/Sent/Approved/Rejected/Expired` — matches requirement |
| `valid_until` | DATE | `valid_until` | ✓ |
| `subtotal` | NUMERIC(12,2) | — | ✓ |
| `discount_pct` | NUMERIC(5,2) | — | ✓ |
| `discount_amt` | NUMERIC(12,2) | — | ✓ |
| `tax_pct` | NUMERIC(5,2) | — | ✓ |
| `tax_amt` | NUMERIC(12,2) | — | ✓ |
| `total` | NUMERIC(12,2) | `total_amount` | ⚠️ Name deviation: `total` ≠ `total_amount` |
| `notes` | TEXT | — | ✓ |
| `currency` | VARCHAR(3) DEFAULT 'USD' | `currency` | ✓ Added in 005 |
| `revision_number` | INTEGER DEFAULT 1 | `revision_number` | ✓ Added in 005 |
| `parent_quote_id` | UUID → quotations(id) | `parent_quote_id` | ✓ Added in 005 |
| `sent_at` | TIMESTAMPTZ | `sent_at` | ✓ Added in 005 |
| `approved_at` | TIMESTAMPTZ | `approved_at` | ✓ Added in 005 |
| `created_by` | UUID → users(id) | — | ✓ |
| `created_at` | TIMESTAMPTZ | `created_at` | ✓ |
| `updated_at` | TIMESTAMPTZ | — | ✓ |

**Missing columns:** None.

**Name deviations:**

| Actual Column | Pipeline Expects | Impact |
|--------------|-----------------|--------|
| `quote_number` | `quote_no` | Naming only |
| `total` | `total_amount` | API responses return `total` not `total_amount` |

**Indexes:**

| Index | Exists? | Notes |
|-------|---------|-------|
| `idx_quotations_status` | ✓ | ✓ |
| `idx_quotations_customer` | ✓ | ✓ |
| `idx_quotations_lead_id` | ✓ | Added in 005 |
| `idx_quotations_parent` | ✓ | Partial (WHERE parent_quote_id IS NOT NULL), added in 005 |
| Unique on `quote_number` | ✓ | Via column constraint |

---

### 4.3 `invoices` ✓ Exists — ⚠️ Legacy FK Still Present

**Full column list after migrations 001 + 006:**

| Column | Type | Pipeline Requirement | Status |
|--------|------|---------------------|--------|
| `id` | UUID PK | `id` | ✓ |
| `invoice_number` | VARCHAR(30) UNIQUE | `invoice_no` | ⚠️ Name deviation |
| `order_id` | UUID → orders(id) | — | ⚠️ **Legacy FK** — pipeline flow is Quote→Invoice→Order, so invoices should link to `quotations` via `quote_id`, not `orders`. The `order_id` column was the original (wrong-direction) link and should be deprecated. |
| `customer_id` | UUID → customers(id) | `customer_id` | ✓ |
| `status` | `invoice_status` ENUM | `status` | ✓ Values after 006: `Draft/Sent/Partially Paid/Paid/Overdue/Void` — matches requirement |
| `issue_date` | DATE | — | ✓ |
| `due_date` | DATE | `due_date` | ✓ |
| `subtotal` | NUMERIC(12,2) | — | ✓ |
| `discount_amt` | NUMERIC(12,2) | — | ✓ |
| `tax_amt` | NUMERIC(12,2) | — | ✓ |
| `total` | NUMERIC(12,2) | `total_amount` | ⚠️ Name deviation: `total` ≠ `total_amount` |
| `amount_paid` | NUMERIC(12,2) | `paid_amount` | ⚠️ Name deviation: `amount_paid` ≠ `paid_amount` |
| `balance_due` | NUMERIC(12,2) | `balance_due` | ✓ |
| `notes` | TEXT | — | ✓ |
| `quote_id` | UUID → quotations(id) | `quote_id (FK)` | ✓ Added in 006 — **critical pipeline FK** |
| `sent_at` | TIMESTAMPTZ | `sent_at` | ✓ Added in 006 |
| `paid_at` | TIMESTAMPTZ | `paid_at` | ✓ Added in 006 |
| `created_by` | UUID → users(id) | — | ✓ |
| `created_at` | TIMESTAMPTZ | `created_at` | ✓ |
| `updated_at` | TIMESTAMPTZ | — | ✓ |

**Missing columns:** None.

**Name deviations:**

| Actual Column | Pipeline Expects |
|--------------|-----------------|
| `invoice_number` | `invoice_no` |
| `total` | `total_amount` |
| `amount_paid` | `paid_amount` |

**Legacy column to deprecate:**

| Column | Issue | Recommendation |
|--------|-------|---------------|
| `order_id` | Predates the correct pipeline direction. Invoices should reference quotations (`quote_id`), not orders. Orders should reference invoices (`invoice_id`). This column is now structurally redundant. | Retain until service code is fully migrated to the `quote_id` path, then drop in a future migration. |

**Indexes:**

| Index | Exists? | Notes |
|-------|---------|-------|
| `idx_invoices_status` | ✓ | ✓ |
| `idx_invoices_customer` | ✓ | ✓ |
| `idx_invoices_order` | ✓ | On legacy `order_id` column |
| `idx_invoices_quote_id` | ✓ | Added in 006 (partial) |
| `idx_invoices_due_date` | ✓ | Added in 006 (partial) |
| Unique on `invoice_number` | ✓ | Via column constraint |

---

### 4.4 `orders` ✓ Exists — ⚠️ Legacy FK Still Present

**Full column list after migrations 001 + 007:**

| Column | Type | Pipeline Requirement | Status |
|--------|------|---------------------|--------|
| `id` | UUID PK | `id` | ✓ |
| `order_number` | VARCHAR(30) UNIQUE | `order_no` | ⚠️ Name deviation |
| `quotation_id` | UUID → quotations(id) | — | ⚠️ **Legacy FK** — original schema linked orders to quotations directly (bypassing invoices). Pipeline requires `invoice_id`. Retain for backwards compat; deprecate later. |
| `customer_id` | UUID → customers(id) | `customer_id` | ✓ |
| `order_type` | `order_type` ENUM | — | ✓ (`apparel/gangsheet/dtf`) |
| `status` | `order_status` ENUM | `status` | ✓ After 007: `Draft/Confirmed/In Production/QC/Ready to Ship/Shipped/Delivered/Cancelled` |
| `payment_status` | `payment_status` ENUM | — | ✓ |
| `payment_method` | `payment_method` ENUM | — | ✓ |
| `payment_terms` | `payment_terms` ENUM | — | ✓ |
| `currency` | VARCHAR(3) | — | ✓ |
| `order_date` | DATE | — | ✓ |
| `due_date` | DATE | — | ✓ |
| `rush_services` | NUMERIC(12,2) | — | ✓ |
| `shipping_charges` | NUMERIC(12,2) | — | ✓ |
| `subtotal` | NUMERIC(12,2) | — | ✓ |
| `discount_pct/amt` | NUMERIC | — | ✓ |
| `tax_pct/amt` | NUMERIC | — | ✓ |
| `total` | NUMERIC(12,2) | — | ✓ |
| `notes` | TEXT | — | ✓ |
| `shipping_name/address` | VARCHAR/TEXT | — | ✓ |
| `contact_name/email/phone` | VARCHAR | — | ✓ |
| `assigned_to` | UUID → users(id) | — | ✓ |
| `created_by` | UUID → users(id) | — | ✓ |
| `invoice_id` | UUID → invoices(id) | `invoice_id (FK)` | ✓ Added in 007 — **critical pipeline FK** |
| `gangsheet_url` | TEXT | `gangsheet_url` | ✓ Added in 007 |
| `artwork_locations` | JSONB | `artwork_locations (JSON)` | ✓ Added in 007 |
| `shipped_at` | TIMESTAMPTZ | `shipped_at` | ✓ Added in 007 |
| `created_at` | TIMESTAMPTZ | `created_at` | ✓ |
| `updated_at` | TIMESTAMPTZ | — | ✓ |
| `deleted_at` | TIMESTAMPTZ | — | Soft-delete ✓ |

**Missing columns:** None.

**Name deviations:**

| Actual Column | Pipeline Expects |
|--------------|-----------------|
| `order_number` | `order_no` |

**Pipeline note on `supplier_id`:**
> The pipeline spec lists `supplier_id (FK nullable)` on orders, referring to the print vendor. In this schema, `orders.customer_id` references the **Decoinks client** (`customers` table). There is no direct vendor FK on orders — the vendor is linked via the PO (`purchase_orders.vendor_id → vendors`). If the spec requires a vendor FK on orders directly, that is a genuinely missing column. If `supplier_id` in the spec refers to the client account, then `customer_id` covers it.

**Legacy column to deprecate:**

| Column | Issue |
|--------|-------|
| `quotation_id` | Original schema linked Order → Quotation, bypassing Invoice. Now that `invoice_id` exists, this is redundant. Retain until service code migrates fully. |

**Indexes:**

| Index | Exists? | Notes |
|-------|---------|-------|
| `idx_orders_customer` | ✓ | Partial |
| `idx_orders_status` | ✓ | Partial |
| `idx_orders_type` | ✓ | Partial |
| `idx_orders_date` | ✓ | Partial |
| `idx_orders_deleted` | ✓ | ✓ |
| `idx_orders_invoice_id` | ✓ | Added in 007 (partial) |
| Unique on `order_number` | ✓ | Via column constraint |

---

### 4.5 `purchase_orders` ✓ Exists (heavily enhanced in 008)

**Full column list after migrations 001 + 008 + 009:**

| Column | Type | Pipeline Requirement | Status |
|--------|------|---------------------|--------|
| `id` | UUID PK | `id` | ✓ |
| `po_number` | VARCHAR(30) UNIQUE | `po_no` | ⚠️ Name deviation |
| `order_id` | UUID → orders(id) | `order_id (FK)` | ✓ Added in 008 |
| `supplier_id` | UUID → customers(id) | `supplier_id (FK)` | ⚠️ FK points to `customers(id)`, not a vendors table. Column name matches spec but semantics differ: in spec "supplier" = print vendor; here it references the Decoinks client account. |
| `vendor_id` | UUID → vendors(id) | (implicit — vendor contact) | ✓ Added in 009 — the proper FK to print vendors |
| `vendor_name` | VARCHAR(150) | — | Legacy text field; superseded by `vendor_id` FK |
| `status` | `po_status` ENUM | `status (sent/accepted/in_production/shipped)` | ✓ After 008 includes: `Draft/Sent/Accepted/In Production/Shipped/Received/Partial/Pending Approval/Approved/Partially Received/Closed/Cancelled` |
| `language` | VARCHAR(2) CHECK ('en','zh') | `language (en/zh)` | ✓ Added in 008 |
| `sent_at` | TIMESTAMPTZ | `sent_at` | ✓ Added in 008 |
| `currency` | VARCHAR(3) DEFAULT 'USD' | `supplier_currency` | ⚠️ Name deviation: `currency` ≠ `supplier_currency` |
| `exchange_rate` | NUMERIC(10,4) | — | ✓ |
| `grand_total` | NUMERIC(12,2) | `supplier_total` | ⚠️ Name deviation: `grand_total` ≠ `supplier_total` |
| `subtotal` | NUMERIC(12,2) | — | ✓ |
| `total` | NUMERIC(12,2) | — | Legacy column from original schema (pre-008) |
| `total_discount` | NUMERIC(12,2) | — | ✓ |
| `total_tax` | NUMERIC(12,2) | — | ✓ |
| `freight_charges` | NUMERIC(12,2) | — | ✓ |
| `other_charges` | NUMERIC(12,2) | — | ✓ |
| `notes` | TEXT | `production_notes` | ⚠️ Name deviation: `notes` ≠ `production_notes` |
| `payment_terms` | VARCHAR(50) | — | ✓ |
| `supplier_reference` | VARCHAR(100) | — | ✓ |
| `buyer_id` | UUID → users(id) | — | ✓ |
| `department` | VARCHAR(100) | — | ✓ |
| `priority` | VARCHAR(10) CHECK (Low/Medium/High/Urgent) | — | ✓ |
| `shipping_method` | VARCHAR(50) | — | ✓ |
| `shipping_address` | TEXT | — | ✓ |
| `billing_address` | TEXT | — | ✓ |
| `terms_conditions` | TEXT | — | ✓ |
| `approved_by` | UUID → users(id) | — | ✓ |
| `approved_at` | TIMESTAMPTZ | — | ✓ |
| `cancelled_reason` | TEXT | — | ✓ |
| `order_date` | DATE | — | ✓ |
| `expected_date` | DATE | — | ✓ |
| `created_by` | UUID → users(id) | — | ✓ |
| `created_at` | TIMESTAMPTZ | `created_at` | ✓ |
| `updated_at` | TIMESTAMPTZ | — | ✓ |
| `deleted_at` | TIMESTAMPTZ | — | Soft-delete ✓ |

**Missing columns:** None from pipeline specification.

**Name deviations:**

| Actual Column | Pipeline Expects | Impact |
|--------------|-----------------|--------|
| `po_number` | `po_no` | Naming only |
| `currency` | `supplier_currency` | Naming only |
| `grand_total` | `supplier_total` | Naming only |
| `notes` | `production_notes` | Naming only |

**Semantic issue — `supplier_id`:**
> `purchase_orders.supplier_id` was added in 008 as `REFERENCES customers(id)`. The `customers` table holds Decoinks client accounts, not print vendors. If the pipeline intent is that `supplier_id` on POs means the print vendor, then the correct FK is `vendor_id → vendors(id)` (which was added in 009). The `supplier_id` on POs effectively means "which Decoinks client this PO is associated with" — consistent with how it is used on other tables.

**Indexes:**

| Index | Exists? | Notes |
|-------|---------|-------|
| `idx_po_status` | ✓ | ✓ |
| `idx_po_supplier` | ✓ | Added in 008, partial |
| `idx_po_order_id` | ✓ | Added in 008, partial |
| `idx_po_language` | ✓ | Added in 008 |
| `idx_po_vendor_id` | ✓ | Added in 009, partial |
| Unique on `po_number` | ✓ | Via column constraint |

---

### 4.6 `purchase_order_items` ✓ Exists (remodelled in 008)

**Full column list after 008:**

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | ✓ |
| `po_id` | UUID → purchase_orders(id) CASCADE | ✓ |
| `item_name` | VARCHAR(255) NOT NULL | Renamed from `description` in 008 |
| `qty_ordered` | INTEGER NOT NULL DEFAULT 1 | Renamed from `qty` in 008 |
| `unit_price` | NUMERIC(12,2) NOT NULL DEFAULT 0 | Renamed from `unit_cost` in 008 |
| `line_total` | NUMERIC(12,2) NOT NULL DEFAULT 0 | Renamed from `amount` in 008 |
| `product_id` | UUID → products(id) NULL | Added in 008 |
| `description` | TEXT | Added in 008 (long-form, separate from `item_name`) |
| `hsn_code` | VARCHAR(20) | Added in 008 |
| `uom` | VARCHAR(20) DEFAULT 'pcs' | Added in 008 |
| `discount_pct` | NUMERIC(5,2) DEFAULT 0 | Added in 008 |
| `discount_amt` | NUMERIC(12,2) DEFAULT 0 | Added in 008 |
| `tax_pct` | NUMERIC(5,2) DEFAULT 0 | Added in 008 |
| `tax_amt` | NUMERIC(12,2) DEFAULT 0 | Added in 008 |
| `required_by_date` | DATE | Added in 008 |
| `remarks` | TEXT | Added in 008 |
| `sort_order` | INTEGER DEFAULT 0 | Added in 008 |
| `created_at` | TIMESTAMPTZ DEFAULT NOW() | Added in 008 |

**Missing columns:** None.

---

### 4.7 `vendors` ✓ Exists (created in 009)

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | ✓ |
| `name` | VARCHAR(200) NOT NULL | EN name ✓ |
| `name_zh` | VARCHAR(200) | Chinese name for ZH POs ✓ |
| `contact_person` | VARCHAR(150) | ✓ |
| `email` | VARCHAR(255) | ✓ |
| `phone` | VARCHAR(30) | ✓ |
| `preferred_language` | VARCHAR(2) CHECK ('en','zh') DEFAULT 'en' | ✓ Drives PO language selection |
| `address` | TEXT | ✓ |
| `currency` | VARCHAR(3) DEFAULT 'USD' | ✓ |
| `payment_terms` | VARCHAR(50) | ✓ |
| `notes` | TEXT | ✓ |
| `is_active` | BOOLEAN DEFAULT TRUE | ✓ |
| `created_by` | UUID → users(id) | ✓ |
| `created_at` | TIMESTAMPTZ | ✓ |
| `updated_at` | TIMESTAMPTZ | ✓ |
| `deleted_at` | TIMESTAMPTZ | Soft-delete ✓ |

**Missing columns:** None.

---

### 4.8 `payments` ✓ Exists (created in 010)

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | ✓ |
| `invoice_id` | UUID NOT NULL → invoices(id) ON DELETE RESTRICT | ✓ |
| `amount` | NUMERIC(12,2) NOT NULL CHECK (amount > 0) | ✓ |
| `payment_method` | `payment_method` ENUM NOT NULL | ✓ |
| `reference_no` | VARCHAR(100) | ✓ |
| `paid_at` | TIMESTAMPTZ DEFAULT NOW() | ✓ |
| `recorded_by` | UUID → users(id) | ✓ |
| `notes` | TEXT | ✓ |
| `created_at` | TIMESTAMPTZ | ✓ |

**Missing columns:** None.

---

### 4.9 `pipeline_events` ✓ Exists (created in 011)

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | ✓ |
| `event_type` | VARCHAR(80) NOT NULL | e.g. `quote_approved`, `invoice_paid`, `order_created`, `po_sent` |
| `source_table` | VARCHAR(50) NOT NULL | `quotations / invoices / orders / purchase_orders` |
| `source_id` | UUID NOT NULL | ✓ |
| `target_table` | VARCHAR(50) | Table auto-created as result |
| `target_id` | UUID | ✓ |
| `triggered_by` | UUID → users(id) | ✓ |
| `triggered_at` | TIMESTAMPTZ DEFAULT NOW() | ✓ |
| `metadata` | JSONB | ✓ |

**Missing columns:** None.

---

## 5. Missing Tables

**All tables required by the pipeline are present.** No missing tables after migrations 001–011.

For completeness, tables that were identified as missing in the prior audit (2026-05-23) but are now present:

| Table | Added In | Status |
|-------|---------|--------|
| `vendors` | 009 | ✓ Now exists |
| `payments` | 010 | ✓ Now exists |
| `pipeline_events` | 011 | ✓ Now exists |
| `po_attachments` | 008 | ✓ Now exists |
| `po_status_history` | 008 | ✓ Now exists |

---

## 6. Missing FK Relationships

All critical FKs are now structurally present. The following are the key pipeline FKs and their status:

| FK Column | On Table | References | Status |
|-----------|----------|-----------|--------|
| `quote_id` | `invoices` | `quotations(id)` | ✓ Added in 006 |
| `invoice_id` | `orders` | `invoices(id)` | ✓ Added in 007 |
| `order_id` | `purchase_orders` | `orders(id)` | ✓ Added in 008 |
| `vendor_id` | `purchase_orders` | `vendors(id)` | ✓ Added in 009 |
| `invoice_id` | `payments` | `invoices(id)` | ✓ 010 |

**Legacy FKs that should eventually be dropped (not blocking, keep for now):**

| Column | On Table | Issue |
|--------|----------|-------|
| `order_id` | `invoices` | Old direction (Invoice → Order). Pipeline now uses `invoices.quote_id` + `orders.invoice_id`. Safe to drop after service layer migrates. |
| `quotation_id` | `orders` | Old direction (Order → Quotation, bypassing Invoice). Pipeline now uses `orders.invoice_id`. Safe to drop after service layer migrates. |

---

## 7. Missing Indexes

**All required indexes are present** after migrations 001–011. Summary of unique/business-key indexes:

| Table | Unique Column | Index Type | Status |
|-------|--------------|-----------|--------|
| `leads` | `lead_number` | UNIQUE (inline) | ✓ |
| `quotations` | `quote_number` | UNIQUE (inline) | ✓ |
| `invoices` | `invoice_number` | UNIQUE (inline) | ✓ |
| `orders` | `order_number` | UNIQUE (inline) | ✓ |
| `purchase_orders` | `po_number` | UNIQUE (inline) | ✓ |
| `shipments` | `shipment_number` | UNIQUE (inline) | ✓ |
| `artworks` | `artwork_no` | UNIQUE (inline) | ✓ |
| `products` | `sku` | UNIQUE (inline) | ✓ |

All FK columns have supporting B-tree indexes (created alongside the FK columns in their respective migrations).

---

## 8. Enum Completeness

| ENUM Type | Values | Pipeline Requirement | Status |
|-----------|--------|---------------------|--------|
| `lead_status` | New / Quotation / Pending / Payment Sent / Partial / Confirmed | — | ✓ |
| `lead_source` | Facebook Messenger / WhatsApp / Instagram / Email / Walk-in / Phone | insta_dm/whatsapp/email/fb_messenger | ⚠️ Values use full display names, not slug format. Values present but formatted differently than spec. |
| `quote_status` | Draft / Sent / Approved / Rejected / Expired | draft/sent/approved/rejected/expired | ✓ (same values, different case) |
| `invoice_status` | Draft / Sent / Partially Paid / Paid / Overdue / Void | draft/sent/partially_paid/paid/overdue | ✓ After 006; includes `Partially Paid` |
| `order_status` | Draft / Confirmed / In Production / QC / Ready to Ship / Shipped / Delivered / Cancelled | pending/in_production/qc/shipped/delivered/cancelled | ⚠️ Has extra values (`Draft/Confirmed/Ready to Ship/Delivered`). Missing `pending` as a value (uses `Draft` instead). All required values present in spirit. |
| `po_status` | Draft / Sent / Accepted / In Production / Shipped / Received / Partial / Pending Approval / Approved / Partially Received / Closed / Cancelled | sent/accepted/in_production/shipped | ✓ After 008; all required values present |

---

## 9. Service Layer Gaps (Structural FKs Exist, Code Not Updated)

These are not schema problems — the columns and FKs exist. The **service code** has not yet been updated to use them:

| Service File | Gap | Column Added In |
|-------------|-----|----------------|
| `invoices.service.js` | Still INSERTs using `order_id`; should use `quote_id` for pipeline flow | 006 |
| `orders.service.js` | Still INSERTs using `quotation_id`; should use `invoice_id` for pipeline flow | 007 |
| `po.service.js` | Still uses `vendor_name` (text); should use `vendor_id → vendors` | 009 |

These require a coordinated service-layer update phase, not further schema migrations.

> **Update 2026-05-27:** All three gaps above are now resolved. See Section 13.

---

## 10. Summary — Gaps Remaining After All Migrations Applied

### True Missing Features (require future migration)

None. All pipeline-required tables and columns are structurally present after migrations 001–011.

### Name Deviations (column exists, named differently than pipeline spec)

| Table | Actual Name | Spec Name | Severity |
|-------|------------|----------|---------|
| `leads` | `lead_number` | `lead_no` | Low — naming only |
| `leads` | `assigned_to` | `agent_id` | Low |
| `leads` | `source` (ENUM) | `source_channel` (string) | Medium — also different type |
| `quotations` | `quote_number` | `quote_no` | Low |
| `quotations` | `total` | `total_amount` | Low |
| `invoices` | `invoice_number` | `invoice_no` | Low |
| `invoices` | `total` | `total_amount` | Low |
| `invoices` | `amount_paid` | `paid_amount` | Low |
| `orders` | `order_number` | `order_no` | Low |
| `purchase_orders` | `po_number` | `po_no` | Low |
| `purchase_orders` | `currency` | `supplier_currency` | Low |
| `purchase_orders` | `grand_total` | `supplier_total` | Low |
| `purchase_orders` | `notes` | `production_notes` | Low |

### Structural Concerns (not blocking, should be cleaned up)

1. **`invoices.order_id`** — legacy FK in wrong direction; retain until service code migrates to `quote_id`
2. **`orders.quotation_id`** — legacy FK in wrong direction; retain until service code migrates to `invoice_id`
3. **`purchase_orders.supplier_id → customers(id)`** — column name suggests print vendor but references Decoinks client accounts; semantic mismatch

---

## 11. Next Migrations Needed

**Schema is complete.** All required tables, columns, indexes, and FKs exist after running migrations 001–011.

The following are the only migrations that should be written next, in order:

1. **Fix runner (not a migration — a code change)**  
   Move all `*_down.sql` files to `backend/migrations/down/` so the runner does not self-cancel. Until this is done, migrations 004–011 have zero net effect.

2. **`012_drop_legacy_fks.sql`** (future, after service layer migration is complete)  
   ```sql
   -- After invoices.service.js migrates to quote_id:
   ALTER TABLE invoices DROP COLUMN IF EXISTS order_id;
   -- After orders.service.js migrates to invoice_id:
   ALTER TABLE orders DROP COLUMN IF EXISTS quotation_id;
   -- After po.service.js migrates to vendor_id:
   ALTER TABLE purchase_orders DROP COLUMN IF EXISTS vendor_name;
   ```
   **DO NOT run this migration until the service-layer code changes are complete and tested.**

3. **`013_supplier_rename.sql`** (optional, if the `customers` → `suppliers` table rename is desired in the DB)  
   The service code already uses `supplier` terminology. The DB table is still `customers`. If full consistency is desired, a rename migration is needed. This is currently a cosmetic issue — the system works either way as long as the ORM/service layer is consistent.

---

## 13. Changes Applied — 2026-05-27

### 13.1 Migration Runner Bug Fix

**File:** `backend/migrations/run.js`

Added `&& !f.includes('_down')` to the file filter. Previously the runner sorted all `.sql` files alphabetically, which caused each up-migration to be immediately followed by its own `_down.sql` rollback — net effect zero. The fix:

```js
// Before
.filter((f) => f.endsWith('.sql'))
// After
.filter((f) => f.endsWith('.sql') && !f.includes('_down'))
```

Down migration files remain in `backend/migrations/` for reference. To run a rollback, apply them manually via `psql`.

---

### 13.2 Migration 008 FK Reference Fix

**File:** `backend/migrations/008_purchase_orders_enhance.sql` (line 45)

The `supplier_id` column on `purchase_orders` was added with `REFERENCES customers(id)`. After `db/002_supplier_rename.sql` renames `customers` → `suppliers`, this FK target no longer exists and migration 008 would fail. Fixed to `REFERENCES suppliers(id)`.

---

### 13.3 Docker Compose — Supplier Rename on Fresh Init

**File:** `docker-compose.yml`

Added `db/002_supplier_rename.sql` as a third `docker-entrypoint-initdb.d/` script:

```yaml
- ./db/002_supplier_rename.sql:/docker-entrypoint-initdb.d/03_supplier_rename.sql:ro
```

Previously a fresh `docker compose up` would initialize the DB with a `customers` table, but all service code references `suppliers`. The rename was only applied manually. This mount ensures `init → portal → rename` runs automatically in order on every fresh volume.

> **Important:** `docker-entrypoint-initdb.d/` scripts only run when the PostgreSQL data volume is empty. Existing running containers are unaffected. To apply to a live DB, run `db/002_supplier_rename.sql` directly via `psql` if not already applied.

---

### 13.4 Service Layer — `getInvoice` Wired to Correct FK

**File:** `backend/src/modules/orders/orders.service.js`

`getInvoice(orderId)` was querying `WHERE invoices.order_id = $1` — the legacy direction (Invoice → Order). In the new pipeline an invoice is linked to an order via `orders.invoice_id` (Order → Invoice), and a pipeline-created invoice won't have `order_id` set at all. Fixed to traverse the correct FK:

```js
// Before (legacy FK direction)
SELECT i.* FROM invoices i WHERE i.order_id = $1

// After (correct FK direction)
SELECT i.* FROM orders o
JOIN invoices i ON i.id = o.invoice_id
WHERE o.id = $1 AND o.deleted_at IS NULL
```

---

### 13.5 Service Layer Status — All Three Gaps Resolved

| Service File | Gap | Resolution |
|-------------|-----|-----------|
| `invoices.service.js` | `quote_id` FK | Already wired in `create()`: accepts `quote_id`, pulls totals from quotation, logs `invoice_created_from_quote` pipeline event. `order_id` retained for backward compat. ✓ |
| `orders.service.js` | `invoice_id` FK | Already wired in `create()`: accepts `invoice_id`, pulls totals from invoice, logs `order_created_from_invoice` pipeline event. `quotation_id` retained for backward compat. `getInvoice` fixed (see 13.4). ✓ |
| `po.service.js` | `vendor_id` FK | Already wired: `create()` accepts `vendor_id`, `getById()` joins `vendors` table, `vendor_name` text field retained for backward compat. ✓ |

---

### 13.6 Pipeline Event Utility

`backend/src/utils/pipelineEvents.js` exists and exports `logPipelineEvent({ event_type, source_table, source_id, target_table, target_id, triggered_by, metadata })`. It writes to the `pipeline_events` table (created in migration 011) and silently swallows errors (`.catch(() => {})`) so a failed log never kills a business transaction.

---

## 12. Appendix — All ENUMs (Final State)

| ENUM Type | Final Values |
|-----------|-------------|
| `user_role` | Admin / Manager / Sales / Production / Viewer |
| `customer_status` | Active / Inactive |
| `lead_stage` | initiated / quotation / artwork / gangsheet / payment / confirmed |
| `lead_status` | New / Quotation / Pending / Payment Sent / Partial / Confirmed |
| `lead_source` | Facebook Messenger / WhatsApp / Instagram / Email / Walk-in / Phone |
| `quote_status` | Draft / Sent / Approved / Rejected / Expired |
| `order_type` | apparel / gangsheet / dtf |
| `order_status` | Draft / Confirmed / In Production / QC / Ready to Ship / Shipped / Delivered / Cancelled |
| `payment_status` | Unpaid / Partial / Paid / Refunded |
| `payment_method` | cashapp / zelle / paypal / bank_transfer / cash / other |
| `payment_terms` | Due on Receipt / Net 15 / Net 30 / Net 60 |
| `invoice_status` | Draft / Sent / Partially Paid / Paid / Overdue / Void |
| `po_status` | Draft / Sent / Accepted / In Production / Shipped / Received / Partial / Pending Approval / Approved / Partially Received / Closed / Cancelled |
| `shipment_status` | Pending / Label Created / Picked Up / In Transit / Delivered / Exception |
| `product_type` | Apparel / DTF / Gangsheet / Embroidery / Other |
| `artwork_status` | Draft / Pending Approval / Changes Requested / Approved / Archived |
