export interface TseSignRequest {
  clientId: string;
  processType: string;
  payload: Record<string, unknown>;
}

export interface TseSignResult {
  success: boolean;
  txNumber?: string;
  signatureCounter?: string;
  signatureValue?: string;
  logTime?: Date;
  startTime?: Date;
  finishTime?: Date;
  serialNumber?: string;
  publicKey?: string;
  isAusfall: boolean;
  errorMessage?: string;
}

export interface TseClientConfig {
  provider: 'fiskaly' | 'swissbit';
  serialNumber?: string;
  apiKey?: string;
  apiSecret?: string;
  apiUrl?: string;
  tssId?: string;
  clientId?: string;
}

export interface ITseProvider {
  initialize(config: TseClientConfig): Promise<void>;
  sign(req: TseSignRequest): Promise<TseSignResult>;
  getSerialNumber(): string;
  isHealthy(): boolean;
}
