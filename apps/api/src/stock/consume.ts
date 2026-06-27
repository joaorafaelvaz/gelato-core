import type { Prisma } from '@prisma/client'
import { aggregateConsumption, type SoldLine } from '@gelato/compliance'

export interface SaleLine {
  productId: string
  variantId?: string | null
  qty: number
}

/**
 * Decrementa o estoque conforme as receitas das linhas vendidas/produzidas.
 * Roda DENTRO da transação da venda (recebe o tx) → atômico e idempotente
 * (só é chamado no caminho de criação). Linhas sem receita ativa não baixam.
 * Storno (qty negativa) devolve estoque. Estoque pode ir a negativo.
 */
export async function consumeForSale(
  tx: Prisma.TransactionClient,
  params: { kasseId: string; lines: SaleLine[]; refType: 'bestellung' | 'order'; refId: string },
): Promise<void> {
  const kasse = await tx.kasse.findUnique({ where: { id: params.kasseId }, include: { betriebsstaette: true } })
  if (!kasse) return
  const tenantId = kasse.betriebsstaette.tenantId

  const productIds = [...new Set(params.lines.map((l) => l.productId))]
  const recipes = await tx.recipe.findMany({
    where: { tenantId, active: true, productId: { in: productIds } },
    include: { ingredients: true },
  })
  const key = (p: string, v: string | null) => `${p}|${v ?? ''}`
  const byKey = new Map(recipes.map((r) => [key(r.productId, r.variantId), r.ingredients.map((i) => ({ stockItemId: i.stockItemId, qty: i.qty }))]))

  const soldLines: SoldLine[] = []
  for (const l of params.lines) {
    const ingredients = byKey.get(key(l.productId, l.variantId ?? null))
    if (ingredients) soldLines.push({ ingredients, qtySold: l.qty })
  }
  if (soldLines.length === 0) return

  for (const c of aggregateConsumption(soldLines)) {
    if (c.qty === 0) continue
    await tx.stockMovement.create({
      data: { tenantId, stockItemId: c.stockItemId, type: 'consume', qtyDelta: -c.qty, refType: params.refType, refId: params.refId },
    })
  }
}
