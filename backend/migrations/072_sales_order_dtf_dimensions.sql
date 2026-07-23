-- Keep Sales Order DTF rows aligned with Quotation DTF rows:
-- artwork number, width, height, quantity, artwork, rate and amount.
ALTER TABLE order_items_dtf
  ADD COLUMN IF NOT EXISTS width_inches NUMERIC(8,2),
  ADD COLUMN IF NOT EXISTS height_inches NUMERIC(8,2);

-- Recover artwork identity from the source quotation for existing converted
-- orders. sort_order is the stable row relationship used by the conversion.
UPDATE order_items_dtf oi
SET artwork_no = COALESCE(oi.artwork_no, qi.artwork_no)
FROM orders o
LEFT JOIN invoices i ON i.id = o.invoice_id
JOIN quotation_items qi
  ON qi.quotation_id = COALESCE(o.quotation_id, i.quote_id)
WHERE oi.order_id = o.id
  AND qi.sort_order = oi.sort_order
  AND (oi.artwork_no IS NULL OR BTRIM(oi.artwork_no) = '')
  AND qi.artwork_no IS NOT NULL;

-- Backfill separate dimensions from the legacy combined size value.
UPDATE order_items_dtf
SET width_inches = COALESCE(
      width_inches,
      NULLIF(substring(COALESCE(NULLIF(size, ''), artwork_name) FROM '([0-9]+(\.[0-9]+)?)\s*(?:"|in)?\s*[x×]'), '')::NUMERIC
    ),
    height_inches = COALESCE(
      height_inches,
      NULLIF(substring(COALESCE(NULLIF(size, ''), artwork_name) FROM '[x×]\s*([0-9]+(\.[0-9]+)?)'), '')::NUMERIC
    )
WHERE size IS NOT NULL
   OR artwork_name ~* '[0-9]+(\.[0-9]+)?\s*(?:"|in)?\s*[x×]\s*[0-9]+(\.[0-9]+)?';

COMMENT ON COLUMN order_items_dtf.width_inches IS
  'DTF transfer artwork width in inches, kept separate from height.';
COMMENT ON COLUMN order_items_dtf.height_inches IS
  'DTF transfer artwork height in inches, kept separate from width.';
