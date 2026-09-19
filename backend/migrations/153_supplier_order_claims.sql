-- 153: who is placing a supplier order from which PO right now (owner, 19 Sep 2026).
--
-- Supplier Management → New Order fills a DIGI order from a Printshop PO. Two
-- agents (or two tabs) filling the same PO would place it twice, so the PO is
-- held by the agent who opened it. The hold lapses on its own when the page
-- stops renewing it (see digi.newOrder.js, CLAIM_MINUTES), so a closed tab
-- never locks a PO for good. Additive only.

CREATE TABLE IF NOT EXISTS supplier_order_claims (
  po_id       UUID PRIMARY KEY REFERENCES purchase_orders(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  claimed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  seen_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_supplier_order_claims_user ON supplier_order_claims (user_id);
