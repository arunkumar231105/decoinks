-- 141: a parcel that has not moved has no last scan.
--
-- Before the carrier's first scan, Shippo's tracking status already carries a
-- location: where the label was made (e.g. "Middlesex, NJ" for a parcel still
-- in the shop). The Shipments list showed it as the parcel's Last Scan while the
-- status read PRE_TRANSIT (owner, 16 Sep 2026). A last scan means something once
-- the carrier has scanned the parcel.
--
-- The same rule and the same test for "not moving yet" as migration 140 (no
-- delivery estimate before moving), held in the database so every writer keeps
-- to it. The first real scan writes the location as before.

CREATE OR REPLACE FUNCTION public.shipments_no_scan_before_moving()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_tracking TEXT := UPPER(BTRIM(COALESCE(NEW.tracking_status, '')));
BEGIN
  IF v_tracking IN ('PRE_TRANSIT', 'UNKNOWN')
     OR (v_tracking = '' AND NEW.status::text IN ('Pending', 'Label Created')) THEN
    NEW.last_scan_city := NULL;
    NEW.last_scan_state := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_shipments_no_scan_before_moving ON public.shipments;
CREATE TRIGGER trg_shipments_no_scan_before_moving
  BEFORE INSERT OR UPDATE ON public.shipments
  FOR EACH ROW EXECUTE FUNCTION public.shipments_no_scan_before_moving();

-- The parcels already carrying one.
UPDATE public.shipments
   SET last_scan_city = NULL, last_scan_state = NULL
 WHERE (last_scan_city IS NOT NULL OR last_scan_state IS NOT NULL)
   AND (UPPER(BTRIM(COALESCE(tracking_status, ''))) IN ('PRE_TRANSIT', 'UNKNOWN')
        OR (BTRIM(COALESCE(tracking_status, '')) = '' AND status::text IN ('Pending', 'Label Created')));
