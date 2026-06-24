/** Achata um objeto de tradução em chaves pontilhadas (ex.: "pos.receipt.total"). */
export function flattenKeys(obj: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) => {
    const key = prefix ? `${prefix}.${k}` : k
    return v !== null && typeof v === 'object'
      ? flattenKeys(v as Record<string, unknown>, key)
      : [key]
  })
}

/** Achata em pares [chave, valor]. */
export function flattenEntries(obj: Record<string, unknown>, prefix = ''): [string, unknown][] {
  return Object.entries(obj).flatMap(([k, v]) => {
    const key = prefix ? `${prefix}.${k}` : k
    return v !== null && typeof v === 'object'
      ? flattenEntries(v as Record<string, unknown>, key)
      : ([[key, v]] as [string, unknown][])
  })
}
