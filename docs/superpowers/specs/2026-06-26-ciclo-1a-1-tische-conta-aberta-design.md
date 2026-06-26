# Ciclo 1 · Fatia 1a-1 — Tische + conta aberta + lifecycle TSE

> Spec de design. Base: Ciclo 0 + fatias 1b, 1d, 1c (integradas em `main`, 123 testes).
> Convenções herdadas: dinheiro em **cents**, **imutabilidade fiscal no banco**, **MwSt sempre
> da tabela `tax_rates`**, **TseProvider desacoplado do fornecedor**, **TDD**, **127.0.0.1**
> (não `localhost`), identificadores em inglês / termos de domínio em alemão.

## Contexto e decomposição

A fatia **1a (salão/mesas)** é a maior do Ciclo 1 e cobre quatro subsistemas. Foi **decomposta**:
`1a-1` Tische + conta aberta (espinha) · `1a-2` split + transferência · `1a-3` Varianten +
Modifikatoren · `1a-4` Tischplan visual (+ Electron). Cada uma terá spec → plano → TDD próprios.
**Este spec é só a 1a-1**, da qual as demais dependem.

## Problema

Hoje o pedido é uma **venda instantânea**: o terminal monta o carrinho, `finalizeSale` assina uma
única transação TSE (`Kassenbeleg-V1`) e grava um `order` imutável. No salão (Gastronomie) o
pedido tem **ciclo de vida**: abre-se uma conta numa mesa, itens são lançados ao longo do tempo,
e só no fim a conta é fechada/paga. Múltiplos garçons/terminais tocam a mesma mesa.

## Decisões travadas (brainstorming 2026-06-26)

1. **Lifecycle TSE = Bestellung + Kassenbeleg.** Cada "envio de itens" assina uma transação TSE
   `process_type='Bestellung-V1'` (registro append-only); o pagamento assina o `Kassenbeleg-V1`
   final. A conta aberta vira **derivada** das Bestellungen (Σ − Stornos) — respeita append-only
   naturalmente. (Modelo fiel da DFKA para gastronomia.)
2. **Conta central-autoritativa, TSE assinada no terminal.** A mesa/sessão vive no servidor
   (qualquer terminal vê/edita); abrir e lançar passam pela API; o terminal assina a TSE
   localmente (topologia atual) e a API registra. O **pagamento** mantém o caminho resiliente da
   1d (nunca bloqueia; TSE-Ausfall). Espelha shifts/reports (já central-online).
3. **Fronteira operacional × fiscal:** a **sessão da mesa** é metadado **operacional mutável**
   (status open→paid); a imutabilidade fiscal mora nas **Bestellungen** + no **Kassenbeleg**.

## Modelo de dados

### Operacional (mutável — NÃO entra na lista append-only)
- **`Tisch`** (mesa, master data): `id, betriebsstaetteId, name, seats?, posX?, posY?` (posição p/
  Tischplan futuro), `active`. Pertence à Betriebsstätte (o salão).
- **`Tischsession`** (conta aberta): `id, tischId, kasseId, status ('open'|'paid'|'cancelled'),
  openedBy, openedAt, closedAt?, orderId?` (o Kassenbeleg final). **Restrição: ≤1 sessão `open`
  por `tischId`** (índice único parcial `where status='open'`).

### Fiscal (append-only — GRANT SELECT/INSERT, REVOKE UPDATE/DELETE, trigger, teste)
- **`Bestellung`**: `id, sessionId, kasseId, seqNr (por sessão), createdBy, totalNet, totalMwst,
  totalGross, createdAt`. Uma transação TSE `Bestellung-V1` por Bestellung.
- **`BestellungItem`**: `id, bestellungId, productId, qty, unitNet, mwstRate, mwstCode`. **Storno
  de item = Bestellung de Storno** (qty negativa, `stornoOf` referenciando a original) —
  append-only limpo, sem UPDATE.
- **`tse_transactions` polimórfica:** `orderId` passa a opcional + novo `bestellungId` opcional
  (exatamente um preenchido). Mantém todas as assinaturas TSE num só lugar (bom p/ DSFinV-K).

## Lógica pura (`@gelato/compliance`)

- `TseProcessType` ganha `'Bestellung-V1'` (a interface `TseProvider`/`TseSignRequest` já carrega
  `processType`; **sem mudança estrutural** — respeita o desacoplamento). `FakeTseProvider` assina
  ambos.
- **`aggregateTab(bestellungen) → TabState`** (puro): soma os itens de todas as Bestellungen
  (Stornos com qty negativa cancelam), agrupando por produto/alíquota; devolve linhas correntes +
  totais (net/mwst/gross por alíquota e total). Reusa o motor MwSt. Testável sem banco.

## API (`apps/api/src/tables`)

- `POST /pos/tables/:tischId/open` (RBAC `pos.table.open`) → cria `Tischsession` (guarda
  1-open-por-mesa). Body: `{ kasse_id }`.
- `POST /pos/sessions/:id/bestellung` (RBAC `pos.sale.create`) → append `Bestellung` + itens +
  `tse_transaction` (Bestellung-V1) sob a sessão; idempotente por `client_event_id`. Body inclui
  os itens e a assinatura TSE (assinada no terminal).
- `GET /pos/sessions/:id` (RBAC `pos.table.view`) → `TabState` derivado (via `aggregateTab`).
- `GET /pos/tables?kasse_id=` (RBAC `pos.table.view`) → mesas + se há sessão aberta.
- `POST /pos/sessions/:id/pay` (RBAC `pos.sale.create`) → finaliza: grava o `order` imutável
  (Kassenbeleg, reusando o ledger + resiliência TSE-Ausfall), liga `session.orderId`, marca
  sessão `paid`. `order_items` = conteúdo agregado.

> RBAC: reusar `pos.sale.create` para lançar/pagar; **novas permissões** `pos.table.open` e
> `pos.table.view` no catálogo (`rbac/permissions.ts`) + papel `operator` (garçom). Seed.

## Fluxo de dados (mesa → pagamento)

1. Abrir mesa → `Tischsession(open)`.
2. Lançar itens → terminal assina `Bestellung-V1` → API append (Bestellung+items+tse).
3. Conta = `aggregateTab` das Bestellungen da sessão.
4. Pagar → terminal assina `Kassenbeleg-V1` do total → `order` imutável (ligado à sessão) →
   sessão `paid`. Sem reassinatura das Bestellungen.

## Erros / bordas

- Abrir mesa já com sessão aberta → 409 (retorna a sessão existente). Pagar sessão já paga → 409.
- TSE indisponível ao lançar/pagar → **Ausfall** (1d): Bestellung/Kassenbeleg gravado sem
  assinatura, marcado, período documentado. Nunca bloqueia.
- Conta vazia no pagamento → 400 (nada a faturar).
- Multi-tenant: sessão/mesa filtradas pelo tenant do usuário.

## Testes e verificação

- **Unit (puro):** `aggregateTab` (soma, Stornos negativos, agrupamento por alíquota, totais);
  schema do evento de Bestellung; `FakeTse` com `Bestellung-V1`.
- **API (e2e):** abrir mesa (1-open-por-mesa, 409 no 2º); lançar 2 Bestellungen (append + TSE
  Bestellung-V1); `GET session` devolve conta derivada correta; pagar → Kassenbeleg liga a sessão
  + status `paid`; imutabilidade: UPDATE/DELETE em `bestellungen`/`bestellung_items` rejeitados.
- **Capstone (e2e):** mesa → 2 Bestellungen (uma com Storno de item) → pagar → ledger coerente
  (Bestellungen assinadas append-only + Kassenbeleg referenciando a sessão; total = Σ − Storno),
  idempotente. Kasse única por run (ledger append-only acumula).

## Decomposição (6 chunks TDD)

1. **domínio/compliance** — `Bestellung-V1` no `TseProcessType`/FakeTse; `aggregateTab` puro;
   schema do evento de Bestellung.
2. **modelo + imutabilidade** — `Tisch`, `Tischsession` (operacional), `Bestellung`+`BestellungItem`
   (append-only), `tse_transactions` polimórfica; migração + grants/trigger + teste.
3. **API mesas** — abrir/lançar/ver/listar + RBAC + seed das permissões.
4. **pagamento/Abschluss** — finaliza sessão → Kassenbeleg (reusa ledger + Ausfall) + liga sessão;
   e2e.
5. **terminal pos-web** — fluxo mínimo (lista mesas → conta → lançar → pagar).
6. **capstone e2e + verificação.**

## Fora de escopo (sub-fatias seguintes / YAGNI)

Split de conta + transferência (1a-2); Varianten/Modifikatoren (1a-3); **Tischplan visual** +
espelho **Electron** (1a-4); reabrir sessão paga; merge de contas concorrentes; **wiring das
Bestellung-TSE no export DSFinV-K** (extensão da 1c — armazenar agora, ligar ao `tse.csv` depois);
gestão de mesas no backoffice (CRUD de Tisch — seed mínimo agora).

## Validações externas pendentes (rastrear, não resolver no código)

- Semântica exata de `process_type` **Bestellung-V1** e se uma **gelateria** precisa assinar
  Bestellungen (vs só o Kassenbeleg) → **DFKA Gastronomie / Steuerberater**.
- Inclusão das transações de Bestellung no `tse.csv` da **DSFinV-K** → extensão da 1c.
- MwSt de consumo no salão (`im_haus`) para gelato → **Steuerberater** (já parametrizado em
  `tax_rates`, nunca hardcoded).
