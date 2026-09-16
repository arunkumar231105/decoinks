-- 143: a supplier keeps a list of its factories, and says where each purchase
-- order stands with them.
--
-- The Fulfillment Portal's order grid (owner, 16 Sep 2026) shows, per purchase
-- order, the factory making it, the day it was pushed to that factory, and its
-- stage. Nothing held a factory before. The supplier now keeps its own list and
-- picks one per PO; it also moves the PO through the stages only it knows —
-- To be Pushed, Factory Audit, In Production, Exception. The stages after that
-- (Shipped, Pre-Transit, In Transit, Delivered) are not stored here: they come
-- from the parcel's tracking, so nobody has to keep them up to date by hand.
--
-- Additive only. factory_status (migration 133, written by the factory's own API
-- feed) is left as it is; the portal mirrors the supplier's stage into it where
-- the two mean the same thing, so the shop's PO list agrees.

CREATE TABLE IF NOT EXISTS public.supplier_factories (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  supplier_id UUID NOT NULL REFERENCES public.suppliers(id) ON DELETE CASCADE,
  name        VARCHAR(120) NOT NULL,
  city        VARCHAR(80),
  country     VARCHAR(80),
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT supplier_factories_name_not_blank CHECK (BTRIM(name) <> '')
);

-- One "Shenzhen Print Co." per supplier, whatever the spacing or case.
CREATE UNIQUE INDEX IF NOT EXISTS uq_supplier_factories_name
  ON public.supplier_factories (supplier_id, LOWER(BTRIM(name)));
CREATE INDEX IF NOT EXISTS idx_supplier_factories_supplier
  ON public.supplier_factories (supplier_id);

ALTER TABLE public.purchase_orders ADD COLUMN IF NOT EXISTS factory_id UUID;
ALTER TABLE public.purchase_orders ADD COLUMN IF NOT EXISTS pushed_at DATE;
ALTER TABLE public.purchase_orders ADD COLUMN IF NOT EXISTS supplier_stage VARCHAR(20);
ALTER TABLE public.purchase_orders ADD COLUMN IF NOT EXISTS supplier_stage_note TEXT;
ALTER TABLE public.purchase_orders ADD COLUMN IF NOT EXISTS supplier_stage_updated_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_orders_factory_id_fkey') THEN
    ALTER TABLE public.purchase_orders
      ADD CONSTRAINT purchase_orders_factory_id_fkey
      FOREIGN KEY (factory_id) REFERENCES public.supplier_factories(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_orders_supplier_stage_check') THEN
    ALTER TABLE public.purchase_orders ADD CONSTRAINT purchase_orders_supplier_stage_check
      CHECK (supplier_stage IS NULL OR supplier_stage IN ('To be Pushed', 'Factory Audit', 'In Production', 'Exception'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_purchase_orders_factory ON public.purchase_orders (factory_id);
