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

## Ciclo 0 — estado e como rodar
**Pronto e verificado (67 testes verdes):** pacotes (domain/compliance/sync/i18n); banco
Postgres + imutabilidade fiscal; API NestJS (auth+RBAC, ledger imutável, `POST /pos/sync`
idempotente, products, `GET /orders`); lógica offline do terminal (local-repo, finalize,
outbox); **capstone e2e** (terminal → HTTP real → ledger, idempotente). Backoffice (Vite+React)
compila e builda.

**Resta (apenas apresentação):** a **GUI Electron do terminal** (main/preload/renderer) —
a lógica está pronta atrás de `apps/pos-terminal/src`; falta o shell Electron + UI e o
`electron-rebuild` do better-sqlite3. Melhor feito numa sessão interativa (dá pra ver a tela).

**Rodar:**
```
docker compose -f docker/docker-compose.yml up -d         # Postgres
cd apps/api && corepack pnpm exec prisma migrate deploy    # aplica migrações
corepack pnpm --filter @gelato/api db:seed                 # seed demo
corepack pnpm --filter @gelato/api start                   # API em :3000
corepack pnpm --filter @gelato/backoffice dev              # backoffice em :5173
corepack pnpm -r test                                      # suíte completa
```
Login demo: `admin@demo.test` / `admin123`; operador PIN `1234` na `demo-kasse`.

**Rodar/empacotar o terminal (GUI Electron):** `better-sqlite3` é nativo e tem ABI
diferente para Node vs Electron (um binário por vez):
- Testes (vitest/Node): `corepack pnpm install` compila p/ Node → testes passam.
- GUI dev: `corepack pnpm --filter @gelato/pos-terminal exec electron-rebuild -f -w better-sqlite3`
  (troca p/ ABI Electron) → `corepack pnpm --filter @gelato/pos-terminal dev` (precisa da API em :3000).
- Empacotar: `corepack pnpm --filter @gelato/pos-terminal package` → `apps/pos-terminal/release/win-unpacked/`.
- Voltar a rodar os testes do terminal: `corepack pnpm rebuild better-sqlite3` (volta p/ ABI Node).
