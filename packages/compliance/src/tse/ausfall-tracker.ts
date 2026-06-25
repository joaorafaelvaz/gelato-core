export type AusfallEventKind = 'started' | 'ended'

/** Estado persistível de um período de Ausfall em aberto. */
export interface AusfallOpenState {
  startedAt: string
  reason: string
}

/**
 * Máquina de estados pura do período de Ausfall. `record` é alimentado com o
 * resultado de cada tentativa de assinatura e retorna os eventos a emitir APENAS
 * na borda (entrar/sair), garantindo no máximo um par started→end por apagão.
 * Reidratável a partir do estado persistido (sobrevive a restart do terminal).
 */
export class AusfallTracker {
  private state: AusfallOpenState | null

  constructor(initial: AusfallOpenState | null = null) {
    this.state = initial
  }

  get current(): AusfallOpenState | null {
    return this.state
  }

  record(kind: 'signed' | 'ausfall', at: string, reason = ''): AusfallEventKind[] {
    if (kind === 'ausfall') {
      if (this.state) return []
      this.state = { startedAt: at, reason }
      return ['started']
    }
    if (!this.state) return []
    this.state = null
    return ['ended']
  }
}
