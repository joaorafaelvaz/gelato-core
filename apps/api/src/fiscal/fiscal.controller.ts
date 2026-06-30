import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequirePermissions } from '../permissions/permissions.decorator';
import { FiscalService } from './fiscal.service';
import { TseFactory } from '../compliance/tse/tse-factory.service';
import { PrismaService } from '../prisma/prisma.service';

class SignOrderDto {
  orderId!: string;
  kasseId!: string;
}

@Controller('fiscal')
@UseGuards(JwtAuthGuard)
export class FiscalController {
  constructor(
    private readonly fiscalService: FiscalService,
    private readonly tseFactory: TseFactory,
    private readonly prisma: PrismaService,
  ) {}

  @Post('sign')
  @RequirePermissions('pos.sale.create')
  async signOrder(@Body() dto: SignOrderDto) {
    const kasse = await this.prisma.kasse.findUnique({
      where: { id: dto.kasseId },
      include: { tseClient: true },
    });
    if (!kasse || !kasse.tseClient) {
      return { error: 'Kasse has no TSE client configured' };
    }

    const provider = this.tseFactory.create({
      provider: kasse.tseClient.provider as 'fiskaly' | 'swissbit',
      serialNumber: kasse.tseClient.serialNumber,
    });
    await provider.initialize({ provider: 'fiskaly' });

    return this.fiscalService.signOrder(dto.orderId, kasse.tseClient.id, provider);
  }
}
