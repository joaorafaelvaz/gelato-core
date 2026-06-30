import { Controller, Get, Post, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequirePermissions } from '../permissions/permissions.decorator';
import { ReportsService } from './reports.service';

@Controller('reports')
@UseGuards(JwtAuthGuard)
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('x/:kasseId')
  @RequirePermissions('pos.report.x')
  async xReport(
    @Param('kasseId') kasseId: string,
    @Query('businessDay') businessDay?: string,
  ) {
    return this.reportsService.xReport(kasseId, businessDay);
  }

  @Post('z/:kasseId')
  @RequirePermissions('pos.report.z')
  async zReport(
    @Param('kasseId') kasseId: string,
    @Query('shiftId') shiftId?: string,
  ) {
    return this.reportsService.zReport(kasseId, shiftId);
  }

  @Get('z/:kasseId')
  @RequirePermissions('pos.report.z')
  async listZReports(@Param('kasseId') kasseId: string) {
    return this.reportsService.listZReports(kasseId);
  }
}
