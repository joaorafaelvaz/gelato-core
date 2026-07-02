import { useTranslation } from 'react-i18next'
import { apiGet, type ChecklistDeviationRow, type ChecklistStatusRow } from '../api'
import { useFetch } from '../useFetch'
import { Spinner } from '../ui/Spinner'
import { ErrorState } from '../ui/ErrorState'
import { EmptyState } from '../ui/EmptyState'

const fmtC = (d: number | null): string =>
  d == null ? '' : `${d < 0 ? '-' : ''}${Math.floor(Math.abs(d) / 10)},${Math.abs(d) % 10} °C`

export function ChecklistReports({ token }: { token: string }) {
  const { t } = useTranslation()
  const status = useFetch(() => apiGet<ChecklistStatusRow[]>('/checklists/status', token), [token])
  const devs = useFetch(() => apiGet<ChecklistDeviationRow[]>('/checklists/deviations', token), [token])

  return (
    <section>
      <h3>{t('backoffice.haccp.status')}</h3>
      {status.loading && <Spinner />}
      {status.error && <ErrorState onRetry={status.reload} />}
      {status.data && status.data.length === 0 && <EmptyState message={t('backoffice.common.empty')} />}
      {status.data && status.data.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>{t('backoffice.haccp.checklist')}</th>
              <th>{t('backoffice.haccp.recurrence')}</th>
              <th>{t('backoffice.haccp.last')}</th>
              <th>{t('backoffice.haccp.state')}</th>
            </tr>
          </thead>
          <tbody>
            {status.data.map((s) => (
              <tr key={s.templateId} style={s.overdue ? { color: 'var(--red-text)', fontWeight: 700 } : undefined}>
                <td>{s.name}</td>
                <td>{s.recurrence}</td>
                <td>{s.lastRunAt ? new Date(s.lastRunAt).toLocaleString('de-DE') : '—'}</td>
                <td>{s.overdue ? t('backoffice.haccp.overdue') : (s.lastStatus ?? '—')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <h3>{t('backoffice.haccp.recentDeviations')}</h3>
      {devs.loading && <Spinner />}
      {devs.error && <ErrorState onRetry={devs.reload} />}
      {devs.data && devs.data.length === 0 && <EmptyState message={t('backoffice.common.empty')} />}
      {devs.data && devs.data.length > 0 && (
        <ul>
          {devs.data.map((d, i) => (
            <li key={`${d.runId}-${i}`}>
              {new Date(d.completedAt).toLocaleString('de-DE')} — {d.label}
              {d.type === 'temperature' ? ` ${fmtC(d.valueNum)} (${d.reading})` : ''}
              {d.correctiveAction ? ` → ${d.correctiveAction}` : ''}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
