const DAY_MS = 86_400_000

/**
 * Um template está "atrasado"? Heurística por buckets UTC. Puro (recebe nowMs).
 * - daily: nunca rodou OU o último run é de um dia (UTC) anterior ao de agora.
 * - weekly: idem por semana (bucket de 7 dias).
 * - per_shift/on_event/outro: nunca atrasado (não agendado por tempo).
 */
export function isOverdue(recurrence: string, lastRunMs: number | null, nowMs: number): boolean {
  const bucket = (ms: number, size: number): number => Math.floor(ms / size)
  if (recurrence === 'daily') {
    return lastRunMs == null || bucket(lastRunMs, DAY_MS) < bucket(nowMs, DAY_MS)
  }
  if (recurrence === 'weekly') {
    return lastRunMs == null || bucket(lastRunMs, 7 * DAY_MS) < bucket(nowMs, 7 * DAY_MS)
  }
  return false
}
