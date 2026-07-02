import { useEffect, useState } from 'react'
import { apiGet, type ChecklistStatusRow, type ChecklistDeviationRow } from '../api'

export function ChecklistReports({ token }: { token: string }) {
  const [status, setStatus] = useState<ChecklistStatusRow[]>([])
  const [devs, setDevs] = useState<ChecklistDeviationRow[]>([])
  useEffect(() => {
    apiGet<ChecklistStatusRow[]>('/checklists/status', token).then(setStatus).catch(() => setStatus([]))
    apiGet<ChecklistDeviationRow[]>('/checklists/deviations', token).then(setDevs).catch(() => setDevs([]))
  }, [token])

  const fmtC = (d: number | null) => (d == null ? '' : `${d < 0 ? '-' : ''}${Math.floor(Math.abs(d) / 10)},${Math.abs(d) % 10} °C`)

  return (
    <section style={{ marginTop: '2rem' }}>
      <h2>Relatórios HACCP</h2>
      <h3>Status</h3>
      <table>
        <thead>
          <tr>
            <th>Checklist</th>
            <th>Recorrência</th>
            <th>Último</th>
            <th>Estado</th>
          </tr>
        </thead>
        <tbody>
          {status.map((s) => (
            <tr key={s.templateId} style={s.overdue ? { color: '#b91c1c', fontWeight: 700 } : undefined}>
              <td>{s.name}</td>
              <td>{s.recurrence}</td>
              <td>{s.lastRunAt ? new Date(s.lastRunAt).toLocaleString('de-DE') : '—'}</td>
              <td>{s.overdue ? 'ATRASADO' : (s.lastStatus ?? '—')}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3>Desvios recentes</h3>
      <ul>
        {devs.map((d, i) => (
          <li key={`${d.runId}-${i}`}>
            {new Date(d.completedAt).toLocaleString('de-DE')} — {d.label}
            {d.type === 'temperature' ? ` ${fmtC(d.valueNum)} (${d.reading})` : ''}
            {d.correctiveAction ? ` → ${d.correctiveAction}` : ''}
          </li>
        ))}
      </ul>
    </section>
  )
}
