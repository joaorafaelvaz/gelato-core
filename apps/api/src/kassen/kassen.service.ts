import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateKasseDto } from './dto/create-kasse.dto';

@Injectable()
export class KassenService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateKasseDto) {
    return this.prisma.kasse.create({
      data: {
        betriebsstaetteId: dto.betriebsstaetteId,
        name: dto.name,
        serialNumber: dto.serialNumber,
        location: dto.location,
        isActive: dto.isActive ?? true,
      },
    });
  }

  async findByBranch(betriebsstaetteId: string) {
    return this.prisma.kasse.findMany({
      where: { betriebsstaetteId },
      include: { tseClient: true },
    });
  }

  async findById(id: string) {
    return this.prisma.kasse.findUnique({
      where: { id },
      include: { tseClient: true },
    });
  }
}
