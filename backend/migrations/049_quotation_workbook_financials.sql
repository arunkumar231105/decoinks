-- Quotation services now write workbook financial columns explicitly.
-- Remove the temporary compatibility trigger so an internal shipping-cost
-- update cannot overwrite the customer-facing shipping amount.
DROP TRIGGER IF EXISTS trg_sync_workbook_quotation ON quotations;
