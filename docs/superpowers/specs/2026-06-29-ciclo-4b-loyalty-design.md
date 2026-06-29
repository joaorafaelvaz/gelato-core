# Ciclo 4 · Fatia 4b — Loyalty (fidelidade)

> Spec de design. Base: C0 + Ciclo 1 (menos 1e) + Ciclo 2 + Ciclo 3 + 4a em `main` (origin/main
> d788f9b, 227 testes). Convenções: **saldo derivado de ledger append-only** (reusa
> `fiscal_append_only()`); **inteiros**; **TDD**; **127.0.0.1** (5433; API :3001); inglês / domínio
> em alemão. RBAC `marketing.view/manage` + `customer.manage` **já existe** (admin). Depende da 4a
> (`Customer`).

## Problema

A 4a tem clientes + consentimento. A 4b adiciona **fidelidade**: o cliente ganha pontos/carimbos a
cada compra e os resgata. É o diferencial de retenção, apoiado no CRM.

## Decisões travadas (brainstorming 2026-06-29)

1. **Saldo = ledger append-only.** `LoyaltyEntry` (earn/redeem/adjust como **deltas assinados** de
   `points` e `stamps`); saldo = Σ (derivado, como estoque). Reverte fácil (Storno → negativo),
   auditável. *Não é exigido por lei (loyalty é operacional), mas mantém o padrão do projeto.*
2. **Pontos E carimbos no mesmo ledger** — cada entrada carrega delta de `points` e de `stamps`; a
   **config do programa** decide o que se ganha (carimbo por bola; pontos por € opcional).
3. **Ganho automático na venda; resgate manual.** Earn engancha no `ledger.ingest` (toda Order **com
   `customer_id`**). Resgate = entrada manual (`redeem`, deltas negativos). O resgate-como-**desconto
   na venda** (toca o fiscal) fica p/ a 4c.

## Dados

- **`LoyaltyProgram`** (config, **mutável**, 1 por tenant): `id, tenantId @unique, pointsPerEuro Int
  @default(0), stampsPerItem Int @default(0), active Boolean @default(true), updatedAt`. GRANT DML.
- **`LoyaltyEntry`** (**append-only**): `id, tenantId, customerId, kind String` (`'earn'|'redeem'|
  'adjust'`), `points Int @default(0)` (delta assinado), `stamps Int @default(0)` (delta), `refType
  String?, refId String?, reason String?, at DateTime @default(now())`. FK→`Customer`. GRANT
  SELECT/INSERT + trigger append-only.

## Lógica pura (`@gelato/compliance/src/loyalty/`)

- **`earnFromSale(grossCents, itemCount, program) → { points, stamps }`** —
  `points = Math.floor(grossCents / 100) * program.pointsPerEuro`; `stamps = itemCount *
  program.stampsPerItem`. (Tudo inteiro; gross/itemCount negativos → ganho negativo = Storno.)
- **`loyaltyBalance(entries) → { points, stamps }`** — Σ dos deltas de `points` e `stamps`.

## Hook (`apps/api/src/loyalty/earn.ts`)

`earnLoyalty(tx, { kasseId, customerId, grossCents, itemCount, orderId })` — resolve o `tenantId` via
Kasse→Betriebsstätte; lê o `LoyaltyProgram` ativo; calcula `earnFromSale`; se `points || stamps` ≠ 0,
insere uma `LoyaltyEntry` `earn` (`refType:'order', refId:orderId`). Chamado no `ledger.ingest`
**quando `p.order.customer_id` está presente** (vendas diretas; salão ganha quando a sessão tiver
cliente — futuro). `itemCount = Σ p.items.qty`. Idempotente (só no caminho de criação da Order).

## API (`apps/api/src/loyalty`)

| Rota | RBAC | Efeito |
|---|---|---|
| `GET /customers/:id/loyalty` | `marketing.view` | `{ balance: {points, stamps}, entries }`; **404** cross-tenant. |
| `POST /customers/:id/loyalty/redeem` `{ points?, stamps?, reason? }` | `customer.manage` | append `redeem` (deltas **negativos**); **400** se saldo insuficiente em algum dos dois ou se ambos forem 0. |
| `GET /loyalty/program` | `marketing.view` | a config (defaults `{0,0,active:true}` se não houver). |
| `PUT /loyalty/program` `{ points_per_euro?, stamps_per_item?, active? }` | `marketing.manage` | upsert da config (1 por tenant). |

## Seed

`LoyaltyProgram` demo (`pointsPerEuro: 1, stampsPerItem: 1, active: true`).

## Backoffice (mínimo)

Seção **"Fidelidade"**: form de config do programa (pontos/€, carimbos/item, ativo) + a lista de
clientes com botão **"ver saldo"** (`GET /customers/:id/loyalty` inline). Build + typecheck.

## Erros / bordas

- Cliente de outro tenant → 404. Resgate sem saldo (em points ou stamps) → 400. Resgate ambos-zero →
  400. Programa inativo/zerado → venda **não** gera entrada (sem lixo). Storno (Order negativa) →
  `earn` negativo (devolve). `LoyaltyEntry` append-only (UPDATE/DELETE bloqueados).

## Testes e verificação

- **Unit (puro):** `earnFromSale` (pontos por €/carimbos por item; zero quando config zerada; gross
  negativo → negativo); `loyaltyBalance` (Σ; earn − redeem).
- **API (e2e):** configurar programa; venda direta com `customer_id` → entrada `earn` correta;
  `GET .../loyalty` mostra o saldo; resgate reduz; resgate > saldo → 400; programa inativo → venda
  sem entrada; **imutabilidade** de `loyalty_entries`; cross-tenant 404.
- **Capstone (e2e):** programa (1pt/€, 1 carimbo/item) → venda 3 itens / 11,90€ com cliente → `earn`
  +11 pontos +3 carimbos → `GET .../loyalty` saldo {11,3} → resgata 5 pontos → {6,3} → resgate > saldo
  → 400; a entrada `earn` referencia a Order (`refType:'order'`).

## Decomposição (4 chunks TDD)

1. **puro** — `earnFromSale` + `loyaltyBalance` em `@gelato/compliance` + build dist.
2. **modelo + seed** — `LoyaltyProgram` (mutável, GRANT DML) + `LoyaltyEntry` (append-only, trigger)
   via migração não-interativa; seed do programa demo.
3. **API + hook** — `earnLoyalty` no `ledger.ingest` + módulo `loyalty` (saldo, resgate, programa) +
   e2e + imutabilidade + capstone.
4. **backoffice (Fidelidade)** + build/typecheck; integrar `ciclo-4b → main` + push.

## Fora de escopo (4c/4d / YAGNI)

Resgate como **desconto na venda** (4c — toca o fiscal/DSFinV-K); expiração de pontos; níveis/tiers;
"produto grátis" automático ao atingir N carimbos; vincular cliente à sessão do salão (o ganho do
salão vem quando a sessão tiver cliente); notificação de saldo; carimbo só em certos produtos.

## Validação externa

Nenhuma fiscal/legal direta (loyalty é operacional). Se pontos/carimbos virarem **desconto** numa
venda (4c), aí o desconto entra no recibo + DSFinV-K → tratar como item fiscal.
