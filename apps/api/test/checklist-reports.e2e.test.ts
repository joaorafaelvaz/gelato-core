import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AppModule } from '../src/app.module'

describe('Checklist reports (e2e)', () => {
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

  async function makeTemplate(): Promise<{ templateId: string; boolTask: string; tempTask: string }> {
    const id = ((await (await post('/checklists/templates', {
      name: `Rep-${crypto.randomUUID().slice(0, 8)}`, recurrence: 'daily',
      tasks: [{ label: 'H', type: 'boolean' }, { label: 'KV', type: 'temperature', valid_min: 200, valid_max: 700 }],
    })).json()) as { id: string }).id
    const tpl = ((await (await get('/checklists/templates')).json()) as { id: string; tasks: { id: string; type: string }[] }[]).find((t) => t.id === id)!
    return { templateId: id, boolTask: tpl.tasks.find((t) => t.type === 'boolean')!.id, tempTask: tpl.tasks.find((t) => t.type === 'temperature')!.id }
  }

  it('status: a template with no run is overdue (daily)', async () => {
    const { templateId } = await makeTemplate()
    const status = (await (await get('/checklists/status')).json()) as { templateId: string; overdue: boolean; lastRunAt: string | null; lastStatus: string | null }[]
    const row = status.find((s) => s.templateId === templateId)!
    expect(row.overdue).toBe(true)
    expect(row.lastRunAt).toBeNull()
    expect(row.lastStatus).toBeNull()
  })

  it('status: after a run, not overdue and reflects last status', async () => {
    const { templateId, boolTask, tempTask } = await makeTemplate()
    await post('/checklists/runs', { client_event_id: crypto.randomUUID(), template_id: templateId, kasse_id: 'demo-kasse', results: [{ task_id: boolTask, value_bool: true }, { task_id: tempTask, value_num: 500 }] })
    const row = ((await (await get('/checklists/status')).json()) as { templateId: string; overdue: boolean; lastStatus: string | null }[]).find((s) => s.templateId === templateId)!
    expect(row.overdue).toBe(false)
    expect(row.lastStatus).toBe('ok')
  })

  it('deviations: an out-of-range result appears with its corrective action', async () => {
    const { templateId, boolTask, tempTask } = await makeTemplate()
    await post('/checklists/runs', { client_event_id: crypto.randomUUID(), template_id: templateId, kasse_id: 'demo-kasse', results: [{ task_id: boolTask, value_bool: true }, { task_id: tempTask, value_num: 950, corrective_action: 'nachgestellt' }] })
    const devs = (await (await get('/checklists/deviations')).json()) as { templateId: string; label: string; reading: string | null; correctiveAction: string | null; valueNum: number | null }[]
    const d = devs.find((x) => x.templateId === templateId)!
    expect(d.label).toBe('KV')
    expect(d.reading).toBe('too_high')
    expect(d.valueNum).toBe(950)
    expect(d.correctiveAction).toBe('nachgestellt')
  })
})
