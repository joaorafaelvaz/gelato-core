const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://127.0.0.1:3000'

export interface LoginResult {
  access_token: string
  permissions: string[]
}
export interface ApiProduct {
  id: string
  name: string
  netCents: number
  mwstCodeImHaus: string
  mwstCodeAusserHaus: string
}
export interface ApiTaxRate {
  code: string
  rate: string
  validFrom: string
  validTo: string | null
}

export function apiBase(): string {
  return BASE
}

export async function loginPin(kasseId: string, pin: string): Promise<LoginResult> {
  const res = await fetch(`${BASE}/auth/pin`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ kasse_id: kasseId, pin }),
  })
  if (!res.ok) throw new Error('invalid pin')
  return res.json() as Promise<LoginResult>
}

export async function getProducts(token: string): Promise<ApiProduct[]> {
  const res = await fetch(`${BASE}/products`, { headers: { authorization: `Bearer ${token}` } })
  if (!res.ok) return []
  return res.json() as Promise<ApiProduct[]>
}

export async function getTaxRates(token: string): Promise<ApiTaxRate[]> {
  const res = await fetch(`${BASE}/tax-rates`, { headers: { authorization: `Bearer ${token}` } })
  if (!res.ok) return []
  return res.json() as Promise<ApiTaxRate[]>
}
