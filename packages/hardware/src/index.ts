export interface PeripheralConfig {
  type: 'printer' | 'drawer' | 'scale' | 'customerDisplay';
  driver: 'mock' | 'escpos' | 'epson' | 'serial';
  connection: string; // e.g. "tcp://192.168.1.10:9100", "usb://...", "COM3"
  options?: Record<string, unknown>;
}

export interface ReceiptLine {
  type: 'text' | 'heading' | 'rule' | 'qr';
  content: string;
  align?: 'left' | 'center' | 'right';
  bold?: boolean;
}

export interface IReceiptPrinter {
  printReceipt(lines: ReceiptLine[]): Promise<void>;
  printHtml?(html: string): Promise<void>;
  isHealthy(): boolean;
}

export interface ICashDrawer {
  open(): Promise<void>;
  isHealthy(): boolean;
}

export interface IScale {
  tare(): Promise<void>;
  read(): Promise<{ grams: number; stable: boolean }>;
  isHealthy(): boolean;
}

export interface ICustomerDisplay {
  show(lines: string[]): Promise<void>;
  clear(): Promise<void>;
  isHealthy(): boolean;
}

export class MockReceiptPrinter implements IReceiptPrinter {
  private healthy = true;

  async printReceipt(lines: ReceiptLine[]): Promise<void> {
    // eslint-disable-next-line no-console
    console.log('[MOCK PRINTER]\n' + lines.map((l) => l.content).join('\n'));
  }

  isHealthy(): boolean {
    return this.healthy;
  }

  setHealthy(healthy: boolean): void {
    this.healthy = healthy;
  }
}

export class MockCashDrawer implements ICashDrawer {
  private healthy = true;

  async open(): Promise<void> {
    // eslint-disable-next-line no-console
    console.log('[MOCK DRAWER] open');
  }

  isHealthy(): boolean {
    return this.healthy;
  }

  setHealthy(healthy: boolean): void {
    this.healthy = healthy;
  }
}

export class MockScale implements IScale {
  private healthy = true;

  async tare(): Promise<void> {
    // eslint-disable-next-line no-console
    console.log('[MOCK SCALE] tare');
  }

  async read(): Promise<{ grams: number; stable: boolean }> {
    return { grams: 100, stable: true };
  }

  isHealthy(): boolean {
    return this.healthy;
  }

  setHealthy(healthy: boolean): void {
    this.healthy = healthy;
  }
}

export class MockCustomerDisplay implements ICustomerDisplay {
  private healthy = true;

  async show(lines: string[]): Promise<void> {
    // eslint-disable-next-line no-console
    console.log('[MOCK DISPLAY]\n' + lines.join('\n'));
  }

  async clear(): Promise<void> {
    // eslint-disable-next-line no-console
    console.log('[MOCK DISPLAY] clear');
  }

  isHealthy(): boolean {
    return this.healthy;
  }

  setHealthy(healthy: boolean): void {
    this.healthy = healthy;
  }
}

export class PeripheralFactory {
  static create(config: PeripheralConfig) {
    switch (config.type) {
      case 'printer':
        return new MockReceiptPrinter();
      case 'drawer':
        return new MockCashDrawer();
      case 'scale':
        return new MockScale();
      case 'customerDisplay':
        return new MockCustomerDisplay();
      default:
        throw new Error(`Unsupported peripheral type: ${config.type}`);
    }
  }
}

export type {
  IReceiptPrinter as ReceiptPrinter,
  ICashDrawer as CashDrawer,
  IScale as Scale,
  ICustomerDisplay as CustomerDisplay,
};
