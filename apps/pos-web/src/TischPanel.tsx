import { useEffect, useRef, useState } from 'react'
import { signWithFallback, buildSaleLine, type TseProvider, type TaxRate } from '@gelato/compliance'
import {
  listTables,
  getSession,
  openTable,
  addBestellung,
  payTable,
  transferTable,
  updateTablePosition,
  type TableRow,
  type SessionView,
  type ApiProduct,
} from './api'
import { tableState, clampPosition } from './tischplan-util'

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
 * Salão (mesas): lista/abre mesas, compõe a linha (produto → variante + modifiers via
 * controles reais), lança Bestellung-V1, e fecha com Kassenbeleg-V1 (total, split por
 * partes, ou transferência). Tischplan visual rico = 1a-4.
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
  // Composição da linha
  const [sel, setSel] = useState<ApiProduct | null>(null)
  const [variantId, setVariantId] = useState('')
  const [mods, setMods] = useState<Record<string, boolean>>({})
  // Pagamento/transferência
  const [parts, setParts] = useState('2')
  const [transferTo, setTransferTo] = useState('')

  const refresh = (): void => {
    void listTables(token, kasse).then(setTables).catch(() => setTables([]))
  }
  useEffect(refresh, [token, kasse])

  async function open(t: TableRow): Promise<void> {
    const id = t.openSessionId ?? (await openTable(token, t.id, kasse)).id
    setSession(await getSession(token, id))
    setSel(null)
    refresh()
  }

  async function moveTable(id: string, x: number, y: number): Promise<void> {
    await updateTablePosition(token, id, x, y)
    refresh()
  }

  function selectProduct(p: ApiProduct): void {
    setSel(p)
    setVariantId(p.variants?.[0]?.id ?? '')
    setMods({})
  }

  /** Linha composta a partir da seleção atual (variante + modifiers marcados). */
  function composeLine(p: ApiProduct) {
    const variant = p.variants?.find((v) => v.id === variantId)
    const chosen = (p.modifiers ?? []).filter((m) => mods[m.id])
    const line = buildSaleLine(
      { baseNetCents: p.netCents, mwstCode: p.mwstCodeImHaus },
      variant ? { netCents: variant.netCents } : undefined,
      chosen.map((m) => ({ id: m.id, name: m.name, net: m.netCents })),
    )
    return { line, variant }
  }

  async function addLine(): Promise<void> {
    if (!session || !sel) return
    const { line, variant } = composeLine(sel)
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
        { product_id: sel.id, variant_id: variant?.id, qty: 1, unit_net: line.unitNet, mwst_rate: rate, mwst_code: line.mwstCode, modifiers: line.modifiers },
      ],
      tse_transaction,
    })
    setSel(null)
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

  function splitPay(): void {
    const n = Math.max(1, Math.floor(Number(parts) || 1))
    void payAmount(Math.ceil(remainingGross() / n))
  }

  async function doTransfer(): Promise<void> {
    if (!session || !transferTo) return
    await transferTable(token, session.id, transferTo)
    setTransferTo('')
    setSession(await getSession(token, session.id))
    refresh()
  }

  const freeTables = tables.filter((t) => !t.openSessionId && t.id !== session?.tischId)

  return (
    <section className="card">
      <h3>Salão (Tische)</h3>
      <p className="muted" style={{ margin: '0 0 8px' }}>
        Clique abre a conta · arraste reposiciona a mesa
      </p>
      <Tischplan tables={tables} onOpen={(t) => void open(t)} onMove={(id, x, y) => void moveTable(id, x, y)} />

      {session && (
        <div style={{ marginTop: 12 }}>
          <h3>
            Conta {session.tischId} — {euro(session.tab.totalGross)}
            {session.remaining && session.remaining.totalGross !== session.tab.totalGross
              ? ` (resta ${euro(session.remaining.totalGross)})`
              : ''}
          </h3>

          {/* Seleção de produto */}
          <div className="tiles">
            {products.map((p) => (
              <button
                key={p.id}
                className={sel?.id === p.id ? 'tile selected' : 'tile'}
                onClick={() => selectProduct(p)}
              >
                {p.name}
              </button>
            ))}
          </div>

          {/* Composer: variante + modifiers do produto selecionado */}
          {sel && (
            <div className="card" style={{ marginTop: 10, background: 'var(--bg)' }}>
              <strong>{sel.name}</strong>
              {sel.variants && sel.variants.length > 0 && (
                <label style={{ marginLeft: 8 }}>
                  Variante{' '}
                  <select value={variantId} onChange={(e) => setVariantId(e.target.value)}>
                    {sel.variants.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name} — {euro(v.netCents)}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {sel.modifiers && sel.modifiers.length > 0 && (
                <div className="actions-row" style={{ marginTop: 8 }}>
                  {sel.modifiers.map((m) => (
                    <label key={m.id}>
                      <input
                        type="checkbox"
                        checked={!!mods[m.id]}
                        onChange={(e) => setMods((prev) => ({ ...prev, [m.id]: e.target.checked }))}
                      />{' '}
                      {m.name} (+{euro(m.netCents)})
                    </label>
                  ))}
                </div>
              )}
              <div className="actions-row" style={{ marginTop: 10 }}>
                <span className="muted">Linha: {euro(composeLine(sel).line.unitNet)} (net)</span>
                <button className="btn-primary" onClick={() => void addLine()}>Adicionar</button>
                <button onClick={() => setSel(null)}>Cancelar</button>
              </div>
            </div>
          )}

          {/* Pagamento / split / transferência */}
          <div className="actions-row" style={{ marginTop: 10 }}>
            <button className="btn-primary" onClick={() => void payAmount()} style={{ flex: 1 }}>
              Pagar tudo
            </button>
            <label>
              Split em{' '}
              <input
                type="number"
                min={1}
                value={parts}
                onChange={(e) => setParts(e.target.value)}
                style={{ width: 64 }}
              />
            </label>
            <button onClick={splitPay}>Pagar 1 parte</button>
          </div>

          <div className="actions-row" style={{ marginTop: 8 }}>
            <select value={transferTo} onChange={(e) => setTransferTo(e.target.value)}>
              <option value="">— mesa destino —</option>
              {freeTables.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <button onClick={() => void doTransfer()} disabled={!transferTo}>
              Transferir
            </button>
          </div>
        </div>
      )}
      {msg && <p className="report-line" style={{ marginTop: 8 }}>{msg}</p>}
    </section>
  )
}

/** Planta visual do salão: mesas posicionadas (posX/posY), cor por estado; arrastar
 * reposiciona+salva (PATCH), clicar (sem arrastar) abre/continua a conta. */
function Tischplan({
  tables,
  onOpen,
  onMove,
}: {
  tables: TableRow[]
  onOpen: (t: TableRow) => void
  onMove: (id: string, x: number, y: number) => void
}) {
  const W = 480
  const H = 360
  const TW = 110
  const TH = 60
  const ref = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<{ id: string; dx: number; dy: number; x: number; y: number; moved: boolean } | null>(null)

  function down(e: React.PointerEvent, t: TableRow): void {
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // setPointerCapture pode rejeitar (ex.: pointer já liberado) — ignora.
    }
    const rect = ref.current!.getBoundingClientRect()
    setDrag({ id: t.id, dx: e.clientX - rect.left - (t.posX ?? 0), dy: e.clientY - rect.top - (t.posY ?? 0), x: t.posX ?? 0, y: t.posY ?? 0, moved: false })
  }
  function move(e: React.PointerEvent): void {
    if (!drag) return
    const rect = ref.current!.getBoundingClientRect()
    const p = clampPosition(e.clientX - rect.left - drag.dx, e.clientY - rect.top - drag.dy, { w: W, h: H, tw: TW, th: TH })
    setDrag({ ...drag, x: p.x, y: p.y, moved: drag.moved || Math.abs(p.x - drag.x) > 5 || Math.abs(p.y - drag.y) > 5 })
  }
  function up(t: TableRow): void {
    if (!drag) return
    if (drag.moved) onMove(drag.id, drag.x, drag.y)
    else onOpen(t)
    setDrag(null)
  }

  return (
    <div ref={ref} className="plan" style={{ width: W, height: H }}>
      {tables.map((t) => {
        const pos = drag?.id === t.id ? { x: drag.x, y: drag.y } : { x: t.posX ?? 0, y: t.posY ?? 0 }
        const occ = tableState(t) === 'occupied'
        return (
          <div
            key={t.id}
            className={occ ? 'plan-table occupied' : 'plan-table free'}
            onPointerDown={(e) => down(e, t)}
            onPointerMove={move}
            onPointerUp={() => up(t)}
            style={{ left: pos.x, top: pos.y, width: TW, height: TH }}
          >
            <div>
              {t.name}
              {occ && t.openTotalGross != null ? (
                <>
                  <br />
                  {euro(t.openTotalGross)}
                </>
              ) : null}
            </div>
          </div>
        )
      })}
    </div>
  )
}
