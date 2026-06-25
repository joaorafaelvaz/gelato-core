# Design — Ciclo 1, fatia 1b: Turnos + X/Z-Bericht

> Fatia 1b do Ciclo 1 ("PDV completo + compliance breadth"), sobre a base verificada do
> Ciclo 0 (multi-tenant, auth+RBAC, ledger imutável, `/pos/sync` idempotente, MwSt por modo,
> TSE adapter, terminais Electron + web/PWA). Cada fatia tem seu próprio brainstorming → spec
> → plano → TDD.

## Contexto
O Ciclo 1 é grande (~5 subsistemas) e foi decomposto: **1a** salão/mesas, **1b** turnos +
X/Z-Bericht, **1c** DSFinV-K + Kassenmeldung, **1d** TSE-Ausfall (falha offline), **1e** hardware
(ESC/POS + ZVT). Começamos por **1b** — a espinha de compliance fiscal verificável que estende o
ledger já provado, sem hardware nem UI pesada.

### Decisões travadas (brainstorming 2026-06-24)
- **Z-Bericht = Tagesabschluss por Kasse/dia**, com **numeração contínua de Z por Kasse**
  (invariante fiscal). Turnos são aninhados no dia (troca de operador possível); cada turno tem
  seu float/Kassensturz, mas o Z agrega o dia. Degenera para "1 turno = 1 dia" em loja de operador único.
- **Gerenciamento de caixa completo:** float de abertura; sangria/suprimento como movimentos
  logados; contagem de fechamento com cálculo de **Differenz** (esperado vs contado); gaveta sem
  venda logada. (Sem contagem por cédula/Zählprotokoll por enquanto.)
- **Relatórios centrais e autoritativos:** o central (sobre o ledger imutável) computa os totais
  e atribui o Z-Nr contínuo **numa transação** (sem gaps/duplicatas). O terminal apenas dispara.
  X é snapshot read-only. **Z offline fica para a fatia 1d.**

## Escopo
**DENTRO:** ciclo de vida do turno (abrir com float → operar → sangria/suprimento → fechar com
contagem + Differenz); gaveta logada; **X-Bericht** (snapshot read-only, sem estado/número) e
**Z-Bericht** (Tagesabschluss por Kasse, Z-Nr contínuo, totais do dia, append-only); audit de toda
ação sensível; UI nos dois terminais (Electron + web).

**FORA (outras fatias):** Z offline (1d); mapeamento dos campos exatos do DSFinV-K (1c); impressão
ESC/POS do Z (1e — no 1b o Z é tela/PDF); salão/mesas (1a).

## Modelo de dados (porta do mapa + enriquece)
- **`Shift`** enriquecido: `openingFloat` (cents), `closingCount` (cents), `expectedCash`/`differenz`
  (calculados no fechamento), `status` (open|closed), `betriebsstaetteId`.
- **Novo `CashMovement`**: `shiftId`, `type` (`sangria` | `suprimento`), `amount` (cents), `reason`,
  `userId`, `ts` — **append-only**.
- **`z_reports`** (estrutura já no C0): `seqNr` **contínuo por Kasse** (atribuído em transação),
  `businessDay`, `totals` (jsonb), `generatedAt` — **append-only**.
  - **Regra de cobertura:** um Z agrega *todos os pedidos finalizados desde o Z anterior* daquela
    Kasse (lida com virada de meia-noite; todo pedido cai em exatamente um Z).
- Gaveta sem venda → `audit_log` (`action='pos.drawer.open'`).
- Tudo monetário em **cents**. Tabelas novas entram na imutabilidade (REVOKE + trigger), com testes.

## Motor de relatórios (puro, testável) — `packages/compliance`
- `computeDayTotals(orders, payments, stornos)` → decomposição **por alíquota MwSt**, **por meio de
  pagamento** (Bar/Unbar/cartão/voucher), nº de recibos, nº de Stornos, e **Grand Total** (soma
  bruta acumulada desde a criação da Kasse — expectativa GoBD). Reusado por X e Z.
- `computeShiftCash({ openingFloat, cashSales, suprimentos, sangrias, counted })` →
  `expected = openingFloat + cashSales + suprimentos − sangrias`; `differenz = counted − expected`.

## Fluxo + API
- `POST /pos/shifts/open` (kasse, operador, openingFloat) → turno aberto.
- `POST /pos/shifts/:id/cash-movement` (type, amount, reason) → sangria/suprimento (append-only + audit).
- `POST /pos/drawer/open` → log de abertura de gaveta (audit).
- `POST /pos/shifts/:id/close` (counted) → calcula Differenz, fecha turno.
- `POST /pos/reports/x` → snapshot read-only (NÃO persiste, sem número) dos totais do dia corrente da Kasse.
- `POST /pos/reports/z` → numera (Z-Nr contínuo, transação) + persiste o Z + computa totais do ledger;
  cobre todos os pedidos desde o Z anterior. append-only.
- RBAC: `pos.shift.open/close`, `pos.drawer.open`, `pos.report.x`, `pos.report.z` (já no catálogo).
- **UI nos dois terminais:** abrir/fechar turno, sangria/suprimento, botões X/Z, exibição do Z (tela/PDF).

## Testes / verificação
- **Puro:** `computeDayTotals` (alíquotas, meios de pagamento, grand total), `computeShiftCash` (Differenz).
- **Integração:** **continuidade do Z-Nr** (dois Z → seq 1,2; requests concorrentes não duplicam —
  transação/lock); X é read-only (não persiste); imutabilidade de `z_reports`/`cash_movements`; RBAC
  (operador sem `pos.report.z` → 403).
- **E2E:** abrir turno → vendas (via `/pos/sync`) → sangria → X (snapshot bate) → fechar turno
  (Differenz correto) → Z (numerado, totais batem com o ledger; cobre só os pedidos desde o Z anterior).

## Validações externas (rastrear, não resolver)
- Conteúdo/campos exatos do Z-Bericht e se o Tagesabschluss exige assinatura TSE → **Steuerberater**
  + spec **DSFinV-K** (fatia 1c mapeia os campos exatos).
- Regra de corte do dia fiscal (Geschäftstag); retenção.
