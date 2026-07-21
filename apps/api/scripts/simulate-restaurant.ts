/**
 * Simulador de restaurante — roda no gelato-core (o caixa), usando a API HTTP
 * real (mesma que o pos-web usa), com fiscal real (MwSt + TSE sandbox). Não é
 * um evento fake: cada mesa aberta, item lançado e pagamento é uma operação de
 * verdade no banco do caixa — por isso a integração com o Skyview já reflete
 * tudo automaticamente, sem nenhum código extra do lado do Skyview.
 *
 * Uso:
 *   pnpm --filter @gelato/api run simulate
 *   SIM_SPEED=20 pnpm --filter @gelato/api run simulate   # 20x mais rápido (demo)
 */
import { config } from 'dotenv'
config()
import { randomUUID } from 'node:crypto'
import { FakeTseProvider, signWithFallback, buildSaleLine, type SignOutcome } from '@gelato/compliance'

const API = process.env.SIM_API_URL || 'http://127.0.0.1:3001'
const KASSE_ID = process.env.SIM_KASSE_ID || 'demo-kasse'
const SPEED = Number(process.env.SIM_SPEED || 1) // multiplicador de velocidade (1 = tempo real)

// Push para o Skyview (Mapa de Mesas / Relatório de Mesas / Pedidos do Caixa /
// Financeiro / Estoque) via o endpoint real de integração do caixa. Best-effort:
// se o Skyview estiver fora do ar, a simulação real no gelato-core continua normal.
const SKYVIEW_URL = process.env.SKYVIEW_API_URL || 'http://127.0.0.1:3000'
const SKYVIEW_KEY = process.env.SKYVIEW_API_KEY || ''
let skyviewWarned = false

const WAITERS = [
  { name: 'Lubi', pin: '1101' },
  { name: 'Adriano', pin: '1102' },
  { name: 'Ebra', pin: '1103' },
  { name: 'Bedi', pin: '1104' },
]

interface ApiProduct {
  id: string
  name: string
  netCents: number
  mwstCodeImHaus: string
  active: boolean
}
interface ApiTaxRate {
  code: string
  rate: string
}
interface ApiTable {
  id: string
  name: string
  openSessionId: string | null
}

const euro = (c: number): string => (c / 100).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })
const randInt = (min: number, max: number): number => Math.floor(Math.random() * (max - min + 1)) + min
const pick = <T,>(arr: T[]): T => arr[randInt(0, arr.length - 1)]!
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, Math.max(0, ms)))
const log = (...args: unknown[]): void => console.log(`[${new Date().toLocaleTimeString('de-DE')}]`, ...args)

/** Curva de movimento por hora do dia (0 a 1) — pico no almoço e no jantar. */
const HOURLY_PACE: Record<number, number> = {
  8: 0.15, 9: 0.25, 10: 0.3, 11: 0.55, 12: 1, 13: 1, 14: 0.6, 15: 0.3,
  16: 0.35, 17: 0.5, 18: 0.75, 19: 0.9, 20: 1, 21: 0.8, 22: 0.4, 23: 0.15,
}
function occupancyPace(hour: number): number {
  return HOURLY_PACE[hour] ?? 0.1
}

function tseFields(r: SignOutcome & { kind: 'signed' }) {
  return {
    tx_number: r.tse.txNumber,
    signature_counter: r.tse.signatureCounter,
    signature_value: r.tse.signatureValue,
    log_time: r.tse.logTime,
    process_type: r.tse.processType,
    serial_number: r.tse.serialNumber,
    public_key: r.tse.publicKey,
  }
}

async function api<T>(path: string, token?: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  })
  if (!res.ok) throw new Error(`${init?.method ?? 'GET'} ${path} -> ${res.status}: ${await res.text()}`)
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T)
}

async function loginWaiter(pin: string): Promise<string> {
  const r = await api<{ access_token: string }>('/auth/pin', undefined, {
    method: 'POST',
    body: JSON.stringify({ kasse_id: KASSE_ID, pin }),
  })
  return r.access_token
}

/** Narra uma fase sem efeito fiscal (ex.: "em preparo") no feed do Skyview. */
async function narrate(token: string, type: string, payload: Record<string, unknown>): Promise<void> {
  try {
    await api('/pos/sim/narrate', token, {
      method: 'POST',
      body: JSON.stringify({ kasse_id: KASSE_ID, type, payload }),
    })
  } catch {
    // narrativa é best-effort — nunca deve travar o ciclo real
  }
}

/** "Tisch 12" (gelato-core) -> "Mesa 12" (nome cadastrado no Mapa de Mesas do Skyview). */
function tischToMesaNome(tischName: string): string {
  const n = tischName.match(/\d+/)?.[0]
  return n ? `Mesa ${n}` : tischName
}

async function pushSkyview(path: string, body: Record<string, unknown>): Promise<void> {
  if (!SKYVIEW_KEY) {
    if (!skyviewWarned) {
      skyviewWarned = true
      log('SKYVIEW_API_KEY não configurada — mesas/pedidos não serão enviados ao Skyview (só ao gelato-core).')
    }
    return
  }
  try {
    const res = await fetch(`${SKYVIEW_URL}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': SKYVIEW_KEY },
      body: JSON.stringify(body),
    })
    if (!res.ok) log(`Skyview ${path} -> ${res.status}: ${await res.text()}`)
  } catch (err) {
    log(`Skyview inacessível (${path}): ${err instanceof Error ? err.message : String(err)}`)
  }
}

interface CartLine { nomeProduto: string; quantidade: number; precoUnitario: number }

function pushStatusMesaOcupada(mesaNome: string, garcomNome: string, cart: CartLine[]): Promise<void> {
  const total = Math.round(cart.reduce((s, i) => s + i.quantidade * i.precoUnitario, 0) * 100) / 100
  return pushSkyview('/api/integracoes/caixa/status-mesa', {
    mesaNome, status: 'ocupada', garcomNome,
    pedidoAtual: { itens: cart.map((i) => `${i.quantidade}x ${i.nomeProduto}`), total },
  })
}
function pushStatusMesaLivre(mesaNome: string): Promise<void> {
  return pushSkyview('/api/integracoes/caixa/status-mesa', { mesaNome, status: 'livre' })
}
function pushPedido(numeroPedido: string, mesaNome: string, garcomNome: string, status: 'aberto' | 'fechado', cart: CartLine[]): Promise<void> {
  return pushSkyview('/api/integracoes/caixa/pedido', { numeroPedido, mesaNome, garcomNome, status, itens: cart })
}
function pushPagamento(numeroPedido: string, valorEuros: number): Promise<void> {
  return pushSkyview('/api/integracoes/caixa/pagamento', { numeroPedido, forma: 'dinheiro', valor: valorEuros })
}

async function runWaiter(waiter: { name: string; pin: string }, products: ApiProduct[], rates: ApiTaxRate[]): Promise<void> {
  const token = await loginWaiter(waiter.pin)
  const tse = new FakeTseProvider({ serialNumber: `SIM-${waiter.name.toUpperCase()}` })
  log(`${waiter.name} logou no caixa (${KASSE_ID}).`)

  for (;;) {
    try {
      await sleep((randInt(90, 150) * 1000) / SPEED)

      const pace = occupancyPace(new Date().getHours())
      if (Math.random() > pace) continue // hora fraca: nem toda rodada vira atendimento

      const tables = await api<ApiTable[]>(`/pos/tables?kasse_id=${KASSE_ID}`, token)
      const free = tables.filter((t) => !t.openSessionId)
      if (free.length === 0) continue
      const table = pick(free)
      const pax = randInt(1, 6)

      const session = await api<{ id: string }>(`/pos/tables/${table.id}/open`, token, {
        method: 'POST',
        body: JSON.stringify({ kasse_id: KASSE_ID, pax }),
      })
      log(`${waiter.name}: mesa ${table.name} aberta — ${pax} pessoa(s).`)
      const ctx = { waiter: waiter.name, table_id: table.id, table_name: table.name, session_id: session.id }
      const mesaNome = tischToMesaNome(table.name)
      const cart: CartLine[] = []
      void pushStatusMesaOcupada(mesaNome, waiter.name, cart)
      await narrate(token, 'cliente_sentado', ctx)
      await sleep((randInt(1, 3) * 1000) / SPEED)
      await narrate(token, 'pedido_iniciado', ctx)

      const itemCount = randInt(1, 8)
      for (let i = 0; i < itemCount; i++) {
        const product = pick(products)
        const rate = rates.find((r) => r.code === product.mwstCodeImHaus)
        const rateNum = rate ? Number(rate.rate) : 0
        const line = buildSaleLine({ baseNetCents: product.netCents, mwstCode: product.mwstCodeImHaus }, undefined, [])
        const qty = randInt(1, 2)
        const gross = (line.unitNet + Math.round(line.unitNet * rateNum)) * qty
        const outcome = await signWithFallback(tse, {
          clientId: `sim-${waiter.name}`,
          processType: 'Bestellung-V1',
          amountsByVatRate: [{ rate: rateNum, gross }],
          paymentType: 'Bar',
          grossTotal: gross,
        })
        const tse_transaction = outcome.kind === 'signed' ? tseFields(outcome) : { is_ausfall: true }
        await api(`/pos/sessions/${session.id}/bestellung`, token, {
          method: 'POST',
          body: JSON.stringify({
            client_event_id: randomUUID(),
            type: 'bestellung',
            session_id: session.id,
            kasse_id: KASSE_ID,
            items: [{ product_id: product.id, qty, unit_net: line.unitNet, mwst_rate: rateNum, mwst_code: line.mwstCode }],
            tse_transaction,
          }),
        })
        cart.push({ nomeProduto: product.name, quantidade: qty, precoUnitario: gross / qty / 100 })
        void pushStatusMesaOcupada(mesaNome, waiter.name, cart)
        void pushPedido(session.id, mesaNome, waiter.name, 'aberto', cart)
        await sleep((randInt(3, 8) * 1000) / SPEED)
      }
      log(`${waiter.name}: pedido de ${table.name} enviado (${itemCount} item(ns)).`)
      await narrate(token, 'pedido_enviado_cozinha', { ...ctx, itens: itemCount })

      await sleep((randInt(8, 28) * 1000) / SPEED) // em preparo — varia bastante (fila da cozinha)
      await narrate(token, 'em_preparo', ctx)
      await sleep((randInt(8, 28) * 1000) / SPEED)
      await narrate(token, 'pedido_servido', ctx)

      await sleep((randInt(25, 100) * 1000) / SPEED) // cliente consumindo — bem variável (mesa de 1 vs mesa de 6)
      await narrate(token, 'cliente_consumindo', ctx)
      await sleep((randInt(10, 40) * 1000) / SPEED)
      await narrate(token, 'conta_solicitada', ctx)

      const current = await api<{ tab: { byVatRate: { rate: number; gross: number }[] }; remaining: { totalGross: number } }>(
        `/pos/sessions/${session.id}`,
        token,
      )
      if (current.remaining.totalGross <= 0) continue // pedido vazio raro — nada a cobrar
      const payOutcome = await signWithFallback(tse, {
        clientId: `sim-${waiter.name}`,
        processType: 'Kassenbeleg-V1',
        amountsByVatRate: current.tab.byVatRate.map((g) => ({ rate: g.rate, gross: g.gross })),
        paymentType: 'Bar',
        grossTotal: current.remaining.totalGross,
      })
      const pay_tse = payOutcome.kind === 'signed' ? tseFields(payOutcome) : { is_ausfall: true }
      await api(`/pos/sessions/${session.id}/pay`, token, {
        method: 'POST',
        body: JSON.stringify({
          client_event_id: randomUUID(),
          payment: { method: 'cash', amount: current.remaining.totalGross },
          tse: pay_tse,
        }),
      })
      log(`${waiter.name}: mesa ${table.name} pagou ${euro(current.remaining.totalGross)} — liberada.`)
      await narrate(token, 'pagamento_realizado', { ...ctx, valor: current.remaining.totalGross })
      await narrate(token, 'mesa_liberada', ctx)
      await pushPedido(session.id, mesaNome, waiter.name, 'fechado', cart)
      await pushPagamento(session.id, current.remaining.totalGross / 100)
      await pushStatusMesaLivre(mesaNome)
    } catch (err) {
      log(`${waiter.name}: erro no ciclo (seguindo) — ${err instanceof Error ? err.message : String(err)}`)
      await sleep(3000 / SPEED)
    }
  }
}

async function main(): Promise<void> {
  log(`Simulador iniciando — API ${API}, kasse ${KASSE_ID}, velocidade ${SPEED}x.`)
  const boot = await loginWaiter(WAITERS[0]!.pin)
  const [products, rates] = await Promise.all([
    api<ApiProduct[]>('/products', boot),
    api<ApiTaxRate[]>('/tax-rates', boot),
  ])
  const activeProducts = products.filter((p) => p.active)
  log(`Cardápio carregado: ${activeProducts.length} produtos ativos.`)

  await Promise.all(WAITERS.map((w) => runWaiter(w, activeProducts, rates)))
}

void main()
