import { Controller, Get, Param, Query, UseGuards, Res } from '@nestjs/common';
import { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequirePermissions } from '../permissions/permissions.decorator';
import { ExportsService } from './exports.service';

@Controller('exports')
@UseGuards(JwtAuthGuard)
export class ExportsController {
  constructor(private readonly exportsService: ExportsService) {}

  @Get('dsfinvk/:tenantId')
  @RequirePermissions('admin.export.dsfinvk')
  async dsfinvk(
    @Param('tenantId') tenantId: string,
    @Query('businessDay') businessDay: string,
    @Res() res: Response,
  ) {
    const { filename, content } = await this.exportsService.dsfinvk(tenantId, businessDay);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(content);
  }

  @Get('kassenabschluss/:kasseId')
  @RequirePermissions('admin.kassenmeldung')
  async kassenabschluss(
    @Param('kasseId') kasseId: string,
    @Query('businessDay') businessDay: string,
  ) {
    return this.exportsService.kassenabschluss(kasseId, businessDay);
  }
}
