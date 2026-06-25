# Ciclo 1 · Fatia 1d — TSE-Ausfall (modo de falha documentado da cloud-TSE)

> Spec de design. Base: Ciclo 0 + fatia 1b (verificados). Convenções herdadas: dinheiro em
> **cents**, **imutabilidade fiscal imposta no banco** (role sem UPDATE/DELETE + triggers +
> testes), **TDD**, **127.0.0.1** (não `localhost`), **MwSt sempre da tabela**, **TSE nunca
> acoplada ao fornecedor** (interface `TseProvider`).

## Problema

Escolhemos **cloud-TSE (fiskaly)** como padrão. Uma TSE em nuvem **não assina sem internet**.
A **KassenSichV** exige que períodos de indisponibilidade da TSE ("Ausfall der TSE") sejam
**documentados** e que os recibos emitidos nesse intervalo sejam **marcados** — e **não existe
assinatura retroativa válida**.

Hoje (Ciclo 0): `finalizeSale()` chama `tse.sign()`; se lançar, o erro propaga e a venda é
**bloqueada** (nada é gravado). `ledger.ingest()` reforça isso, lançando
`'incomplete TSE transaction data'` quando faltam campos de assinatura. Num PDV real **a venda
nunca pode ser bloqueada** por causa da TSE. A 1d substitui o "bloqueia" por um **modo Ausfall
documentado**.

## Objetivo

Quando a assinatura falhar ou demorar ao finalizar, a venda **completa mesmo assim**, sem
assinatura, marcada `is_ausfall`; o recibo é emitido **sem QR** com aviso "TSE-Ausfall"; o
**período de Ausfall** (início/fim) é registrado num log fiscal append-only; o operador vê um
**banner persistente**. Ao reconectar, a próxima venda assina normalmente e o período fecha.
**Nunca há assinatura retroativa.**

## Decisões travadas (brainstorming 2026-06-25)

1. **Gatilho: automático + alerta.** Se `sign()` falhar **ou** exceder um **timeout curto
   (default 5000 ms)**, a venda completa sozinha em modo Ausfall e um banner persistente avisa
   o operador. Sem prompt bloqueante (alinha com "a venda nunca para").
2. **Período por log explícito de eventos.** O terminal detecta entrar/sair de Ausfall: a 1ª
   assinatura que falha **abre** o período; a 1ª que volta a funcionar **fecha**. Emite eventos
   `started`/`ended` (com motivo) → central grava em tabela fiscal append-only `tse_ausfall_log`.
   Período = parear `started`→`ended` por Kasse. Sobrevive a "apagão sem nenhuma venda", carrega
   motivo, é auditável e alimenta a DSFinV-K (1c) sem ambiguidade. A flag `is_ausfall` por
   transação **também** existe (é o que marca o recibo e o relatório por venda).

## Arquitetura

```
finalizeSale (terminal)
  │  computeMwst (já existe)
  ▼
signWithFallback(tse, req, {timeoutMs})        ── @gelato/compliance (puro)
  │   ├─ kind:'signed'  → caminho normal (QR, assinatura)
  │   └─ kind:'ausfall' → sem assinatura, is_ausfall=true, recibo sem QR
  ▼
AusfallTracker.record(outcome, at)             ── @gelato/compliance (puro)
  │   → [] | ['started'(at,reason)] | ['ended'(at)]   (1 par por apagão)
  ▼
emite: SaleEvent(is_ausfall?) + AusfallEvent(started|ended)  → outbox/sync
  ▼
POST /pos/sync  (rota por `type`)              ── apps/api
  ├─ 'sale'        → ledger.ingest (persiste is_ausfall; guard relaxado)
  └─ 'tse_ausfall' → ledger.ingestAusfall (append em tse_ausfall_log, idempotente) + audit
```

A resiliência **envolve qualquer `TseProvider`** — não toca `FiskalyProvider` (segue não
verificado) nem acopla a fornecedor. O `FakeTseProvider` continua o default que sempre assina;
o caminho Ausfall é exercitado por **dublês de teste** (`FailingTseProvider` que lança,
`HangingTseProvider` que nunca resolve → testa o timeout).

## Unidades (o que cada uma faz, como se usa, do que depende)

### `@gelato/compliance` — núcleo puro, sem rede

**`signWithFallback(tse, req, opts?) → Promise<SignOutcome>`** (`tse/sign-with-fallback.ts`)
- `SignOutcome = { kind: 'signed'; tse: TseTransactionResult } | { kind: 'ausfall'; reason: string }`.
- Faz `Promise.race([tse.sign(req), timeout(opts.timeoutMs ?? 5000)])`. Se `sign` rejeitar →
  `{ kind:'ausfall', reason: String(err) }`. Se o timeout vencer → `{ kind:'ausfall', reason:'timeout' }`.
- Depende só de `TseProvider`/tipos. Testável com dublês.

**`AusfallTracker`** (`tse/ausfall-tracker.ts`) — estado puro do período.
- Construtor opcional recebe estado persistido: `new AusfallTracker(current?)`, com
  `current: { startedAt: string; reason: string } | null`.
- `record(outcome: SignOutcome['kind'], at: string, reason?): AusfallEventKind[]`
  - `null → ausfall`: abre, retorna `['started']`, guarda `current`.
  - `aberto → signed`: fecha, retorna `['ended']`, zera `current`.
  - demais: retorna `[]` (não re-emite por venda).
- `get current()` para persistência local. Determinístico, sem relógio interno (recebe `at`).

**`buildReceipt`** (`receipt/build.ts`) — ganha ramo Ausfall.
- `BuildReceiptInput.tse: TseTransactionResult | null`. Quando `null` → `qrPayload = ''`,
  `isAusfall: true`. `ReceiptModel` ganha `isAusfall: boolean` e `tse: TseTransactionResult | null`.
- Belegausgabepflicht continua satisfeita: o recibo é emitido com itens/totais/MwSt; só não há
  QR nem dados de assinatura. (Forma/texto exatos do recibo Ausfall → validação externa.)

### `@gelato/domain` — schema dos eventos

- `TseTransactionSchema`: torna `tx_number` **opcional** e adiciona `is_ausfall: z.boolean().optional()`
  (default tratado no consumo). (Os campos de assinatura já são opcionais.)
- **`AusfallEventSchema`** novo: `{ client_event_id: uuid; type: z.literal('tse_ausfall');
  kasse_id: string; payload: { event_type: z.enum(['started','ended']); at: string; reason?: string } }`.
- **`PosEventSchema = z.discriminatedUnion('type', [SaleEventSchema, AusfallEventSchema])`** —
  o que `/pos/sync` passa a aceitar. `makeEnvelope` ganha irmão `makeAusfallEnvelope(kasseId, payload, idGen?)`.

### `@gelato/sync`

- `makeAusfallEnvelope(...)` em `envelope.ts` (espelha `makeEnvelope`, valida `AusfallEventSchema`).

### Dados (Prisma / Postgres `gelato_c0`) + imutabilidade

- `tse_transactions`: `is_ausfall Boolean @default(false)`; campos de assinatura
  (`txNumber`, `signatureCounter`, `signatureValue`, `logTime`, `publicKey`, `serialNumber`)
  passam a **nullable**. Invariante de app: `is_ausfall = true ⟺ assinatura nula`.
- **`tse_ausfall_log`** (modelo `TseAusfallLog`, `@@map("tse_ausfall_log")`) — **append-only**:
  `id` (cuid), `tenantId`, `kasseId`, `eventType` (`started`|`ended`), `at DateTime`,
  `reason String?`, `clientEventId String @unique` (idempotência), `createdAt DateTime @default(now())`.
  Entra na lista de tabelas fiscais: **GRANT só SELECT/INSERT** ao `gelato_app`, **REVOKE
  UPDATE/DELETE/TRUNCATE**, **trigger `fiscal_append_only()`**, e o **teste de imutabilidade**
  passa a cobri-la.
- `receipts.qrPayload`: aceitar string vazia (Ausfall). (Schema já é `string`.)

### API (`apps/api`)

- `SyncController.sync`: passa a parsear `PosEventSchema` e **rotear por `type`**:
  - `'sale'` → `ledger.ingest` (inalterado, exceto o guard abaixo + persistir `is_ausfall`).
  - `'tse_ausfall'` → `ledger.ingestAusfall(event, actor)`.
- `ledger.ingest`:
  - **relaxa o guard** das linhas 44-46: quando `tse_transaction.is_ausfall === true`, **não**
    exige `signatureValue/Counter/logTime`; cria `tseTransaction` com `isAusfall: true` e campos
    de assinatura nulos; `qrPayload` vazio. Caso contrário, exige como hoje.
- `ledger.ingestAusfall`: idempotente por `clientEventId` (checa `syncEvent`); numa transação,
  cria a linha em `tse_ausfall_log`, registra `syncEvent` (`type:'tse_ausfall'`) e `auditLog`
  (`action: 'tse.ausfall.' + event_type`). RBAC reusa `pos.sale.create` (terminal do operador).

### Terminais — `apps/pos-terminal` (Electron) e `apps/pos-web` (PWA)

- Ambos os `finalize` trocam `tse.sign` direto por `signWithFallback` + `AusfallTracker`:
  - resultado `signed` → fluxo atual; `ausfall` → monta `SaleEvent` com `tse_transaction.is_ausfall=true`
    (sem assinatura, `receipt.qr_payload=''`), grava append-only local + outbox.
  - os eventos `started`/`ended` do tracker viram `AusfallEvent`(s) no outbox/sync.
- **Persistência do período aberto** localmente (LocalRepo / IdbStore: um registro `ausfall_state`)
  para sobreviver a restart no meio do apagão; o tracker é reidratado no boot.
- **UI** (ambos): banner persistente enquanto aberto — "⚠ TSE indisponível — vendas em modo
  Ausfall (sem assinatura)"; o painel do recibo mostra "TSE-Ausfall — sem QR" no lugar do QR.
  Automático, sem ação do operador.

## Fluxo de dados (apagão → recuperação)

1. Operador finaliza; `signWithFallback` → `ausfall` (rede caiu).
2. `AusfallTracker.record('ausfall', t1)` → `['started']`. Venda grava local (`is_ausfall`),
   recibo sem QR; `SaleEvent(is_ausfall)` + `AusfallEvent(started, t1, reason)` no outbox.
3. Próximas vendas: `record('ausfall', tk)` → `[]` (só marca a venda `is_ausfall`; não re-emite).
4. Rede volta; finaliza; `signWithFallback` → `signed`; `record('signed', tN)` → `['ended']`.
   Venda assinada normal; `AusfallEvent(ended, tN)` no outbox.
5. Outbox sincroniza (idempotente): ledger recebe as vendas `is_ausfall` + o par `started/ended`
   em `tse_ausfall_log` + audit. **Sem reassinatura.**

## Erros / casos de borda

- **TSE lenta (não caída):** o timeout (5s) entra em Ausfall para não travar a fila; se a
  assinatura "atrasada" depois resolver, é ignorada (a venda já foi gravada Ausfall — não há
  reassinatura). (Risco aceito; documentado.)
- **Restart no meio do apagão:** o período aberto é relido do estado local → o tracker não
  re-emite `started`; ao recuperar, emite `ended` uma vez.
- **`ended` sem `started` / dois `started`:** prevenido pela máquina de estados (transições só
  emitem na borda). Idempotência por `clientEventId` no central.
- **Apagão sem nenhuma venda:** ainda assim há `started` quando a 1ª tentativa falha; se o
  terminal só *tenta* assinar ao finalizar, o período começa na 1ª venda que falha — aceitável
  (não há "transação" sem venda). Health-check ativo é YAGNI (fora).

## Testes e verificação

- **Unit (puro, vitest):** `signWithFallback` (sucesso; falha→ausfall; hang→timeout→ausfall);
  `AusfallTracker` (todas as transições + não re-emitir; reidratação); `buildReceipt` Ausfall
  (sem QR, `isAusfall`).
- **Domínio:** `AusfallEventSchema`/`PosEventSchema` (discrimina por `type`); `TseTransactionSchema`
  com `is_ausfall` e sem `tx_number`.
- **API (e2e):** `ingest` com `is_ausfall` (guard relaxado, persiste sem assinatura);
  `ingestAusfall` idempotente (mesmo `clientEventId` 2× = 1 linha) + audit.
- **Imutabilidade:** `tse_ausfall_log` rejeita UPDATE e DELETE (estende o teste existente).
- **Capstone e2e:** TSE cai → N vendas Ausfall (gravadas, marcadas, `started` uma vez) → TSE
  volta → próxima venda assinada + `ended` uma vez → ledger: vendas `is_ausfall` + par
  `started/ended` pareável por Kasse + audit; tudo idempotente ao reenviar o outbox.

## Decomposição (6 chunks TDD)

1. **compliance puro** — `signWithFallback`, `AusfallTracker`, ramo Ausfall do `buildReceipt`.
2. **domínio + sync** — `is_ausfall`/`tx_number?` no schema, `AusfallEventSchema`,
   `PosEventSchema`, `makeAusfallEnvelope`.
3. **modelo + imutabilidade** — migração (`is_ausfall`, assinatura nullable, `tse_ausfall_log`),
   grants/trigger, teste de imutabilidade.
4. **API** — `/pos/sync` roteado por `type`; `ingest` guard relaxado + persiste `is_ausfall`;
   `ingestAusfall`.
5. **terminais (lógica)** — `finalize` com `signWithFallback`+tracker nos dois; persistência do
   período; emissão no outbox.
6. **UI + capstone** — banner + recibo sem QR nos dois terminais; capstone e2e + verificação.

## Fora de escopo (YAGNI)

- Health-check ativo da TSE (período fecha na próxima venda OK — suficiente).
- Reassinatura / assinatura retroativa (proibida por lei).
- Relatório/visão de períodos de Ausfall no backoffice (vai com a 1c/DSFinV-K, que consome o log).
- Distinguir "rede caiu" de "fiskaly retornou erro" além do `reason` textual.

## Validações externas pendentes (rastrear, não resolver no código)

- **Forma/texto exatos do recibo em Ausfall** e se o QR deve ser **omitido** vs. um QR de
  "sem assinatura" → spec **DFKA/KassenSichV** + **Steuerberater**.
- **Prazo/forma de documentação** do período de Ausfall exigido pela KassenSichV → Steuerberater.
- Comportamento real da **fiskaly** sob indisponibilidade (códigos/timeout) → sandbox + doc viva.
