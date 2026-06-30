import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

interface MwstBucket {
  rate: string;
  net: Decimal;
  mwst: Decimal;
  gross: Decimal;
}

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private dayBounds(day: string) {
    const start = new Date(`${day}T00:00:00.000Z`);
    const end = new Date(`${day}T23:59:59.999Z`);
    if (Number.isNaN(start.getTime())) {
      throw new BadRequestException('Invalid businessDay format, use YYYY-MM-DD');
    }
    return { start, end };
  }

  private businessDayStr(d: Date) {
    return d.toISOString().split('T')[0];
  }

  async xReport(kasseId: string, businessDay?: string) {
    const kasse = await this.prisma.kasse.findUnique({
      where: { id: kasseId },
      include: { betriebsstaette: true },
    });
    if (!kasse) throw new NotFoundException('Kasse not found');

    const day = businessDay ?? this.businessDayStr(new Date());
    const { start, end } = this.dayBounds(day);

    const orders = await this.prisma.order.findMany({
      where: {
        kasseId,
        status: 'CLOSED',
        createdAt: { gte: start, lte: end },
      },
      include: { items: true, payments: true, tseTx: true },
    });

    const totals = this.aggregate(orders);

    return {
      type: 'X_REPORT',
      kasseId,
      businessDay: day,
      generatedAt: new Date().toISOString(),
      isSnapshot: true,
      ...totals,
    };
  }

  async zReport(kasseId: string, shiftId?: string) {
    const kasse = await this.prisma.kasse.findUnique({
      where: { id: kasseId },
      include: { betriebsstaette: true },
    });
    if (!kasse) throw new NotFoundException('Kasse not found');

    const shift = shiftId
      ? await this.prisma.shift.findUnique({ where: { id: shiftId } })
      : await this.prisma.shift.findFirst({
          where: { kasseId, closedAt: null },
          orderBy: { openedAt: 'desc' },
        });

    if (!shift) {
      throw new BadRequestException('No open shift found for Z-report');
    }
    if (shift.zReportId) {
      throw new BadRequestException('Z-report already generated for this shift');
    }

    const orders = await this.prisma.order.findMany({
      where: {
        kasseId,
        shiftId: shift.id,
        status: 'CLOSED',
      },
      include: { items: true, payments: true, tseTx: true },
    });

    const totals = this.aggregate(orders);
    const businessDay = this.businessDayStr(shift.openedAt);

    const last = await this.prisma.zReport.findFirst({
      where: { kasseId },
      orderBy: { seqNr: 'desc' },
      select: { seqNr: true },
    });
    const seqNr = (last?.seqNr ?? 0) + 1;

    const zReport = await this.prisma.zReport.create({
      data: {
        kasseId,
        seqNr,
        businessDay: new Date(businessDay),
        totals: totals as any,
      },
    });

    await this.prisma.shift.update({
      where: { id: shift.id },
      data: { zReportId: zReport.id, closedAt: new Date() },
    });

    await this.audit.log({
      tenantId: kasse.betriebsstaette.tenantId,
      action: 'pos.report.z',
      entity: 'z_report',
      entityId: zReport.id,
      payload: { kasseId, shiftId: shift.id, seqNr, businessDay },
    });

    return {
      type: 'Z_REPORT',
      zReportId: zReport.id,
      seqNr,
      kasseId,
      shiftId: shift.id,
      businessDay,
      generatedAt: zReport.generatedAt.toISOString(),
      ...totals,
    };
  }

  async listZReports(kasseId: string) {
    return this.prisma.zReport.findMany({
      where: { kasseId },
      orderBy: { seqNr: 'desc' },
      include: { shift: { select: { id: true, openedAt: true, closedAt: true } } },
    });
  }

  private aggregate(orders: any[]) {
    let totalNet = new Decimal(0);
    let totalMwst = new Decimal(0);
    let totalGross = new Decimal(0);
    const mwstBuckets: Record<string, MwstBucket> = {};
    const payments: Record<string, Decimal> = {};
    let ausfallCount = 0;
    let stornoCount = 0;

    for (const order of orders) {
      if (order.status === 'VOIDED') {
        stornoCount++;
        continue;
      }
      totalNet = totalNet.plus(order.totalNet.toString());
      totalMwst = totalMwst.plus(order.totalMwst.toString());
      totalGross = totalGross.plus(order.totalGross.toString());

      if (order.tseTx?.isAusfall) ausfallCount++;

      for (const item of order.items ?? []) {
        const rate = item.mwstRate.toFixed(2);
        if (!mwstBuckets[rate]) {
          mwstBuckets[rate] = { rate, net: new Decimal(0), mwst: new Decimal(0), gross: new Decimal(0) };
        }
        mwstBuckets[rate].net = mwstBuckets[rate].net.plus(item.totalNet.toString());
        mwstBuckets[rate].mwst = mwstBuckets[rate].mwst.plus(
          new Decimal(item.totalGross.toString()).minus(item.totalNet.toString()),
        );
        mwstBuckets[rate].gross = mwstBuckets[rate].gross.plus(item.totalGross.toString());
      }

      for (const payment of order.payments ?? []) {
        const method = payment.method;
        payments[method] = (payments[method] ?? new Decimal(0)).plus(payment.amount.toString());
      }
    }

    const toNum = (d: Decimal) => d.toNumber();

    return {
      orderCount: orders.filter((o) => o.status === 'CLOSED').length,
      stornoCount,
      ausfallCount,
      totalNet: toNum(totalNet),
      totalMwst: toNum(totalMwst),
      totalGross: toNum(totalGross),
      mwstByRate: Object.values(mwstBuckets).map((b) => ({
        rate: b.rate,
        net: toNum(b.net),
        mwst: toNum(b.mwst),
        gross: toNum(b.gross),
      })),
      paymentsByMethod: Object.entries(payments).map(([method, amount]) => ({
        method,
        amount: toNum(amount),
      })),
    };
  }
}
