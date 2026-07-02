import { useEffect, useState } from 'react'
import { apiGet, apiPost, type CustomerRow } from '../api'

export function Customers({ token }: { token: string }) {
  const [customers, setCustomers] = useState<CustomerRow[]>([])
  const reload = (): void => {
    apiGet<CustomerRow[]>('/customers', token).then(setCustomers).catch(() => setCustomers([]))
  }
  useEffect(reload, [token])

  async function anonymize(id: string): Promise<void> {
    await apiPost(`/customers/${id}/anonymize`, token, {})
    reload()
  }

  return (
    <section style={{ marginTop: '2rem' }}>
      <h2>Clientes (CRM)</h2>
      <table>
        <thead>
          <tr>
            <th>Nome</th>
            <th>Contato</th>
            <th>Consentimentos</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {customers.map((c) => (
            <tr key={c.id} style={c.anonymizedAt ? { color: '#888' } : undefined}>
              <td>{c.anonymizedAt ? '— anonimizado —' : (c.name ?? '—')}</td>
              <td>{c.email ?? c.phone ?? '—'}</td>
              <td>{Object.entries(c.consents).map(([p, a]) => `${p}: ${a}`).join('; ') || '—'}</td>
              <td>{!c.anonymizedAt && <button onClick={() => anonymize(c.id)}>Anonimizar (DSGVO)</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
