import { useEffect, useState } from 'react'
import { apiGet, apiGetBlob } from '../api'

interface Kasse {
  id: string
  name: string
}

export function Exports({ token }: { token: string }) {
  const [kassen, setKassen] = useState<Kasse[]>([])
  const [kasseId, setKasseId] = useState('')
  const [from, setFrom] = useState('2020-01-01')
  const [to, setTo] = useState('2999-01-01')
  const [meldung, setMeldung] = useState<string>('')

  useEffect(() => {
    apiGet<Kasse[]>('/exports/kassen', token)
      .then((ks) => {
        setKassen(ks)
        if (ks[0]) setKasseId(ks[0].id)
      })
      .catch(() => setKassen([]))
  }, [token])

  async function downloadDsfinvk(): Promise<void> {
    const blob = await apiGetBlob(`/exports/dsfinvk?kasse_id=${kasseId}&from=${from}&to=${to}`, token)
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `dsfinvk_${kasseId}_${from}_${to}.zip`
    a.click()
    URL.revokeObjectURL(url)
  }

  async function loadKassenmeldung(): Promise<void> {
    const p = await apiGet<unknown>(`/exports/kassenmeldung?kasse_id=${kasseId}`, token)
    setMeldung(JSON.stringify(p, null, 2))
  }

  return (
    <section>
      <h2>Exports (Finanzamt)</h2>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <select value={kasseId} onChange={(e) => setKasseId(e.target.value)}>
          {kassen.map((k) => (
            <option key={k.id} value={k.id}>
              {k.name}
            </option>
          ))}
        </select>
        <label>
          von <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label>
          bis <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <button onClick={() => void downloadDsfinvk()} disabled={!kasseId}>
          DSFinV-K .zip
        </button>
        <button onClick={() => void loadKassenmeldung()} disabled={!kasseId}>
          Kassenmeldung
        </button>
      </div>
      {meldung && (
        <pre style={{ fontSize: 12, background: '#f4f4f5', padding: 8, overflow: 'auto' }}>{meldung}</pre>
      )}
    </section>
  )
}
