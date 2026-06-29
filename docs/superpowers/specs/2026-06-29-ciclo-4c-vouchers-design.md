# Ciclo 4 · Fatia 4c — Vouchers (cupons de desconto)

> Spec de design. Base: C0 + Ciclo 1 (menos 1e) + Ciclo 2 + Ciclo 3 + 4a + 4b em `main` (origin/main
> c563f6f, 239 testes). **Primeira fatia do Ciclo 4 que toca o fiscal.** Convenções: **cents
> inteiros**; **append-only** p/ a trilha de resgate (reusa `fiscal_append_only()`); **MwSt da
> `tax_rates`** (o desconto recomputa MwSt por alíquota); **TDD**; **127.0.0.1** (5433; API :3001).
> RBAC `marketing.view/manage` + `pos.sale.create` já existem.

## Problema

A 4c adiciona **cupons de desconto** por código. O delicado é o **caminho fiscal**: um desconto
(Rabatt) reduz o total da venda e a MwSt por alíquota, e precisa aparecer no recibo + DSFinV-K. A
arquitetura central-autoritativa-no-compute (o terminal assina a TSE com o total já descontado)
impõe que o desconto seja **computado no terminal** (via lógica pura compartilhada); o backend
**valida** o voucher e **registra** o resgate.

## Decisões travadas (brainstorming 2026-06-29)

1. **Só vouchers** (código). Promoções automáticas (regras/janela) = fatia separada (**4c-2**).
2. **Desconto = linha Rabatt negativa.** O terminal computa o desconto (puro compartilhado) e inclui
   **uma linha por alíquota** com `unit_net` negativo; ledger/recibo/DSFinV-K tratam como linha normal
   (**zero mudança no modelo fiscal**). O backend valida (endpoint `quote`) + grava `VoucherRedemption`
   append-only.
3. **Tipos:** `percent` (valor inteiro, ex. 10 = 10%) e `fixed` (cents). Item-grátis = depois.

## Lógica pura (`@gelato/compliance/src/voucher/`)

- **`voucherDiscountGross(type, value, baseGross) → discountGross`** — `percent`:
  `Math.floor(baseGross * value / 100)`; `fixed`: `Math.min(value, baseGross)`. Nunca > `baseGross`
  (sem total negativo). Inteiro.
- **`allocateDiscountByRate(byVatRate, discountGross) → { rate, net, mwst, gross }[]`** (valores
  **negativos**) — rateia o desconto proporcional ao `gross` de cada alíquota; net-centric (`net =
  round(share / (1+rate))`, `mwst = share − net`); **a última alíquota leva o resto** (Σ gross =
  `−discountGross` exato). O terminal vira isso em linhas Rabatt (`unit_net = -net`, `mwst_rate = rate`).

## Dados

- **`Voucher`** (master, **mutável**): `id, tenantId, code, type String` (`'percent'|'fixed'`),
  `value Int, maxUses Int?` (null = ilimitado), `validFrom DateTime?, validTo DateTime?, active
  Boolean @default(true), createdAt`. `@@unique([tenantId, code])`. GRANT DML.
- **`VoucherRedemption`** (**append-only**): `id, tenantId, voucherId, orderId String?, customerId
  String?, discountCents Int, at DateTime @default(now())`. FK→`Voucher`. GRANT SELECT/INSERT +
  trigger. `usedCount` = Σ resgates (derivado).

## Fiscal / venda

- `OrderSchema` (`@gelato/domain`) ganha **`voucher_code?`** (opcional). No `ledger.ingest`, após
  criar a Order, se houver `voucher_code` → acha o `Voucher` (tenant) → grava `VoucherRedemption`
  (`orderId`, `customerId`, `discountCents` = |Σ gross das linhas com `unitNet < 0`|). **O desconto em
  si já está nas linhas Rabatt** (terminal). Nenhuma alteração no modelo `Order` além de gravar a trilha.

## API (`apps/api/src/vouchers`)

| Rota | RBAC | Efeito |
|---|---|---|
| `POST /vouchers/quote` `{ code, gross_cents }` | `pos.sale.create` | valida (ativo + janela + não esgotado) e devolve `{ valid, type?, value?, discount_cents? }`. O PDV chama **antes** de assinar. **Não 400** p/ inválido — `valid:false` é resposta normal. |
| `GET /vouchers` | `marketing.view` | vouchers + `usedCount` derivado. |
| `POST /vouchers` `{ code, type, value, max_uses?, valid_from?, valid_to? }` | `marketing.manage` | cria; **409** se código duplicado no tenant. |
| `PATCH /vouchers/:id` `{ active?, value?, max_uses? }` | `marketing.manage` | edita; **404** cross-tenant. |

## Seed

Voucher demo `SOMMER10` (`percent`, value 10, `maxUses 100`, ativo).

## Backoffice (mínimo)

Seção **"Vouchers"**: lista (código, tipo, valor, usos/limite, ativo) + form de criação. Build + typecheck.

## Erros / bordas

- Voucher inativo / fora da janela / esgotado → `quote` `{ valid: false }` (resposta normal, não 400).
- Código duplicado no tenant → **409**. Desconto > total → **capado** no total.
- Resgate com `voucher_code` inexistente/de outro tenant → ledger ignora (sem quebrar a venda).
- `maxUses`: enforce no `quote` (o PDV não aplica esgotado); o registro é best-effort (over-uso
  concorrente = risco de negócio menor, não de compliance).
- `VoucherRedemption` append-only (UPDATE/DELETE bloqueados).

## Testes e verificação

- **Unit (puro):** `voucherDiscountGross` (percent / fixed / cap no total); `allocateDiscountByRate`
  (proporção + resto exato + multi-alíquota; Σ = −discountGross).
- **API (e2e):** criar voucher; `quote` válido devolve o desconto; inativo/esgotado → `valid:false`;
  venda com `voucher_code` + linhas Rabatt → Order total reduzido + `VoucherRedemption` gravado +
  `usedCount`↑; código duplicado → 409; **imutabilidade** de `voucher_redemptions`.
- **Capstone (e2e):** voucher `percent 10 maxUses 1` → `quote 1190` → `discount 119` → venda com linha
  Rabatt `−119` (net/mwst por alíquota) + `voucher_code` → Order gross 1071, redemption gravado,
  `usedCount 1` → `quote` de novo → `valid:false` (esgotado).
- **Backoffice:** build + typecheck.

## Decomposição (4 chunks TDD)

1. **puro** — `voucherDiscountGross` + `allocateDiscountByRate` em `@gelato/compliance` + build dist.
2. **modelo + seed** — `Voucher` (mutável, GRANT DML) + `VoucherRedemption` (append-only, trigger)
   via migração não-interativa; seed do voucher demo.
3. **API + ledger** — quote + CRUD vouchers + `voucher_code` no `OrderSchema` (`@gelato/domain`,
   + build dist) + resgate no `ledger.ingest` + e2e + imutabilidade + capstone.
4. **backoffice (Vouchers)** + build/typecheck; integrar `ciclo-4c → main` + push.

## Fora de escopo (4c-2/4d / YAGNI)

Promoções automáticas (regras, janela) — **4c-2**; voucher **item-grátis**; voucher por-cliente /
uso-único-por-cliente; campanhas (**4d**); representação exata do **Rabatt no DSFinV-K** (mapeamento
de campo) → validação externa.

## Validação externa (rastrear)

Forma exata do **Rabatt no DSFinV-K** (campos de `BON_POSITIONEN`/desconto) e no recibo → spec
DSFinV-K / **Steuerberater** (como o QR DFKA). Aqui: desconto como linha negativa por alíquota (MwSt
recomputada corretamente) + trilha de resgate append-only.
