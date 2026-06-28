import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AppModule } from '../src/app.module'

// Capstone 3c: template diário → status atrasado → run limpo (atrasado→false, ok)
// → run com desvio (Kühlvitrine fora) → o desvio + ação corretiva no log.
describe('Checklist reports capstone (e2e)', () => {
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
  const statusOf = async (id: string) => ((await (await get('/checklists/status')).json()) as { templateId: string; overdue: boolean; lastStatus: string | null }[]).find((s) => s.templateId === id)!

  it('drives a template from overdue → clean → records a deviation in the log', async () => {
    const tid = ((await (await post('/checklists/templates', {
      name: `Cap-${crypto.randomUUID().slice(0, 8)}`, recurrence: 'daily',
      tasks: [{ label: 'H', type: 'boolean' }, { label: 'KV', type: 'temperature', valid_min: 200, valid_max: 700 }],
    })).json()) as { id: string }).id
    const tpl = ((await (await get('/checklists/templates')).json()) as { id: string; tasks: { id: string; type: string }[] }[]).find((t) => t.id === tid)!
    const boolTask = tpl.tasks.find((t) => t.type === 'boolean')!.id
    const tempTask = tpl.tasks.find((t) => t.type === 'temperature')!.id

    expect((await statusOf(tid)).overdue).toBe(true) // sem run → atrasado

    await post('/checklists/runs', { client_event_id: crypto.randomUUID(), template_id: tid, kasse_id: 'demo-kasse', results: [{ task_id: boolTask, value_bool: true }, { task_id: tempTask, value_num: 500 }] })
    const afterClean = await statusOf(tid)
    expect(afterClean.overdue).toBe(false)
    expect(afterClean.lastStatus).toBe('ok')

    await post('/checklists/runs', { client_event_id: crypto.randomUUID(), template_id: tid, kasse_id: 'demo-kasse', results: [{ task_id: boolTask, value_bool: true }, { task_id: tempTask, value_num: 950, corrective_action: 'Kühlung geprüft' }] })
    expect((await statusOf(tid)).lastStatus).toBe('deviations')

    const devs = (await (await get('/checklists/deviations')).json()) as { templateId: string; label: string; reading: string | null; correctiveAction: string | null }[]
    const d = devs.filter((x) => x.templateId === tid)
    expect(d).toHaveLength(1)
    expect(d[0].reading).toBe('too_high')
    expect(d[0].correctiveAction).toBe('Kühlung geprüft')
  })
})
