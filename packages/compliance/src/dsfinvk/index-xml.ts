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
