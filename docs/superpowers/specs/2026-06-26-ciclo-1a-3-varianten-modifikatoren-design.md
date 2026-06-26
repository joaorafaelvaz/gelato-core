# Ciclo 1 · Fatia 1a-3 — Produktvarianten + Modifikatoren (+ Category)

> Spec de design. Base: C0 + 1b + 1d + 1c + 1a-1 + 1a-2 (em `main`, 143 testes). Convenções:
> **cents**, **imutabilidade fiscal no banco**, **MwSt da `tax_rates`**, **TseProvider desacoplado**,
> **TDD**, **127.0.0.1** (Postgres em **5433** por coexistência), inglês / termos de domínio em alemão.

## Problema

Hoje `Product` tem um único `netCents` + `mwstCodeImHaus/AusserHaus`; a linha vendida
(`bestellung_items`/`order_items`) é `{productId, qty, unitNet, mwstRate, mwstCode}`. Falta
representar **variantes** (Eisbecher S/M/L, sabores) com preço próprio e **modificadores**
(extra Sahne +0,50€, ohne Zucker +0€) que ajustam a linha — e **categorias** para organizar o catálogo.

## Decisões travadas (brainstorming 2026-06-26)

1. **Variante = preço ABSOLUTO.** Cada variante tem `netCents` próprio; o `Product` é
   template/agrupamento. Produto **com** variantes → vende-se a variante; **sem** → usa
   `Product.netCents`.
2. **Modifier em LINHA ÚNICA.** `unitNet` da linha = (variante|produto) + Σ modifiers; os modifiers
   são gravados como **metadado** (snapshot) da linha; a MwSt **herda** a do produto.
3. **Escopo = modelo + aplicação na venda.** Sem CRUD no backoffice agora (YAGNI).

## Dados — master data (mutável, como Product/Tisch)

- **`ProductCategory`** — `id, tenantId, name, sortOrder Int @default(0), active`; novo
  `Product.categoryId String?`.
- **`ProductVariant`** — `id, productId, name, netCents (absoluto), sortOrder, active`.
- **`ProductModifier`** — `id, productId, name, netCents (acréscimo ≥0), sortOrder, active`.
  (Product-scoped, lista plana. Grupos/min-max/compartilhamento = fora.)

## Linha vendida — metadado (append-only, gravado no INSERT)

- `BestellungItem` e `OrderItem` ganham **`variantId String?`** + **`modifiers Json?`** (snapshot
  `[{id, name, netCents}]` no momento da venda). O `unitNet` já é o **combinado**. Nada de UPDATE
  — tudo no insert. `bestellung_items`/`order_items` continuam fiscais/append-only.

## Pura (`@gelato/compliance`)

**`buildSaleLine(base, variant?, modifiers) → { unitNet, mwstCode, modifiers }`**
- `unitNet = (variant?.netCents ?? base.baseNetCents) + Σ modifiers.netCents`.
- `mwstCode = base.mwstCode` (herdado do produto, conforme o modo); `modifiers` = snapshot
  `[{id,name,netCents}]`. A resolução da **alíquota** continua no motor/`tax_rates`. Puro/testável.

## Domínio + API

- `BestellungItemSchema` (e o item do `SalePayload`/`OrderItemSchema`) ganham `variant_id?` +
  `modifiers?` (`z.array({ id, name, net })`).
- **`GET /products`** passa a incluir `categoryId`, `variants[]` (id, name, netCents) e
  `modifiers[]` (id, name, netCents) — o terminal monta as linhas.
- `tables.addBestellung` + `ledger.ingest` gravam `variantId` + `modifiers` (JSON) na linha
  (no INSERT).
- **Seed:** categoria "Eis"; um produto com variantes (Eisbecher S=300/M=450/L=600) + um modifier
  ("extra Sahne" +50).

## Terminal (pos-web — mínimo, build-only)

Ao lançar um produto com variantes: escolher a variante (senão usa o produto); alternar modifiers;
`unitNet` via `buildSaleLine`; envia `variant_id` + `modifiers` na Bestellung. UI rica = depois;
verificação visual ao vivo = sessão interativa.

## Erros / bordas

- Variante/modifier de outro produto/tenant → ignorado/validação (server confia no `unit_net` do
  terminal, como hoje; validação contra catálogo = nota futura).
- Produto sem variantes → `variant_id` ausente, `unitNet = Product.netCents`.
- Modifier `netCents` negativo → fora de escopo (≥0).
- Append-only: a linha (com `variantId`/`modifiers`) é gravada no INSERT; sem UPDATE.

## Testes e verificação

- **Unit (puro):** `buildSaleLine` — variante absoluta substitui base, Σ modifiers, MwSt herdada,
  snapshot dos modifiers.
- **API (e2e):** `GET /products` traz variants/modifiers; Bestellung com `variant_id` + `modifiers`
  → `BestellungItem.unitNet` combinado + `variantId` + `modifiers` JSON gravados; a conta
  (`aggregateTab`) reflete o net combinado.
- **Capstone (e2e):** pedido de Eisbecher L + extra Sahne → linha `unitNet = 600+50 = 650` com
  `variantId`/`modifiers`; pagar → Kassenbeleg com a linha; append-only. Kasse/Tisch únicos por run.

## Decomposição (5 chunks TDD)

1. **domínio/compliance** — `buildSaleLine` puro + schema (`variant_id?`, `modifiers?`).
2. **modelo + seed** — `ProductCategory`/`ProductVariant`/`ProductModifier` + `Product.categoryId`
   + `BestellungItem`/`OrderItem` (`variantId`, `modifiers Json`); migração não-interativa; seed demo.
3. **API** — `GET /products` enriquecido; `addBestellung`/`ledger` gravam metadado; e2e.
4. **pos-web** — seletor mínimo de variante/modifier no fluxo de Bestellung.
5. **capstone e2e + verificação.**

## Fora de escopo (YAGNI)

Grupos de modifiers + min/max de seleção; modifiers compartilhados entre produtos; CRUD no
backoffice (criar/editar variantes/modifiers/categorias); modifiers negativos (desconto);
representação rica de variante/modifier na DSFinV-K (por ora **dobram no net da linha** do bonpos);
validação server-side do `unit_net` contra o catálogo.

## Validação externa pendente (rastrear)

Representação canônica de **variantes/modificadores na DSFinV-K** (hoje dobrados no net da linha
do `bonpos`; subitems/Zusatzbeträge da DFKA = futuro) → DFKA/Steuerberater.
