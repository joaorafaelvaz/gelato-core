# Ciclo 3 · Fatia 3a — Checklist Templates + Tarefas (definição)

> Spec de design. Base: C0 + Ciclo 1 (menos 1e) + Ciclo 2 inteiro em `main` (origin/main 7107486,
> 190 testes). Convenções: **temperatura inteira em decigraus** (°C×10, sem floats); **master-data
> mutável** (não fiscal); **TDD**; **127.0.0.1** (5433; API :3001); inglês / termos de domínio em
> alemão. RBAC `checklist.view/execute/manage` **já existe** (hoje só no papel `admin`).

## Problema

Início do Ciclo 3 (Checklist/HACCP). A 3a é a **camada de definição**: modelos recorrentes de
verificação (higiene, temperatura) com suas tarefas, incluindo a **faixa HACCP** de temperatura.
Execução + classificação de leitura (3b) e relatórios/alertas (3c) dependem desta base.

## Decisões travadas (brainstorming 2026-06-27)

1. **Tipos de tarefa: `boolean` | `temperature` | `text`.** `temperature` carrega a faixa HACCP
   (`validMin`/`validMax`); `boolean`/`text` não têm faixa.
2. **Temperatura inteira em decigraus** (°C×10; −18,0°C = −180; faixa idem). Sem floats.
3. **Master-data MUTÁVEL** (não fiscal, não append-only) — GRANT DML completo, como products/recipes.
   A execução (3b) **fotografa** as definições no resultado → editar o template depois não reescreve
   o histórico HACCP.

## Dados

- **`ChecklistTemplate`** (mutável): `id, tenantId, name, recurrence` (string informativa:
  `daily`/`weekly`/`per_shift`/`on_event` — o agendamento real fica p/ a 3c), `active`, timestamps.
- **`ChecklistTask`** (mutável): `id, templateId, label, type ('boolean'|'temperature'|'text'),
  validMin Int?, validMax Int?` (decigraus, só p/ `temperature`), `required Boolean @default(true)`,
  `sortOrder Int @default(0)`, `active Boolean @default(true)`. FK→Template (`onDelete: Cascade`).
- GRANT DML completo p/ ambas (master-data nova precisa do grant explícito). Sem trigger append-only.

## Lógica pura (`@gelato/compliance/src/checklist/`)

- **`isValidTaskDefinition(type, validMin, validMax) → boolean`** — `temperature` exige
  `validMin != null && validMax != null && validMin ≤ validMax`; `boolean`/`text` exigem faixa nula.
  (A API usa p/ 400 em definição incoerente.)
- **`formatDecidegrees(d) → string`** — `−180 → "−18,0 °C"` (exibição, vírgula decimal alemã).
  *A classificação de leitura (valor vs faixa) é da 3b.*

## API (`apps/api/src/checklists`) — RBAC já existe (admin)

| Rota | RBAC | Corpo | Efeito |
|---|---|---|---|
| `GET /checklists/templates` | `checklist.view` | — | templates do tenant + tarefas (ordenadas por `sortOrder`). |
| `POST /checklists/templates` | `checklist.manage` | `{ name, recurrence?, tasks: [{label, type, valid_min?, valid_max?, required?}] }` | cria template+tarefas; **400** se alguma tarefa inválida (`isValidTaskDefinition`) ou `tasks` vazio. |
| `PUT /checklists/templates/:id` | `checklist.manage` | `{ name?, recurrence?, active?, tasks? }` | renomeia / liga-desliga / substitui as tarefas. **404** cross-tenant. |

- **DTOs** zod: `type ∈ {boolean,temperature,text}`; `valid_min`/`valid_max` inteiros opcionais;
  `tasks` ≥ 1. A coerência tipo×faixa é validada via `isValidTaskDefinition` (400).

## Seed

Template demo **"Tägliche Hygiene & Temperatur"** (`recurrence: daily`), tarefas:
boolean "Hände gewaschen?", boolean "Vitrine gereinigt?", temperature "Tiefkühltruhe"
(−2200..−1800), temperature "Kühlvitrine" (200..700), text "Bemerkungen". ids fixos
`tpl-haccp-daily` + `task-...` (upsert idempotente).

## Backoffice (mínimo)

Seção **"Checklists"**: lista os templates → tarefas (label, tipo, faixa formatada via
`formatDecidegrees` quando `temperature`). Leitura. Build + typecheck.

## Erros / bordas

- Tarefa `temperature` sem faixa, `min > max`, ou `boolean`/`text` **com** faixa → 400.
- Template sem tarefas → 400. Template de outro tenant → 404.
- `recurrence` é só rótulo (sem scheduler na 3a).

## Testes e verificação

- **Unit (puro):** `isValidTaskDefinition` (temperature ok / sem-faixa / min>max; boolean/text com
  faixa = inválido); `formatDecidegrees` (negativo, zero, vírgula).
- **API (e2e):** cria template com os 3 tipos → GET com a faixa certa; tarefa inválida → 400; PUT
  troca tarefas; cross-tenant 404.
- **Capstone (e2e):** monta o template HACCP diário realista (5 tarefas) → GET reflete tipos+faixas
  em decigraus, ordenadas.
- **Backoffice:** build + typecheck.

## Decomposição (4 chunks TDD)

1. **puro** — `isValidTaskDefinition` + `formatDecidegrees` em `@gelato/compliance` + build dist.
2. **modelo + seed** — `ChecklistTemplate` + `ChecklistTask` (mutável, GRANT DML) via migração
   não-interativa + seed do template diário.
3. **API** — módulo `checklists` (GET/POST/PUT templates) + RBAC + DTOs zod + e2e + capstone.
4. **backoffice (mínimo)** — seção Checklists (lista) + build/typecheck; integrar `ciclo-3a → main`.

## Fora de escopo (fatias seguintes / YAGNI)

Execução de checklist + `ChecklistRun`/`ChecklistTaskResult` append-only + classificação de leitura
(**3b**); relatórios/pendentes/atrasados/alertas + scheduler de recorrência (**3c**); tipo numérico
genérico; anexos/foto; assinatura do responsável; i18n das tarefas.

## Validação externa (rastrear)

Conformidade HACCP / Lebensmittelhygiene-VO (EU 852/2004) — campos/retenção dos registros →
especialista food-safety. Aqui: estrutura coerente + append-only na 3b.
