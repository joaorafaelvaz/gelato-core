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
