export type ConsentAction = 'granted' | 'withdrawn'
export interface ConsentRecordInput {
  purpose: string
  action: ConsentAction
  at: number // epoch ms
}

/** Estado atual por propósito = a ação do registro mais recente (por at). Puro. */
export function currentConsents(records: ConsentRecordInput[]): Record<string, ConsentAction> {
  const latest = new Map<string, { at: number; action: ConsentAction }>()
  for (const r of records) {
    const cur = latest.get(r.purpose)
    if (!cur || r.at >= cur.at) latest.set(r.purpose, { at: r.at, action: r.action })
  }
  const out: Record<string, ConsentAction> = {}
  for (const [purpose, { action }] of latest) out[purpose] = action
  return out
}

/** Pode contatar p/ o propósito? Último = granted E não anonimizado. Puro. */
export function canContact(records: ConsentRecordInput[], purpose: string, anonymized: boolean): boolean {
  if (anonymized) return false
  return currentConsents(records)[purpose] === 'granted'
}
