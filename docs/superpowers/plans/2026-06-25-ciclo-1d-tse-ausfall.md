# TSE-Ausfall (Ciclo 1 · fatia 1d) Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Quando a assinatura TSE falha ou demora ao finalizar, a venda **completa mesmo assim** em modo Ausfall (sem assinatura, recibo sem QR), o período de indisponibilidade é registrado num log fiscal append-only, e o operador é alertado — sem nunca bloquear a venda nem assinar retroativamente.

**Architecture:** Uma política resiliente pura (`signWithFallback`, timeout via `Promise.race`) envolve **qualquer** `TseProvider`; um `AusfallTracker` puro emite eventos `started`/`ended` só na borda do período. `finalizeSale` (Electron + web) passa a usar ambos, grava a venda marcada `is_ausfall` e enfileira os eventos de Ausfall no outbox. O `/pos/sync` roteia por `type`: `sale` → ledger (guard relaxado), `tse_ausfall` → `tse_ausfall_log` append-only idempotente + audit.

**Tech Stack:** TypeScript strict, vitest (TDD), pnpm/turbo monorepo, NestJS + Prisma + Postgres (`gelato_c0`), zod, better-sqlite3 (Electron) / idb (web). Dinheiro em **cents**. **127.0.0.1**, nunca `localhost`.

**Spec:** `docs/superpowers/specs/2026-06-25-ciclo-1d-tse-ausfall-design.md`

---

## File Structure

**Criar:**
- `packages/compliance/src/tse/sign-with-fallback.ts` — política resiliente (timeout + união de resultado).
- `packages/compliance/src/tse/ausfall-tracker.ts` — máquina de estados pura do período.
- `packages/compliance/src/tse/test-doubles.ts` — `FailingTseProvider`, `HangingTseProvider`.
- `packages/compliance/test/sign-with-fallback.test.ts`, `packages/compliance/test/ausfall-tracker.test.ts`.
- `apps/api/test/ausfall.e2e.test.ts` — ingest Ausfall (venda + log) idempotente.
- `apps/api/test/tse-ausfall-capstone.e2e.test.ts` — capstone fim-a-fim.

**Modificar:**
- `packages/compliance/src/receipt/build.ts` — `tse` nullable → recibo Ausfall (sem QR).
- `packages/compliance/src/index.ts` — exportar os novos módulos.
- `packages/compliance/test/build.test.ts` — caso Ausfall (se existir; senão criar mínimo).
- `packages/domain/src/events.ts` — `tx_number` opcional + `is_ausfall`; `AusfallEventSchema`; `PosEventSchema`.
- `packages/sync/src/envelope.ts` — `makeAusfallEnvelope`.
- `apps/api/prisma/schema.prisma` — `TseTransaction` (campos nullable + `isAusfall`) + novo `TseAusfallLog`.
- `apps/api/prisma/migrations/<nova>/migration.sql` — append do bloco de imutabilidade da nova tabela.
- `apps/api/prisma/sql/immutability.sql` — atualizar listas (doc canônica).
- `apps/api/test/immutability.test.ts` — cobrir `tse_ausfall_log`.
- `apps/api/src/pos/sync.controller.ts` — parsear `PosEventSchema` e rotear por `type`.
- `apps/api/src/pos/ledger.service.ts` — guard relaxado + persiste `is_ausfall` + `ingestAusfall`.
- `apps/pos-web/src/store.ts` — `SaleStore` ganha `enqueueOutbox`/`getAusfallState`/`setAusfallState`.
- `apps/pos-web/src/idb-store.ts` — implementar os novos métodos (bump VERSION → 2, store `meta`).
- `apps/pos-web/src/sale.ts` — `finalizeSale` com fallback + tracker; `runOutboxOnce` tipa `PosEvent`.
- `apps/pos-web/src/App.tsx` — banner + recibo sem QR; rehidrata tracker.
- `apps/pos-terminal/src/db/local-repo.ts` — `enqueueOutbox`/`getAusfallState`/`setAusfallState` + tabela `meta`.
- `apps/pos-terminal/src/sale/finalize.ts` — idem `sale.ts` (versão sync repo).
- `apps/pos-terminal/src/main/index.ts` — owner do tracker; novo IPC `tse:ausfallState`; passa tracker ao finalize.
- `apps/pos-terminal/src/preload/index.ts` + `renderer/env.d.ts` + `renderer/App.tsx` — banner + isAusfall.

**Convenções de comandos** (deste repo):
- Pacote puro: `corepack pnpm --filter @gelato/<pkg> exec vitest run`
- Typecheck: `corepack pnpm exec tsc --noEmit -p <pkg>/tsconfig.json`
- API e2e (precisa Postgres `gelato_c0` no ar): `corepack pnpm --filter @gelato/api exec vitest run`
- Build de pacote puro consumido pela API (cjs/esm/dts): `corepack pnpm --filter @gelato/<pkg> build`

> **Atenção better-sqlite3 (ABI dupla):** rodar os testes do terminal exige ABI Node — se a GUI Electron foi compilada antes, rode `corepack pnpm install --force` (recompila p/ Node) antes dos testes do `@gelato/pos-terminal`. Não é preciso para os pacotes puros nem para a API.

---

## Chunk 1: compliance puro (signWithFallback, AusfallTracker, recibo Ausfall)

Tudo aqui é puro e sem rede — roda só com vitest do `@gelato/compliance`.

### Task 1.1: `signWithFallback` — timeout + união de resultado

**Files:**
- Create: `packages/compliance/src/tse/sign-with-fallback.ts`
- Create: `packages/compliance/src/tse/test-doubles.ts`
- Test: `packages/compliance/test/sign-with-fallback.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/compliance/test/sign-with-fallback.test.ts
import { describe, it, expect } from 'vitest'
import { signWithFallback } from '../src/tse/sign-with-fallback'
import { FakeTseProvider } from '../src/tse/fake'
import { FailingTseProvider, HangingTseProvider } from '../src/tse/test-doubles'
import type { TseSignRequest } from '../src/tse/types'

const req: TseSignRequest = {
  clientId: 'c1',
  processType: 'Kassenbeleg-V1',
  amountsByVatRate: [{ rate: 0.19, gross: 119 }],
  paymentType: 'Bar',
  grossTotal: 119,
}

describe('signWithFallback', () => {
  it('returns signed outcome when the TSE signs', async () => {
    const out = await signWithFallback(new FakeTseProvider({ serialNumber: 'X' }), req)
    expect(out.kind).toBe('signed')
    if (out.kind === 'signed') expect(out.tse.signatureValue).toContain('FAKE-SIG')
  })

  it('returns ausfall when the TSE throws', async () => {
    const out = await signWithFallback(new FailingTseProvider('boom'), req)
    expect(out.kind).toBe('ausfall')
    if (out.kind === 'ausfall') expect(out.reason).toContain('boom')
  })

  it('returns ausfall(timeout) when the TSE hangs past the timeout', async () => {
    const out = await signWithFallback(new HangingTseProvider(), req, { timeoutMs: 10 })
    expect(out.kind).toBe('ausfall')
    if (out.kind === 'ausfall') expect(out.reason).toBe('timeout')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm --filter @gelato/compliance exec vitest run test/sign-with-fallback.test.ts`
Expected: FAIL — `Cannot find module '../src/tse/sign-with-fallback'` (e `test-doubles`).

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/compliance/src/tse/test-doubles.ts
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
```

```ts
// packages/compliance/src/tse/sign-with-fallback.ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `corepack pnpm --filter @gelato/compliance exec vitest run test/sign-with-fallback.test.ts`
Expected: PASS (3 testes).

- [ ] **Step 5: Commit**

```bash
git add packages/compliance/src/tse/sign-with-fallback.ts packages/compliance/src/tse/test-doubles.ts packages/compliance/test/sign-with-fallback.test.ts
git commit -m "feat(compliance): signWithFallback (timeout -> Ausfall) + TSE test doubles"
```

### Task 1.2: `AusfallTracker` — período por borda

**Files:**
- Create: `packages/compliance/src/tse/ausfall-tracker.ts`
- Test: `packages/compliance/test/ausfall-tracker.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/compliance/test/ausfall-tracker.test.ts
import { describe, it, expect } from 'vitest'
import { AusfallTracker } from '../src/tse/ausfall-tracker'

describe('AusfallTracker', () => {
  it('opens the period on the first ausfall and not again', () => {
    const t = new AusfallTracker()
    expect(t.record('ausfall', '2026-06-25T10:00:00Z', 'timeout')).toEqual(['started'])
    expect(t.current).toEqual({ startedAt: '2026-06-25T10:00:00Z', reason: 'timeout' })
    expect(t.record('ausfall', '2026-06-25T10:01:00Z', 'timeout')).toEqual([]) // já aberto
  })

  it('closes the period once when signing recovers', () => {
    const t = new AusfallTracker({ startedAt: '2026-06-25T10:00:00Z', reason: 'timeout' })
    expect(t.record('signed', '2026-06-25T10:05:00Z')).toEqual(['ended'])
    expect(t.current).toBeNull()
    expect(t.record('signed', '2026-06-25T10:06:00Z')).toEqual([]) // já fechado
  })

  it('emits nothing while signing normally with no open period', () => {
    const t = new AusfallTracker()
    expect(t.record('signed', '2026-06-25T10:00:00Z')).toEqual([])
    expect(t.current).toBeNull()
  })

  it('rehydrates from a persisted open state', () => {
    const t = new AusfallTracker({ startedAt: '2026-06-25T09:00:00Z', reason: 'boom' })
    expect(t.current?.startedAt).toBe('2026-06-25T09:00:00Z')
    // não re-emite 'started' por estar aberto:
    expect(t.record('ausfall', '2026-06-25T09:01:00Z', 'boom')).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm --filter @gelato/compliance exec vitest run test/ausfall-tracker.test.ts`
Expected: FAIL — `Cannot find module '../src/tse/ausfall-tracker'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/compliance/src/tse/ausfall-tracker.ts

export type AusfallEventKind = 'started' | 'ended'

/** Estado persistível de um período de Ausfall em aberto. */
export interface AusfallOpenState {
  startedAt: string
  reason: string
}

/**
 * Máquina de estados pura do período de Ausfall. `record` é alimentado com o
 * resultado de cada tentativa de assinatura e retorna os eventos a emitir APENAS
 * na borda (entrar/sair), garantindo no máximo um par started→end por apagão.
 * Reidratável a partir do estado persistido (sobrevive a restart do terminal).
 */
export class AusfallTracker {
  private state: AusfallOpenState | null

  constructor(initial: AusfallOpenState | null = null) {
    this.state = initial
  }

  get current(): AusfallOpenState | null {
    return this.state
  }

  record(kind: 'signed' | 'ausfall', at: string, reason = ''): AusfallEventKind[] {
    if (kind === 'ausfall') {
      if (this.state) return []
      this.state = { startedAt: at, reason }
      return ['started']
    }
    if (!this.state) return []
    this.state = null
    return ['ended']
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `corepack pnpm --filter @gelato/compliance exec vitest run test/ausfall-tracker.test.ts`
Expected: PASS (4 testes).

- [ ] **Step 5: Commit**

```bash
git add packages/compliance/src/tse/ausfall-tracker.ts packages/compliance/test/ausfall-tracker.test.ts
git commit -m "feat(compliance): AusfallTracker (period edges, rehydratable)"
```

### Task 1.3: `buildReceipt` — ramo Ausfall (sem QR)

**Files:**
- Modify: `packages/compliance/src/receipt/build.ts`
- Test: `packages/compliance/test/receipt-ausfall.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/compliance/test/receipt-ausfall.test.ts
import { describe, it, expect } from 'vitest'
import { buildReceipt } from '../src/receipt/build'
import type { MwstBreakdown } from '../src/mwst/types'

const breakdown: MwstBreakdown = {
  groups: [{ code: 'reduced', rate: 0.07, net: 100, mwst: 7, gross: 107 }],
  totalNet: 100,
  totalMwst: 7,
  totalGross: 107,
}

const baseInput = {
  seller: { name: 'Demo' },
  issuedAt: '2026-06-25T10:00:00Z',
  mode: 'ausser_haus' as const,
  lines: [{ name: 'Eis', qty: 1, unitGross: 107, lineGross: 107, mwstCode: 'reduced' }],
  breakdown,
  payment: { method: 'cash', amount: 107 },
}

describe('buildReceipt — Ausfall', () => {
  it('omits the QR and marks isAusfall when tse is null', () => {
    const r = buildReceipt({ ...baseInput, tse: null })
    expect(r.isAusfall).toBe(true)
    expect(r.qrPayload).toBe('')
    expect(r.tse).toBeNull()
    expect(r.total.gross).toBe(107) // Belegausgabepflicht: recibo emitido normalmente
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm --filter @gelato/compliance exec vitest run test/receipt-ausfall.test.ts`
Expected: FAIL — `tse: null` não é atribuível (tipo) e/ou `isAusfall` não existe.

- [ ] **Step 3: Write minimal implementation**

Editar `packages/compliance/src/receipt/build.ts`:
- Em `ReceiptModel`: `tse: TseTransactionResult | null` e adicionar `isAusfall: boolean`.
- Em `BuildReceiptInput`: `tse: TseTransactionResult | null`.
- Reescrever `buildReceipt`:

```ts
export function buildReceipt(input: BuildReceiptInput): ReceiptModel {
  const t = input.tse
  const qrPayload = t
    ? buildDfkaQrPayload({
        version: 'V0',
        kasseSerialNumber: t.serialNumber,
        processType: t.processType,
        processData: t.processData,
        transactionNumber: t.txNumber,
        signatureCounter: t.signatureCounter,
        startTime: t.startTime,
        logTime: t.logTime,
        signatureAlgorithm: t.signatureAlgorithm,
        logTimeFormat: t.logTimeFormat,
        signature: t.signatureValue,
        publicKey: t.publicKey,
      })
    : ''

  return {
    seller: input.seller,
    issuedAt: input.issuedAt,
    mode: input.mode,
    lines: input.lines,
    vatGroups: input.breakdown.groups,
    total: {
      net: input.breakdown.totalNet,
      mwst: input.breakdown.totalMwst,
      gross: input.breakdown.totalGross,
    },
    payment: input.payment,
    tse: t,
    qrPayload,
    isAusfall: t === null,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `corepack pnpm --filter @gelato/compliance exec vitest run test/receipt-ausfall.test.ts`
Expected: PASS. Rodar também a suíte do pacote para garantir que os testes existentes do recibo continuam verdes:
`corepack pnpm --filter @gelato/compliance exec vitest run`

- [ ] **Step 5: Export os novos módulos**

Editar `packages/compliance/src/index.ts`, adicionar após a linha `export * from './tse/fake'`:

```ts
export * from './tse/sign-with-fallback'
export * from './tse/ausfall-tracker'
export * from './tse/test-doubles'
```

- [ ] **Step 6: Typecheck + build do pacote (consumido pela API/terminais em runtime)**

Run: `corepack pnpm exec tsc --noEmit -p packages/compliance/tsconfig.json`
Run: `corepack pnpm --filter @gelato/compliance build`
Expected: ambos sem erros (gera `dist` cjs/esm/dts atualizado).

- [ ] **Step 7: Commit**

```bash
git add packages/compliance/src/receipt/build.ts packages/compliance/src/index.ts packages/compliance/test/receipt-ausfall.test.ts
git commit -m "feat(compliance): Ausfall receipt branch (tse nullable, no QR) + exports"
```

---

## Chunk 2: domínio + sync (schema do evento, envelope)

### Task 2.1: schema — `tx_number` opcional, `is_ausfall`, `AusfallEvent`, `PosEvent`

**Files:**
- Modify: `packages/domain/src/events.ts`
- Test: `packages/domain/test/ausfall-event.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/domain/test/ausfall-event.test.ts
import { describe, it, expect } from 'vitest'
import { AusfallEventSchema, PosEventSchema, TseTransactionSchema } from '../src/events'

describe('Ausfall event schemas', () => {
  it('accepts a tse_transaction with is_ausfall and no signature/tx_number', () => {
    const parsed = TseTransactionSchema.parse({ is_ausfall: true })
    expect(parsed.is_ausfall).toBe(true)
    expect(parsed.tx_number).toBeUndefined()
  })

  it('validates a tse_ausfall started event', () => {
    const ev = {
      client_event_id: '11111111-1111-1111-1111-111111111111',
      type: 'tse_ausfall',
      kasse_id: 'demo-kasse',
      payload: { event_type: 'started', at: '2026-06-25T10:00:00Z', reason: 'timeout' },
    }
    expect(AusfallEventSchema.parse(ev).payload.event_type).toBe('started')
  })

  it('PosEvent discriminates by type', () => {
    const ausfall = PosEventSchema.parse({
      client_event_id: '22222222-2222-2222-2222-222222222222',
      type: 'tse_ausfall',
      kasse_id: 'k',
      payload: { event_type: 'ended', at: '2026-06-25T10:05:00Z' },
    })
    expect(ausfall.type).toBe('tse_ausfall')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm --filter @gelato/domain exec vitest run test/ausfall-event.test.ts`
Expected: FAIL — `AusfallEventSchema`/`PosEventSchema` não exportados; `is_ausfall` rejeitado.

- [ ] **Step 3: Write minimal implementation**

Editar `packages/domain/src/events.ts`:

Em `TseTransactionSchema`, trocar `tx_number: z.number().int(),` por:
```ts
  tx_number: z.number().int().optional(),
```
e adicionar dentro do objeto:
```ts
  is_ausfall: z.boolean().optional(),
```

Depois de `SaleEventSchema`, adicionar:
```ts
/** Evento de período de indisponibilidade da TSE (KassenSichV). Append-only no central. */
export const AusfallEventSchema = z.object({
  client_event_id: z.string().uuid(),
  type: z.literal('tse_ausfall'),
  kasse_id: z.string(),
  payload: z.object({
    event_type: z.enum(['started', 'ended']),
    at: z.string(),
    reason: z.string().optional(),
  }),
})

/** União dos eventos que o terminal sincroniza para o central via POST /pos/sync. */
export const PosEventSchema = z.discriminatedUnion('type', [SaleEventSchema, AusfallEventSchema])
```

E ao final, junto dos outros `export type`:
```ts
export type AusfallEvent = z.infer<typeof AusfallEventSchema>
export type PosEvent = z.infer<typeof PosEventSchema>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `corepack pnpm --filter @gelato/domain exec vitest run test/ausfall-event.test.ts`
Expected: PASS. Rodar a suíte do domínio inteira: `corepack pnpm --filter @gelato/domain exec vitest run`.

- [ ] **Step 5: Typecheck + build (domínio é consumido em runtime pela API)**

Run: `corepack pnpm exec tsc --noEmit -p packages/domain/tsconfig.json`
Run: `corepack pnpm --filter @gelato/domain build`
Expected: sem erros.

- [ ] **Step 6: Commit**

```bash
git add packages/domain/src/events.ts packages/domain/test/ausfall-event.test.ts
git commit -m "feat(domain): tse_transaction is_ausfall + AusfallEvent/PosEvent schemas"
```

### Task 2.2: `makeAusfallEnvelope`

**Files:**
- Modify: `packages/sync/src/envelope.ts`
- Test: `packages/sync/test/ausfall-envelope.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/sync/test/ausfall-envelope.test.ts
import { describe, it, expect } from 'vitest'
import { makeAusfallEnvelope } from '../src/envelope'

describe('makeAusfallEnvelope', () => {
  it('builds a valid tse_ausfall event with an injected id', () => {
    const id = '33333333-3333-3333-3333-333333333333'
    const ev = makeAusfallEnvelope(
      'demo-kasse',
      { event_type: 'started', at: '2026-06-25T10:00:00Z', reason: 'timeout' },
      () => id,
    )
    expect(ev).toEqual({
      client_event_id: id,
      type: 'tse_ausfall',
      kasse_id: 'demo-kasse',
      payload: { event_type: 'started', at: '2026-06-25T10:00:00Z', reason: 'timeout' },
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm --filter @gelato/sync exec vitest run test/ausfall-envelope.test.ts`
Expected: FAIL — `makeAusfallEnvelope` não existe.

- [ ] **Step 3: Write minimal implementation**

Editar `packages/sync/src/envelope.ts`. Trocar o import da 1ª linha para incluir o schema/tipo:
```ts
import {
  SaleEventSchema,
  AusfallEventSchema,
  type SaleEvent,
  type SalePayload,
  type AusfallEvent,
} from '@gelato/domain'
```
E adicionar ao final do arquivo:
```ts
/**
 * Monta um envelope de evento de Ausfall (período de indisponibilidade da TSE)
 * com `client_event_id` idempotente. Valida contra o schema do domínio.
 */
export function makeAusfallEnvelope(
  kasseId: string,
  payload: AusfallEvent['payload'],
  idGen: () => string = defaultIdGen,
): AusfallEvent {
  return AusfallEventSchema.parse({
    client_event_id: idGen(),
    type: 'tse_ausfall',
    kasse_id: kasseId,
    payload,
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `corepack pnpm --filter @gelato/sync exec vitest run test/ausfall-envelope.test.ts`
Expected: PASS. Suíte do sync: `corepack pnpm --filter @gelato/sync exec vitest run`.

- [ ] **Step 5: Typecheck**

Run: `corepack pnpm exec tsc --noEmit -p packages/sync/tsconfig.json`
Expected: sem erros. (Se `@gelato/sync` tiver build dist, rodar também `corepack pnpm --filter @gelato/sync build`.)

- [ ] **Step 6: Commit**

```bash
git add packages/sync/src/envelope.ts packages/sync/test/ausfall-envelope.test.ts
git commit -m "feat(sync): makeAusfallEnvelope"
```

---

## Chunk 3: modelo de dados + imutabilidade (Postgres)

> Precisa do Postgres `gelato_c0` no ar: `docker compose -f docker/docker-compose.yml up -d`.

### Task 3.1: schema Prisma — `TseTransaction` nullable + `isAusfall` + `TseAusfallLog`

**Files:**
- Modify: `apps/api/prisma/schema.prisma:277-292`

- [ ] **Step 1: Editar o modelo `TseTransaction`** (tornar assinatura nullable + flag)

```prisma
model TseTransaction {
  id               String    @id @default(cuid())
  orderId          String    @unique
  tseClientId      String?
  txNumber         Int?
  signatureCounter Int?
  signatureValue   String?
  logTime          DateTime?
  processType      String
  serialNumber     String?
  publicKey        String?
  isAusfall        Boolean   @default(false)

  order Order @relation(fields: [orderId], references: [id])

  @@map("tse_transactions")
}
```

- [ ] **Step 2: Adicionar o modelo `TseAusfallLog`** (logo após `TseTransaction`)

```prisma
model TseAusfallLog {
  id            String   @id @default(cuid())
  tenantId      String?
  kasseId       String
  eventType     String   // 'started' | 'ended'
  at            DateTime
  reason        String?
  clientEventId String   @unique
  createdAt     DateTime @default(now())

  @@map("tse_ausfall_log")
}
```

- [ ] **Step 3: Gerar a migração**

Run (a partir de `apps/api`):
`corepack pnpm --filter @gelato/api exec prisma migrate dev --name c1d_tse_ausfall`
Expected: cria `prisma/migrations/<timestamp>_c1d_tse_ausfall/migration.sql` com `CREATE TABLE "tse_ausfall_log"`, `ALTER TABLE "tse_transactions" ... DROP NOT NULL` (txNumber/signatureCounter/signatureValue/logTime) e `ADD COLUMN "isAusfall"`. Regenera o Prisma Client.

> Se o `migrate dev` reclamar de conexão, confirme `DATABASE_URL_OWNER` apontando para **127.0.0.1** (não `localhost`).

- [ ] **Step 4: Append do bloco de imutabilidade na migração nova**

Abrir o `migration.sql` recém-criado e **adicionar ao final** (mesmo padrão de `cash_movements` em `20260625092154_c1b_shifts_zreports/migration.sql:33-38`):

```sql
-- ===== Imutabilidade fiscal: tse_ausfall_log (append-only) =====
GRANT SELECT, INSERT ON tse_ausfall_log TO gelato_app;
DROP TRIGGER IF EXISTS tse_ausfall_log_append_only ON tse_ausfall_log;
CREATE TRIGGER tse_ausfall_log_append_only
  BEFORE UPDATE OR DELETE ON tse_ausfall_log
  FOR EACH ROW EXECUTE FUNCTION fiscal_append_only();
```

> `tse_transactions` já está na lista de imutabilidade (REVOKE + trigger desde o C0); tornar colunas nullable não afeta isso. A nova tabela `tse_ausfall_log` recebe só SELECT/INSERT (nunca UPDATE/DELETE) + trigger.

- [ ] **Step 5: Reaplicar a migração com o bloco anexado**

Como `migrate dev` já rodou o arquivo antes da edição, aplicar o bloco extra manualmente uma vez (idempotente):
Run: `corepack pnpm --filter @gelato/api exec prisma db execute --schema prisma/schema.prisma --file prisma/migrations/<timestamp>_c1d_tse_ausfall/migration.sql`
Expected: sucesso. (Em banco limpo, `migrate deploy` aplica tudo de uma vez — este passo extra é só porque editamos depois do `migrate dev`.)

- [ ] **Step 6: Atualizar a doc canônica de imutabilidade**

Editar `apps/api/prisma/sql/immutability.sql`: incluir `tse_ausfall_log` no comentário da lista de tabelas fiscais (linha 7-8) e nos dois arrays (`REVOKE ...` linha 15 e o `ARRAY[...]` do trigger linha 28-31). É documentação/refresh de init; mantém a fonte canônica fiel.

- [ ] **Step 7: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations apps/api/prisma/sql/immutability.sql
git commit -m "feat(db): tse_transactions nullable+isAusfall; tse_ausfall_log append-only"
```

### Task 3.2: teste de imutabilidade de `tse_ausfall_log`

**Files:**
- Modify: `apps/api/test/immutability.test.ts`

- [ ] **Step 1: Write the failing test** (adicionar helper + `it`)

Adicionar após `insertCashMovement` (linha 57):
```ts
async function insertAusfall(pool: Pool): Promise<string> {
  const id = `ausf_${Date.now()}_${Math.random().toString(36).slice(2)}`
  await pool.query(
    `INSERT INTO tse_ausfall_log (id, "kasseId", "eventType", at, "clientEventId", "createdAt")
     VALUES ($1, 'demo-kasse', 'started', now(), $1, now())`,
    [id],
  )
  return id
}
```
Adicionar dentro do `describe`, após o teste de `cash_movements`:
```ts
  it('tse_ausfall_log is append-only (INSERT ok, UPDATE/DELETE blocked)', async (ctx) => {
    if (!dbAvailable) return ctx.skip()
    const id = await insertAusfall(appPool)
    expect(id).toBeTruthy()
    await expect(
      appPool.query(`UPDATE tse_ausfall_log SET reason='x' WHERE id=$1`, [id]),
    ).rejects.toThrow()
    await expect(appPool.query(`DELETE FROM tse_ausfall_log WHERE id=$1`, [id])).rejects.toThrow()
  })
```

- [ ] **Step 2: Run test to verify it passes** (a tabela já existe e é append-only)

Run: `corepack pnpm --filter @gelato/api exec vitest run test/immutability.test.ts`
Expected: PASS — INSERT ok; UPDATE e DELETE lançam (REVOKE + trigger). Se UPDATE/DELETE **não** lançarem, o bloco do Step 4/5 da Task 3.1 não foi aplicado — reaplicar.

- [ ] **Step 3: Commit**

```bash
git add apps/api/test/immutability.test.ts
git commit -m "test(db): tse_ausfall_log append-only immutability"
```

---

## Chunk 4: API — /pos/sync roteado + ingestAusfall + guard relaxado

### Task 4.1: roteamento por `type` e `ingestAusfall`

**Files:**
- Modify: `apps/api/src/pos/sync.controller.ts`
- Modify: `apps/api/src/pos/ledger.service.ts`
- Test: `apps/api/test/ausfall.e2e.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/test/ausfall.e2e.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import { AppModule } from '../src/app.module'
import { PrismaService } from '../src/prisma/prisma.service'

// Helper de login por PIN reaproveitando o seed demo (operador PIN 1234 / demo-kasse).
async function pinToken(app: INestApplication): Promise<string> {
  const res = await app.getHttpServer ? null : null
  return '' // substituído abaixo
}

describe('TSE-Ausfall ingest (e2e)', () => {
  let app: INestApplication
  let prisma: PrismaService
  let token: string

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = mod.createNestApplication()
    await app.init()
    prisma = app.get(PrismaService)
    const server = app.getHttpServer()
    const { default: request } = await import('supertest')
    const login = await request(server).post('/auth/pin').send({ kasse_id: 'demo-kasse', pin: '1234' })
    token = login.body.access_token
  })

  afterAll(async () => {
    await app.close()
  })

  it('persists an ausfall started event into tse_ausfall_log + audit, idempotently', async () => {
    const { default: request } = await import('supertest')
    const id = '44444444-4444-4444-4444-444444444444'
    const event = {
      client_event_id: id,
      type: 'tse_ausfall',
      kasse_id: 'demo-kasse',
      payload: { event_type: 'started', at: '2026-06-25T10:00:00Z', reason: 'timeout' },
    }
    const r1 = await request(app.getHttpServer())
      .post('/pos/sync').set('authorization', `Bearer ${token}`).send(event)
    expect(r1.status).toBe(200)
    expect(r1.body.duplicate).toBe(false)

    const r2 = await request(app.getHttpServer())
      .post('/pos/sync').set('authorization', `Bearer ${token}`).send(event)
    expect(r2.body.duplicate).toBe(true)

    const rows = await prisma.tseAusfallLog.findMany({ where: { clientEventId: id } })
    expect(rows).toHaveLength(1)
    expect(rows[0].eventType).toBe('started')
  })

  it('ingests an ausfall sale (no signature) when is_ausfall is true', async () => {
    const { default: request } = await import('supertest')
    const id = '55555555-5555-5555-5555-555555555555'
    const saleEvent = {
      client_event_id: id,
      type: 'sale',
      kasse_id: 'demo-kasse',
      payload: {
        order: { mode: 'ausser_haus', total_net: 100, total_mwst: 7, total_gross: 107 },
        items: [{ product_id: 'p1', qty: 1, unit_net: 100, mwst_rate: 0.07, mwst_code: 'reduced' }],
        payment: { method: 'cash', amount: 107 },
        receipt: { qr_payload: '', format: 'digital' },
        tse_transaction: { is_ausfall: true },
      },
    }
    const r = await request(app.getHttpServer())
      .post('/pos/sync').set('authorization', `Bearer ${token}`).send(saleEvent)
    expect(r.status).toBe(200)
    const order = await prisma.order.findUnique({
      where: { clientEventId: id },
      include: { tseTransaction: true },
    })
    expect(order?.tseTransaction?.isAusfall).toBe(true)
    expect(order?.tseTransaction?.signatureValue).toBeNull()
  })
})
```

> Ajuste o `product_id: 'p1'` para um id de produto existente no seed se houver FK em `order_items.productId`. Se `order_items` referenciar `products` por FK, use o id semeado (ver `prisma/seed-run.ts`); senão, `p1` basta. Verificar no seed antes de rodar.

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm --filter @gelato/api exec vitest run test/ausfall.e2e.test.ts`
Expected: FAIL — `/pos/sync` rejeita `type: 'tse_ausfall'` (parse `SaleEventSchema`), e venda com `is_ausfall` cai no guard `incomplete TSE transaction data`.

- [ ] **Step 3: Implementar — controller roteia por `type`**

Editar `apps/api/src/pos/sync.controller.ts`:
- Import: `import { PosEventSchema } from '@gelato/domain'` (no lugar de `SaleEventSchema`).
- Corpo do método `sync`:
```ts
  async sync(@Req() req: PosRequest, @Body() body: unknown) {
    const event = parseOrThrow(PosEventSchema, body)
    const actor = { userId: req.user.sub, ip: req.ip, device: req.headers['user-agent'] }
    const result =
      event.type === 'tse_ausfall'
        ? await this.ledger.ingestAusfall(event, actor)
        : await this.ledger.ingest(event, actor)
    return { ok: true, ...result }
  }
```

- [ ] **Step 4: Implementar — `ledger.ingest` guard relaxado + persiste `is_ausfall`**

Editar `apps/api/src/pos/ledger.service.ts`:
- Import: adicionar `type AusfallEvent`:
  `import type { SaleEvent, AusfallEvent } from '@gelato/domain'`
- Trocar o bloco do guard (linhas ~39-46) por:
```ts
    const p = event.payload
    const te = p.tse_transaction
    const isAusfall = te.is_ausfall === true
    const signatureValue = te.signature_value
    const signatureCounter = te.signature_counter
    const logTime = te.log_time
    if (!isAusfall && (!signatureValue || signatureCounter == null || !logTime)) {
      throw new BadRequestException('incomplete TSE transaction data')
    }
```
- No `tseTransaction.create`, trocar para tolerar Ausfall:
```ts
          tseTransaction: {
            create: {
              txNumber: te.tx_number ?? null,
              signatureCounter: signatureCounter ?? null,
              signatureValue: signatureValue ?? null,
              logTime: logTime ? new Date(logTime) : null,
              processType: te.process_type ?? 'Kassenbeleg-V1',
              serialNumber: te.serial_number,
              publicKey: te.public_key,
              isAusfall,
            },
          },
```

- [ ] **Step 5: Implementar — `ingestAusfall`**

Adicionar o método na `LedgerService` (após `ingest`):
```ts
  async ingestAusfall(event: AusfallEvent, actor: Actor): Promise<{ duplicate: boolean }> {
    const seen = await this.prisma.syncEvent.findUnique({
      where: { clientEventId: event.client_event_id },
    })
    if (seen) return { duplicate: true }

    return this.prisma.$transaction(async (tx) => {
      await tx.tseAusfallLog.create({
        data: {
          kasseId: event.kasse_id,
          eventType: event.payload.event_type,
          at: new Date(event.payload.at),
          reason: event.payload.reason,
          clientEventId: event.client_event_id,
        },
      })
      await tx.syncEvent.create({
        data: { clientEventId: event.client_event_id, kasseId: event.kasse_id, type: event.type },
      })
      await tx.auditLog.create({
        data: {
          userId: actor.userId,
          action: `tse.ausfall.${event.payload.event_type}`,
          entity: 'tse_ausfall_log',
          entityId: event.client_event_id,
          payload: { reason: event.payload.reason ?? null },
          ip: actor.ip,
          device: actor.device,
        },
      })
      return { duplicate: false }
    })
  }
```

> Nota: o `receipt.create` usa `tseSignature: te as ... InputJsonValue` e `qrPayload: p.receipt.qr_payload`. Em Ausfall, `te` carrega `{ is_ausfall: true }` e `qr_payload` é `''` — ambos válidos. Sem mudança extra aqui.

- [ ] **Step 6: Run test to verify it passes**

Run: `corepack pnpm --filter @gelato/api exec vitest run test/ausfall.e2e.test.ts`
Expected: PASS (2 testes). Rodar a suíte da API para garantir que `sync`/ledger existentes não regrediram:
`corepack pnpm --filter @gelato/api exec vitest run`

- [ ] **Step 7: Typecheck**

Run: `corepack pnpm exec tsc --noEmit -p apps/api/tsconfig.json`
Expected: sem erros.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/pos/sync.controller.ts apps/api/src/pos/ledger.service.ts apps/api/test/ausfall.e2e.test.ts
git commit -m "feat(api): /pos/sync routes by type; ingestAusfall + is_ausfall sale path"
```

---

## Chunk 5: terminais — finalize com fallback + tracker + persistência

A lógica é igual nos dois terminais; muda só a forma do store (sync `LocalRepo` no Electron, async `SaleStore` no web). `finalizeSale` passa a: chamar `signWithFallback`, montar a venda assinada **ou** Ausfall, gravar local, **alimentar o tracker** (passado pelo caller), **enfileirar** os eventos `started`/`ended` no outbox e **persistir** o estado do período. Retorna `outcome` para a UI.

### Task 5.1: store local — `enqueueOutbox` + estado do período (Electron `LocalRepo`)

**Files:**
- Modify: `apps/pos-terminal/src/db/local-repo.ts`
- Test: `apps/pos-terminal/test/local-repo-ausfall.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/pos-terminal/test/local-repo-ausfall.test.ts
import { describe, it, expect } from 'vitest'
import { LocalRepo } from '../src/db/local-repo'
import { makeAusfallEnvelope } from '@gelato/sync'

describe('LocalRepo — ausfall outbox + period state', () => {
  it('enqueues an ausfall event into the outbox (no sale row)', () => {
    const repo = new LocalRepo(':memory:')
    const ev = makeAusfallEnvelope('demo-kasse', { event_type: 'started', at: 'now', reason: 'timeout' })
    repo.enqueueOutbox(ev.client_event_id, JSON.stringify(ev), 0)
    expect(repo.countOutbox('pending')).toBe(1)
    expect(repo.countSales()).toBe(0)
    repo.close()
  })

  it('persists and reads back the open ausfall state', () => {
    const repo = new LocalRepo(':memory:')
    expect(repo.getAusfallState()).toBeNull()
    repo.setAusfallState({ startedAt: 't0', reason: 'timeout' })
    expect(repo.getAusfallState()).toEqual({ startedAt: 't0', reason: 'timeout' })
    repo.setAusfallState(null)
    expect(repo.getAusfallState()).toBeNull()
    repo.close()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm --filter @gelato/pos-terminal exec vitest run test/local-repo-ausfall.test.ts`
Expected: FAIL — `enqueueOutbox`/`getAusfallState`/`setAusfallState` não existem.

> Se falhar com "Could not locate bindings" (ABI Electron), rode `corepack pnpm install --force` e repita.

- [ ] **Step 3: Write minimal implementation**

Editar `apps/pos-terminal/src/db/local-repo.ts`:
- Em `SCHEMA`, adicionar a tabela `meta`:
```sql
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```
- Import do tipo no topo: `import type { AusfallOpenState } from '@gelato/compliance'`.
- Adicionar métodos:
```ts
  /** Enfileira um evento (ex.: Ausfall) no outbox, sem linha de venda. Idempotente. */
  enqueueOutbox(clientEventId: string, payload: string, now: number = Date.now()): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO outbox (client_event_id, payload, status, attempts, next_attempt_at, created_at)
         VALUES (?, ?, 'pending', 0, 0, ?)`,
      )
      .run(clientEventId, payload, now)
  }

  getAusfallState(): AusfallOpenState | null {
    const row = this.db.prepare(`SELECT value FROM meta WHERE key = 'ausfall'`).get() as
      | { value: string }
      | undefined
    return row ? (JSON.parse(row.value) as AusfallOpenState) : null
  }

  setAusfallState(state: AusfallOpenState | null): void {
    if (state === null) {
      this.db.prepare(`DELETE FROM meta WHERE key = 'ausfall'`).run()
      return
    }
    this.db
      .prepare(
        `INSERT INTO meta (key, value) VALUES ('ausfall', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run(JSON.stringify(state))
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `corepack pnpm --filter @gelato/pos-terminal exec vitest run test/local-repo-ausfall.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/pos-terminal/src/db/local-repo.ts apps/pos-terminal/test/local-repo-ausfall.test.ts
git commit -m "feat(pos-terminal): LocalRepo enqueueOutbox + persisted ausfall state"
```

### Task 5.2: `SaleStore` (web) — mesmos métodos no IndexedDB

**Files:**
- Modify: `apps/pos-web/src/store.ts`
- Modify: `apps/pos-web/src/idb-store.ts`
- Test: `apps/pos-web/test/idb-ausfall.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/pos-web/test/idb-ausfall.test.ts
import { describe, it, expect } from 'vitest'
import 'fake-indexeddb/auto'
import { IdbStore } from '../src/idb-store'
import { makeAusfallEnvelope } from '@gelato/sync'

describe('IdbStore — ausfall outbox + period state', () => {
  it('enqueues an ausfall event and persists period state', async () => {
    const store = new IdbStore('test-ausfall-' + Math.random().toString(36).slice(2))
    const ev = makeAusfallEnvelope('demo-kasse', { event_type: 'started', at: 'now', reason: 'timeout' })
    await store.enqueueOutbox(ev.client_event_id, JSON.stringify(ev), 0)
    expect(await store.countOutbox('pending')).toBe(1)
    expect(await store.countSales()).toBe(0)

    expect(await store.getAusfallState()).toBeNull()
    await store.setAusfallState({ startedAt: 't0', reason: 'timeout' })
    expect(await store.getAusfallState()).toEqual({ startedAt: 't0', reason: 'timeout' })
    await store.setAusfallState(null)
    expect(await store.getAusfallState()).toBeNull()
  })
})
```

> `fake-indexeddb` já deve estar como devDep (usado pelos testes do pos-web). Se não estiver: `corepack pnpm --filter @gelato/pos-web add -D fake-indexeddb`.

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm --filter @gelato/pos-web exec vitest run test/idb-ausfall.test.ts`
Expected: FAIL — métodos inexistentes.

- [ ] **Step 3: Write minimal implementation**

Editar `apps/pos-web/src/store.ts` — estender a interface:
```ts
import type { AusfallOpenState } from '@gelato/compliance'
// ...
export interface SaleStore {
  saveFinalizedSale(event: SaleEvent, now?: number): Promise<void>
  enqueueOutbox(clientEventId: string, payload: string, now?: number): Promise<void>
  pendingOutbox(now?: number): Promise<OutboxRow[]>
  markSent(clientEventId: string): Promise<void>
  markFailed(clientEventId: string, nextAttemptAt: number): Promise<void>
  getAusfallState(): Promise<AusfallOpenState | null>
  setAusfallState(state: AusfallOpenState | null): Promise<void>
}
```

Editar `apps/pos-web/src/idb-store.ts`:
- Import: `import type { AusfallOpenState } from '@gelato/compliance'`.
- Bump `const VERSION = 2` e no `upgrade` adicionar o store `meta`:
```ts
        if (!db.objectStoreNames.contains('meta')) {
          db.createObjectStore('meta', { keyPath: 'key' })
        }
```
- Adicionar métodos:
```ts
  async enqueueOutbox(clientEventId: string, payload: string, now: number = Date.now()): Promise<void> {
    const db = await this.dbp
    if ((await db.getKey('outbox', clientEventId)) !== undefined) return
    await db.add('outbox', {
      client_event_id: clientEventId,
      payload,
      status: 'pending',
      attempts: 0,
      next_attempt_at: 0,
      created_at: now,
    })
  }

  async getAusfallState(): Promise<AusfallOpenState | null> {
    const db = await this.dbp
    const row = (await db.get('meta', 'ausfall')) as { key: string; value: AusfallOpenState } | undefined
    return row ? row.value : null
  }

  async setAusfallState(state: AusfallOpenState | null): Promise<void> {
    const db = await this.dbp
    if (state === null) {
      await db.delete('meta', 'ausfall')
      return
    }
    await db.put('meta', { key: 'ausfall', value: state })
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `corepack pnpm --filter @gelato/pos-web exec vitest run test/idb-ausfall.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/pos-web/src/store.ts apps/pos-web/src/idb-store.ts apps/pos-web/test/idb-ausfall.test.ts
git commit -m "feat(pos-web): SaleStore/IdbStore enqueueOutbox + persisted ausfall state"
```

### Task 5.3: `finalizeSale` (Electron) com fallback + tracker

**Files:**
- Modify: `apps/pos-terminal/src/sale/finalize.ts`
- Test: `apps/pos-terminal/test/finalize-ausfall.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/pos-terminal/test/finalize-ausfall.test.ts
import { describe, it, expect } from 'vitest'
import { finalizeSale } from '../src/sale/finalize'
import { LocalRepo } from '../src/db/local-repo'
import {
  FakeTseProvider,
  FailingTseProvider,
  AusfallTracker,
  type TaxRate,
} from '@gelato/compliance'

const rates: TaxRate[] = [
  { code: 'reduced', rate: 0.07, validFrom: new Date('2020-01-01') },
  { code: 'standard', rate: 0.19, validFrom: new Date('2020-01-01') },
]
const cart = [
  {
    product: { id: 'p1', name: 'Eis', netCents: 100, mwstCodeImHaus: 'standard', mwstCodeAusserHaus: 'reduced' },
    qty: 1,
  },
]
const base = {
  cart,
  mode: 'ausser_haus' as const,
  rates,
  kasseId: 'demo-kasse',
  tseClientId: 'c1',
  seller: { name: 'Demo' },
}

describe('finalizeSale — Ausfall', () => {
  it('completes the sale in Ausfall mode and emits a started event once', async () => {
    const repo = new LocalRepo(':memory:')
    const tracker = new AusfallTracker()
    let n = 0
    const idGen = () => `id-${n++}`

    const r1 = await finalizeSale({
      ...base, at: new Date('2026-06-25T10:00:00Z'), tse: new FailingTseProvider('down'),
      repo, tracker, idGen,
    })
    expect(r1.outcome.kind).toBe('ausfall')
    expect(r1.receipt.isAusfall).toBe(true)
    expect(r1.receipt.qrPayload).toBe('')
    // venda gravada + outbox tem: a venda + 1 evento 'started'
    expect(repo.countSales()).toBe(1)
    expect(repo.countOutbox('pending')).toBe(2)
    expect(repo.getAusfallState()).not.toBeNull()

    // 2ª venda em Ausfall: NÃO re-emite started
    const r2 = await finalizeSale({
      ...base, at: new Date('2026-06-25T10:01:00Z'), tse: new FailingTseProvider('down'),
      repo, tracker, idGen,
    })
    expect(r2.outcome.kind).toBe('ausfall')
    expect(repo.countSales()).toBe(2)
    expect(repo.countOutbox('pending')).toBe(3) // +1 venda, sem novo started

    // TSE volta: venda assinada + 1 evento 'ended'
    const r3 = await finalizeSale({
      ...base, at: new Date('2026-06-25T10:05:00Z'), tse: new FakeTseProvider({ serialNumber: 'X' }),
      repo, tracker, idGen,
    })
    expect(r3.outcome.kind).toBe('signed')
    expect(r3.receipt.isAusfall).toBe(false)
    expect(repo.countSales()).toBe(3)
    expect(repo.countOutbox('pending')).toBe(5) // +1 venda +1 ended
    expect(repo.getAusfallState()).toBeNull()
    repo.close()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm --filter @gelato/pos-terminal exec vitest run test/finalize-ausfall.test.ts`
Expected: FAIL — `finalizeSale` ainda chama `tse.sign` direto (lança em `FailingTseProvider`) e não aceita `tracker`/retorna `outcome`.

- [ ] **Step 3: Write minimal implementation**

Editar `apps/pos-terminal/src/sale/finalize.ts`:
- Imports: trocar/adicionar
```ts
import {
  computeMwst,
  buildReceipt,
  signWithFallback,
  type AusfallTracker,
  type SignOutcome,
  type TseProvider,
  type TaxRate,
  type MwstProductRef,
  type ReceiptModel,
  type SellerInfo,
} from '@gelato/compliance'
import { makeEnvelope, makeAusfallEnvelope } from '@gelato/sync'
import { applyRate, type ConsumptionMode, type SaleEvent } from '@gelato/domain'
```
- `FinalizeOpts`: adicionar
```ts
  tracker: AusfallTracker
  timeoutMs?: number
```
- Tipo de retorno:
```ts
export interface FinalizeResult {
  event: SaleEvent
  receipt: ReceiptModel
  outcome: SignOutcome
}
```
- Corpo: trocar a chamada direta `tse.sign(...)` (linhas ~52-58) por `signWithFallback`, ramificar a montagem do `tse_transaction`, e após gravar a venda, alimentar o tracker + enfileirar eventos + persistir estado:

```ts
export async function finalizeSale(opts: FinalizeOpts): Promise<FinalizeResult> {
  const { cart, mode, at, rates, kasseId, shiftId, tseClientId, tse, repo, seller, idGen, tracker, timeoutMs } = opts
  if (cart.length === 0) throw new Error('empty cart')

  const lines = cart.map((l) => ({ product: l.product, qty: l.qty }))
  const breakdown = computeMwst(lines, mode, at, rates)
  const codeFor = (l: CartLine): string =>
    mode === 'im_haus' ? l.product.mwstCodeImHaus : l.product.mwstCodeAusserHaus
  const rateFor = (code: string): number => breakdown.groups.find((g) => g.code === code)?.rate ?? 0

  const outcome = await signWithFallback(
    tse,
    {
      clientId: tseClientId,
      processType: 'Kassenbeleg-V1',
      amountsByVatRate: breakdown.groups.map((g) => ({ rate: g.rate, gross: g.gross })),
      paymentType: 'Bar',
      grossTotal: breakdown.totalGross,
    },
    { timeoutMs },
  )
  const tseResult = outcome.kind === 'signed' ? outcome.tse : null

  const receipt = buildReceipt({
    seller,
    issuedAt: at.toISOString(),
    mode,
    lines: cart.map((l) => {
      const code = codeFor(l)
      const lineNet = l.product.netCents * l.qty
      const lineGross = lineNet + applyRate(lineNet, rateFor(code))
      return { name: l.product.name, qty: l.qty, unitGross: Math.round(lineGross / l.qty), lineGross, mwstCode: code }
    }),
    breakdown,
    payment: { method: 'cash', amount: breakdown.totalGross },
    tse: tseResult,
  })

  const tseTransaction = tseResult
    ? {
        tx_number: tseResult.txNumber,
        signature_counter: tseResult.signatureCounter,
        signature_value: tseResult.signatureValue,
        log_time: tseResult.logTime,
        process_type: tseResult.processType,
        serial_number: tseResult.serialNumber,
        public_key: tseResult.publicKey,
        is_ausfall: false,
      }
    : { is_ausfall: true }

  const event = makeEnvelope(
    kasseId,
    {
      order: {
        mode, shift_id: shiftId,
        total_net: breakdown.totalNet, total_mwst: breakdown.totalMwst, total_gross: breakdown.totalGross,
      },
      items: cart.map((l) => {
        const code = codeFor(l)
        return { product_id: l.product.id, qty: l.qty, unit_net: l.product.netCents, mwst_rate: rateFor(code), mwst_code: code }
      }),
      payment: { method: 'cash', amount: breakdown.totalGross },
      receipt: { qr_payload: receipt.qrPayload, format: 'digital' },
      tse_transaction: tseTransaction,
    },
    idGen,
  )

  const now = at.getTime()
  repo.saveFinalizedSale(event, now)

  // Borda do período: emite started/ended uma única vez e persiste o estado.
  const reason = outcome.kind === 'ausfall' ? outcome.reason : ''
  for (const kind of tracker.record(outcome.kind, at.toISOString(), reason)) {
    const env = makeAusfallEnvelope(
      kasseId,
      { event_type: kind, at: at.toISOString(), reason: kind === 'started' ? reason : undefined },
      idGen,
    )
    repo.enqueueOutbox(env.client_event_id, JSON.stringify(env), now)
  }
  repo.setAusfallState(tracker.current)

  return { event, receipt, outcome }
}
```

> O comentário do cabeçalho da função (linhas 33-37) descreve o comportamento antigo ("se a assinatura falhar, propaga"). Atualizá-lo para o comportamento Ausfall.

- [ ] **Step 4: Run test to verify it passes**

Run: `corepack pnpm --filter @gelato/pos-terminal exec vitest run test/finalize-ausfall.test.ts`
Expected: PASS. Rodar a suíte do terminal (inclui `finalize.test.ts` do C0 — pode precisar passar um `tracker`):
`corepack pnpm --filter @gelato/pos-terminal exec vitest run`

- [ ] **Step 5: Corrigir o teste existente `finalize.test.ts`** (caminho feliz) se quebrar

`finalizeSale` agora exige `tracker`. Em `apps/pos-terminal/test/finalize.test.ts`, instanciar `const tracker = new AusfallTracker()` e passar `tracker` em cada chamada (import de `@gelato/compliance`). O caminho feliz (FakeTse) mantém o mesmo comportamento: `outcome.kind === 'signed'`, nenhum evento de Ausfall, sem estado persistido.

- [ ] **Step 6: Commit**

```bash
git add apps/pos-terminal/src/sale/finalize.ts apps/pos-terminal/test/finalize-ausfall.test.ts apps/pos-terminal/test/finalize.test.ts
git commit -m "feat(pos-terminal): finalizeSale resilient signing + Ausfall events"
```

### Task 5.4: `finalizeSale` (web) — espelhar a lógica

**Files:**
- Modify: `apps/pos-web/src/sale.ts`
- Test: `apps/pos-web/test/sale-ausfall.test.ts`

- [ ] **Step 1: Write the failing test** (espelho do 5.3, com store async)

```ts
// apps/pos-web/test/sale-ausfall.test.ts
import { describe, it, expect } from 'vitest'
import 'fake-indexeddb/auto'
import { finalizeSale } from '../src/sale'
import { IdbStore } from '../src/idb-store'
import { FakeTseProvider, FailingTseProvider, AusfallTracker, type TaxRate } from '@gelato/compliance'

const rates: TaxRate[] = [
  { code: 'reduced', rate: 0.07, validFrom: new Date('2020-01-01') },
  { code: 'standard', rate: 0.19, validFrom: new Date('2020-01-01') },
]
const cart = [{ product: { id: 'p1', name: 'Eis', netCents: 100, mwstCodeImHaus: 'standard', mwstCodeAusserHaus: 'reduced' }, qty: 1 }]
const base = { cart, mode: 'ausser_haus' as const, rates, kasseId: 'demo-kasse', tseClientId: 'c1', seller: { name: 'Demo' } }

describe('finalizeSale (web) — Ausfall', () => {
  it('records the sale in Ausfall and emits started once, then ended on recovery', async () => {
    const store = new IdbStore('test-sale-' + Math.random().toString(36).slice(2))
    const tracker = new AusfallTracker()
    let n = 0
    const idGen = () => `id-${n++}`

    const r1 = await finalizeSale({ ...base, at: new Date('2026-06-25T10:00:00Z'), tse: new FailingTseProvider('down'), store, tracker, idGen })
    expect(r1.outcome.kind).toBe('ausfall')
    expect(r1.receipt.qrPayload).toBe('')
    expect(await store.countOutbox('pending')).toBe(2) // venda + started
    expect(await store.getAusfallState()).not.toBeNull()

    await finalizeSale({ ...base, at: new Date('2026-06-25T10:01:00Z'), tse: new FailingTseProvider('down'), store, tracker, idGen })
    expect(await store.countOutbox('pending')).toBe(3) // +venda, sem started

    const r3 = await finalizeSale({ ...base, at: new Date('2026-06-25T10:05:00Z'), tse: new FakeTseProvider({ serialNumber: 'X' }), store, tracker, idGen })
    expect(r3.outcome.kind).toBe('signed')
    expect(await store.countOutbox('pending')).toBe(5) // +venda +ended
    expect(await store.getAusfallState()).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm --filter @gelato/pos-web exec vitest run test/sale-ausfall.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write minimal implementation**

Editar `apps/pos-web/src/sale.ts` aplicando exatamente as mesmas mudanças da Task 5.3, adaptando:
- imports (`signWithFallback`, `makeAusfallEnvelope`, `type AusfallTracker`, `type SignOutcome`);
- `FinalizeOpts` ganha `tracker: AusfallTracker` e `timeoutMs?: number`;
- retorno `FinalizeResult { event; receipt; outcome }`;
- `store` é **async**: `await store.saveFinalizedSale(event, now)` e `await store.enqueueOutbox(...)` e `await store.setAusfallState(tracker.current)`;
- `runOutboxOnce`: trocar `JSON.parse(row.payload) as SaleEvent` por `as PosEvent` (import `type PosEvent` de `@gelato/domain`) e o `SyncClient.post(event: PosEvent)` / `HttpSyncClient.post` para aceitar `PosEvent` (o corpo do POST e o parse da resposta não mudam).

```ts
// trechos-chave (após buildReceipt, igual ao Electron mas com await):
  const now = at.getTime()
  await store.saveFinalizedSale(event, now)
  const reason = outcome.kind === 'ausfall' ? outcome.reason : ''
  for (const kind of tracker.record(outcome.kind, at.toISOString(), reason)) {
    const env = makeAusfallEnvelope(
      kasseId,
      { event_type: kind, at: at.toISOString(), reason: kind === 'started' ? reason : undefined },
      idGen,
    )
    await store.enqueueOutbox(env.client_event_id, JSON.stringify(env), now)
  }
  await store.setAusfallState(tracker.current)
  return { event, receipt, outcome }
```

Ajustar `SyncClient`/`HttpSyncClient`:
```ts
import { applyRate, type ConsumptionMode, type SaleEvent, type PosEvent } from '@gelato/domain'
// ...
export interface SyncClient {
  post(event: PosEvent): Promise<SyncResponse>
}
export async function runOutboxOnce(store: SaleStore, client: SyncClient, now = Date.now(), backoffMs = 5000) {
  const pending = await store.pendingOutbox(now)
  // ...
  const event = JSON.parse(row.payload) as PosEvent
  // ...
}
export class HttpSyncClient implements SyncClient {
  // ...
  async post(event: PosEvent): Promise<SyncResponse> { /* corpo inalterado */ }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `corepack pnpm --filter @gelato/pos-web exec vitest run test/sale-ausfall.test.ts`
Expected: PASS. Suíte do pos-web (o `sale.test.ts` do C0 pode precisar de `tracker` — aplicar o mesmo ajuste do 5.3 Step 5):
`corepack pnpm --filter @gelato/pos-web exec vitest run`

- [ ] **Step 5: Commit**

```bash
git add apps/pos-web/src/sale.ts apps/pos-web/test/sale-ausfall.test.ts apps/pos-web/test/sale.test.ts
git commit -m "feat(pos-web): finalizeSale resilient signing + Ausfall events"
```

---

## Chunk 6: UI (banner + recibo sem QR) + capstone e2e

### Task 6.1: web — banner + recibo sem QR + rehidratar tracker

**Files:**
- Modify: `apps/pos-web/src/App.tsx`

- [ ] **Step 1: Implementar** (sem teste automatizado de UI; verificação manual no Step 2)

Em `apps/pos-web/src/App.tsx`:
- Imports: `AusfallTracker` de `@gelato/compliance`.
- No escopo de módulo, junto de `store`/`tse`: `const ausfallTracker = new AusfallTracker()`.
- Estado: `const [ausfall, setAusfall] = useState(false)`.
- `useEffect` de montagem (rehidrata): 
```ts
  useEffect(() => {
    void store.getAusfallState().then((s) => {
      if (s) { ;(ausfallTracker as unknown as { state: typeof s }) // não acessível; ver nota
      }
    })
  }, [])
```
> Nota: `AusfallTracker` não expõe setter. Para rehidratar, **reconstruir**: trocar o módulo-escopo para um `let ausfallTracker = new AusfallTracker()` e, no efeito, `store.getAusfallState().then((s) => { ausfallTracker = new AusfallTracker(s); setAusfall(s !== null) })`.
- Em `finalize()`: capturar o resultado e refletir o banner:
```ts
    const { receipt, outcome } = await finalizeSale({
      cart: items, mode, at: new Date(), rates, kasseId: KASSE,
      shiftId: shiftId ?? undefined, tseClientId: 'c1', tse, store,
      seller: { name: 'Gelateria Demo (Web)' }, tracker: ausfallTracker,
    })
    setAusfall(outcome.kind === 'ausfall' || ausfallTracker.current !== null)
    setQr(receipt.qrPayload ? await QRCode.toDataURL(receipt.qrPayload) : null)
    setCart({})
```
- Banner persistente no topo da tela principal (antes da grade de produtos):
```tsx
{ausfall && (
  <div style={{ background: '#b91c1c', color: 'white', padding: 8, borderRadius: 6, marginBottom: 8 }}>
    ⚠ TSE indisponível — vendas em modo Ausfall (sem assinatura). Documentado e sincronizado.
  </div>
)}
```
- Painel do recibo: quando `!qr`, mostrar o aviso de Ausfall:
```tsx
{qr ? <img src={qr} alt="QR" style={{ width: '100%' }} /> : <p>TSE-Ausfall — recibo sem QR</p>}
```

- [ ] **Step 2: Typecheck + build**

Run: `corepack pnpm exec tsc --noEmit -p apps/pos-web/tsconfig.json`
Run: `corepack pnpm --filter @gelato/pos-web build`
Expected: sem erros. (Verificação visual ao vivo fica para a sessão interativa; a corretude lógica é coberta pelo capstone 6.3.)

- [ ] **Step 3: Commit**

```bash
git add apps/pos-web/src/App.tsx
git commit -m "feat(pos-web): TSE-Ausfall banner + receipt-without-QR notice"
```

### Task 6.2: Electron — banner + recibo sem QR + IPC de estado

**Files:**
- Modify: `apps/pos-terminal/src/main/index.ts`
- Modify: `apps/pos-terminal/src/preload/index.ts`
- Modify: `apps/pos-terminal/src/renderer/env.d.ts`
- Modify: `apps/pos-terminal/src/renderer/App.tsx`

- [ ] **Step 1: main — owner do tracker, passa ao finalize, expõe estado**

Em `apps/pos-terminal/src/main/index.ts`:
- Import: `import { FakeTseProvider, AusfallTracker, type TaxRate } from '@gelato/compliance'`.
- Variável de módulo: `let ausfallTracker: AusfallTracker`.
- No `app.whenReady().then(...)`, após criar `repo`: `ausfallTracker = new AusfallTracker(repo.getAusfallState())`.
- No handler `sale:finalize`, passar `tracker: ausfallTracker` ao `finalizeSale` e retornar `isAusfall`:
```ts
      const { receipt, outcome } = await finalizeSale({
        cart: lines, mode, at: new Date(), rates, kasseId: KASSE_ID,
        shiftId: shiftId ?? undefined, tseClientId: TSE_CLIENT_ID, tse, repo,
        seller: { name: 'Gelateria Demo' }, tracker: ausfallTracker,
      })
      return {
        ok: true,
        receipt: { qrPayload: receipt.qrPayload, total: receipt.total },
        isAusfall: outcome.kind === 'ausfall',
      }
```
- Novo handler: `ipcMain.handle('tse:ausfallState', () => ausfallTracker.current)`.

- [ ] **Step 2: preload — expor `ausfallState`**

Em `apps/pos-terminal/src/preload/index.ts`, adicionar ao objeto:
```ts
  ausfallState: () => ipcRenderer.invoke('tse:ausfallState'),
```

- [ ] **Step 3: env.d.ts — tipos**

Em `apps/pos-terminal/src/renderer/env.d.ts`:
- No retorno de `finalize`, adicionar `isAusfall?: boolean`.
- Adicionar método: `ausfallState(): Promise<{ startedAt: string; reason: string } | null>`.

- [ ] **Step 4: renderer/App.tsx — banner + recibo sem QR**

Em `apps/pos-terminal/src/renderer/App.tsx`:
- Estado: `const [ausfall, setAusfall] = useState(false)`.
- Após `login()` (ou num `useEffect`), consultar `window.gelato.ausfallState().then((s) => setAusfall(s !== null))`.
- Em `finalize()`:
```ts
    const r = await window.gelato.finalize(items, mode)
    if (!r.ok || !r.receipt) { setMsg(r.error ?? 'erro'); return }
    setAusfall(Boolean(r.isAusfall) || ausfall && !r.isAusfall ? Boolean(r.isAusfall) : Boolean(r.isAusfall))
    setQr(r.receipt.qrPayload ? await QRCode.toDataURL(r.receipt.qrPayload) : null)
    setCart({})
```
> Simplificar: `setAusfall(Boolean(r.isAusfall))` (uma venda assinada após recuperação zera o banner; uma venda Ausfall liga). Em apagão contínuo cada venda Ausfall mantém `true`.
- Banner (no topo do painel principal) e recibo: iguais ao web (Task 6.1) — bloco vermelho quando `ausfall`; `{qr ? <img.../> : <p>TSE-Ausfall — recibo sem QR</p>}`.

- [ ] **Step 5: Typecheck**

Run: `corepack pnpm exec tsc --noEmit -p apps/pos-terminal/tsconfig.json`
Expected: sem erros.

- [ ] **Step 6: Commit**

```bash
git add apps/pos-terminal/src/main/index.ts apps/pos-terminal/src/preload/index.ts apps/pos-terminal/src/renderer/env.d.ts apps/pos-terminal/src/renderer/App.tsx
git commit -m "feat(pos-terminal): TSE-Ausfall banner + receipt-without-QR + state IPC"
```

### Task 6.3: capstone e2e — apagão → recuperação ponta a ponta

**Files:**
- Create: `apps/api/test/tse-ausfall-capstone.e2e.test.ts`

> Exercita o terminal-lógica (sale.ts/finalize) → HTTP real → ledger. Reusa o padrão do capstone existente `apps/api/test/terminal-to-ledger.e2e.test.ts` (ler antes para copiar o boot do Nest, login PIN e o `HttpSyncClient`). Usa uma **Kasse dedicada** para isolar de outros arquivos de teste (ex.: `kasse-1d-capstone`), criada via `prisma.kasse.upsert` no `beforeAll` (padrão da 1b).

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/test/tse-ausfall-capstone.e2e.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { AppModule } from '../src/app.module'
import { PrismaService } from '../src/prisma/prisma.service'
import { FakeTseProvider, FailingTseProvider, AusfallTracker, type TaxRate } from '@gelato/compliance'
import { finalizeSale, runOutboxOnce, HttpSyncClient } from '../../pos-web/src/sale'
import { IdbStore } from '../../pos-web/src/idb-store'
import 'fake-indexeddb/auto'

const KASSE = 'kasse-1d-capstone'

describe('TSE-Ausfall capstone (terminal logic -> real HTTP -> ledger)', () => {
  let app: INestApplication
  let prisma: PrismaService
  let token: string
  let baseUrl: string

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = mod.createNestApplication()
    await app.listen(0)
    baseUrl = await app.getUrl()
    prisma = app.get(PrismaService)
    // Kasse dedicada (isola de outros testes). Ajustar campos conforme schema (tenant/betriebsstaette do seed).
    await prisma.kasse.upsert({
      where: { id: KASSE },
      update: {},
      create: { id: KASSE, name: '1d capstone', betriebsstaetteId: (await prisma.betriebsstaette.findFirst())!.id },
    })
    const login = await request(baseUrl).post('/auth/pin').send({ kasse_id: 'demo-kasse', pin: '1234' })
    token = login.body.access_token
  })

  afterAll(async () => {
    await app.close()
  })

  it('blackout then recovery: ausfall sales + paired started/ended, idempotent', async () => {
    const rates: TaxRate[] = [
      { code: 'reduced', rate: 0.07, validFrom: new Date('2020-01-01') },
      { code: 'standard', rate: 0.19, validFrom: new Date('2020-01-01') },
    ]
    const cart = [{ product: { id: 'p1', name: 'Eis', netCents: 100, mwstCodeImHaus: 'standard', mwstCodeAusserHaus: 'reduced' }, qty: 1 }]
    const store = new IdbStore('capstone-' + Math.random().toString(36).slice(2))
    const tracker = new AusfallTracker()
    const base = { cart, mode: 'ausser_haus' as const, rates, kasseId: KASSE, tseClientId: 'c1', seller: { name: 'Demo' }, store, tracker }

    // 2 vendas durante o apagão
    await finalizeSale({ ...base, at: new Date('2026-06-25T10:00:00Z'), tse: new FailingTseProvider('down') })
    await finalizeSale({ ...base, at: new Date('2026-06-25T10:01:00Z'), tse: new FailingTseProvider('down') })
    // recuperação: 1 venda assinada
    await finalizeSale({ ...base, at: new Date('2026-06-25T10:05:00Z'), tse: new FakeTseProvider({ serialNumber: 'X' }) })

    const client = new HttpSyncClient(baseUrl, token)
    await runOutboxOnce(store, client)
    await runOutboxOnce(store, client) // 2ª passada: idempotência (nada novo)

    // ledger: 3 vendas na Kasse, 2 marcadas is_ausfall
    const orders = await prisma.order.findMany({ where: { kasseId: KASSE }, include: { tseTransaction: true } })
    expect(orders).toHaveLength(3)
    expect(orders.filter((o) => o.tseTransaction?.isAusfall)).toHaveLength(2)
    // log de Ausfall: exatamente um started e um ended pareáveis
    const log = await prisma.tseAusfallLog.findMany({ where: { kasseId: KASSE }, orderBy: { at: 'asc' } })
    expect(log.map((l) => l.eventType)).toEqual(['started', 'ended'])
  })
})
```

> Importante: o capstone importa de `../../pos-web/src/...` — confirmar que o `vitest.config.ts` da API resolve os aliases `@gelato/*` e permite TS fora de `apps/api` (o capstone do C0 já cruza para `pos-terminal`/`pos-web`? checar `terminal-to-ledger.e2e.test.ts`; se ele importa de `pos-terminal`, o mesmo mecanismo serve para `pos-web`). Caso o import cross-app não funcione no setup atual, replicar a lógica mínima de finalize inline no teste (mesmas chamadas a `@gelato/*`) em vez de importar de `pos-web`.

- [ ] **Step 2: Run test to verify it fails (then passes)**

Run: `corepack pnpm --filter @gelato/api exec vitest run test/tse-ausfall-capstone.e2e.test.ts`
Expected primeiro: pode falhar por detalhe de boot/seed/Kasse (ajustar campos do `upsert` ao schema real). Depois de ajustar: PASS — 3 ordens, 2 `is_ausfall`, log `['started','ended']`, e a 2ª `runOutboxOnce` não duplica.

- [ ] **Step 3: Suíte completa do monorepo**

Run: `corepack pnpm -r test`
Expected: tudo verde (pacotes + API + terminais). Lembrar do ABI Node para `@gelato/pos-terminal` (`pnpm install --force` se necessário).

- [ ] **Step 4: Commit**

```bash
git add apps/api/test/tse-ausfall-capstone.e2e.test.ts
git commit -m "test(api): TSE-Ausfall capstone e2e (blackout->recovery, idempotent)"
```

---

## Definition of Done (fatia 1d)

- [ ] `signWithFallback` cai em Ausfall por exceção **e** por timeout (testado).
- [ ] `AusfallTracker` emite `started`/`ended` só na borda e reidrata de estado persistido (testado).
- [ ] Recibo em Ausfall é emitido **sem QR** e marcado `isAusfall` (testado).
- [ ] `tse_transactions` aceita venda sem assinatura com `is_ausfall=true`; `tse_ausfall_log` é **append-only** imposto no banco (testado: UPDATE/DELETE falham).
- [ ] `/pos/sync` roteia `sale` vs `tse_ausfall`; ambos idempotentes por `client_event_id`; audit gravado.
- [ ] Os dois terminais completam a venda em Ausfall, persistem o período, enfileiram `started`/`ended` no outbox e mostram banner + recibo sem QR.
- [ ] Capstone: apagão→recuperação produz 2 vendas `is_ausfall` + par `started/ended` no ledger, idempotente ao reenviar o outbox.
- [ ] **Nunca** há assinatura retroativa; `corepack pnpm -r test` verde.

## Riscos / validações externas (rastrear, não resolver)

- Forma/texto exatos do recibo Ausfall e omitir-QR vs QR-"sem-assinatura" → **DFKA/KassenSichV + Steuerberater**.
- Prazo/forma de documentação do período de Ausfall → **Steuerberater**.
- Comportamento real da fiskaly sob indisponibilidade (timeout/códigos) → **sandbox + doc viva**.
