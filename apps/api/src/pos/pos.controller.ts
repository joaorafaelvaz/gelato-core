import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequirePermissions } from '../permissions/permissions.decorator';
import { PosService } from './pos.service';
import {
  CreateOrderDto,
  OpenShiftDto,
  CloseShiftDto,
  VoidOrderDto,
} from './dto/create-order.dto';

@Controller('pos')
@UseGuards(JwtAuthGuard)
export class PosController {
  constructor(private readonly posService: PosService) {}

  @Get('status')
  status() {
    return this.posService.getStatus();
  }

  // ============ Shifts ============

  @Post('shifts')
  @RequirePermissions('pos.shift.open')
  openShift(@Body() dto: OpenShiftDto, @CurrentUser('userId') userId: string) {
    return this.posService.openShift(userId, dto);
  }

  @Post('shifts/:id/close')
  @RequirePermissions('pos.shift.close')
  closeShift(
    @Param('id') id: string,
    @Body() dto: CloseShiftDto,
    @CurrentUser('userId') userId: string,
  ) {
    return this.posService.closeShift(userId, id, dto);
  }

  @Get('shifts/kasse/:kasseId')
  @RequirePermissions('pos.sale.create')
  getShifts(@Param('kasseId') kasseId: string) {
    return this.posService.getShifts(kasseId);
  }

  // ============ Orders ============

  @Post('orders')
  @RequirePermissions('pos.sale.create')
  createOrder(@Body() dto: CreateOrderDto, @CurrentUser('userId') userId: string) {
    return this.posService.createOrder(userId, dto);
  }

  @Post('orders/:id/finalize')
  @RequirePermissions('pos.sale.create')
  finalizeOrder(@Param('id') id: string, @CurrentUser('userId') userId: string) {
    return this.posService.finalizeOrder(userId, id);
  }

  @Post('orders/:id/void')
  @RequirePermissions('pos.sale.void')
  voidOrder(
    @Param('id') id: string,
    @Body() dto: VoidOrderDto,
    @CurrentUser('userId') userId: string,
  ) {
    return this.posService.voidOrder(userId, id, dto);
  }
}