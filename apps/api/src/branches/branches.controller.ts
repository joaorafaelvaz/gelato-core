import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequirePermissions } from '../permissions/permissions.decorator';
import { BranchesService } from './branches.service';
import { CreateBranchDto } from './dto/create-branch.dto';

@Controller('branches')
export class BranchesController {
  constructor(private readonly branchesService: BranchesService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @RequirePermissions('admin.settings')
  create(@Body() dto: CreateBranchDto) {
    return this.branchesService.create(dto);
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  @RequirePermissions('admin.settings')
  findByTenant(@CurrentUser('tenantId') tenantId: string) {
    return this.branchesService.findByTenant(tenantId);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  @RequirePermissions('admin.settings')
  findById(@Param('id') id: string) {
    return this.branchesService.findById(id);
  }
}
