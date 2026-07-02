import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { apiGet, type ProductRow } from '../api'
import { euro } from '../format'

export function Products({ token }: { token: string }) {
  const { t } = useTranslation()
  const [products, setProducts] = useState<ProductRow[]>([])

  useEffect(() => {
    apiGet<ProductRow[]>('/products', token)
      .then(setProducts)
      .catch(() => setProducts([]))
  }, [token])

  return (
    <section>
      <h2>{t('backoffice.products.title')}</h2>
      <ul>
        {products.map((p) => (
          <li key={p.id}>
            {p.name} — {euro(p.netCents)}
          </li>
        ))}
      </ul>
    </section>
  )
}
