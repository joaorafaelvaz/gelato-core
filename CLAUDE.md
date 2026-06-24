# gelato-core — Instruções para o agente

PDV **SaaS multi-tenant para gelaterias na Alemanha**, com conformidade fiscal alemã
obrigatória. Monorepo TypeScript. Trabalho dividido em **Ciclos 0–5** (ver
`docs/superpowers/plans/` e `docs/superpowers/specs/`). Ciclo 0 = fundação + espinha fiscal.

## Regras inegociáveis (compliance)
- **Dinheiro em inteiros (cents).** Nunca float para valores monetários.
- **Tabelas fiscais são append-only.** Sem `UPDATE`/`DELETE` (imposto no banco: role sem
  esses privilégios + triggers). Correção de venda = novo registro de **Storno**.
  Tabelas fiscais: `orders, order_items, payments, receipts, tse_transactions, audit_log, z_reports, sync_events`.
- **Alíquotas de MwSt nunca hardcoded** — sempre da tabela `tax_rates` (versionada por validade).
- **TSE nunca acoplada ao fornecedor** — depende da interface `TseProvider`. `FakeTseProvider`
  é o default de dev/testes; `FiskalyProvider` é esqueleto **NÃO VERIFICADO** (precisa de
  creds de sandbox + validação contra a doc viva + certificação BSI).
- **Toda ação sensível gera audit trail.**

## Stack & layout
- `packages/domain` — tipos puros (Money cents, ConsumptionMode, SaleEvent zod).
- `packages/compliance` — motor MwSt, TseProvider (fake/fiskaly), recibo + QR DFKA.
- `packages/sync` — envelope de evento (`client_event_id`) + idempotência.
- `packages/i18n` — DE/EN/PT (teste de paridade de chaves; IT depois).
- `apps/api` — NestJS + Prisma + Postgres (em construção).
- `apps/pos-terminal` — Electron + SQLite local + outbox (a fazer).
- `apps/backoffice` — React + Vite (a fazer).

## Comandos
- Pacotes: `corepack pnpm install`; testes `corepack pnpm exec vitest run`; typecheck por
  pacote `corepack pnpm exec tsc --noEmit -p <pkg>/tsconfig.json`.
- Banco: `docker compose -f docker/docker-compose.yml up -d` (Postgres; roles `gelato_owner`
  para migrações, `gelato_app` para runtime). Migrações: `corepack pnpm --filter @gelato/api exec prisma migrate dev`.

## Convenções
- TypeScript strict; TDD (teste falha → implementação mínima → teste passa → commit).
- Identificadores em inglês; termos de domínio em alemão (`im_haus`/`ausser_haus`, `Kasse`, `mwst`).
- Pacotes puros: `tsc --noEmit` só para checagem de tipos; runtime/test via vitest (carrega `.ts`).

## Validações externas pendentes (rastrear, não resolver no código)
- MwSt salão×takeaway p/ gelato, retenção (8 vs 10 anos), prazos Kassenmeldung → **Steuerberater**.
- Formato exato do **QR DFKA** → spec oficial. Adapter **fiskaly** → sandbox + doc viva + **BSI**.
