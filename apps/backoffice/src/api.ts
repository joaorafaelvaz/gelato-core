const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://127.0.0.1:3000'

export interface LoginResult {
  access_token: string
  permissions: string[]
}

export async function apiLogin(email: string, password: string): Promise<LoginResult> {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  if (!res.ok) throw new Error('login failed')
  return res.json() as Promise<LoginResult>
}

export async function apiGet<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { headers: { authorization: `Bearer ${token}` } })
  if (!res.ok) throw new Error(`${path} failed`)
  return res.json() as Promise<T>
}

/** GET binário (ex.: download do .zip DSFinV-K) com o Bearer token. */
export async function apiGetBlob(path: string, token: string): Promise<Blob> {
  const res = await fetch(`${BASE}${path}`, { headers: { authorization: `Bearer ${token}` } })
  if (!res.ok) throw new Error(`${path} failed`)
  return res.blob()
}

export interface StockLevel {
  id: string
  name: string
  unit: string
  minStock: number | null
  qty: number
}

export interface RecipeRow {
  id: string
  productName: string
  variantName: string | null
  active: boolean
  ingredients: { stockItemId: string; stockItemName: string; unit: string; qty: number }[]
}

export interface Availability {
  recipeId: string
  maxProducible: number
}

export async function apiPost<T>(path: string, token: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`${path} failed`)
  return res.json() as Promise<T>
}
