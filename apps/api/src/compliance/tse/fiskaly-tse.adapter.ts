import { Injectable, Logger } from '@nestjs/common';
import {
  ITseProvider,
  TseClientConfig,
  TseSignRequest,
  TseSignResult,
} from './tse-provider.interface';

interface FiskalyTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

interface FiskalyTxResponse {
  state: string;
  latest_revision: string;
  transaction_number: string;
  signature: {
    signature_counter: string;
    signature_value: string;
    log_time: string;
    public_key: string;
  };
  time_creation: string;
  time_finish: string;
  serial: string;
}

/**
 * Real fiskaly cloud-TSE adapter.
 *
 * Authenticates with the fiskaly API using OAuth, then signs transactions
 * via PUT /tss/{tssId}/tx/{txNumber}. Falls back to TSE-Ausfall when the
 * cloud is unreachable.
 *
 * Requires config.credentials JSON with:
 *   { apiKey, apiSecret, tssId, clientId }
 * Or individual fields: apiKey, apiSecret, tssId (set via TseClientConfig).
 */
@Injectable()
export class FiskalyTseAdapter implements ITseProvider {
  private readonly logger = new Logger(FiskalyTseAdapter.name);
  private config: TseClientConfig | null = null;
  private healthy = false;
  private serialNumber = 'FISKALY_CLOUD_UNKNOWN';
  private accessToken: string | null = null;
  private tokenExpiresAt = 0;
  private txCounter = 0;

  async initialize(config: TseClientConfig): Promise<void> {
    this.config = config;
    this.serialNumber = config.serialNumber ?? 'FISKALY_CLOUD_UNKNOWN';

    if (!config.apiKey || !config.apiSecret) {
      this.logger.warn('Fiskaly adapter initialized without API credentials — running in mock mode');
      this.healthy = true;
      return;
    }

    try {
      await this.authenticate();
      this.healthy = true;
      this.logger.log(`Fiskaly TSE authenticated for TSS ${config.tssId ?? 'unknown'}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Fiskaly auth failed, entering Ausfall mode: ${msg}`);
      this.healthy = false;
    }
  }

  private get baseUrl(): string {
    return this.config?.apiUrl ?? 'https://kassensichv.fiskaly.com/api/v0';
  }

  private async authenticate(): Promise<void> {
    if (!this.config?.apiKey || !this.config?.apiSecret) {
      throw new Error('Missing apiKey/apiSecret');
    }

    const res = await fetch(`${this.baseUrl}/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: this.config.apiKey,
        api_secret: this.config.apiSecret,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`fiskaly auth ${res.status}: ${body}`);
    }

    const data = (await res.json()) as FiskalyTokenResponse;
    this.accessToken = data.access_token;
    this.tokenExpiresAt = Date.now() + (data.expires_in - 60) * 1000;
  }

  private async ensureToken(): Promise<void> {
    if (!this.accessToken || Date.now() >= this.tokenExpiresAt) {
      await this.authenticate();
    }
  }

  async sign(req: TseSignRequest): Promise<TseSignResult> {
    if (!this.config) {
      throw new Error('Fiskaly adapter not initialized');
    }

    // Mock mode when no credentials
    if (!this.config.apiKey || !this.config.apiSecret) {
      if (!this.healthy) {
        return this.ausfallResult(req, 'Cloud-TSE nicht erreichbar (TSE-Ausfall)');
      }
      return this.mockSign(req);
    }

    try {
      if (!this.healthy) {
        return this.ausfallResult(req, 'Cloud-TSE nicht erreichbar (TSE-Ausfall)');
      }

      await this.ensureToken();

      const tssId = this.config.tssId;
      if (!tssId) throw new Error('Missing tssId');

      this.txCounter++;
      const txNumber = String(this.txCounter);

      const body: Record<string, unknown> = {
        client_id: req.clientId,
        schema: {
          standard: 'BSI',
          version: '2.0',
        },
        state: 'FINISHED',
        process_type: req.processType,
        process_data: req.payload,
      };

      const res = await fetch(
        `${this.baseUrl}/tss/${tssId}/tx/${txNumber}`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.accessToken}`,
          },
          body: JSON.stringify(body),
        },
      );

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`fiskaly sign ${res.status}: ${text}`);
      }

      const tx = (await res.json()) as FiskalyTxResponse;

      return {
        success: true,
        txNumber: tx.transaction_number,
        signatureCounter: tx.signature.signature_counter,
        signatureValue: tx.signature.signature_value,
        logTime: new Date(tx.signature.log_time),
        startTime: new Date(tx.time_creation),
        finishTime: new Date(tx.time_finish),
        serialNumber: tx.serial ?? this.serialNumber,
        publicKey: tx.signature.public_key,
        isAusfall: false,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Fiskaly sign failed: ${msg}`);
      this.healthy = false;
      return this.ausfallResult(req, msg);
    }
  }

  private mockSign(req: TseSignRequest): TseSignResult {
    const now = new Date();
    const counter = Date.now().toString();
    return {
      success: true,
      txNumber: `${counter}`,
      signatureCounter: counter,
      signatureValue: `FISKALY_MOCK_${counter}_${req.clientId}`,
      logTime: now,
      startTime: now,
      finishTime: now,
      serialNumber: this.serialNumber,
      isAusfall: false,
    };
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