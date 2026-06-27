export type TableState = 'free' | 'occupied'

export function tableState(t: { openSessionId: string | null }): TableState {
  return t.openSessionId ? 'occupied' : 'free'
}

export interface CanvasBounds {
  w: number
  h: number
  tw: number
  th: number
}

/** Mantém (x,y) dentro do canvas (a mesa tem largura tw / altura th). */
export function clampPosition(x: number, y: number, b: CanvasBounds): { x: number; y: number } {
  return {
    x: Math.max(0, Math.min(x, b.w - b.tw)),
    y: Math.max(0, Math.min(y, b.h - b.th)),
  }
}
