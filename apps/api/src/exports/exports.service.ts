import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ExportsService {
  constructor(private readonly prisma: PrismaService) {}

  private dayBounds(day: string) {
    const start = new Date(`${day}T00:00:00.000Z`);
    const end = new Date(`${day}T23:59:59.999Z`);
    if (Number.isNaN(start.getTime())) {
      throw new BadRequestException('Invalid businessDay format, use YYYY-MM-DD');
    }
    return { start, end };
  }

  async dsfinvk(tenantId: string, businessDay: string) {
    const { start, end } = this.dayBounds(businessDay);

    const orders = await this.prisma.order.findMany({
      where: {
        kasse: { betriebsstaette: { tenantId } },
        status: 'CLOSED',
        createdAt: { gte: start, lte: end },
      },
      include: {
        kasse: true,
        items: true,
        payments: true,
        receipt: true,
        tseTx: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    const rows = orders.map((o) => {
      const tse = o.tseTx;
      const firstItem = o.items[0];
      return {
        KassenID: o.kasseId,
        Bonnummer: o.id,
        DatumUhrzeit: o.createdAt.toISOString(),
        Brutto: o.totalGross.toString(),
        Netto: o.totalNet.toString(),
        Mwst: o.totalMwst.toString(),
        Zahlungsarten: o.payments.map((p) => `${p.method}:${p.amount.toString()}`).join('|'),
        TseSeriennummer: tse ? tse.tseClientId : 'TSE-AUSFALL',
        TseTransaktionsnummer: tse ? tse.txNumber : '',
        TseSignaturzaehler: tse ? tse.signatureCounter : '',
        TseStartzeit: tse ? tse.startTime.toISOString() : '',
        TseLogzeit: tse ? tse.logTime.toISOString() : '',
        ArtikelAnzahl: o.items.reduce((sum, i) => sum + Number(i.qty), 0),
        ErsterArtikel: firstItem ? firstItem.productId : '',
      };
    });

    const headers = Object.keys(rows[0] ?? {});
    const csv = [
      headers.join(';'),
      ...rows.map((r) => headers.map((h) => String((r as any)[h] ?? '')).join(';')),
    ].join('\n');

    return { filename: `DSFinV-K_${tenantId}_${businessDay}.csv`, content: csv };
  }

  async kassenabschluss(kasseId: string, businessDay: string) {
    const kasse = await this.prisma.kasse.findUnique({
      where: { id: kasseId },
      include: { betriebsstaette: true, tseClient: true },
    });
    if (!kasse) throw new NotFoundException('Kasse not found');

    const { start, end } = this.dayBounds(businessDay);

    const orders = await this.prisma.order.findMany({
      where: {
        kasseId,
        status: 'CLOSED',
        createdAt: { gte: start, lte: end },
      },
      include: { payments: true },
    });

    const totalGross = orders.reduce((s, o) => s + Number(o.totalGross), 0);
    const byMethod: Record<string, number> = {};
    for (const o of orders) {
      for (const p of o.payments) {
        byMethod[p.method] = (byMethod[p.method] ?? 0) + Number(p.amount);
      }
    }

    return {
      kasseId,
      businessDay,
      orderCount: orders.length,
      totalGross,
      byMethod,
      tseSerial: kasse.tseClient?.serialNumber ?? 'TSE-AUSFALL',
      generatedAt: new Date().toISOString(),
    };
  }
}
