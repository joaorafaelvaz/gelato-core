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
