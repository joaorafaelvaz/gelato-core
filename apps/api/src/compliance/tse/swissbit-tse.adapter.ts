import { Injectable, Logger } from '@nestjs/common';
import {
  ITseProvider,
  TseClientConfig,
  TseSignRequest,
  TseSignResult,
} from './tse-provider.interface';

/**
 * Swissbit local TSE adapter (USB / SD card).
 *
 * This is a skeleton implementation. In production, this adapter communicates
 * with the Swissbit TSE hardware via the vendor SDK (typically a C library
 * accessed through FFI/N-API). The hardware handles:
 *  - StartTransaction / UpdateTransaction / FinishTransaction
 *  - Signature generation (ECDSA)
 *  - Log storage on the device
 *  - Serial number and public key retrieval
 *
 * Until the Swissbit SDK is integrated, this adapter runs in mock mode
 * (returns valid-looking signatures) or Ausfall mode when the device path
 * is configured but unreachable.
 */
@Injectable()
export class SwissbitTseAdapter implements ITseProvider {
  private readonly logger = new Logger(SwissbitTseAdapter.name);
  private config: TseClientConfig | null = null;
  private healthy = false;
  private serialNumber = 'SWISSBIT_UNKNOWN';
  private txCounter = 0;

  async initialize(config: TseClientConfig): Promise<void> {
    this.config = config;
    this.serialNumber = config.serialNumber ?? 'SWISSBIT_UNKNOWN';

    // In production: open the device at config.connection or default mount point
    // and read the serial number + public key.
    if (!config.serialNumber) {
      this.logger.warn('Swissbit adapter initialized without serial — mock mode');
    }

    // Simulate device detection
    this.healthy = true;
    this.logger.log(`Swissbit TSE adapter initialized (serial=${this.serialNumber})`);
  }

  async sign(req: TseSignRequest): Promise<TseSignResult> {
    if (!this.config) {
      throw new Error('Swissbit adapter not initialized');
    }

    try {
      if (!this.healthy) {
        return this.ausfallResult(req, 'Swissbit TSE device not reachable (TSE-Ausfall)');
      }

      // In production:
      // 1. Call StartTransaction (if new)
      // 2. Call FinishTransaction with processType + payload
      // 3. Read signature, counter, log time from device
      this.txCounter++;
      const now = new Date();
      const counter = String(this.txCounter);
      const signature = `SWISSBIT_SIG_${counter}_${req.clientId}`;

      this.logger.log(
        `Swissbit signed tx #${counter} (type=${req.processType}, client=${req.clientId})`,
      );

      return {
        success: true,
        txNumber: counter,
        signatureCounter: counter,
        signatureValue: signature,
        logTime: now,
        startTime: now,
        finishTime: now,
        serialNumber: this.serialNumber,
        isAusfall: false,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Swissbit sign failed: ${msg}`);
      return this.ausfallResult(req, msg);
    }
  }

  private ausfallResult(_req: TseSignRequest, message: string): TseSignResult {
    return {
      success: true,
      txNumber: `AUSFALL_${Date.now()}`,
      signatureCounter: '0',
      signatureValue: '',
      logTime: new Date(),
      startTime: new Date(),
      finishTime: new Date(),
      serialNumber: this.serialNumber,
      isAusfall: true,
      errorMessage: message,
    };
  }

  getSerialNumber(): string {
    return this.serialNumber;
  }

  isHealthy(): boolean {
    return this.healthy;
  }

  setHealthy(healthy: boolean): void {
    this.healthy = healthy;
  }
}