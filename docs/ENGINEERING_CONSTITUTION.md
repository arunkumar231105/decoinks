# Decoinks Printshop OS — Engineering Constitution

> **Status:** MANDATORY. This document permanently governs all development.
> **Authority:** Every developer and every AI assistant MUST read and obey this before making any change. When this document and any other instruction conflict, **this document wins** unless the human owner explicitly overrides it in writing.
> **Prime Directive:** This is a **live production business system** (Customer → Quotation → Invoice → Sales Order → Purchase Order → Shipment). **Stability outranks everything.** The current production behavior is the **baseline** and is presumed correct until proven otherwise with evidence.
> **Companion:** Read [PROJECT_KNOWLEDGE_BASE.md](PROJECT_KNOWLEDGE_BASE.md) first for context, module map, and the Top-20 AI pitfalls. This Constitution is the law; the KB is the map.

---

## SECTION 1 — PROJECT RULES (non-negotiable)

1. **Preserve the baseline.** Do not change business workflow, API contracts, UI behavior, or database behavior **unless explicitly approved in writing** by the owner. "It looks wrong" is not approval — verify intent first.
2. **Smallest possible change.** Every change must be minimal, independently testable, and reversible.
3. **One risk at a time.** Never combine two high-risk changes in one commit or deploy.
4. **Evidence over assumption.** Verify every conclusion against actual code. Label anything unconfirmed as **"Not verified"**. Never assert a fix works without testing it.
5. **Parameterized SQL only.** No request data concatenated into SQL, ever. Dynamic identifiers come only from hardcoded allow-lists or `information_schema`.
6. **Use the shared safety utilities.** Document numbers → `utils/counter.js`. Status changes → `utils/stateMachine.js`. Never hand-roll either.
7. **Transactions for multi-table writes.** `getClient()` + `BEGIN/COMMIT/ROLLBACK` in `try/finally { release() }`.
8. **Migrations are schema-only and additive.** Never `DELETE`/`TRUNCATE`/bulk-`UPDATE` business data in a migration (see Section 6 and the 047/076 precedent).
9. **No secrets in tracked files.** Real secrets live only in gitignored `.env`. Never add secrets to `docker-compose.yml` or any tracked file.
10. **No unnecessary backups.** Do not create reflexive DB dumps/backup files. Back up only when a change is genuinely risky, and delete the backup once the change is verified. (Standing owner preference.)
11. **Never remove the lazy `require()`** between quotations/invoices/orders — it prevents circular-import crashes at boot.
12. **Authorization is not assumed.** Only 2 endpoints currently enforce roles. Any privileged action you add or touch must carry its own guard; UI hiding is never security.
13. **Fail loud in analysis, fail safe in production.** Report problems honestly (failing tests, skipped steps) — never paper over them. In code, prefer safe/reversible behavior.
14. **Redeploy discipline.** After any approved code change: rebuild only the affected Docker services and push to `main`. Docs-only changes need no redeploy.

---

## SECTION 2 — FILES THAT MUST NEVER BE MODIFIED WITHOUT APPROVAL

Changing any file below requires explicit owner approval **and** a written blast-radius analysis (Section 10).

| File / area | Why it is protected |
|---|---|
| `backend/src/utils/counter.js` | Advisory-lock document numbering; a bug produces duplicate/colliding QT/ORD/INV/PO numbers across the whole business. |
| `backend/src/utils/stateMachine.js` | The only real per-action authorization + all legal status transitions. |
| `backend/src/config/db.js` | PG pool + `statement_timeout`/`query_timeout` — the sole backstop against runaway queries; global blast radius. |
| `backend/src/config/storage.js` | MinIO bucket policy + object URLs; touches security and every asset in the app. |
| `backend/src/config/redis.js` | Fail-open cache contract; a change can make correctness depend on Redis. |
| `backend/src/middleware/auth.js` | Auth for every route; shared `JWT_SECRET` spans staff + supplier trust domains. |
| `backend/src/middleware/validate.js`, `errorHandler.js` | Validation + error contract for the whole API. |
| `backend/src/app.js`, `backend/server.js` | Middleware order + route mounting + boot. |
| `backend/migrations/run.js`, `ensure-baseline.js`, `039_baseline_repair.sql` | The migration engine + the shim that reconciles two historical schema sources. |
| **Any already-applied migration file** | The runner tracks by filename only; editing one causes silent, undetectable drift. |
| `backend/src/modules/quotations/quotations.service.js` | Quote→Invoice conversion (inline invoice creation on Approve). Core money workflow. |
| `backend/src/modules/invoices/invoices.service.js` | Invoice→Order conversion (3 paths) + payments ledger; `create()` is currently non-transactional. Highest-risk service. |
| `backend/src/modules/orders/orders.service.js` | Order creation + payment reconciliation + Order→PO; three modules write `orders`. |
| `backend/src/modules/purchase-orders/po.service.js` | PO creation, 11-state machine, shipment mirror that can set `orders.status`. |
| `decoinks-frontend/src/services/api.ts` | Axios silent-refresh + request-queue; subtle auth machinery. |
| `decoinks-frontend/src/store/authStore.ts` | SSO/refresh bootstrap with loop guards. |
| `decoinks-frontend/src/index.css` (16.5k lines) | Global classes used app-wide; edits ripple everywhere. |
| `decoinks-frontend/src/router/index.tsx` | Route + guard topology. |
| `docker-compose.yml` | Tracked; contains deployment wiring (and, currently, secrets to remove — owner-approved only). |

---

## SECTION 3 — SAFE CHANGE POLICY

**Default limits for a routine bug fix:**
- **Maximum files:** 3 (hard ceiling 5). Beyond 5 → stop and request approval.
- **Maximum modules:** 1.
- **Maximum services:** 1.
- **Maximum migrations:** 0 for a routine fix (schema changes are a separate, approved track).

**Implementation MUST STOP and request approval when the fix would:**
- touch any file in Section 2, or
- span more than one module/service, or
- alter a conversion path (quote→invoice→order→PO), payments, or numbering/status logic, or
- require a schema/migration change, or an auth/permission change, or
- change any API response shape, status code, or endpoint, or
- change UI behavior a user can observe, or
- exceed the file/module/service limits above.

**Request approval BEFORE writing code when** the change is high-risk (Section 2 files, conversion core, auth, storage, schema) or when blast-radius analysis shows more than one module is affected. Approval is per-change and does not carry to the next change.

---

## SECTION 4 — FEATURE DEVELOPMENT POLICY

1. **Additive first.** New tables/columns are nullable and additive; new endpoints are new paths — never repurpose existing ones.
2. **Follow the module pattern.** `routes → controller → service`, following the canonical `customers` module. No repository/ORM is introduced.
3. **Do not add inline cross-module SQL.** If a feature participates in the conversion chain, call the owning service — never insert into another module's tables. Do not extend the existing triplication.
4. **Index every FK and every filter/sort column** you add (the schema already carries missing-index debt).
5. **Validate and clamp.** All new inputs use Zod; all new list endpoints validate + clamp `limit` and paginate server-side. Never load-all-and-filter client-side.
6. **Authorize.** Privileged actions carry `requireRole`/ownership checks; the server enforces, not the UI.
7. **Don't grow the monoliths.** Do not append to the 1,200–1,668-line form pages or `index.css`; build new, small, reusable pieces using existing `ui/` primitives.
8. **External calls are wrapped** (timeouts + explicit error handling) and never hang a request or a transaction.
9. **Behind a flag when risky.** Prefer feature flags/gradual exposure for anything near the money workflow.
10. **Never change existing workflow/API/UI/DB behavior** as a side effect of a new feature.

---

## SECTION 5 — BUG FIX POLICY

**Required workflow before every bug fix (in order):**
1. **Reproduce** the bug and capture the current (baseline) behavior.
2. **Verify the root cause from actual code** — cite file:line. No guessing.
3. **Impact analysis** — which modules/tables/endpoints/screens read or write the code path? (Grep all readers/writers; remember three modules write `orders`.)
4. **Risk analysis** — could the fix change workflow, API shape, UI, numbering, status, totals, or data population? If yes → stop, request approval.
5. **Regression analysis** — what existing behavior could silently break? Map to the QA checklist categories (conversion, concurrency, consistency).
6. **Rollback analysis** — exactly how is this reverted (single-file revert? config? data?), and is it clean?
7. Only then implement — smallest change, within Section 3 limits.
8. Test per Section 9, including **create and edit** paths and the affected conversion links.

If any of steps 3–6 reveal multi-module scope, conversion-core impact, or schema need → **stop and escalate.**

---

## SECTION 6 — DATABASE POLICY

**Migrations**
- New migration only; **next unused integer, zero-padded, unique** filename. Never reuse a number (052/053/054/072/074 are already duplicated — do not add to the problem).
- **Never edit an already-applied migration.** Add a new one.
- **Additive + idempotent**: `IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`; for CHECKs on possibly-dirty data use `ADD … NOT VALID` then a guarded `VALIDATE` (pattern in `040`).
- **Migrations MUST NOT mutate business data.** No `DELETE`/`TRUNCATE`/bulk-`UPDATE` of transactional rows. (Precedent: `047` wiped data; `076` overwrote the ledger — never again.)
- No down-migrations are wired at runtime; rollback is forward-fix or restore — plan accordingly.

**Schema changes** — require explicit owner approval and a blast-radius analysis. Respect the three coexisting address models and the snapshot columns; do not "clean them up" without approval.

**Transactions** — every multi-table write is one transaction. Conversion writes must be atomic. Do not rely on best-effort post-commit writes for anything a user must see as consistent (except the documented, intentional exceptions).

**Backups** — do not create backups by default. When a change is genuinely destructive/risky, take a scoped backup, complete + verify the change, then delete the backup. No stray dumps left in the tree.

**Data fixes** — any bulk data correction is a **separate, reviewed, owner-approved script** run by a human (never a migration), with a backup taken first and removed after verification.

---

## SECTION 7 — API POLICY

APIs must NEVER violate:
1. **Endpoint stability** — do not rename, remove, or repurpose existing paths/verbs.
2. **Response contract** — preserve the `success`/`created`/`paginated` envelope, field names, and HTTP status codes. New fields may be added; existing ones are not removed or retyped without approval.
3. **Validation** — every create/update body validated with Zod; list queries validate + clamp `limit`.
4. **Parameterized SQL** — always; identifiers from allow-lists only.
5. **Authorization** — privileged actions carry role/ownership guards; supplier tokens must not reach staff-only data (a known gap — do not widen it).
6. **Error hygiene** — errors funnel through the central handler; never leak raw `e.message`/PG codes/stack in responses.
7. **Idempotency** — conversion endpoints keep their idempotency guards; do not remove them even where the DB backstop is unverified.
8. **No breaking side effects** — a change to one endpoint must not alter another's behavior.

---

## SECTION 8 — UI POLICY

1. **Preserve observable behavior** unless the change is explicitly approved.
2. **Reuse before rebuild** — use `components/ui/*` primitives and existing classes; do not introduce a fourth styling system (already have global CSS + Tailwind + MUI + inline).
3. **All HTTP via `services/api.ts`** — never bare `fetch`; keep the token/refresh/error pipeline intact.
4. **Clean up effects** — revoke object URLs, clear timers/subscriptions on unmount.
5. **Preserve data population** — new validation/transforms must let empty/optional values pass, keep edit-mode pre-fill working, and never change payload shape.
6. **Gate privileged UI by role** — but never treat UI hiding as security.
7. **Do not enlarge the form monoliths**; extract new small components instead.
8. **Accessibility & responsiveness** — do not regress existing `aria`/keyboard/mobile behavior.

---

## SECTION 9 — TESTING POLICY

**Must pass BEFORE every commit:**
- `cd backend && npm test` (all backend tests green).
- `cd decoinks-frontend && npx tsc --noEmit` clean (the primary FE safety net — there are no FE unit tests).
- Lint where configured.
- Manual: app boots, login works, and the touched feature works in **create and edit** mode with no new console/network errors.

**Must pass BEFORE every deployment:**
- Full backend suite + relevant Playwright e2e (auth, leads, invoice, customers, quotes).
- Boot verification (backend "running on port…", MinIO bucket ready; both frontends load).
- If the money/status chain was touched: the full conversion regression (quote→invoice→order→PO, payments, numbering, one-next-doc, item/total/address fidelity).
- If a migration is included: applied cleanly on a copy; app boots against the migrated DB; new FK columns indexed; no data mutation.
- Smoke test of the specific change on a staging/canary path where possible.

A red test is a stop condition. Never deploy over failing tests.

---

## SECTION 10 — AI DEVELOPMENT POLICY

**How AI must work here**
1. Read this Constitution and the KB first. Treat recalled memories as background, and re-verify any file/flag/behavior they mention against current code.
2. Work from verified evidence (file:line). Mark unknowns **"Not verified."** Never fabricate results, and never predict a background task's output.
3. Make the smallest reversible change within Section 3 limits.

**AI is ALLOWED to:**
- Read, search, and analyze freely (read-only).
- Implement an approved, in-scope change that obeys Sections 3–9.
- Run tests, typecheck, and rebuild affected services after an approved change.
- Propose plans, classifications, and roadmaps (no code) at any time.

**AI is NEVER allowed to:**
- Modify a Section 2 file, the conversion core, auth, storage, or schema **without explicit approval**.
- Write a data-mutating migration or bulk data change.
- Combine two high-risk changes.
- Change workflow/API/UI/DB behavior as a side effect.
- Commit secrets, remove idempotency guards, or delete the lazy `require()`s.
- Create reflexive backups or leave stray dumps.
- Claim something works without testing it, or hide a failure.

**How AI estimates blast radius (required before any code change):**
1. Grep every reader and writer of each table/column/function touched (e.g., `INSERT INTO orders` appears in three services).
2. List affected modules, endpoints, screens, and conversion paths.
3. Identify snapshot copies, triggers (CDC, `sync_invoice_payment_totals`), and RESTRICT FKs in the path.
4. Classify the change risk (Low/Med/High) and count files/modules/services vs Section 3 limits.
5. If radius > one module, or hits Section 2 / conversion / auth / schema → **stop**.

**How AI requests approval:**
State (a) the exact change, (b) files/modules/services affected, (c) blast-radius summary, (d) risk level, (e) test plan, (f) rollback plan, and (g) explicitly ask the owner to approve before proceeding. Proceed only on an affirmative, and treat approval as valid for that change only.

---

## SECTION 11 — PRE-COMMIT CHECKLIST (mandatory)

- [ ] Change is within Section 3 limits (≤3–5 files, 1 module, 1 service; 0 migrations for routine fixes).
- [ ] No Section 2 file touched without approval.
- [ ] Root cause verified from code (file:line).
- [ ] Impact / risk / regression / rollback analyses done (Section 5).
- [ ] No workflow / API contract / UI / DB behavior change (or explicit approval attached).
- [ ] SQL parameterized; numbering via `counter.js`; status via `stateMachine.js`; multi-table writes transactional.
- [ ] Inputs validated; new lists clamp `limit`.
- [ ] `backend npm test` green; `tsc --noEmit` clean; relevant e2e green.
- [ ] Feature verified in the real app, create **and** edit modes; no new console/network errors.
- [ ] No secrets added; no stray backups/dumps; idempotency guards + lazy `require()`s intact.
- [ ] Diff scoped to the intended change (no incidental reformatting of monoliths).

## SECTION 12 — PRE-DEPLOYMENT CHECKLIST (mandatory)

- [ ] Pre-commit checklist complete and green.
- [ ] Only one high-risk change in this deploy (never two).
- [ ] Full backend suite + relevant Playwright e2e pass.
- [ ] App boots clean; both frontends load; login + refresh work.
- [ ] If conversion/payments touched: full conversion regression passed (one-next-doc, items, totals, addresses, numbers).
- [ ] If a migration is included: applied on a copy, app boots against it, additive-only, no data mutation, FKs indexed.
- [ ] Rollback path confirmed and written down (Section 14).
- [ ] Affected Docker services identified; deploy planned during acceptable-traffic window (recall: no graceful shutdown yet — avoid deploying mid-write bursts).
- [ ] Push to `main` after successful rebuild.
- [ ] Post-deploy smoke test scheduled (login, one conversion, one list, one upload).

---

## SECTION 13 — EMERGENCY HOTFIX POLICY

1. **A hotfix is still the smallest possible reversible change.** Emergencies do not license large or multi-module edits.
2. **No schema changes, no data mutations, no conversion-core rewrites in a hotfix.** If the incident seems to require one, escalate to the owner immediately — do not improvise on production data.
3. **Verify the root cause from code** before patching; a wrong hotfix under pressure is worse than the outage.
4. **One change, one purpose.** Never bundle unrelated fixes into a hotfix.
5. **Owner notification is mandatory** before deploying a hotfix that touches a Section 2 file, auth, or the money workflow; notify immediately after for anything else.
6. **Minimal test gate:** typecheck + the directly-affected tests + a targeted manual smoke of the exact broken path. Never skip the smoke test.
7. **Document** the incident, the patch, the blast radius, and the follow-up needed, at the time of the fix.
8. **Follow-up required:** every hotfix gets a scheduled proper fix + regression test; a hotfix is a stopgap, not a resolution.
9. **Monitor** for a defined window after deploy; be ready to roll back (Section 14).

---

## SECTION 14 — ROLLBACK POLICY

1. **Every change ships with a written rollback plan** (part of Section 12). If you cannot state how to revert it, you may not deploy it.
2. **Code rollback** is the default and preferred path: `git revert` the change and rebuild/redeploy the affected services. Because deploys are per-service Docker rebuilds, reverting is fast and clean.
3. **Detect failure fast:** watch the post-deploy smoke test (login, one conversion, one list, one upload) and error rates; if any regress, roll back rather than debug forward on production.
4. **Never combine changes** so that a rollback of one drags an unrelated change with it — this is why high-risk changes ship alone.
5. **Database rollback is special:** there are **no runtime down-migrations.** For an additive migration, the safe reversal is usually to leave the additive object in place (harmless) and revert the code that uses it. **Never** attempt an ad-hoc destructive "undo" migration on production. If schema truly must be reversed, that is an owner-approved, backup-first, human-run operation.
6. **Data rollback** is only possible if a scoped backup was taken before a risky data operation (per Section 6). Restore is human-run, owner-approved, and verified.
7. **Communicate:** on any rollback, record what failed, what was reverted, and the follow-up plan. A rollback is a signal to improve the test/gate that let the regression through.

---

### Amendment process
This Constitution changes only by explicit owner decision, recorded as a commit that edits this file with a rationale. When reality and this document diverge, fix the document in the same change that discovers the divergence. Silence or convenience is never an amendment.

*Ratified as the governing engineering policy for Decoinks Printshop OS. Stability first. Preserve the baseline. Smallest reversible change. When in doubt, stop and ask.*
