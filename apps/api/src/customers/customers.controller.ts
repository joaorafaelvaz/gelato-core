import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequirePermissions } from '../permissions/permissions.decorator';
import { CustomersService } from './customers.service';
import { CreateCustomerDto } from './dto/create-customer.dto';

@Controller('customers')
@UseGuards(JwtAuthGuard)
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Post()
  @RequirePermissions('customer.manage')
  create(@Body() dto: CreateCustomerDto, @CurrentUser('userId') userId: string) {
    return this.customersService.create(userId, dto);
  }

  @Get()
  @RequirePermissions('customer.manage')
  findAll(
    @CurrentUser('tenantId') tenantId: string,
    @Query('search') search?: string,
  ) {
    return this.customersService.findByTenant(tenantId, search);
  }

  @Get(':id')
  @RequirePermissions('customer.manage')
  findById(@Param('id') id: string) {
    return this.customersService.findById(id);
  }

  @Patch(':id')
  @RequirePermissions('customer.manage')
  update(
    @Param('id') id: string,
    @Body() dto: Partial<CreateCustomerDto>,
    @CurrentUser('userId') userId: string,
  ) {
    return this.customersService.update(userId, id, dto);
  }

  @Post(':id/deactivate')
  @RequirePermissions('customer.manage')
  deactivate(@Param('id') id: string, @CurrentUser('userId') userId: string) {
    return this.customersService.deactivate(userId, id);
  }
}