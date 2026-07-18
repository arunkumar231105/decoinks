-- BlankTex is the single live source of truth for Decoinks apparel products.
CREATE OR REPLACE VIEW integration.blanktex_decoinks_products AS
SELECT sku.sku_id id, sku.sku_code::varchar sku, s.style_name::varchar name,
       'Apparel'::product_type product_type,
       concat_ws(' | ', NULLIF(s.garment_type,''), NULLIF(s.fabric_composition,''),
         CASE WHEN s.fabric_weight_gsm IS NOT NULL THEN s.fabric_weight_gsm || ' GSM' END,
         NULLIF(s.remarks,''))::text description,
       0::numeric(12,2) base_price, 0::numeric(12,2) cost_price, 0::integer stock_qty,
       CASE WHEN img.image_url IS NULL THEN NULL
            WHEN img.image_url ~ '^https?://' THEN img.image_url
            ELSE 'https://blanktex.decoinkssuite.com/' || ltrim(img.image_url,'/') END::text image_url,
       (s.active AND NOT s.discontinued AND sku.active AND NOT sku.discontinued
        AND c.active AND NOT c.discontinued AND z.active AND NOT z.discontinued) is_active,
       NULL::uuid created_by, LEAST(s.created_at,sku.created_at) created_at,
       GREATEST(s.updated_at,sku.updated_at,c.updated_at,z.updated_at,
         COALESCE(img.updated_at,'-infinity'::timestamptz)) updated_at,
       NULL::timestamptz deleted_at, b.brand_name::varchar brand,
       s.style_no::varchar model_number, c.display_name::varchar color, z.size_name::varchar size,
       s.style_id,c.style_color_id,z.style_size_id,b.brand_id,c.hex_color,
       c.supplier_color_code,z.size_code,sku.supplier_sku,sku.barcode,sku.weight_lbs,
       s.garment_category,s.garment_type,s.gender,s.fit_type,s.sleeve_type,s.neck_type,
       s.fabric_composition,s.fabric_weight_gsm,s.fabric_weight_oz,s.fabric_type,
       COALESCE(images.all_images,'[]'::jsonb) images,
       COALESCE(decorations.all_decorations,'[]'::jsonb) decorations,
       specs.size_spec
FROM blanktex.style_color_sizes sku
JOIN blanktex.styles s ON s.style_id=sku.style_id
JOIN blanktex.brands b ON b.brand_id=s.brand_id
JOIN blanktex.style_colors c ON c.style_color_id=sku.style_color_id
JOIN blanktex.style_sizes z ON z.style_size_id=sku.style_size_id
LEFT JOIN LATERAL (SELECT si.image_url,si.updated_at FROM blanktex.style_images si
  WHERE si.style_id=s.style_id ORDER BY si.is_primary DESC,si.sort_order,si.created_at LIMIT 1) img ON TRUE
LEFT JOIN LATERAL (SELECT jsonb_agg(to_jsonb(si) ORDER BY si.is_primary DESC,si.sort_order,si.created_at) all_images
  FROM blanktex.style_images si WHERE si.style_id=s.style_id) images ON TRUE
LEFT JOIN LATERAL (SELECT jsonb_agg(to_jsonb(sd) ORDER BY sd.process_type) all_decorations
  FROM blanktex.style_decorations sd WHERE sd.style_id=s.style_id) decorations ON TRUE
LEFT JOIN LATERAL (SELECT to_jsonb(ss) size_spec FROM blanktex.style_size_specs ss
  WHERE ss.style_size_id=z.style_size_id LIMIT 1) specs ON TRUE;

COMMENT ON VIEW integration.blanktex_decoinks_products IS
  'Live Decoinks catalog backed by BlankTex styles, variants, images and attributes.';
GRANT SELECT ON integration.blanktex_decoinks_products TO PUBLIC;
CREATE INDEX IF NOT EXISTS ix_blanktex_skus_catalog_active
  ON blanktex.style_color_sizes(style_id,active,discontinued);

-- The suite-wide catalog now exposes the same variant-level BlankTex source.
CREATE OR REPLACE VIEW integration.product_catalog AS
SELECT 'blanktex'::text source_app, id::text source_id, sku::text item_code,
       name::text item_name, brand::text brand, product_type::text category,
       color::text color, size::text size, base_price::numeric price,
       is_active active, updated_at
FROM integration.blanktex_decoinks_products;
