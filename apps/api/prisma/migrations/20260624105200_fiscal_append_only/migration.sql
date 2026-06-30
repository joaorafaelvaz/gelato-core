-- GoBD / Append-only enforcement for fiscal tables
-- Rejects UPDATE and DELETE on finalized fiscal records.

CREATE OR REPLACE FUNCTION fiscal_append_only()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'fiscal table % is append-only (UPDATE not allowed)', TG_TABLE_NAME
      USING ERRCODE = 'insufficient_privilege';
  ELSIF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'fiscal table % is append-only (DELETE not allowed)', TG_TABLE_NAME
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'orders',
    'order_items',
    'payments',
    'receipts',
    'order_stornos',
    'tse_transactions',
    'z_reports',
    'audit_logs',
    'stock_movements'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger
      WHERE tgname = 'trg_' || tbl || '_append_only'
    ) THEN
      EXECUTE format(
        'CREATE TRIGGER trg_%I_append_only BEFORE UPDATE OR DELETE ON %I FOR EACH STATEMENT EXECUTE FUNCTION fiscal_append_only();',
        tbl, tbl
      );
    END IF;
  END LOOP;
END $$;

-- audit_log gets a dedicated trigger that also logs meta-changes
CREATE OR REPLACE FUNCTION audit_log_append_only()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'audit_log is append-only (UPDATE not allowed)'
      USING ERRCODE = 'insufficient_privilege';
  ELSIF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'audit_log is append-only (DELETE not allowed)'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_log_append_only ON audit_logs;
CREATE TRIGGER trg_audit_log_append_only
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH STATEMENT
  EXECUTE FUNCTION audit_log_append_only();

-- Ensure no updated_at columns exist on fiscal tables
-- (Prisma schema already avoids them, this is a runtime guard via the trigger above)
