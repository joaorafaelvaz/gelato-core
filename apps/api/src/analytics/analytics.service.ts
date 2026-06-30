import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async dashboard(tenantId: string, days = 30) {
    const since = new Date();
    since.setDate(since.getDate() - days);

    const [salesByDay, topProducts, summary, paymentBreakdown, salesByHour, salesByBranch] = await Promise.all([
      this.salesByDay(tenantId, since),
      this.topProducts(tenantId, since, 10),
      this.summary(tenantId, since),
      this.paymentBreakdown(tenantId, since),
      this.salesByHour(tenantId, since),
      this.salesByBranch(tenantId, since),
    ]);

    return {
      range: { from: since.toISOString(), to: new Date().toISOString(), days },
      summary,
      salesByDay,
      topProducts,
      paymentBreakdown,
      salesByHour,
      salesByBranch,
    };
  }

  private async summary(tenantId: string, since: Date) {
    const closed = await this.prisma.order.findMany({
      where: {
        kasse: { betriebsstaette: { tenantId } },
        status: 'CLOSED',
        createdAt: { gte: since },
      },
      select: { totalGross: true, totalNet: true, totalMwst: true },
    });
    const count = closed.length;
    const gross = closed.reduce((s, o) => s + Number(o.totalGross), 0);
    const net = closed.reduce((s, o) => s + Number(o.totalNet), 0);
    const mwst = closed.reduce((s, o) => s + Number(o.totalMwst), 0);
    return {
      orderCount: count,
      totalGross: Math.round(gross * 100) / 100,
      totalNet: Math.round(net * 100) / 100,
      totalMwst: Math.round(mwst * 100) / 100,
      avgOrderValue: count > 0 ? Math.round((gross / count) * 100) / 100 : 0,
    };
  }

  private async salesByDay(tenantId: string, since: Date) {
    const rows = await this.prisma.$queryRaw<
      Array<{ day: string; gross: number; count: number }>
    >(Prisma.sql`
      SELECT
        DATE(o.created_at) AS day,
        SUM(o.total_gross) AS gross,
        COUNT(*)::int AS count
      FROM orders o
      JOIN kassen k ON o.kasse_id = k.id
      JOIN betriebsstaetten b ON k.betriebsstaette_id = b.id
      WHERE b.tenant_id = ${tenantId}
        AND o.status = 'CLOSED'
        AND o.created_at >= ${since}
      GROUP BY DATE(o.created_at)
      ORDER BY day ASC
    `);

    return rows.map((r) => ({
      day: typeof r.day === 'string' ? r.day : new Date(r.day as any).toISOString().slice(0, 10),
      gross: Number(r.gross),
      count: r.count,
    }));
  }

  private async topProducts(tenantId: string, since: Date, limit: number) {
    const rows = await this.prisma.$queryRaw<
      Array<{ productid: string; productname: string; qty: number; revenue: number }>
    >(Prisma.sql`
      SELECT
        oi.product_id AS productid,
        p.name AS productname,
        SUM(oi.qty)::float AS qty,
        SUM(oi.total_gross) AS revenue
      FROM order_items oi
      JOIN orders o ON oi.order_id = o.id
      JOIN products p ON oi.product_id = p.id
      JOIN kassen k ON o.kasse_id = k.id
      JOIN betriebsstaetten b ON k.betriebsstaette_id = b.id
      WHERE b.tenant_id = ${tenantId}
        AND o.status = 'CLOSED'
        AND o.created_at >= ${since}
      GROUP BY oi.product_id, p.name
      ORDER BY revenue DESC
      LIMIT ${limit}
    `);

    return rows.map((r) => ({
      productId: r.productid,
      productName: r.productname,
      qty: Number(r.qty),
      revenue: Number(r.revenue),
    }));
  }

  private async paymentBreakdown(tenantId: string, since: Date) {
    const rows = await this.prisma.$queryRaw<
      Array<{ method: string; total: number }>
    >(Prisma.sql`
      SELECT
        pay.method,
        SUM(pay.amount) AS total
      FROM payments pay
      JOIN orders o ON pay.order_id = o.id
      JOIN kassen k ON o.kasse_id = k.id
      JOIN betriebsstaetten b ON k.betriebsstaette_id = b.id
      WHERE b.tenant_id = ${tenantId}
        AND o.status = 'CLOSED'
        AND o.created_at >= ${since}
      GROUP BY pay.method
      ORDER BY total DESC
    `);

    return rows.map((r) => ({
      method: r.method,
      total: Number(r.total),
    }));
  }

  private async salesByHour(tenantId: string, since: Date) {
    const rows = await this.prisma.$queryRaw<
      Array<{ hour: number; gross: number; count: number }>
    >(Prisma.sql`
      SELECT
        EXTRACT(HOUR FROM o.created_at)::int AS hour,
        SUM(o.total_gross) AS gross,
        COUNT(*)::int AS count
      FROM orders o
      JOIN kassen k ON o.kasse_id = k.id
      JOIN betriebsstaetten b ON k.betriebsstaette_id = b.id
      WHERE b.tenant_id = ${tenantId}
        AND o.status = 'CLOSED'
        AND o.created_at >= ${since}
      GROUP BY hour
      ORDER BY hour ASC
    `);

    return rows.map((r) => ({
      hour: r.hour,
      gross: Number(r.gross),
      count: r.count,
    }));
  }

  private async salesByBranch(tenantId: string, since: Date) {
    const rows = await this.prisma.$queryRaw<
      Array<{ branchid: string; branchname: string; gross: number; count: number }>
    >(Prisma.sql`
      SELECT
        b.id AS branchid,
        b.name AS branchname,
        SUM(o.total_gross) AS gross,
        COUNT(*)::int AS count
      FROM orders o
      JOIN kassen k ON o.kasse_id = k.id
      JOIN betriebsstaetten b ON k.betriebsstaette_id = b.id
      WHERE b.tenant_id = ${tenantId}
        AND o.status = 'CLOSED'
        AND o.created_at >= ${since}
      GROUP BY b.id, b.name
      ORDER BY gross DESC
    `);

    return rows.map((r) => ({
      branchId: r.branchid,
      branchName: r.branchname,
      gross: Number(r.gross),
      count: r.count,
    }));
  }
}