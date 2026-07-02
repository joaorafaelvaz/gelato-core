const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://127.0.0.1:3000'

let onUnauthorized: (() => void) | null = null

/** Registrado pelo App: 401 em qualquer chamada → limpa token e volta ao login. */
export function setOnUnauthorized(fn: (() => void) | null): void {
  onUnauthorized = fn
}

function check(res: Response, path: string): void {
  if (res.status === 401) onUnauthorized?.()
  if (!res.ok) throw new Error(`${path} failed`)
}

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
  check(res, path)
  return res.json() as Promise<T>
}

/** GET binário (ex.: download do .zip DSFinV-K) com o Bearer token. */
export async function apiGetBlob(path: string, token: string): Promise<Blob> {
  const res = await fetch(`${BASE}${path}`, { headers: { authorization: `Bearer ${token}` } })
  check(res, path)
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

export interface StockAlert {
  id: string
  name: string
  unit: string
  qty: number
  minStock: number | null
  state: 'low' | 'negative'
}

export interface ChecklistTemplateRow {
  id: string
  name: string
  recurrence: string
  active: boolean
  tasks: { id: string; label: string; type: string; validMin: number | null; validMax: number | null }[]
}

export interface ChecklistRunRow {
  id: string
  templateId: string
  status: string
  completedAt: string
  results: { label: string; type: string; ok: boolean; reading: string | null }[]
}

export interface ChecklistStatusRow {
  templateId: string
  name: string
  recurrence: string
  lastRunAt: string | null
  lastStatus: string | null
  overdue: boolean
}
export interface ChecklistDeviationRow {
  runId: string
  templateId: string
  completedAt: string
  label: string
  type: string
  valueNum: number | null
  reading: string | null
  correctiveAction: string | null
}

export interface CustomerRow {
  id: string
  name: string | null
  email: string | null
  phone: string | null
  anonymizedAt: string | null
  consents: Record<string, string>
}

export interface LoyaltyProgram {
  pointsPerEuro: number
  stampsPerItem: number
  active: boolean
}
export interface LoyaltyView {
  balance: { points: number; stamps: number }
  entries: { kind: string; points: number; stamps: number; at: string }[]
}

export interface VoucherRow {
  id: string
  code: string
  type: string
  value: number
  maxUses: number | null
  active: boolean
  usedCount: number
}

export interface CampaignRow {
  id: string
  name: string
  channel: string
  status: string
  recipientCount: number | null
}

export interface ProductionRecipeRow {
  id: string
  outputStockItemId: string
  outputName: string
  unit: string
  yieldQty: number
  active: boolean
  ingredients: { stockItemId: string; name: string; unit: string; qty: number }[]
}

export async function apiPut<T>(path: string, token: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })
  check(res, path)
  return res.json() as Promise<T>
}

export async function apiPost<T>(path: string, token: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })
  check(res, path)
  return res.json() as Promise<T>
}

export interface OrderRow {
  id: string
  ts: string
  mode: string
  totalGross: number
}

export interface ProductRow {
  id: string
  name: string
  netCents: number
}
