# Ciclo 3 · Fatia 3c — Relatórios HACCP + pendentes/atrasados

> Spec de design. Base: C0 + Ciclo 1 (menos 1e) + Ciclo 2 + 3a + 3b em `main` (origin/main 4da9ff8,
> 209 testes). Convenções: **leitura derivada** (nada materializado); **TDD**; **127.0.0.1** (5433;
> API :3001); inglês / domínio em alemão. **Fecha o Ciclo 3.**

## Problema

3a definiu templates (com `recurrence`), 3b registra runs (status `ok`/`deviations` + resultados).
Falta o **fechamento**: o sinal operacional ("fizemos o checklist de hoje?") e a **trilha de
auditoria** dos desvios + ações corretivas. Tudo é derivado dos runs.

## Decisões travadas (brainstorming 2026-06-27)

1. **Leitura derivada (pull)** — sem novos modelos/eventos; recomputado dos runs (3b) + templates (3a).
2. **Escopo:** status/pendentes (atrasado por recorrência) + log de desvios. Export/scheduler = fora.

## Lógica pura (`@gelato/compliance/src/checklist/schedule.ts`)

- **`isOverdue(recurrence, lastRunMs, nowMs) → boolean`**:
  - `daily`: atrasado se `lastRunMs == null` **ou** `dayBucket(lastRunMs) < dayBucket(nowMs)`
    (`dayBucket = floor(ms / 86_400_000)`, dias UTC).
  - `weekly`: idem por `weekBucket = floor(ms / (7 * 86_400_000))`.
  - `per_shift` / `on_event` / outro: **sempre `false`** (não agendado por tempo; informativo).
  - Buckets UTC = heurística testável (passa ms); refinamento Europe/Berlin = validação externa.

## API (extende o módulo `checklists`)

- **`GET /checklists/status`** (`checklist.view`) → por template **ativo** do tenant:
  `{ templateId, name, recurrence, lastRunAt: string | null, lastStatus: 'ok'|'deviations'|null,
  overdue: boolean }`. `overdue` via `isOverdue(recurrence, últimoRun?.completedAt.getTime() ?? null,
  Date.now())`. O painel operacional.
- **`GET /checklists/deviations`** (`checklist.view`) `?from?&to?` → todos os `ChecklistTaskResult`
  com `ok = false` (join com o run): `{ runId, templateId, completedAt, label, type, valueNum,
  reading, correctiveAction }`, recentes primeiro; filtro opcional por `run.completedAt` (ISO).

## Backoffice

Novo componente **"Relatórios HACCP"** (após `Checklists`): tabela de **status** (template,
recorrência, último run, **atrasado em vermelho**) + lista de **desvios recentes** (template, tarefa,
valor/leitura, ação corretiva, quando).

## Erros / bordas

- Template sem nenhum run → `lastRunAt = null`, `overdue = true` (daily/weekly).
- `from/to` ausentes → todo o histórico de desvios.
- Templates **inativos** não entram no status. `per_shift`/`on_event` → `overdue = false` sempre.

## Testes e verificação

- **Unit (puro):** `isOverdue` — daily (nunca-rodou / hoje / ontem), weekly (esta-semana /
  semana-passada), per_shift/on_event (sempre false).
- **API (e2e):** template sem run → status `overdue=true`; após um run → `overdue=false` +
  `lastStatus`; run com desvio aparece em `/checklists/deviations` com a ação corretiva; filtro
  `from/to` restringe.
- **Capstone (e2e):** template diário → status atrasado → submete run limpo (atrasado→false,
  status `ok`) → submete run com desvio (Kühlvitrine fora) → o desvio + ação corretiva aparecem no log.
- **Backoffice:** build + typecheck.

## Decomposição (3 chunks TDD)

1. **puro** — `isOverdue` em `@gelato/compliance` + build dist.
2. **API** — `GET /checklists/status` + `GET /checklists/deviations` + e2e + capstone.
3. **backoffice (Relatórios HACCP)** + build/typecheck; integrar `ciclo-3c → main` + push.
   **Fecha o Ciclo 3.**

## Fora de escopo (YAGNI / depois)

Export CSV/PDF do relatório HACCP; scheduler que *gera/cobra* runs automaticamente (aqui só *deriva*
o atrasado); notificação push/e-mail; trilha de temperatura dedicada (já vem de `GET /checklists/runs`);
recorrência `per_shift` ligada a turnos; timezone Europe/Berlin exato (DST).

## Validação externa (rastrear)

Janela de recorrência exata + timezone (Europe/Berlin, horário de verão) e retenção dos relatórios
HACCP → especialista food-safety. Aqui: buckets UTC como heurística de atraso.
