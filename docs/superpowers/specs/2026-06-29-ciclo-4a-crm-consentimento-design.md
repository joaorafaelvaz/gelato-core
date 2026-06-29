# Ciclo 4 · Fatia 4a — CRM + Consentimento DSGVO

> Spec de design. Base: C0 + Ciclo 1 (menos 1e) + Ciclo 2 + Ciclo 3 em `main` (origin/main 4140995,
> 216 testes). Convenções: **PII minimizada em colunas tipadas**; **trilha de consentimento
> append-only** (reusa `fiscal_append_only()`); **estado derivado**; **TDD**; **127.0.0.1** (5433;
> API :3001); inglês / domínio em alemão. RBAC `marketing.view/manage` + `customer.manage` **já
> existe** (hoje só no `admin`).

## Problema

Início do Ciclo 4 (Marketing/CRM). A 4a é a fundação + o **núcleo GDPR**: cadastrar clientes (PII
mínima) e registrar **consentimento versionado e auditável** por finalidade, com **direito ao
esquecimento**. Loyalty (4b), vouchers (4c) e campanhas (4d) dependem de ter cliente + consentimento
válido.

## Decisões travadas (brainstorming 2026-06-29)

1. **Consentimento = trilha append-only.** `ConsentRecord` (granted/withdrawn por cliente+propósito,
   com **snapshot** da versão+texto do termo). Estado atual = último registro por propósito
   (**derivado**, como estoque = Σ movimentos).
2. **Granular por finalidade** — `purpose` (`'email_marketing'`, `'sms_marketing'`…); opt-in
   independente por canal.
3. **PII em colunas tipadas** (`name`/`email`/`phone`) — minimização (sabe-se exatamente o que se guarda).
4. **Esquecimento por anonimização** — apagar é impossível (`Order.customerId` é append-only fiscal:
   não dá pra deletar a order nem nulificar o campo) → sobrescreve a PII + `anonymizedAt`,
   preservando a integridade do registro fiscal; a trilha de consentimento (sem PII direta) sobrevive
   p/ auditoria.

## Dados

- **`Customer`** (mutável, PII): `id, tenantId, name?, email?, phone?, anonymizedAt DateTime?`,
  `createdAt, updatedAt`. GRANT DML. **Sem FK nova em `Order.customerId`** (não se toca no modelo
  fiscal; o vínculo continua pelo id).
- **`ConsentVersion`** (mutável, termos publicados): `id, tenantId, purpose, version Int, text,
  active Boolean @default(true), createdAt`. `@@unique([tenantId, purpose, version])`. Novo termo =
  nova versão.
- **`ConsentRecord`** (**append-only**): `id, tenantId, customerId, purpose, version Int` (snapshot),
  `textSnapshot String` (snapshot), `action String` (`'granted'|'withdrawn'`), `at DateTime
  @default(now()), source String?`. FK→`Customer`. GRANT SELECT/INSERT + trigger append-only.

## Lógica pura (`@gelato/compliance/src/consent/state.ts`)

- **`currentConsents(records) → Record<string, 'granted'|'withdrawn'>`** — para cada `purpose`, a
  `action` do registro mais recente (por `at`; empate → o último do array). granted→withdrawn→granted
  = granted.
- **`canContact(records, purpose, anonymized) → boolean`** — último registro do propósito = `granted`
  **e** `!anonymized`.

## API (`apps/api/src/customers`) — RBAC já existe (admin)

| Rota | RBAC | Efeito |
|---|---|---|
| `GET /customers` / `GET /customers/:id` | `marketing.view` | clientes + consentimentos atuais (derivados de `currentConsents`). |
| `POST /customers` `{ name?, email?, phone? }` | `customer.manage` | cria; **400** se nenhum contato. |
| `PATCH /customers/:id` `{ name?, email?, phone? }` | `customer.manage` | atualiza contato (mutável); **404** cross-tenant; **409** se anonimizado. |
| `POST /customers/:id/consent` `{ purpose, action, source? }` | `customer.manage` | append `ConsentRecord`; ao `granted` snapshota a `ConsentVersion` **ativa** do propósito (**400** se não houver termo publicado). |
| `POST /customers/:id/anonymize` | `customer.manage` | **esquecimento**: zera PII + `anonymizedAt` + append `withdrawn` p/ todos os propósitos com consentimento ativo. Idempotente. |
| `GET /consent-versions` | `marketing.view` | termos publicados. |
| `POST /consent-versions` `{ purpose, text }` | `marketing.manage` | publica nova versão (auto-incrementa `version` do propósito; desativa as anteriores). |

- **DTOs** zod: `purpose`/`action` validados (`action ∈ {granted,withdrawn}`); `POST /customers`
  exige ≥1 de name/email/phone (checado no serviço → 400).

## Seed

Termo demo `ConsentVersion` (`email_marketing`, v1, texto curto). **Sem cliente demo** (PII sensível;
os testes criam os seus).

## Backoffice (mínimo)

Seção **"Clientes (CRM)"**: lista clientes (contato + consentimentos atuais por propósito;
"anonimizado" quando for o caso) + botão de **anonimizar**. Build + typecheck.

## Erros / bordas

- Cliente de outro tenant → 404. Criar sem nenhum contato → 400.
- `consent granted` sem termo publicado p/ o propósito → 400.
- Anonimizar já-anonimizado → idempotente (no-op). Editar contato de anonimizado → 409.
- `ConsentRecord` append-only (UPDATE/DELETE bloqueados).

## Testes e verificação

- **Unit (puro):** `currentConsents` (último por propósito; granted→withdrawn→granted = granted; multi
  propósito); `canContact` (withdrawn / anonimizado → false).
- **API (e2e):** cria cliente; publica termo; consente (snapshot da versão+texto); retira; estado
  derivado correto; `granted` sem termo → 400; **anonimizar** zera PII + retira tudo + `anonymizedAt`;
  **imutabilidade** de `consent_records`; cross-tenant 404; criar sem contato → 400.
- **Capstone (e2e):** ciclo de vida GDPR — cliente → publica termo → consente `email_marketing`
  (snapshot v1) → withdraw → anonimiza → PII nula, consentimentos `withdrawn`, `anonymizedAt` set,
  **mas a trilha de `ConsentRecord` sobrevive** (auditoria: ≥3 registros granted/withdrawn).
- **Backoffice:** build + typecheck.

## Decomposição (4 chunks TDD)

1. **puro** — `currentConsents` + `canContact` em `@gelato/compliance` + build dist.
2. **modelo + seed** — `Customer` + `ConsentVersion` (mutáveis, GRANT DML) + `ConsentRecord`
   (append-only, trigger) via migração não-interativa; seed do termo demo.
3. **API** — módulo `customers` (CRUD + consent + anonymize) + `consent-versions` + e2e +
   imutabilidade + capstone.
4. **backoffice (Clientes/CRM)** + build/typecheck; integrar `ciclo-4a → main` + push.

## Fora de escopo (fatias seguintes / YAGNI)

Loyalty (**4b**); vouchers/promoções (**4c**); campanhas/envio (**4d**); double opt-in por e-mail
real; export de dados do titular (DSGVO Auskunft — derivável depois); deduplicação de clientes;
import de contatos; FK `Order → Customer`.

## Validação externa (rastrear)

Texto/forma do consentimento, double opt-in, prazos de retenção, direito de acesso/portabilidade
(Auskunfts-/Datenübertragbarkeitsrecht) → **DPO/jurídico DSGVO**. Aqui: trilha append-only versionada
+ anonimização + minimização de PII.
