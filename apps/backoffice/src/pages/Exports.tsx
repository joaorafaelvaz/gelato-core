import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { apiGet, apiGetBlob } from '../api'
import { useFetch } from '../useFetch'
import { useToast } from '../ui/Toast'
import { Spinner } from '../ui/Spinner'
import { ErrorState } from '../ui/ErrorState'

interface Kasse {
  id: string
  name: string
}

export function Exports({ token }: { token: string }) {
  const { t } = useTranslation()
  const toast = useToast()
  const [kasseId, setKasseId] = useState('')
  const [from, setFrom] = useState('2020-01-01')
  const [to, setTo] = useState('2999-01-01')
  const [meldung, setMeldung] = useState<string>('')
  const kassen = useFetch(() => apiGet<Kasse[]>('/exports/kassen', token), [token])

  const effectiveKasseId = kasseId || (kassen.data?.[0]?.id ?? '')

  async function downloadDsfinvk(): Promise<void> {
    try {
      const blob = await apiGetBlob(`/exports/dsfinvk?kasse_id=${effectiveKasseId}&from=${from}&to=${to}`, token)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `dsfinvk_${effectiveKasseId}_${from}_${to}.zip`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      toast('error', t('backoffice.common.actionFailed'))
    }
  }

  async function loadKassenmeldung(): Promise<void> {
    try {
      const p = await apiGet<unknown>(`/exports/kassenmeldung?kasse_id=${effectiveKasseId}`, token)
      setMeldung(JSON.stringify(p, null, 2))
    } catch {
      toast('error', t('backoffice.common.actionFailed'))
    }
  }

  if (kassen.loading) return <Spinner />
  if (kassen.error) return <ErrorState onRetry={kassen.reload} />

  return (
    <section>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <select value={effectiveKasseId} onChange={(e) => setKasseId(e.target.value)}>
          {(kassen.data ?? []).map((k) => (
            <option key={k.id} value={k.id}>
              {k.name}
            </option>
          ))}
        </select>
        <label>
          {t('backoffice.exports.from')} <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label>
          {t('backoffice.exports.to')} <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <button onClick={() => void downloadDsfinvk()} disabled={!effectiveKasseId}>
          DSFinV-K .zip
        </button>
        <button onClick={() => void loadKassenmeldung()} disabled={!effectiveKasseId}>
          Kassenmeldung
        </button>
      </div>
      {meldung && (
        <pre style={{ fontSize: 12, background: 'var(--bg)', padding: 8, overflow: 'auto' }}>{meldung}</pre>
      )}
    </section>
  )
}
