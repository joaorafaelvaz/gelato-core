import { Injectable } from '@nestjs/common'
import type { Prisma } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { computeDayTotals, type DayTotals } from '@gelato/compliance'
import { applyRate } from '@gelato/domain'

type Db = Prisma.TransactionClient

export interface ZResult {
  id: string
  kasseId: string
  seqNr: number
  coveredFrom: Date
  coveredTo: Date
  totals: DayTotals
}

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Totais de um período [from, to) por Kasse, computados sobre o ledger. */
  async periodTotals(kasseId: string, from: Date, to: Date, db: Db = this.prisma): Promise<DayTotals> {
    const itemRows = await db.$queryRaw<{ mwstRate: string; net: bigint }[]>`
      SELECT oi."mwstRate"::text AS "mwstRate", COALESCE(SUM(oi."unitNet" * oi.qty), 0)::bigint AS net
      FROM order_items oi JOIN orders o ON oi."orderId" = o.id
      WHERE o."kasseId" = ${kasseId} AND o.ts >= ${from} AND o.ts < ${to}
      GROUP BY oi."mwstRate"`
    const lines = itemRows.map((r) => {
      const rate = Number(r.mwstRate)
      const net = Number(r.net)
      return { mwstRate: rate, net, gross: net + applyRate(net, rate) }
    })

    const payRows = await db.$queryRaw<{ method: string; amount: bigint }[]>`
      SELECT p.method, COALESCE(SUM(p.amount), 0)::bigint AS amount
      FROM payments p JOIN orders o ON p."orderId" = o.id
      WHERE o."kasseId" = ${kasseId} AND o.ts >= ${from} AND o.ts < ${to}
      GROUP BY p.method`
    const payments = payRows.map((r) => ({ method: r.method, amount: Number(r.amount) }))

    const receiptCount = await db.order.count({ where: { kasseId, ts: { gte: from, lt: to } } })
    const prior = await db.order.aggregate({ _sum: { totalGross: true }, where: { kasseId, ts: { lt: from } } })

    // stornoCount = 0 no 1b (modelo OrderStorno entra na fatia 1a/posterior)
    return computeDayTotals({
      lines,
      payments,
      receiptCount,
      stornoCount: 0,
      priorGrandTotal: prior._sum.totalGross ?? 0,
    })
  }

  /** X-Bericht: snapshot read-only do período desde o último Z (NÃO persiste, sem número). */
  async snapshotX(kasseId: string): Promise<{ coveredFrom: Date; coveredTo: Date; totals: DayTotals }> {
    const last = await this.prisma.zReport.findFirst({ where: { kasseId }, orderBy: { seqNr: 'desc' } })
    const from = last?.coveredTo ?? new Date(0)
    const to = new Date()
    return { coveredFrom: from, coveredTo: to, totals: await this.periodTotals(kasseId, from, to) }
  }

  /** Z-Bericht: numera (Z-Nr contínuo por Kasse, serializado) + persiste (append-only). */
  async createZ(kasseId: string, userId: string): Promise<ZResult> {
    return this.prisma.$transaction(async (tx) => {
      // serializa a geração de Z por Kasse — sem gaps/duplicatas sob concorrência
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${kasseId}, 0))`
      const last = await tx.zReport.findFirst({ where: { kasseId }, orderBy: { seqNr: 'desc' } })
      const seqNr = (last?.seqNr ?? 0) + 1
      const from = last?.coveredTo ?? new Date(0)
      const to = new Date()
      const totals = await this.periodTotals(kasseId, from, to, tx)
      const z = await tx.zReport.create({
        data: {
          kasseId,
          seqNr,
          coveredFrom: from,
          coveredTo: to,
          businessDay: to,
          totals: totals as unknown as Prisma.InputJsonValue,
        },
      })
      await tx.auditLog.create({
        data: { userId, action: 'pos.report.z', entity: 'z_report', entityId: z.id, payload: { seqNr } },
      })
      return { id: z.id, kasseId, seqNr, coveredFrom: from, coveredTo: to, totals }
    })
  }
}
