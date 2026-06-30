import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequirePermissions } from '../permissions/permissions.decorator';
import { AdminService } from './admin.service';
import { RegisterTseClientDto } from './dto/register-tse-client.dto';

@Controller('admin')
@UseGuards(JwtAuthGuard)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Post('tse/register')
  @RequirePermissions('admin.tse')
  registerTse(
    @Body() dto: RegisterTseClientDto,
    @CurrentUser('userId') userId: string,
  ) {
    return this.adminService.registerTseClient(userId, dto);
  }

  @Get('tse')
  @RequirePermissions('admin.tse')
  listTseClients() {
    return this.adminService.listTseClients();
  }

  @Get('tse/kasse/:kasseId')
  @RequirePermissions('admin.tse')
  getTseClient(@Param('kasseId') kasseId: string) {
    return this.adminService.getTseClient(kasseId);
  }

  @Post('tse/:id/deregister')
  @RequirePermissions('admin.tse')
  deregisterTse(
    @Param('id') id: string,
    @CurrentUser('userId') userId: string,
  ) {
    return this.adminService.deregisterTseClient(userId, id);
  }

  @Get('settings')
  @RequirePermissions('admin.settings')
  getSettings(@CurrentUser('tenantId') tenantId: string) {
    return this.adminService.getSettings(tenantId);
  }

  @Post('settings')
  @RequirePermissions('admin.settings')
  updateSettings(
    @Body() body: Record<string, unknown>,
    @CurrentUser('userId') userId: string,
    @CurrentUser('tenantId') tenantId: string,
  ) {
    return this.adminService.updateSettings(userId, tenantId, body);
  }
}