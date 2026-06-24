import type { TseProvider } from './provider'
import type { TseSignRequest, TseTransactionResult } from './types'

/**
 * ⚠️ ADAPTER NÃO VERIFICADO — esqueleto. ⚠️
 *
 * Implementação do `TseProvider` contra a **fiskaly SIGN DE (KassenSichV)**.
 * O fluxo abaixo segue o modelo documentado (auth → StartTransaction ACTIVE →
 * FinishTransaction FINISHED com schema Kassenbeleg-V1), mas os endpoints/shapes
 * EXATOS DEVEM ser validados contra a documentação vigente da fiskaly e testados
 * no sandbox antes de qualquer uso. Também confirmar a certificação BSI vigente.
 *
 * Enquanto não validado, use `FakeTseProvider` em dev/testes.
 */
export interface FiskalyConfig {
  baseUrl: string
  apiKey: string
  apiSecret: string
  tssId: string
  fetchImpl?: typeof fetch
}

export class FiskalyProvider implements TseProvider {
  constructor(private readonly cfg: FiskalyConfig) {}

  private get fetch(): typeof fetch {
    return this.cfg.fetchImpl ?? fetch
  }

  private async authenticate(): Promise<string> {
    const res = await this.fetch(`${this.cfg.baseUrl}/api/v2/auth`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ api_key: this.cfg.apiKey, api_secret: this.cfg.apiSecret }),
    })
    if (!res.ok) throw new Error(`fiskaly auth failed: ${res.status}`)
    const json = (await res.json()) as { access_token: string }
    return json.access_token
  }

  async sign(req: TseSignRequest): Promise<TseTransactionResult> {
    const token = await this.authenticate()
    const txId = crypto.randomUUID()
    const base = `${this.cfg.baseUrl}/api/v2/tss/${this.cfg.tssId}/tx/${txId}`
    const auth = { authorization: `Bearer ${token}`, 'content-type': 'application/json' }

    // StartTransaction (ACTIVE)
    const startRes = await this.fetch(`${base}?tx_revision=1`, {
      method: 'PUT',
      headers: auth,
      body: JSON.stringify({ state: 'ACTIVE', client_id: req.clientId }),
    })
    if (!startRes.ok) throw new Error(`fiskaly start tx failed: ${startRes.status}`)

    // FinishTransaction (FINISHED) com schema Kassenbeleg-V1
    const finishRes = await this.fetch(`${base}?tx_revision=2`, {
      method: 'PUT',
      headers: auth,
      body: JSON.stringify({
        state: 'FINISHED',
        client_id: req.clientId,
        schema: {
          standard_v1: {
            receipt: {
              receipt_type: 'RECEIPT',
              amounts_per_vat_rate: req.amountsByVatRate.map((a) => ({
                vat_rate: vatRateLabel(a.rate),
                amount: (a.gross / 100).toFixed(2),
              })),
              amounts_per_payment_type: [
                { payment_type: req.paymentType === 'Bar' ? 'CASH' : 'NON_CASH', amount: (req.grossTotal / 100).toFixed(2) },
              ],
            },
          },
        },
      }),
    })
    if (!finishRes.ok) throw new Error(`fiskaly finish tx failed: ${finishRes.status}`)
    const tx = (await finishRes.json()) as FiskalyTxResponse

    return {
      txNumber: tx.number,
      signatureCounter: tx.signature.counter,
      signatureValue: tx.signature.value,
      logTime: tx.time_end ?? tx.log?.timestamp ?? '',
      startTime: tx.time_start ?? '',
      serialNumber: tx.tss_serial_number ?? '',
      processType: req.processType,
      publicKey: tx.signature.public_key ?? '',
      processData: tx.signature.process_data ?? '',
      signatureAlgorithm: tx.signature.algorithm ?? 'ecdsa-plain-SHA256',
      logTimeFormat: 'utcTime',
    }
  }
}

interface FiskalyTxResponse {
  number: number
  time_start?: string
  time_end?: string
  tss_serial_number?: string
  log?: { timestamp?: string }
  signature: {
    counter: number
    value: string
    algorithm?: string
    public_key?: string
    process_data?: string
  }
}

/** Mapeia uma alíquota numérica para o rótulo esperado pela fiskaly (a confirmar). */
function vatRateLabel(rate: number): string {
  if (rate === 0.19) return 'NORMAL'
  if (rate === 0.07) return 'REDUCED_1'
  return 'NULL'
}
