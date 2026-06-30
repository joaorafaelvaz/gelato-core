import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequirePermissions } from '../permissions/permissions.decorator';
import { SyncService } from './sync.service';
import { OutboxEvent } from '@gelato/sync';

class SyncEventDto {
  id!: string;
  clientEventId!: string;
  kasseId?: string;
  entity!: string;
  action!: string;
  payload!: Record<string, unknown>;
  status!: 'pending' | 'delivered' | 'failed';
  retryCount!: number;
  error?: string;
  createdAt!: string;
  deliveredAt?: string;
}

class SyncPushDto {
  kasseId!: string;
  @Type(() => SyncEventDto)
  events!: SyncEventDto[];
}

@Controller('sync')
@UseGuards(JwtAuthGuard)
export class SyncController {
  constructor(private readonly syncService: SyncService) {}

  @Post('push')
  @RequirePermissions('pos.sale.create')
  async push(@Body() dto: SyncPushDto) {
    const events = Array.isArray(dto.events) ? dto.events : [];
    return this.syncService.pushEvents(dto.kasseId, events as OutboxEvent[]);
  }
}
