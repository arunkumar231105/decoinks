# Lead → Quote Auto-Fill — Gap Analysis

**Date:** 2026-05-29  
**Source:** FRD "Fields Data Mapping Flow.pdf" (Lead → Quotation Conversion FRD)  
**Scope:** Gap analysis only — no migrations, endpoints, or UI written.  
**Tests:** 130/130 passing before and after this document was written.

---

## A. Current `leads` Table Columns (Live DB)

Confirmed via `\d leads` on `decoinks_postgres`:

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| lead_number | varchar(30) | Auto-generated |
| supplier_id | uuid | FK → suppliers(id) |
| supplier_name | varchar(150) | Denormalized contact name (maps to "Customer Name" in FRD) |
| source | lead_source enum | `Facebook Messenger, WhatsApp, Instagram, Email, Walk-in, Phone` |
| description | text | General notes/inquiry description |
| stage | lead_stage enum | `initiated, quotation, artwork, gangsheet, payment, confirmed` |
| status | lead_status enum | `New, Quotation, Pending, Payment Sent, Partial, Confirmed` |
| stage_position | integer | Board position |
| assigned_to | uuid | FK → users(id) |
| has_artwork | boolean | Flag only, no count |
| comment_count | integer | Denormalized counter |
| attachment_count | integer | Denormalized counter |
| created_at | timestamptz | |
| updated_at | timestamptz | |
| deleted_at | timestamptz | Soft delete |

**Total: 16 columns.**

> **Note:** Migration `004_leads_pipeline_columns.sql` adds `product_interest VARCHAR(200)` and `artwork_url TEXT` but this migration has **not been applied** to the live database. These columns do not exist in `decoinks_db` today.

---

## B. Current `quotations` and `quotation_items` Columns (Live DB)

### `quotations` (16 columns)

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| quote_number | varchar(30) | Auto-generated, unique |
| lead_id | uuid | FK → leads(id) — linkage exists |
| supplier_id | uuid | FK → suppliers(id) |
| status | quote_status enum | `Draft, Sent, Approved, Rejected, Expired` |
| valid_until | date | |
| subtotal | numeric(12,2) | |
| discount_pct | numeric(5,2) | Header-level only |
| discount_amt | numeric(12,2) | |
| tax_pct | numeric(5,2) | Header-level only |
| tax_amt | numeric(12,2) | |
| total | numeric(12,2) | |
| notes | text | |
| created_by | uuid | FK → users(id) |
| created_at | timestamptz | |
| updated_at | timestamptz | |

**Total: 16 columns.**

> **Note:** Migration `005_quotations_revision_fields.sql` adds `currency`, `revision_number`, `parent_quote_id`, `sent_at`, `approved_at` — **not applied** to live DB. Migration `014_quotations_order_type.sql` adds `order_type` — **not applied** to live DB.

### `quotation_items` (7 columns)

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| quotation_id | uuid | FK → quotations(id) ON DELETE CASCADE |
| description | varchar(255) | Generic line item name |
| qty | integer | |
| unit_price | numeric(12,2) | |
| amount | numeric(12,2) | qty × unit_price |
| sort_order | integer | |

**Total: 7 columns.** No per-line discount, tax, color, size, brand, model, print location, or artwork reference.

---

## C. Full Field-by-Field Gap Table

Every field from the FRD "Core Lead Data Required for Quotation" table, checked against the live schema.

| FRD Section | Lead Field (FRD) | Lead Column (DB) | Status | Quotation Mapping (FRD) | Quote Column (DB) | Quote Status |
|-------------|------------------|-----------------|--------|------------------------|-------------------|-------------|
| Lead Info | Lead ID | `leads.id` | ✅ EXISTS | Reference Lead ID | `quotations.lead_id` | ✅ EXISTS |
| Lead Info | Lead Source | `leads.source` | ✅ EXISTS | Customer Source | — | ❌ MISSING |
| Lead Info | Buyer Type | — | ❌ MISSING | Customer Category | — | ❌ MISSING |
| Customer Info | Customer Name | `leads.supplier_name` | ⚠️ PARTIAL (wrong column name) | Customer Name | — | ❌ MISSING |
| Customer Info | Company Name | — | ❌ MISSING | Company Name | — | ❌ MISSING |
| Customer Info | Email | — | ❌ MISSING | Billing Email | — | ❌ MISSING |
| Customer Info | Phone | — | ❌ MISSING | Contact Number | — | ❌ MISSING |
| Customer Info | WhatsApp | — | ❌ MISSING | WhatsApp Contact | — | ❌ MISSING |
| Customer Info | (WeChat — FRD p.2) | — | ❌ MISSING | WeChat Contact | — | ❌ MISSING |
| Customer Info | Country | — | ❌ MISSING | Shipping Country | — | ❌ MISSING |
| Customer Info | State | — | ❌ MISSING | Shipping State | — | ❌ MISSING |
| Customer Info | ZIP | — | ❌ MISSING | ZIP Code | — | ❌ MISSING |
| Product Interest | Product Type | — (mig 004 unapplied) | ❌ MISSING | Quote Product Grid / Order Type | `order_type` (mig 014 unapplied) | ❌ MISSING |
| Product Interest | Qty | — | ❌ MISSING | Quantity | `quotation_items.qty` | ✅ EXISTS (but no source to populate from) |
| Product Interest | Sizes | — | ❌ MISSING | Size Breakdown | — | ❌ MISSING |
| Product Interest | Colors | — | ❌ MISSING | Product Colors | — | ❌ MISSING |
| Product Interest | Artwork Count | `leads.has_artwork` (boolean) | ⚠️ PARTIAL (boolean only, no count) | Artwork Count | — | ❌ MISSING |
| Product Interest | Delivery Date | — | ❌ MISSING | Due Date / valid_until | `quotations.valid_until` | ⚠️ PARTIAL (validity date, not delivery) |
| Artwork | Artwork Files | `lead_attachments` table | ⚠️ PARTIAL (table exists, no FK from quotations) | Artwork Attachments | — | ❌ MISSING |
| Artwork | Artwork Numbers | — | ❌ MISSING | Artwork References | — | ❌ MISSING |
| Artwork | Mockups | — | ❌ MISSING | Reference Mockups | — | ❌ MISSING |
| Communication | Last Message | — | ❌ MISSING | Customer Requirement Summary | — | ❌ MISSING |
| Sales Intelligence | Estimated Value | — | ❌ MISSING | Quote Estimate | — | ❌ MISSING |
| Assignment | Assigned Agent | `leads.assigned_to` | ✅ EXISTS | Sales Agent | `quotations.created_by` | ⚠️ PARTIAL (created_by ≠ sales agent) |
| Notes | Internal Notes | `leads.description` | ⚠️ PARTIAL (general text, not structured notes) | Internal Notes | `quotations.notes` | ⚠️ PARTIAL (exists, but no auto-copy mechanism) |
| Header | Lead Score (AI) | — | ❌ MISSING | Lead Score display | — | ❌ MISSING |
| Header | — | — | — | Revision Number | — (mig 005 unapplied) | ❌ MISSING |
| Header | — | — | — | Parent Quote ID | — (mig 005 unapplied) | ❌ MISSING |
| Header | — | — | — | Currency | — (mig 005 unapplied) | ❌ MISSING |
| Items | — | — | — | Per-line Discount % | — | ❌ MISSING |
| Items | — | — | — | Per-line Tax % | — | ❌ MISSING |
| Items | — | — | — | Color | — | ❌ MISSING |
| Items | — | — | — | Size Breakdown | — | ❌ MISSING |
| Items | — | — | — | Brand / Model | — | ❌ MISSING |
| Items | — | — | — | Print Location | — | ❌ MISSING |
| Items | — | — | — | Artwork Setup Charges | — | ❌ MISSING |

**Summary: 3 EXISTS | 7 PARTIAL | 28+ MISSING**

---

## D. Contact Fields Gap

The FRD (Section 2A, p.2) requires the Quotation Customer section to auto-fill:

| FRD Field | Lead Column | Status | Notes |
|-----------|-------------|--------|-------|
| Customer Name | `leads.supplier_name` | ⚠️ PARTIAL | Column named `supplier_name` for historical reasons; contains the customer/client contact name. Works but semantically confusing. |
| Company Name | — | ❌ MISSING | No `company_name` column in `leads` or `quotations`. |
| Email | — | ❌ MISSING | No `email` column anywhere in `leads`. |
| Phone | — | ❌ MISSING | No `phone` column in `leads`. |
| WhatsApp | — | ❌ MISSING | No `whatsapp` column in `leads`. |
| WeChat | — | ❌ MISSING | No `wechat` column in `leads`. |

**All contact fields except the client name are missing from the leads table.** The leads model currently stores only the `supplier_name` (mapped to the printshop's customer/client), a `supplier_id` FK to the suppliers table, and a general `description` text field.

The `suppliers` table (formerly `customers`) stores full contact data including `email`, `phone`, `address` etc. for the printshop's vendor suppliers — not the end-customer placing the print order. The FRD implies these are the end-customers/buyers, which currently have no dedicated contact storage on the lead itself.

---

## E. Address Fields Gap

| FRD Field | Lead Column | Status | Quotation Column | Status |
|-----------|-------------|--------|-----------------|--------|
| Country | — | ❌ MISSING | — | ❌ MISSING |
| State / Province | — | ❌ MISSING | — | ❌ MISSING |
| ZIP Code | — | ❌ MISSING | — | ❌ MISSING |
| City | — | ❌ MISSING | — | ❌ MISSING |
| Shipping Address (full) | — | ❌ MISSING | — | ❌ MISSING |
| Billing Address (full) | — | ❌ MISSING | — | ❌ MISSING |

Neither `leads` nor `quotations` has any address columns. Address data would need to be added to `leads` as structured fields (country, state, zip, city) or as a single `shipping_address TEXT` and `billing_address TEXT`, then mirrored onto `quotations`.

---

## F. Product Interest Gap

| FRD Field | Lead Column | Status | Notes |
|-----------|-------------|--------|-------|
| Product Type (Apparel / Gangsheet / DTF) | — | ❌ MISSING | Migration 004 adds `product_interest VARCHAR(200)` but is **not applied** to live DB. Even when applied, it's a single text field, not a structured type that maps to the FRD's `order_type` enum (`apparel`, `gangsheet`, `dtf`). |
| Quantity | — | ❌ MISSING | No quantity field on leads. |
| Sizes (S/M/L/XL) | — | ❌ MISSING | No sizes field on leads. |
| Colors | — | ❌ MISSING | No colors field on leads. |
| Artwork Count | `leads.has_artwork` | ⚠️ PARTIAL | Boolean only (`true/false`). FRD needs an integer count (e.g., "8 artworks"). |
| Delivery Date | — | ❌ MISSING | No delivery/due date on leads. |

The `quotation_items` table also lacks the per-item fields needed for the product grid: `color`, `size_breakdown`, `brand`, `model`, `print_location`, `artwork_setup_charges`. Items only have a generic `description VARCHAR(255)`, `qty`, `unit_price`, `amount`, `sort_order`.

---

## G. AI Fields Gap

The FRD (Section 5, p.3) specifies these AI-sourced fields should flow from Lead into Quotation:

| AI Field (FRD) | Lead Column | Status | Quotation Use (FRD) |
|----------------|-------------|--------|---------------------|
| Conversion Score | — | ❌ MISSING | Priority field on quote |
| Buyer Type | — | ❌ MISSING | Pricing strategy |
| Estimated Order Value | — | ❌ MISSING | Quote prediction |
| Urgency | — | ❌ MISSING | Rush charges |
| Product Interest (AI extracted) | — | ❌ MISSING | Upsell suggestion |
| Repeat Buyer | — | ❌ MISSING | Discount logic |
| Lead Score (header) | — | ❌ MISSING | Non-editable display on quote header |

**All AI fields are entirely absent from the schema.** No AI scoring, buyer classification, urgency flag, or estimated value column exists in `leads`. The FRD assumes a future AI/CRM integration (mentions Chatwoot) that populates these. They are out of scope for the immediate database layer but need dedicated columns before the auto-populate feature can reference them.

---

## H. CRM Communications Snapshot Gap

The FRD (Section 6, p.4) requires the Quotation screen to display a snapshot of lead communications:

| Required Field (FRD) | Table/Column | Status |
|----------------------|-------------|--------|
| Last Customer Message | — | ❌ MISSING — no messages/communications table exists |
| Communication Channel | `leads.source` | ⚠️ PARTIAL — channel of origin exists, but not per-message channel |
| Number of Messages | — | ❌ MISSING — `leads.comment_count` tracks internal comments, not customer messages |
| Attachments Count | `leads.attachment_count` | ✅ EXISTS (denormalized counter on `lead_attachments`) |
| Customer Intent | — | ❌ MISSING |
| Pending Questions | — | ❌ MISSING |

There is no `messages`, `conversations`, or `crm_communications` table in the schema. The system has `lead_comments` (internal staff notes) and `lead_attachments` (uploaded files) but no customer-facing message thread that would provide a "last message" or "customer intent" snapshot.

The FRD references integration with Chatwoot (Section D, FRD p.10: "Auto Generated from CRM/Chatwoot"). This implies an external CRM will push messages into the system — that integration table does not exist. A `lead_crm_snapshot` denormalized table or a direct `lead_messages` table would be needed.

---

## I. Artwork Linkage Gap

### `lead_attachments` → `quotations` path

The `lead_attachments` table exists and has correct FK to `leads(id)`. However:
- No `lead_attachment_id` or artwork reference column exists on `quotation_items`
- No junction table `quotation_artwork_references` exists
- The `artworks` table (17 cols) has `order_id` FK but **no `lead_id` or `quotation_id` FK** — artworks are linked to Orders only, not to Leads or Quotations

| FRD Artwork Field | Current Table | Status | Gap |
|-------------------|-------------|--------|-----|
| Artwork Files (PNG/PSD) | `lead_attachments` | ⚠️ PARTIAL | No reference path from quotation back to lead attachments |
| Artwork Number (AW-xxx) | `artworks.artwork_no` | ⚠️ PARTIAL | `artworks` only links to `orders`, not to `leads` or `quotations` |
| Artwork Thumbnail | `artworks.thumbnail_url` | ⚠️ PARTIAL | Same — only reachable via `orders` |
| Mockups | `lead_attachments` | ⚠️ PARTIAL | Stored as file attachments but not typed/classified by role |
| PSD/AI Source Files | `lead_attachments` | ⚠️ PARTIAL | Stored but not classified — `mime_type` could be used but no `file_role` enum exists |
| Print Locations | `artworks.location_on_product` | ⚠️ PARTIAL | Exists on `artworks` but `artworks` not linked to `leads`/`quotations` |

**Required additions:** A `quotation_artwork_references` junction table (or `artwork_id` column on `quotation_items`), and a `lead_id` FK on the `artworks` table to allow artwork uploaded during lead intake to be pulled into a quotation.

---

## J. Convert-to-Quote Path + `lead_status` Enum Analysis

### J1. Existing Convert-to-Quote Backend Path

**There is no dedicated "Convert to Quote" endpoint.** Search results:

```
grep -r "convert\|/leads.*quote\|lead.*quotation" backend/src/
# No matches in leads or quotations modules
```

What currently exists:
1. **`quotations.service.js` `create()`** accepts `lead_id` as an optional parameter and stores it as a FK — the linkage *record* can be created, but no data is read from the lead.
2. **`POST /api/quotations`** with `{ lead_id }` in the body will associate the quotation with the lead, but the caller must manually supply all other fields (supplier_id, items, notes, etc.). **No auto-population occurs.**
3. **No `GET /api/leads/:id/convert-to-quote`** endpoint exists.
4. **No function** in any service reads a lead record and maps its fields to quotation fields.

**Conclusion:** The `lead_id` FK infrastructure is in place, but the conversion logic (read lead → map fields → pre-fill quotation) does not exist at any layer (DB, backend, or frontend).

### J2. `lead_status` Enum — Current vs. FRD Required

**Current enum values (live DB):**
```
New | Quotation | Pending | Payment Sent | Partial | Confirmed
```

**FRD Section 7 (p.4) requires automatic status transitions:**

| Event | FRD Required Status | Current Status | Gap |
|-------|--------------------|--------------|----|
| Quote generated from lead | `Quotation Generated` | `Quotation` | ⚠️ PARTIAL — `'Quotation'` exists but name does not match; no automation trigger |
| Quote sent to customer | `Quotation Sent` | — | ❌ MISSING |
| Customer approves quote | `Quotation Approved` | — | ❌ MISSING |

The FRD expects three distinct statuses for the quotation lifecycle on the lead side. Only one (`Quotation`) exists, and it is not automatically set when a quotation is created — `leads.status` must be manually updated.

### J3. `quote_status` Enum — Current vs. FRD Required

**Current enum values (live DB):**
```
Draft | Sent | Approved | Rejected | Expired
```

**FRD Section 10 (p.15) and FRD Quotation Status Flow requires:**
```
Draft → Sent → Viewed → Approved → Rejected → Converted to Invoice
```

| Required Status | Current | Gap |
|----------------|---------|-----|
| Draft | ✅ EXISTS | — |
| Sent | ✅ EXISTS | — |
| Viewed | ❌ MISSING | Portal "view" tracking not implemented on quote |
| Approved | ✅ EXISTS | — |
| Rejected | ✅ EXISTS | — |
| Expired | ✅ EXISTS | Not in FRD flow but currently present |
| Converted to Invoice | ❌ MISSING as enum value | Handled implicitly: approval auto-creates invoice, but there is no `'Converted to Invoice'` status on the quotation itself |

### J4. Unapplied Migrations Blocking the Feature

The following migrations exist in `backend/migrations/` but **have not been applied to the live database**, and are required for the convert-to-quote feature to be buildable:

| Migration File | Adds | Needed For |
|---------------|------|-----------|
| `005_quotations_revision_fields.sql` | `currency`, `revision_number`, `parent_quote_id`, `sent_at`, `approved_at` on `quotations` | Revision-friendly quote FRD requirement; quote approval timestamps |
| `014_quotations_order_type.sql` | `order_type` on `quotations` | FRD Order Type section (Apparel / Gangsheet / DTF routing) |
| `004_leads_pipeline_columns.sql` | `product_interest VARCHAR(200)`, `artwork_url TEXT` on `leads` | Partial product interest; artwork URL link |

---

## Summary of All Gaps

### Critical Missing DB Columns (must exist before any convert-to-quote code is written)

**On `leads` table:**
- `contact_name VARCHAR(150)` — or rename semantic meaning of `supplier_name` (currently stores client/customer name)
- `company_name VARCHAR(150)`
- `email VARCHAR(200)`
- `phone VARCHAR(30)`
- `whatsapp VARCHAR(30)`
- `wechat VARCHAR(100)`
- `country VARCHAR(100)`
- `state VARCHAR(100)`
- `zip VARCHAR(20)`
- `city VARCHAR(100)`
- `product_interest VARCHAR(200)` — *in migration 004, unapplied*
- `qty INTEGER`
- `sizes TEXT` or JSONB
- `colors TEXT`
- `artwork_count INTEGER`
- `delivery_date DATE`
- `buyer_type VARCHAR(50)` — or ENUM
- `estimated_value NUMERIC(12,2)`
- `urgency BOOLEAN`
- `last_message_summary TEXT`
- `ai_conversion_score NUMERIC(5,2)`

**On `quotations` table:**
- `contact_name VARCHAR(150)`
- `company_name VARCHAR(150)`
- `email VARCHAR(200)`
- `phone VARCHAR(30)`
- `whatsapp VARCHAR(30)`
- `wechat VARCHAR(100)`
- `shipping_address TEXT`
- `billing_address TEXT`
- `country VARCHAR(100)`
- `zip VARCHAR(20)`
- `buyer_type VARCHAR(50)`
- `source lead_source` (or VARCHAR)
- `sales_agent_id UUID REFERENCES users(id)`
- `currency VARCHAR(3)` — *in migration 005, unapplied*
- `revision_number INTEGER` — *in migration 005, unapplied*
- `parent_quote_id UUID` — *in migration 005, unapplied*
- `sent_at TIMESTAMPTZ` — *in migration 005, unapplied*
- `order_type order_type` — *in migration 014, unapplied*

**On `quotation_items` table:**
- `color VARCHAR(100)`
- `size_breakdown TEXT` or JSONB
- `brand VARCHAR(100)`
- `model VARCHAR(100)`
- `print_location VARCHAR(50)`
- `artwork_id UUID REFERENCES artworks(id)`
- `discount_pct NUMERIC(5,2)`
- `tax_pct NUMERIC(5,2)`
- `gangsheet_size VARCHAR(20)`
- `transfer_size VARCHAR(20)`

### Missing Tables
- `quotation_artwork_references` — junction table linking quotation (or quotation_item) to artwork/lead_attachments
- `lead_crm_snapshot` — or `lead_messages` — for CRM communications data

### Missing `lead_status` Enum Values
- `'Quotation Generated'`
- `'Quotation Sent'`
- `'Quotation Approved'`

### Missing `quote_status` Enum Values
- `'Viewed'`
- `'Converted to Invoice'` (optional — currently handled by invoice FK)

### Missing Backend Logic
- `GET /api/leads/:id/convert-to-quote` endpoint that reads lead and returns pre-filled quotation payload
- `POST /api/leads/:id/convert-to-quote` endpoint that creates quotation with auto-populated fields and sets `lead.status = 'Quotation Generated'`
- Auto-status-update trigger: when quotation `status` changes to `Sent` → set linked lead `status = 'Quotation Sent'`
- Auto-status-update trigger: when quotation `status` changes to `Approved` → set linked lead `status = 'Quotation Approved'`

### Next Available Migration Number
`020` — (highest existing: `019_custom_field_values.sql`)

---

## What Does Exist (Do Not Rebuild)

| Item | Location | Note |
|------|----------|------|
| `quotations.lead_id` FK | `quotations` table | Association link exists |
| `quotations.service.js` `create({ lead_id })` | [backend/src/modules/quotations/quotations.service.js](backend/src/modules/quotations/quotations.service.js) | Accepts `lead_id`, saves it; extend this function for auto-populate |
| `lead_attachments` table | DB | Files exist, just need quotation reference path |
| `leads.source` enum | DB | Lead source already exists and can be copied to quotation |
| `leads.assigned_to` | DB | Sales agent ID available for copy |
| `leads.description` | DB | Can be copied to `quotations.notes` today |
| Quote auto-creates invoice on Approved | [quotations.service.js:updateStatus](backend/src/modules/quotations/quotations.service.js) | Pipeline event fired; `invoice_created_from_quote` logged |
| `artworks` table with `thumbnail_url`, `location_on_product` | DB | Available once `artworks.lead_id` FK added |
