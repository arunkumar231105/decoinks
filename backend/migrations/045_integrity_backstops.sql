-- ============================================================
--  045_integrity_backstops.sql
--
--  Database-level backstops for bugs fixed in the application layer.
--  Every statement is guarded so it can NEVER fail the deploy on
--  pre-existing data — if legacy rows already violate a rule, the index
--  is skipped and a NOTICE is raised (the app-level fix still applies to
--  new writes). No data is modified or deleted.
-- ============================================================

-- ── 1. One invoice per quotation (backstop for the approve/convert race) ─────
-- A partial UNIQUE index would fail to build if duplicates already exist, so
-- only create it when the data is clean.
DO $$
DECLARE
  dup_count INTEGER;
BEGIN
  IF to_regclass('public.invoices') IS NULL THEN
    RETURN;
  END IF;

  SELECT COUNT(*) INTO dup_count FROM (
    SELECT quote_id
    FROM invoices
    WHERE quote_id IS NOT NULL
    GROUP BY quote_id
    HAVING COUNT(*) > 1
  ) d;

  IF dup_count = 0 THEN
    CREATE UNIQUE INDEX IF NOT EXISTS uq_invoices_quote_id
      ON invoices(quote_id) WHERE quote_id IS NOT NULL;
  ELSE
    RAISE NOTICE 'Skipping uq_invoices_quote_id: % quote_id value(s) already have duplicate invoices. Reconcile them, then create the index manually.', dup_count;
  END IF;
END $$;

-- ── 2. Unique fragment number within a PO (backstop for replaceFragments) ─────
DO $$
DECLARE
  dup_count INTEGER;
BEGIN
  IF to_regclass('public.po_gangsheet_fragments') IS NULL THEN
    RETURN;
  END IF;

  SELECT COUNT(*) INTO dup_count FROM (
    SELECT po_id, fragment_no
    FROM po_gangsheet_fragments
    GROUP BY po_id, fragment_no
    HAVING COUNT(*) > 1
  ) d;

  IF dup_count = 0 THEN
    CREATE UNIQUE INDEX IF NOT EXISTS uq_po_fragment_no
      ON po_gangsheet_fragments(po_id, fragment_no);
  ELSE
    RAISE NOTICE 'Skipping uq_po_fragment_no: % duplicate (po_id, fragment_no) pair(s) exist.', dup_count;
  END IF;
END $$;
