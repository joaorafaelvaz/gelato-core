import { Module } from '@nestjs/common';
import { FiscalService } from './fiscal.service';
import { FiscalController } from './fiscal.controller';
import { TseFactory } from '../compliance/tse/tse-factory.service';
import { TseRetryService } from './tse-retry.service';

@Module({
  providers: [FiscalService, TseFactory, TseRetryService],
  controllers: [FiscalController],
  exports: [FiscalService, TseFactory, TseRetryService],
})
export class FiscalModule {}
