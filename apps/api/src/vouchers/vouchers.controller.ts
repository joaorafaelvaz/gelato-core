import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequirePermissions } from '../permissions/permissions.decorator';
import { VouchersService } from './vouchers.service';
import { CreateVoucherDto, ValidateVoucherDto } from './dto/create-voucher.dto';

@Controller('vouchers')
@UseGuards(JwtAuthGuard)
export class VouchersController {
  constructor(private readonly vouchersService: VouchersService) {}

  @Post()
  @RequirePermissions('marketing.manage')
  create(@Body() dto: CreateVoucherDto, @CurrentUser('userId') userId: string) {
    return this.vouchersService.create(userId, dto);
  }

  @Get()
  @RequirePermissions('marketing.view')
  findAll(@CurrentUser('tenantId') tenantId: string) {
    return this.vouchersService.findByTenant(tenantId);
  }

  @Post('validate')
  @RequirePermissions('pos.sale.create')
  validate(@Body() dto: ValidateVoucherDto) {
    return this.vouchersService.validate(dto);
  }

  @Post(':id/redeem')
  @RequirePermissions('pos.sale.create')
  redeem(
    @Param('id') id: string,
    @CurrentUser('userId') userId: string,
    @CurrentUser('tenantId') tenantId: string,
  ) {
    return this.vouchersService.redeem(id, userId, tenantId);
  }

  @Post(':id/deactivate')
  @RequirePermissions('marketing.manage')
  deactivate(
    @Param('id') id: string,
    @CurrentUser('userId') userId: string,
    @CurrentUser('tenantId') tenantId: string,
  ) {
    return this.vouchersService.deactivate(userId, id, tenantId);
  }
}