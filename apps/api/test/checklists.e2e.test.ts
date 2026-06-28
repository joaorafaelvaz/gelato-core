import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AppModule } from '../src/app.module'

describe('Checklists templates (e2e)', () => {
  let app: INestApplication
  let baseUrl: string
  let token: string

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = mod.createNestApplication()
    await app.listen(0)
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`
    token = ((await (await fetch(`${baseUrl}/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'admin@demo.test', password: 'admin123' }),
    })).json()) as { access_token: string }).access_token
  }, 30000)

  afterAll(async () => {
    await app?.close()
  })

  const post = (path: string, body: unknown) =>
    fetch(`${baseUrl}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(body) })
  const put = (path: string, body: unknown) =>
    fetch(`${baseUrl}${path}`, { method: 'PUT', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(body) })
  const get = (path: string) => fetch(`${baseUrl}${path}`, { headers: { authorization: `Bearer ${token}` } })

  it('creates a template with all 3 task types and GET returns it ordered', async () => {
    const name = `T-${crypto.randomUUID().slice(0, 8)}`
    const r = await post('/checklists/templates', {
      name, recurrence: 'daily',
      tasks: [
        { label: 'Hände?', type: 'boolean' },
        { label: 'TK', type: 'temperature', valid_min: -2200, valid_max: -1800 },
        { label: 'Notiz', type: 'text' },
      ],
    })
    expect(r.status).toBe(201)
    const id = ((await r.json()) as { id: string }).id
    const list = (await (await get('/checklists/templates')).json()) as { id: string; tasks: { label: string; type: string; validMin: number | null }[] }[]
    const tpl = list.find((t) => t.id === id)!
    expect(tpl.tasks.map((t) => t.type)).toEqual(['boolean', 'temperature', 'text'])
    expect(tpl.tasks[1].validMin).toBe(-2200)
  })

  it('rejects an incoherent task definition (400)', async () => {
    // temperature sem faixa
    expect((await post('/checklists/templates', { name: 'x', tasks: [{ label: 'TK', type: 'temperature' }] })).status).toBe(400)
    // min > max
    expect((await post('/checklists/templates', { name: 'x', tasks: [{ label: 'TK', type: 'temperature', valid_min: 700, valid_max: 200 }] })).status).toBe(400)
    // boolean com faixa
    expect((await post('/checklists/templates', { name: 'x', tasks: [{ label: 'B', type: 'boolean', valid_min: 0, valid_max: 1 }] })).status).toBe(400)
    // tasks vazio
    expect((await post('/checklists/templates', { name: 'x', tasks: [] })).status).toBe(400)
  })

  it('PUT replaces tasks and toggles active', async () => {
    const id = ((await (await post('/checklists/templates', { name: `P-${crypto.randomUUID().slice(0, 8)}`, tasks: [{ label: 'a', type: 'boolean' }] })).json()) as { id: string }).id
    expect((await put(`/checklists/templates/${id}`, { active: false, tasks: [{ label: 'b', type: 'text' }] })).status).toBe(200)
    const tpl = ((await (await get('/checklists/templates')).json()) as { id: string; active: boolean; tasks: { label: string }[] }[]).find((t) => t.id === id)!
    expect(tpl.active).toBe(false)
    expect(tpl.tasks.map((t) => t.label)).toEqual(['b'])
  })
})
