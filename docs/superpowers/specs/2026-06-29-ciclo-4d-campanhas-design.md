# Ciclo 4 · Fatia 4d — Campanhas

> Spec de design. Base: C0 + Ciclo 1 (menos 1e) + Ciclo 2 + Ciclo 3 + 4a + 4b + 4c em `main`
> (origin/main 7b6ea15, 250 testes). **Fecha o Ciclo 4.** Convenções: **gate de consentimento
> obrigatório** (reusa `canContact` da 4a — DSGVO); **trilha de envio append-only** (reusa
> `fiscal_append_only()`); **fornecedor SEMPRE atrás de interface** (como `TseProvider`); **TDD**;
> **127.0.0.1** (5433; API :3001). RBAC `marketing.view/manage` já existe.

## Problema

A 4d adiciona **campanhas** de marketing por canal (email/SMS). O inegociável é **GDPR**: só se
envia para clientes com **consentimento válido** para aquele canal. A 4d conecta CRM + consentimento
(4a) e fecha o Ciclo 4.

## Decisões travadas (brainstorming 2026-06-29)

1. **Público = gate de consentimento.** Destinatários = clientes com `canContact` válido para o
   propósito do canal (não-anonimizados) **e** com o contato do canal preenchido. Segmento rico (Json)
   = depois.
2. **Envio por porta/adapter:** `CampaignSender` (interface) + `FakeCampaignSender` (default,
   registra/sucesso) + provider real (email/SMS) **esqueleto NÃO VERIFICADO** (precisa de creds), como
   `TseProvider`/`FiskalyProvider`.
3. **Trilha de envio append-only** (`CampaignDispatch`) — accountability GDPR (a quem foi enviado).

## Lógica pura (`@gelato/compliance/src/campaign/`)

- **`consentPurposeForChannel(channel) → string`** — `'email' → 'email_marketing'`, `'sms' →
  'sms_marketing'` (outro → `''`, público vazio).
- **`eligibleRecipients(customers, purpose) → string[]`** — ids dos clientes onde
  `canContact(records, purpose, anonymized) && contact != null`. `customers: { id, anonymized,
  contact: string | null, records }[]`. **Gate GDPR + entregabilidade.**
- **`CampaignSender`** (interface) `send({ channel, recipients, subject?, body }) → Promise<{ sent:
  number }>` + **`FakeCampaignSender`** (default, retorna `sent = recipients.length`) + **skeleton
  real** (`SkeletonCampaignSender.send` lança `not verified` — precisa de provider/creds).

## Dados

- **`Campaign`** (mutável até enviar): `id, tenantId, name, channel String` (`'email'|'sms'`),
  `subject String?, body String, status String` (`'draft'|'sent'`), `recipientCount Int?`, `createdAt,
  sentAt DateTime?`. GRANT DML.
- **`CampaignDispatch`** (**append-only**): `id, tenantId, campaignId, customerId, channel, at
  DateTime @default(now())`. FK→`Campaign`. GRANT SELECT/INSERT + trigger.

## API (`apps/api/src/campaigns`)

| Rota | RBAC | Efeito |
|---|---|---|
| `GET /campaigns` | `marketing.view` | campanhas (status, recipientCount). |
| `POST /campaigns` `{ name, channel, subject?, body }` | `marketing.manage` | cria draft. |
| `POST /campaigns/:id/send` | `marketing.manage` | resolve o público consentido (gate) → `FakeCampaignSender.send` → grava `CampaignDispatch` por destinatário → marca `sent` + `recipientCount`. **409** se já `sent`; **404** cross-tenant. |
| `GET /campaigns/:id/recipients` | `marketing.view` | a trilha de envio (quem recebeu). |

## Seed

Campanha demo draft (`email`, "Sommer-Newsletter").

## Backoffice (mínimo)

Seção **"Campanhas"**: lista (nome, canal, status, nº destinatários) + form de criação + botão
**Enviar**. Build + typecheck.

## Erros / bordas

- Canal sem propósito mapeado → público vazio. Enviar campanha já `sent` → **409**. Campanha de outro
  tenant → **404**. Cliente consentido mas **sem o contato do canal** → excluído. Cliente
  retirado/anonimizado → **excluído** (o teste central). `CampaignDispatch` append-only.

## Testes e verificação

- **Unit (puro):** `consentPurposeForChannel`; `eligibleRecipients` (consentido+contato → incluído;
  retirado / anonimizado / sem-contato → excluído); `FakeCampaignSender.send` (conta).
- **API (e2e):** criar; enviar dispara só p/ consentidos; `recipientCount` correto; trilha em
  `/recipients`; re-enviar → 409; **imutabilidade** de `campaign_dispatches`; cross-tenant 404.
- **Capstone (e2e):** 3 clientes — A consente `email_marketing` (com e-mail), B retira, C anonimiza →
  campanha email → enviar → **só A** na trilha, `recipientCount 1`, status `sent` → re-enviar → 409.
- **Backoffice:** build + typecheck.

## Decomposição (4 chunks TDD)

1. **puro + sender** — `consentPurposeForChannel` + `eligibleRecipients` + `CampaignSender` /
   `FakeCampaignSender` / skeleton em `@gelato/compliance` + build dist.
2. **modelo + seed** — `Campaign` (mutável, GRANT DML) + `CampaignDispatch` (append-only, trigger)
   via migração não-interativa; seed da campanha draft.
3. **API** — módulo `campaigns` (CRUD + send + recipients) com o gate + `FakeCampaignSender` (provider
   injetado) + e2e + imutabilidade + capstone.
4. **backoffice (Campanhas)** + build/typecheck; integrar `ciclo-4d → main` + push. **Fecha o Ciclo 4.**

## Fora de escopo (Ciclo 5 / YAGNI)

Provider real de email/SMS (o esqueleto fica; integração = validação externa com creds); agendamento
(`scheduled`); segmento rico (Json); double opt-in; métricas (abertura/clique); templates;
rate-limit/lotes; link de descadastro por mensagem.

## Validação externa (rastrear)

Transporte real (email/SMS) + DSGVO do conteúdo / opt-out por mensagem (Abmeldelink obrigatório) →
integração + jurídico. Aqui: gate de consentimento + trilha append-only + porta desacoplada (provider
real = esqueleto NÃO VERIFICADO).
