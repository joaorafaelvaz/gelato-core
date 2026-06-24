-- Imutabilidade fiscal (GoBD) imposta no banco. Conteúdo desta migração:
--  1) o role de runtime (gelato_app) recebe DML normal, mas NUNCA UPDATE/DELETE
--     nas tabelas fiscais;
--  2) um trigger barra UPDATE/DELETE em tabelas fiscais mesmo para o owner
--     (defense-in-depth). Correção de venda = novo registro de Storno (Ciclo 1).
--
-- Tabelas fiscais (append-only): orders, order_items, payments, receipts,
-- tse_transactions, audit_log, z_reports, sync_events.

-- 1) Permissões do role de runtime ---------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO gelato_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO gelato_app;

REVOKE UPDATE, DELETE, TRUNCATE ON
  orders, order_items, payments, receipts, tse_transactions, audit_log, z_reports, sync_events
  FROM gelato_app;

-- 2) Trigger append-only (defense-in-depth) ------------------------------------
CREATE OR REPLACE FUNCTION fiscal_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'fiscal table % is append-only (% not allowed)', TG_TABLE_NAME, TG_OP;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'orders','order_items','payments','receipts',
    'tse_transactions','audit_log','z_reports','sync_events'
  ]
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I_append_only ON %I;', t, t);
    EXECUTE format(
      'CREATE TRIGGER %I_append_only BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION fiscal_append_only();',
      t, t);
  END LOOP;
END;
$$;
