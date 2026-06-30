-- Allow status updates on orders (OPEN -> CLOSED -> VOIDED) while keeping
-- all other columns append-only. Fiscal compliance: only the lifecycle
-- status column may change; financial amounts, items, and TSE data remain
-- immutable after creation.

-- Drop the blanket append-only trigger on orders
DROP TRIGGER IF EXISTS trg_orders_append_only ON orders;

-- Create a granular trigger that allows UPDATE only to the status column
CREATE OR REPLACE FUNCTION orders_status_only_update()
RETURNS TRIGGER AS $$
DECLARE
  changed_cols text[];
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'fiscal table orders is append-only (DELETE not allowed)'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Compute which columns changed
  changed_cols := ARRAY[]::text[];
  IF NEW.total_net   IS DISTINCT FROM OLD.total_net   THEN changed_cols := array_append(changed_cols, 'total_net');   END IF;
  IF NEW.total_mwst  IS DISTINCT FROM OLD.total_mwst  THEN changed_cols := array_append(changed_cols, 'total_mwst');  END IF;
  IF NEW.total_gross IS DISTINCT FROM OLD.total_gross THEN changed_cols := array_append(changed_cols, 'total_gross'); END IF;
  IF NEW.kasse_id    IS DISTINCT FROM OLD.kasse_id    THEN changed_cols := array_append(changed_cols, 'kasse_id');   END IF;
  IF NEW.shift_id    IS DISTINCT FROM OLD.shift_id    THEN changed_cols := array_append(changed_cols, 'shift_id');   END IF;
  IF NEW.mode        IS DISTINCT FROM OLD.mode        THEN changed_cols := array_append(changed_cols, 'mode');       END IF;
  IF NEW.table_id    IS DISTINCT FROM OLD.table_id    THEN changed_cols := array_append(changed_cols, 'table_id');   END IF;
  IF NEW.customer_id IS DISTINCT FROM OLD.customer_id THEN changed_cols := array_append(changed_cols, 'customer_id'); END IF;
  IF NEW.created_at  IS DISTINCT FROM OLD.created_at  THEN changed_cols := array_append(changed_cols, 'created_at');  END IF;

  IF array_length(changed_cols, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'fiscal table orders is append-only: columns % may not be updated (only status)', changed_cols
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Status changes are allowed
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Use ROW-level trigger so OLD/NEW column comparison works
CREATE TRIGGER trg_orders_status_only_update
  BEFORE UPDATE OR DELETE ON orders
  FOR EACH ROW
  EXECUTE FUNCTION orders_status_only_update();