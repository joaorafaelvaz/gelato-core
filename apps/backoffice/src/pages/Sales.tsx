import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { apiGet, type OrderRow } from '../api'
import { euro } from '../format'

export function Sales({ token }: { token: string }) {
  const { t } = useTranslation()
  const [orders, setOrders] = useState<OrderRow[]>([])

  useEffect(() => {
    apiGet<OrderRow[]>('/orders', token)
      .then(setOrders)
      .catch(() => setOrders([]))
  }, [token])

  return (
    <section>
      <h2>{t('backoffice.sales.title')}</h2>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th align="left">{t('pos.mode.label')}</th>
            <th align="right">{t('pos.receipt.total')}</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => (
            <tr key={o.id}>
              <td>{t(`pos.mode.${o.mode}`)}</td>
              <td align="right">{euro(o.totalGross)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
