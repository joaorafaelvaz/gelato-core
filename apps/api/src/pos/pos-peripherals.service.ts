import { Injectable, Logger } from '@nestjs/common';
import {
  IReceiptPrinter,
  ICashDrawer,
  ICustomerDisplay,
  MockReceiptPrinter,
  MockCashDrawer,
  MockCustomerDisplay,
  ReceiptLine,
} from '@gelato/hardware';
import { OrderWithDetails } from './order.types';

@Injectable()
export class PosPeripheralsService {
  private readonly logger = new Logger(PosPeripheralsService.name);
  private printer: IReceiptPrinter = new MockReceiptPrinter();
  private drawer: ICashDrawer = new MockCashDrawer();
  private display: ICustomerDisplay = new MockCustomerDisplay();

  async printReceipt(order: OrderWithDetails): Promise<void> {
    const lines: ReceiptLine[] = [
      { type: 'heading', content: 'gelato-core', align: 'center' },
      { type: 'text', content: `Order: ${order.id}`, align: 'left' },
      { type: 'text', content: `Mode: ${order.mode}`, align: 'left' },
      { type: 'rule', content: '------------------------------' },
      ...order.items.map((item) => ({
        type: 'text' as const,
        content: `${item.qty.toString()}x ${item.productId} ${item.totalGross.toFixed(2)}`,
        align: 'left' as const,
      })),
      { type: 'rule', content: '------------------------------' },
      { type: 'text', content: `Gross: ${order.totalGross.toFixed(2)}`, align: 'right' },
      { type: 'text', content: `Net: ${order.totalNet.toFixed(2)}`, align: 'right' },
      { type: 'text', content: `MwSt: ${order.totalMwst.toFixed(2)}`, align: 'right' },
    ];

    if (order.receipt?.qrPayload) {
      lines.push({ type: 'qr', content: order.receipt.qrPayload });
    }

    try {
      await this.printer.printReceipt(lines);
    } catch (err) {
      this.logger.warn(`Receipt print failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async openDrawer(): Promise<void> {
    try {
      await this.drawer.open();
    } catch (err) {
      this.logger.warn(`Drawer open failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async showDisplay(lines: string[]): Promise<void> {
    try {
      await this.display.show(lines);
    } catch (err) {
      this.logger.warn(`Display update failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
