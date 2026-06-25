# Mapa de portabilidade — models do `sorveteria/gelato-core` → base `ciclo-0`

> Referência para os Ciclos 1–5. A base canônica é **este** projeto (espinha fiscal
> verificada, ~73 testes, PR #1). O projeto paralelo (`D:\Dev\joao\sorveteria\gelato-core`,
> 38 models, ~1 teste, `compliance` vazio) serve de **referência de schema** para a largura
> de domínio. Cada ciclo ainda passa por brainstorming → spec → plano → TDD.

## Ajustes OBRIGATÓRIOS ao portar (as regras da base prevalecem)
1. **Dinheiro = `Int` (cents).** O paralelo usa `Decimal(12,2)`. Converter tudo para Int cents
   (regra inegociável; evita qualquer ambiguidade de arredondamento entre camadas).
2. **MwSt nunca hardcoded.** O paralelo grava `mwst_im_haus`/`mwst_ausser_haus` como `Decimal`
   no próprio produto. Manter a abordagem da base: `tax_rates` versionada + o produto referencia
   um **código** por modo. (Versionamento por validade é exigência fiscal.)
3. **Adotar os enums deles** (melhoria a trazer): `OrderMode`, `OrderStatus(OPEN/HOLD/CLOSED/VOIDED)`,
   `PaymentMethod`, `ProductType(VENDAVEL/INSUMO/SEMI_ACABADO)`, `StockMovementType`,
   `ChecklistTaskType`, `VoucherType`, `CampaignChannel/Status`. Hoje a base usa `String`.
4. **Adotar `onDelete` explícito + índices** que eles já definiram (Cascade/Restrict/SetNull).
5. **Imutabilidade:** qualquer tabela fiscal nova entra na lista append-only (REVOKE + trigger),
   como já feito no Ciclo 0.

## Models que faltam, por ciclo (≈19)

### Ciclo 1 — PDV completo + compliance breadth
| Model | Para quê | Campos-chave a trazer |
|---|---|---|
| `OrderStorno` | Correção fiscal (Storno) — append-only | `original_order_id` (unique), `reason`, `user_id` |
| `ProductCategory` | Hierarquia de catálogo | `parent_id` (auto-relação), `sort_order`, `color` |
| `ProductVariant` | Tamanhos/sabores/taças | `price_delta`(→cents), `sort_order` |
| `ProductModifier` | Configurador de Eisbecher | `price_delta`(→cents), `group_key`, `min`, `max` |
| `BetriebsstaetteUser` | Escopo usuário↔filial (RBAC) | PK composta |
| *(enriquecer)* `Order`/`OrderItem`/`TseTransaction` | salão/mesas + TSE-Ausfall | `OrderStatus`, `table_id`, `OrderItem.modifiers(Json)`, `TseTransaction.is_ausfall` |

> Ciclo 1 também tem trabalho que NÃO é model: X/Z-Bericht, DSFinV-K export, Kassenmeldung,
> ESC/POS (pacote `hardware`), modo de falha TSE-Ausfall.

### Ciclo 2 — Estoque + Receitas
| Model | Para quê | Campos-chave |
|---|---|---|
| `Ingredient` | Insumo (unidade-base) | `base_unit`, `avg_cost`(→cents/precisão) |
| `StockItem` | Saldo por filial | `qty_base`, `mindestbestand`, unique(ingredient, filial) |
| `StockMovement` | Livro-razão append-only | enum `StockMovementType`, `qty_base`(±), `ref_order_id` |
| `Recipe` | BOM por produto | `yield_qty`, `yield_unit`, `active` |
| `RecipeIngredient` | Itens da receita | `qty`, `unit`, `cost_at_creation` |

### Ciclo 3 — Checklist/HACCP
| Model | Para quê | Campos-chave |
|---|---|---|
| `ChecklistTemplate` | Modelo recorrente | enum `ChecklistRecurrence`, `trigger_event` |
| `ChecklistTask` | Tarefa | enum `ChecklistTaskType`, `valid_min`/`valid_max` (faixa HACCP) |
| `ChecklistRun` | Execução | `started_at`, `completed_at` |
| `ChecklistTaskResult` | Resultado | `value(Json)`, `ok`, `corrective_action` |

### Ciclo 4 — Marketing/CRM (DSGVO)
| Model | Para quê | Campos-chave |
|---|---|---|
| `Customer` | CRM + consentimento | `contact(Json)`, **`consent(Json)` versionado (DSGVO)** |
| `LoyaltyAccount` | Stempelkarte/pontos | `points`, `stamps` |
| `Voucher` | Cupom/vale | enum `VoucherType`, `value`(→cents), `max_uses`, `used_count` |
| `Promotion` | Regra de promoção | `rule(Json)`, janela ativa |
| `Campaign` | Disparo por canal | enums `CampaignChannel/Status`, `segment(Json)` |

### Ciclo 5 — Avançado
- `ProductType.SEMI_ACABADO` já previsto → BOM 2 níveis (produção de semi-acabado).
- Pacote **`hardware`** do paralelo (interfaces `PrinterDriver`/`ScaleDriver`) como ponto de partida.

## Diferença a reconciliar: sync
- Paralelo: um `OutboxEvent` único (entity/action/payload/status/retry) servindo local + central.
- Base: `SyncEvent` (idempotência central) + outbox local no SQLite/IndexedDB.
- Avaliar unificar sob o conceito do `OutboxEvent` (mais rico) ao entrar no Ciclo 1.

## Ordem recomendada de portar
Seguir a ordem dos ciclos (1→4), e **dentro de cada ciclo** a ordem de dependência:
- C2: `Ingredient` → `StockItem` → `StockMovement`; depois `Recipe` → `RecipeIngredient`.
- C1: `ProductCategory` → enriquecer `Product`; `ProductVariant`/`Modifier`; `OrderStorno`.
- Cada model novo = migração (+ append-only se fiscal) + seed + testes, sobre a espinha do Ciclo 0.

## O que NÃO trazer
- `Decimal` para dinheiro (usar cents). MwSt inline no produto (usar `tax_rates`).
- Ausência de testes do paralelo: cada model portado entra com TDD.
