import type { TseProvider } from './provider'
import type { TseTransactionResult } from './types'

/** Dublê: a TSE está inacessível (rede caiu / fiskaly erro). Sempre lança. */
export class FailingTseProvider implements TseProvider {
  constructor(private readonly message = 'TSE unreachable') {}
  async sign(): Promise<TseTransactionResult> {
    throw new Error(this.message)
  }
}

/** Dublê: a TSE nunca responde (trava). Usado para exercitar o timeout. */
export class HangingTseProvider implements TseProvider {
  async sign(): Promise<TseTransactionResult> {
    return new Promise<TseTransactionResult>(() => {
      /* nunca resolve */
    })
  }
}
