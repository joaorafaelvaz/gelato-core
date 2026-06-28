# Ciclo 3 · Fatia 3b — Execução de checklist + classificação HACCP

> Spec de design. Base: C0 + Ciclo 1 (menos 1e) + Ciclo 2 + 3a em `main` (origin/main 9d87b5b,
> 197 testes). Convenções: **temperatura inteira em decigraus**; **append-only** p/ registros HACCP
> (reusa `fiscal_append_only()`); **TDD**; **127.0.0.1** (5433; API :3001); inglês / domínio em alemão.

## Problema

A 3a definiu templates+tarefas (com faixa HACCP). A 3b **executa**: o operador faz a ronda e
registra os resultados; o sistema **classifica** cada leitura (temperatura dentro/fora da faixa,
higiene feita/não) e exige **ação corretiva** nos desvios. É o "controle de temperatura com faixa"
em ação. Relatórios/alertas = 3c.

## Decisões travadas (brainstorming 2026-06-27)

1. **Submissão única:** o run **completo** (template + todos os resultados) é enviado numa chamada →
   cria `ChecklistRun` + `ChecklistTaskResult`s atomicamente. **Idempotente** via `client_event_id`.
2. **Ação corretiva obrigatória no desvio:** tarefa *required* que não passa exige `corrective_action`
   (400 senão).
3. **Append-only** (food-safety) p/ `Run`/`Result` — reusa o trigger `fiscal_append_only()` (GRANT
   SELECT/INSERT + trigger), auditabilidade operacional (não §146a), como StockMovement.
4. **Snapshot:** cada resultado **fotografa** a def da tarefa (label/type/faixa) no momento → editar
   o template depois não reescreve o histórico HACCP.

## Lógica pura (`@gelato/compliance/src/checklist/result.ts`)

- **`classifyReading(value, validMin, validMax) → 'in_range'|'too_low'|'too_high'`** (decigraus).
- **`evaluateResult({type, valueBool?, valueNum?, validMin?, validMax?}) → { ok, reading }`**:
  - `boolean` → `ok = valueBool === true`, `reading = null`.
  - `temperature` → `reading = classifyReading(valueNum, validMin, validMax)`, `ok = reading === 'in_range'`
    (valor/faixa ausentes → `ok = false, reading = null`).
  - `text` → `ok = true, reading = null` (informativo).

## Dados (append-only)

- **`ChecklistRun`**: `id, tenantId, templateId, kasseId, executedBy String?` (userId), `clientEventId
  @unique`, `status String` (`'ok'|'deviations'`, derivado no insert), `startedAt DateTime?,
  completedAt DateTime @default(now()), createdAt`.
- **`ChecklistTaskResult`**: `id, runId`, `taskId String`, **snapshot** `label, type, validMin Int?,
  validMax Int?`, `valueBool Boolean?, valueNum Int?` (decigraus), `valueText String?`, `ok Boolean,
  reading String?, correctiveAction String?`. FK→`ChecklistRun`.
- GRANT SELECT/INSERT + trigger append-only nas duas tabelas.

## API (extende o módulo `checklists`)

- **`POST /checklists/runs`** (`checklist.execute`) `{ client_event_id, template_id, kasse_id,
  results: [{ task_id, value_bool?, value_num?, value_text?, corrective_action? }] }`:
  - **404** se template de outro tenant; **idempotente** (client_event_id repetido → devolve o run existente).
  - p/ cada tarefa **required** do template: exige um resultado com o valor do tipo certo (**400** se
    faltar valor); avalia `ok` via `evaluateResult`; se não-ok → exige `corrective_action` (**400** senão).
  - snapshota a def + grava os resultados; `status = 'deviations'` se algum required não-ok, senão `'ok'`.
- **`GET /checklists/runs`** (`checklist.view`) `?template_id?` → histórico (run + resultados),
  recentes primeiro.

## RBAC

Adicionar **`checklist.view` + `checklist.execute`** ao papel **operator** em `permissions.ts` +
re-seed (o staff faz a ronda). `checklist.manage` continua só no `admin`.

## Backoffice (mínimo)

Seção Checklists ganha **"Executar"**: escolhe um template → renderiza as tarefas (checkbox / °C /
nota; **°C→decigraus ×10**), pede `corrective_action` quando um valor falha, submete; abaixo, o
**histórico** dos runs (status + nº de desvios). Build + typecheck.

## Erros / bordas

- Template de outro tenant → 404. Tarefa required sem valor do tipo → 400. Desvio sem ação corretiva
  → 400. Retry (mesmo `client_event_id`) → mesmo run, sem duplicar. Tarefa opcional pode faltar.
  Texto sempre `ok`. Reabrir/corrigir run = **novo run** (append-only).

## Testes e verificação

- **Unit (puro):** `classifyReading` (in/low/high, bordas ==min/==max); `evaluateResult` (boolean
  sim/não, temperatura dentro/fora, text).
- **API (e2e):** run limpo → status `ok`; temperatura fora + ação corretiva → status `deviations`,
  result `ok=false`/`reading=too_high`; desvio sem ação → 400; required sem valor → 400; idempotência;
  **imutabilidade** de `checklist_runs`/`checklist_task_results`; operator (PIN) executa.
- **Capstone (e2e):** executa o template HACCP diário com a Kühlvitrine a 9,0°C (=900, fora de
  200..700) + ação corretiva → run `deviations`, `reading=too_high`, snapshot da faixa preservado;
  um run todo em faixa → `ok`.

## Decomposição (4 chunks TDD)

1. **puro** — `classifyReading` + `evaluateResult` em `@gelato/compliance` + build.
2. **modelo + RBAC** — `ChecklistRun` + `ChecklistTaskResult` (append-only, trigger+grant) via
   migração não-interativa; `checklist.view/execute` no operator + re-seed.
3. **API** — `POST/GET /checklists/runs` + e2e + imutabilidade + capstone.
4. **backoffice (executar + histórico)** + build/typecheck; integrar `ciclo-3b → main`.

## Fora de escopo (3c / YAGNI)

Relatórios/pendentes/atrasados + scheduler de recorrência + alertas de checklist (**3c**); anexos/foto;
assinatura digital; runs parciais/salvar progresso; reabertura/edição de run (append-only → correção =
novo run); numérico genérico.

## Validação externa (rastrear)

HACCP / Lebensmittelhygiene-VO (EU 852/2004) — campos/retenção dos registros → especialista
food-safety. Aqui: append-only + ação corretiva no desvio + snapshot da definição.
