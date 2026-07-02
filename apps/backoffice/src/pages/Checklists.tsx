import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { apiGet, apiPost, type ChecklistRunRow, type ChecklistTemplateRow } from '../api'
import { useFetch } from '../useFetch'
import { useToast } from '../ui/Toast'
import { Spinner } from '../ui/Spinner'
import { ErrorState } from '../ui/ErrorState'
import { EmptyState } from '../ui/EmptyState'
import { Pagination } from '../ui/Pagination'

function fmtRange(min: number | null, max: number | null): string {
  if (min == null || max == null) return ''
  const c = (d: number) => `${d < 0 ? '-' : ''}${Math.floor(Math.abs(d) / 10)},${Math.abs(d) % 10}`
  return ` (${c(min)}…${c(max)} °C)`
}

const PAGE = 25

export function Checklists({ token }: { token: string }) {
  const { t } = useTranslation()
  const toast = useToast()
  const [selected, setSelected] = useState('')
  const [values, setValues] = useState<Record<string, { bool?: boolean; celsius?: string; text?: string; corrective?: string }>>({})
  const [page, setPage] = useState(0)
  const templates = useFetch(() => apiGet<ChecklistTemplateRow[]>('/checklists/templates', token), [token])
  const runs = useFetch(() => apiGet<ChecklistRunRow[]>('/checklists/runs', token), [token])

  const tpl = (templates.data ?? []).find((x) => x.id === selected)
  const set = (taskId: string, patch: Partial<{ bool: boolean; celsius: string; text: string; corrective: string }>) =>
    setValues((v) => ({ ...v, [taskId]: { ...v[taskId], ...patch } }))

  async function submit(): Promise<void> {
    if (!tpl) return
    const results = tpl.tasks.map((task) => {
      const v = values[task.id] ?? {}
      const r: Record<string, unknown> = { task_id: task.id }
      if (task.type === 'boolean') r.value_bool = v.bool ?? false
      if (task.type === 'temperature') r.value_num = v.celsius != null && v.celsius !== '' ? Math.round(Number(v.celsius) * 10) : null
      if (task.type === 'text') r.value_text = v.text ?? ''
      if (v.corrective) r.corrective_action = v.corrective
      return r
    })
    try {
      await apiPost('/checklists/runs', token, { client_event_id: crypto.randomUUID(), template_id: tpl.id, kasse_id: 'demo-kasse', results })
      setValues({})
      toast('success', t('backoffice.common.saved'))
      runs.reload()
    } catch {
      toast('error', t('backoffice.checklists.submitFailed'))
    }
  }

  const allRuns = runs.data ?? []
  const pageCount = Math.ceil(allRuns.length / PAGE)
  const visible = allRuns.slice(page * PAGE, (page + 1) * PAGE)

  return (
    <section>
      {templates.loading && <Spinner />}
      {templates.error && <ErrorState onRetry={templates.reload} />}
      {templates.data && (
        <>
          <select value={selected} onChange={(e) => { setSelected(e.target.value); setValues({}) }}>
            <option value="">{t('backoffice.checklists.run')}</option>
            {templates.data.filter((x) => x.active).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
          {tpl && (
            <div style={{ margin: '0.5rem 0', display: 'grid', gap: 6 }}>
              {tpl.tasks.map((task) => (
                <div key={task.id}>
                  <label>
                    {task.label}
                    {task.type === 'temperature' && fmtRange(task.validMin, task.validMax)}{' '}
                    {task.type === 'boolean' && <input type="checkbox" checked={values[task.id]?.bool ?? false} onChange={(e) => set(task.id, { bool: e.target.checked })} />}
                    {task.type === 'temperature' && <input type="number" step="0.1" placeholder="°C" value={values[task.id]?.celsius ?? ''} onChange={(e) => set(task.id, { celsius: e.target.value })} />}
                    {task.type === 'text' && <input value={values[task.id]?.text ?? ''} onChange={(e) => set(task.id, { text: e.target.value })} />}
                  </label>
                  {task.type !== 'text' && (
                    <input style={{ marginLeft: 8 }} placeholder={t('backoffice.checklists.corrective')} value={values[task.id]?.corrective ?? ''} onChange={(e) => set(task.id, { corrective: e.target.value })} />
                  )}
                </div>
              ))}
              <button onClick={() => void submit()}>{t('backoffice.checklists.submit')}</button>
            </div>
          )}
        </>
      )}
      <h3>{t('backoffice.checklists.history')}</h3>
      {runs.loading && <Spinner />}
      {runs.error && <ErrorState onRetry={runs.reload} />}
      {runs.data && runs.data.length === 0 && <EmptyState message={t('backoffice.common.empty')} />}
      {allRuns.length > 0 && (
        <>
          <ul>
            {visible.map((r) => {
              const tplName = (templates.data ?? []).find((x) => x.id === r.templateId)?.name
              const dev = r.results.filter((x) => !x.ok).length
              return (
                <li key={r.id} style={{ color: r.status === 'deviations' ? 'var(--red-text)' : undefined }}>
                  {tplName ?? r.templateId} — {r.status}
                  {dev > 0 ? ` (${t('backoffice.checklists.deviations', { count: dev })})` : ''} — {new Date(r.completedAt).toLocaleString('de-DE')}
                </li>
              )
            })}
          </ul>
          <Pagination page={page} pageCount={pageCount} onPage={setPage} />
        </>
      )}
    </section>
  )
}
