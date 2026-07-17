-- Follow-up for installations where 047 was applied before the final
-- workbook customer naming compatibility pass.
ALTER TABLE customers ADD COLUMN IF NOT EXISTS company_name VARCHAR(160);

UPDATE customers SET company_name = company
WHERE company_name IS NULL AND company IS NOT NULL;

