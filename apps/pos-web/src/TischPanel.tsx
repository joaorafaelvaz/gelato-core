import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { signWithFallback, type TseProvider, type TaxRate } from '@gelato/compliance'
import {
  listTables,
  getSession,
  openTable,
  payTable,
  transferTable,
  addBestellung,
  imageUrlFor,
  type TableRow,
  type SessionView,
  type ApiProduct,
} from './api'
import { CategoryIcon, IconTrash } from './icons'
import { tableState } from './tischplan-util'

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
 * Salão (mesas): grade de mesas (rola/arrasta, touch-friendly) + caixa de
 * pagamento fixa à direita — dá pra ver o que está na mesa e fechar a conta
 * direto por aqui, sem precisar do login do garçom que abriu a mesa. Lançar
 * item continua sendo feito pela máquina do garçom (cardápio principal).
 */
export function TischPanel({
  token,
  kasse,
  products,
  rates: _rates,
  tse,
}: {
  token: string
  kasse: string
  products: ApiProduct[]
  rates: TaxRate[]
  tse: TseProvider
}) {
  const { t } = useTranslation()
  const [tables, setTables] = useState<TableRow[]>([])
  const [session, setSession] = useState<SessionView | null>(null)
  const [msg, setMsg] = useState('')
  // Pagamento/transferência
  const [parts, setParts] = useState('2')
  const [transferTo, setTransferTo] = useState('')
  // Seleção de itens (pagar só o que foi escolhido) — chave `productId|mwstCode`
  const [selected, setSelected] = useState<Set<string>>(new Set())
  // Remover item exige 2 toques (sem window.confirm — trava tela touch/kiosk)
  const [voidArmed, setVoidArmed] = useState<string | null>(null)

  const refresh = (): void => {
    void listTables(token, kasse).then(setTables).catch(() => setTables([]))
  }
  useEffect(() => {
    refresh()
    // A planta não é a única a mexer nas mesas (outros operadores, simulação) —
    // repolla pra não ficar com status desatualizado na tela.
    const id = setInterval(refresh, 5000)
    return () => clearInterval(id)
  }, [token, kasse])

  async function open(tbl: TableRow): Promise<void> {
    setSelected(new Set())
    setVoidArmed(null)
    try {
      const id = tbl.openSessionId ?? (await openTable(token, tbl.id, kasse)).id
      setSession(await getSession(token, id))
      setMsg('')
    } catch {
      // Outro operador/waiter pode ter pego a mesa entre o clique e a chamada —
      // atualiza a planta e avisa, em vez de deixar a sessão antiga na tela.
      setMsg(t('pos.tables.openFailed'))
    }
    refresh()
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
      setMsg(t('pos.tables.settled'))
      setSession(null)
      refresh()
    } else {
      setMsg(t('pos.tables.paidPartial', { paid: euro(pay), remaining: euro(r.remainingGross) }))
      setSession(await getSession(token, session.id))
    }
  }

  function splitPay(): void {
    const n = Math.max(1, Math.floor(Number(parts) || 1))
    void payAmount(Math.ceil(remainingGross() / n))
  }

  const lineKey = (l: { productId: string; mwstCode: string }): string => `${l.productId}|${l.mwstCode}`
  const lineGross = (l: { net: number; mwstRate: number }): number => l.net + Math.round(l.net * l.mwstRate)

  function toggleSelect(key: string): void {
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  /** Paga só as linhas marcadas (ex.: cada cliente paga o que pediu). */
  async function paySelected(): Promise<void> {
    if (!session || selected.size === 0) return
    const lines = session.tab.lines.filter((l) => l.qty > 0 && selected.has(lineKey(l)))
    if (lines.length === 0) return
    const gross = lines.reduce((s, l) => s + lineGross(l), 0)
    const byRate = new Map<number, number>()
    for (const l of lines) byRate.set(l.mwstRate, (byRate.get(l.mwstRate) ?? 0) + lineGross(l))
    const outcome = await signWithFallback(tse, {
      clientId: 'c1',
      processType: 'Kassenbeleg-V1',
      amountsByVatRate: Array.from(byRate, ([rate, g]) => ({ rate, gross: g })),
      paymentType: 'Bar',
      grossTotal: gross,
    })
    const tse_transaction = outcome.kind === 'signed' ? tseFields(outcome.tse) : { is_ausfall: true }
    const r = await payTable(token, session.id, {
      client_event_id: crypto.randomUUID(),
      items: lines.map((l) => ({ product_id: l.productId, mwst_code: l.mwstCode, qty: l.qty })),
      payment: { method: 'cash', amount: gross },
      tse: tse_transaction,
    })
    setSelected(new Set())
    if (r.settled) {
      setMsg(t('pos.tables.settled'))
      setSession(null)
      refresh()
    } else {
      setMsg(t('pos.tables.paidPartial', { paid: euro(gross), remaining: euro(r.remainingGross) }))
      setSession(await getSession(token, session.id))
    }
  }

  /** Toque num item ainda não armado só arma a confirmação (troca o ícone); um
   * segundo toque no mesmo item de fato remove. Evita `window.confirm` — trava
   * a tela inteira num kiosk touch e não passa pelo mesmo caminho de teclado. */
  function requestVoid(key: string, line: SessionView['tab']['lines'][number]): void {
    if (voidArmed === key) {
      setVoidArmed(null)
      void voidLine(line)
    } else {
      setVoidArmed(key)
    }
  }

  /** Remove um item já lançado — lança uma Bestellung de correção (qty negativa,
   * mesmo preço unitário), assinada na TSE como qualquer outro lançamento, em vez
   * de apagar o registro (a Bestellung é append-only / imutável para fins fiscais). */
  async function voidLine(line: SessionView['tab']['lines'][number]): Promise<void> {
    if (!session) return
    const gross = -lineGross(line)
    const outcome = await signWithFallback(tse, {
      clientId: 'c1',
      processType: 'Bestellung-V1',
      amountsByVatRate: [{ rate: line.mwstRate, gross }],
      paymentType: 'Bar',
      grossTotal: gross,
    })
    const tse_transaction = outcome.kind === 'signed' ? tseFields(outcome.tse) : { is_ausfall: true }
    await addBestellung(token, session.id, {
      client_event_id: crypto.randomUUID(),
      type: 'bestellung',
      session_id: session.id,
      kasse_id: kasse,
      items: [{ product_id: line.productId, qty: -line.qty, unit_net: Math.round(line.net / line.qty), mwst_rate: line.mwstRate, mwst_code: line.mwstCode }],
      tse_transaction,
    })
    setSelected((s) => {
      const next = new Set(s)
      next.delete(lineKey(line))
      return next
    })
    setSession(await getSession(token, session.id))
    refresh()
  }

  async function doTransfer(): Promise<void> {
    if (!session || !transferTo) return
    await transferTable(token, session.id, transferTo)
    setTransferTo('')
    setSession(await getSession(token, session.id))
    refresh()
  }

  const freeTables = tables.filter((tbl) => !tbl.openSessionId && tbl.id !== session?.tischId)
  const productById = new Map(products.map((p) => [p.id, p]))

  return (
    <section className="card">
      <h3>{t('pos.tables.title')}</h3>
      <p className="muted" style={{ margin: '0 0 8px' }}>
        {t('pos.tables.hint')}
      </p>
      <div className="salon-layout">
        <DragScrollGrid tables={tables} onOpen={(tbl) => void open(tbl)} />

        {session && (
          /* Caixa de pagamento da mesa — dá pra fechar a conta direto por aqui,
             sem precisar estar logado como o garçom que abriu a mesa. */
          <aside className="pos-cart salon-cart">
            <div className="pos-cart-header">
              <h3>{t('pos.tables.tab')} — {tables.find((tb) => tb.id === session.tischId)?.name ?? session.tischId}</h3>
            </div>
            <div className="cart-lines">
              {session.tab.lines.filter((l) => l.qty > 0).length === 0 ? (
                <p className="muted">{t('pos.cart.empty')}</p>
              ) : (
                session.tab.lines.filter((l) => l.qty > 0).map((line) => {
                  const product = productById.get(line.productId)
                  const key = lineKey(line)
                  return (
                    <div key={key} className="cart-line">
                      <div className="cart-line-main">
                        <input
                          type="checkbox"
                          className="cart-line-check"
                          checked={selected.has(key)}
                          onChange={() => toggleSelect(key)}
                          title={t('pos.tables.selectToPay')}
                        />
                        <div className="cart-line-thumb">
                          {product?.imageUrl ? (
                            <img src={imageUrlFor(product.imageUrl)!} alt="" />
                          ) : (
                            <CategoryIcon name={undefined} className="icon" />
                          )}
                        </div>
                        <div className="cart-line-info">
                          <span>{product?.name ?? line.productId}</span>
                          <span className="cart-line-note">×{line.qty}</span>
                        </div>
                        <strong>{euro(lineGross(line))}</strong>
                        <button
                          type="button"
                          className={voidArmed === key ? 'cart-line-remove armed' : 'cart-line-remove'}
                          onClick={() => requestVoid(key, line)}
                          onBlur={() => setVoidArmed((k) => (k === key ? null : k))}
                          title={voidArmed === key ? t('pos.tables.confirmVoid', { name: product?.name ?? line.productId }) : t('pos.tables.voidItem')}
                        >
                          <IconTrash className="icon" />
                        </button>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
            <div className="cart-totals">
              <div className="cart-total-row">
                <span>{t('pos.cart.subtotal')}</span>
                <span>{euro(session.tab.totalGross)}</span>
              </div>
              {session.remaining && session.remaining.totalGross !== session.tab.totalGross && (
                <div className="cart-total-row">
                  <span>{t('pos.tables.remaining', { value: '' })}</span>
                  <span>{euro(session.remaining.totalGross)}</span>
                </div>
              )}
              <div className="cart-total-row cart-total-row-final">
                <span>{t('pos.cart.total')}</span>
                <strong>{euro(remainingGross())}</strong>
              </div>
            </div>
            <div className="cart-buttons">
              <button className="btn-primary" onClick={() => void payAmount()} disabled={remainingGross() <= 0}>
                {t('pos.tables.payAll')}
              </button>
              {selected.size > 0 && (
                <button className="btn-secondary" onClick={() => void paySelected()}>
                  {t('pos.tables.paySelected', { count: selected.size })}
                </button>
              )}
            </div>
            <div className="actions-row" style={{ marginTop: 4 }}>
              <label>
                {t('pos.tables.splitIn')}{' '}
                <input
                  type="number"
                  min={1}
                  value={parts}
                  onChange={(e) => setParts(e.target.value)}
                  style={{ width: 56 }}
                />
              </label>
              <button onClick={splitPay}>{t('pos.tables.payPart')}</button>
            </div>
            <div className="actions-row" style={{ marginTop: 4 }}>
              <select value={transferTo} onChange={(e) => setTransferTo(e.target.value)}>
                <option value="">{t('pos.tables.targetTable')}</option>
                {freeTables.map((tbl) => (
                  <option key={tbl.id} value={tbl.id}>
                    {tbl.name}
                  </option>
                ))}
              </select>
              <button onClick={() => void doTransfer()} disabled={!transferTo}>
                {t('pos.tables.transfer')}
              </button>
            </div>
          </aside>
        )}
      </div>
      {msg && <p className="report-line" style={{ marginTop: 8 }}>{msg}</p>}
    </section>
  )
}

/**
 * Grade do salão com arrastar-pra-rolar: no touch, o navegador já rola nativo
 * (não mexemos); no mouse (telas touch com caneta/emulação, ou teste em
 * desktop) apertar e arrastar no meio da tela também rola, como um kiosk.
 * Um arrasto real cancela o clique de abrir mesa (senão toda rolagem de
 * mouse abriria a mesa embaixo do cursor ao soltar).
 */
function DragScrollGrid({ tables, onOpen }: { tables: TableRow[]; onOpen: (t: TableRow) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x: number; y: number; scrollLeft: number; scrollTop: number; moved: boolean; pointerId: number } | null>(null)
  // Sobrevive ao pointerup (que já zera `drag`) até o clique seguinte ser avaliado —
  // é o que garante que um arrasto de verdade não vire uma abertura de mesa.
  const justDragged = useRef(false)

  function onPointerDown(e: React.PointerEvent): void {
    if (e.pointerType !== 'mouse') return // touch/caneta: deixa o navegador rolar nativo
    const el = ref.current
    if (!el) return
    drag.current = { x: e.clientX, y: e.clientY, scrollLeft: el.scrollLeft, scrollTop: el.scrollTop, moved: false, pointerId: e.pointerId }
    // Não captura o ponteiro aqui: em alguns navegadores, capturar já no down
    // pode suprimir o "click" nativo do botão (clique simples deixa de abrir a
    // mesa, principalmente em cliques rápidos seguidos). Só captura depois,
    // quando o movimento confirmar que é de fato um arrasto.
  }
  function onPointerMove(e: React.PointerEvent): void {
    const d = drag.current
    const el = ref.current
    if (!d || !el) return
    const dx = e.clientX - d.x
    const dy = e.clientY - d.y
    if (!d.moved && (Math.abs(dx) > 4 || Math.abs(dy) > 4)) {
      d.moved = true
      try { el.setPointerCapture(d.pointerId) } catch { /* ignora — não crítico */ }
    }
    if (d.moved) {
      el.scrollLeft = d.scrollLeft - dx
      el.scrollTop = d.scrollTop - dy
    }
  }
  function onPointerUp(): void {
    const d = drag.current
    if (d?.moved) {
      justDragged.current = true
      try { ref.current?.releasePointerCapture(d.pointerId) } catch { /* ignora */ }
    }
    drag.current = null
  }
  function handleOpen(t: TableRow): void {
    if (justDragged.current) {
      justDragged.current = false // era arrasto, não clique — consome a flag e ignora essa vez
      return
    }
    onOpen(t)
  }

  return (
    <div
      ref={ref}
      className="table-grid-scroll"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerUp}
    >
      <div className="table-grid">
        {tables.map((t) => {
          const occ = tableState(t) === 'occupied'
          return (
            <button
              key={t.id}
              type="button"
              className={occ ? 'table-card occupied' : 'table-card free'}
              onClick={() => handleOpen(t)}
            >
              <span className="table-card-name">{t.name}</span>
              {occ && t.openTotalGross != null && (
                <span className="table-card-total">{euro(t.openTotalGross)}</span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
