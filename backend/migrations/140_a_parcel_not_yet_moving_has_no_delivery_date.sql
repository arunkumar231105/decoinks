-- 140: a parcel that has not moved has no delivery date.
--
-- Before the carrier's first scan Shippo still returns an ETA — the date the
-- label was scheduled for — so parcels still sitting at PRE_TRANSIT read as
-- "estimated delivery 18 Sep" for a package that had not left the shop (owner,
-- 16 Sep 2026). An estimate means something once the parcel is moving.
--
-- Held here, in the database, so every writer keeps to it: the tracking sync
-- that runs every ten minutes, the orphan-label import, the shipment and PO
-- forms, the CRM. When the carrier scans the parcel the next sync writes the
-- real estimate as before.

CREATE OR REPLACE FUNCTION public.shipments_no_eta_before_moving()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_tracking TEXT := UPPER(BTRIM(COALESCE(NEW.tracking_status, '')));
BEGIN
  -- The carrier's word when it has one; the shop's own status before that.
  IF v_tracking IN ('PRE_TRANSIT', 'UNKNOWN')
     OR (v_tracking = '' AND NEW.status::text IN ('Pending', 'Label Created')) THEN
    NEW.estimated_delivery := NULL;
    NEW.original_eta := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_shipments_no_eta_before_moving ON public.shipments;
CREATE TRIGGER trg_shipments_no_eta_before_moving
  BEFORE INSERT OR UPDATE ON public.shipments
  FOR EACH ROW EXECUTE FUNCTION public.shipments_no_eta_before_moving();

-- The parcels already carrying one (the trigger clears them as they are touched).
UPDATE public.shipments
   SET estimated_delivery = NULL, original_eta = NULL
 WHERE (estimated_delivery IS NOT NULL OR original_eta IS NOT NULL)
   AND (UPPER(BTRIM(COALESCE(tracking_status, ''))) IN ('PRE_TRANSIT', 'UNKNOWN')
        OR (BTRIM(COALESCE(tracking_status, '')) = '' AND status::text IN ('Pending', 'Label Created')));
