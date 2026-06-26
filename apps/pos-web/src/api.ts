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

async function authedPost<T>(path: string, token: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`${path} -> ${res.status}`)
  return res.json() as Promise<T>
}

async function authedGet<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { headers: { authorization: `Bearer ${token}` } })
  if (!res.ok) throw new Error(`${path} -> ${res.status}`)
  return res.json() as Promise<T>
}

export interface Shift {
  id: string
  status: string
  expected?: number
  differenz?: number
}
export interface VatGroup {
  rate: number
  net: number
  mwst: number
  gross: number
}
export interface DayTotals {
  byVatRate: VatGroup[]
  byPayment: { method: string; amount: number }[]
  totalGross: number
  grandTotal: number
}
export interface ZReport {
  seqNr: number
  totals: DayTotals
}

export const openShift = (token: string, kasseId: string, openingFloat: number) =>
  authedPost<Shift>('/pos/shifts/open', token, { kasse_id: kasseId, opening_float: openingFloat })
export const closeShift = (token: string, shiftId: string, counted: number) =>
  authedPost<Shift>(`/pos/shifts/${shiftId}/close`, token, { counted })
export const cashMovement = (token: string, shiftId: string, type: 'sangria' | 'suprimento', amount: number) =>
  authedPost(`/pos/shifts/${shiftId}/cash-movement`, token, { type, amount })
export const drawerOpen = (token: string) => authedPost('/pos/drawer/open', token, {})
export const reportX = (token: string, kasseId: string) =>
  authedPost<{ totals: DayTotals }>('/pos/reports/x', token, { kasse_id: kasseId })
export const reportZ = (token: string, kasseId: string) =>
  authedPost<ZReport>('/pos/reports/z', token, { kasse_id: kasseId })

// --- Salão / Tische (1a-1) ---
export interface TableRow {
  id: string
  name: string
  openSessionId: string | null
}
export interface TabState {
  lines: { productId: string; mwstCode: string; mwstRate: number; qty: number; net: number }[]
  byVatRate: VatGroup[]
  totalNet: number
  totalMwst: number
  totalGross: number
}
export interface SessionView {
  id: string
  tischId: string
  status: string
  orderId: string | null
  tab: TabState
}

export const listTables = (token: string, kasseId: string) =>
  authedGet<TableRow[]>(`/pos/tables?kasse_id=${encodeURIComponent(kasseId)}`, token)
export const getSession = (token: string, id: string) =>
  authedGet<SessionView>(`/pos/sessions/${id}`, token)
export const openTable = (token: string, tischId: string, kasseId: string) =>
  authedPost<{ id: string }>(`/pos/tables/${tischId}/open`, token, { kasse_id: kasseId })
export const addBestellung = (token: string, id: string, event: unknown) =>
  authedPost<{ bestellungId: string; duplicate: boolean }>(`/pos/sessions/${id}/bestellung`, token, event)
export const payTable = (token: string, id: string, body: unknown) =>
  authedPost<{ orderId: string; duplicate: boolean }>(`/pos/sessions/${id}/pay`, token, body)
