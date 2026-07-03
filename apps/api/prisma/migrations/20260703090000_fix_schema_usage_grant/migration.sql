-- Torna o modelo de privilégios do runtime reproduzível por migração.
--
-- Buraco original: GRANT USAGE ON SCHEMA public nunca esteve em migração — dependia do
-- default de banco recém-criado. Um DROP SCHEMA/CREATE SCHEMA (ex. `prisma migrate reset`
-- em Postgres 15+) recriava o schema SEM USAGE para gelato_app e TODA query da API
-- passava a falhar com 42501 (visto ao vivo em 2026-07-02).
--
-- O re-GRANT abaixo é amplo, então o REVOKE final re-aperta TODA tabela append-only —
-- derivada dinamicamente do trigger fiscal_append_only (fonte única da lista; cobre as
-- fiscais do C0 e as operacionais/GDPR adicionadas depois: bestellungen, stock_movements,
-- checklist_runs/results, consent_records, loyalty_entries, voucher_redemptions,
-- campaign_dispatches, cash_movements, tse_ausfall_log).

GRANT USAGE ON SCHEMA public TO gelato_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO gelato_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO gelato_app;

DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT DISTINCT event_object_table
    FROM information_schema.triggers
    WHERE action_statement LIKE '%fiscal_append_only%'
  LOOP
    EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON %I FROM gelato_app;', t);
  END LOOP;
END $$;
