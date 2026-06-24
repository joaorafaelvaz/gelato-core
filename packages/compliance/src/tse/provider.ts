import type { TseSignRequest, TseTransactionResult } from './types'

/**
 * Porta (port) de TSE. NUNCA acoplar ao fornecedor: o terminal/serviço depende
 * desta interface, e as implementações concretas (fiskaly, swissbit, fake)
 * ficam atrás dela.
 */
export interface TseProvider {
  sign(req: TseSignRequest): Promise<TseTransactionResult>
}
