import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AppModule } from '../src/app.module'

describe('Checklist runs (e2e)', () => {
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

  const post = (path: string, body: unknown, tk = token) =>
    fetch(`${baseUrl}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${tk}` }, body: JSON.stringify(body) })
  const get = (path: string) => fetch(`${baseUrl}${path}`, { headers: { authorization: `Bearer ${token}` } })

  // Cria um template com 1 boolean + 1 temperature e devolve os ids das tarefas.
  async function makeTemplate(): Promise<{ templateId: string; boolTask: string; tempTask: string }> {
    const name = `R-${crypto.randomUUID().slice(0, 8)}`
    const templateId = ((await (await post('/checklists/templates', {
      name, tasks: [
        { label: 'Hände?', type: 'boolean' },
        { label: 'KV', type: 'temperature', valid_min: 200, valid_max: 700 },
      ],
    })).json()) as { id: string }).id
    const tpl = ((await (await get('/checklists/templates')).json()) as { id: string; tasks: { id: string; type: string }[] }[]).find((t) => t.id === templateId)!
    return {
      templateId,
      boolTask: tpl.tasks.find((t) => t.type === 'boolean')!.id,
      tempTask: tpl.tasks.find((t) => t.type === 'temperature')!.id,
    }
  }

  it('a clean run is status ok', async () => {
    const { templateId, boolTask, tempTask } = await makeTemplate()
    const r = await post('/checklists/runs', {
      client_event_id: crypto.randomUUID(), template_id: templateId, kasse_id: 'demo-kasse',
      results: [
        { task_id: boolTask, value_bool: true },
        { task_id: tempTask, value_num: 500 },
      ],
    })
    expect(r.status).toBe(201)
    expect(((await r.json()) as { status: string }).status).toBe('ok')
  })

  it('out-of-range temperature with a corrective action → deviations', async () => {
    const { templateId, boolTask, tempTask } = await makeTemplate()
    const r = await post('/checklists/runs', {
      client_event_id: crypto.randomUUID(), template_id: templateId, kasse_id: 'demo-kasse',
      results: [
        { task_id: boolTask, value_bool: true },
        { task_id: tempTask, value_num: 900, corrective_action: 'Kühlung nachgestellt' },
      ],
    })
    expect(r.status).toBe(201)
    expect(((await r.json()) as { status: string }).status).toBe('deviations')
    const runs = (await (await get(`/checklists/runs?template_id=${templateId}`)).json()) as { results: { type: string; ok: boolean; reading: string | null; correctiveAction: string | null }[] }[]
    const temp = runs[0].results.find((x) => x.type === 'temperature')!
    expect(temp.ok).toBe(false)
    expect(temp.reading).toBe('too_high')
    expect(temp.correctiveAction).toBe('Kühlung nachgestellt')
  })

  it('a deviation without a corrective action → 400', async () => {
    const { templateId, boolTask, tempTask } = await makeTemplate()
    const r = await post('/checklists/runs', {
      client_event_id: crypto.randomUUID(), template_id: templateId, kasse_id: 'demo-kasse',
      results: [{ task_id: boolTask, value_bool: true }, { task_id: tempTask, value_num: 900 }],
    })
    expect(r.status).toBe(400)
  })

  it('a required task without a value → 400', async () => {
    const { templateId, boolTask } = await makeTemplate()
    const r = await post('/checklists/runs', {
      client_event_id: crypto.randomUUID(), template_id: templateId, kasse_id: 'demo-kasse',
      results: [{ task_id: boolTask, value_bool: true }], // falta a temperatura
    })
    expect(r.status).toBe(400)
  })

  it('is idempotent on the same client_event_id', async () => {
    const { templateId, boolTask, tempTask } = await makeTemplate()
    const cid = crypto.randomUUID()
    const body = { client_event_id: cid, template_id: templateId, kasse_id: 'demo-kasse', results: [{ task_id: boolTask, value_bool: true }, { task_id: tempTask, value_num: 500 }] }
    const id1 = ((await (await post('/checklists/runs', body)).json()) as { id: string }).id
    const r2 = (await (await post('/checklists/runs', body)).json()) as { id: string; duplicate: boolean }
    expect(r2.id).toBe(id1)
    expect(r2.duplicate).toBe(true)
    const runs = (await (await get(`/checklists/runs?template_id=${templateId}`)).json()) as unknown[]
    expect(runs.length).toBe(1)
  })

  it('an operator (PIN) can execute a run', async () => {
    const { templateId, boolTask, tempTask } = await makeTemplate()
    const opTok = ((await (await fetch(`${baseUrl}/auth/pin`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kasse_id: 'demo-kasse', pin: '1234' }) })).json()) as { access_token: string }).access_token
    const r = await post('/checklists/runs', {
      client_event_id: crypto.randomUUID(), template_id: templateId, kasse_id: 'demo-kasse',
      results: [{ task_id: boolTask, value_bool: true }, { task_id: tempTask, value_num: 500 }],
    }, opTok)
    expect(r.status).toBe(201)
  })
})
