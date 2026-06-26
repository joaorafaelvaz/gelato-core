import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import type { AddressInfo } from 'node:net'
import { PrismaClient } from '@prisma/client'
import JSZip from 'jszip'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { LocalRepo, finalizeSale, runOutboxOnce, HttpSyncClient } from '@gelato/pos-terminal'
import { FakeTseProvider, FailingTseProvider, AusfallTracker, type TaxRate } from '@gelato/compliance'
import { AppModule } from '../src/app.module'

const rates: TaxRate[] = [
  { code: 'standard_19', rate: 0.19, validFrom: new Date('2020-01-01') },
  { code: 'reduced_7', rate: 0.07, validFrom: new Date('2020-01-01') },
]
const cart = [{ product: { id: 'p1', name: 'Eis', netCents: 100, mwstCodeImHaus: 'standard_19', mwstCodeAusserHaus: 'reduced_7' }, qty: 1 }]

describe('DSFinV-K export (e2e)', () => {
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
    const a = await fetch(`${baseUrl}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'admin@demo.test', password: 'admin123' }) })
    adminToken = ((await a.json()) as { access_token: string }).access_token
    const o = await fetch(`${baseUrl}/auth/pin`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kasse_id: 'demo-kasse', pin: '1234' }) })
    opToken = ((await o.json()) as { access_token: string }).access_token

    KASSE = `kasse-1c-${crypto.randomUUID().slice(0, 8)}`
    const bs = await prisma.betriebsstaette.findFirst()
    await prisma.kasse.create({ data: { id: KASSE, name: '1c export', betriebsstaetteId: bs!.id } })
    await prisma.tseClient.create({ data: { kasseId: KASSE, provider: 'fiskaly', serialNr: 'SER-1C', publicKey: 'PUB' } })

    const repo = new LocalRepo()
    const tracker = new AusfallTracker()
    const base = { cart, mode: 'ausser_haus' as const, rates, kasseId: KASSE, tseClientId: 'c1', seller: { name: 'Demo' }, repo, tracker }
    await finalizeSale({ ...base, at: new Date(), tse: new FakeTseProvider({ serialNumber: 'SER-1C' }) })
    await finalizeSale({ ...base, at: new Date(), tse: new FailingTseProvider('down') })
    await runOutboxOnce(repo, new HttpSyncClient(baseUrl, opToken))
    repo.close()
    await fetch(`${baseUrl}/pos/reports/z`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${adminToken}` }, body: JSON.stringify({ kasse_id: KASSE }) })
  }, 40000)

  afterAll(async () => {
    await prisma?.$disconnect()
    await app?.close()
  })

  it('returns a zip with index.xml and the core files, including the Ausfall marker in tse.csv', async () => {
    const res = await fetch(`${baseUrl}/exports/dsfinvk?kasse_id=${KASSE}&from=2020-01-01&to=2999-01-01`, {
      headers: { authorization: `Bearer ${adminToken}` },
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('application/zip')
    const zip = await JSZip.loadAsync(await res.arrayBuffer())
    expect(zip.file('index.xml')).toBeTruthy()
    const bonkopf = await zip.file('bonkopf.csv')!.async('string')
    expect(bonkopf.split('\r\n').filter(Boolean).length).toBeGreaterThanOrEqual(3) // header + 2 bons
    const tse = await zip.file('tse.csv')!.async('string')
    expect(tse).toContain('"1"') // TSE_TA_FEHLER = '1' em alguma linha (Ausfall)
  })

  it('forbids the operator (no admin.export.dsfinvk)', async () => {
    const res = await fetch(`${baseUrl}/exports/dsfinvk?kasse_id=${KASSE}&from=2020-01-01&to=2999-01-01`, {
      headers: { authorization: `Bearer ${opToken}` },
    })
    expect(res.status).toBe(403)
  })
})
