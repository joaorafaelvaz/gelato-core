import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'node:path'
import { LocalRepo, finalizeSale, runOutboxOnce, HttpSyncClient, type CartLine } from '../index'
import { FakeTseProvider, type TaxRate } from '@gelato/compliance'
import type { ConsumptionMode } from '@gelato/domain'

const baseUrl = process.env.VITE_API_URL ?? 'http://127.0.0.1:3000'
const KASSE_ID = 'demo-kasse'
const TSE_CLIENT_ID = 'c1'
const tse = new FakeTseProvider({ serialNumber: 'SANDBOX' })

let repo: LocalRepo
let token = ''
let rates: TaxRate[] = []

interface ProductDto {
  id: string
  name: string
  netCents: number
  mwstCodeImHaus: string
  mwstCodeAusserHaus: string
}
interface CartItemDto extends ProductDto {
  qty: number
}

function registerIpc(): void {
  ipcMain.handle('auth:pin', async (_e, kasseId: string, pin: string) => {
    try {
      const res = await fetch(`${baseUrl}/auth/pin`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kasse_id: kasseId, pin }),
      })
      if (!res.ok) return { ok: false, error: 'invalid pin' }
      const data = (await res.json()) as { access_token: string; permissions: string[] }
      token = data.access_token
      const tr = await fetch(`${baseUrl}/tax-rates`, { headers: { authorization: `Bearer ${token}` } })
      const rows = (await tr.json()) as Array<{
        code: string
        rate: string
        validFrom: string
        validTo: string | null
      }>
      rates = rows.map((r) => ({
        code: r.code,
        rate: Number(r.rate),
        validFrom: new Date(r.validFrom),
        validTo: r.validTo ? new Date(r.validTo) : undefined,
      }))
      return { ok: true, permissions: data.permissions }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })

  ipcMain.handle('catalog:products', async (): Promise<ProductDto[]> => {
    const res = await fetch(`${baseUrl}/products`, { headers: { authorization: `Bearer ${token}` } })
    return res.ok ? ((await res.json()) as ProductDto[]) : []
  })

  ipcMain.handle('sale:finalize', async (_e, cart: CartItemDto[], mode: ConsumptionMode) => {
    try {
      const lines: CartLine[] = cart.map((c) => ({
        product: {
          id: c.id,
          name: c.name,
          netCents: c.netCents,
          mwstCodeImHaus: c.mwstCodeImHaus,
          mwstCodeAusserHaus: c.mwstCodeAusserHaus,
        },
        qty: c.qty,
      }))
      const { receipt } = await finalizeSale({
        cart: lines,
        mode,
        at: new Date(),
        rates,
        kasseId: KASSE_ID,
        tseClientId: TSE_CLIENT_ID,
        tse,
        repo,
        seller: { name: 'Gelateria Demo' },
      })
      return { ok: true, receipt: { qrPayload: receipt.qrPayload, total: receipt.total } }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1024,
    height: 768,
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      sandbox: false,
    },
  })
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
}

app
  .whenReady()
  .then(() => {
    repo = new LocalRepo(join(app.getPath('userData'), 'gelato.db'))
    registerIpc()
    createWindow()
    // Outbox: sincroniza a cada 5s quando há sessão (offline-first).
    setInterval(() => {
      if (token) void runOutboxOnce(repo, new HttpSyncClient(baseUrl, token)).catch(() => {})
    }, 5000)
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e)
  })

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
