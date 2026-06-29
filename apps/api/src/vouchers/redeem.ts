import type { Prisma } from '@prisma/client'

interface SaleItem {
  unit_net: number
  qty: number
  mwst_rate: number
}

/** Grava a trilha de resgate de um voucher na venda. Roda DENTRO da transação da Order. */
export async function recordVoucherRedemption(
  tx: Prisma.TransactionClient,
  params: { kasseId: string; code: string; orderId: string; customerId?: string; items: SaleItem[] },
): Promise<void> {
  const kasse = await tx.kasse.findUnique({ where: { id: params.kasseId }, include: { betriebsstaette: true } })
  if (!kasse) return
  const tenantId = kasse.betriebsstaette.tenantId
  const voucher = await tx.voucher.findFirst({ where: { tenantId, code: params.code } })
  if (!voucher) return
  const discountCents = Math.abs(
    params.items.filter((i) => i.unit_net < 0).reduce((s, i) => s + Math.round(i.unit_net * (1 + i.mwst_rate)) * i.qty, 0),
  )
  await tx.voucherRedemption.create({ data: { tenantId, voucherId: voucher.id, orderId: params.orderId, customerId: params.customerId, discountCents } })
}
