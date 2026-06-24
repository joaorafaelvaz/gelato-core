import { BadRequestException, Injectable } from '@nestjs/common'
import type { Prisma } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import type { SaleEvent } from '@gelato/domain'

export interface Actor {
  userId?: string
  ip?: string
  device?: string
}

export interface IngestResult {
  duplicate: boolean
  orderId: string
}

/**
 * Persiste uma venda no ledger imutável de forma ATÔMICA e IDEMPOTENTE.
 * A app conecta como gelato_app (só INSERT em tabelas fiscais), então isto
 * apenas insere — nunca atualiza/deleta. Correção = Storno (Ciclo 1).
 */
@Injectable()
export class LedgerService {
  constructor(private readonly prisma: PrismaService) {}

  async ingest(event: SaleEvent, actor: Actor): Promise<IngestResult> {
    // Idempotência: se o evento já foi processado, no-op.
    const seen = await this.prisma.syncEvent.findUnique({
      where: { clientEventId: event.client_event_id },
    })
    if (seen) {
      const existing = await this.prisma.order.findUnique({
        where: { clientEventId: event.client_event_id },
      })
      return { duplicate: true, orderId: existing?.id ?? '' }
    }

    const p = event.payload
    const te = p.tse_transaction
    // Extrai para locais: o narrowing de propriedades não sobrevive ao closure abaixo.
    const signatureValue = te.signature_value
    const signatureCounter = te.signature_counter
    const logTime = te.log_time
    if (!signatureValue || signatureCounter == null || !logTime) {
      throw new BadRequestException('incomplete TSE transaction data')
    }

    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.create({
        data: {
          clientEventId: event.client_event_id,
          kasseId: event.kasse_id,
          mode: p.order.mode,
          tableId: p.order.table_id,
          totalNet: p.order.total_net,
          totalMwst: p.order.total_mwst,
          totalGross: p.order.total_gross,
          customerId: p.order.customer_id,
          items: {
            create: p.items.map((i) => ({
              productId: i.product_id,
              qty: i.qty,
              unitNet: i.unit_net,
              mwstRate: i.mwst_rate,
              mwstCode: i.mwst_code,
            })),
          },
          payments: {
            create: [{ method: p.payment.method, amount: p.payment.amount, ref: p.payment.ref }],
          },
          receipt: {
            create: {
              format: p.receipt.format ?? 'digital',
              tseSignature: te as unknown as Prisma.InputJsonValue,
              qrPayload: p.receipt.qr_payload,
            },
          },
          tseTransaction: {
            create: {
              txNumber: te.tx_number,
              signatureCounter,
              signatureValue,
              logTime: new Date(logTime),
              processType: te.process_type ?? 'Kassenbeleg-V1',
              serialNumber: te.serial_number,
              publicKey: te.public_key,
            },
          },
        },
      })

      await tx.syncEvent.create({
        data: { clientEventId: event.client_event_id, kasseId: event.kasse_id, type: event.type },
      })

      await tx.auditLog.create({
        data: {
          userId: actor.userId,
          action: 'sale.create',
          entity: 'order',
          entityId: order.id,
          payload: { totalGross: p.order.total_gross, mode: p.order.mode },
          ip: actor.ip,
          device: actor.device,
        },
      })

      return { duplicate: false, orderId: order.id }
    })
  }
}
