# Database Normalization — Phased Plan

Target: the ERP-style normalized schema from the review (parties, central
addresses/contacts/files, single order-item model, payments as source of
truth, unified audit/status history).

## Why phased, not big-bang

Merging `customers`/`suppliers`/`vendors` into `parties`, collapsing the three
`order_items_*` tables, and dropping the duplicated snapshot columns all
require **every backend query and frontend type that touches those tables to
change at the same time**. Doing that in one migration on the live database
cannot be reconciled with the hard requirements: **zero data loss, zero
functionality change, no errors.**

The professional approach is **expand → migrate → contract**:

1. **Expand (additive):** create the new normalized tables and backfill them
   from existing data. Nothing old is removed, so all current code keeps
   working unchanged.
2. **Migrate (per module):** point each module's code at the new tables, one
   at a time, testing after each. Behaviour stays identical.
3. **Contract:** only after a module fully reads/writes the new tables, retire
   its duplicated columns.

Each step is independently deployable and reversible. No step ships until it
has been rehearsed against a copy of the live database.

---

## Status

### ✅ Phase 1 — master layer (migration `046_normalized_master_layer.sql`)  — ADDITIVE, DONE
Creates and backfills, without touching any existing table:

| New table | Replaces the duplication of… | Backfilled from |
|---|---|---|
| `parties` | customers + suppliers + vendors (the company/person identity) | all three tables |
| `party_roles` | the fact that one company can be customer AND supplier AND vendor | derived per source |
| `party_contacts` | email/phone/whatsapp/wechat copied into every table | suppliers, customers, vendors |
| `party_addresses` | country/state/city/zip/address copied into every table | suppliers, customers, vendors |
| `files` + `file_links` | file_url / image_url / thumbnail_url / front_image / back_image everywhere | artworks, po_attachments, lead_attachments |
| `status_history` | per-module status history tables | po_status_history |

Provenance columns (`source_table`, `source_id`) map each new row back to its
origin, so the backfill is idempotent and Phase 2 can wire foreign keys safely.

### ⬜ Phase 2 — point reads at the master layer (no column drops yet)
- Party dropdowns (customer/supplier/vendor pickers) read from `parties` +
  `party_roles` instead of three separate tables.
- Document detail views resolve contact/address by joining `party_contacts` /
  `party_addresses` instead of reading the copied columns.
- Artwork/file displays resolve through `file_links`.
- Each screen migrated and verified individually.

### ⬜ Phase 3 — writes to the master layer + dual-write bridge
- New leads/quotes/orders store `party_id` + `billing_address_id` +
  `shipping_address_id` (FKs already implied by Phase 1 tables).
- A short dual-write window keeps the old snapshot columns populated so any
  un-migrated screen still works.

### ⬜ Phase 4 — unify order items
- Introduce a single `order_items` table with `product_type` + `item_config`
  JSONB; backfill from `order_items_apparel/gangsheet/dtf`; migrate the order
  module; then retire the three tables.

### ⬜ Phase 5 — products with variants; artwork versions/placements/approvals
- `products` → `products` + `product_variants` (+ attributes).
- `artworks` → `artworks` + `artwork_versions` + `artwork_placements` +
  `artwork_approvals`.

### ⬜ Phase 6 — contract
- Drop `amount_paid` / `balance_due` (already derivable from `payments`; a
  trigger keeps them correct today, so this is safe to defer).
- Drop the duplicated contact/address/snapshot columns once no code reads them.
- Optionally fold `customers`/`suppliers`/`vendors` into views over `parties`
  for backward compatibility, then remove.

---

## Guarantees held at every phase
- **No data loss:** phases only add tables/columns and copy data; drops happen
  only in Phase 6, after the data lives in the new structure and is verified.
- **No functionality change:** old columns/tables remain until their readers
  are migrated; the app behaves identically at each deploy.
- **No errors:** every migration is idempotent and is rehearsed against a
  restored copy of the live database before it touches production.

## Deploying Phase 1
See `DB_DEPLOYMENT_RUNBOOK.md`. In short: back up → restore into a scratch DB
→ run migrations against the scratch DB and confirm `046` prints `OK` and the
new tables are populated → deploy to production. Phase 1 changes **no backend
code**, so only the database migration runs; the running app is unaffected.
