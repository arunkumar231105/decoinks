-- One payment settles one sales order, and a sales order holds one payment.
--
-- Nothing enforced that, so the same order collected two and three payments —
-- some of them the software's own doing, some the same money entered twice.
-- The rule now lives in the database, where no code path can get around it:
-- a second payment pointing at an order the app already settled is refused.
--
-- Partial, so the many payments not yet matched to an order are untouched;
-- order_id NULL stays free to repeat.
CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_one_per_order
  ON payments (order_id) WHERE order_id IS NOT NULL;

COMMENT ON INDEX uq_payments_one_per_order IS
  'One payment per sales order. A split payment must be recorded as one amount.';
