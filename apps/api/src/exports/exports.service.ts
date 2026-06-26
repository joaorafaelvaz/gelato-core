import { Injectable, NotFoundException } from '@nestjs/common'
import JSZip from 'jszip'
import { buildDsfinvkPackage, type DsfinvkInput, type ZClosing, type Bon } from '@gelato/compliance'
import type { DayTotals } from '@gelato/compliance'
import { applyRate } from '@gelato/domain'
import { PrismaService } from '../prisma/prisma.service'

@Injectable()
export class ExportsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Lista de Kassen do tenant (para o seletor do backoffice). */
  async kassen(tenantId: string): Promise<{ id: string; name: string }[]> {
    return this.prisma.kasse.findMany({
      where: { betriebsstaette: { tenantId } },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    })
  }

  /** Monta o dataset normalizado da Kasse no intervalo, ancorado nos Z-Berichte. */
  async dsfinvkInput(tenantId: string, kasseId: string, from: Date, to: Date): Promise<DsfinvkInput> {
    const kasse = await this.prisma.kasse.findFirst({
      where: { id: kasseId, betriebsstaette: { tenantId } },
      include: { tseClient: true, betriebsstaette: true },
    })
    if (!kasse) throw new NotFoundException('kasse not found')

    const taxRates = await this.prisma.taxRate.findMany({ where: { tenantId } })
    const zReports = await this.prisma.zReport.findMany({
      where: { kasseId, businessDay: { gte: from, lte: to } },
      orderBy: { seqNr: 'asc' },
    })

    const zClosings: ZClosing[] = []
    for (const z of zReports) {
      const orders = await this.prisma.order.findMany({
        where: { kasseId, ts: { gte: z.coveredFrom, lt: z.coveredTo } },
        include: { items: true, payments: true, tseTransaction: true },
        orderBy: { ts: 'asc' },
      })
      const bons: Bon[] = orders.map((o, i) => {
        const vatMap = new Map<number, { net: number; ust: number; gross: number }>()
        const lines = o.items.map((it, idx) => {
          const rate = Number(it.mwstRate)
          const lineNet = it.unitNet * it.qty
          const ust = applyRate(lineNet, rate)
          const g = vatMap.get(rate) ?? { net: 0, ust: 0, gross: 0 }
          g.net += lineNet
          g.ust += ust
          g.gross += lineNet + ust
          vatMap.set(rate, g)
          return {
            zeile: idx + 1,
            text: it.productId,
            qty: it.qty,
            unitGross: it.unitNet + applyRate(it.unitNet, rate),
            lineGross: lineNet + ust,
            rate,
            net: lineNet,
            ust,
          }
        })
        const te = o.tseTransaction
        return {
          bonId: o.id,
          bonNr: i + 1,
          type: 'Beleg',
          start: o.ts.toISOString(),
          end: o.ts.toISOString(),
          net: o.totalNet,
          gross: o.totalGross,
          vat: [...vatMap.entries()].map(([rate, g]) => ({ rate, ...g })),
          payments: o.payments.map((p) => ({
            type: p.method === 'cash' ? 'Bar' : 'Unbar',
            name: p.method,
            currency: 'EUR',
            amount: p.amount,
          })),
          lines,
          tse: {
            id: te?.id ?? '',
            taNr: te?.txNumber ?? undefined,
            start: te?.logTime?.toISOString(),
            end: te?.logTime?.toISOString(),
            sigCounter: te?.signatureCounter ?? undefined,
            signature: te?.signatureValue ?? undefined,
            isAusfall: te?.isAusfall ?? false,
          },
        }
      })
      zClosings.push({
        zNr: z.seqNr,
        businessDay: z.businessDay.toISOString(),
        createdAt: z.generatedAt.toISOString(),
        totals: z.totals as unknown as DayTotals,
        bons,
      })
    }

    return {
      kasse: {
        id: kasse.id,
        name: kasse.name,
        serialNr: kasse.tseClient?.serialNr ?? undefined,
        swVersion: undefined,
      },
      location: {
        name: kasse.betriebsstaette.name,
        street: kasse.betriebsstaette.address ?? undefined,
        country: 'DEU',
        ustId: undefined,
      },
      tse: {
        id: kasse.tseClient?.id ?? '',
        serial: kasse.tseClient?.serialNr ?? undefined,
        publicKey: kasse.tseClient?.publicKey ?? undefined,
        sigAlgo: 'ecdsa-plain-SHA256',
        timeFormat: 'utcTime',
      },
      taxRates: taxRates.map((t) => ({ code: t.code, rate: Number(t.rate), description: t.code })),
      zClosings,
    }
  }

  /** Pacote DSFinV-K zipado (Buffer). Read-only. */
  async dsfinvkZip(tenantId: string, kasseId: string, from: Date, to: Date): Promise<Buffer> {
    const input = await this.dsfinvkInput(tenantId, kasseId, from, to)
    const files = buildDsfinvkPackage(input)
    const zip = new JSZip()
    for (const f of files) zip.file(f.filename, f.content)
    return zip.generateAsync({ type: 'nodebuffer' })
  }
}
