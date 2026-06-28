import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AppModule } from '../src/app.module'

// Capstone 3b: executa o template HACCP diário com a Kühlvitrine a 9,0°C (=900,
// fora de 200..700) + ação corretiva → run 'deviations', reading too_high,
// snapshot da faixa preservado; um run todo em faixa → 'ok'.
describe('Checklist runs capstone (e2e)', () => {
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

  async function dailyTemplate(): Promise<{ templateId: string; tasks: Record<string, string> }> {
    const id = ((await (await post('/checklists/templates', {
      name: `Daily-${crypto.randomUUID().slice(0, 8)}`, recurrence: 'daily',
      tasks: [
        { label: 'Hände gewaschen?', type: 'boolean' },
        { label: 'Vitrine gereinigt?', type: 'boolean' },
        { label: 'Tiefkühltruhe', type: 'temperature', valid_min: -2200, valid_max: -1800 },
        { label: 'Kühlvitrine', type: 'temperature', valid_min: 200, valid_max: 700 },
        { label: 'Bemerkungen', type: 'text', required: false },
      ],
    })).json()) as { id: string }).id
    const tpl = ((await (await get('/checklists/templates')).json()) as { id: string; tasks: { id: string; label: string }[] }[]).find((t) => t.id === id)!
    return { templateId: id, tasks: Object.fromEntries(tpl.tasks.map((t) => [t.label, t.id])) }
  }

  it('records a deviation run and a clean run', async () => {
    const { templateId, tasks } = await dailyTemplate()
    // run com desvio: Kühlvitrine a 9,0°C (900 > 700)
    const dev = await post('/checklists/runs', {
      client_event_id: crypto.randomUUID(), template_id: templateId, kasse_id: 'demo-kasse',
      results: [
        { task_id: tasks['Hände gewaschen?'], value_bool: true },
        { task_id: tasks['Vitrine gereinigt?'], value_bool: true },
        { task_id: tasks['Tiefkühltruhe'], value_num: -2000 },
        { task_id: tasks['Kühlvitrine'], value_num: 900, corrective_action: 'Kühlung nachgestellt, Ware geprüft' },
        { task_id: tasks['Bemerkungen'], value_text: 'Lieferung 8:00' },
      ],
    })
    expect(((await dev.json()) as { status: string }).status).toBe('deviations')

    // run limpo
    const clean = await post('/checklists/runs', {
      client_event_id: crypto.randomUUID(), template_id: templateId, kasse_id: 'demo-kasse',
      results: [
        { task_id: tasks['Hände gewaschen?'], value_bool: true },
        { task_id: tasks['Vitrine gereinigt?'], value_bool: true },
        { task_id: tasks['Tiefkühltruhe'], value_num: -2000 },
        { task_id: tasks['Kühlvitrine'], value_num: 500 },
      ],
    })
    expect(((await clean.json()) as { status: string }).status).toBe('ok')

    const runs = (await (await get(`/checklists/runs?template_id=${templateId}`)).json()) as { status: string; results: { label: string; type: string; validMin: number | null; reading: string | null }[] }[]
    expect(runs).toHaveLength(2)
    const devRun = runs.find((r) => r.status === 'deviations')!
    const kv = devRun.results.find((r) => r.label === 'Kühlvitrine')!
    expect(kv.reading).toBe('too_high')
    expect(kv.validMin).toBe(200) // snapshot da faixa preservado
  })
})
