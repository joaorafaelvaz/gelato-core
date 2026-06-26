import { useEffect, useState } from 'react'
import { signWithFallback, buildSaleLine, type TseProvider, type TaxRate } from '@gelato/compliance'
import {
  listTables,
  getSession,
  openTable,
  addBestellung,
  payTable,
  transferTable,
  type TableRow,
  type SessionView,
  type ApiProduct,
  type ApiVariant,
} from './api'

const euro = (c: number): string =>
  (c / 100).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })

/** Mapeia o resultado da TSE para o formato do evento (snake_case). */
function tseFields(r: {
  txNumber: number
  signatureCounter: number
  signatureValue: string
  logTime: string
  processType: string
  serialNumber: string
  publicKey: string
}) {
  return {
    tx_number: r.txNumber,
    signature_counter: r.signatureCounter,
    signature_value: r.signatureValue,
    log_time: r.logTime,
    process_type: r.processType,
    serial_number: r.serialNumber,
    public_key: r.publicKey,
  }
}

/**
 * Fluxo mínimo de salão (1a-1): lista mesas, abre/continua conta, lança Bestellung
 * (assinada Bestellung-V1) e fecha com Kassenbeleg-V1. UI rica de Tischplan = 1a-4.
 */
export function TischPanel({
  token,
  kasse,
  products,
  rates,
  tse,
}: {
  token: string
  kasse: string
  products: ApiProduct[]
  rates: TaxRate[]
  tse: TseProvider
}) {
  const [tables, setTables] = useState<TableRow[]>([])
  const [session, setSession] = useState<SessionView | null>(null)
  const [msg, setMsg] = useState('')

  const refresh = (): void => {
    void listTables(token, kasse).then(setTables).catch(() => setTables([]))
  }
  useEffect(refresh, [token, kasse])

  async function open(t: TableRow): Promise<void> {
    const id = t.openSessionId ?? (await openTable(token, t.id, kasse)).id
    setSession(await getSession(token, id))
    refresh()
  }

  async function fire(p: ApiProduct): Promise<void> {
    if (!session) return
    // Variante (se houver) + modifiers (seleção simples por nome).
    let variant: ApiVariant | undefined
    if (p.variants && p.variants.length > 0) {
      const choice = window.prompt(`Variante (${p.variants.map((v) => v.name).join('/')}):`, p.variants[0]!.name)
      variant = p.variants.find((v) => v.name === choice) ?? p.variants[0]
    }
    let chosen: ApiVariant[] = []
    if (p.modifiers && p.modifiers.length > 0) {
      const sel = window.prompt(`Modifiers (vírgula): ${p.modifiers.map((m) => m.name).join(', ')}`, '')
      const names = (sel ?? '').split(',').map((s) => s.trim()).filter(Boolean)
      chosen = p.modifiers.filter((m) => names.includes(m.name))
    }
    const line = buildSaleLine(
      { baseNetCents: p.netCents, mwstCode: p.mwstCodeImHaus },
      variant ? { netCents: variant.netCents } : undefined,
      chosen.map((m) => ({ id: m.id, name: m.name, net: m.netCents })),
    )
    const rate = rates.find((r) => r.code === line.mwstCode)?.rate ?? 0
    const gross = line.unitNet + Math.round(line.unitNet * rate)
    const outcome = await signWithFallback(tse, {
      clientId: 'c1',
      processType: 'Bestellung-V1',
      amountsByVatRate: [{ rate, gross }],
      paymentType: 'Bar',
      grossTotal: gross,
    })
    const tse_transaction = outcome.kind === 'signed' ? tseFields(outcome.tse) : { is_ausfall: true }
    await addBestellung(token, session.id, {
      client_event_id: crypto.randomUUID(),
      type: 'bestellung',
      session_id: session.id,
      kasse_id: kasse,
      items: [
        { product_id: p.id, variant_id: variant?.id, qty: 1, unit_net: line.unitNet, mwst_rate: rate, mwst_code: line.mwstCode, modifiers: line.modifiers },
      ],
      tse_transaction,
    })
    setSession(await getSession(token, session.id))
  }

  const remainingGross = (): number => session?.remaining?.totalGross ?? session?.tab.totalGross ?? 0

  /** Paga `amount` (parcial ou total). `amount` omitido = quita o restante. */
  async function payAmount(amount?: number): Promise<void> {
    if (!session) return
    const pay = amount ?? remainingGross()
    if (pay <= 0) return
    const outcome = await signWithFallback(tse, {
      clientId: 'c1',
      processType: 'Kassenbeleg-V1',
      amountsByVatRate: session.tab.byVatRate.map((g) => ({ rate: g.rate, gross: g.gross })),
      paymentType: 'Bar',
      grossTotal: pay,
    })
    const tse_transaction = outcome.kind === 'signed' ? tseFields(outcome.tse) : { is_ausfall: true }
    const r = await payTable(token, session.id, {
      client_event_id: crypto.randomUUID(),
      amount: pay,
      payment: { method: 'cash', amount: pay },
      tse: tse_transaction,
    })
    if (r.settled) {
      setMsg('Mesa quitada')
      setSession(null)
      refresh()
    } else {
      setMsg(`Pago ${euro(pay)} — resta ${euro(r.remainingGross)}`)
      setSession(await getSession(token, session.id))
    }
  }

  async function transfer(): Promise<void> {
    if (!session) return
    const target = window.prompt('Transferir para a mesa (id):')
    if (!target) return
    await transferTable(token, session.id, target)
    setSession(await getSession(token, session.id))
    refresh()
  }

  return (
    <section style={{ marginTop: 16, borderTop: '1px solid #ddd', paddingTop: 8 }}>
      <h3>Salão (Tische)</h3>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {tables.map((t) => (
          <button key={t.id} onClick={() => void open(t)}>
            {t.name}
            {t.openSessionId ? ' • aberta' : ''}
          </button>
        ))}
      </div>
      {session && (
        <div style={{ marginTop: 8 }}>
          <p style={{ fontWeight: 600 }}>
            Conta {session.tischId} — {euro(session.tab.totalGross)}
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
            {products.map((p) => (
              <button key={p.id} onClick={() => void fire(p)}>
                + {p.name}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            <button onClick={() => void payAmount()} style={{ flex: 1, padding: 8 }}>
              Pagar tudo
            </button>
            <button onClick={() => void payAmount(Math.ceil(remainingGross() / 2))} style={{ padding: 8 }}>
              Split ÷2
            </button>
            <button onClick={() => void transfer()} style={{ padding: 8 }}>
              Transferir
            </button>
          </div>
        </div>
      )}
      {msg && <p style={{ fontSize: 13 }}>{msg}</p>}
    </section>
  )
}
