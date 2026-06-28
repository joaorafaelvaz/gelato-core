export type ChecklistTaskType = 'boolean' | 'temperature' | 'text'

/**
 * Uma definição de tarefa é coerente quando: temperature tem faixa completa e
 * validMin ≤ validMax; boolean/text não têm faixa. Puro.
 */
export function isValidTaskDefinition(type: ChecklistTaskType, validMin: number | null, validMax: number | null): boolean {
  if (type === 'temperature') {
    return validMin != null && validMax != null && validMin <= validMax
  }
  return validMin == null && validMax == null
}

/** Decigraus (°C×10) → exibição alemã, ex.: -180 → "-18,0 °C". */
export function formatDecidegrees(d: number): string {
  const sign = d < 0 ? '-' : ''
  const abs = Math.abs(d)
  return `${sign}${Math.floor(abs / 10)},${abs % 10} °C`
}
