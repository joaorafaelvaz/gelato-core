import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { apiGet, apiPost, type CampaignRow } from '../api'
import { useFetch } from '../useFetch'
import { useToast } from '../ui/Toast'
import { Spinner } from '../ui/Spinner'
import { ErrorState } from '../ui/ErrorState'
import { EmptyState } from '../ui/EmptyState'
import { Pagination } from '../ui/Pagination'

const PAGE = 25

export function Campaigns({ token }: { token: string }) {
  const { t } = useTranslation()
  const toast = useToast()
  const [name, setName] = useState('')
  const [channel, setChannel] = useState('email')
  const [body, setBody] = useState('')
  const [page, setPage] = useState(0)
  const campaigns = useFetch(() => apiGet<CampaignRow[]>('/campaigns', token), [token])

  async function create(e: FormEvent): Promise<void> {
    e.preventDefault()
    if (!name || !body) return
    try {
      await apiPost('/campaigns', token, { name, channel, body })
      toast('success', t('backoffice.common.saved'))
      setName('')
      setBody('')
      campaigns.reload()
    } catch {
      toast('error', t('backoffice.common.actionFailed'))
    }
  }

  async function send(id: string): Promise<void> {
    try {
      await apiPost(`/campaigns/${id}/send`, token, {})
      toast('success', t('backoffice.common.saved'))
      campaigns.reload()
    } catch {
      toast('error', t('backoffice.common.actionFailed'))
    }
  }

  const rows = campaigns.data ?? []
  const pageCount = Math.ceil(rows.length / PAGE)
  const visible = rows.slice(page * PAGE, (page + 1) * PAGE)

  return (
    <section>
      {campaigns.loading && <Spinner />}
      {campaigns.error && <ErrorState onRetry={campaigns.reload} />}
      {campaigns.data && rows.length === 0 && <EmptyState message={t('backoffice.common.empty')} />}
      {rows.length > 0 && (
        <>
          <table>
            <thead>
              <tr>
                <th>{t('backoffice.campaigns.name')}</th>
                <th>{t('backoffice.campaigns.channel')}</th>
                <th>{t('backoffice.campaigns.status')}</th>
                <th>{t('backoffice.campaigns.recipients')}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {visible.map((c) => (
                <tr key={c.id}>
                  <td>{c.name}</td>
                  <td>{c.channel}</td>
                  <td>{c.status}</td>
                  <td>{c.recipientCount ?? '—'}</td>
                  <td>{c.status === 'draft' && <button onClick={() => void send(c.id)}>{t('backoffice.campaigns.send')}</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination page={page} pageCount={pageCount} onPage={setPage} />
        </>
      )}
      <form onSubmit={create} style={{ marginTop: '0.5rem', display: 'flex', gap: '0.5rem' }}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('backoffice.campaigns.name')} />
        <select value={channel} onChange={(e) => setChannel(e.target.value)}>
          <option value="email">email</option>
          <option value="sms">sms</option>
        </select>
        <input value={body} onChange={(e) => setBody(e.target.value)} placeholder={t('backoffice.campaigns.message')} />
        <button type="submit">{t('backoffice.campaigns.create')}</button>
      </form>
    </section>
  )
}
