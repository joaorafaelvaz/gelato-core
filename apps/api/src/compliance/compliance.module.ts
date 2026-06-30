import { Module } from '@nestjs/common';
import { TseFactory } from './tse/tse-factory.service';
import { FiskalyTseAdapter } from './tse/fiskaly-tse.adapter';

@Module({
  providers: [TseFactory, FiskalyTseAdapter],
  exports: [TseFactory],
})
export class ComplianceModule {}
