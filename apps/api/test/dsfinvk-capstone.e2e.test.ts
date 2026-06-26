import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import type { AddressInfo } from 'node:net'
import { PrismaClient } from '@prisma/client'
import JSZip from 'jszip'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { LocalRepo, finalizeSale, runOutboxOnce, HttpSyncClient } from '@gelato/pos-terminal'
import { FakeTseProvider, AusfallTracker, type TaxRate } from '@gelato/compliance'
import { AppModule } from '../src/app.module'

const rates: TaxRate[] = [
  { code: 'standard_19', rate: 0.19, validFrom: new Date('2020-01-01') },
  { code: 'reduced_7', rate: 0.07, validFrom: new Date('2020-01-01') },
]
const cart = [{ product: { id: 'p1', name: 'Eis', netCents: 100, mwstCodeImHaus: 'standard_19', mwstCodeAusserHaus: 'reduced_7' }, qty: 1 }]

describe('DSFinV-K capstone (ledger -> export -> unzip)', () => {
  let app: INestApplication
  let baseUrl: string
  let adminToken: string
  let opToken: string
  let prisma: PrismaClient
  let KASSE = ''

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = mod.createNestApplication()
    await app.listen(0)
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`
    prisma = new PrismaClient()
    adminToken = ((await (await fetch(`${baseUrl}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'admin@demo.test', password: 'admin123' }) })).json()) as { access_token: string }).access_token
    opToken = ((await (await fetch(`${baseUrl}/auth/pin`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kasse_id: 'demo-kasse', pin: '1234' }) })).json()) as { access_token: string }).access_token
    KASSE = `kasse-1c-cap-${crypto.randomUUID().slice(0, 8)}`
    const bs = await prisma.betriebsstaette.findFirst()
    await prisma.kasse.create({ data: { id: KASSE, name: '1c capstone', betriebsstaetteId: bs!.id } })
    await prisma.tseClient.create({ data: { kasseId: KASSE, provider: 'fiskaly', serialNr: 'SER-CAP' } })

    const repo = new LocalRepo()
    const tracker = new AusfallTracker()
    const base = { cart, mode: 'im_haus' as const, rates, kasseId: KASSE, tseClientId: 'c1', seller: { name: 'Demo' }, repo, tracker }
    await finalizeSale({ ...base, at: new Date(), tse: new FakeTseProvider({ serialNumber: 'SER-CAP' }) })
    await finalizeSale({ ...base, at: new Date(), tse: new FakeTseProvider({ serialNumber: 'SER-CAP' }) })
    await runOutboxOnce(repo, new HttpSyncClient(baseUrl, opToken))
    repo.close()
    await fetch(`${baseUrl}/pos/reports/z`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${adminToken}` }, body: JSON.stringify({ kasse_id: KASSE }) })
  }, 40000)

  afterAll(async () => {
    await prisma?.$disconnect()
    await app?.close()
  })

  it('exports a coherent DSFinV-K package for the closed Z', async () => {
    const res = await fetch(`${baseUrl}/exports/dsfinvk?kasse_id=${KASSE}&from=2020-01-01&to=2999-01-01`, { headers: { authorization: `Bearer ${adminToken}` } })
    expect(res.status).toBe(200)
    const zip = await JSZip.loadAsync(await res.arrayBuffer())
    const bonkopf = await zip.file('bonkopf.csv')!.async('string')
    const dataLines = bonkopf.split('\r\n').filter(Boolean).slice(1)
    expect(dataLines).toHaveLength(2) // 2 vendas im_haus
    const zust = await zip.file('z_ust.csv')!.async('string')
    expect(zust).toContain('"1"') // UST_SCHLUESSEL standard 19% (im_haus)
    const stammTse = await zip.file('stamm_tse.csv')!.async('string')
    expect(stammTse).toContain('SER-CAP')
  })
})
