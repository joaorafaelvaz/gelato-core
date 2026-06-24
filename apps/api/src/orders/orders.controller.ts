import { Controller, Get, Req, UseGuards } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { JwtAuthGuard, type JwtUser } from '../auth/jwt-auth.guard'
import { PermissionsGuard } from '../rbac/permissions.guard'
import { RequirePermission } from '../rbac/require-permission.decorator'

/** Leitura do ledger imutável (lista de vendas) para o backoffice. Read-only. */
@Controller('orders')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class OrdersController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @RequirePermission('pos.report.x')
  list(@Req() req: { user: JwtUser }) {
    return this.prisma.order.findMany({
      where: { kasse: { betriebsstaette: { tenantId: req.user.tenant_id } } },
      orderBy: { ts: 'desc' },
      take: 100,
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
