# Fatia backoffice-ux — Backoffice de verdade (shell, tema, dashboard, estados, i18n, paginação)

> Spec de design. Base: `main` 85a02c7 (Ciclos 0–5a integrados). O backoffice atual é um **harness
> de verificação** construído "mínimo, build+typecheck" ao longo dos ciclos: `App.tsx` único (749
> linhas, 12 componentes), zero CSS, sem navegação. Esta fatia o transforma em produto usável.
> Convenções: **cents**, TS strict, identificadores em inglês/domínio em alemão, TDD onde há
> lógica, **127.0.0.1** (pg 5433; API :3001; backoffice :5174 no preview).

## Problema

Verificado ao vivo (2026-07-02, preview → API 3001 → pg 5433):

- **Zero styling** — nenhuma folha de estilo (`hasStylesheet: 0`), widgets default do SO, sem
  `background` (ilegível em canvas escuro).
- **Sem navegação** — 12 módulos empilhados numa página só; com dados acumulados chegou a
  **72.000px** de altura e o browser não renderizava.
- **i18n meio-ligado** — `react-i18next` funciona (header usa `t()`), mas os títulos/labels dos
  módulos são hardcoded misturando PT/DE/EN; trocar o idioma quase não muda a tela.
- **Erros engolidos** — todo fetch faz `catch(() => set([]))`; um 500 da API aparece como "sem
  dados" (visto ao vivo: `42501 permission denied` → todas as tabelas vazias, sem mensagem).
- **Sem estados** — sem loading, sem empty-state, sem confirmação de mutação.

Usuária-alvo: **dona/gerente de gelateria** (não-dev), desktop/tablet.

## Decisões travadas (brainstorming 2026-07-02)

1. **Home = dashboard "Hoje"** — visão do dia: vendas de hoje, alertas de estoque, HACCP atrasado.
2. **Navegação por abas de grupo no topo** + subabas por grupo (escolhida em mockup contra sidebar).
3. **Tema "ferramenta sóbria"** (escolhido em mockup contra "gelateria fresca"): header escuro
   `#1E2732`, acento azul `#378ADD`/`#185FA5`, fundo `#F4F5F7`, cards brancos, radius discreto
   (8px). Semânticos: âmbar = alerta de estoque, vermelho = HACCP atrasado/erro, verde = ok.
4. **CSS próprio leve** — `theme.css` com design tokens (CSS custom properties) + 9 componentes
   React próprios. **Zero dependências novas** (sem Tailwind/shadcn; elementos de formulário
   nativos, acessíveis por padrão). Se o app crescer, migração fica para depois.
5. **Paginação híbrida** — server-side **só** em `GET /orders` (única lista que cresce sem limite);
   demais listas paginam no cliente (25/página).
6. **Roteamento por hash** sem dependência (`#/operacao/estoque`): função **pura** `parseRoute` +
   hook `useRoute` (deep-link e botão voltar funcionam; testável por unit).
7. **i18n completo** — todas as strings do backoffice viram chaves `backoffice.*` em
   `@gelato/i18n` (DE default; teste de paridade já força DE/EN/PT).

## Navegação (5 grupos, 13 páginas)

| Grupo (aba) | Subabas (páginas) |
|---|---|
| **Hoje** | Dashboard (página nova) |
| **Operação** | Estoque · Produção · Checklists |
| **Cadastros** | Produtos · Receitas |
| **Clientes** | CRM · Fidelidade · Vouchers · Campanhas |
| **Fiscal** | Vendas · Relatórios HACCP · Exports |

Rota = `#/<group>/<page>`, slugs em inglês (convenção do projeto): `#/today/dashboard`,
`#/operations/stock`, `#/operations/production`, `#/operations/checklists`, `#/catalog/products`,
`#/catalog/recipes`, `#/customers/crm`, `#/customers/loyalty`, `#/customers/vouchers`,
`#/customers/campaigns`, `#/fiscal/sales`, `#/fiscal/haccp`, `#/fiscal/exports`.
`parseRoute` normaliza grupo sem página para a primeira página do grupo (`#/today` →
`{ group: 'today', page: 'dashboard' }`) e devolve `null` para hash inválido/vazio; o default
(`today/dashboard`) é aplicado por `useRoute`. Rótulos exibidos vêm do i18n.

## Arquitetura frontend (`apps/backoffice/src/`)

```
theme.css          tokens (cores tema sóbrio, radius, espaçamento, tipografia system-ui)
                   + base styles (body, table, input, select, button)
ui/                Card, MetricCard, Badge, Button, EmptyState, ErrorState, Spinner,
                   Toast (provider + useToast), Pagination
shell/AppShell.tsx header escuro (logo, abas de grupo, idioma, sair) + barra de subabas
router.ts          parseRoute(hash) → { group, page } | null; buildHash(route) (puros)
                   + useRoute() (hashchange listener)
useFetch.ts        useFetch<T>(fn, deps) → { data, loading, error, reload }
pages/             1 arquivo por página: Dashboard.tsx (novo) + os 12 módulos atuais
                   movidos de App.tsx (código movido como está; muda a moldura)
App.tsx            só: login → <AppShell><PáginaAtiva/></AppShell>
```

A lógica de negócio das páginas existentes **não muda** nesta fatia — muda shell, estilo, estados
e i18n. `api.ts` ganha apenas os params novos de orders + `GET /orders/summary` + o tratamento
de 401 (logout).

## Dashboard "Hoje" (única funcionalidade nova)

- **3 metric cards clicáveis** (navegam para a página correspondente):
  - **Vendas hoje** — `GET /orders/summary?from=<início do dia local>` (agregado no servidor —
    ver seção API; nunca subconta, independe de limite de página) (azul).
  - **Alertas de estoque** — contagem de `GET /stock/alerts` (âmbar quando > 0, cinza quando 0).
  - **HACCP atrasado** — contagem de itens `ATRASADO` em `GET /checklists/status` (vermelho
    quando > 0, verde quando 0).
- **Últimas vendas** — tabela com as 10 mais recentes (`GET /orders?limit=10`).
- Helper **puro** `todayRange(now: Date) → { from: Date }` (início do dia local) — unit-testado.

## API — duas mudanças, ambas leitura pura do ledger

**1) `GET /orders`** (RBAC `pos.report.x`, hoje com `take: 100` fixo, `orderBy ts desc`) ganha
query params **opcionais**:

| Param | Tipo | Efeito | Default |
|---|---|---|---|
| `limit` | int 1–500 | `take` | 100 (comportamento atual) |
| `offset` | int ≥ 0 | `skip` | 0 |
| `from` | ISO date-time | `ts >= from` | — |
| `to` | ISO date-time | `ts < to` | — |

- Resposta continua **array** (compatível com consumidores atuais); página Vendas usa
  **"carregar mais"** (`offset += limit`) — sem necessidade de total/envelope.
- Param inválido (`limit` fora de 1–500, `offset < 0`, data não-ISO) → **400**.

**2) `GET /orders/summary?from=&to=`** (mesmo RBAC, mesmo controller) — agregado no servidor
(`aggregate` no Prisma): devolve `{ count, totalGross }` das orders do tenant no intervalo
(resposta camelCase, como as demais respostas da API).
Existe para o card "Vendas hoje" do dashboard **nunca subcontar** (a soma no cliente estaria
presa ao limite de página de `GET /orders`). Params com a mesma validação de datas (400 se
inválido); sem params = agregado de tudo.

**Nenhuma tabela fiscal é tocada (só leitura). Demais endpoints intactos.**

## Estados e feedback (contrato de página)

Toda página lê via `useFetch` e rende por estado:

- **loading** → `Spinner`;
- **error** → `ErrorState` (mensagem i18n + botão "tentar de novo" → `reload`) — **fim do**
  `catch(() => set([]))`;
- **vazio** → `EmptyState` (convite, ex. "Nenhum cliente ainda — cadastre o primeiro");
- **mutação ok** → `Toast` de sucesso + `reload` da lista; **mutação falhou** → `Toast` de erro.

**401 em qualquer fetch** (token expirado) → limpa o token e volta ao login (tratado no seam de
`api.ts`/`useFetch`, não por página). Páginas com **múltiplos fetches** (Estoque, Receitas,
Fidelidade, Dashboard): cada bloco rende seu próprio estado via seu `useFetch` (loading/erro por
seção; sem spinner de página inteira).

Listas client-side: componente `Pagination` (25/página).

## i18n

Todos os títulos de seção/labels/botões hardcoded (mix PT/DE/EN atual) migram para chaves
`backoffice.*` nos três locales de `@gelato/i18n` (o teste de paridade de chaves já cobre).
`DEFAULT_LOCALE` (DE) permanece o default. Termos de domínio ficam em alemão nos três locales
onde fizer sentido (Kasse, MwSt, im Haus/außer Haus), como no restante do projeto.

## Testes e verificação

- **Unit (puro, vitest):** `parseRoute`/`buildHash` (rotas válidas, inválidas, default);
  `todayRange` (meia-noite local, DST não é preocupação — dia local simples); formatador `euro`
  movido para `format.ts` com teste.
- **e2e API:** `GET /orders` com `limit`/`offset` (janelas disjuntas, ordem desc), `from`/`to`
  (filtro por ts), 400 para params inválidos, sem params = comportamento atual;
  `GET /orders/summary` (count/totalGross batem com as vendas do intervalo; isolado por tenant;
  400 data inválida).
- **i18n:** paridade DE/EN/PT das chaves novas (teste existente cobre).
- **Build/typecheck** do backoffice em todo chunk.
- **Live (fim da fatia):** via Claude_Preview — login, navegação pelas 13 páginas, dashboard com
  dados do seed, estado de erro (API desligada → ErrorState com retry), troca de idioma, paginação
  de Vendas ("carregar mais"). Portas do ambiente de verificação: defaults do repo são API :3000 e
  Vite :5173; a sessão de dev local usa overrides não-commitados (`apps/backoffice/.env.local`
  `VITE_API_URL=http://127.0.0.1:3001` e `.claude/launch.json` porta 5174) para coexistir com
  outro projeto — o plano deve usar esses overrides.

## Decomposição (4 chunks TDD)

1. **Fundação** — `theme.css` + `ui/` + `shell/AppShell` (abas) + `router.ts` (TDD) + `useFetch`;
   `App.tsx` quebrado em `pages/` (mover código como está). Build + typecheck.
2. **API + Vendas** — params de `GET /orders` + `GET /orders/summary` + e2e; página Vendas com
   "carregar mais".
3. **Dashboard "Hoje"** — `todayRange` (TDD) + metric cards + últimas vendas.
4. **Acabamento** — estados (`useFetch`/Empty/Error/Toast) em todas as páginas, `Pagination`
   client-side, i18n completo (chaves `backoffice.*` DE/EN/PT), verificação ao vivo; integrar
   `backoffice-ux → main` + push.

## Fora de escopo (YAGNI)

Dark mode; celular (app mobile gerencial é a fatia **5d**); BI/relatórios gerenciais (**5c**);
mudanças no pos-web/terminal; RBAC granular na UI (esconder abas por papel); virtualização de
tabelas; total/envelope de paginação; testes de componente React (testing-library) — lógica pura
tem unit, o resto é verificado ao vivo, como nas fatias anteriores.

## Validação externa

Nenhuma fiscal — a fatia é apresentação + leituras parametrizadas do ledger. (As pendências
fiscais existentes — Steuerberater, QR DFKA, fiskaly/BSI — não são tocadas.)
