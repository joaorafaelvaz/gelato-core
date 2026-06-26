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
