-- Artwork usage pipeline: which design was used in which orders.
--
-- The portal's "Used In Orders" column used to group order lines by artwork
-- name, so the same design ordered twice under two spellings ("AW#01 - Sabres"
-- and "AW#01 - Buffalo Sabres") counted as two designs used once each. Nothing
-- in `orders` links an artwork to more than one order: `artworks.order_id` is a
-- single order and `order_item_artworks` is empty.
--
-- The Nextcloud vault mirror does carry the evidence, in two parts:
--   1. the folder path names the order  — PO/<customer>/ORD<NN>-<DD-MM-YY>/...
--   2. re-used files keep their byte size across orders, even when renamed
--      (`5T size.png` in ORD01 is `AW01_FINAL 5T size.png` in ORD02).
-- These three views turn that into an answer, one stage each.

DROP VIEW IF EXISTS artwork_usage;
DROP VIEW IF EXISTS artwork_vault_design;
DROP VIEW IF EXISTS artwork_vault_order_link;

-- ---------------------------------------------------------------------------
-- Stage 1 — vault file → order
-- ---------------------------------------------------------------------------
-- The folder's DD-MM-YY is matched against orders.order_date for the same
-- customer, which is how the PO folders are named (see po-organizer). Assets
-- outside a PO/<customer>/ORD.. folder resolve to no order and drop out here.
CREATE VIEW artwork_vault_order_link AS
SELECT v.id                       AS asset_id,
       v.customer_id,
       o.id                       AS order_id,
       o.order_number,
       o.order_date,
       m[1]                       AS folder_seq,
       -- Bucket within the order folder: final_files2.0, Gangsheets, Other …
       NULLIF(split_part(v.parent_path, '/', 4), '') AS bucket,
       -- What the file is, so the portal can list artwork without the
       -- gangsheets, mockups and reference photos that sit beside it.
       CASE
         WHEN v.path ILIKE '%/Gangsheets/%'                        THEN 'gangsheet'
         WHEN v.path ILIKE '%/Mockups/%'                           THEN 'mockup'
         WHEN v.path ILIKE '%/reference%' OR v.path ILIKE '%/references/%' THEN 'reference'
         ELSE 'artwork'
       END                        AS role
  FROM artwork_vault_assets v
  CROSS JOIN LATERAL (
    SELECT regexp_match(v.path, 'ORD([0-9]{2})-([0-9]{2})-([0-9]{2})-([0-9]{2})') AS m
  ) x
  JOIN orders o
    ON o.customer_id = v.customer_id
   AND o.deleted_at IS NULL
   -- Folder date is DD-MM-YY; orders are this decade, so 26 -> 2026.
   AND o.order_date::date = make_date(2000 + (x.m[4])::int, (x.m[3])::int, (x.m[2])::int)
 WHERE v.customer_id IS NOT NULL
   AND x.m IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Stage 2 — vault file → design identity
-- ---------------------------------------------------------------------------
-- Identity is (customer, exact byte size, extension). Byte-identical files are
-- the same artwork however they were renamed or which folder they were copied
-- into. Empty files carry no identity, so they are excluded rather than all
-- collapsed together.
--
-- This is deliberately conservative: it never merges two designs that differ,
-- but it will miss a re-export of the same design (different bytes). Swap
-- design_key for a content hash once the vault mirrors one, and every consumer
-- below keeps working unchanged.
CREATE VIEW artwork_vault_design AS
SELECT v.id                                                 AS asset_id,
       v.customer_id,
       v.customer_id::text || ':' || v.file_size_bytes::text || ':' ||
         lower(COALESCE(NULLIF(regexp_replace(v.file_name, '^.*\.', ''), v.file_name), '')) AS design_key,
       v.file_name,
       v.file_size_bytes,
       v.mime_type,
       v.artwork_code,
       v.source_modified_at
  FROM artwork_vault_assets v
 WHERE v.customer_id IS NOT NULL
   AND v.file_size_bytes > 0;

-- ---------------------------------------------------------------------------
-- Stage 3 — design → the orders it was used in
-- ---------------------------------------------------------------------------
-- One row per design that reached at least one order. `orders_used_in` is the
-- number the portal shows; `orders` carries the detail for the drawer.
--
-- The display name prefers the shortest file name in the group: production
-- copies gain prefixes ("AW01_FINAL 5T size.png"), so the shortest is normally
-- the original the customer knows ("5T size.png").
CREATE VIEW artwork_usage AS
SELECT d.design_key,
       d.customer_id,
       (array_agg(d.file_name ORDER BY length(d.file_name), d.file_name))[1] AS design_name,
       (array_agg(d.artwork_code) FILTER (WHERE d.artwork_code IS NOT NULL))[1] AS artwork_code,
       min(d.file_size_bytes)                    AS file_size_bytes,
       (array_agg(d.mime_type) FILTER (WHERE d.mime_type IS NOT NULL))[1] AS mime_type,
       count(DISTINCT l.order_id)::int           AS orders_used_in,
       count(DISTINCT d.asset_id)::int           AS file_copies,
       min(l.order_date)                         AS first_used,
       max(l.order_date)                         AS last_used,
       -- A design copied into several buckets takes the most specific role.
       CASE
         WHEN bool_or(l.role = 'gangsheet') THEN 'gangsheet'
         WHEN bool_or(l.role = 'mockup')    THEN 'mockup'
         WHEN bool_or(l.role = 'artwork')   THEN 'artwork'
         ELSE 'reference'
       END                                       AS role,
       jsonb_agg(DISTINCT jsonb_build_object(
         'orderId',     l.order_id,
         'orderNo',     l.order_number,
         'orderDate',   l.order_date
       ))                                        AS orders
  FROM artwork_vault_design d
  JOIN artwork_vault_order_link l ON l.asset_id = d.asset_id
 GROUP BY d.design_key, d.customer_id;

COMMENT ON VIEW artwork_vault_order_link IS
  'Stage 1 of the artwork usage pipeline: vault asset -> order, via the PO/<customer>/ORD<NN>-<DD-MM-YY> folder date.';
COMMENT ON VIEW artwork_vault_design IS
  'Stage 2 of the artwork usage pipeline: vault asset -> design identity (customer + byte size + extension).';
COMMENT ON VIEW artwork_usage IS
  'Stage 3 of the artwork usage pipeline: one row per design with the orders it was used in.';
