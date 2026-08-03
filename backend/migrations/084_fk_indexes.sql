-- 084_fk_indexes.sql
-- Index every single-column foreign key that had none, on the tables that
-- actually hold data.
--
-- PostgreSQL indexes the primary key side of a foreign key but never the
-- referencing column, so joins and the referential checks run on delete/update
-- were doing sequential scans. These indexes change no result, only the plan.
--
-- Additive + idempotent + schema-only: CREATE INDEX IF NOT EXISTS, no data is
-- read, written or moved.

CREATE INDEX IF NOT EXISTS idx_artwork_vault_assets_designer_id ON artwork_vault_assets (designer_id);
CREATE INDEX IF NOT EXISTS idx_artwork_vault_assets_order_id ON artwork_vault_assets (order_id);
CREATE INDEX IF NOT EXISTS idx_artwork_vault_assets_sales_agent_id ON artwork_vault_assets (sales_agent_id);
CREATE INDEX IF NOT EXISTS idx_artwork_vault_revisions_saved_by ON artwork_vault_revisions (saved_by);
CREATE INDEX IF NOT EXISTS idx_artwork_versions_created_by ON artwork_versions (created_by);
CREATE INDEX IF NOT EXISTS idx_artworks_lead_id ON artworks (lead_id);
CREATE INDEX IF NOT EXISTS idx_artworks_order_id ON artworks (order_id);
CREATE INDEX IF NOT EXISTS idx_artworks_uploaded_by ON artworks (uploaded_by);
CREATE INDEX IF NOT EXISTS idx_customers_created_by ON customers (created_by);
CREATE INDEX IF NOT EXISTS idx_invoice_items_catalog_size_id ON invoice_items (catalog_size_id);
CREATE INDEX IF NOT EXISTS idx_invoice_items_product_id ON invoice_items (product_id);
CREATE INDEX IF NOT EXISTS idx_invoices_created_by ON invoices (created_by);
CREATE INDEX IF NOT EXISTS idx_leads_updated_by ON leads (updated_by);
CREATE INDEX IF NOT EXISTS idx_order_items_apparel_catalog_color_id ON order_items_apparel (catalog_color_id);
CREATE INDEX IF NOT EXISTS idx_order_items_apparel_catalog_size_id ON order_items_apparel (catalog_size_id);
CREATE INDEX IF NOT EXISTS idx_orders_assigned_to ON orders (assigned_to);
CREATE INDEX IF NOT EXISTS idx_orders_created_by ON orders (created_by);
CREATE INDEX IF NOT EXISTS idx_payments_recorded_by ON payments (recorded_by);
CREATE INDEX IF NOT EXISTS idx_pipeline_events_triggered_by ON pipeline_events (triggered_by);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_approved_by ON purchase_orders (approved_by);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_buyer_id ON purchase_orders (buyer_id);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_created_by ON purchase_orders (created_by);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_order_id ON purchase_orders (order_id);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_supplier_contact_id ON purchase_orders (supplier_contact_id);
CREATE INDEX IF NOT EXISTS idx_quotation_items_artwork_id ON quotation_items (artwork_id);
CREATE INDEX IF NOT EXISTS idx_quotation_items_catalog_size_id ON quotation_items (catalog_size_id);
CREATE INDEX IF NOT EXISTS idx_quotation_items_product_id ON quotation_items (product_id);
CREATE INDEX IF NOT EXISTS idx_quotations_created_by ON quotations (created_by);
CREATE INDEX IF NOT EXISTS idx_quotations_parent_quote_id ON quotations (parent_quote_id);
CREATE INDEX IF NOT EXISTS idx_quotations_sales_agent_id ON quotations (sales_agent_id);
CREATE INDEX IF NOT EXISTS idx_quotations_supersedes_quotation_id ON quotations (supersedes_quotation_id);
CREATE INDEX IF NOT EXISTS idx_settings_updated_by ON settings (updated_by);
CREATE INDEX IF NOT EXISTS idx_shipments_created_by ON shipments (created_by);
CREATE INDEX IF NOT EXISTS idx_suppliers_created_by ON suppliers (created_by);
