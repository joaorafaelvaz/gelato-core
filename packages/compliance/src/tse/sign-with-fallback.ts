import type { TseProvider } from './provider'
import type { TseSignRequest, TseTransactionResult } from './types'

/** Resultado da tentativa de assinatura: assinada, ou Ausfall (sem assinatura). */
export type SignOutcome =
  | { kind: 'signed'; tse: TseTransactionResult }
  | { kind: 'ausfall'; reason: string }

export interface SignWithFallbackOpts {
  /** Tempo máximo de espera pela TSE antes de cair em Ausfall (default 5000 ms). */
  timeoutMs?: number
}

const TIMEOUT = Symbol('tse-timeout')

/**
 * Envolve QUALQUER TseProvider: tenta assinar com um timeout curto. Se a TSE
 * lançar OU exceder o timeout, retorna `ausfall` em vez de propagar — a venda
 * nunca é bloqueada. NUNCA reassina depois (KassenSichV: sem assinatura retroativa).
 */
export async function signWithFallback(
  tse: TseProvider,
  req: TseSignRequest,
  opts: SignWithFallbackOpts = {},
): Promise<SignOutcome> {
  const timeoutMs = opts.timeoutMs ?? 5000
  let handle: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<typeof TIMEOUT>((resolve) => {
    handle = setTimeout(() => resolve(TIMEOUT), timeoutMs)
  })
  try {
    const res = await Promise.race([tse.sign(req), timeout])
    return res === TIMEOUT ? { kind: 'ausfall', reason: 'timeout' } : { kind: 'signed', tse: res }
  } catch (err) {
    return { kind: 'ausfall', reason: err instanceof Error ? err.message : String(err) }
  } finally {
    if (handle) clearTimeout(handle)
  }
}
