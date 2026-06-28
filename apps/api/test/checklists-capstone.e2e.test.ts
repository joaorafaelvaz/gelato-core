import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AppModule } from '../src/app.module'

// Capstone 3a: monta o template HACCP diário realista (5 tarefas, 2 temperaturas
// com faixa em decigraus) e confere a estrutura via GET.
describe('Checklists capstone (e2e)', () => {
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
  const get = (path: string) => fetch(`${baseUrl}${path}`, { headers: { authorization: `Bearer ${token}` } })

  it('builds a realistic daily HACCP template', async () => {
    const name = `HACCP-${crypto.randomUUID().slice(0, 8)}`
    const id = ((await (await post('/checklists/templates', {
      name, recurrence: 'daily',
      tasks: [
        { label: 'Hände gewaschen?', type: 'boolean' },
        { label: 'Vitrine gereinigt?', type: 'boolean' },
        { label: 'Tiefkühltruhe', type: 'temperature', valid_min: -2200, valid_max: -1800 },
        { label: 'Kühlvitrine', type: 'temperature', valid_min: 200, valid_max: 700 },
        { label: 'Bemerkungen', type: 'text' },
      ],
    })).json()) as { id: string }).id

    const tpl = ((await (await get('/checklists/templates')).json()) as { id: string; recurrence: string; tasks: { label: string; type: string; validMin: number | null; validMax: number | null; sortOrder: number }[] }[]).find((t) => t.id === id)!
    expect(tpl.recurrence).toBe('daily')
    expect(tpl.tasks).toHaveLength(5)
    const tk = tpl.tasks.find((t) => t.label === 'Tiefkühltruhe')!
    expect([tk.validMin, tk.validMax]).toEqual([-2200, -1800])
    // ordenadas por sortOrder
    expect(tpl.tasks.map((t) => t.sortOrder)).toEqual([1, 2, 3, 4, 5])
    // tarefas não-temperatura sem faixa
    expect(tpl.tasks.find((t) => t.type === 'boolean')!.validMin).toBeNull()
  })
})
