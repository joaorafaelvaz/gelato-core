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

async function insertAusfall(pool: Pool): Promise<string> {
  const id = `ausf_${Date.now()}_${Math.random().toString(36).slice(2)}`
  await pool.query(
    `INSERT INTO tse_ausfall_log (id, "kasseId", "eventType", at, "clientEventId", "createdAt")
     VALUES ($1, 'demo-kasse', 'started', now(), $1, now())`,
    [id],
  )
  return id
}

async function insertBestellung(pool: Pool): Promise<{ bId: string; itemId: string }> {
  const tischId = `t_${Date.now()}_${Math.random().toString(36).slice(2)}`
  await pool.query(
    `INSERT INTO tische (id, "betriebsstaetteId", name, active, "createdAt", "updatedAt") VALUES ($1,'demo-bs','T',true,now(),now())`,
    [tischId],
  )
  const sId = `s_${Date.now()}_${Math.random().toString(36).slice(2)}`
  await pool.query(
    `INSERT INTO tischsessions (id, "tischId", "kasseId", status, "openedAt") VALUES ($1,$2,'demo-kasse','open',now())`,
    [sId, tischId],
  )
  const bId = `b_${Date.now()}_${Math.random().toString(36).slice(2)}`
  await pool.query(
    `INSERT INTO bestellungen (id, "clientEventId", "sessionId", "kasseId", "seqNr", "totalNet", "totalMwst", "totalGross", "createdAt")
     VALUES ($1,$1,$2,'demo-kasse',1,100,19,119,now())`,
    [bId, sId],
  )
  const itemId = `bi_${Date.now()}_${Math.random().toString(36).slice(2)}`
  await pool.query(
    `INSERT INTO bestellung_items (id, "bestellungId", "productId", qty, "unitNet", "mwstRate", "mwstCode") VALUES ($1,$2,'p1',1,100,0.19,'standard_19')`,
    [itemId, bId],
  )
  return { bId, itemId }
}

async function insertStockMovement(pool: Pool): Promise<string> {
  const itemId = `si_${Date.now()}_${Math.random().toString(36).slice(2)}`
  await pool.query(
    `INSERT INTO stock_items (id, "tenantId", name, unit, active, "createdAt", "updatedAt")
     VALUES ($1, 'demo-tenant', 'T', 'g', true, now(), now())`,
    [itemId],
  )
  const id = `sm_${Date.now()}_${Math.random().toString(36).slice(2)}`
  await pool.query(
    `INSERT INTO stock_movements (id, "tenantId", "stockItemId", type, "qtyDelta", "createdAt")
     VALUES ($1, 'demo-tenant', $2, 'receive', 100, now())`,
    [id, itemId],
  )
  return id
}

async function insertChecklistRun(pool: Pool): Promise<{ runId: string; resultId: string }> {
  const runId = `cr_${Date.now()}_${Math.random().toString(36).slice(2)}`
  await pool.query(
    `INSERT INTO checklist_runs (id, "tenantId", "templateId", "kasseId", "clientEventId", status, "completedAt", "createdAt")
     VALUES ($1, 'demo-tenant', 'tpl-haccp-daily', 'demo-kasse', $1, 'ok', now(), now())`,
    [runId],
  )
  const resultId = `ctr_${Date.now()}_${Math.random().toString(36).slice(2)}`
  await pool.query(
    `INSERT INTO checklist_task_results (id, "runId", "taskId", label, type, ok) VALUES ($1, $2, 'task-x', 'L', 'boolean', true)`,
    [resultId, runId],
  )
  return { runId, resultId }
}

async function insertConsentRecord(pool: Pool): Promise<string> {
  const custId = `cust_${Date.now()}_${Math.random().toString(36).slice(2)}`
  await pool.query(
    `INSERT INTO customers (id, "tenantId", email, "createdAt", "updatedAt") VALUES ($1, 'demo-tenant', 'x@x.de', now(), now())`,
    [custId],
  )
  const id = `cons_${Date.now()}_${Math.random().toString(36).slice(2)}`
  await pool.query(
    `INSERT INTO consent_records (id, "tenantId", "customerId", purpose, version, "textSnapshot", action, at)
     VALUES ($1, 'demo-tenant', $2, 'email_marketing', 1, 'T', 'granted', now())`,
    [id, custId],
  )
  return id
}

async function insertLoyaltyEntry(pool: Pool): Promise<string> {
  const custId = `lc_${Date.now()}_${Math.random().toString(36).slice(2)}`
  await pool.query(
    `INSERT INTO customers (id, "tenantId", email, "createdAt", "updatedAt") VALUES ($1, 'demo-tenant', 'l@x.de', now(), now())`,
    [custId],
  )
  const id = `le_${Date.now()}_${Math.random().toString(36).slice(2)}`
  await pool.query(
    `INSERT INTO loyalty_entries (id, "tenantId", "customerId", kind, points, stamps, at) VALUES ($1, 'demo-tenant', $2, 'earn', 10, 1, now())`,
    [id, custId],
  )
  return id
}

async function insertVoucherRedemption(pool: Pool): Promise<string> {
  const vid = `vc_${Date.now()}_${Math.random().toString(36).slice(2)}`
  await pool.query(
    `INSERT INTO vouchers (id, "tenantId", code, type, value, active, "createdAt") VALUES ($1, 'demo-tenant', $1, 'percent', 10, true, now())`,
    [vid],
  )
  const id = `vr_${Date.now()}_${Math.random().toString(36).slice(2)}`
  await pool.query(
    `INSERT INTO voucher_redemptions (id, "tenantId", "voucherId", "discountCents", at) VALUES ($1, 'demo-tenant', $2, 119, now())`,
    [id, vid],
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

  it('tse_ausfall_log is append-only (INSERT ok, UPDATE/DELETE blocked)', async (ctx) => {
    if (!dbAvailable) return ctx.skip()
    const id = await insertAusfall(appPool)
    expect(id).toBeTruthy()
    await expect(
      appPool.query(`UPDATE tse_ausfall_log SET reason='x' WHERE id=$1`, [id]),
    ).rejects.toThrow()
    await expect(appPool.query(`DELETE FROM tse_ausfall_log WHERE id=$1`, [id])).rejects.toThrow()
  })

  it('bestellungen + bestellung_items are append-only (operational tische/sessions stay mutable)', async (ctx) => {
    if (!dbAvailable) return ctx.skip()
    const { bId, itemId } = await insertBestellung(appPool)
    await expect(appPool.query(`UPDATE bestellungen SET "totalGross"=0 WHERE id=$1`, [bId])).rejects.toThrow()
    await expect(appPool.query(`DELETE FROM bestellungen WHERE id=$1`, [bId])).rejects.toThrow()
    await expect(appPool.query(`UPDATE bestellung_items SET qty=0 WHERE id=$1`, [itemId])).rejects.toThrow()
    await expect(appPool.query(`DELETE FROM bestellung_items WHERE id=$1`, [itemId])).rejects.toThrow()
  })

  it('stock_movements is append-only (INSERT ok, UPDATE/DELETE blocked); stock_items stays mutable', async (ctx) => {
    if (!dbAvailable) return ctx.skip()
    const id = await insertStockMovement(appPool)
    expect(id).toBeTruthy()
    await expect(appPool.query(`UPDATE stock_movements SET "qtyDelta"=0 WHERE id=$1`, [id])).rejects.toThrow()
    await expect(appPool.query(`DELETE FROM stock_movements WHERE id=$1`, [id])).rejects.toThrow()
  })

  it('checklist_runs + results are append-only (INSERT ok, UPDATE/DELETE blocked)', async (ctx) => {
    if (!dbAvailable) return ctx.skip()
    const { runId, resultId } = await insertChecklistRun(appPool)
    await expect(appPool.query(`UPDATE checklist_runs SET status='x' WHERE id=$1`, [runId])).rejects.toThrow()
    await expect(appPool.query(`DELETE FROM checklist_runs WHERE id=$1`, [runId])).rejects.toThrow()
    await expect(appPool.query(`UPDATE checklist_task_results SET ok=false WHERE id=$1`, [resultId])).rejects.toThrow()
    await expect(appPool.query(`DELETE FROM checklist_task_results WHERE id=$1`, [resultId])).rejects.toThrow()
  })

  it('consent_records is append-only (INSERT ok, UPDATE/DELETE blocked); customers stays mutable', async (ctx) => {
    if (!dbAvailable) return ctx.skip()
    const id = await insertConsentRecord(appPool)
    await expect(appPool.query(`UPDATE consent_records SET action='withdrawn' WHERE id=$1`, [id])).rejects.toThrow()
    await expect(appPool.query(`DELETE FROM consent_records WHERE id=$1`, [id])).rejects.toThrow()
  })

  it('loyalty_entries is append-only (INSERT ok, UPDATE/DELETE blocked)', async (ctx) => {
    if (!dbAvailable) return ctx.skip()
    const id = await insertLoyaltyEntry(appPool)
    await expect(appPool.query(`UPDATE loyalty_entries SET points=0 WHERE id=$1`, [id])).rejects.toThrow()
    await expect(appPool.query(`DELETE FROM loyalty_entries WHERE id=$1`, [id])).rejects.toThrow()
  })

  it('voucher_redemptions is append-only (INSERT ok, UPDATE/DELETE blocked); vouchers stays mutable', async (ctx) => {
    if (!dbAvailable) return ctx.skip()
    const id = await insertVoucherRedemption(appPool)
    await expect(appPool.query(`UPDATE voucher_redemptions SET "discountCents"=0 WHERE id=$1`, [id])).rejects.toThrow()
    await expect(appPool.query(`DELETE FROM voucher_redemptions WHERE id=$1`, [id])).rejects.toThrow()
  })
})
