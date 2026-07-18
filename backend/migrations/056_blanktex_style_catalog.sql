-- One catalog row per BlankTex style. Variant/SKU detail stays nested and is
-- loaded only when a user opens the style in Decoinks.
CREATE OR REPLACE VIEW integration.blanktex_decoinks_styles AS
SELECT s.style_id id, s.style_no::varchar sku, s.style_name::varchar name,
       'Apparel'::product_type product_type,
       concat_ws(' | ',NULLIF(s.garment_type,''),NULLIF(s.fabric_composition,''),
         CASE WHEN s.fabric_weight_gsm IS NOT NULL THEN s.fabric_weight_gsm || ' GSM' END,
         NULLIF(s.remarks,''))::text description,
       0::numeric(12,2) base_price, 0::numeric(12,2) cost_price, 0::integer stock_qty,
       CASE WHEN img.image_url IS NULL THEN NULL
            WHEN img.image_url ~ '^https?://' THEN img.image_url
            ELSE 'https://blanktex.decoinkssuite.com/' || ltrim(img.image_url,'/') END::text image_url,
       (s.active AND NOT s.discontinued) is_active,NULL::uuid created_by,
       s.created_at,s.updated_at,NULL::timestamptz deleted_at,b.brand_name::varchar brand,
       s.style_no::varchar model_number,NULL::varchar color,NULL::varchar size,
       s.style_id,b.brand_id,s.garment_category,s.garment_type,s.gender,s.fit_type,
       s.sleeve_type,s.neck_type,s.fabric_composition,s.fabric_weight_gsm,
       s.fabric_weight_oz,s.fabric_type,
       COALESCE(stats.total_colors,0)::integer total_colors,
       COALESCE(stats.total_sizes,0)::integer total_sizes,
       COALESCE(stats.total_skus,0)::integer total_skus,
       COALESCE(stats.colors,'[]'::jsonb) colors,
       COALESCE(stats.sizes,'[]'::jsonb) sizes
FROM blanktex.styles s
JOIN blanktex.brands b ON b.brand_id=s.brand_id
LEFT JOIN LATERAL (SELECT si.image_url FROM blanktex.style_images si
  WHERE si.style_id=s.style_id ORDER BY si.is_primary DESC,si.sort_order,si.created_at LIMIT 1) img ON TRUE
LEFT JOIN LATERAL (
  SELECT
    (SELECT count(*) FROM blanktex.style_colors c WHERE c.style_id=s.style_id)::integer total_colors,
    (SELECT count(*) FROM blanktex.style_sizes z WHERE z.style_id=s.style_id)::integer total_sizes,
    (SELECT count(*) FROM blanktex.style_color_sizes v WHERE v.style_id=s.style_id)::integer total_skus,
    (SELECT jsonb_agg(jsonb_build_object('name',c.display_name,'hex',c.hex_color)
                      ORDER BY c.sort_order,c.display_name)
       FROM blanktex.style_colors c WHERE c.style_id=s.style_id) colors,
    (SELECT jsonb_agg(jsonb_build_object('name',z.size_name,'code',z.size_code)
                      ORDER BY z.display_order,z.size_name)
       FROM blanktex.style_sizes z WHERE z.style_id=s.style_id) sizes
) stats ON TRUE;

COMMENT ON VIEW integration.blanktex_decoinks_styles IS
  'One live Decoinks catalog row per BlankTex style; variants are nested in style detail.';
GRANT SELECT ON integration.blanktex_decoinks_styles TO PUBLIC;

CREATE OR REPLACE VIEW integration.product_catalog AS
SELECT 'blanktex'::text source_app,id::text source_id,sku::text item_code,
       name::text item_name,brand::text brand,product_type::text category,
       NULL::text color,NULL::text size,base_price::numeric price,is_active active,updated_at
FROM integration.blanktex_decoinks_styles;
