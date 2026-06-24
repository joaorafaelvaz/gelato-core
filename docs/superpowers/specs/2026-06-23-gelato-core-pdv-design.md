# Design — `gelato-core`: PDV SaaS para Gelaterias (DE) — Roadmap + Ciclo 0

> Documento de design validado em brainstorming (2026-06-23). Mercado-alvo: Alemanha.
> Conformidade fiscal alemã obrigatória desde o MVP.

## Contexto

A especificação original do usuário já era, na prática, um documento de design completo
(stack, arquitetura, modelo de domínio, esquema de dados, APIs, roadmap). O problema não
era falta de design, e sim **tamanho**: 3 apps, 4 pacotes, 6 fases, com uma camada fiscal
que é por si só a parte mais arriscada. Em vez de um único plano raso, o trabalho foi
**decomposto em ciclos** — cada um com seu próprio brainstorming → spec → plano →
implementação — e este documento **desenha em profundidade apenas o Ciclo 0**.

### Decisões travadas
- **SaaS multi-tenant desde o início** — `tenant_id` em tudo, isolamento real.
- **Stack 100% TypeScript** (dev solo, forte em TS, sem Rust): **terminal Electron** +
  node-serialport, **backoffice React/Vite**, **API NestJS + Postgres**, monorepo. Tauri
  descartado.
- **Cloud-TSE (fiskaly) como padrão** — sem hardware por caixa. "Offline-first" passa a
  significar: *a venda nunca é bloqueada; a assinatura é online; quedas viram modo de
  falha documentado (TSE-Ausfall)*. Adapter pronto para Swissbit no futuro.
- **i18n no Ciclo 0:** DE + EN + PT preenchidos; infra pronta para IT.
- **Ciclo 0 = fundação SaaS + espinha fiscal**, fiscalmente **correta de verdade** (TSE
  real no sandbox, append-only real, imutabilidade imposta no banco, audit real).

## Roadmap (decomposição em ciclos)

| Ciclo | Conteúdo | Natureza |
|---|---|---|
| **0 — Fundação + espinha fiscal** | Monorepo+Docker, multi-tenant, auth+RBAC, produtos básicos, **+ 1 venda end-to-end correta** | Walking skeleton — prova todo o risco, superfície mínima |
| **1 — PDV completo + compliance** | Salão/takeaway, Tischplan, conta/split, pagamentos (cash/ZVT), turnos, **X/Z-Bericht**, **ESC/POS**, **DSFinV-K**, **Kassenmeldung**, modo de falha offline pleno | Largura funcional + completude legal |
| **2 — Estoque + Receitas** | Estoque manual, movimentos append-only, receitas (BOM), disponibilidade, alertas, decremento por venda | Diferencial operacional |
| **3 — Checklist/HACCP** | Templates, execução, controle de temperatura, relatórios | Food safety |
| **4 — Marketing/CRM** | CRM + consentimento DSGVO versionado, loyalty, vouchers/promoções, campanhas | Receita/retenção |
| **5 — Avançado** | Produção BOM 2 níveis, balança Dialog 06, BI, app mobile | Escala |

> A Fase 1 da spec original foi **dividida**: o risco arquitetural (TSE+offline+append-only+sync)
> virou o Ciclo 0; a largura funcional virou o Ciclo 1.

## Ciclo 0 — Escopo (YAGNI)

**DENTRO:** monorepo + Docker; pacotes `domain`/`compliance`/`sync`; multi-tenant
(tenant→Betriebsstätte→Kasse); auth (senha+PIN) + RBAC (seed operator/lagerist/admin);
produtos mínimos + config MwSt por modo; **1 venda end-to-end correta** (im_haus/außer_haus
→ assinatura fiskaly → recibo+QR → append-only SQLite → sync idempotente → ledger imutável
Postgres → audit); backoffice mínimo; i18n DE/EN/PT; `verfahrensdokumentation.md` iniciada.

**FORA (Ciclo 1+):** salão/mesas/split; pagamentos além de "dinheiro"; turnos/Kassensturz;
X/Z-Bericht; ESC/POS (recibo é tela/PDF no C0); DSFinV-K; Kassenmeldung; modo de falha
offline pleno; estoque/receitas/checklist/marketing; billing de assinatura.

## Arquitetura

```
gelato-core/
  apps/{pos-terminal (Electron+React+better-sqlite3), backoffice (React+Vite), api (NestJS+Postgres)}
  packages/{domain, compliance, sync}
  docker/  docs/{CLAUDE.md, verfahrensdokumentation.md}
```

Defaults: pnpm workspaces + Turborepo; Prisma (Postgres); better-sqlite3 (terminal); Vitest.

**Topologia de assinatura:** terminal assina **direto contra a fiskaly** (credenciais da Kasse
provisionadas no setup); **outbox sincroniza ao central de forma independente** — desacopla
assinar (internet→fiskaly) de durabilidade/fonte-de-verdade (central, eventualmente consistente).

## Modelo de dados (subconjunto C0) + imutabilidade

Tabelas: `tenants`, `betriebsstaetten`, `kassen`, `tse_clients` · `users`, `roles`,
`permissions`, `user_roles`, `role_permissions`, `audit_log` · `products`, `tax_rates` ·
espinha append-only: `orders`, `order_items`, `payments`, `receipts`, `tse_transactions`,
`z_reports`(estrutura) · sync: `sync_events`(central, `client_event_id` único) +
`outbox`(SQLite).

- **MwSt configurável/versionada:** `tax_rates(code, rate, valid_from, valid_to, tenant_id)`;
  produto referencia *qual código* aplica em cada modo. Seed conservador, confirmar com Steuerberater.
- **Imutabilidade no banco:** role Postgres sem `UPDATE`/`DELETE` em tabelas fiscais +
  triggers + testes que afirmam que UPDATE/DELETE falham. Correção = registro de **Storno**.

## Fluxo de venda (caminho crítico)

1. Operador entra por **PIN** (turno mínimo auto-aberto).
2. Monta pedido local (SQLite), escolhe `im_haus`/`außer_haus` por pedido; motor MwSt via `tax_rates`.
3. Finaliza → fiskaly (`StartTransaction`→`FinishTransaction`, `process_type=Kassenbeleg-V1`).
4. Recibo + **QR oficial DFKA** (tela/PDF no C0).
5. Append-only local + evento de outbox (`client_event_id`).
6. `POST /pos/sync` → central idempotente → ledger imutável + `audit_log`. Sync assíncrono.

## Conformidade no C0

- `TseProvider` port/adapter; `FiskalyProvider` real contra **sandbox**.
- **Seguir a especificação oficial literalmente** (DSFinV-K / TSE / QR DFKA) — não inventar payloads.
- Motor MwSt puro/testável; rates do banco, nunca hardcoded.
- Audit trail append-only; imutabilidade imposta no banco + testada.

## Erros / offline (C0)
- **Falha de assinatura:** bloqueia a finalização (modo de falha documentado = Ciclo 1).
- **Falha de sync:** outbox + retry com backoff; idempotência reprocessa com segurança.

## Testes e verificação

- **Unit:** motor MwSt (bordas de validade); idempotência (mesmo `client_event_id` 2×=1); QR (snapshot).
- **Integração:** `/pos/sync` E2E; testes que **afirmam UPDATE/DELETE fiscal falham**; RBAC;
  **TSE real contra sandbox fiskaly**.
- **E2E manual:** Docker up → venda im_haus e außer_haus (alíquotas diferentes) → recibo+QR →
  conferir ledger central + audit → derrubar rede → outbox reenvia sem duplicar.

## Definition of Done (Ciclo 0)
- Monorepo sobe com `docker compose up` + terminal e backoffice rodando.
- Multi-tenant + auth(PIN/senha) + RBAC com seed e testes passando.
- Venda im_haus/außer_haus com alíquotas distintas de `tax_rates` (nada hardcoded).
- Assinatura real no sandbox fiskaly via `TseProvider`; recibo + QR oficial.
- Append-only local + sync idempotente ao ledger imutável; `audit_log` gravado.
- Testes provando que UPDATE/DELETE fiscal falham.
- DE/EN/PT funcionando; `verfahrensdokumentation.md` iniciada.

## Riscos e validações externas (rastrear)
- **MwSt salão×takeaway p/ gelato, retenção (8 vs 10 anos), prazos Kassenmeldung:** confirmar
  com **Steuerberater**; manter configurável/versionado.
- **Certificação BSI vigente** do provedor TSE (fiskaly) antes de produção.
- **Esforço solo:** SaaS deste tamanho é multi-mês/ano; a decomposição em ciclos pequenos é o
  que o torna viável.

---
*Documento de engenharia — não substitui aconselhamento fiscal/jurídico de um Steuerberater.*
