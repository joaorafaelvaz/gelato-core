import { Controller, Get, Header } from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { PrismaService } from '../prisma/prisma.service';

@Controller('metrics')
export class MetricsController {
  private readonly startedAt = Date.now();
  private requestCount = 0;

  constructor(private readonly prisma: PrismaService) {}

  increment() {
    this.requestCount++;
  }

  @Public()
  @Get()
  @Header('Content-Type', 'text/plain; version=0.0.4')
  async metrics() {
    const uptimeSec = Math.floor((Date.now() - this.startedAt) / 1000);
    const [orders, payments, tseAusfall, zReports] = await Promise.all([
      this.prisma.order.count(),
      this.prisma.payment.count(),
      this.prisma.tseTransaction.count({ where: { isAusfall: true } }),
      this.prisma.zReport.count(),
    ]);

    return [
      '# HELP gelato_uptime_seconds Process uptime in seconds',
      '# TYPE gelato_uptime_seconds gauge',
      `gelato_uptime_seconds ${uptimeSec}`,
      '',
      '# HELP gelato_http_requests_total Total HTTP requests handled',
      '# TYPE gelato_http_requests_total counter',
      `gelato_http_requests_total ${this.requestCount}`,
      '',
      '# HELP gelato_orders_total Total orders in the system',
      '# TYPE gelato_orders_total gauge',
      `gelato_orders_total ${orders}`,
      '',
      '# HELP gelato_payments_total Total payments',
      '# TYPE gelato_payments_total gauge',
      `gelato_payments_total ${payments}`,
      '',
      '# HELP gelato_tse_ausfall_total TSE transactions in ausfall state',
      '# TYPE gelato_tse_ausfall_total gauge',
      `gelato_tse_ausfall_total ${tseAusfall}`,
      '',
      '# HELP gelato_z_reports_total Total Z-reports generated',
      '# TYPE gelato_z_reports_total gauge',
      `gelato_z_reports_total ${zReports}`,
      '',
    ].join('\n');
  }
}