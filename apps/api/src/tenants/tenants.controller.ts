import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequirePermissions } from '../permissions/permissions.decorator';
import { TenantsService } from './tenants.service';
import { CreateTenantDto } from './dto/create-tenant.dto';

@Controller('tenants')
export class TenantsController {
  constructor(private readonly tenantsService: TenantsService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @RequirePermissions('admin.settings')
  create(@Body() dto: CreateTenantDto) {
    return this.tenantsService.create(dto);
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  @RequirePermissions('admin.settings')
  findAll() {
    return this.tenantsService.findAll();
  }

  @Get(':slug')
  @UseGuards(JwtAuthGuard)
  @RequirePermissions('admin.settings')
  findBySlug(@Param('slug') slug: string) {
    return this.tenantsService.findBySlug(slug);
  }
}
