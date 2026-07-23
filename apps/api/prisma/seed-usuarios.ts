/**
 * seed-usuarios.ts — injeta (ou atualiza) a equipe da loja: usuários + PIN + role.
 * Idempotente por e-mail. Roda várias vezes sem duplicar (atualiza PIN/senha/role).
 *
 * PIN é o login do operador na Kasse (pos-web). Admin/gerente também loga por e-mail
 * + senha no backoffice. O loginPin resolve pelo PRIMEIRO PIN que bate no tenant, então
 * PIN DEVE ser único por tenant — o script recusa PINs duplicados.
 *
 * Uso (no container gelato-api, ou local com tsx):
 *   corepack pnpm --filter @gelato/api exec tsx prisma/seed-usuarios.ts
 * Roster: edite DEFAULT_USUARIOS abaixo, OU passe SEED_USERS_JSON='[{...}]' no ambiente
 * (sem rebuild). Tenant via GELATO_TENANT_ID (default demo-tenant).
 *
 * Pré-requisito: o seed principal já rodou (cria as roles operator/admin/lagerist).
 */
import { config } from 'dotenv'
config()
import { PrismaClient } from '@prisma/client'
import { hashSecret, verifySecret } from '../src/auth/hash'
import { randomUUID } from 'node:crypto'

type Role = 'admin' | 'operator' | 'lagerist'
interface Usuario {
  nome: string
  email: string
  pin?: string // 4+ dígitos — login na Kasse
  senha?: string // opcional — login por e-mail no backoffice
  role: Role
}

// ── EDITE com a sua equipe real (ou defina SEED_USERS_JSON no ambiente) ────────
const DEFAULT_USUARIOS: Usuario[] = [
  { nome: 'Gerente', email: 'gerente@loja.local', senha: 'troque-esta-senha', pin: '1000', role: 'admin' },
  { nome: 'Caixa 1', email: 'caixa1@loja.local', pin: '1001', role: 'operator' },
  { nome: 'Caixa 2', email: 'caixa2@loja.local', pin: '1002', role: 'operator' },
  { nome: 'Estoque', email: 'estoque@loja.local', pin: '1003', role: 'lagerist' },
]

const TENANT_ID = process.env.GELATO_TENANT_ID || process.env.TENANT_ID || 'demo-tenant'
const USUARIOS: Usuario[] = process.env.SEED_USERS_JSON
  ? (JSON.parse(process.env.SEED_USERS_JSON) as Usuario[])
  : DEFAULT_USUARIOS

function validar(lista: Usuario[]): void {
  const pins = new Map<string, string>()
  const emails = new Set<string>()
  for (const u of lista) {
    if (!u.nome || !u.email || !u.role) throw new Error(`entrada inválida: ${JSON.stringify(u)}`)
    if (!u.pin && !u.senha) throw new Error(`${u.email}: precisa de pin e/ou senha`)
    if (u.pin && !/^\d{4,}$/.test(u.pin)) throw new Error(`${u.email}: PIN deve ter 4+ dígitos`)
    const email = u.email.toLowerCase()
    if (emails.has(email)) throw new Error(`e-mail duplicado: ${email}`)
    emails.add(email)
    if (u.pin) {
      if (pins.has(u.pin)) throw new Error(`PIN duplicado (${u.pin}) entre ${pins.get(u.pin)} e ${u.email} — login por PIN ficaria ambíguo`)
      pins.set(u.pin, u.email)
    }
  }
}

async function main(): Promise<void> {
  validar(USUARIOS)
  const prisma = new PrismaClient()
  try {
    // Confere que as roles existem (vindas do seed principal)
    const roles = await prisma.role.findMany({ where: { tenantId: TENANT_ID } })
    const roleId = new Map(roles.map((r) => [r.key, r.id]))
    for (const key of new Set(USUARIOS.map((u) => u.role))) {
      if (!roleId.has(key)) {
        throw new Error(`role "${key}" não existe no tenant ${TENANT_ID} — rode o seed principal antes (db:seed).`)
      }
    }

    // Guarda contra PIN colidindo com um usuário JÁ existente fora deste roster
    const rosterEmails = new Set(USUARIOS.map((u) => u.email.toLowerCase()))
    const existentesComPin = await prisma.user.findMany({
      where: { tenantId: TENANT_ID, pinHash: { not: null } },
      select: { email: true, pinHash: true },
    })
    for (const u of USUARIOS.filter((x) => x.pin)) {
      for (const e of existentesComPin) {
        if (!rosterEmails.has(e.email.toLowerCase()) && e.pinHash && (await verifySecret(e.pinHash, u.pin!))) {
          throw new Error(`PIN ${u.pin} (${u.email}) já é usado por ${e.email} no tenant — escolha outro.`)
        }
      }
    }

    for (const u of USUARIOS) {
      const email = u.email.toLowerCase()
      const pinHash = u.pin ? await hashSecret(u.pin) : null
      // passwordHash é NOT NULL: se não houver senha, gera uma inutilizável (login só por PIN)
      const passwordHash = u.senha ? await hashSecret(u.senha) : await hashSecret(randomUUID())

      const existing = await prisma.user.findUnique({ where: { email } })
      const user = existing
        ? await prisma.user.update({
            where: { email },
            data: {
              name: u.nome,
              active: true,
              pinHash: u.pin ? pinHash : existing.pinHash,
              ...(u.senha ? { passwordHash } : {}),
            },
          })
        : await prisma.user.create({
            data: { tenantId: TENANT_ID, name: u.nome, email, passwordHash, pinHash },
          })

      await prisma.userRole.upsert({
        where: { userId_roleId: { userId: user.id, roleId: roleId.get(u.role)! } },
        update: {},
        create: { userId: user.id, roleId: roleId.get(u.role)! },
      })
      console.log(`  ✓ ${u.nome} <${email}> — role ${u.role}${u.pin ? `, PIN ${u.pin}` : ''}${u.senha ? ', senha definida' : ''}`)
    }
    console.log(`\n[seed-usuarios] ${USUARIOS.length} usuário(s) no tenant ${TENANT_ID}.`)
  } finally {
    await prisma.$disconnect()
  }
}

void main().catch((e) => {
  console.error('[seed-usuarios] ERRO:', e instanceof Error ? e.message : e)
  process.exit(1)
})
