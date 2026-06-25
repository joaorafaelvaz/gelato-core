import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Pool } from 'pg'

// Imutabilidade fiscal imposta NO BANCO: o role app não tem UPDATE/DELETE nas
// tabelas fiscais (REVOKE), e um trigger barra UPDATE/DELETE mesmo para o owner.
// Estes testes provam o mecanismo (DoD do Ciclo 0). Usam `pg` direto (sem Nest).

const APP_URL = process.env.DATABASE_URL ?? 'postgresql://gelato_app:app_pw@127.0.0.1:5432/gelato_c0'
const OWNER_URL =
  process.env.DATABASE_URL_OWNER ?? 'postgresql://gelato_owner:owner_pw@127.0.0.1:5432/gelato_c0'

let appPool: Pool
let ownerPool: Pool
let dbAvailable = false

beforeAll(async () => {
  appPool = new Pool({ connectionString: APP_URL, connectionTimeoutMillis: 1500 })
  ownerPool = new Pool({ connectionString: OWNER_URL, connectionTimeoutMillis: 1500 })
  // Pula (não falha) quando não há Postgres acessível (ex.: rodando sem Docker).
  // Com Postgres no ar mas SEM a imutabilidade aplicada, os testes FALHAM de
  // propósito — o skip é só para a ausência total de banco.
  try {
    await ownerPool.query('SELECT 1')
    dbAvailable = true
  } catch {
    dbAvailable = false
  }
})

afterAll(async () => {
  await appPool?.end().catch(() => {})
  await ownerPool?.end().catch(() => {})
})

async function insertAudit(pool: Pool): Promise<string> {
  const id = `audit_${Date.now()}_${Math.random().toString(36).slice(2)}`
  await pool.query(
    `INSERT INTO audit_log (id, action, entity, ts) VALUES ($1, 'test.action', 'test', now())`,
    [id],
  )
  return id
}

async function insertCashMovement(pool: Pool): Promise<string> {
  const shiftId = `shift_${Date.now()}_${Math.random().toString(36).slice(2)}`
  await pool.query(
    `INSERT INTO shifts (id, "kasseId", "userId", status, "openingFloat", "openedAt")
     VALUES ($1, 'demo-kasse', 'u', 'open', 0, now())`,
    [shiftId],
  )
  const id = `cm_${Date.now()}_${Math.random().toString(36).slice(2)}`
  await pool.query(
    `INSERT INTO cash_movements (id, "shiftId", type, amount, ts) VALUES ($1, $2, 'sangria', 100, now())`,
    [id, shiftId],
  )
  return id
}

describe('fiscal immutability (DB-enforced)', () => {
  it('allows INSERT into a fiscal table as the app role', async (ctx) => {
    if (!dbAvailable) return ctx.skip()
    const id = await insertAudit(appPool)
    expect(id).toBeTruthy()
  })

  it('blocks UPDATE on a fiscal table (app role)', async (ctx) => {
    if (!dbAvailable) return ctx.skip()
    const id = await insertAudit(appPool)
    await expect(
      appPool.query(`UPDATE audit_log SET action='tampered' WHERE id=$1`, [id]),
    ).rejects.toThrow()
  })

  it('blocks DELETE on a fiscal table (app role)', async (ctx) => {
    if (!dbAvailable) return ctx.skip()
    const id = await insertAudit(appPool)
    await expect(appPool.query(`DELETE FROM audit_log WHERE id=$1`, [id])).rejects.toThrow()
  })

  it('blocks UPDATE even for the owner role (trigger defense-in-depth)', async (ctx) => {
    if (!dbAvailable) return ctx.skip()
    const id = await insertAudit(ownerPool)
    await expect(
      ownerPool.query(`UPDATE audit_log SET action='tampered' WHERE id=$1`, [id]),
    ).rejects.toThrow()
  })

  it('cash_movements is append-only (INSERT ok, UPDATE/DELETE blocked)', async (ctx) => {
    if (!dbAvailable) return ctx.skip()
    const id = await insertCashMovement(appPool)
    expect(id).toBeTruthy()
    await expect(
      appPool.query(`UPDATE cash_movements SET amount=0 WHERE id=$1`, [id]),
    ).rejects.toThrow()
    await expect(appPool.query(`DELETE FROM cash_movements WHERE id=$1`, [id])).rejects.toThrow()
  })
})
