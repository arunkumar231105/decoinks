-- 118_leads_point_at_a_real_customer.sql
--
-- leads.source_customer_id names the customer a lead came from, and had no
-- foreign key on it. Eighteen leads were holding an identifier that matched no
-- customer, no supplier and no party — live or deleted. Not some of them:
-- every one of the eighteen. They were cleared before this ran, because there
-- was nothing to recover; the records they named had been removed outright
-- rather than marked deleted.
--
-- The key stops the next one. ON DELETE SET NULL rather than CASCADE or
-- RESTRICT: removing a customer should neither delete the lead that became them
-- nor be blocked by it — the lead is a record of an enquiry and outlives the
-- account it turned into. That matches how orders, invoices, purchase orders
-- and payments already treat their customer link.
--
-- The column is nullable and stays so; most leads never came from an existing
-- customer at all.

ALTER TABLE leads
  ADD CONSTRAINT leads_source_customer_id_fkey
  FOREIGN KEY (source_customer_id) REFERENCES customers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_leads_source_customer
  ON leads(source_customer_id) WHERE source_customer_id IS NOT NULL;
