import type { TseProvider } from './provider'
import type { TseSignRequest, TseTransactionResult } from './types'

export interface FakeTseOptions {
  serialNumber?: string
  publicKey?: string
  /** Relógio injetável para testes determinísticos. */
  clock?: () => Date
}

/**
 * Implementação determinística de TSE para desenvolvimento e testes (e para o
 * terminal em modo dev). Incrementa `txNumber`/`signatureCounter` de forma
 * monotônica e produz assinaturas estáveis. NÃO é válida fiscalmente — apenas
 * exercita o caminho correto do código.
 */
export class FakeTseProvider implements TseProvider {
  private txNumber = 0
  private signatureCounter = 0
  private readonly serialNumber: string
  private readonly publicKey: string
  private readonly clock: () => Date

  constructor(opts: FakeTseOptions = {}) {
    this.serialNumber = opts.serialNumber ?? 'FAKE-TSE-0001'
    this.publicKey = opts.publicKey ?? 'FAKE-PUBLIC-KEY'
    this.clock = opts.clock ?? (() => new Date())
  }

  async sign(req: TseSignRequest): Promise<TseTransactionResult> {
    this.txNumber += 1
    this.signatureCounter += 1
    const now = this.clock().toISOString()
    const processData = buildProcessData(req)
    return {
      txNumber: this.txNumber,
      signatureCounter: this.signatureCounter,
      signatureValue: `FAKE-SIG-${this.txNumber}-${req.grossTotal}`,
      logTime: now,
      startTime: now,
      serialNumber: this.serialNumber,
      processType: req.processType,
      publicKey: this.publicKey,
      processData,
      signatureAlgorithm: 'ecdsa-plain-SHA256',
      logTimeFormat: 'utcTime',
    }
  }
}

/** Monta os dados de processo (ProzessDaten) no estilo "Beleg^...^...". */
function buildProcessData(req: TseSignRequest): string {
  const amounts = req.amountsByVatRate.map((a) => `${a.rate}:${a.gross}`).join(',')
  return `Beleg^${amounts}^${req.paymentType}:${req.grossTotal}`
}
