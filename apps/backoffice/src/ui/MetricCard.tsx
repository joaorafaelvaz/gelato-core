export type Tone = 'neutral' | 'accent' | 'warning' | 'danger' | 'success'

export function MetricCard({ label, value, tone = 'neutral', onClick }: {
  label: string
  value: string
  tone?: Tone
  onClick?: () => void
}) {
  return (
    <button type="button" className={`metric metric-${tone}`} onClick={onClick}>
      <span className="metric-label">{label}</span>
      <span className="metric-value">{value}</span>
    </button>
  )
}
