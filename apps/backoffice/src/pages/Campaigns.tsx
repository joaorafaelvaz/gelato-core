import { useEffect, useState, type FormEvent } from 'react'
import { apiGet, apiPost, type CampaignRow } from '../api'

export function Campaigns({ token }: { token: string }) {
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([])
  const [name, setName] = useState('')
  const [channel, setChannel] = useState('email')
  const [body, setBody] = useState('')

  const reload = (): void => {
    apiGet<CampaignRow[]>('/campaigns', token).then(setCampaigns).catch(() => setCampaigns([]))
  }
  useEffect(reload, [token])

  async function create(e: FormEvent): Promise<void> {
    e.preventDefault()
    if (!name || !body) return
    await apiPost('/campaigns', token, { name, channel, body })
    setName('')
    setBody('')
    reload()
  }

  async function send(id: string): Promise<void> {
    await apiPost(`/campaigns/${id}/send`, token, {})
    reload()
  }

  return (
    <section style={{ marginTop: '2rem' }}>
      <h2>Campanhas</h2>
      <table>
        <thead>
          <tr>
            <th>Nome</th>
            <th>Canal</th>
            <th>Status</th>
            <th>Destinatários</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {campaigns.map((c) => (
            <tr key={c.id}>
              <td>{c.name}</td>
              <td>{c.channel}</td>
              <td>{c.status}</td>
              <td>{c.recipientCount ?? '—'}</td>
              <td>{c.status === 'draft' && <button onClick={() => send(c.id)}>Enviar</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <form onSubmit={create} style={{ marginTop: '0.5rem', display: 'flex', gap: '0.5rem' }}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome" />
        <select value={channel} onChange={(e) => setChannel(e.target.value)}>
          <option value="email">email</option>
          <option value="sms">sms</option>
        </select>
        <input value={body} onChange={(e) => setBody(e.target.value)} placeholder="Mensagem" />
        <button type="submit">Criar</button>
      </form>
    </section>
  )
}
