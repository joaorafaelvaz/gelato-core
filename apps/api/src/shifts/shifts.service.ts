import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import type { Prisma } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { computeShiftCash } from '@gelato/compliance'

interface AuditCtx {
  userId: string
  ip?: string
  device?: string
}

@Injectable()
export class ShiftsService {
  constructor(private readonly prisma: PrismaService) {}

  async open(kasseId: string, openingFloat: number, ctx: AuditCtx) {
    const shift = await this.prisma.shift.create({
      data: { kasseId, userId: ctx.userId, openingFloat, status: 'open' },
    })
    await this.audit(ctx, 'pos.shift.open', 'shift', shift.id, { openingFloat })
    return shift
  }

  async cashMovement(
    shiftId: string,
    type: 'sangria' | 'suprimento',
    amount: number,
    reason: string | undefined,
    ctx: AuditCtx,
  ) {
    const shift = await this.prisma.shift.findUnique({ where: { id: shiftId } })
    if (!shift || shift.status !== 'open') throw new BadRequestException('shift not open')
    const mv = await this.prisma.cashMovement.create({
      data: { shiftId, type, amount, reason, userId: ctx.userId },
    })
    await this.audit(ctx, 'pos.cash.movement', 'cash_movement', mv.id, { type, amount })
    return mv
  }

  async drawerOpen(ctx: AuditCtx) {
    await this.audit(ctx, 'pos.drawer.open', 'kasse', null, {})
    return { ok: true }
  }

  async close(shiftId: string, counted: number, ctx: AuditCtx) {
    const shift = await this.prisma.shift.findUnique({ where: { id: shiftId } })
    if (!shift) throw new NotFoundException('shift not found')
    if (shift.status !== 'open') throw new BadRequestException('shift already closed')

    const cashAgg = await this.prisma.payment.aggregate({
      _sum: { amount: true },
      where: { method: 'cash', order: { shiftId } },
    })
    const cashSales = cashAgg._sum.amount ?? 0
    const movements = await this.prisma.cashMovement.findMany({ where: { shiftId } })
    const suprimentos = movements
      .filter((m) => m.type === 'suprimento')
      .reduce((s, m) => s + m.amount, 0)
    const sangrias = movements.filter((m) => m.type === 'sangria').reduce((s, m) => s + m.amount, 0)

    const cash = computeShiftCash({ openingFloat: shift.openingFloat, cashSales, suprimentos, sangrias, counted })
    const closed = await this.prisma.shift.update({
      where: { id: shiftId },
      data: {
        status: 'closed',
        closedAt: new Date(),
        closingCount: counted,
        expectedCash: cash.expected,
        differenz: cash.differenz,
      },
    })
    await this.audit(ctx, 'pos.shift.close', 'shift', shiftId, {
      counted,
      expected: cash.expected,
      differenz: cash.differenz,
    })
    return { ...closed, expected: cash.expected, differenz: cash.differenz }
  }

  private async audit(
    ctx: AuditCtx,
    action: string,
    entity: string,
    entityId: string | null,
    payload: Prisma.InputJsonValue,
  ): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        userId: ctx.userId,
        action,
        entity,
        entityId: entityId ?? undefined,
        payload,
        ip: ctx.ip,
        device: ctx.device,
      },
    })
  }
}
