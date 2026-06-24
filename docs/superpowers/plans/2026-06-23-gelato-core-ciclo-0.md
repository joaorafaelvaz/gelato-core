# gelato-core — Ciclo 0 Implementation Plan (Fundação SaaS + Espinha Fiscal)

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking. Use @superpowers:test-driven-development for every task (test first, watch it fail, minimal impl, watch it pass, commit).

**Goal:** Entregar uma venda fiscalmente correta atravessando todo o stack (terminal → fiskaly → recibo+QR → append-only local → sync idempotente → ledger imutável central → audit), sobre uma fundação SaaS multi-tenant com auth+RBAC.

**Architecture:** Monorepo TypeScript. O terminal Electron monta o pedido offline em SQLite, assina direto contra a fiskaly (sandbox) via `TseProvider`, grava append-only local e enfileira um evento de outbox; um worker faz `POST /pos/sync` (idempotente por `client_event_id`) para a API NestJS, que persiste no ledger imutável Postgres (imutabilidade imposta por role sem UPDATE/DELETE + triggers) e grava audit. MwSt é calculada por um motor puro a partir de `tax_rates` versionada — nunca hardcoded.

**Tech Stack:** pnpm workspaces + Turborepo · TypeScript · NestJS + Prisma + PostgreSQL · Electron + React + better-sqlite3 · React + Vite + shadcn/ui · Vitest · i18next (DE/EN/PT) · fiskaly SIGN DE (KassenSichV) sandbox.

**Convenções:** identificadores/código em inglês com termos de domínio em alemão (`im_haus`/`ausser_haus`, `Kasse`, `mwst`). Dinheiro sempre em **inteiros (cents)**, nunca float. Cada Task termina com commit.

---

## File Structure (decomposição travada)

```
gelato-core/
  package.json              # workspace root, scripts turbo
  pnpm-workspace.yaml
  turbo.json
  tsconfig.base.json
  .eslintrc.cjs  .prettierrc  vitest.workspace.ts
  docker/
    docker-compose.yml      # postgres (owner + app roles)
    db/init/00-roles.sql    # cria gelato_owner / gelato_app
  packages/
    domain/                 # tipos puros compartilhados, zero deps de runtime
      src/money.ts          # Money (cents), arredondamento
      src/consumption.ts    # ConsumptionMode = 'im_haus' | 'ausser_haus'
      src/events.ts         # SaleEvent envelope + zod schema, client_event_id
      src/index.ts
    compliance/             # núcleo legal, puro+adapters
      src/mwst/engine.ts    # computeMwst(): puro, testável
      src/mwst/types.ts     # TaxRate, MwstBreakdown
      src/tse/provider.ts   # interface TseProvider (port)
      src/tse/fiskaly.ts    # FiskalyProvider (adapter REST)
      src/tse/types.ts      # TseTransactionResult, TseProcessType
      src/receipt/build.ts  # buildReceipt()
      src/receipt/qr.ts     # buildDfkaQrPayload()
      src/index.ts
    sync/                   # outbox/idempotência compartilhados
      src/envelope.ts       # makeEnvelope(), client_event_id
      src/idempotency.ts    # helper de chave
  apps/
    api/                    # NestJS
      prisma/schema.prisma
      prisma/migrations/**  # inclui migração SQL de imutabilidade
      prisma/seed.ts        # roles/permissions/tax_rates/tenant demo
      src/main.ts
      src/app.module.ts
      src/auth/**            # login senha+PIN, escalate, JWT, guards
      src/rbac/**            # permissions, RolesGuard, @RequirePermission
      src/tenancy/**         # tenant context, isolamento
      src/products/**        # CRUD mínimo + tax_rates
      src/pos/sync.controller.ts  # POST /pos/sync idempotente
      src/pos/ledger.service.ts   # escreve ledger imutável + audit
      src/audit/**           # audit_log append-only
    pos-terminal/           # Electron + React
      electron/main.ts
      electron/preload.ts
      src/db/schema.sql      # SQLite local append-only + outbox
      src/db/local-repo.ts   # grava venda append-only local
      src/sync/outbox-worker.ts   # POST /pos/sync com backoff
      src/sale/finalize.ts   # orquestra MwSt → fiskaly → local → outbox
      src/ui/**              # PIN login, produtos, modo, recibo+QR
    backoffice/             # React + Vite
      src/pages/{login,sales,products,users}.tsx
      src/i18n/**            # i18next DE/EN/PT
  docs/
    CLAUDE.md
    verfahrensdokumentation.md
```

**Princípio de fronteira:** `packages/domain` e `packages/compliance` não importam de `apps/*`. Toda a lógica fiscal testável vive em `compliance` (puro), de modo que API e terminal apenas a invocam.

---

## Chunk 1: Monorepo, tooling e Docker (Postgres com 2 roles)

### Task 1.1: Inicializar repositório e workspace

**Files:** Create: `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, `.gitignore`, `.eslintrc.cjs`, `.prettierrc`, `vitest.workspace.ts`

- [ ] **Step 1: Init git + pnpm**

```bash
cd D:/Dev/pessoal/gelatoDE
git init
corepack enable
pnpm init
```

- [ ] **Step 2: Criar `pnpm-workspace.yaml`**

```yaml
packages:
  - "packages/*"
  - "apps/*"
```

- [ ] **Step 3: Criar `tsconfig.base.json`** (strict, paths para pacotes)

```json
{
  "compilerOptions": {
    "target": "ES2022", "module": "ESNext", "moduleResolution": "Bundler",
    "strict": true, "noUncheckedIndexedAccess": true, "esModuleInterop": true,
    "skipLibCheck": true, "declaration": true, "composite": true,
    "baseUrl": ".",
    "paths": {
      "@gelato/domain": ["packages/domain/src/index.ts"],
      "@gelato/compliance": ["packages/compliance/src/index.ts"],
      "@gelato/sync": ["packages/sync/src/index.ts"]
    }
  }
}
```

- [ ] **Step 4: `turbo.json`** com pipeline `build`/`test`/`lint`; `.gitignore` (node_modules, dist, .env, *.db); eslint/prettier base; `vitest.workspace.ts` apontando para `packages/*` e `apps/api`.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "chore: init monorepo (pnpm + turbo + ts strict)"
```

### Task 1.2: Postgres via Docker com role de runtime sem UPDATE/DELETE

**Files:** Create: `docker/docker-compose.yml`, `docker/db/init/00-roles.sql`, `.env.example`

- [ ] **Step 1: `docker/db/init/00-roles.sql`** — owner (migrações) + app (runtime). REVOKE de DML perigoso vem na migração de imutabilidade (Chunk 3); aqui só criamos os roles.

```sql
-- gelato_owner é o dono do schema (roda migrações). gelato_app é o runtime da API.
CREATE ROLE gelato_app LOGIN PASSWORD 'app_pw';
GRANT CONNECT ON DATABASE gelato TO gelato_app;
-- Privilégios de tabela são concedidos pela migração (após as tabelas existirem).
```

- [ ] **Step 2: `docker/docker-compose.yml`** — serviço `postgres:16`, db `gelato`, user `gelato_owner`, monta `./db/init` em `/docker-entrypoint-initdb.d`, porta 5432, volume nomeado.

- [ ] **Step 3: `.env.example`** com `DATABASE_URL_OWNER` (gelato_owner, p/ Prisma migrate) e `DATABASE_URL` (gelato_app, runtime), `FISKALY_API_KEY/SECRET/BASE_URL` (sandbox), `JWT_SECRET`.

- [ ] **Step 4: Subir e validar**

Run: `docker compose -f docker/docker-compose.yml up -d` → `docker compose ... ps`
Expected: postgres `healthy`.

- [ ] **Step 5: Commit**

```bash
git add docker .env.example && git commit -m "chore: postgres via docker with owner/app roles"
```

---

## Chunk 2: `packages/domain` (tipos puros, TDD)

### Task 2.1: Money em cents com arredondamento

**Files:** Create: `packages/domain/src/money.ts`, `packages/domain/test/money.test.ts`

- [ ] **Step 1: Teste falhando**

```ts
import { describe, it, expect } from 'vitest'
import { applyRate, sumCents } from '../src/money'

describe('money', () => {
  it('sums cents without float drift', () => {
    expect(sumCents([10, 20, 33])).toBe(63)
  })
  it('applies a VAT rate on a net amount (kaufmännisch round, half-up)', () => {
    // 100 cents net @ 7% = 7 cents tax
    expect(applyRate(100, 0.07)).toBe(7)
    // 199 cents net @ 19% = 37.81 -> 38
    expect(applyRate(199, 0.19)).toBe(38)
  })
})
```

- [ ] **Step 2: Rodar e ver falhar** — `pnpm --filter @gelato/domain test` → FAIL (module/fn ausente).

- [ ] **Step 3: Implementar `money.ts`**

```ts
export type Cents = number

export function sumCents(values: Cents[]): Cents {
  return values.reduce((a, b) => a + b, 0)
}

/** VAT em cents a partir de um net em cents. Arredondamento comercial (half-up). */
export function applyRate(netCents: Cents, rate: number): Cents {
  return Math.round(netCents * rate)
}
```

- [ ] **Step 4: Rodar e ver passar.**
- [ ] **Step 5: Commit** — `feat(domain): money in cents with VAT rounding`.

### Task 2.2: ConsumptionMode + SaleEvent envelope (zod)

**Files:** Create: `packages/domain/src/consumption.ts`, `packages/domain/src/events.ts`, `packages/domain/src/index.ts`, `packages/domain/test/events.test.ts`

- [ ] **Step 1: Teste falhando** — `SaleEventSchema.parse(validEvent)` ok; rejeita `mode` inválido; exige `client_event_id` (uuid).

```ts
import { describe, it, expect } from 'vitest'
import { SaleEventSchema } from '../src/events'

const valid = {
  client_event_id: '11111111-1111-4111-8111-111111111111',
  type: 'sale', kasse_id: 'k1',
  payload: { order: { mode: 'im_haus', total_net: 100, total_mwst: 7, total_gross: 107 },
    items: [], payment: { method: 'cash', amount: 107 },
    receipt: { qr_payload: 'x' }, tse_transaction: { tx_number: 1 } },
}

describe('SaleEvent', () => {
  it('accepts a valid event', () => { expect(SaleEventSchema.parse(valid)).toBeTruthy() })
  it('rejects invalid mode', () => {
    expect(() => SaleEventSchema.parse({ ...valid, payload: { ...valid.payload, order: { ...valid.payload.order, mode: 'x' } } })).toThrow()
  })
})
```

- [ ] **Step 2: Ver falhar.**
- [ ] **Step 3: Implementar** `consumption.ts` (`export const CONSUMPTION_MODES = ['im_haus','ausser_haus'] as const; export type ConsumptionMode = typeof CONSUMPTION_MODES[number]`) e `events.ts` com zod (`client_event_id: z.string().uuid()`, `type: z.literal('sale')`, payload tipado). `index.ts` re-exporta tudo.
- [ ] **Step 4: Ver passar.**
- [ ] **Step 5: Commit** — `feat(domain): consumption mode + sale event envelope`.

---

## Chunk 3: API base, Prisma schema, e imutabilidade fiscal (DB-enforced)

### Task 3.1: Scaffold NestJS + Prisma + conexão dupla

**Files:** Create: `apps/api/**` (nest scaffold), `apps/api/prisma/schema.prisma`

- [ ] **Step 1:** `pnpm --filter ... ` scaffold Nest (`nest new` ou template manual), add `prisma`, `@prisma/client`, `argon2`, `@nestjs/jwt`, `zod`.
- [ ] **Step 2:** `schema.prisma` com `datasource db { url = env("DATABASE_URL_OWNER") }` para migrate; runtime usa `DATABASE_URL` (app role) no `PrismaService`.
- [ ] **Step 3: Commit** — `chore(api): scaffold nestjs + prisma`.

### Task 3.2: Modelo de dados do Ciclo 0

**Files:** Modify: `apps/api/prisma/schema.prisma`; Create: migração inicial.

- [ ] **Step 1: Definir models** (todos com `tenant_id` exceto catálogo global de permissões):
  - Estrutura: `Tenant`, `Betriebsstaette`, `Kasse`, `TseClient`.
  - Auth/RBAC: `User`(password_hash, pin_hash, active), `Role`, `Permission`(global), `UserRole`, `RolePermission`.
  - Catálogo: `Product`(type, base_price cents, `mwst_code_im_haus`, `mwst_code_ausser_haus`, active), `TaxRate`(code, rate Decimal, valid_from, valid_to, tenant_id).
  - **Fiscal append-only (sem `updated_at`):** `Order`(kasse_id, shift_id?, mode, table_id?, total_net, total_mwst, total_gross, customer_id?, ts), `OrderItem`(order_id, product_id, qty, unit_net, mwst_rate, mwst_code), `Payment`(order_id, method, amount), `Receipt`(order_id, format, tse_signature jsonb, qr_payload, issued_at), `TseTransaction`(order_id, tse_client_id, tx_number, signature_counter, signature_value, log_time, process_type), `ZReport`(estrutura só), `AuditLog`(user_id, action, entity, entity_id, payload jsonb, ip, device, ts).
  - Sync: `SyncEvent`(client_event_id @unique, kasse_id, type, received_at).
- [ ] **Step 2: Migrar** — `DATABASE_URL_OWNER=... pnpm --filter api exec prisma migrate dev --name c0_init`.
- [ ] **Step 3:** Verificar tabelas criadas (`prisma studio` ou `\dt`).
- [ ] **Step 4: Commit** — `feat(api): ciclo-0 data model`.

### Task 3.3: Imutabilidade imposta no banco (a tarefa de compliance mais importante)

**Files:** Create: `apps/api/prisma/migrations/<ts>_immutability/migration.sql` (migração SQL manual), `apps/api/test/immutability.e2e-spec.ts`

- [ ] **Step 1: Teste falhando** — conectando como `gelato_app`, inserir uma `Order` deve passar; `UPDATE`/`DELETE` nessa order deve lançar erro.

```ts
// usa um Pool 'pg' com DATABASE_URL (gelato_app)
it('blocks UPDATE on fiscal tables', async () => {
  const id = await insertOrder(appPool)
  await expect(appPool.query(`UPDATE orders SET total_net=0 WHERE id=$1`, [id])).rejects.toThrow()
})
it('blocks DELETE on fiscal tables', async () => {
  const id = await insertOrder(appPool)
  await expect(appPool.query(`DELETE FROM orders WHERE id=$1`, [id])).rejects.toThrow()
})
```

- [ ] **Step 2: Ver falhar** (sem proteção, UPDATE/DELETE passam).

- [ ] **Step 3: Migração SQL** — para cada tabela fiscal (`orders, order_items, payments, receipts, tse_transactions, audit_log, z_reports, sync_events`): REVOKE de DML perigoso do role app + trigger guard.

```sql
-- 1) Permissões: app insere e lê, nunca atualiza/deleta dados fiscais.
REVOKE UPDATE, DELETE, TRUNCATE ON
  orders, order_items, payments, receipts, tse_transactions, audit_log, z_reports, sync_events
  FROM gelato_app;
GRANT SELECT, INSERT ON
  orders, order_items, payments, receipts, tse_transactions, audit_log, z_reports, sync_events
  TO gelato_app;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO gelato_app;

-- 2) Defense-in-depth: trigger barra UPDATE/DELETE mesmo de roles privilegiados.
CREATE OR REPLACE FUNCTION fiscal_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'fiscal table % is append-only (no % allowed)', TG_TABLE_NAME, TG_OP;
END; $$ LANGUAGE plpgsql;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['orders','order_items','payments','receipts','tse_transactions','audit_log','z_reports','sync_events']
  LOOP
    EXECUTE format(
      'CREATE TRIGGER %I_append_only BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION fiscal_append_only();',
      t, t);
  END LOOP;
END $$;
```

- [ ] **Step 4: Aplicar e ver o teste passar.** Documentar no `verfahrensdokumentation.md` (Chunk 9) que correção = Storno.
- [ ] **Step 5: Commit** — `feat(api): db-enforced immutability on fiscal tables`.

---

## Chunk 4: Auth (senha + PIN) + RBAC (acumulável)

### Task 4.1: Hash de senha e PIN

**Files:** Create: `apps/api/src/auth/hash.ts`, `apps/api/test/hash.spec.ts`

- [ ] **Step 1: Teste** — `hashSecret`/`verifySecret` (argon2) round-trip ok; senha errada falha.
- [ ] **Step 2: Ver falhar.**
- [ ] **Step 3: Implementar** com `argon2.hash`/`verify`.
- [ ] **Step 4: Ver passar.** **Step 5: Commit.**

### Task 4.2: Login senha, login PIN, escalonamento, JWT

**Files:** Create: `apps/api/src/auth/{auth.module,auth.service,auth.controller,jwt.strategy}.ts`, `apps/api/test/auth.e2e-spec.ts`

- [ ] **Step 1: Teste e2e** — `POST /auth/login` (email+senha) retorna JWT; `POST /auth/pin` (kasse_id+pin) retorna JWT de turno; `POST /auth/escalate` exige senha e eleva o token; PIN inválido → 401.
- [ ] **Step 2: Ver falhar.**
- [ ] **Step 3: Implementar** — JWT com claims `{ sub, tenant_id, kasse_id?, permissions: string[], escalated: bool }`. PIN busca user por tenant/kasse.
- [ ] **Step 4: Ver passar.** **Step 5: Commit.**

### Task 4.3: RBAC guard + permissões efetivas (união de roles)

**Files:** Create: `apps/api/src/rbac/{permissions.ts,roles.guard.ts,require-permission.decorator.ts}`, `apps/api/test/rbac.e2e-spec.ts`

- [ ] **Step 1: Teste** — usuário só com `operator` recebe 403 em rota `@RequirePermission('admin.users')`; usuário com `operator`+`lagerist` tem **união** das permissões; `admin` acessa tudo.
- [ ] **Step 2: Ver falhar.**
- [ ] **Step 3: Implementar** — catálogo de permissões em `permissions.ts` (subconjunto C0: `pos.sale.create`, `product.view/manage`, `admin.users/settings`...); `RolesGuard` lê `permissions` do JWT; decorator marca a permissão exigida.
- [ ] **Step 4: Ver passar.** **Step 5: Commit.**

### Task 4.4: Seed (roles, permissions, tenant/kasse demo, tax_rates)

**Files:** Create: `apps/api/prisma/seed.ts`

- [ ] **Step 1:** Seed idempotente: permissões do catálogo; roles `operator`/`lagerist`/`admin` com seus `role_permissions`; 1 tenant + 1 Betriebsstätte + 1 Kasse + 1 TseClient (placeholder fiskaly); usuário admin (senha) e operator (PIN); **`tax_rates` seed conservador** com comentário `// CONFIRMAR COM STEUERBERATER`:

```ts
// Seed conservador. Valores e validade DEVEM ser confirmados com Steuerberater.
await db.taxRate.createMany({ data: [
  { tenant_id, code: 'standard_19', rate: '0.19', valid_from: new Date('2020-01-01') },
  { tenant_id, code: 'reduced_7',  rate: '0.07', valid_from: new Date('2020-01-01') },
]})
// Produto demo: gelato -> im_haus usa um código, ausser_haus outro (parametrizável, não hardcoded).
```

- [ ] **Step 2: Rodar** `prisma db seed` e validar via studio.
- [ ] **Step 3: Commit** — `feat(api): seed roles/permissions/tax_rates/demo tenant`.

---

## Chunk 5: `packages/compliance` — Motor MwSt (puro, TDD pesado)

### Task 5.1: Tipos e lookup de tax_rate por validade

**Files:** Create: `packages/compliance/src/mwst/types.ts`, `packages/compliance/src/mwst/rates.ts`, `packages/compliance/test/rates.test.ts`

- [ ] **Step 1: Teste** — `pickRate(rates, 'reduced_7', date)` retorna a taxa vigente naquela data; ignora as expiradas; erro se nenhuma vigente.
- [ ] **Step 2: Ver falhar.**
- [ ] **Step 3: Implementar** — `TaxRate { code; rate: number; validFrom: Date; validTo?: Date }`; `pickRate` filtra por code e `validFrom <= date < validTo`.
- [ ] **Step 4: Ver passar.** **Step 5: Commit.**

### Task 5.2: `computeMwst` — decomposição por alíquota e por modo

**Files:** Create: `packages/compliance/src/mwst/engine.ts`, `packages/compliance/test/engine.test.ts`

- [ ] **Step 1: Teste falhando** — mesmo produto, modos diferentes ⇒ alíquotas diferentes; totais agrupados por taxa (necessário p/ TSE/DSFinV-K); arredondamento por grupo.

```ts
import { computeMwst } from '../src/mwst/engine'
const rates = [
  { code: 'standard_19', rate: 0.19, validFrom: new Date('2020-01-01') },
  { code: 'reduced_7', rate: 0.07, validFrom: new Date('2020-01-01') },
]
const product = { id: 'p1', netCents: 200, mwstCodeImHaus: 'standard_19', mwstCodeAusserHaus: 'reduced_7' }
const at = new Date('2026-06-23')

it('same product, different mode => different rate', () => {
  const imHaus = computeMwst([{ product, qty: 1 }], 'im_haus', at, rates)
  const ausser = computeMwst([{ product, qty: 1 }], 'ausser_haus', at, rates)
  expect(imHaus.totalMwst).toBe(38)   // 200*0.19
  expect(ausser.totalMwst).toBe(14)   // 200*0.07
})

it('groups totals by VAT rate', () => {
  const r = computeMwst([{ product, qty: 2 }], 'im_haus', at, rates)
  expect(r.groups).toEqual([{ code: 'standard_19', rate: 0.19, net: 400, mwst: 76, gross: 476 }])
  expect(r.totalGross).toBe(476)
})
```

- [ ] **Step 2: Ver falhar.**
- [ ] **Step 3: Implementar `engine.ts`** — para cada item escolhe o code conforme `mode`, agrupa net por code, aplica `pickRate` + `applyRate` (de `@gelato/domain`) por grupo, soma. Retorna `{ groups, totalNet, totalMwst, totalGross }`.
- [ ] **Step 4: Ver passar** (incluir caso de data fora de validade ⇒ erro claro).
- [ ] **Step 5: Commit** — `feat(compliance): MwSt engine (per-mode, per-rate breakdown)`.

---

## Chunk 6: `packages/compliance` — TseProvider + FiskalyProvider + recibo/QR

### Task 6.1: Interface `TseProvider` (port) + tipos

**Files:** Create: `packages/compliance/src/tse/provider.ts`, `packages/compliance/src/tse/types.ts`

- [ ] **Step 1:** Definir a interface (sem impl ainda) — o contrato que isola o fornecedor:

```ts
export type TseProcessType = 'Kassenbeleg-V1'
export interface TseSignRequest {
  clientId: string
  processType: TseProcessType
  // dados por alíquota + meios de pagamento, no formato exigido pela spec
  amountsByVatRate: { rate: number; gross: number }[]
  paymentType: 'Bar' | 'Unbar'
  grossTotal: number
}
export interface TseTransactionResult {
  txNumber: number
  signatureCounter: number
  signatureValue: string      // base64
  logTime: string             // ISO
  serialNumber: string        // nº de série do TSE
  processType: TseProcessType
  publicKey: string           // base64, p/ verificação
  startTime: string
}
export interface TseProvider {
  sign(req: TseSignRequest): Promise<TseTransactionResult>
}
```

- [ ] **Step 2: Commit** — `feat(compliance): TseProvider port + types`.

### Task 6.2: `FiskalyProvider` (adapter REST, sandbox) — integração real

**Files:** Create: `packages/compliance/src/tse/fiskaly.ts`, `packages/compliance/test/fiskaly.integration.test.ts`

> **IMPORTANTE (legal):** implementar **seguindo a documentação vigente da fiskaly SIGN DE (KassenSichV)** — fluxo StartTransaction (state `ACTIVE`) → FinishTransaction (state `FINISHED`) com `schema.standard_v1.receipt` (`Kassenbeleg-V1`, `amounts_per_vat_rate`, `payment_types`). Não inventar shapes; validar campos contra a doc atual. Confirmar **certificação BSI vigente** antes de produção.

- [ ] **Step 1: Teste de integração** (guardado por env `FISKALY_API_KEY` — `it.skipIf(!process.env.FISKALY_API_KEY)`): autentica no sandbox, assina uma transação mínima, e **valida** que o resultado tem `signatureValue`, `signatureCounter` crescente, `logTime`, `serialNumber`, `publicKey`.
- [ ] **Step 2: Ver falhar/skip.**
- [ ] **Step 3: Implementar `FiskalyProvider`** — auth (token), criação/uso de TSS+client (do TseClient da Kasse), `PUT` da transação ACTIVE→FINISHED, mapeia a resposta para `TseTransactionResult`. Retries só em erro de rede; nunca "assinar retroativamente".
- [ ] **Step 4: Rodar com creds de sandbox e ver passar.**
- [ ] **Step 5: Commit** — `feat(compliance): fiskaly SIGN DE adapter (sandbox)`.

### Task 6.3: Recibo + QR oficial DFKA

**Files:** Create: `packages/compliance/src/receipt/build.ts`, `packages/compliance/src/receipt/qr.ts`, `packages/compliance/test/qr.test.ts`, `packages/compliance/test/__fixtures__/tse-tx.json`

- [ ] **Step 1: Teste snapshot** — `buildDfkaQrPayload(tseTx)` produz a string no **formato DFKA de verificação de recibo** (campos separados por `;`: versão, processType, processData, transactionNumber, signatureCounter, startTime, logTime, sigAlg, logTimeFormat, signature(base64), publicKey(base64)). Snapshot contra fixture.

```ts
import { buildDfkaQrPayload } from '../src/receipt/qr'
import tx from './__fixtures__/tse-tx.json'
it('builds DFKA receipt QR payload', () => {
  expect(buildDfkaQrPayload(tx)).toMatchSnapshot()
})
```

- [ ] **Step 2: Ver falhar.**
- [ ] **Step 3: Implementar** `qr.ts` (montagem do payload conforme a ordem/campos da spec DFKA — **validar contra a doc**, não memória) e `build.ts` (`buildReceipt(order, items, tseTx) → ReceiptModel` com dados obrigatórios da Belegausgabepflicht: vendedor, itens, totais por alíquota, meio de pagamento, dados do TSE, timestamp).
- [ ] **Step 4: Ver passar.** **Step 5: Commit** — `feat(compliance): receipt + DFKA QR builder`.

---

## Chunk 7: `packages/sync` + API `/pos/sync` idempotente + ledger imutável + audit

### Task 7.1: `packages/sync` — envelope + idempotência

**Files:** Create: `packages/sync/src/envelope.ts`, `packages/sync/src/idempotency.ts`, `packages/sync/test/envelope.test.ts`

- [ ] **Step 1: Teste** — `makeEnvelope(payload)` gera `client_event_id` (uuid v4) único e estável depois de criado; estrutura valida contra `SaleEventSchema` de `@gelato/domain`.
- [ ] **Step 2: Ver falhar.** **Step 3: Implementar.** **Step 4: Ver passar.** **Step 5: Commit.**

### Task 7.2: `LedgerService` — escrita atômica do ledger + audit

**Files:** Create: `apps/api/src/pos/ledger.service.ts`, `apps/api/src/audit/audit.service.ts`, `apps/api/test/ledger.spec.ts`

- [ ] **Step 1: Teste** — `ingest(event, actor)` numa transação Prisma grava `order+items+payment+receipt+tse_transaction+audit_log+sync_event`; se já existe `sync_event` com aquele `client_event_id`, **não** grava de novo (no-op) e retorna `{ duplicate: true }`.
- [ ] **Step 2: Ver falhar.**
- [ ] **Step 3: Implementar** — `prisma.$transaction`: `findUnique(sync_events, client_event_id)`; se existe → retorna duplicate; senão cria todas as linhas (INSERT-only, compatível com a imutabilidade) + audit `sale.create`.
- [ ] **Step 4: Ver passar.** **Step 5: Commit** — `feat(api): immutable ledger ingest + audit`.

### Task 7.3: `POST /pos/sync` (idempotente, autenticado por turno)

**Files:** Create: `apps/api/src/pos/sync.controller.ts`, `apps/api/test/sync.e2e-spec.ts`

- [ ] **Step 1: Teste e2e** — POST de um SaleEvent válido (JWT de turno) → 201 e linhas no ledger; **POST do mesmo evento 2×** → segunda resposta idempotente, **1 só** order no banco; payload inválido → 400; sem permissão `pos.sale.create` → 403.
- [ ] **Step 2: Ver falhar.**
- [ ] **Step 3: Implementar** — valida com `SaleEventSchema`, `@RequirePermission('pos.sale.create')`, delega ao `LedgerService.ingest`, captura `ip`/`device` para audit.
- [ ] **Step 4: Ver passar.** **Step 5: Commit** — `feat(api): idempotent POST /pos/sync`.

### Task 7.4: Products + tax_rates endpoints (mínimo)

**Files:** Create: `apps/api/src/products/**`, `apps/api/test/products.e2e-spec.ts`

- [ ] **Step 1: Teste** — `GET/POST /products` com permissão; produto carrega seus `mwst_code_*`; `GET /tax-rates` lista vigentes; isolamento por tenant (tenant A não vê produto de B).
- [ ] **Step 2..4:** TDD. **Step 5: Commit.**

---

## Chunk 8: `apps/pos-terminal` (Electron + React + SQLite local + outbox)

### Task 8.1: Scaffold Electron + React + better-sqlite3

**Files:** Create: `apps/pos-terminal/**` (electron-vite template), `apps/pos-terminal/src/db/schema.sql`

- [ ] **Step 1:** Scaffold com electron-vite (main/preload/renderer). Add `better-sqlite3`, `@gelato/compliance`, `@gelato/domain`, `@gelato/sync`.
- [ ] **Step 2: `schema.sql`** — tabelas locais append-only (`orders, order_items, payments, receipts, tse_transactions`) + `outbox(id, client_event_id unique, payload json, status, attempts, next_attempt_at, created_at)`.
- [ ] **Step 3: Commit** — `chore(pos): scaffold electron + local sqlite schema`.

### Task 8.2: `local-repo` — gravação append-only local

**Files:** Create: `apps/pos-terminal/src/db/local-repo.ts`, `apps/pos-terminal/test/local-repo.test.ts`

- [ ] **Step 1: Teste** (better-sqlite3 em memória) — `saveFinalizedSale(sale)` grava todas as linhas + enfileira 1 outbox `pending` com `client_event_id`; re-salvar mesmo id é no-op (unique).
- [ ] **Step 2: Ver falhar.** **Step 3: Implementar** (transação sqlite). **Step 4: Ver passar.** **Step 5: Commit.**

### Task 8.3: `finalize` — orquestra MwSt → fiskaly → local → outbox

**Files:** Create: `apps/pos-terminal/src/sale/finalize.ts`, `apps/pos-terminal/test/finalize.test.ts`

- [ ] **Step 1: Teste** (com `TseProvider` fake) — `finalizeSale(cart, mode)` chama `computeMwst`, depois `tse.sign`, monta recibo+QR, grava local e enfileira outbox; **se `tse.sign` rejeita ⇒ a venda NÃO é gravada e propaga erro** (caminho feliz online do C0; modo de falha = Ciclo 1).
- [ ] **Step 2: Ver falhar.** **Step 3: Implementar.** **Step 4: Ver passar** (incl. caso de falha de assinatura). **Step 5: Commit.**

### Task 8.4: `outbox-worker` — POST /pos/sync com backoff + idempotência

**Files:** Create: `apps/pos-terminal/src/sync/outbox-worker.ts`, `apps/pos-terminal/test/outbox-worker.test.ts`

- [ ] **Step 1: Teste** (fetch mockado) — worker pega `pending`, faz POST; 2xx ⇒ marca `sent`; erro de rede ⇒ incrementa `attempts`, agenda `next_attempt_at` (backoff), permanece `pending`; resposta "duplicate" ⇒ também marca `sent` (idempotente).
- [ ] **Step 2: Ver falhar.** **Step 3: Implementar.** **Step 4: Ver passar.** **Step 5: Commit.**

### Task 8.5: UI mínima (PIN, produtos, modo, finalizar, recibo+QR)

**Files:** Create: `apps/pos-terminal/src/ui/**`

- [ ] **Step 1:** Telas: login PIN → grade de produtos → toggle `im_haus`/`ausser_haus` → finalizar → exibe recibo com **QR renderizado** (lib de QR a partir do `qr_payload`). i18n via `@gelato/...` (Chunk 9 fornece o i18n compartilhado, ou local).
- [ ] **Step 2:** Smoke test de render dos componentes (Vitest + Testing Library) onde fizer sentido.
- [ ] **Step 3: Commit** — `feat(pos): minimal terminal UI (pin, sale, receipt+qr)`.

---

## Chunk 9: `apps/backoffice`, i18n (DE/EN/PT) e docs (Verfahrensdokumentation)

### Task 9.1: i18n compartilhado (i18next, DE/EN/PT)

**Files:** Create: `apps/backoffice/src/i18n/**` (e reutilizar no terminal)

- [ ] **Step 1:** Setup i18next com namespaces; arquivos `de.json`, `en.json`, `pt.json` (chaves do C0); locale por usuário/tenant. Sem strings cravadas nas telas.
- [ ] **Step 2: Teste** — chave ausente em qualquer locale falha um teste de paridade de chaves.
- [ ] **Step 3: Commit** — `feat(i18n): de/en/pt with key-parity test`.

### Task 9.2: Backoffice mínimo

**Files:** Create: `apps/backoffice/src/pages/**`

- [ ] **Step 1:** Login; **lista de vendas** (lê do ledger via API, read-only); **CRUD de produto**; **visão de usuários/roles**. shadcn/ui.
- [ ] **Step 2:** Smoke tests de rotas protegidas (sem permissão ⇒ redirect/empty).
- [ ] **Step 3: Commit** — `feat(backoffice): login + sales list + product crud + users view`.

### Task 9.3: Docs — CLAUDE.md + Verfahrensdokumentation inicial

**Files:** Create: `docs/CLAUDE.md`, `docs/verfahrensdokumentation.md`

- [ ] **Step 1: `docs/CLAUDE.md`** — instruções p/ o agente: convenções (cents, append-only, nada hardcoded), como rodar, estrutura do monorepo, regra de imutabilidade.
- [ ] **Step 2: `docs/verfahrensdokumentation.md`** — seção inicial GoBD: descrição do processo de venda, assinatura TSE, imutabilidade (correção = Storno), trilha de auditoria, retenção (parâmetro, padrão 10 anos, *confirmar Steuerberater*).
- [ ] **Step 3: Commit** — `docs: CLAUDE.md + initial verfahrensdokumentation`.

---

## Chunk 10: Verificação end-to-end (Definition of Done)

> Não é código novo — é o roteiro de verificação manual + checagem do DoD. Rodar após todos os chunks.

- [ ] `docker compose up` (Postgres) + `pnpm --filter api start` + terminal Electron + backoffice sobem.
- [ ] Login por PIN no terminal.
- [ ] **Venda `im_haus`** e **venda `ausser_haus`** com o mesmo produto ⇒ **alíquotas diferentes** vindas de `tax_rates` (confirmar que nada está hardcoded).
- [ ] Recibo + **QR** exibidos; validar payload (escanear/decodificar).
- [ ] Backoffice → lista de vendas mostra ambas; `audit_log` tem `sale.create`.
- [ ] Derrubar a rede no meio, finalizar venda (assinatura exige rede — confirmar bloqueio do C0); religar e confirmar que o **outbox reenviou** vendas pendentes **sem duplicar** (idempotência: 1 order por `client_event_id`).
- [ ] `pnpm -r test` verde, incluindo os testes que **provam que UPDATE/DELETE fiscal falham** e os de RBAC.
- [ ] Marcar todos os itens do **Definition of Done** do spec.

---

## Notas de execução
- **Sem worktree:** projeto greenfield sem git no início; a Task 1.1 inicializa o repo. Trabalhar direto na branch `main` (ou criar `ciclo-0` após o init, a critério do executor).
- **Commits frequentes:** cada Task termina em commit (já embutido nos steps).
- **Ordem dos chunks importa:** 1→2→3 estabelecem fundação e imutabilidade antes de qualquer escrita fiscal. compliance (4–6) é puro e pode ser desenvolvido em paralelo aos chunks de API se houver mais de um executor, mas o sync (7) depende de 3 e 5–6.
- **Validações externas pendentes** (rastrear, fora do código): MwSt gelato salão×takeaway, retenção 8 vs 10 anos, prazos Kassenmeldung — **confirmar com Steuerberater**; **certificação BSI** da fiskaly antes de produção.
```
