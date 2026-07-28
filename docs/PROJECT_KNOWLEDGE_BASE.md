# Decoinks Printshop OS — Project Knowledge Base

> **Audience:** Long-term maintainers and AI coding assistants.
> **Purpose:** The single source of truth for *how to work in this codebase safely*.
> **Status:** Living document. Update it whenever an assumption here changes.
> **Golden rule:** This system runs a **live production business** (leads → quotes → orders → POs → invoices → shipments). A bad change loses real money and real customer data. Prefer the boring, safe option every time.

---

## 0. How to use this document

Read sections 3 (Never-Violate Rules), 5 (High-Risk Modules), and 9 (Top-20 AI Mistakes) **before touching anything**. When in doubt, stop and ask rather than guess — this codebase has several "looks harmless, is actually load-bearing" traps documented below.

---

## 1. Project Knowledge Base

### 1.1 What this is
A full-stack **Print Shop POS/ERP** for a custom apparel / DTF / gangsheet printing business. It replaces spreadsheets with an end-to-end pipeline and two apps:
- **Admin POS** (`decoinks-frontend/`) — internal staff.
- **Supplier Portal** (`supplier-portal/`) — external printing vendors. ⚠️ The directory `customer-portal/` is **DEAD** (stale `.env` only); the live portal is `supplier-portal/`. Docs that say "customer-portal" are stale.

### 1.2 Architecture at a glance
Modular monolith. Two React SPAs (nginx static) → Express API (`/api/*`) → PostgreSQL (raw `pg`, **no ORM**) + Redis (cache) + MinIO (objects) + Nextcloud (artwork vault) + Groq (AI CSV import).

```
FE (Zustand + react-query + axios)  →  nginx /api → Express (19 route groups)
   → services (business logic, raw SQL)  →  Postgres / Redis / MinIO
   → external: Groq, Nextcloud, Authentik(SSO), BlankTex/DTF sibling schemas
```

### 1.3 The core domain chain (memorize this)
```
leads → quotations → invoices → orders → purchase-orders → shipments
                         ↑____________↓  (circular FK: orders.invoice_id ↔ invoices.order_id)
payments hang off invoices;  artworks cross-link leads/orders/quotations/POs
```
Conversions exist at every hop (`convertToQuote`, quote→invoice on Approve, invoice→order on Paid, order→PO). **These conversions are the most dangerous code in the app** (see §5).

### 1.4 Tech stack
- **Backend:** Node 20, Express 4, `pg` (Pool max 20, `statement_timeout` 20s), Zod, JWT + bcryptjs, Multer + Sharp, Pino, Helmet, ioredis, `@aws-sdk/client-s3` (MinIO), googleapis (dormant).
- **Admin FE:** React 18 + TS, Vite, React Router 6, TanStack Query, Axios, **Zustand**, MUI + Emotion + Tailwind + a 16.5k-line global `index.css`, react-hot-toast.
- **Supplier Portal:** React 18 + TS, Vite, Zustand (**persist → localStorage**), Tailwind. Older deps (lucide-react 0.395).
- **Infra:** Docker Compose (postgres, redis, minio, backend, frontend, supplier_portal).

### 1.5 Standard backend module shape
```
modules/<name>/
  <name>.routes.js       # router.use(verifyToken); Zod schemas; thin route table
  <name>.controller.js   # thin; try/catch → next(err); uniform response helpers
  <name>.service.js      # ALL business logic + raw SQL + transactions
```
There is **no repository layer** and **no ORM**. Services call `pg` directly.

### 1.6 Key file index
| Concern | File |
|---|---|
| Route mounting / middleware chain | `backend/src/app.js` |
| Server boot / MinIO warmup | `backend/server.js` |
| DB pool & type parsers | `backend/src/config/db.js` |
| Object storage (public bucket!) | `backend/src/config/storage.js` |
| Auth middleware (`verifyToken`, `requireRole`) | `backend/src/middleware/auth.js` |
| Zod validation middleware | `backend/src/middleware/validate.js` |
| Error handling | `backend/src/middleware/errorHandler.js` |
| Document numbering (advisory locks) | `backend/src/utils/counter.js` |
| Status transitions (the only per-action authz) | `backend/src/utils/stateMachine.js` |
| Migration runner / baseline | `backend/migrations/run.js`, `ensure-baseline.js` |
| FE API client (silent refresh) | `decoinks-frontend/src/services/api.ts` |
| FE auth store | `decoinks-frontend/src/store/authStore.ts` |
| FE routing | `decoinks-frontend/src/router/index.tsx` |
| Config-driven list/drawer | `decoinks-frontend/src/components/workflow/EnterpriseWorkflowPage.tsx` |

### 1.7 Documentation health warning
- `DATABASE_SCHEMA.txt` is **~30 migrations stale** (frozen at 046; real schema is at 076). Do not trust it — read the migrations.
- `NORMALIZATION_PLAN.md` describes a plan that was **partially reversed** by migration 047. It is aspirational, not current.
- `PROJECT_CONTEXT.md` is broadly accurate for business context but uses the old `customer-portal` name.

---

## 2. Coding standards already in use (follow these)

**Backend**
1. **3-layer separation**: routes (validation) → controller (thin, `next(err)`) → service (logic + SQL). Keep new code in this shape.
2. **Always parameterize SQL** (`$1…$n`). This codebase has *zero* SQL-injection holes — keep it that way. Dynamic identifiers (sort columns, table names) come from **hardcoded allow-lists** or `information_schema`, never from request input.
3. **Mass-assignment protection**: `update()` intersects input against an explicit `allowed` column list (see `customers.service.js`). Copy this pattern.
4. **Transactions for multi-table writes**: `getClient()` + `BEGIN/COMMIT/ROLLBACK` in `try/finally { client.release() }`.
5. **Zod on every create/update body**; `validate()`/`validateQuery()` middleware. Use `.strict()` on update schemas where drift matters; `emptyable()` for optional-but-validated fields.
6. **Document numbers via `counter.js`** (`getNextNumber` / `getNextInvoiceNumber`) — advisory-lock safe. Never hand-roll `MAX()+1`.
7. **Status changes via `stateMachine.js`** (`validateTransition(entity, from, to, actor)`). Never set a status column directly to skip the machine.
8. **Uniform responses**: `success` / `created` / `paginated` helpers; errors via `next(err)`.
9. **Stamp actor**: inject `created_by: req.user.id` in controllers.
10. **Redis is fail-open** — cache helpers swallow errors; never make correctness depend on Redis.

**Frontend**
1. **Server state → react-query**; client/session state → the single Zustand `authStore`. Don't add new global stores casually.
2. **All HTTP via `services/api.ts`** (never bare `fetch`) so auth/refresh/error handling apply.
3. **Access token in memory only**; refresh token is an httpOnly cookie. Never move tokens to localStorage in the admin app.
4. **Lazy-load pages** through the `page()` helper in the router.
5. **Toasts via `utils/toast.ts`** (`toast.apiError` for API errors).
6. **Error text and 422 field details** surface through `apiErrorParser.ts`.

**Both**
- CommonJS on backend, ESM/TS on frontend.
- Absolute-ish module imports within a package; **cross-module backend imports use lazy `require()` inside functions** to avoid circular-load crashes (quotations↔invoices↔orders). Preserve this.

---

## 3. Rules that must NEVER be violated

> Breaking any of these can wipe data, leak the CRM, or take down production.

1. **Never write a destructive migration that `DELETE`s / `TRUNCATE`s business data.** Migration `047` did this and is a landmine. Migrations change *schema*, never bulk-mutate transactional rows. Data fixes are separate, reviewed, backed-up scripts run by a human.
2. **Never bulk-overwrite the payments ledger** (as `076` did). `payments` is the source of truth; `invoices.amount_paid/balance_due` are derived (trigger `sync_invoice_payment_totals`). Don't hand-set them except through the existing reconcile path — and know that path already double-writes (see §5).
3. **Never reuse a migration number.** Numbers 052/053/054/072/074 are already duplicated; ordering survives on alphabetical luck. Always use the next unused integer, zero-padded, unique.
4. **Never edit an already-applied migration file.** The runner tracks by filename only and will not re-run it; you will create silent drift. Add a new migration instead.
5. **Never bypass `counter.js` for document numbers** or `stateMachine.js` for status changes.
6. **Never concatenate request data into SQL.** Parameterize. Dynamic identifiers only from allow-lists.
7. **Never commit secrets.** `docker-compose.yml` is tracked and currently contains hardcoded secrets — do not add more, and do not copy real secrets into any tracked file. Real secrets live in gitignored `.env`.
8. **Never widen the MinIO bucket or accept new file types without review.** The bucket is public-read and SVG is allowed (stored-XSS risk). Uploads validate client MIME only.
9. **Never assume a role check exists.** Only 2 of ~90 endpoints use `requireRole`. If you add a privileged action, you must add the guard yourself.
10. **Never trust that supplier and staff tokens are isolated** — they share `JWT_SECRET`. Do not add code that assumes a valid token means "staff".
11. **Never make `invoices.service.create` (or its callers) assume atomicity** — it is currently *not* transactional. Don't build on that assumption; if you touch it, make it transactional (but test the whole quote→invoice→order chain).
12. **Never remove the lazy `require()` calls** between quotations/invoices/orders — they prevent circular-import crashes.
13. **Never change a shared column** (`orders.*`, `invoices.*`, `order_items_*`, address columns) without checking §5's blast radius — three modules write `orders` via inline SQL.
14. **Never delete a `users` row casually** — dozens of unindexed `created_by/assigned_to` FKs block and slow it.

---

## 4. Files that should RARELY be modified (change only with explicit intent + tests)

| File / area | Why it's load-bearing |
|---|---|
| `backend/src/utils/counter.js` | All document numbering; advisory-lock concurrency safety. |
| `backend/src/utils/stateMachine.js` | The only real per-action authorization in the app. |
| `backend/src/config/db.js` | Pool + timeouts protect the whole app from runaway queries. |
| `backend/src/config/storage.js` | Bucket policy; changing it affects every asset URL + security. |
| `backend/src/middleware/auth.js` | Auth for every route; shared secret across trust domains. |
| `backend/src/app.js` | Middleware order + route mounting. |
| `backend/migrations/run.js`, `ensure-baseline.js`, `039_baseline_repair.sql` | Migration engine + the shim that heals two historical schema sources. |
| **Any already-applied migration file** | Editing = silent drift (see rule 4). |
| `quotations.service.js`, `invoices.service.js`, `orders.service.js` (the conversion paths) | Triplicated, cyclic, partly non-transactional. Highest-risk logic. |
| `decoinks-frontend/src/services/api.ts` | Silent-refresh + request-queue; subtle. |
| `decoinks-frontend/src/store/authStore.ts` | SSO/refresh bootstrap with loop guards. |
| `decoinks-frontend/src/index.css` (16.5k lines) | Global classes used everywhere; edits ripple app-wide. |

---

## 5. High-risk modules (handle with maximum care)

1. **invoices ↔ quotations ↔ orders (the conversion triangle)** — Highest risk.
   - Invoice/order creation logic is **triplicated** (inline SQL in `quotations.updateStatus` on Approve, `invoices.updateStatus` on Paid, `invoices.autoCreateOrder`, plus the delegate services). They **drift**.
   - Idempotency is a `SELECT … WHERE quote_id/invoice_id` with **no backing UNIQUE constraint** → concurrent Approve/Pay can double-create.
   - `invoices.service.create` is **not transactional** and swallows item-copy failures → orphan invoices with no line items.
   - **Blast radius:** changing `orders`/`order_items_*`/`invoices` columns breaks invoice payment flows, not just order creation.

2. **orders — payment reconciliation** — `reconcileInvoicePayment` manually writes `invoices.amount_paid/balance_due/status` *and* a DB trigger does the same → **double source of truth**.

3. **purchase-orders** — 11-state machine; `upsertPoShipment` writes `shipments` and sets `orders.status='Shipped'` **bypassing the state machine**; no role authz; can push arbitrary POs to external suppliers (IDOR).

4. **shipments** — **dual-written** by the PO module with a **different status vocabulary**; no reconciliation.

5. **artworks / gangsheet / vault** — `gangsheet.service.js` is **currently broken** (resolves local FS paths against MinIO URLs; fails silently). Vault sync deletes rows not seen in 5 min and auto-links by fuzzy `ILIKE` (mis-link risk). `getBoard` has **no LIMIT**.

6. **import (AI/Groq)** — prompt-injection surface (raw CSV → LLM prompt) + uncapped per-user cost. Safe *only* because a deterministic validator + human confirm sit downstream. Never let AI output write the DB directly.

7. **supplier-portal** — best-scoped module, but internet-facing with **no login rate limiting** and **refresh that never re-checks `is_active`**.

8. **CDC (`integration.data_events`)** — AFTER-triggers on `customers/leads/orders/products` copy full rows (incl. PII) into an unbounded log. Any change to those tables' write volume amplifies here.

---

## 6. Safe development guidelines

1. **Read before you write.** Grep for every reader/writer of a table or column before changing it. Three modules write `orders` via inline SQL; a `grep -r "INSERT INTO orders" backend/src` is mandatory before an orders change.
2. **Small, reversible changes.** One concern per change. Additive over destructive (new nullable column, not a rename).
3. **Schema changes = new migration only.** Next unused number, zero-padded, unique suffix. Use `IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS` / `ADD … NOT VALID` then guarded `VALIDATE` (see `040`). Never `DELETE`/`TRUNCATE` business rows.
4. **Preserve the data flow.** When adding validation or transforms, empty/optional values must still pass; edit-mode must still populate; payload shapes must not change unless intended. (This has bitten before.)
5. **Add the authz you rely on.** New privileged endpoint → add `requireRole(...)` and, where applicable, an ownership check. Don't assume the matrix enforces anything (it doesn't, server-side).
6. **Keep it transactional.** Multi-table writes → one transaction. Don't add a new "auto-create on status change" as inline SQL outside a transaction.
7. **Numbers and statuses go through the shared utils.** Never hand-roll.
8. **Clamp queries.** Any new list endpoint: validate + clamp `limit` (there is a systemic unclamped-`+limit` bug — don't add another). Add pagination; never load-all-and-filter-client-side.
9. **External calls fail gracefully.** Wrap Nextcloud/Groq/MinIO calls with timeouts + explicit error handling; never let them hang a request or crash a transaction.
10. **Frontend: revoke object URLs** in `useEffect` cleanup; go through `services/api.ts`; prefer react-query over imperative `useState` fetches.
11. **Don't grow the monoliths.** The four ~1,200–1,668-line "New*" form pages and `index.css` are already too big — extract, don't append.
12. **Verify against the live app**, not just tests, for anything touching money, status, or addresses.

---

## 7. Adding new features without breaking things

**Backend feature checklist**
1. New domain? Create `modules/<name>/{routes,controller,service}.js` following the canonical `customers` module.
2. New table? New migration (unique next number), with FK + the right indexes (index every FK and every column you filter/sort on — the app has missing-FK-index debt).
3. Validate input with Zod; clamp/paginate lists; parameterize all SQL; use allow-lists for dynamic identifiers.
4. Add `verifyToken` (already global per-router) **and** `requireRole`/ownership for privileged actions.
5. Multi-table writes in a transaction; document numbers via `counter.js`; status via `stateMachine.js`.
6. If it participates in the lead→…→shipment chain, **do not add inline cross-module SQL** — call the owning service. Reduce coupling, don't add to it.
7. Mind the CDC triggers if writing to `customers/leads/orders/products`.

**Frontend feature checklist**
1. New page → lazy route in `router/index.tsx` with `handle` metadata; wrap in `ProtectedRoute` unless intentionally public (print/auth pages are public and self-auth).
2. Data via react-query + `services/api.ts`. Reuse `EnterpriseWorkflowPage` for list/drawer views.
3. Reuse `ui/` primitives; avoid new bespoke modal/backdrop markup; avoid inline styles where a class exists.
4. Gate privileged UI by role, but remember **the server must also enforce it** — UI hiding is not security.
5. Clean up effects (timers, subscriptions, object URLs).

**Rollout**
- Prefer additive/behind-a-flag where risk is high.
- Deploy path: docker-compose rebuild of affected services (`backend`/`frontend`/`supplier_portal`). Docs-only changes don't need a redeploy.

---

## 8. Regression testing checklist (complete BEFORE every commit)

**Automated**
- [ ] `cd backend && npm test` (15 integration/unit tests) passes.
- [ ] `cd decoinks-frontend && npx tsc --noEmit` clean (no FE unit tests exist — typecheck is the safety net).
- [ ] Lint passes where configured.
- [ ] Relevant Playwright e2e (`e2e/`) still pass if the flow you touched is covered (auth, leads, invoice, customers, quotes).

**Manual — always**
- [ ] The app still **boots** (backend logs "running on port", MinIO bucket ready; frontend loads; login works).
- [ ] The specific feature works in the **real app**, both create and **edit** mode.
- [ ] No console errors; no new network 4xx/5xx on the touched screens.

**Manual — if you touched the money/status chain (quotes/orders/invoices/POs/payments)**
- [ ] Create quote → Approve → invoice generated **with line items** (guard against the orphan-invoice bug).
- [ ] Invoice → record payment → status + `balance_due` correct; no duplicate order created.
- [ ] Invoice Paid / convert-to-order → exactly **one** order; items copied correctly.
- [ ] Order → convert-to-PO → PO items correct; PO status transitions valid.
- [ ] Document numbers increment correctly and don't collide.
- [ ] No status set outside the state machine.

**Manual — if you touched schema/migrations**
- [ ] Migration number is the next unused, unique.
- [ ] No `DELETE`/`TRUNCATE` of business data; additive + idempotent.
- [ ] Runs clean on a copy; app boots against the migrated DB.
- [ ] New FK columns are indexed.

**Manual — if you touched addresses/customers**
- [ ] All three address models stay consistent where the feature reads them; empty/optional fields still save; edit mode still populates; snapshot copies aren't silently desynced.

**Manual — if you touched auth/authz/uploads**
- [ ] Privileged actions have `requireRole`/ownership; a low-role token is actually blocked.
- [ ] Supplier token can't reach the new staff endpoint.
- [ ] Upload type/size limits hold; no new public exposure.

**Before pushing**
- [ ] No secrets added to tracked files.
- [ ] Diff is scoped to the intended change (no stray reformatting of monoliths).

---

## 9. Top 20 mistakes an AI assistant will likely make here — and how to avoid them

1. **Trusting `DATABASE_SCHEMA.txt` / `NORMALIZATION_PLAN.md`.** They're stale/reversed. → Read the migrations (up to 076) and the live DB.
2. **Editing the "customer-portal" for portal work.** It's dead. → Work in `supplier-portal/`.
3. **Assuming the RBAC matrix protects endpoints.** It's UI-only. → Add `requireRole`/ownership server-side yourself.
4. **Assuming a valid JWT means "staff".** Supplier tokens share the secret. → Check role/audience explicitly.
5. **Writing a data-fixing migration** (`UPDATE`/`DELETE` on business rows). → Migrations are schema-only; data fixes are separate, backed-up, human-run scripts. Remember 047/076.
6. **Reusing or editing a migration number/file.** → Next unique integer; never edit applied files.
7. **Hand-rolling document numbers or status changes.** → Use `counter.js` and `stateMachine.js`.
8. **Adding inline cross-module SQL** (e.g. inserting into `orders` from a new place). → Call the owning service; don't extend the triplication.
9. **Assuming `invoices.service.create` is transactional.** It isn't. → Don't build on it; if editing, wrap it and test the whole chain.
10. **Changing a shared column** (`orders.*`, `invoices.*`, `order_items_*`, addresses) without grepping all writers. → Three modules write `orders` via inline SQL; check blast radius (§5).
11. **Over-strict validation that breaks the data flow** — rejecting empty optionals, mangling edit-mode, changing payload shape. → Validate only when present; preserve shapes; test create *and* edit.
12. **Removing the lazy `require()` between quotations/invoices/orders.** → It prevents circular-import crashes; keep it.
13. **Adding an unclamped `limit` list endpoint or client-side "load 1000 then filter".** → Validate + clamp `limit`; paginate server-side.
14. **Widening uploads / bucket** (new MIME, public policy) casually. → Public bucket + SVG is already a risk; don't add to it.
15. **Committing secrets** to `docker-compose.yml` or any tracked file. → Real secrets only in gitignored `.env`.
16. **Leaking raw `e.message`** in new handlers. → Funnel through `next(err)`; don't echo internals.
17. **Trusting the payment totals columns as source of truth.** → `payments` is source of truth; totals are trigger-derived and already double-written.
18. **Growing the monolith files** (`New*Page.tsx`, `index.css`) or adding a 4th styling approach. → Extract/reuse; use existing `ui/` primitives and classes.
19. **Forgetting `useEffect` cleanup** (object URLs, timers) → memory leaks (already 3 in-tree). → Always revoke/clear on unmount.
20. **Taking unnecessary DB backups / leaving artifacts** — the maintainer explicitly does **not** want reflexive backups. → Only back up when a change is genuinely risky, and delete it once verified. Don't leave `.sql`/`.csv` dumps lying around.

---

*End of Knowledge Base. Keep it honest — when you discover this document is wrong, fix the document in the same change.*
