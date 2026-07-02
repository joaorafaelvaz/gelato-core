import { useEffect, useState } from 'react'
import { apiGet, apiPost, type ChecklistTemplateRow, type ChecklistRunRow } from '../api'

function fmtRange(min: number | null, max: number | null): string {
  if (min == null || max == null) return ''
  const c = (d: number) => `${d < 0 ? '-' : ''}${Math.floor(Math.abs(d) / 10)},${Math.abs(d) % 10}`
  return ` (${c(min)}…${c(max)} °C)`
}

export function Checklists({ token }: { token: string }) {
  const [templates, setTemplates] = useState<ChecklistTemplateRow[]>([])
  const [runs, setRuns] = useState<ChecklistRunRow[]>([])
  const [selected, setSelected] = useState('')
  const [values, setValues] = useState<Record<string, { bool?: boolean; celsius?: string; text?: string; corrective?: string }>>({})
  const [error, setError] = useState('')

  const reload = (): void => {
    apiGet<ChecklistTemplateRow[]>('/checklists/templates', token).then(setTemplates).catch(() => setTemplates([]))
    apiGet<ChecklistRunRow[]>('/checklists/runs', token).then(setRuns).catch(() => setRuns([]))
  }
  useEffect(reload, [token])

  const tpl = templates.find((t) => t.id === selected)
  const set = (taskId: string, patch: Partial<{ bool: boolean; celsius: string; text: string; corrective: string }>) =>
    setValues((v) => ({ ...v, [taskId]: { ...v[taskId], ...patch } }))

  async function submit(): Promise<void> {
    if (!tpl) return
    setError('')
    const results = tpl.tasks.map((t) => {
      const v = values[t.id] ?? {}
      const r: Record<string, unknown> = { task_id: t.id }
      if (t.type === 'boolean') r.value_bool = v.bool ?? false
      if (t.type === 'temperature') r.value_num = v.celsius != null && v.celsius !== '' ? Math.round(Number(v.celsius) * 10) : null
      if (t.type === 'text') r.value_text = v.text ?? ''
      if (v.corrective) r.corrective_action = v.corrective
      return r
    })
    try {
      await apiPost('/checklists/runs', token, { client_event_id: crypto.randomUUID(), template_id: tpl.id, kasse_id: 'demo-kasse', results })
      setValues({})
      reload()
    } catch {
      setError('Falha — confira valores e ações corretivas dos desvios.')
    }
  }

  return (
    <section style={{ marginTop: '2rem' }}>
      <h2>Checklists (HACCP)</h2>
      <select value={selected} onChange={(e) => { setSelected(e.target.value); setValues({}) }}>
        <option value="">— executar template —</option>
        {templates.filter((t) => t.active).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select>
      {tpl && (
        <div style={{ margin: '0.5rem 0', display: 'grid', gap: 6 }}>
          {tpl.tasks.map((t) => (
            <div key={t.id}>
              <label>
                {t.label}
                {t.type === 'temperature' && fmtRange(t.validMin, t.validMax)}{' '}
                {t.type === 'boolean' && <input type="checkbox" checked={values[t.id]?.bool ?? false} onChange={(e) => set(t.id, { bool: e.target.checked })} />}
                {t.type === 'temperature' && <input type="number" step="0.1" placeholder="°C" value={values[t.id]?.celsius ?? ''} onChange={(e) => set(t.id, { celsius: e.target.value })} />}
                {t.type === 'text' && <input value={values[t.id]?.text ?? ''} onChange={(e) => set(t.id, { text: e.target.value })} />}
              </label>
              {t.type !== 'text' && (
                <input style={{ marginLeft: 8 }} placeholder="ação corretiva (se desvio)" value={values[t.id]?.corrective ?? ''} onChange={(e) => set(t.id, { corrective: e.target.value })} />
              )}
            </div>
          ))}
          <button onClick={submit}>Submeter</button>
          {error && <span style={{ color: 'crimson' }}>{error}</span>}
        </div>
      )}
      <h3>Histórico</h3>
      <ul>
        {runs.map((r) => {
          const t = templates.find((x) => x.id === r.templateId)
          const dev = r.results.filter((x) => !x.ok).length
          return (
            <li key={r.id} style={{ color: r.status === 'deviations' ? '#b91c1c' : undefined }}>
              {t?.name ?? r.templateId} — {r.status}
              {dev > 0 ? ` (${dev} desvio(s))` : ''} — {new Date(r.completedAt).toLocaleString('de-DE')}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
