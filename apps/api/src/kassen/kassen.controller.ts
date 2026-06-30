import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequirePermissions } from '../permissions/permissions.decorator';
import { KassenService } from './kassen.service';
import { CreateKasseDto } from './dto/create-kasse.dto';

@Controller('kassen')
export class KassenController {
  constructor(private readonly kassenService: KassenService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @RequirePermissions('admin.settings')
  create(@Body() dto: CreateKasseDto) {
    return this.kassenService.create(dto);
  }

  @Get('branch/:branchId')
  @UseGuards(JwtAuthGuard)
  @RequirePermissions('admin.settings')
  findByBranch(@Param('branchId') branchId: string) {
    return this.kassenService.findByBranch(branchId);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  @RequirePermissions('admin.settings')
  findById(@Param('id') id: string) {
    return this.kassenService.findById(id);
  }
}
