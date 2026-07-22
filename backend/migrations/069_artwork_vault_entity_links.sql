-- Backfill CRM links from Nextcloud folder names such as
-- 260416_Jaysin_Julios/references without inventing entity data.
UPDATE artwork_vault_assets a SET lead_id=l.id
FROM leads l
WHERE a.lead_id IS NULL
  AND length(COALESCE(l.customer_name,'')) > 3
  AND replace(a.path,'_',' ') ILIKE '%'||l.customer_name||'%';

UPDATE artwork_vault_assets a SET customer_id=c.id
FROM customers c
WHERE a.customer_id IS NULL
  AND length(COALESCE(c.name,'')) > 3
  AND replace(a.path,'_',' ') ILIKE '%'||c.name||'%';
