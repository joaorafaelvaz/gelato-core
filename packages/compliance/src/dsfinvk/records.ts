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

  // ---- Stammdaten globais (Kasse, Ort) ----
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
