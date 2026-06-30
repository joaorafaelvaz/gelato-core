import { Module } from '@nestjs/common';
import { KassenController } from './kassen.controller';
import { KassenService } from './kassen.service';

@Module({
  controllers: [KassenController],
  providers: [KassenService],
  exports: [KassenService],
})
export class KassenModule {}
