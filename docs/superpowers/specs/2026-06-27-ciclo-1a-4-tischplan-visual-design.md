# Ciclo 1 · Fatia 1a-4 — Tischplan visual (planta do salão)

> Spec de design. Base: C0 + 1b + 1c + 1d + 1a-1 + 1a-2 + 1a-3 + polish do TischPanel (em
> `main`, 149 testes). Convenções: **cents**, **imutabilidade fiscal** (Tisch/posição são
> OPERACIONAIS/mutáveis — UPDATE permitido, sem registro fiscal aqui), **MwSt da `tax_rates`**,
> **TDD**, **127.0.0.1** (Postgres em **5433** por coexistência), inglês / termos de domínio em
> alemão. **Rodar ao vivo** (coexistência): API :3001 / pos-web :5173 / pg :5433 (o projeto
> paralelo ocupa 3000/4000/5432).

## Problema

Hoje o salão no pos-web é uma **lista de botões** de mesa. A 1a-4 transforma isso numa **planta
visual** (Tischplan): mesas posicionadas por `posX/posY` (o modelo `Tisch` já os tem), coloridas
por estado (livre vs ocupada), **clicar** abre/continua a conta e **arrastar** reposiciona e salva.

## Decisões travadas (brainstorming 2026-06-27)

1. **Planta EDITÁVEL no pos-web**: render por `posX/posY`; clicar abre; arrastar reposiciona e
   salva (Tisch é mutável). **Espelho Electron DEFERIDO** (sessão dedicada — YAGNI agora).

## Dados / API

- **`GET /pos/tables`** (RBAC `pos.table.view`) estendido: além de `{id, name, openSessionId}`,
  passa a devolver `posX, posY` e `openTotalGross` (total da conta aberta, p/ exibir na mesa —
  derivado da sessão aberta via `aggregateTab − paidByRate`, ou simplesmente o `tab.totalGross`).
- **`PATCH /pos/tables/:id/position` `{ pos_x, pos_y }`** (RBAC `pos.table.open`) → `update` em
  `Tisch.posX/posY` (operacional/mutável). Valida a mesa do tenant.
- **Seed:** dar `posX/posY` iniciais às mesas demo (Tisch 1, Tisch 2 + 1–2 extras) p/ a planta
  não nascer vazia.

## Lógica pura (`@gelato/compliance` ou local, testável)

- `tableState(table) → 'free' | 'occupied'` (tem `openSessionId`?).
- `clampPosition(x, y, bounds) → {x, y}` (não arrastar a mesa p/ fora do canvas).
Pequenas, puras, com testes unitários.

## Componente (pos-web) — `Tischplan`

Substitui a lista de botões. Um container `position: relative` (100% × altura fixa, ex. 360px)
com cada mesa em `position: absolute` em `(posX, posY)`. Cada mesa:
- retângulo arredondado com o **nome**;
- **cor por estado**: livre = claro/verde; ocupada = âmbar;
- se ocupada, mostra o **total** (`openTotalGross`).

**Interação (pointer events, sem libs):**
- `pointerdown` no nó da mesa → registra início (x0,y0), captura o pointer.
- `pointermove` → se o deslocamento passou de um limiar (ex. 5px), entra em **modo arrastar** e
  atualiza a posição **local** (otimista, com `clampPosition`).
- `pointerup` → se **arrastou**, `PATCH /pos/tables/:id/position` com a nova posição; se foi
  **clique** (sem arrastar), `open()` a conta (fluxo existente).

Abaixo da planta, quando há conta aberta, fica a **UI já pronta** (composição de variante/modifier,
split, transferir, pagar) — reaproveitada do `TischPanel` atual. **Divs posicionadas** (não SVG) —
mais simples p/ arrastar em HTML.

> Refator: o `TischPanel` atual vira a planta (topo) + o painel da conta (embaixo). A lógica de
> conta/Bestellung/pay/transfer não muda; só o **seletor de mesa** passa de lista → planta.

## Erros / bordas

- Arrastar p/ fora do canvas → `clampPosition` mantém dentro.
- Distinguir clique de arraste pelo limiar de deslocamento (evita abrir a conta ao reposicionar).
- `PATCH` de mesa de outro tenant → 404/403.
- Falha do `PATCH` (rede) → reverter a posição local (ou recarregar a lista).
- Multi-tenant: planta só mostra mesas do tenant/Betriebsstätte da Kasse.

## Testes e verificação

- **Unit (puro):** `tableState`, `clampPosition`.
- **API (e2e):** `PATCH .../position` persiste `posX/posY`; `GET /pos/tables` devolve
  `posX/posY` + `openTotalGross`; mesa de outro tenant → erro.
- **Verificação ao vivo (Claude_Preview):** renderiza a planta (mesas posicionadas, cores por
  estado); **arrastar** uma mesa → recarregar mostra a nova posição (persistiu); **clicar** →
  abre a conta + o painel embaixo.

## Decomposição (3 chunks TDD)

1. **API + pura** — helpers `tableState`/`clampPosition`; `GET /pos/tables` com `posX/posY` +
   `openTotalGross`; `PATCH /pos/tables/:id/position` + RBAC; seed de posições; e2e.
2. **pos-web** — componente `Tischplan` (mesas posicionadas, cor por estado, arrastar+salvar,
   clicar p/ abrir) substituindo a lista; reaproveita o painel da conta.
3. **Verificação ao vivo + final** — rodar (API:3001/pos-web:5173) e dirigir via Claude_Preview
   (arrastar/persistir/abrir); `corepack pnpm -r test` verde.

## Fora de escopo (YAGNI)

Espelho **Electron** (sessão dedicada); snap-to-grid; formas/tamanhos/rotação de mesa; múltiplas
salas/andares; redimensionar mesas; editor de layout no backoffice; cores por tempo de ocupação.

## Validação externa

Nenhuma fiscal — a planta é puramente operacional/visual.
