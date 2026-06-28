import type { ChecklistTaskType } from './task'

export type ReadingState = 'in_range' | 'too_low' | 'too_high'

/** Classifica um valor (decigraus) contra a faixa [min,max] (inclusiva). Puro. */
export function classifyReading(value: number, validMin: number, validMax: number): ReadingState {
  if (value < validMin) return 'too_low'
  if (value > validMax) return 'too_high'
  return 'in_range'
}

export interface ResultEval {
  type: ChecklistTaskType
  valueBool?: boolean | null
  valueNum?: number | null
  valueText?: string | null
  validMin?: number | null
  validMax?: number | null
}

/** Avalia um resultado: ok (passou?) + reading (só temperature). Puro. */
export function evaluateResult(r: ResultEval): { ok: boolean; reading: ReadingState | null } {
  if (r.type === 'temperature') {
    if (r.valueNum == null || r.validMin == null || r.validMax == null) return { ok: false, reading: null }
    const reading = classifyReading(r.valueNum, r.validMin, r.validMax)
    return { ok: reading === 'in_range', reading }
  }
  if (r.type === 'boolean') return { ok: r.valueBool === true, reading: null }
  return { ok: true, reading: null }
}
