# Varianten + Modifikatoren (Ciclo 1 · fatia 1a-3) Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Vender produtos com **variantes** (preço absoluto) e **modificadores** (acréscimo), com o `unitNet` da linha combinado e os modifiers gravados como metadado append-only — mais **categorias** de catálogo.

**Architecture:** Master data mutável (`ProductCategory`/`ProductVariant`/`ProductModifier`). `buildSaleLine` (puro) compõe a linha: `unitNet = (variante|produto) + Σ modifiers`, MwSt herdada. A linha vendida (`bestellung_items`/`order_items`, append-only) ganha `variantId` + `modifiers Json`, gravados **no INSERT**. `GET /products` passa a trazer variants/modifiers para o terminal montar a linha.

**Tech Stack:** TypeScript strict, vitest (TDD), NestJS + Prisma + Postgres (`gelato_c0` em **5433**), React/Vite (pos-web). Cents; MwSt da `tax_rates`. **127.0.0.1**.

**Spec:** `docs/superpowers/specs/2026-06-26-ciclo-1a-3-varianten-modifikatoren-design.md`

> **Postgres em 5433.** Migração **não-interativa**: `prisma migrate diff` → `migration.sql` → `db execute` → `migrate resolve --applied` → `prisma generate`.
> **Validação externa:** representação de variantes/modifiers na DSFinV-K (hoje dobram no net da linha do `bonpos`) → DFKA.

---

## File Structure

**Criar (puro):** `packages/compliance/src/catalog/line.ts` (`buildSaleLine`).
**Modificar (puro):** `packages/compliance/src/index.ts`; `packages/domain/src/events.ts` (BestellungItemSchema + OrderItemSchema ganham `variant_id?`/`modifiers?`).
**Modificar (API):** `prisma/schema.prisma` (+migração c1a3); `prisma/seed.ts` (categoria/variantes/modifier demo); `src/products/products.service.ts` (include); `src/tables/tables.service.ts` (grava variantId/modifiers na Bestellung); `src/pos/ledger.service.ts` (grava no order_item); `test/tables.e2e.test.ts`, `test/products.e2e.test.ts`.
**Criar (teste):** `test/varianten-capstone.e2e.test.ts`.
**Modificar (pos-web):** `src/api.ts` (ApiProduct + variants/modifiers), `src/TischPanel.tsx` (seletor).

**Comandos:** puro `corepack pnpm --filter @gelato/<pkg> exec vitest run`; API e2e `corepack pnpm --filter @gelato/api exec vitest run`; typecheck `corepack pnpm exec tsc --noEmit -p <pkg>/tsconfig.json`; build `corepack pnpm --filter @gelato/<pkg> build`.

---

## Chunk 1: puro — buildSaleLine + schema

### Task 1.1: `buildSaleLine`

**Files:**
- Create: `packages/compliance/src/catalog/line.ts`
- Modify: `packages/compliance/src/index.ts`
- Test: `packages/compliance/test/sale-line.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/compliance/test/sale-line.test.ts
import { describe, it, expect } from 'vitest'
import { buildSaleLine } from '../src/catalog/line'

describe('buildSaleLine', () => {
  it('uses the product net when there is no variant', () => {
    const l = buildSaleLine({ baseNetCents: 150, mwstCode: 'standard_19' }, undefined, [])
    expect(l.unitNet).toBe(150)
    expect(l.mwstCode).toBe('standard_19')
    expect(l.modifiers).toEqual([])
  })

  it('uses the variant absolute net and adds modifiers, inheriting the mwstCode', () => {
    const l = buildSaleLine(
      { baseNetCents: 150, mwstCode: 'standard_19' },
      { netCents: 600 },
      [{ id: 'm1', name: 'extra Sahne', net: 50 }, { id: 'm2', name: 'Streusel', net: 30 }],
    )
    expect(l.unitNet).toBe(680) // 600 + 50 + 30
    expect(l.mwstCode).toBe('standard_19')
    expect(l.modifiers).toHaveLength(2)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm --filter @gelato/compliance exec vitest run test/sale-line.test.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/compliance/src/catalog/line.ts
import type { Cents } from '@gelato/domain'

export interface SaleLineModifier {
  id: string
  name: string
  net: Cents
}
export interface SaleLineBase {
  baseNetCents: Cents
  mwstCode: string
}
export interface SaleLineVariant {
  netCents: Cents
}
export interface SaleLine {
  unitNet: Cents
  mwstCode: string
  modifiers: SaleLineModifier[]
}

/**
 * Compõe a linha vendida: o net da variante (ABSOLUTO) substitui o do produto, e os
 * modifiers (acréscimos) são somados. A MwSt herda o código do produto (resolução da
 * alíquota fica no motor/tax_rates). Os modifiers são devolvidos como snapshot. Puro.
 */
export function buildSaleLine(
  base: SaleLineBase,
  variant: SaleLineVariant | undefined,
  modifiers: SaleLineModifier[],
): SaleLine {
  const baseNet = variant?.netCents ?? base.baseNetCents
  const unitNet = baseNet + modifiers.reduce((s, m) => s + m.net, 0)
  return { unitNet, mwstCode: base.mwstCode, modifiers }
}
```

- [ ] **Step 4: Run + export + build**

Run: `corepack pnpm --filter @gelato/compliance exec vitest run test/sale-line.test.ts` → PASS.
Editar `packages/compliance/src/index.ts`: `export * from './catalog/line'`.
Run: `corepack pnpm exec tsc --noEmit -p packages/compliance/tsconfig.json` → sem erros.
Run: `corepack pnpm --filter @gelato/compliance build` → dist atualizado.

- [ ] **Step 5: Commit**

```bash
git add packages/compliance/src/catalog/line.ts packages/compliance/src/index.ts packages/compliance/test/sale-line.test.ts
git commit -m "feat(compliance): buildSaleLine (variante absoluta + modifiers, MwSt herdada)"
```

### Task 1.2: schema do domínio — `variant_id?` + `modifiers?` na linha

**Files:**
- Modify: `packages/domain/src/events.ts`
- Test: `packages/domain/test/line-meta.test.ts`

> `OrderItemSchema` já tem `variant_id` (antecipado no C0); só falta `modifiers?`. `BestellungItemSchema` (1a-1) ganha `variant_id?` + `modifiers?`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/domain/test/line-meta.test.ts
import { describe, it, expect } from 'vitest'
import { BestellungItemSchema, OrderItemSchema } from '../src/events'

describe('line variant/modifiers metadata', () => {
  it('BestellungItem accepts variant_id + modifiers snapshot', () => {
    const parsed = BestellungItemSchema.parse({
      product_id: 'p1', variant_id: 'v1', qty: 1, unit_net: 650, mwst_rate: 0.19, mwst_code: 'standard_19',
      modifiers: [{ id: 'm1', name: 'extra Sahne', net: 50 }],
    })
    expect(parsed.variant_id).toBe('v1')
    expect(parsed.modifiers).toHaveLength(1)
  })
  it('OrderItem accepts modifiers', () => {
    const parsed = OrderItemSchema.parse({
      product_id: 'p1', variant_id: 'v1', qty: 1, unit_net: 650, mwst_rate: 0.19, mwst_code: 'standard_19',
      modifiers: [{ id: 'm1', name: 'extra Sahne', net: 50 }],
    })
    expect(parsed.modifiers?.[0].net).toBe(50)
  })
})
```

- [ ] **Step 2: Run** → FAIL (`modifiers` rejeitado / `variant_id` em BestellungItem).

- [ ] **Step 3: Implementar** — em `packages/domain/src/events.ts`:

Adicionar um schema compartilhado (perto de `OrderItemSchema`):
```ts
/** Snapshot de um modificador aplicado (capturado no momento da venda). */
export const LineModifierSchema = z.object({ id: z.string(), name: z.string(), net: Cents })
```
Em `OrderItemSchema`, adicionar:
```ts
  modifiers: z.array(LineModifierSchema).optional(),
```
Em `BestellungItemSchema`, adicionar (antes de `storno_of`):
```ts
  variant_id: z.string().optional(),
  modifiers: z.array(LineModifierSchema).optional(),
```
E exportar o tipo: `export type LineModifier = z.infer<typeof LineModifierSchema>`.

- [ ] **Step 4: Run + build** → `corepack pnpm --filter @gelato/domain exec vitest run test/line-meta.test.ts` PASS; `corepack pnpm --filter @gelato/domain build`.

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/events.ts packages/domain/test/line-meta.test.ts
git commit -m "feat(domain): variant_id + modifiers snapshot na linha (Bestellung/Order)"
```

---

## Chunk 2: modelo + seed

### Task 2.1: schema Prisma + migração c1a3

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (+migração)

- [ ] **Step 1: Adicionar modelos** (master data) e estender Product/itens

```prisma
model ProductCategory {
  id        String    @id @default(cuid())
  tenantId  String
  name      String
  sortOrder Int       @default(0)
  active    Boolean   @default(true)
  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  products  Product[]
  @@map("product_categories")
}

model ProductVariant {
  id        String  @id @default(cuid())
  productId String
  name      String
  netCents  Int
  sortOrder Int     @default(0)
  active    Boolean @default(true)
  product   Product @relation(fields: [productId], references: [id])
  @@map("product_variants")
}

model ProductModifier {
  id        String  @id @default(cuid())
  productId String
  name      String
  netCents  Int
  sortOrder Int     @default(0)
  active    Boolean @default(true)
  product   Product @relation(fields: [productId], references: [id])
  @@map("product_modifiers")
}
```
Em `model Product` adicionar: `categoryId String?`, e relações `category ProductCategory? @relation(fields: [categoryId], references: [id])`, `variants ProductVariant[]`, `modifiers ProductModifier[]`.
Em `model BestellungItem` adicionar: `variantId String?`, `modifiers Json?`.
Em `model OrderItem` adicionar: `variantId String?`, `modifiers Json?`.

- [ ] **Step 2: Migração não-interativa**

```bash
cd apps/api
corepack pnpm exec prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script > /tmp/c1a3.sql
TS=$(date +%Y%m%d%H%M%S); DIR="prisma/migrations/${TS}_c1a3_varianten"
mkdir -p "$DIR"; cp /tmp/c1a3.sql "$DIR/migration.sql"
corepack pnpm exec prisma db execute --schema prisma/schema.prisma --file "$DIR/migration.sql"
corepack pnpm exec prisma migrate resolve --applied "${TS}_c1a3_varianten"
corepack pnpm exec prisma generate
```
Expected: CREATE product_categories/product_variants/product_modifiers + ALTER products/bestellung_items/order_items (ADD COLUMN). **Sem trigger novo** — master data é mutável; `variantId`/`modifiers` nas linhas fiscais são setados no INSERT.

- [ ] **Step 3: typecheck + commit**

Run: `corepack pnpm exec tsc --noEmit -p apps/api/tsconfig.json` → sem erros.
```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations
git commit -m "feat(db): ProductCategory/Variant/Modifier + variantId/modifiers nas linhas (INSERT)"
```

### Task 2.2: seed demo (Eisbecher S/M/L + extra Sahne)

**Files:**
- Modify: `apps/api/prisma/seed.ts`

- [ ] **Step 1: Implementar** — após o bloco de produtos demo:

```ts
  // Categoria + produto com variantes/modifiers (1a-3).
  const eis = await prisma.productCategory.upsert({
    where: { id: 'cat-eis' }, update: {}, create: { id: 'cat-eis', tenantId: TENANT_ID, name: 'Eis' },
  })
  const becher = await prisma.product.upsert({
    where: { id: 'prod-eisbecher' }, update: {},
    create: { id: 'prod-eisbecher', tenantId: TENANT_ID, name: 'Eisbecher', categoryId: eis.id, netCents: 450, mwstCodeImHaus: 'standard_19', mwstCodeAusserHaus: 'reduced_7' },
  })
  for (const [id, name, netCents, sortOrder] of [
    ['var-s', 'S', 300, 1], ['var-m', 'M', 450, 2], ['var-l', 'L', 600, 3],
  ] as const) {
    await prisma.productVariant.upsert({ where: { id }, update: {}, create: { id, productId: becher.id, name, netCents, sortOrder } })
  }
  await prisma.productModifier.upsert({
    where: { id: 'mod-sahne' }, update: {}, create: { id: 'mod-sahne', productId: becher.id, name: 'extra Sahne', netCents: 50 },
  })
```

- [ ] **Step 2: Reaplicar** → `corepack pnpm --filter @gelato/api db:seed` (idempotente).

- [ ] **Step 3: Commit** `git commit -am "feat(seed): Eisbecher com variantes S/M/L + modifier extra Sahne"`

---

## Chunk 3: API — products enriquecido + gravar metadado na linha

### Task 3.1: `GET /products` inclui variants/modifiers; addBestellung + ledger gravam

**Files:**
- Modify: `apps/api/src/products/products.service.ts`, `apps/api/src/tables/tables.service.ts`, `apps/api/src/pos/ledger.service.ts`
- Test: `apps/api/test/tables.e2e.test.ts`

- [ ] **Step 1: Write the failing test** (adicionar ao describe de tables)

```ts
it('records a bestellung line with variant + modifiers (combined unitNet)', async () => {
  const products = (await (await get(`/products`)).json()) as { id: string; variants?: { id: string; netCents: number }[]; modifiers?: { id: string; netCents: number }[] }[]
  const becher = products.find((p) => p.id === 'prod-eisbecher')!
  expect(becher.variants?.length).toBe(3)
  const tisch = `tisch-${crypto.randomUUID().slice(0, 8)}`
  await prisma.tisch.create({ data: { id: tisch, betriebsstaetteId: 'demo-bs', name: 'var' } })
  const sessionId = ((await (await post(`/pos/tables/${tisch}/open`, { kasse_id: 'demo-kasse' })).json()) as { id: string }).id
  // Eisbecher L (600) + extra Sahne (50) = 650
  await post(`/pos/sessions/${sessionId}/bestellung`, await signedBestellung(sessionId, [
    { product_id: 'prod-eisbecher', variant_id: 'var-l', qty: 1, unit_net: 650, mwst_rate: 0.19, mwst_code: 'standard_19', modifiers: [{ id: 'mod-sahne', name: 'extra Sahne', net: 50 }] },
  ]))
  const item = await prisma.bestellungItem.findFirst({ where: { variantId: 'var-l' }, orderBy: { id: 'desc' } })
  expect(item?.unitNet).toBe(650)
  expect(item?.modifiers).toBeTruthy()
})
```
> Ajustar a helper `signedBestellung` do arquivo para repassar os campos extras dos itens (já recebe `items` cru — confirmar que o tipo aceita `variant_id`/`modifiers`; se for tipado estrito, alargar o tipo do parâmetro).

- [ ] **Step 2: Run** → FAIL (GET /products sem variants; item sem variantId/modifiers).

- [ ] **Step 3: products.service.list inclui catálogo**

```ts
  list(tenantId: string) {
    return this.prisma.product.findMany({
      where: { tenantId, active: true },
      orderBy: { name: 'asc' },
      include: {
        variants: { where: { active: true }, orderBy: { sortOrder: 'asc' }, select: { id: true, name: true, netCents: true } },
        modifiers: { where: { active: true }, orderBy: { sortOrder: 'asc' }, select: { id: true, name: true, netCents: true } },
      },
    })
  }
```
(O `categoryId` já vem por padrão no findMany.)

- [ ] **Step 4: addBestellung grava variantId/modifiers**

Em `tables.service.ts`, no `items: { create: event.items.map(...) }` do `bestellung.create`, adicionar:
```ts
              variantId: i.variant_id,
              modifiers: i.modifiers as Prisma.InputJsonValue | undefined,
```
(importar `type Prisma` de `@prisma/client`.)

- [ ] **Step 5: ledger grava variantId/modifiers no order_item**

Em `ledger.service.ts`, no `items: { create: p.items.map((i) => ({ ... })) }`, adicionar:
```ts
              variantId: i.variant_id,
              modifiers: i.modifiers as Prisma.InputJsonValue | undefined,
```
(o `Prisma` já é importado no ledger.)

- [ ] **Step 6: Run + typecheck**

Run: `corepack pnpm --filter @gelato/api exec vitest run test/tables.e2e.test.ts` → PASS.
Run: `corepack pnpm exec tsc --noEmit -p apps/api/tsconfig.json` → sem erros.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/products apps/api/src/tables apps/api/src/pos/ledger.service.ts apps/api/test/tables.e2e.test.ts
git commit -m "feat(api): GET /products com variants/modifiers; grava variantId/modifiers na linha (INSERT)"
```

---

## Chunk 4: pos-web — seletor de variante/modifier

### Task 4.1: ApiProduct + fluxo de Bestellung com variante/modifier

**Files:**
- Modify: `apps/pos-web/src/api.ts`, `apps/pos-web/src/TischPanel.tsx`

- [ ] **Step 1:** Em `api.ts`, estender `ApiProduct`:
```ts
export interface ApiProduct {
  id: string
  name: string
  netCents: number
  mwstCodeImHaus: string
  mwstCodeAusserHaus: string
  categoryId?: string | null
  variants?: { id: string; name: string; netCents: number }[]
  modifiers?: { id: string; name: string; netCents: number }[]
}
```

- [ ] **Step 2:** Em `TischPanel.tsx`, na função `fire(p)`: se o produto tem `variants`, escolher uma (prompt/select pelo nome) e oferecer toggles de modifiers (prompt simples p/ a espinha); montar a linha via `buildSaleLine({ baseNetCents: p.netCents, mwstCode: p.mwstCodeImHaus }, variant ? { netCents: variant.netCents } : undefined, chosenModifiers.map((m) => ({ id: m.id, name: m.name, net: m.netCents })))`; enviar `variant_id` + `modifiers` no item da Bestellung (`unit_net = saleLine.unitNet`). Import `buildSaleLine` de `@gelato/compliance`.

> Manter mínimo (prompt-based ok p/ a espinha). UI rica = depois. Build-only; verificação visual ao vivo = sessão interativa.

- [ ] **Step 3: typecheck + build**

Run: `corepack pnpm exec tsc --noEmit -p apps/pos-web/tsconfig.json` → sem erros.
Run: `corepack pnpm --filter @gelato/pos-web build` → ok.

- [ ] **Step 4: Commit** `git commit -am "feat(pos-web): seletor de variante/modifier no fluxo de Bestellung"`

---

## Chunk 5: capstone + verificação

### Task 5.1: capstone variante+modifier

**Files:**
- Create: `apps/api/test/varianten-capstone.e2e.test.ts`

- [ ] **Step 1: Write the failing test** — mesa única por run → Bestellung de Eisbecher L (var-l, 600) + extra Sahne (mod-sahne, 50) → afirma: `BestellungItem.unitNet = 650`, `variantId = 'var-l'`, `modifiers` JSON com o snapshot; conta (`GET session`) total reflete 650→bruto 19%; pagar → Kassenbeleg; `bestellung_items` append-only (UPDATE rejeitado).

- [ ] **Step 2: Run** → ajustar → PASS.

- [ ] **Step 3: Suíte completa** `corepack pnpm -r test` → tudo verde.

- [ ] **Step 4: Commit** `git add apps/api/test/varianten-capstone.e2e.test.ts && git commit -m "test(api): capstone variante+modifier (Eisbecher L + extra Sahne = 650, append-only)"`

---

## Definition of Done (fatia 1a-3)

- [ ] `buildSaleLine` compõe a linha (variante absoluta + Σ modifiers, MwSt herdada) — testado.
- [ ] `variant_id`/`modifiers` no schema (Bestellung/Order) — testado.
- [ ] Modelos Category/Variant/Modifier (mutáveis) + `variantId`/`modifiers Json` nas linhas (no INSERT) — migração/typecheck.
- [ ] `GET /products` traz variants/modifiers; Bestellung grava o metadado; conta reflete o net combinado — e2e.
- [ ] pos-web monta a linha com variante/modifier (compila/builda).
- [ ] Capstone: Eisbecher L + extra Sahne = 650, gravado, append-only; `corepack pnpm -r test` verde.

## Riscos / validação externa (rastrear)

- Representação canônica de variantes/modificadores na **DSFinV-K** (hoje dobram no net da linha do `bonpos`; subitems = futuro) → DFKA/Steuerberater.
- Validação server-side do `unit_net` contra o catálogo (hoje confia no terminal, como o fluxo existente) — nota futura.
