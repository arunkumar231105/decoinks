-- Permanently remove the retired Custom Fields module and stale board permissions.
-- Design/Fulfillment boards were views over shared business records and had no
-- dedicated tables; their source leads/orders/artworks must remain intact.

DROP TABLE IF EXISTS custom_field_values CASCADE;
DROP TABLE IF EXISTS custom_fields CASCADE;
DROP TYPE IF EXISTS cf_field_type;
DROP TYPE IF EXISTS cf_entity_type;

DO $$
BEGIN
  IF to_regclass('public.role_permissions') IS NOT NULL THEN
    DELETE FROM role_permissions
    WHERE module IN ('Design Board', 'Fulfillment');
  END IF;
END $$;
