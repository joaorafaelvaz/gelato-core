# Ciclo 1 · Fatia 1a-2 — Split de conta (por valor) + transferência (Tisch umbuchen)

> Spec de design. Base: 1a-1 pronta e verificada (branch `ciclo-1a`, 135 testes). Convenções
> herdadas: **cents**, **imutabilidade fiscal no banco**, **MwSt da `tax_rates`**, **TseProvider
> desacoplado**, **TDD**, **127.0.0.1** (meu Postgres está em **5433** por coexistência com o
> projeto paralelo), identificadores em inglês / termos de domínio em alemão.

## Problema

Na 1a-1, `POST /pos/sessions/:id/pay` fecha a conta **inteira** de uma vez (um Kassenbeleg
imutável, sessão → `paid`). No salão é comum **dividir a conta** (Rechnung splitten) — pagar em
várias parcelas até quitar — e **transferir** uma conta para outra mesa (Tisch umbuchen). A
1a-2 generaliza o pagamento e adiciona a transferência.

## Decisões travadas (brainstorming 2026-06-26)

1. **Split por VALOR.** Uma conta pode ser paga em vários **Kassenbelege parciais**; cada parcial
   rateia a MwSt **proporcionalmente** às alíquotas da conta; o **último pagamento reconcilia** o
   arredondamento (a soma dos Belege = total exato). A sessão só vira `paid` quando o remanescente
   = 0. (Split por itens = fora.)
2. **Transferência = conta inteira.** `update` do `tischId` da Tischsession (operacional). Item-level
   = fora.

## Núcleo puro (`@gelato/compliance`)

**`apportionSplit(fullTab, paidByRate, payGross) → { lines, totalNet, totalMwst, totalGross, settles }`**
- `fullTab: TabState` = `aggregateTab(Bestellungen)` (já existe). `paidByRate: { rate, net, mwst,
  gross }[]` = o já pago, por alíquota.
- remanescente por alíquota = grupo da conta − pago. `totalRemaining = Σ remanescente`.
- Se `payGross ≥ totalRemaining` → **settles = true**: `lines` = remanescente **exato** por
  alíquota (reconcilia o arredondamento acumulado).
- Senão (parcial): rateia `payGross` proporcional ao **bruto remanescente** de cada alíquota,
  usando **largest-remainder** para somar exatamente `payGross`; para cada alíquota
  `net = round(gross / (1 + rate))`, `mwst = gross − net`.
- `lines` = **linhas sintéticas por alíquota** (`productId: 'split:<code>'`, `qty: 1`, `unitNet`,
  `mwstRate`, `mwstCode`) — um Beleg de Teilzahlung mostra o detalhamento de MwSt, não produtos.
- Puro/testável. Invariante: Σ de todos os `apportionSplit` de uma conta = `fullTab` (exato).

## Dados (sem nova tabela fiscal)

Pagamentos parciais são `orders` (já append-only). Mudanças:
- **`Order.tischSessionId String?`** + relação. Uma sessão tem **vários** orders (Teilzahlungen).
- **`Tischsession.orders Order[]`**; `orderId` mantido como "order que quitou" (compat. 1a-1).
- `paidByRate` é **derivado** de Σ itens dos `orders` da sessão agrupados por alíquota — nada
  mutável, nada de UPDATE em registro fiscal.

## API

### `POST /pos/sessions/:id/pay` (generalizado, RBAC `pos.sale.create`)
Body: `{ client_event_id, amount?, payment, tse }` (`amount` = bruto a pagar agora).
- `amount` omitido **ou** = remanescente **e** sessão **sem orders anteriores** → Beleg
  **itemizado** com os produtos reais (comportamento 1a-1 preservado).
- `amount` parcial (ou final após parciais) → `apportionSplit` → **linhas sintéticas por alíquota**.
- Server valida `0 < amount ≤ remanescente`; terminal assina `Kassenbeleg-V1` sobre `amount`;
  grava `order` (append-only, `tischSessionId`) via `ledger.ingest` (idempotente por
  `client_event_id`, resiliência **TSE-Ausfall**); quando remanescente = 0 → sessão `paid` +
  `orderId`.
- Resposta: `{ orderId, settled, remainingGross, duplicate }`.

### `POST /pos/sessions/:id/transfer` (RBAC `pos.table.open`)
Body `{ target_tisch_id }`. Guarda: mesa-destino sem sessão aberta (senão 409); sessão `open`.
`update` `tischId` + `auditLog`.

### `GET /pos/sessions/:id` (RBAC `pos.table.view`)
Passa a devolver também `remaining` (= `fullTab` − pago, derivado) além de `tab`.

## Erros / bordas

- Overpay (`amount > remanescente`) → **400**. `amount ≤ 0` → 400.
- Transferir para mesa ocupada → **409**; transferir sessão não-aberta → 409.
- Pagar sessão já quitada → idempotente (mesmo `client_event_id` devolve o order) ou 409.
- Adicionar Bestellung entre parciais → remanescente recomputa (robusto).
- Ausfall em qualquer parcial → Beleg sem assinatura, `is_ausfall`, documentado (1d).
- Multi-tenant: sessão/mesas filtradas pelo tenant.

## Testes e verificação

- **Unit (puro):** `apportionSplit` — rateio proporcional, soma exata = `payGross`, reconciliação
  do pagamento final, divisão por N (ex.: 333 em 3 → 111+111+111), alíquotas mistas (19%+7%),
  invariante Σ = fullTab.
- **API (e2e):** pagar em 2–3 parciais até quitar (Σ Belege = total; cada Beleg com MwSt rateada;
  `paid` só no fim); transferir conta (tischId muda; 409 p/ mesa ocupada); overpay → 400;
  idempotência de parcial.
- **Capstone (e2e):** mesa → Bestellungen → split em 3 → quitada; Σ Kassenbelege = total,
  todos append-only, idempotente. Kasse/Tisch únicos por run.

## Decomposição (5 chunks TDD)

1. **puro** — `apportionSplit` + helper `paidByRate` (de orders agrupados por alíquota).
2. **modelo** — `Order.tischSessionId` + relação `Tischsession.orders`; migração (não-interativa:
   `migrate diff` + `db execute` + `migrate resolve --applied`).
3. **API pay generalizado** — parcial/rateio + remanescente no `GET` + e2e.
4. **transferência** — endpoint + guard + e2e.
5. **pos-web + capstone** — split (por N / valor) e "transferir" no `TischPanel`; capstone e2e + verificação.

## Fora de escopo (YAGNI / sub-fatias futuras)

Split **por itens** (atribuir itens a comensais); transferência **de itens** entre mesas; juntar
contas (merge de sessões); reabrir Beleg pago; gorjeta (Trinkgeld); split por assento (Sitzplatz).

## Validação externa pendente (rastrear)

Forma fiscal exata de uma **Teilzahlung/Teilrechnung** na DSFinV-K (linhas sintéticas por alíquota
vs itemização) e o rateio de MwSt em pagamento parcial → **DFKA/Steuerberater**. Inclusão dos
`orders` com `tischSessionId` e linhas `split:*` no `bonpos` da DSFinV-K já funciona (são orders),
mas a representação canônica de Teilrechnung deve ser validada.
