# DSFinV-K + Kassenmeldung (Ciclo 1 · fatia 1c) Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gerar, read-only a partir do ledger imutável, um pacote **DSFinV-K** fiel (subconjunto central: CSVs + index.xml em `.zip`) entregue pelo backoffice, e um **payload de Kassenmeldung** (§146a) — sem submissão ELSTER.

**Architecture:** Builders **puros** em `packages/compliance/src/dsfinvk` (registro de tabelas = fonte única da taxonomia → CSV + index.xml; mapeadores ledger→linhas; assembler). Um serviço NestJS lê o ledger (Prisma, read-only), normaliza, chama os builders e **zipa com jszip**; controller expõe `GET /exports/dsfinvk` (`.zip`) e `GET /exports/kassenmeldung` (JSON), ambos RBAC. Backoffice ganha a seção Exports.

**Tech Stack:** TypeScript strict, vitest (TDD), NestJS + Prisma + Postgres (`gelato_c0`), **jszip** (novo, na API), React/Vite (backoffice). Dinheiro em **cents** → decimal DSFinV-K. **127.0.0.1**, nunca `localhost`.

**Spec:** `docs/superpowers/specs/2026-06-26-ciclo-1c-dsfinvk-kassenmeldung-design.md`

> **Validação externa (rastrear, não resolver):** nomes/ordem exatos de colunas, formato decimal e o DTD/gdpdu do `index.xml` vêm da **DSFinV-K oficial vigente**; o conjunto montado aqui é fiel-na-nossa-compreensão e marcado como pendente de validação (igual ao QR DFKA do C0). UST_SCHLUESSEL (mapeamento alíquota→chave) e campos do certificado TSE/BSI idem.

---

## File Structure

**Criar (puro, `packages/compliance/src/dsfinvk/`):**
- `csv.ts` — `centsToDecimal`, `toCsv(columns, rows)`.
- `tables.ts` — registro das 14 tabelas (nome + colunas tipadas) = fonte única da taxonomia.
- `index-xml.ts` — `buildIndexXml(tables)`.
- `records.ts` — tipos de entrada normalizada + mapeadores ledger→linhas (um por arquivo).
- `package.ts` — `buildDsfinvkPackage(input) → { filename, content }[]`.
- `kassenmeldung.ts` — `buildKassenmeldung(input) → KassenmeldungPayload`.

**Criar (API, `apps/api/src/exports/`):**
- `exports.service.ts`, `exports.controller.ts`, `exports.module.ts`.
- Test: `apps/api/test/exports.e2e.test.ts`, `apps/api/test/dsfinvk-capstone.e2e.test.ts`.

**Modificar:**
- `packages/compliance/src/index.ts` — exportar `./dsfinvk/*`.
- `apps/api/src/app.module.ts` — importar `ExportsModule`.
- `apps/api/package.json` — dep `jszip`.
- `apps/backoffice/src/api.ts` — `apiGetBlob`.
- `apps/backoffice/src/App.tsx` — seção Exports.

**Comandos:** pacote puro `corepack pnpm --filter @gelato/compliance exec vitest run`; API e2e (precisa Postgres `gelato_c0`) `corepack pnpm --filter @gelato/api exec vitest run`; typecheck `corepack pnpm exec tsc --noEmit -p <pkg>/tsconfig.json`; build do compliance (consumido em runtime) `corepack pnpm --filter @gelato/compliance build`.

> RBAC já pronto: `admin.export.dsfinvk` e `admin.kassenmeldung` existem em `apps/api/src/rbac/permissions.ts` e o papel `admin` recebe `[...PERMISSIONS]`. **Sem mudança de seed.** Login admin: `admin@demo.test` / `admin123` (via `POST /auth/login`).

---

## Chunk 1: DSFinV-K puro I — csv, tables, index.xml

### Task 1.1: `centsToDecimal` + `toCsv`

**Files:**
- Create: `packages/compliance/src/dsfinvk/csv.ts`
- Test: `packages/compliance/test/dsfinvk-csv.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/compliance/test/dsfinvk-csv.test.ts
import { describe, it, expect } from 'vitest'
import { centsToDecimal, toCsv, type Column } from '../src/dsfinvk/csv'

describe('dsfinvk/csv', () => {
  it('formats cents as a decimal with a dot and two places', () => {
    expect(centsToDecimal(119)).toBe('1.19')
    expect(centsToDecimal(0)).toBe('0.00')
    expect(centsToDecimal(5)).toBe('0.05')
    expect(centsToDecimal(-7)).toBe('-0.07')
  })

  it('serializes rows with ; delimiter, header, and CRLF lines', () => {
    const cols: Column[] = [
      { name: 'A', type: 'string' },
      { name: 'B', type: 'number' },
    ]
    const csv = toCsv(cols, [{ A: 'x', B: '1.00' }])
    expect(csv).toBe('"A";"B"\r\n"x";1.00\r\n')
  })

  it('quotes strings and escapes embedded quotes', () => {
    const cols: Column[] = [{ name: 'A', type: 'string' }]
    expect(toCsv(cols, [{ A: 'a"b;c' }])).toBe('"A"\r\n"a""b;c"\r\n')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm --filter @gelato/compliance exec vitest run test/dsfinvk-csv.test.ts`
Expected: FAIL — `Cannot find module '../src/dsfinvk/csv'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/compliance/src/dsfinvk/csv.ts
import type { Cents } from '@gelato/domain'

export type ColumnType = 'string' | 'number' | 'date'
export interface Column {
  name: string
  type: ColumnType
}
/** Uma linha já formatada: cada valor é string pronta para o CSV. */
export type CsvRow = Record<string, string>

/**
 * Converte cents (inteiro) para o decimal usado na DSFinV-K: ponto como separador,
 * 2 casas. (Formato/precisão exatos = validação externa contra a spec oficial.)
 */
export function centsToDecimal(cents: Cents): string {
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(cents)
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`
}

const quote = (s: string): string => `"${s.replace(/"/g, '""')}"`

/**
 * Serializa linhas em CSV DSFinV-K: delimitador `;`, strings entre aspas (escape `""`),
 * números crus, fim de linha CRLF, cabeçalho com os nomes das colunas. Função pura.
 */
export function toCsv(columns: Column[], rows: CsvRow[]): string {
  const header = columns.map((c) => quote(c.name)).join(';')
  const body = rows.map((r) =>
    columns
      .map((c) => {
        const v = r[c.name] ?? ''
        return c.type === 'number' ? v : quote(v)
      })
      .join(';'),
  )
  return [header, ...body].map((l) => `${l}\r\n`).join('')
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `corepack pnpm --filter @gelato/compliance exec vitest run test/dsfinvk-csv.test.ts`
Expected: PASS (3 testes).

- [ ] **Step 5: Commit**

```bash
git add packages/compliance/src/dsfinvk/csv.ts packages/compliance/test/dsfinvk-csv.test.ts
git commit -m "feat(compliance): DSFinV-K CSV serializer + centsToDecimal"
```

### Task 1.2: registro de tabelas `tables.ts`

**Files:**
- Create: `packages/compliance/src/dsfinvk/tables.ts`
- Test: `packages/compliance/test/dsfinvk-tables.test.ts`

> O registro é a **fonte única da taxonomia** — index.xml e os mapeadores derivam dele. Colunas são o subconjunto central representativo (validação externa para os nomes/ordem exatos).

- [ ] **Step 1: Write the failing test**

```ts
// packages/compliance/test/dsfinvk-tables.test.ts
import { describe, it, expect } from 'vitest'
import { DSFINVK_TABLES } from '../src/dsfinvk/tables'

describe('dsfinvk/tables', () => {
  it('registers the core subset of files', () => {
    const names = DSFINVK_TABLES.map((t) => t.name)
    expect(names).toEqual([
      'stamm_abschluss', 'stamm_kassen', 'stamm_ust', 'stamm_tse', 'stamm_orte',
      'bonkopf', 'bonkopf_ust', 'bonkopf_zahlarten', 'bonpos', 'bonpos_ust', 'tse',
      'z_ust', 'z_zahlart', 'cash_per_country',
    ])
  })

  it('every table has at least one column and a filename ending in .csv', () => {
    for (const t of DSFINVK_TABLES) {
      expect(t.columns.length).toBeGreaterThan(0)
      expect(t.file).toBe(`${t.name}.csv`)
    }
  })

  it('tse table carries the Ausfall failure marker column', () => {
    const tse = DSFINVK_TABLES.find((t) => t.name === 'tse')!
    expect(tse.columns.map((c) => c.name)).toContain('TSE_TA_FEHLER')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm --filter @gelato/compliance exec vitest run test/dsfinvk-tables.test.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/compliance/src/dsfinvk/tables.ts
import type { Column } from './csv'

export interface DsfinvkTable {
  name: string
  file: string
  columns: Column[]
}

const s = (name: string): Column => ({ name, type: 'string' })
const n = (name: string): Column => ({ name, type: 'number' })

/**
 * Subconjunto central da DSFinV-K (Stammdaten + Einzelaufzeichnung + Kassenabschluss).
 * Os nomes/ordem exatos das colunas são VALIDAÇÃO EXTERNA contra a spec oficial; aqui
 * fixamos um conjunto fiel-na-compreensão, suficiente para representar nossos dados.
 */
const def = (name: string, columns: Column[]): DsfinvkTable => ({ name, file: `${name}.csv`, columns })

export const DSFINVK_TABLES: DsfinvkTable[] = [
  // ---- Stammdaten ----
  def('stamm_abschluss', [s('Z_KASSE_ID'), n('Z_NR'), s('Z_ERSTELLUNG'), s('Z_BUCHUNGSTAG')]),
  def('stamm_kassen', [s('Z_KASSE_ID'), s('KASSE_BRAND'), s('KASSE_MODELL'), s('KASSE_SERIENNR'), s('KASSE_SW_BRAND'), s('KASSE_SW_VERSION')]),
  def('stamm_ust', [s('Z_KASSE_ID'), n('Z_NR'), s('UST_SCHLUESSEL'), n('UST_SATZ'), s('UST_BESCHR')]),
  def('stamm_tse', [s('Z_KASSE_ID'), n('Z_NR'), s('TSE_ID'), s('TSE_SERIAL'), s('TSE_SIG_ALGO'), s('TSE_ZEITFORMAT'), s('TSE_PD_ENCODING'), s('TSE_PUBLIC_KEY')]),
  def('stamm_orte', [s('Z_KASSE_ID'), s('LOC_NAME'), s('LOC_STRASSE'), s('LOC_PLZ'), s('LOC_ORT'), s('LOC_LAND'), s('LOC_USTID')]),
  // ---- Einzelaufzeichnung ----
  def('bonkopf', [s('Z_KASSE_ID'), n('Z_NR'), s('BON_ID'), n('BON_NR'), s('BON_TYP'), s('BON_START'), s('BON_ENDE'), n('BON_NETTO'), n('BON_BRUTTO')]),
  def('bonkopf_ust', [s('Z_KASSE_ID'), n('Z_NR'), s('BON_ID'), s('UST_SCHLUESSEL'), n('BON_NETTO'), n('BON_UST'), n('BON_BRUTTO')]),
  def('bonkopf_zahlarten', [s('Z_KASSE_ID'), n('Z_NR'), s('BON_ID'), s('ZAHLART_TYP'), s('ZAHLART_NAME'), s('ZAHLWAEH'), n('BETRAG')]),
  def('bonpos', [s('Z_KASSE_ID'), n('Z_NR'), s('BON_ID'), n('POS_ZEILE'), s('ARTIKELTEXT'), n('MENGE'), n('EINZEL_BRUTTO'), n('GESAMT_BRUTTO'), s('UST_SCHLUESSEL')]),
  def('bonpos_ust', [s('Z_KASSE_ID'), n('Z_NR'), s('BON_ID'), n('POS_ZEILE'), s('UST_SCHLUESSEL'), n('POS_NETTO'), n('POS_UST'), n('POS_BRUTTO')]),
  def('tse', [s('Z_KASSE_ID'), n('Z_NR'), s('BON_ID'), s('TSE_ID'), n('TSE_TANR'), s('TSE_TA_START'), s('TSE_TA_ENDE'), n('TSE_TA_SIGZ'), s('TSE_TA_SIG'), s('TSE_TA_FEHLER')]),
  // ---- Kassenabschluss ----
  def('z_ust', [s('Z_KASSE_ID'), n('Z_NR'), s('UST_SCHLUESSEL'), n('Z_UST_NETTO'), n('Z_UST_UST'), n('Z_UST_BRUTTO')]),
  def('z_zahlart', [s('Z_KASSE_ID'), n('Z_NR'), s('ZAHLART_TYP'), s('ZAHLART_NAME'), n('Z_ZAHLART_BETRAG')]),
  def('cash_per_country', [s('Z_KASSE_ID'), n('Z_NR'), s('ZAHLART_LAND'), s('ZAHLART_WAEH'), n('Z_GESAMT_BETRAG')]),
]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `corepack pnpm --filter @gelato/compliance exec vitest run test/dsfinvk-tables.test.ts`
Expected: PASS (3 testes).

- [ ] **Step 5: Commit**

```bash
git add packages/compliance/src/dsfinvk/tables.ts packages/compliance/test/dsfinvk-tables.test.ts
git commit -m "feat(compliance): DSFinV-K table registry (core subset taxonomy)"
```

### Task 1.3: `index-xml.ts`

**Files:**
- Create: `packages/compliance/src/dsfinvk/index-xml.ts`
- Test: `packages/compliance/test/dsfinvk-index-xml.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/compliance/test/dsfinvk-index-xml.test.ts
import { describe, it, expect } from 'vitest'
import { buildIndexXml } from '../src/dsfinvk/index-xml'
import { DSFINVK_TABLES } from '../src/dsfinvk/tables'

describe('dsfinvk/index-xml', () => {
  it('lists every table with its file URL and all column names', () => {
    const xml = buildIndexXml(DSFINVK_TABLES)
    expect(xml).toContain('<?xml')
    for (const t of DSFINVK_TABLES) {
      expect(xml).toContain(`<URL>${t.file}</URL>`)
      for (const c of t.columns) expect(xml).toContain(`<Name>${c.name}</Name>`)
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm --filter @gelato/compliance exec vitest run test/dsfinvk-index-xml.test.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/compliance/src/dsfinvk/index-xml.ts
import type { DsfinvkTable } from './tables'

/**
 * Monta o index.xml (manifesto gdpdu) a partir do registro de tabelas. Cada Table
 * declara a URL do arquivo e suas colunas. O DTD/atributos exatos (DataSupplier,
 * Media, formatos numéricos/decimais) = VALIDAÇÃO EXTERNA contra a DSFinV-K oficial.
 */
export function buildIndexXml(tables: DsfinvkTable[]): string {
  const col = (name: string): string =>
    `        <VariableColumn><Name>${name}</Name></VariableColumn>`
  const table = (t: DsfinvkTable): string =>
    [
      '      <Table>',
      `        <URL>${t.file}</URL>`,
      `        <Name>${t.name}</Name>`,
      ...t.columns.map((c) => col(c.name)),
      '      </Table>',
    ].join('\n')

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<DataSet>',
    '  <Media>',
    '    <Name>gelato-core DSFinV-K</Name>',
    ...tables.map(table),
    '  </Media>',
    '</DataSet>',
    '',
  ].join('\n')
}
```

> Nota: `<Name>` aparece tanto no nível Table quanto dentro de `VariableColumn`; o teste verifica os nomes das colunas via `<Name>${c.name}</Name>`, satisfeito pela linha de coluna acima.

- [ ] **Step 4: Run test to verify it passes**

Run: `corepack pnpm --filter @gelato/compliance exec vitest run test/dsfinvk-index-xml.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/compliance/src/dsfinvk/index-xml.ts packages/compliance/test/dsfinvk-index-xml.test.ts
git commit -m "feat(compliance): DSFinV-K index.xml manifest from table registry"
```

---

## Chunk 2: DSFinV-K puro II — records + package

### Task 2.1: tipos de entrada + mapeadores `records.ts`

**Files:**
- Create: `packages/compliance/src/dsfinvk/records.ts`
- Test: `packages/compliance/test/dsfinvk-records.test.ts`

> Os mapeadores recebem o **dataset normalizado** (cents, ISO) que o serviço da API produz a partir do ledger, e devolvem `CsvRow[]` por arquivo. `UST_SCHLUESSEL` mapeia alíquota→chave (0.19→'1', 0.07→'2', senão '5') — mapeamento exato = validação externa.

- [ ] **Step 1: Write the failing test**

```ts
// packages/compliance/test/dsfinvk-records.test.ts
import { describe, it, expect } from 'vitest'
import { mapRecords, type DsfinvkInput } from '../src/dsfinvk/records'

const input: DsfinvkInput = {
  kasse: { id: 'k1', name: 'Kasse 1', serialNr: 'SER1', swVersion: '1.0' },
  location: { name: 'Filiale', country: 'DEU' },
  tse: { id: 'tse1', serial: 'SANDBOX', publicKey: 'PUB', sigAlgo: 'ecdsa-plain-SHA256', timeFormat: 'utcTime' },
  taxRates: [{ code: 'standard_19', rate: 0.19 }, { code: 'reduced_7', rate: 0.07 }],
  zClosings: [
    {
      zNr: 1,
      businessDay: '2026-06-25T20:00:00Z',
      createdAt: '2026-06-25T20:00:00Z',
      totals: {
        byVatRate: [{ rate: 0.07, net: 100, mwst: 7, gross: 107 }],
        byPayment: [{ method: 'cash', amount: 107 }],
        totalNet: 100, totalMwst: 7, totalGross: 107, receiptCount: 1, stornoCount: 0, grandTotal: 107,
      },
      bons: [
        {
          bonId: 'o1', bonNr: 1, type: 'Beleg', start: '2026-06-25T10:00:00Z', end: '2026-06-25T10:00:00Z',
          net: 100, gross: 107,
          vat: [{ rate: 0.07, net: 100, ust: 7, gross: 107 }],
          payments: [{ type: 'Bar', name: 'cash', currency: 'EUR', amount: 107 }],
          lines: [{ zeile: 1, text: 'Eis', qty: 1, unitGross: 107, lineGross: 107, rate: 0.07, net: 100, ust: 7 }],
          tse: { id: 'tse1', taNr: 5, start: '2026-06-25T10:00:00Z', end: '2026-06-25T10:00:00Z', sigCounter: 9, signature: 'SIG', isAusfall: false },
        },
        {
          bonId: 'o2', bonNr: 2, type: 'Beleg', start: '2026-06-25T11:00:00Z', end: '2026-06-25T11:00:00Z',
          net: 100, gross: 107,
          vat: [{ rate: 0.07, net: 100, ust: 7, gross: 107 }],
          payments: [{ type: 'Bar', name: 'cash', currency: 'EUR', amount: 107 }],
          lines: [{ zeile: 1, text: 'Eis', qty: 1, unitGross: 107, lineGross: 107, rate: 0.07, net: 100, ust: 7 }],
          tse: { id: 'tse1', isAusfall: true }, // Ausfall: sem assinatura
        },
      ],
    },
  ],
}

describe('dsfinvk/records', () => {
  it('maps bonkopf rows from bons', () => {
    const r = mapRecords(input)
    expect(r.bonkopf).toHaveLength(2)
    expect(r.bonkopf[0]).toMatchObject({ Z_KASSE_ID: 'k1', BON_ID: 'o1', BON_BRUTTO: '1.07' })
  })

  it('marks the Ausfall bon in tse.csv with TSE_TA_FEHLER and empty signature', () => {
    const r = mapRecords(input)
    const ausfall = r.tse.find((row) => row.BON_ID === 'o2')!
    expect(ausfall.TSE_TA_FEHLER).toBe('1')
    expect(ausfall.TSE_TA_SIG).toBe('')
    const ok = r.tse.find((row) => row.BON_ID === 'o1')!
    expect(ok.TSE_TA_FEHLER).toBe('')
    expect(ok.TSE_TA_SIG).toBe('SIG')
  })

  it('maps z_ust from the closing totals by vat rate', () => {
    const r = mapRecords(input)
    expect(r.z_ust[0]).toMatchObject({ Z_NR: '1', UST_SCHLUESSEL: '2', Z_UST_BRUTTO: '1.07' })
  })

  it('produces stammdaten rows (kasse, tse, ust, orte, abschluss)', () => {
    const r = mapRecords(input)
    expect(r.stamm_kassen[0]).toMatchObject({ Z_KASSE_ID: 'k1', KASSE_SERIENNR: 'SER1' })
    expect(r.stamm_tse[0]).toMatchObject({ TSE_SERIAL: 'SANDBOX' })
    expect(r.stamm_ust).toHaveLength(2)
    expect(r.stamm_orte[0]).toMatchObject({ LOC_NAME: 'Filiale', LOC_LAND: 'DEU' })
    expect(r.stamm_abschluss[0]).toMatchObject({ Z_NR: '1' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm --filter @gelato/compliance exec vitest run test/dsfinvk-records.test.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/compliance/src/dsfinvk/records.ts
import type { Cents } from '@gelato/domain'
import type { DayTotals } from '../reports/types'
import { centsToDecimal, type CsvRow } from './csv'

export interface DsfinvkInput {
  kasse: { id: string; name: string; serialNr?: string; swVersion?: string }
  location: { name: string; street?: string; plz?: string; city?: string; country?: string; ustId?: string }
  tse: { id: string; serial?: string; publicKey?: string; sigAlgo?: string; timeFormat?: string }
  taxRates: { code: string; rate: number; description?: string }[]
  zClosings: ZClosing[]
}
export interface ZClosing {
  zNr: number
  businessDay: string
  createdAt: string
  totals: DayTotals
  bons: Bon[]
}
export interface Bon {
  bonId: string
  bonNr: number
  type: string
  start: string
  end: string
  net: Cents
  gross: Cents
  vat: { rate: number; net: Cents; ust: Cents; gross: Cents }[]
  payments: { type: string; name: string; currency: string; amount: Cents }[]
  lines: { zeile: number; text: string; qty: number; unitGross: Cents; lineGross: Cents; rate: number; net: Cents; ust: Cents }[]
  tse: { id: string; taNr?: number; start?: string; end?: string; sigCounter?: number; signature?: string; isAusfall: boolean }
}

/** Mapeamento alíquota→UST_SCHLUESSEL (exato = validação externa). */
export function ustSchluessel(rate: number): string {
  if (rate === 0.19) return '1'
  if (rate === 0.07) return '2'
  return '5'
}
const d = centsToDecimal
const num = (x: number): string => String(x)

export interface DsfinvkRecords {
  stamm_abschluss: CsvRow[]
  stamm_kassen: CsvRow[]
  stamm_ust: CsvRow[]
  stamm_tse: CsvRow[]
  stamm_orte: CsvRow[]
  bonkopf: CsvRow[]
  bonkopf_ust: CsvRow[]
  bonkopf_zahlarten: CsvRow[]
  bonpos: CsvRow[]
  bonpos_ust: CsvRow[]
  tse: CsvRow[]
  z_ust: CsvRow[]
  z_zahlart: CsvRow[]
  cash_per_country: CsvRow[]
}

/** Transforma o dataset normalizado nas linhas CSV de cada arquivo DSFinV-K. Puro. */
export function mapRecords(input: DsfinvkInput): DsfinvkRecords {
  const KID = input.kasse.id
  const r: DsfinvkRecords = {
    stamm_abschluss: [], stamm_kassen: [], stamm_ust: [], stamm_tse: [], stamm_orte: [],
    bonkopf: [], bonkopf_ust: [], bonkopf_zahlarten: [], bonpos: [], bonpos_ust: [], tse: [],
    z_ust: [], z_zahlart: [], cash_per_country: [],
  }

  // ---- Stammdaten (independem de Z, exceto abschluss/ust/tse que repetem por Z) ----
  r.stamm_kassen.push({
    Z_KASSE_ID: KID, KASSE_BRAND: 'gelato-core', KASSE_MODELL: input.kasse.name,
    KASSE_SERIENNR: input.kasse.serialNr ?? '', KASSE_SW_BRAND: 'gelato-core',
    KASSE_SW_VERSION: input.kasse.swVersion ?? '',
  })
  r.stamm_orte.push({
    Z_KASSE_ID: KID, LOC_NAME: input.location.name, LOC_STRASSE: input.location.street ?? '',
    LOC_PLZ: input.location.plz ?? '', LOC_ORT: input.location.city ?? '',
    LOC_LAND: input.location.country ?? 'DEU', LOC_USTID: input.location.ustId ?? '',
  })

  for (const z of input.zClosings) {
    r.stamm_abschluss.push({ Z_KASSE_ID: KID, Z_NR: num(z.zNr), Z_ERSTELLUNG: z.createdAt, Z_BUCHUNGSTAG: z.businessDay })
    for (const t of input.taxRates) {
      r.stamm_ust.push({ Z_KASSE_ID: KID, Z_NR: num(z.zNr), UST_SCHLUESSEL: ustSchluessel(t.rate), UST_SATZ: t.rate.toFixed(2), UST_BESCHR: t.code })
    }
    r.stamm_tse.push({
      Z_KASSE_ID: KID, Z_NR: num(z.zNr), TSE_ID: input.tse.id, TSE_SERIAL: input.tse.serial ?? '',
      TSE_SIG_ALGO: input.tse.sigAlgo ?? '', TSE_ZEITFORMAT: input.tse.timeFormat ?? '',
      TSE_PD_ENCODING: 'UTF-8', TSE_PUBLIC_KEY: input.tse.publicKey ?? '',
    })

    // ---- Kassenabschluss (de z.totals) ----
    for (const g of z.totals.byVatRate) {
      r.z_ust.push({ Z_KASSE_ID: KID, Z_NR: num(z.zNr), UST_SCHLUESSEL: ustSchluessel(g.rate), Z_UST_NETTO: d(g.net), Z_UST_UST: d(g.mwst), Z_UST_BRUTTO: d(g.gross) })
    }
    for (const p of z.totals.byPayment) {
      r.z_zahlart.push({ Z_KASSE_ID: KID, Z_NR: num(z.zNr), ZAHLART_TYP: p.method === 'cash' ? 'Bar' : 'Unbar', ZAHLART_NAME: p.method, Z_ZAHLART_BETRAG: d(p.amount) })
      if (p.method === 'cash') {
        r.cash_per_country.push({ Z_KASSE_ID: KID, Z_NR: num(z.zNr), ZAHLART_LAND: 'DEU', ZAHLART_WAEH: 'EUR', Z_GESAMT_BETRAG: d(p.amount) })
      }
    }

    // ---- Einzelaufzeichnung ----
    for (const b of z.bons) {
      r.bonkopf.push({ Z_KASSE_ID: KID, Z_NR: num(z.zNr), BON_ID: b.bonId, BON_NR: num(b.bonNr), BON_TYP: b.type, BON_START: b.start, BON_ENDE: b.end, BON_NETTO: d(b.net), BON_BRUTTO: d(b.gross) })
      for (const v of b.vat) {
        r.bonkopf_ust.push({ Z_KASSE_ID: KID, Z_NR: num(z.zNr), BON_ID: b.bonId, UST_SCHLUESSEL: ustSchluessel(v.rate), BON_NETTO: d(v.net), BON_UST: d(v.ust), BON_BRUTTO: d(v.gross) })
      }
      for (const p of b.payments) {
        r.bonkopf_zahlarten.push({ Z_KASSE_ID: KID, Z_NR: num(z.zNr), BON_ID: b.bonId, ZAHLART_TYP: p.type, ZAHLART_NAME: p.name, ZAHLWAEH: p.currency, BETRAG: d(p.amount) })
      }
      for (const l of b.lines) {
        r.bonpos.push({ Z_KASSE_ID: KID, Z_NR: num(z.zNr), BON_ID: b.bonId, POS_ZEILE: num(l.zeile), ARTIKELTEXT: l.text, MENGE: num(l.qty), EINZEL_BRUTTO: d(l.unitGross), GESAMT_BRUTTO: d(l.lineGross), UST_SCHLUESSEL: ustSchluessel(l.rate) })
        r.bonpos_ust.push({ Z_KASSE_ID: KID, Z_NR: num(z.zNr), BON_ID: b.bonId, POS_ZEILE: num(l.zeile), UST_SCHLUESSEL: ustSchluessel(l.rate), POS_NETTO: d(l.net), POS_UST: d(l.ust), POS_BRUTTO: d(l.lineGross) })
      }
      r.tse.push({
        Z_KASSE_ID: KID, Z_NR: num(z.zNr), BON_ID: b.bonId, TSE_ID: b.tse.id,
        TSE_TANR: b.tse.taNr == null ? '' : num(b.tse.taNr),
        TSE_TA_START: b.tse.start ?? '', TSE_TA_ENDE: b.tse.end ?? '',
        TSE_TA_SIGZ: b.tse.sigCounter == null ? '' : num(b.tse.sigCounter),
        TSE_TA_SIG: b.tse.signature ?? '',
        TSE_TA_FEHLER: b.tse.isAusfall ? '1' : '',
      })
    }
  }
  return r
}
```

> Atenção tipos: `TSE_TANR`/`TSE_TA_SIGZ` são colunas `number` no registro, mas em Ausfall ficam vazias (`''`). O serializador emite o valor cru; `''` num campo numérico é aceitável aqui (célula vazia). Se a validação oficial exigir `0`, ajustar no mapeador — rastreado como validação externa.

- [ ] **Step 4: Run test to verify it passes**

Run: `corepack pnpm --filter @gelato/compliance exec vitest run test/dsfinvk-records.test.ts`
Expected: PASS (4 testes).

- [ ] **Step 5: Commit**

```bash
git add packages/compliance/src/dsfinvk/records.ts packages/compliance/test/dsfinvk-records.test.ts
git commit -m "feat(compliance): DSFinV-K record mappers (ledger-shape -> rows, Ausfall marker)"
```

### Task 2.2: `package.ts` (assembler) + exports do índice

**Files:**
- Create: `packages/compliance/src/dsfinvk/package.ts`
- Modify: `packages/compliance/src/index.ts`
- Test: `packages/compliance/test/dsfinvk-package.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/compliance/test/dsfinvk-package.test.ts
import { describe, it, expect } from 'vitest'
import { buildDsfinvkPackage } from '../src/dsfinvk/package'
import type { DsfinvkInput } from '../src/dsfinvk/records'

const input: DsfinvkInput = {
  kasse: { id: 'k1', name: 'Kasse 1' },
  location: { name: 'Filiale' },
  tse: { id: 'tse1' },
  taxRates: [{ code: 'reduced_7', rate: 0.07 }],
  zClosings: [],
}

describe('dsfinvk/package', () => {
  it('always includes index.xml and every table file', () => {
    const files = buildDsfinvkPackage(input)
    const names = files.map((f) => f.filename)
    expect(names).toContain('index.xml')
    expect(names).toContain('bonkopf.csv')
    expect(names).toContain('tse.csv')
    expect(names).toContain('z_ust.csv')
    // index.xml + 14 CSVs
    expect(files).toHaveLength(15)
  })

  it('each CSV has a header line', () => {
    const files = buildDsfinvkPackage(input)
    const bonkopf = files.find((f) => f.filename === 'bonkopf.csv')!
    expect(bonkopf.content.startsWith('"Z_KASSE_ID"')).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm --filter @gelato/compliance exec vitest run test/dsfinvk-package.test.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/compliance/src/dsfinvk/package.ts
import { toCsv } from './csv'
import { DSFINVK_TABLES } from './tables'
import { buildIndexXml } from './index-xml'
import { mapRecords, type DsfinvkInput, type DsfinvkRecords } from './records'

export interface DsfinvkFile {
  filename: string
  content: string
}

/**
 * Monta o pacote DSFinV-K completo (index.xml + um CSV por tabela do registro) a
 * partir do dataset normalizado. Read-only/puro — não conhece zip nem banco.
 */
export function buildDsfinvkPackage(input: DsfinvkInput): DsfinvkFile[] {
  const records = mapRecords(input)
  const files: DsfinvkFile[] = [{ filename: 'index.xml', content: buildIndexXml(DSFINVK_TABLES) }]
  for (const t of DSFINVK_TABLES) {
    const rows = records[t.name as keyof DsfinvkRecords]
    files.push({ filename: t.file, content: toCsv(t.columns, rows) })
  }
  return files
}
```

- [ ] **Step 4: Export do índice**

Editar `packages/compliance/src/index.ts`, adicionar:
```ts
export * from './dsfinvk/csv'
export * from './dsfinvk/tables'
export * from './dsfinvk/index-xml'
export * from './dsfinvk/records'
export * from './dsfinvk/package'
```

- [ ] **Step 5: Run test + typecheck + build**

Run: `corepack pnpm --filter @gelato/compliance exec vitest run` (toda a suíte do pacote)
Expected: PASS (todos, incl. os novos).
Run: `corepack pnpm exec tsc --noEmit -p packages/compliance/tsconfig.json` → sem erros.
Run: `corepack pnpm --filter @gelato/compliance build` → gera dist atualizado (consumido pela API).

- [ ] **Step 6: Commit**

```bash
git add packages/compliance/src/dsfinvk/package.ts packages/compliance/src/index.ts packages/compliance/test/dsfinvk-package.test.ts
git commit -m "feat(compliance): DSFinV-K package assembler + exports"
```

---

## Chunk 3: API export — service + controller + zip + e2e

### Task 3.1: dep jszip + `exports.service` + `exports.controller` + `exports.module`

**Files:**
- Modify: `apps/api/package.json` (dep `jszip`)
- Create: `apps/api/src/exports/exports.service.ts`
- Create: `apps/api/src/exports/exports.controller.ts`
- Create: `apps/api/src/exports/exports.module.ts`
- Modify: `apps/api/src/app.module.ts`
- Test: `apps/api/test/exports.e2e.test.ts`

- [ ] **Step 1: Adicionar jszip**

Run: `corepack pnpm --filter @gelato/api add jszip`
Expected: `jszip` em `apps/api/package.json` dependencies + lockfile atualizado.

- [ ] **Step 2: Write the failing test**

```ts
// apps/api/test/exports.e2e.test.ts
import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import type { AddressInfo } from 'node:net'
import { PrismaClient } from '@prisma/client'
import JSZip from 'jszip'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { LocalRepo, finalizeSale, runOutboxOnce, HttpSyncClient } from '@gelato/pos-terminal'
import { FakeTseProvider, FailingTseProvider, AusfallTracker, type TaxRate } from '@gelato/compliance'
import { AppModule } from '../src/app.module'

const rates: TaxRate[] = [
  { code: 'standard_19', rate: 0.19, validFrom: new Date('2020-01-01') },
  { code: 'reduced_7', rate: 0.07, validFrom: new Date('2020-01-01') },
]
const cart = [{ product: { id: 'p1', name: 'Eis', netCents: 100, mwstCodeImHaus: 'standard_19', mwstCodeAusserHaus: 'reduced_7' }, qty: 1 }]

describe('DSFinV-K export (e2e)', () => {
  let app: INestApplication
  let baseUrl: string
  let adminToken: string
  let opToken: string
  let prisma: PrismaClient
  let KASSE = ''

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = mod.createNestApplication()
    await app.listen(0)
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`
    prisma = new PrismaClient()
    // admin (senha) e operator (PIN) tokens
    const a = await fetch(`${baseUrl}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'admin@demo.test', password: 'admin123' }) })
    adminToken = ((await a.json()) as { access_token: string }).access_token
    const o = await fetch(`${baseUrl}/auth/pin`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kasse_id: 'demo-kasse', pin: '1234' }) })
    opToken = ((await o.json()) as { access_token: string }).access_token
    // Kasse única + TSE client + 1 venda OK + 1 Ausfall, depois Z
    KASSE = `kasse-1c-${crypto.randomUUID().slice(0, 8)}`
    const bs = await prisma.betriebsstaette.findFirst()
    await prisma.kasse.create({ data: { id: KASSE, name: '1c export', betriebsstaetteId: bs!.id } })
    await prisma.tseClient.create({ data: { kasseId: KASSE, provider: 'fiskaly', serialNr: 'SER-1C', publicKey: 'PUB' } })

    const repo = new LocalRepo()
    const tracker = new AusfallTracker()
    const base = { cart, mode: 'ausser_haus' as const, rates, kasseId: KASSE, tseClientId: 'c1', seller: { name: 'Demo' }, repo, tracker }
    await finalizeSale({ ...base, at: new Date(), tse: new FakeTseProvider({ serialNumber: 'SER-1C' }) })
    await finalizeSale({ ...base, at: new Date(), tse: new FailingTseProvider('down') })
    await runOutboxOnce(repo, new HttpSyncClient(baseUrl, opToken))
    repo.close()
    // fecha o Z da Kasse (precisa de pos.report.z → operator tem? não; usa admin)
    await fetch(`${baseUrl}/pos/reports/z`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${adminToken}` }, body: JSON.stringify({ kasse_id: KASSE }) })
  }, 40000)

  afterAll(async () => {
    await prisma?.$disconnect()
    await app?.close()
  })

  it('returns a zip with index.xml and the core files, including the Ausfall marker in tse.csv', async () => {
    const res = await fetch(`${baseUrl}/exports/dsfinvk?kasse_id=${KASSE}&from=2020-01-01&to=2999-01-01`, {
      headers: { authorization: `Bearer ${adminToken}` },
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('application/zip')
    const zip = await JSZip.loadAsync(await res.arrayBuffer())
    expect(zip.file('index.xml')).toBeTruthy()
    const bonkopf = await zip.file('bonkopf.csv')!.async('string')
    expect(bonkopf.split('\r\n').filter(Boolean).length).toBeGreaterThanOrEqual(3) // header + 2 bons
    const tse = await zip.file('tse.csv')!.async('string')
    expect(tse).toContain('"1"') // TSE_TA_FEHLER = '1' em alguma linha (Ausfall)
  })

  it('forbids the operator (no admin.export.dsfinvk)', async () => {
    const res = await fetch(`${baseUrl}/exports/dsfinvk?kasse_id=${KASSE}&from=2020-01-01&to=2999-01-01`, {
      headers: { authorization: `Bearer ${opToken}` },
    })
    expect(res.status).toBe(403)
  })
})
```

> Nota: `pos.report.z` não está no papel `operator` (catálogo); por isso o teste fecha o Z com o token **admin** (que tem `[...PERMISSIONS]`). Confirme que `POST /pos/reports/z` aceita `kasse_id` no body (controller da 1b) — sim.

- [ ] **Step 3: Run test to verify it fails**

Run: `corepack pnpm --filter @gelato/api exec vitest run test/exports.e2e.test.ts`
Expected: FAIL — rota `/exports/dsfinvk` inexistente (404).

- [ ] **Step 4: Implementar o serviço**

```ts
// apps/api/src/exports/exports.service.ts
import { Injectable, NotFoundException } from '@nestjs/common'
import JSZip from 'jszip'
import { buildDsfinvkPackage, type DsfinvkInput, type ZClosing, type Bon } from '@gelato/compliance'
import type { DayTotals } from '@gelato/compliance'
import { applyRate } from '@gelato/domain'
import { PrismaService } from '../prisma/prisma.service'

@Injectable()
export class ExportsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Lista de Kassen do tenant (para o seletor do backoffice). */
  async kassen(tenantId: string): Promise<{ id: string; name: string }[]> {
    return this.prisma.kasse.findMany({
      where: { betriebsstaette: { tenantId } },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    })
  }

  /** Monta o dataset normalizado da Kasse no intervalo, ancorado nos Z-Berichte. */
  async dsfinvkInput(tenantId: string, kasseId: string, from: Date, to: Date): Promise<DsfinvkInput> {
    const kasse = await this.prisma.kasse.findFirst({
      where: { id: kasseId, betriebsstaette: { tenantId } },
      include: { tseClient: true, betriebsstaette: true },
    })
    if (!kasse) throw new NotFoundException('kasse not found')

    const taxRates = await this.prisma.taxRate.findMany({ where: { tenantId } })
    const zReports = await this.prisma.zReport.findMany({
      where: { kasseId, businessDay: { gte: from, lte: to } },
      orderBy: { seqNr: 'asc' },
    })

    const zClosings: ZClosing[] = []
    for (const z of zReports) {
      const orders = await this.prisma.order.findMany({
        where: { kasseId, ts: { gte: z.coveredFrom, lt: z.coveredTo } },
        include: { items: true, payments: true, tseTransaction: true },
        orderBy: { ts: 'asc' },
      })
      const bons: Bon[] = orders.map((o, i) => {
        const vatMap = new Map<number, { net: number; ust: number; gross: number }>()
        const lines = o.items.map((it, idx) => {
          const lineNet = it.unitNet * it.qty
          const ust = applyRate(lineNet, it.mwstRate)
          const g = vatMap.get(it.mwstRate) ?? { net: 0, ust: 0, gross: 0 }
          g.net += lineNet; g.ust += ust; g.gross += lineNet + ust
          vatMap.set(it.mwstRate, g)
          return { zeile: idx + 1, text: it.productId, qty: it.qty, unitGross: it.unitNet + applyRate(it.unitNet, it.mwstRate), lineGross: lineNet + ust, rate: it.mwstRate, net: lineNet, ust }
        })
        const te = o.tseTransaction
        return {
          bonId: o.id, bonNr: i + 1, type: 'Beleg', start: o.ts.toISOString(), end: o.ts.toISOString(),
          net: o.totalNet, gross: o.totalGross,
          vat: [...vatMap.entries()].map(([rate, g]) => ({ rate, ...g })),
          payments: o.payments.map((p) => ({ type: p.method === 'cash' ? 'Bar' : 'Unbar', name: p.method, currency: 'EUR', amount: p.amount })),
          lines,
          tse: {
            id: te?.id ?? '', taNr: te?.txNumber ?? undefined, start: te?.logTime?.toISOString(), end: te?.logTime?.toISOString(),
            sigCounter: te?.signatureCounter ?? undefined, signature: te?.signatureValue ?? undefined, isAusfall: te?.isAusfall ?? false,
          },
        }
      })
      zClosings.push({
        zNr: z.seqNr, businessDay: z.businessDay.toISOString(), createdAt: z.generatedAt.toISOString(),
        totals: z.totals as unknown as DayTotals, bons,
      })
    }

    return {
      kasse: { id: kasse.id, name: kasse.name, serialNr: kasse.tseClient?.serialNr ?? undefined, swVersion: undefined },
      location: { name: kasse.betriebsstaette.name, street: kasse.betriebsstaette.address ?? undefined, country: 'DEU', ustId: undefined },
      tse: { id: kasse.tseClient?.id ?? '', serial: kasse.tseClient?.serialNr ?? undefined, publicKey: kasse.tseClient?.publicKey ?? undefined, sigAlgo: 'ecdsa-plain-SHA256', timeFormat: 'utcTime' },
      taxRates: taxRates.map((t) => ({ code: t.code, rate: Number(t.rate), description: t.code })),
      zClosings,
    }
  }

  /** Pacote DSFinV-K zipado (Buffer). Read-only. */
  async dsfinvkZip(tenantId: string, kasseId: string, from: Date, to: Date): Promise<Buffer> {
    const input = await this.dsfinvkInput(tenantId, kasseId, from, to)
    const files = buildDsfinvkPackage(input)
    const zip = new JSZip()
    for (const f of files) zip.file(f.filename, f.content)
    return zip.generateAsync({ type: 'nodebuffer' })
  }
}
```

- [ ] **Step 5: Implementar o controller**

```ts
// apps/api/src/exports/exports.controller.ts
import { Controller, Get, Query, Req, Res, UseGuards, BadRequestException } from '@nestjs/common'
import type { Response } from 'express'
import { ExportsService } from './exports.service'
import { JwtAuthGuard, type JwtUser } from '../auth/jwt-auth.guard'
import { PermissionsGuard } from '../rbac/permissions.guard'
import { RequirePermission } from '../rbac/require-permission.decorator'

@Controller('exports')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ExportsController {
  constructor(private readonly exports: ExportsService) {}

  @Get('kassen')
  @RequirePermission('admin.export.dsfinvk')
  async kassen(@Req() req: { user: JwtUser }) {
    return this.exports.kassen(req.user.tenant_id)
  }

  @Get('dsfinvk')
  @RequirePermission('admin.export.dsfinvk')
  async dsfinvk(
    @Req() req: { user: JwtUser },
    @Query('kasse_id') kasseId: string,
    @Query('from') from: string,
    @Query('to') to: string,
    @Res() res: Response,
  ): Promise<void> {
    if (!kasseId || !from || !to) throw new BadRequestException('kasse_id, from, to required')
    const f = new Date(from)
    const t = new Date(to)
    if (isNaN(f.getTime()) || isNaN(t.getTime()) || f > t) throw new BadRequestException('invalid date range')
    const buf = await this.exports.dsfinvkZip(req.user.tenant_id, kasseId, f, t)
    res.set({
      'content-type': 'application/zip',
      'content-disposition': `attachment; filename="dsfinvk_${kasseId}_${from}_${to}.zip"`,
    })
    res.send(buf)
  }
}
```

- [ ] **Step 6: Module + registrar no app**

```ts
// apps/api/src/exports/exports.module.ts
import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { PermissionsGuard } from '../rbac/permissions.guard'
import { ExportsService } from './exports.service'
import { ExportsController } from './exports.controller'

@Module({
  imports: [AuthModule],
  controllers: [ExportsController],
  providers: [ExportsService, PermissionsGuard],
})
export class ExportsModule {}
```

Editar `apps/api/src/app.module.ts`: importar `ExportsModule` e adicioná-lo ao array `imports` (ao lado de `ReportsModule`).

- [ ] **Step 7: Run test to verify it passes**

Run: `corepack pnpm --filter @gelato/api exec vitest run test/exports.e2e.test.ts`
Expected: PASS (2 testes). Se `res.send(buf)` falhar o content-type por interceptors, garantir que não há transform global que reescreve binário; o `@Res()` já dá controle total.

- [ ] **Step 8: Typecheck + suíte da API**

Run: `corepack pnpm exec tsc --noEmit -p apps/api/tsconfig.json` → sem erros.
Run: `corepack pnpm --filter @gelato/api exec vitest run` → tudo verde.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/exports apps/api/src/app.module.ts apps/api/package.json apps/api/test/exports.e2e.test.ts ../../pnpm-lock.yaml
git commit -m "feat(api): DSFinV-K export endpoint (ledger -> zip, RBAC, read-only)"
```

---

## Chunk 4: Kassenmeldung (payload §146a, sem ELSTER)

### Task 4.1: builder puro `kassenmeldung.ts`

**Files:**
- Create: `packages/compliance/src/dsfinvk/kassenmeldung.ts`
- Modify: `packages/compliance/src/index.ts`
- Test: `packages/compliance/test/kassenmeldung.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/compliance/test/kassenmeldung.test.ts
import { describe, it, expect } from 'vitest'
import { buildKassenmeldung, type KassenmeldungInput } from '../src/dsfinvk/kassenmeldung'

const input: KassenmeldungInput = {
  betrieb: { name: 'Gelateria Demo', street: 'Hauptstr. 1', plz: '10115', city: 'Berlin', finanzamtNr: '1101' },
  kasse: { id: 'k1', name: 'Kasse 1', serialNr: 'SER1', swBrand: 'gelato-core', swVersion: '1.0' },
  tse: { provider: 'fiskaly', serial: 'SANDBOX', certificate: 'CERT-X', inUseSince: '2026-01-01' },
  acquisition: { kind: 'Kauf', date: '2025-12-01' },
}

describe('buildKassenmeldung', () => {
  it('assembles the §146a notification payload (no submission)', () => {
    const p = buildKassenmeldung(input)
    expect(p.meldung).toBe('Mitteilung nach §146a Abs. 4 AO')
    expect(p.betrieb.finanzamtNr).toBe('1101')
    expect(p.kasse.serialNr).toBe('SER1')
    expect(p.tse.serial).toBe('SANDBOX')
    expect(p.tse.certificate).toBe('CERT-X')
    expect(p.submitted).toBe(false) // nunca submetido aqui
  })
}) 
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm --filter @gelato/compliance exec vitest run test/kassenmeldung.test.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/compliance/src/dsfinvk/kassenmeldung.ts

export interface KassenmeldungInput {
  betrieb: { name: string; street?: string; plz?: string; city?: string; finanzamtNr?: string }
  kasse: { id: string; name: string; serialNr?: string; swBrand?: string; swVersion?: string }
  tse: { provider: string; serial?: string; certificate?: string; inUseSince?: string }
  acquisition?: { kind: string; date?: string }
}

export interface KassenmeldungPayload {
  meldung: string
  betrieb: KassenmeldungInput['betrieb']
  kasse: KassenmeldungInput['kasse']
  tse: KassenmeldungInput['tse']
  acquisition?: KassenmeldungInput['acquisition']
  /** Sempre false: esta fatia NÃO submete ao ELSTER (validação externa). */
  submitted: boolean
}

/**
 * Monta a representação estruturada da Kassenmeldung (§146a Abs. 4 AO): Betriebsstätte,
 * Kasse, TSE e tipo/início de uso. NÃO submete ao ELSTER (ERiC + certificados + ambiente
 * credenciado = validação externa). O conjunto exato de campos = spec ELSTER/Steuerberater.
 */
export function buildKassenmeldung(input: KassenmeldungInput): KassenmeldungPayload {
  return {
    meldung: 'Mitteilung nach §146a Abs. 4 AO',
    betrieb: input.betrieb,
    kasse: input.kasse,
    tse: input.tse,
    acquisition: input.acquisition,
    submitted: false,
  }
}
```

- [ ] **Step 4: Export + run + typecheck**

Editar `packages/compliance/src/index.ts`: `export * from './dsfinvk/kassenmeldung'`.
Run: `corepack pnpm --filter @gelato/compliance exec vitest run test/kassenmeldung.test.ts` → PASS.
Run: `corepack pnpm --filter @gelato/compliance build` → dist atualizado.

- [ ] **Step 5: Commit**

```bash
git add packages/compliance/src/dsfinvk/kassenmeldung.ts packages/compliance/src/index.ts packages/compliance/test/kassenmeldung.test.ts
git commit -m "feat(compliance): Kassenmeldung §146a payload builder (no ELSTER)"
```

### Task 4.2: endpoint `GET /exports/kassenmeldung`

**Files:**
- Modify: `apps/api/src/exports/exports.service.ts`
- Modify: `apps/api/src/exports/exports.controller.ts`
- Test: `apps/api/test/exports.e2e.test.ts` (adicionar)

- [ ] **Step 1: Write the failing test** (adicionar ao describe existente)

```ts
  it('returns the kassenmeldung payload for the kasse', async () => {
    const res = await fetch(`${baseUrl}/exports/kassenmeldung?kasse_id=${KASSE}`, {
      headers: { authorization: `Bearer ${adminToken}` },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { tse: { serial: string }; submitted: boolean }
    expect(body.tse.serial).toBe('SER-1C')
    expect(body.submitted).toBe(false)
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm --filter @gelato/api exec vitest run test/exports.e2e.test.ts`
Expected: FAIL — rota inexistente.

- [ ] **Step 3: Implementar — service**

Adicionar em `ExportsService` (importar `buildKassenmeldung`, `type KassenmeldungPayload` de `@gelato/compliance`):
```ts
  async kassenmeldung(tenantId: string, kasseId: string): Promise<KassenmeldungPayload> {
    const kasse = await this.prisma.kasse.findFirst({
      where: { id: kasseId, betriebsstaette: { tenantId } },
      include: { tseClient: true, betriebsstaette: true },
    })
    if (!kasse) throw new NotFoundException('kasse not found')
    return buildKassenmeldung({
      betrieb: {
        name: kasse.betriebsstaette.name,
        street: kasse.betriebsstaette.address ?? undefined,
        finanzamtNr: kasse.betriebsstaette.finanzamtNr ?? undefined,
      },
      kasse: { id: kasse.id, name: kasse.name, serialNr: kasse.tseClient?.serialNr ?? undefined, swBrand: 'gelato-core', swVersion: undefined },
      tse: { provider: kasse.tseClient?.provider ?? 'unknown', serial: kasse.tseClient?.serialNr ?? undefined, certificate: kasse.tseClient?.publicKey ?? undefined, inUseSince: kasse.tseClient?.createdAt.toISOString() },
      acquisition: { kind: 'Kauf', date: kasse.createdAt.toISOString() },
    })
  }
```

- [ ] **Step 4: Implementar — controller**

Adicionar em `ExportsController`:
```ts
  @Get('kassenmeldung')
  @RequirePermission('admin.kassenmeldung')
  async kassenmeldung(@Req() req: { user: JwtUser }, @Query('kasse_id') kasseId: string) {
    if (!kasseId) throw new BadRequestException('kasse_id required')
    return this.exports.kassenmeldung(req.user.tenant_id, kasseId)
  }
```

- [ ] **Step 5: Run test + typecheck**

Run: `corepack pnpm --filter @gelato/api exec vitest run test/exports.e2e.test.ts` → PASS (3 testes).
Run: `corepack pnpm exec tsc --noEmit -p apps/api/tsconfig.json` → sem erros.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/exports apps/api/test/exports.e2e.test.ts
git commit -m "feat(api): Kassenmeldung endpoint (structured payload, RBAC)"
```

---

## Chunk 5: Backoffice — seção Exports

### Task 5.1: `apiGetBlob` + seção Exports

**Files:**
- Modify: `apps/backoffice/src/api.ts`
- Modify: `apps/backoffice/src/App.tsx`

- [ ] **Step 1: `apiGetBlob`**

Adicionar em `apps/backoffice/src/api.ts`:
```ts
export async function apiGetBlob(path: string, token: string): Promise<Blob> {
  const res = await fetch(`${BASE}${path}`, { headers: { authorization: `Bearer ${token}` } })
  if (!res.ok) throw new Error(`${path} failed`)
  return res.blob()
}
```

- [ ] **Step 2: Seção Exports no App.tsx**

Em `apps/backoffice/src/App.tsx`:
- Import: `import { apiGet, apiGetBlob, apiLogin } from './api'`.
- Adicionar `<Exports token={token} />` após `<Products token={token} />` no JSX do App.
- Novo componente:
```tsx
interface Kasse { id: string; name: string }

function Exports({ token }: { token: string }) {
  const [kassen, setKassen] = useState<Kasse[]>([])
  const [kasseId, setKasseId] = useState('')
  const [from, setFrom] = useState('2020-01-01')
  const [to, setTo] = useState('2999-01-01')
  const [meldung, setMeldung] = useState<string>('')

  useEffect(() => {
    apiGet<Kasse[]>('/exports/kassen', token)
      .then((ks) => { setKassen(ks); if (ks[0]) setKasseId(ks[0].id) })
      .catch(() => setKassen([]))
  }, [token])

  async function downloadDsfinvk(): Promise<void> {
    const blob = await apiGetBlob(`/exports/dsfinvk?kasse_id=${kasseId}&from=${from}&to=${to}`, token)
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `dsfinvk_${kasseId}_${from}_${to}.zip`
    a.click()
    URL.revokeObjectURL(url)
  }

  async function loadKassenmeldung(): Promise<void> {
    const p = await apiGet<unknown>(`/exports/kassenmeldung?kasse_id=${kasseId}`, token)
    setMeldung(JSON.stringify(p, null, 2))
  }

  return (
    <section>
      <h2>Exports (Finanzamt)</h2>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <select value={kasseId} onChange={(e) => setKasseId(e.target.value)}>
          {kassen.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
        </select>
        <label>von <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label>bis <input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <button onClick={() => void downloadDsfinvk()} disabled={!kasseId}>DSFinV-K .zip</button>
        <button onClick={() => void loadKassenmeldung()} disabled={!kasseId}>Kassenmeldung</button>
      </div>
      {meldung && <pre style={{ fontSize: 12, background: '#f4f4f5', padding: 8, overflow: 'auto' }}>{meldung}</pre>}
    </section>
  )
}
```

- [ ] **Step 3: Typecheck + build do backoffice**

Run: `corepack pnpm exec tsc --noEmit -p apps/backoffice/tsconfig.json` → sem erros.
Run: `corepack pnpm --filter @gelato/backoffice build` → build ok.

> Verificação visual ao vivo (download do .zip, view da Kassenmeldung) fica para sessão interativa; a corretude do dado é coberta pelos e2e e pelo capstone.

- [ ] **Step 4: Commit**

```bash
git add apps/backoffice/src/api.ts apps/backoffice/src/App.tsx
git commit -m "feat(backoffice): Exports section (DSFinV-K download + Kassenmeldung view)"
```

---

## Chunk 6: Capstone e2e + verificação

### Task 6.1: capstone DSFinV-K ponta a ponta

**Files:**
- Create: `apps/api/test/dsfinvk-capstone.e2e.test.ts`

> Reusa o padrão do capstone da 1d: boot Nest, Kasse **única por run** (ledger append-only acumula), vendas (incl. Ausfall) → Z → `GET /exports/dsfinvk` → **descompacta** e afirma a coerência entre `bonkopf`/`z_ust`/`tse` e o que foi vendido. Também `GET /exports/kassenmeldung`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/test/dsfinvk-capstone.e2e.test.ts
import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import type { AddressInfo } from 'node:net'
import { PrismaClient } from '@prisma/client'
import JSZip from 'jszip'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { LocalRepo, finalizeSale, runOutboxOnce, HttpSyncClient } from '@gelato/pos-terminal'
import { FakeTseProvider, AusfallTracker, type TaxRate } from '@gelato/compliance'
import { AppModule } from '../src/app.module'

const rates: TaxRate[] = [
  { code: 'standard_19', rate: 0.19, validFrom: new Date('2020-01-01') },
  { code: 'reduced_7', rate: 0.07, validFrom: new Date('2020-01-01') },
]
const cart = [{ product: { id: 'p1', name: 'Eis', netCents: 100, mwstCodeImHaus: 'standard_19', mwstCodeAusserHaus: 'reduced_7' }, qty: 1 }]

describe('DSFinV-K capstone (ledger -> export -> unzip)', () => {
  let app: INestApplication
  let baseUrl: string
  let adminToken: string
  let opToken: string
  let prisma: PrismaClient
  let KASSE = ''

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = mod.createNestApplication()
    await app.listen(0)
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`
    prisma = new PrismaClient()
    adminToken = ((await (await fetch(`${baseUrl}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'admin@demo.test', password: 'admin123' }) })).json()) as { access_token: string }).access_token
    opToken = ((await (await fetch(`${baseUrl}/auth/pin`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kasse_id: 'demo-kasse', pin: '1234' }) })).json()) as { access_token: string }).access_token
    KASSE = `kasse-1c-cap-${crypto.randomUUID().slice(0, 8)}`
    const bs = await prisma.betriebsstaette.findFirst()
    await prisma.kasse.create({ data: { id: KASSE, name: '1c capstone', betriebsstaetteId: bs!.id } })
    await prisma.tseClient.create({ data: { kasseId: KASSE, provider: 'fiskaly', serialNr: 'SER-CAP' } })

    const repo = new LocalRepo()
    const tracker = new AusfallTracker()
    const base = { cart, mode: 'im_haus' as const, rates, kasseId: KASSE, tseClientId: 'c1', seller: { name: 'Demo' }, repo, tracker }
    await finalizeSale({ ...base, at: new Date(), tse: new FakeTseProvider({ serialNumber: 'SER-CAP' }) })
    await finalizeSale({ ...base, at: new Date(), tse: new FakeTseProvider({ serialNumber: 'SER-CAP' }) })
    await runOutboxOnce(repo, new HttpSyncClient(baseUrl, opToken))
    repo.close()
    await fetch(`${baseUrl}/pos/reports/z`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${adminToken}` }, body: JSON.stringify({ kasse_id: KASSE }) })
  }, 40000)

  afterAll(async () => {
    await prisma?.$disconnect()
    await app?.close()
  })

  it('exports a coherent DSFinV-K package for the closed Z', async () => {
    const res = await fetch(`${baseUrl}/exports/dsfinvk?kasse_id=${KASSE}&from=2020-01-01&to=2999-01-01`, { headers: { authorization: `Bearer ${adminToken}` } })
    expect(res.status).toBe(200)
    const zip = await JSZip.loadAsync(await res.arrayBuffer())
    const bonkopf = await zip.file('bonkopf.csv')!.async('string')
    const dataLines = bonkopf.split('\r\n').filter(Boolean).slice(1)
    expect(dataLines).toHaveLength(2) // 2 vendas im_haus
    const zust = await zip.file('z_ust.csv')!.async('string')
    expect(zust).toContain('"1"') // UST_SCHLUESSEL standard 19% (im_haus)
    const stammTse = await zip.file('stamm_tse.csv')!.async('string')
    expect(stammTse).toContain('SER-CAP')
  })
})
```

- [ ] **Step 2: Run + ajustar**

Run: `corepack pnpm --filter @gelato/api exec vitest run test/dsfinvk-capstone.e2e.test.ts`
Expected: PASS (ajustar nomes de campo se o seed/colunas diferirem).

- [ ] **Step 3: Suíte completa do monorepo**

Run: `corepack pnpm -r test`
Expected: tudo verde (lembrar do ABI Node p/ `@gelato/pos-terminal`: `corepack pnpm install --force` se a GUI Electron foi compilada antes).

- [ ] **Step 4: Commit**

```bash
git add apps/api/test/dsfinvk-capstone.e2e.test.ts
git commit -m "test(api): DSFinV-K capstone (ledger -> export -> unzip coherence)"
```

---

## Definition of Done (fatia 1c)

- [ ] `csv`/`centsToDecimal` fiéis (quoting, escape, decimal `.`) — testado.
- [ ] Registro de tabelas (14 arquivos) = fonte única; `index.xml` lista todas — testado.
- [ ] Mapeadores cobrem Stammdaten + Einzelaufzeichnung + Kassenabschluss; **Ausfall marcado em `tse.csv`** — testado.
- [ ] `buildDsfinvkPackage` produz index.xml + 14 CSVs — testado.
- [ ] `GET /exports/dsfinvk` devolve `.zip` read-only, RBAC `admin.export.dsfinvk`; operador → 403 — e2e.
- [ ] `GET /exports/kassenmeldung` devolve payload §146a (`submitted:false`), RBAC `admin.kassenmeldung` — e2e.
- [ ] Backoffice: seção Exports (download `.zip` + view Kassenmeldung) compila/builda.
- [ ] Capstone: export coerente do Z fechado (descompactado e conferido); `corepack pnpm -r test` verde.

## Riscos / validações externas (rastrear, não resolver)

- **DSFinV-K oficial:** nomes/ordem de colunas, formato decimal, `index.xml`/gdpdu DTD, UST_SCHLUESSEL → spec vigente do BMF.
- **Kassenmeldung:** conjunto exato de campos + submissão (ERiC + certificados + ambiente) → ELSTER + **Steuerberater**.
- **Certificado TSE/BSI** (Zertifikat I–IV) em `stamm_tse` → fiskaly/BSI.
- Retenção/prazos → **Steuerberater**.
