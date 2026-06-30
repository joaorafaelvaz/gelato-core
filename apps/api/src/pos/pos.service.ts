import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { FiscalService } from '../fiscal/fiscal.service';
import { TseFactory } from '../compliance/tse/tse-factory.service';
import { StockService } from '../stock/stock.service';
import { PosPeripheralsService } from './pos-peripherals.service';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { VouchersService } from '../vouchers/vouchers.service';
import {
  CreateOrderDto,
  OpenShiftDto,
  CloseShiftDto,
  VoidOrderDto,
} from './dto/create-order.dto';

@Injectable()
export class PosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly fiscal: FiscalService,
    private readonly tseFactory: TseFactory,
    private readonly stockService: StockService,
    private readonly peripherals: PosPeripheralsService,
    private readonly loyaltyService: LoyaltyService,
    private readonly vouchersService: VouchersService,
  ) {}

  getStatus() {
    return { status: 'ok', phase: 'production' };
  }

  // ============ Shift management ============

  async openShift(userId: string, dto: OpenShiftDto) {
    const kasse = await this.prisma.kasse.findUnique({
      where: { id: dto.kasseId },
      include: { betriebsstaette: true },
    });
    if (!kasse) throw new NotFoundException('Kasse not found');

    const open = await this.prisma.shift.findFirst({
      where: { kasseId: dto.kasseId, closedAt: null },
    });
    if (open) {
      throw new BadRequestException('A shift is already open for this kasse');
    }

    const shift = await this.prisma.shift.create({
      data: {
        kasseId: dto.kasseId,
        userId,
        betriebsstaetteId: kasse.betriebsstaetteId,
        openingFloat: dto.openingFloat ?? 0,
      },
      include: { kasse: true },
    });

    await this.audit.log({
      userId,
      tenantId: kasse.betriebsstaette.tenantId,
      action: 'pos.shift.open',
      entity: 'shift',
      entityId: shift.id,
      payload: { kasseId: dto.kasseId, openingFloat: dto.openingFloat ?? 0 },
    });

    return shift;
  }

  async closeShift(userId: string, shiftId: string, dto: CloseShiftDto) {
    const shift = await this.prisma.shift.findUnique({
      where: { id: shiftId },
      include: { kasse: { include: { betriebsstaette: true } }, zReport: true },
    });
    if (!shift) throw new NotFoundException('Shift not found');
    if (shift.closedAt) {
      throw new BadRequestException('Shift already closed');
    }
    if (shift.zReportId) {
      throw new BadRequestException('Shift already has a Z-report; cannot close directly');
    }

    const updated = await this.prisma.shift.update({
      where: { id: shiftId },
      data: {
        closedAt: new Date(),
        closingCount: dto.closingCount ?? null,
      },
      include: { kasse: true },
    });

    await this.audit.log({
      userId,
      tenantId: shift.kasse.betriebsstaette.tenantId,
      action: 'pos.shift.close',
      entity: 'shift',
      entityId: shiftId,
      payload: { kasseId: shift.kasseId, closingCount: dto.closingCount ?? null },
    });

    return updated;
  }

  async getShifts(kasseId: string) {
    return this.prisma.shift.findMany({
      where: { kasseId },
      orderBy: { openedAt: 'desc' },
      include: { user: { select: { id: true, name: true } } },
    });
  }

  // ============ Order management ============

  async createOrder(userId: string, dto: CreateOrderDto) {
    const kasse = await this.prisma.kasse.findUnique({
      where: { id: dto.kasseId },
      include: { tseClient: true, betriebsstaette: true },
    });
    if (!kasse) throw new NotFoundException('Kasse not found');

    const shift = await this.prisma.shift.findUnique({ where: { id: dto.shiftId } });
    if (!shift || shift.closedAt) throw new NotFoundException('Shift not open');

    const productIds = dto.items.map((i) => i.productId);
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds } },
      include: { variants: true },
    });
    const productMap = new Map(products.map((p) => [p.id, p]));

    const orderId = crypto.randomUUID();
    let totalNet = new Decimal(0);
    let totalGross = new Decimal(0);
    const itemRecords: any[] = [];

    for (const item of dto.items) {
      const product = productMap.get(item.productId);
      if (!product) throw new NotFoundException(`Product ${item.productId} not found`);

      const mwstRate = new Decimal(
        dto.mode === 'AUSSER_HAUS' ? product.mwstAusserHaus : product.mwstImHaus,
      );

      const variant = item.variantId
        ? product.variants.find((v) => v.id === item.variantId)
        : undefined;
      const basePrice = new Decimal(product.basePrice?.toString() ?? '0');
      const variantDelta = new Decimal(variant?.priceDelta?.toString() ?? '0');
      const modifiersTotal = (item.modifiers ?? []).reduce(
        (sum, m) => sum.plus(new Decimal(m.priceDelta.toString())),
        new Decimal(0),
      );

      const unitGross = basePrice.plus(variantDelta).plus(modifiersTotal);
      const unitNet = unitGross.dividedBy(new Decimal(1).plus(mwstRate.dividedBy(100)));
      const qty = new Decimal(item.qty);
      const itemTotalGross = unitGross.times(qty);
      const itemTotalNet = unitNet.times(qty);

      totalGross = totalGross.plus(itemTotalGross);
      totalNet = totalNet.plus(itemTotalNet);

      itemRecords.push({
        id: crypto.randomUUID(),
        orderId,
        productId: item.productId,
        variantId: item.variantId,
        qty,
        unitPrice: unitGross,
        unitNet,
        mwstRate,
        modifiers: item.modifiers ?? [],
        totalNet: itemTotalNet,
        totalGross: itemTotalGross,
      });
    }

    const totalMwst = totalGross.minus(totalNet);

    // Apply discount
    let discountAmount = new Decimal(0);
    if (dto.discountType && dto.discountValue) {
      const dv = new Decimal(dto.discountValue);
      if (dto.discountType === 'PERCENTAGE') {
        discountAmount = totalGross.times(dv).dividedBy(100);
      } else {
        discountAmount = dv;
      }
      discountAmount = Decimal.min(discountAmount, totalGross);
    }

    // Validate and apply voucher if provided
    let voucherRedemption: { voucherId: string; discountAmount: number } | null = null;
    if (dto.voucherCode) {
      const validation = await this.vouchersService.validate({
        tenantId: kasse.betriebsstaette.tenantId,
        code: dto.voucherCode,
        orderTotal: totalGross.minus(discountAmount).toNumber(),
      });
      if (validation.valid) {
        const voucherDiscount = new Decimal(validation.discountAmount);
        discountAmount = discountAmount.plus(voucherDiscount);
        discountAmount = Decimal.min(discountAmount, totalGross);
        voucherRedemption = {
          voucherId: validation.voucherId,
          discountAmount: voucherDiscount.toNumber(),
        };
      }
    }

    const finalGross = totalGross.minus(discountAmount);
    const finalNet = finalGross.dividedBy(new Decimal(1).plus(totalMwst.dividedBy(totalNet.gt(0) ? totalNet : new Decimal(1))));
    const finalMwst = finalGross.minus(finalNet);

    const order = await this.prisma.$transaction(async (tx) => {
      await tx.order.create({
        data: {
          id: orderId,
          kasseId: dto.kasseId,
          shiftId: dto.shiftId,
          mode: dto.mode,
          tableId: dto.tableId ?? null,
          status: 'OPEN',
          customerId: dto.customerId ?? null,
          totalNet: finalNet.toNumber(),
          totalMwst: finalMwst.toNumber(),
          totalGross: finalGross.toNumber(),
        },
      });

      for (const rec of itemRecords) {
        await tx.orderItem.create({
          data: {
            id: rec.id,
            orderId: rec.orderId,
            productId: rec.productId,
            variantId: rec.variantId ?? null,
            qty: rec.qty.toNumber(),
            unitPrice: rec.unitPrice.toNumber(),
            unitNet: rec.unitNet.toNumber(),
            mwstRate: rec.mwstRate.toNumber(),
            modifiers: rec.modifiers,
            totalNet: rec.totalNet.toNumber(),
            totalGross: rec.totalGross.toNumber(),
          },
        });
      }

      if (dto.payments?.length) {
        for (const p of dto.payments) {
          await tx.payment.create({
            data: {
              orderId,
              method: p.method as any,
              amount: new Decimal(p.amount.toString()).toNumber(),
              reference: p.reference ?? null,
            },
          });
        }
      }

      return tx.order.findUnique({
        where: { id: orderId },
        include: { items: true, payments: true },
      });
    });

    await this.audit.log({
      userId,
      tenantId: kasse.betriebsstaette.tenantId,
      action: 'pos.sale.create',
      entity: 'order',
      entityId: orderId,
      payload: {
        mode: dto.mode,
        itemCount: dto.items.length,
        totalGross: totalGross.toNumber(),
        discount: discountAmount.toNumber(),
        voucher: dto.voucherCode ?? null,
      },
    });

    // Redeem voucher after order creation
    if (voucherRedemption) {
      try {
        await this.vouchersService.redeem(
          voucherRedemption.voucherId,
          userId,
          kasse.betriebsstaette.tenantId,
        );
      } catch {
        // Voucher redemption is best-effort
      }
    }

    return order;
  }

  async finalizeOrder(userId: string, orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { kasse: { include: { tseClient: true, betriebsstaette: true } }, items: true, payments: true },
    });
    if (!order) throw new NotFoundException('Order not found');
    if (order.status === 'CLOSED') {
      throw new BadRequestException('Order already finalized');
    }
    if (order.status === 'VOIDED') {
      throw new BadRequestException('Cannot finalize a voided order');
    }

    const tseClient = order.kasse.tseClient;
    let tseResult = null;
    if (tseClient) {
      const provider = this.tseFactory.create({
        provider: tseClient.provider as any,
        serialNumber: tseClient.serialNumber,
      });
      await provider.initialize({ provider: 'fiskaly' });
      tseResult = await this.fiscal.signOrder(order.id, tseClient.id, provider, 'Beleg');
    }

    const receipt = await this.prisma.receipt.create({
      data: {
        orderId: order.id,
        format: 'PRINT',
        tseSignature: (tseResult
          ? {
              txNumber: tseResult.result.txNumber,
              signatureCounter: tseResult.result.signatureCounter,
              signatureValue: tseResult.result.signatureValue,
              isAusfall: tseResult.result.isAusfall,
              serialNumber: tseResult.result.serialNumber,
            }
          : null) as any,
        qrPayload: tseResult?.result.signatureValue ?? 'TSE-AUSFALL',
      },
    });

    const finalized = await this.prisma.order.update({
      where: { id: orderId },
      data: { status: 'CLOSED' },
      include: { items: true, payments: true, receipt: true },
    });

    await this.stockService.consumeForOrder(orderId);
    await this.peripherals.printReceipt(finalized as any);
    await this.peripherals.openDrawer();
    await this.peripherals.showDisplay([
      'Obrigado!',
      `Total: ${finalized.totalGross.toFixed(2)}`,
    ]);

    // Award loyalty points if order has a customer
    if (order.customerId) {
      try {
        await this.loyaltyService.awardForOrder(
          order.customerId,
          Number(finalized.totalGross),
        );
      } catch {
        // Loyalty award is best-effort; don't fail the sale
      }
    }

    await this.audit.log({
      userId,
      tenantId: order.kasse.betriebsstaette.tenantId,
      action: 'pos.sale.finalize',
      entity: 'order',
      entityId: orderId,
      payload: {
        receiptId: receipt.id,
        tseAusfall: tseResult?.result.isAusfall ?? true,
      },
    });

    return finalized;
  }

  async voidOrder(userId: string, orderId: string, dto: VoidOrderDto) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        kasse: { include: { betriebsstaette: true, tseClient: true } },
        items: true,
        payments: true,
        storno: true,
      },
    });
    if (!order) throw new NotFoundException('Order not found');
    if (order.storno) {
      throw new BadRequestException('Order already voided');
    }
    if (order.status !== 'CLOSED') {
      throw new BadRequestException('Only CLOSED orders can be voided');
    }

    // Fiscal: sign the storno with the TSE if configured
    let tseResult = null;
    const tseClient = order.kasse.tseClient;
    if (tseClient) {
      const provider = this.tseFactory.create({
        provider: tseClient.provider as any,
        serialNumber: tseClient.serialNumber,
      });
      await provider.initialize({ provider: 'fiskaly' });
      tseResult = await this.fiscal.signOrder(order.id, tseClient.id, provider, 'Storno');
    }

    await this.prisma.orderStorno.create({
      data: {
        originalOrderId: orderId,
        reason: dto.reason,
        userId,
      },
    });

    const voided = await this.prisma.order.update({
      where: { id: orderId },
      data: { status: 'VOIDED' },
      include: { items: true, payments: true, storno: true },
    });

    await this.audit.log({
      userId,
      tenantId: order.kasse.betriebsstaette.tenantId,
      action: 'pos.sale.void',
      entity: 'order',
      entityId: orderId,
      payload: {
        reason: dto.reason,
        tseProcessType: 'Storno',
        tseAusfall: tseResult?.result.isAusfall ?? true,
      },
    });

    return voided;
  }
}