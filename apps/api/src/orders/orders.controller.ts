import { BadRequestException, Controller, Get, Query, Req, UseGuards } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { JwtAuthGuard, type JwtUser } from '../auth/jwt-auth.guard'
import { PermissionsGuard } from '../rbac/permissions.guard'
import { RequirePermission } from '../rbac/require-permission.decorator'

function intParam(value: string | undefined, name: string, min: number, max: number, dflt: number): number {
  if (value === undefined) return dflt
  const n = Number(value)
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new BadRequestException(`${name} must be an integer between ${min} and ${max}`)
  }
  return n
}

function dateParam(value: string | undefined, name: string): Date | undefined {
  if (value === undefined) return undefined
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) throw new BadRequestException(`${name} must be an ISO date-time`)
  return d
}

function tsWindow(from?: Date, to?: Date): { ts?: { gte?: Date; lt?: Date } } {
  if (!from && !to) return {}
  return { ts: { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) } }
}

/** Leitura do ledger imutável (lista de vendas + agregado) para o backoffice. Read-only. */
@Controller('orders')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class OrdersController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('summary')
  @RequirePermission('pos.report.x')
  async summary(
    @Req() req: { user: JwtUser },
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const agg = await this.prisma.order.aggregate({
      where: {
        kasse: { betriebsstaette: { tenantId: req.user.tenant_id } },
        ...tsWindow(dateParam(from, 'from'), dateParam(to, 'to')),
      },
      _count: { _all: true },
      _sum: { totalGross: true },
    })
    return { count: agg._count._all, totalGross: agg._sum.totalGross ?? 0 }
  }

  @Get()
  @RequirePermission('pos.report.x')
  list(
    @Req() req: { user: JwtUser },
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.prisma.order.findMany({
      where: {
        kasse: { betriebsstaette: { tenantId: req.user.tenant_id } },
        ...tsWindow(dateParam(from, 'from'), dateParam(to, 'to')),
      },
      orderBy: { ts: 'desc' },
      take: intParam(limit, 'limit', 1, 500, 100),
      skip: intParam(offset, 'offset', 0, 1_000_000, 0),
      select: {
        id: true,
        ts: true,
        mode: true,
        totalNet: true,
        totalMwst: true,
        totalGross: true,
        kasseId: true,
      },
    })
  }
}
