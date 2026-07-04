# Database Migration Deployment Runbook

For deploying migrations **039–043** (baseline repair, indexes/constraints,
payment type consistency, counters, invoice payment sync) to the production
server. Total expected downtime: a few seconds while the backend restarts.

**Rule #1: never skip the backup step.** Every other step is reversible
only because of it.

---

## 1. Backup (on the server, BEFORE pulling anything)

```bash
# SSH into the server first, then:
cd ~/POS-Software   # or wherever the repo lives
mkdir -p ~/backups

# Full compressed dump of the live database
docker exec decoinks_postgres pg_dump -U postgres -Fc decoinks_db \
  > ~/backups/decoinks_$(date +%F_%H%M).dump

# Verify the backup file is non-empty (should be at least a few hundred KB)
ls -lh ~/backups/
```

Also record the current row counts so you can verify nothing was lost:

```bash
docker exec decoinks_postgres psql -U postgres -d decoinks_db -c \
  "SELECT relname AS table, n_live_tup AS rows
   FROM pg_stat_user_tables ORDER BY relname;" > ~/backups/rowcounts_before.txt
```

## 2. Rehearse on a COPY of the live database (do this — it costs 2 minutes)

This proves the migrations succeed against your real data without touching
the live database.

```bash
git pull
docker compose build backend

# Make a scratch copy of the live DB from the backup you just took
docker exec decoinks_postgres createdb -U postgres decoinks_test
docker exec -i decoinks_postgres pg_restore -U postgres -d decoinks_test \
  < ~/backups/decoinks_<timestamp>.dump

# Run the migrations against the COPY (entrypoint migrates, then exits)
docker compose run --rm --no-deps \
  -e DATABASE_URL=postgresql://postgres:decoinks_pass@postgres:5432/decoinks_test \
  backend node -e "process.exit(0)"
```

Every pending migration should print `OK`. Spot-check the copy:

```bash
docker exec decoinks_postgres psql -U postgres -d decoinks_test -c \
  "SELECT count(*) AS orders FROM orders; SELECT count(*) AS invoices FROM invoices;"
```

Counts must match the live DB. When satisfied, drop the scratch copy:

```bash
docker exec decoinks_postgres dropdb -U postgres decoinks_test
```

If anything printed `FAIL`, stop here — the live DB was never touched.
Send the error output back for a fix.

## 3. Deploy for real

```bash
docker compose up -d backend
```

## 4. Watch the migrations apply

```bash
docker logs -f decoinks_backend
```

You should see:

```
[entrypoint] Ensuring migration baseline...
[entrypoint] Running pending migrations...
  SKIP  001_extensions_enums.sql (already applied)
  ...
  OK    039_baseline_repair.sql
  OK    040_indexes_and_constraints.sql
  OK    041_payment_type_consistency.sql
  OK    042_counters.sql
  OK    043_invoice_payment_sync.sql
All migrations complete.
[entrypoint] Starting server...
```

If any migration prints `FAIL`, the whole file was rolled back (each file
runs in a transaction) and the server exits — the database is left exactly
as it was. Fix the issue or restore (step 6) and retry.

## 5. Verify — data intact

```bash
docker exec decoinks_postgres psql -U postgres -d decoinks_db -c \
  "SELECT relname AS table, n_live_tup AS rows
   FROM pg_stat_user_tables ORDER BY relname;" > ~/backups/rowcounts_after.txt

diff ~/backups/rowcounts_before.txt ~/backups/rowcounts_after.txt
```

Expected differences: **new** tables may appear (`counters`, `vendors`,
`payments`, `pipeline_events`, portal tables — if they were missing).
No existing table's row count should decrease. (`n_live_tup` is a
statistics estimate; a difference of a row or two on busy tables is
normal — anything larger, investigate before proceeding.)

Quick functional checks:

```bash
# New migrations recorded?
docker exec decoinks_postgres psql -U postgres -d decoinks_db -c \
  "SELECT filename FROM _migrations ORDER BY filename DESC LIMIT 6;"

# counters table exists and is empty (it seeds itself on first use)
docker exec decoinks_postgres psql -U postgres -d decoinks_db -c \
  "SELECT * FROM counters;"
```

Then in the app: open a lead, create a test quotation (check the number
continues the existing sequence), record a test payment on a test invoice.

## 6. Rebuild frontend only if it changed

This deployment does not require it.

## 7. Rollback (only if something is wrong)

The migrations are additive — they do not drop or rewrite business data —
so a code-level rollback is usually enough:

```bash
git checkout <previous-commit>
docker compose build backend && docker compose up -d backend
```

(The new tables/indexes/constraints are harmless to old code, with one
exception: 041 converts `orders.payment_method`/`payment_terms` from enum
to varchar — old code reads/writes those as strings anyway, so it remains
compatible.)

Full database restore — **last resort only**, this rewinds ALL data to the
backup moment, losing anything entered after it:

```bash
docker exec -i decoinks_postgres pg_restore -U postgres -d decoinks_db \
  --clean --if-exists < ~/backups/decoinks_<timestamp>.dump
docker compose restart backend
```

---

## What changed and why (summary)

| Migration | Purpose |
|---|---|
| `039_baseline_repair.sql` | Creates tables/columns that one of the two historical schema paths missed (`vendors`, `payments`, `pipeline_events`, portal tables), adds `updated_at` triggers to every table that was missing one. From now on `backend/migrations` is the single source of truth; the `db/*.sql` init mounts were removed from docker-compose. |
| `040_indexes_and_constraints.sql` | Missing FK indexes (child-row lookups no longer seq-scan), removes duplicate indexes, adds CHECK constraints on quantities and money columns (added `NOT VALID` first so pre-existing rows can never fail the deploy). |
| `041_payment_type_consistency.sql` | `payment_method` / `payment_terms` are now `VARCHAR(50)` on every table instead of enum-on-some, varchar-on-others. Lossless text conversion. |
| `042_counters.sql` + `utils/counter.js` | Document numbers (ORD-, QT-, INV-…) now come from a forward-only counter table. Fixes: duplicate numbers under concurrent requests, and duplicate numbers after deleting an invoice (old code used `COUNT(*)`). |
| `043_invoice_payment_sync.sql` | DB trigger keeps `invoices.amount_paid`/`balance_due` in sync with the `payments` ledger on every insert/update/delete. |
