import type { ReactNode } from 'react'
import type { Tone } from './MetricCard'

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>
}
