-- Excel module alignment: additive, lossless relational links.
--
-- Existing Decoinks tables remain the system-of-record and are not renamed,
-- rewritten, or backfilled here. These tables hold the additional normalized
-- relationships from the Sales Order, Purchase Order, and Shipment workbooks.
-- Runtime/API adoption is intentionally a separate, reviewed change.

-- Sales Order artwork junction. The existing typed order-item tables remain
-- unchanged; the nullable item FKs allow apparel and DTF artwork links.
CREATE TABLE IF NOT EXISTS public.order_item_artworks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  item_type VARCHAR(30) NOT NULL CHECK (item_type IN ('APPAREL', 'DTF_TRANSFER')),
  apparel_item_id UUID REFERENCES public.order_items_apparel(id) ON DELETE CASCADE,
  dtf_item_id UUID REFERENCES public.order_items_dtf(id) ON DELETE CASCADE,
  artwork_id UUID NOT NULL REFERENCES public.artworks(id) ON DELETE RESTRICT,
  artwork_version_id UUID REFERENCES public.artwork_versions(id) ON DELETE RESTRICT,
  placement VARCHAR(80),
  width_in NUMERIC(8,3),
  height_in NUMERIC(8,3),
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  display_order INTEGER NOT NULL DEFAULT 0,
  production_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT order_item_artworks_one_item_ck CHECK (
    (item_type = 'APPAREL' AND apparel_item_id IS NOT NULL AND dtf_item_id IS NULL)
    OR
    (item_type = 'DTF_TRANSFER' AND apparel_item_id IS NULL AND dtf_item_id IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS idx_order_item_artworks_order ON public.order_item_artworks(order_id);
CREATE INDEX IF NOT EXISTS idx_order_item_artworks_apparel ON public.order_item_artworks(apparel_item_id);
CREATE INDEX IF NOT EXISTS idx_order_item_artworks_dtf ON public.order_item_artworks(dtf_item_id);
CREATE INDEX IF NOT EXISTS idx_order_item_artworks_artwork ON public.order_item_artworks(artwork_id);

-- PO apparel detail. This is a normalized projection/detail layer over the
-- existing generic purchase_order_items table; no existing PO item is copied.
CREATE TABLE IF NOT EXISTS public.po_apparel_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  purchase_order_id UUID NOT NULL REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
  source_purchase_order_item_id UUID REFERENCES public.purchase_order_items(id) ON DELETE SET NULL,
  source_sales_order_apparel_item_id UUID REFERENCES public.order_items_apparel(id) ON DELETE SET NULL,
  line_no INTEGER NOT NULL DEFAULT 0,
  style_no VARCHAR(100),
  item_description TEXT,
  color VARCHAR(100),
  size VARCHAR(50),
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  supplier_unit_cost NUMERIC(12,2),
  supplier_line_cost NUMERIC(12,2),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (purchase_order_id, line_no)
);
CREATE INDEX IF NOT EXISTS idx_po_apparel_items_po ON public.po_apparel_items(purchase_order_id);
CREATE INDEX IF NOT EXISTS idx_po_apparel_items_source_item ON public.po_apparel_items(source_purchase_order_item_id);
CREATE INDEX IF NOT EXISTS idx_po_apparel_items_source_so_item ON public.po_apparel_items(source_sales_order_apparel_item_id);

-- Exact artwork/version instructions for a PO apparel line.
CREATE TABLE IF NOT EXISTS public.po_item_artworks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  purchase_order_id UUID NOT NULL REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
  po_apparel_item_id UUID NOT NULL REFERENCES public.po_apparel_items(id) ON DELETE CASCADE,
  artwork_id UUID NOT NULL REFERENCES public.artworks(id) ON DELETE RESTRICT,
  artwork_version_id UUID REFERENCES public.artwork_versions(id) ON DELETE RESTRICT,
  placement VARCHAR(80) NOT NULL,
  width_in NUMERIC(8,3),
  height_in NUMERIC(8,3),
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  application_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_po_item_artworks_po ON public.po_item_artworks(purchase_order_id);
CREATE INDEX IF NOT EXISTS idx_po_item_artworks_item ON public.po_item_artworks(po_apparel_item_id);
CREATE INDEX IF NOT EXISTS idx_po_item_artworks_artwork ON public.po_item_artworks(artwork_id);

-- PO gangsheet lines and additional production services from the workbook.
CREATE TABLE IF NOT EXISTS public.po_gangsheet_lines (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  purchase_order_id UUID NOT NULL REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
  gangsheet_id UUID,
  gangsheet_version_id UUID,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  supplier_unit_cost NUMERIC(12,2),
  supplier_line_cost NUMERIC(12,2),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_po_gangsheet_lines_po ON public.po_gangsheet_lines(purchase_order_id);

CREATE TABLE IF NOT EXISTS public.po_services (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  purchase_order_id UUID NOT NULL REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
  service_type VARCHAR(40) NOT NULL,
  service_description TEXT NOT NULL,
  artwork_id UUID REFERENCES public.artworks(id) ON DELETE RESTRICT,
  artwork_version_id UUID REFERENCES public.artwork_versions(id) ON DELETE RESTRICT,
  width_in NUMERIC(8,3),
  height_in NUMERIC(8,3),
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_cost NUMERIC(12,2),
  total_cost NUMERIC(12,2),
  instructions TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_po_services_po ON public.po_services(purchase_order_id);
CREATE INDEX IF NOT EXISTS idx_po_services_artwork ON public.po_services(artwork_id);

-- Shipment tracking records. Existing shipments.tracking_number and all
-- carrier fields remain intact for backward compatibility.
CREATE TABLE IF NOT EXISTS public.shipment_tracking (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  shipment_id UUID NOT NULL REFERENCES public.shipments(id) ON DELETE CASCADE,
  tracking_number VARCHAR(100) NOT NULL,
  carrier_status_code VARCHAR(50),
  carrier_status VARCHAR(100),
  status_description TEXT,
  estimated_delivery_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  last_event_at TIMESTAMPTZ,
  last_event_location VARCHAR(255),
  last_synced_at TIMESTAMPTZ,
  sync_status VARCHAR(30) CHECK (sync_status IS NULL OR sync_status IN ('PENDING', 'SUCCESS', 'ERROR')),
  sync_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (shipment_id, tracking_number)
);
CREATE INDEX IF NOT EXISTS idx_shipment_tracking_shipment ON public.shipment_tracking(shipment_id);
CREATE INDEX IF NOT EXISTS idx_shipment_tracking_number ON public.shipment_tracking(tracking_number);
CREATE INDEX IF NOT EXISTS idx_shipment_tracking_status ON public.shipment_tracking(carrier_status);

CREATE TABLE IF NOT EXISTS public.shipping_accounts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  platform VARCHAR(30) NOT NULL,
  account_name VARCHAR(100) NOT NULL,
  account_reference VARCHAR(100),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (platform, account_reference)
);
CREATE INDEX IF NOT EXISTS idx_shipping_accounts_active ON public.shipping_accounts(is_active);

-- Central read-only projections. Existing application tables remain the
-- write-side system of record; consumers can use these stable views without
-- knowing the workbook/current column-name differences.
CREATE OR REPLACE VIEW integration.sales_order_module AS
SELECT 'decoinks'::TEXT AS source_app,
       o.id::TEXT AS source_id,
       o.order_number,
       o.customer_id::TEXT AS customer_id,
       o.invoice_id::TEXT AS invoice_id,
       o.order_type::TEXT AS order_type,
       o.status::TEXT AS status,
       o.payment_status::TEXT AS payment_status,
       o.order_date,
       o.required_ship_date,
       o.currency,
       o.subtotal,
       o.shipping_charges AS shipping_amount,
       o.discount_amt AS discount_amount,
       o.tax_amt AS tax_amount,
       o.total AS total_amount,
       o.created_at,
       o.updated_at
  FROM public.orders o
 WHERE o.deleted_at IS NULL;

CREATE OR REPLACE VIEW integration.purchase_order_module AS
SELECT 'decoinks'::TEXT AS source_app,
       p.id::TEXT AS source_id,
       p.po_number,
       p.order_id::TEXT AS sales_order_id,
       p.customer_id::TEXT AS customer_id,
       p.supplier_id::TEXT AS supplier_id,
       p.po_type,
       p.status::TEXT AS status,
       p.order_date,
       p.expected_date AS need_by_date,
       p.required_dispatch_text AS required_dispatch_date,
       p.production_priority,
       p.shipping_method,
       p.currency,
       p.grand_total,
       p.created_at,
       p.updated_at
  FROM public.purchase_orders p
 WHERE p.deleted_at IS NULL;

CREATE OR REPLACE VIEW integration.shipment_module AS
SELECT 'decoinks'::TEXT AS source_app,
       s.id::TEXT AS source_id,
       s.shipment_number,
       s.order_id::TEXT AS sales_order_id,
       s.po_id::TEXT AS purchase_order_id,
       s.ship_source AS shipped_by_type,
       s.status::TEXT AS status,
       s.carrier,
       s.service_type AS shipping_method,
       s.weight_lbs AS package_weight_lb,
       s.tracking_number,
       s.ship_date,
       s.estimated_delivery,
       s.shipping_cost,
       s.created_at,
       s.updated_at
  FROM public.shipments s
 WHERE s.deleted_at IS NULL;

CREATE OR REPLACE VIEW integration.artwork_module AS
SELECT 'decoinks'::TEXT AS source_app,
       a.id::TEXT AS source_id,
       a.artwork_no,
       a.name,
       a.order_id::TEXT AS sales_order_id,
       a.lead_id::TEXT AS lead_id,
       a.artwork_type,
       a.current_stage,
       a.is_active,
       a.created_at,
       a.updated_at
  FROM public.artworks a
 WHERE a.is_active;

-- Publish changes from the new workbook-aligned tables and previously
-- untracked operational tables to the existing central outbox. No business
-- rows are modified by these triggers.
DO $$
DECLARE
  target TEXT;
  targets TEXT[] := ARRAY[
    'public.order_item_artworks',
    'public.po_apparel_items',
    'public.po_item_artworks',
    'public.po_gangsheet_lines',
    'public.po_services',
    'public.shipment_tracking',
    'public.shipping_accounts',
    'public.purchase_orders',
    'public.purchase_order_items',
    'public.po_orders',
    'public.shipments',
    'public.shipment_orders',
    'public.artworks',
    'public.artwork_versions'
  ];
BEGIN
  FOREACH target IN ARRAY targets LOOP
    IF to_regclass(target) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS suite_data_event ON %s', target);
      EXECUTE format(
        'CREATE TRIGGER suite_data_event AFTER INSERT OR UPDATE OR DELETE ON %s '
        'FOR EACH ROW EXECUTE FUNCTION integration.capture_change()', target
      );
    END IF;
  END LOOP;
END $$;

