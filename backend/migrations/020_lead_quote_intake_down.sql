-- ============================================================
--  020_lead_quote_intake_down.sql
--  Reverses 020_lead_quote_intake.sql.
--  NOTE: PostgreSQL does not support removing enum values once added.
--  The three lead_status values added in 020 ('Quotation Generated',
--  'Quotation Sent', 'Quotation Approved') cannot be rolled back
--  without dropping and recreating the type.
-- ============================================================

-- ── G) quotation_items — drop product grid columns ───────────────────────────
ALTER TABLE quotation_items
  DROP COLUMN IF EXISTS artwork_count,
  DROP COLUMN IF EXISTS colors,
  DROP COLUMN IF EXISTS sizes;

-- ── F) quotations — drop lead-intake columns ──────────────────────────────────
ALTER TABLE quotations
  DROP COLUMN IF EXISTS quote_estimate,
  DROP COLUMN IF EXISTS customer_requirement_summary,
  DROP COLUMN IF EXISTS internal_notes,
  DROP COLUMN IF EXISTS sales_agent_id,
  DROP COLUMN IF EXISTS due_date,
  DROP COLUMN IF EXISTS billing_address,
  DROP COLUMN IF EXISTS shipping_address,
  DROP COLUMN IF EXISTS zip_code,
  DROP COLUMN IF EXISTS shipping_city,
  DROP COLUMN IF EXISTS shipping_state,
  DROP COLUMN IF EXISTS shipping_country,
  DROP COLUMN IF EXISTS customer_source,
  DROP COLUMN IF EXISTS customer_category,
  DROP COLUMN IF EXISTS wechat,
  DROP COLUMN IF EXISTS whatsapp,
  DROP COLUMN IF EXISTS contact_number,
  DROP COLUMN IF EXISTS billing_email,
  DROP COLUMN IF EXISTS customer_name,
  DROP COLUMN IF EXISTS company_name;

-- ── E) lead_product_interest — drop table ─────────────────────────────────────
DROP TABLE IF EXISTS lead_product_interest;

-- ── D) leads — drop CRM snapshot columns ─────────────────────────────────────
ALTER TABLE leads
  DROP COLUMN IF EXISTS pending_questions,
  DROP COLUMN IF EXISTS customer_intent,
  DROP COLUMN IF EXISTS message_count,
  DROP COLUMN IF EXISTS communication_channel,
  DROP COLUMN IF EXISTS last_message;

-- ── C) leads — drop classification columns ───────────────────────────────────
ALTER TABLE leads
  DROP COLUMN IF EXISTS internal_notes,
  DROP COLUMN IF EXISTS delivery_date,
  DROP COLUMN IF EXISTS repeat_buyer,
  DROP COLUMN IF EXISTS urgency,
  DROP COLUMN IF EXISTS estimated_value,
  DROP COLUMN IF EXISTS conversion_score,
  DROP COLUMN IF EXISTS buyer_type;

-- ── B) leads — drop address columns ──────────────────────────────────────────
ALTER TABLE leads
  DROP COLUMN IF EXISTS billing_address,
  DROP COLUMN IF EXISTS shipping_address,
  DROP COLUMN IF EXISTS zip,
  DROP COLUMN IF EXISTS city,
  DROP COLUMN IF EXISTS state,
  DROP COLUMN IF EXISTS country;

-- ── A) leads — drop contact columns ──────────────────────────────────────────
ALTER TABLE leads
  DROP COLUMN IF EXISTS wechat,
  DROP COLUMN IF EXISTS whatsapp,
  DROP COLUMN IF EXISTS phone,
  DROP COLUMN IF EXISTS email,
  DROP COLUMN IF EXISTS company_name;
