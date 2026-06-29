import type { Prisma } from '@prisma/client'
import { earnFromSale } from '@gelato/compliance'

/** Ganho de fidelidade na venda. Roda DENTRO da transação da Order (idempotente). */
export async function earnLoyalty(
  tx: Prisma.TransactionClient,
  params: { kasseId: string; customerId: string; grossCents: number; itemCount: number; orderId: string },
): Promise<void> {
  const kasse = await tx.kasse.findUnique({ where: { id: params.kasseId }, include: { betriebsstaette: true } })
  if (!kasse) return
  const tenantId = kasse.betriebsstaette.tenantId
  const program = await tx.loyaltyProgram.findUnique({ where: { tenantId } })
  if (!program || !program.active) return
  const { points, stamps } = earnFromSale(params.grossCents, params.itemCount, { pointsPerEuro: program.pointsPerEuro, stampsPerItem: program.stampsPerItem })
  if (points === 0 && stamps === 0) return
  await tx.loyaltyEntry.create({ data: { tenantId, customerId: params.customerId, kind: 'earn', points, stamps, refType: 'order', refId: params.orderId } })
}
