import { Module } from '@nestjs/common';
import { PosService } from './pos.service';
import { PosController } from './pos.controller';
import { FiscalService } from '../fiscal/fiscal.service';
import { TseFactory } from '../compliance/tse/tse-factory.service';
import { StockService } from '../stock/stock.service';
import { PosPeripheralsService } from './pos-peripherals.service';
import { LoyaltyModule } from '../loyalty/loyalty.module';
import { VouchersModule } from '../vouchers/vouchers.module';

@Module({
  imports: [LoyaltyModule, VouchersModule],
  providers: [PosService, FiscalService, TseFactory, StockService, PosPeripheralsService],
  controllers: [PosController],
  exports: [PosService],
})
export class PosModule {}
