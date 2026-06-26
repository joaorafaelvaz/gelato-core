# Ciclo 1 · Fatia 1c — DSFinV-K + Kassenmeldung

> Spec de design. Base: Ciclo 0 + fatias 1b e 1d (verificados, 105 testes). Convenções herdadas:
> dinheiro em **cents**, **imutabilidade fiscal no banco**, **TDD**, **127.0.0.1** (não
> `localhost`), **MwSt sempre da tabela** (`tax_rates`), identificadores em inglês / termos de
> domínio em alemão.

## Problema

A conformidade fiscal alemã exige dois artefatos voltados ao Finanzamt:

- **DSFinV-K** (Digitale Schnittstelle der Finanzverwaltung für Kassensysteme): export estruturado
  e padronizado dos dados de caixa, exigível numa **Kassennachschau**/**Betriebsprüfung**. É um
  **pacote** de arquivos CSV (taxonomia precisa de colunas) + `index.xml` (manifesto) descrevendo
  a estrutura. Os nomes/ordem de colunas e o formato **não se inventam** — vêm da spec oficial.
- **Kassenmeldung** (§146a AO): obrigação de comunicar ao Finanzamt a **Kasse** e a **TSE**
  (serial, certificado, início de uso) via **ELSTER**.

A base já tem todo o dado-fonte no ledger imutável (orders/order_items/payments/receipts/
tse_transactions/z_reports/sync_events/cash_movements/**tse_ausfall_log**), MwSt versionada
(`tax_rates`), Z-Bericht com numeração contínua por Kasse, e os períodos de Ausfall (1d). Falta
**transformar** isso nos artefatos acima.

## Objetivo

Gerar, **read-only a partir do ledger**, um **pacote DSFinV-K fiel** (subconjunto central
representando o que registramos) entregue como `.zip` via backoffice; e um **payload estruturado
de Kassenmeldung** (§146a) exibido no backoffice. **Sem submissão ELSTER** e **sem buscar
certificação** — a estrutura correta é construída; a validação contra a spec oficial e a
submissão ficam como pendências externas rastreadas.

## Decisões travadas (brainstorming 2026-06-26)

1. **Escopo:** DSFinV-K export fiel **+** Kassenmeldung como payload estruturado (sem ELSTER).
2. **Abrangência DSFinV-K:** subconjunto fiel central; módulos raros (Agenturen, Preisfindung,
   allocation_groups, subitems, multi-moeda real) = YAGNI.
3. **Entrega:** feature completa no backoffice (UI seletor + download) sobre endpoint read-only.
4. **Seleção:** por **Kasse + intervalo de datas**, ancorada nos **Z-Berichte** do período. Só
   Z fechados entram (DSFinV-K = Kassenabschlüsse); dia aberto não exporta.

## Arquitetura

```
packages/compliance/src/dsfinvk/   (PURO, sem banco)
  tables.ts        → registro: cada arquivo = nome + colunas ordenadas (tipo) + shape da linha
  csv.ts           → serializador CSV fiel (';' delim, '"' quote, UTF-8, decimal '.')
  index-xml.ts     → monta index.xml (manifesto) a partir do registro
  records.ts       → mapeadores: dados normalizados do ledger (cents) → linhas tipadas
  package.ts       → monta a lista { filename, content }[] (CSVs + index.xml)
  kassenmeldung.ts → monta o payload §146a (sem ELSTER)
        ▲
apps/api/src/exports/   (BANCO + HTTP)
  exports.service.ts    → consulta o ledger (Kasse+intervalo → Z-Berichte + orders/items/
                          payments/tse/tax_rates/stammdaten), mapeia, zipa (jszip)
  exports.controller.ts → GET /exports/dsfinvk?kasse_id=&from=&to= → .zip (RBAC export.dsfinvk)
                          GET /exports/kassenmeldung?kasse_id= → JSON (RBAC export.kassenmeldung)
  exports.module.ts
        ▲
apps/backoffice/src/   → seção "Exports": select Kasse + from/to → baixa .zip; mostra Kassenmeldung
```

A **montagem dos CSVs/index.xml é pura** (sem banco), testável isoladamente. O **serviço da API**
faz as queries (Prisma, read-only), normaliza para a forma de entrada dos builders, recebe a
lista de arquivos e **zipa com jszip** (dep nova da API). O `package.ts` puro **não** conhece zip
— só devolve `{ filename, content }[]`.

## Unidades (o que faz, como se usa, do que depende)

### `@gelato/compliance` — `dsfinvk/` (puro)

**`tables.ts`** — fonte única da taxonomia. Para cada arquivo DSFinV-K: `{ name, columns:
{ name, type: 'string'|'number'|'date' }[] }`. index.xml e CSV derivam daqui (nunca divergem).

**`csv.ts`** — `toCsv(columns, rows) → string`: delimitador `;`, quoting `"` com escape `""`,
UTF-8, decimais com `.` (cents → string com 2 casas via helper `centsToDecimal`). (Formato exato
= validação externa.)

**`index-xml.ts`** — `buildIndexXml(tables) → string`: manifesto que lista cada `Table` (URL do
arquivo, colunas, formatos), no esqueleto gdpdu. (DTD/atributos exatos = validação externa.)

**`records.ts`** — mapeadores puros, um por arquivo, recebendo dados já normalizados (objetos
planos em cents) e devolvendo as linhas tipadas conforme `tables.ts`:
- Stammdaten: `stamm_abschluss` (z_reports), `stamm_kassen` (kassen+tse_clients), `stamm_ust`
  (tax_rates), `stamm_tse` (tse_clients), `stamm_orte` (betriebsstaetten).
- Einzelaufzeichnung: `bonkopf` (orders), `bonkopf_ust` (VAT por order), `bonkopf_zahlarten`
  (payments), `bonpos` (order_items), `bonpos_ust` (VAT por item), **`tse`** (tse_transactions
  com **`is_ausfall` → marca de falha**, sem assinatura quando Ausfall).
- Kassenabschluss: `z_zahlart` (payments por Z), `z_ust` (VAT por Z), `cash_per_country`
  (caixa por moeda/Z) — de `z_reports.totals`.

**`package.ts`** — `buildDsfinvkPackage(input) → { filename, content }[]`: roda os mapeadores +
gera os CSVs + o index.xml. `input` é a forma normalizada do dataset (stammdaten + lista de
bons + tse + zs). Puro.

**`kassenmeldung.ts`** — `buildKassenmeldung(input) → KassenmeldungPayload`: monta a representação
§146a (Betriebsstätte: nome/endereço/Finanzamt; Kasse: serial/modelo/SW; TSE: serial/certificado/
início de uso; tipo de aquisição/início de uso). Estrutura clara e tipada; **sem** ELSTER.

### `apps/api` — `exports/`

**`exports.service.ts`**
- `dsfinvkZip(tenantId, kasseId, from, to) → Buffer`: valida que a Kasse é do tenant; busca os
  `z_reports` da Kasse com `businessDay ∈ [from,to]`; para cada Z, os orders cobertos
  (`ts ∈ [coveredFrom, coveredTo]`) + items + payments + tse_transactions; stammdaten (kasse,
  tse_client, betriebsstaette, tax_rates vigentes); normaliza; chama `buildDsfinvkPackage`; zipa
  (jszip) → Buffer. Read-only.
- `kassenmeldung(tenantId, kasseId) → KassenmeldungPayload`: stammdaten da Kasse/TSE/Betriebsstätte
  → `buildKassenmeldung`.

**`exports.controller.ts`**
- `GET /exports/dsfinvk?kasse_id=&from=&to=` (RBAC `export.dsfinvk`) → `application/zip` +
  `Content-Disposition: attachment; filename="dsfinvk_<kasse>_<from>_<to>.zip"`.
- `GET /exports/kassenmeldung?kasse_id=` (RBAC `export.kassenmeldung`) → JSON payload.

**RBAC:** novas permissões `export.dsfinvk` e `export.kassenmeldung`, concedidas ao papel `admin`
(seed). Operador não exporta.

### `apps/backoffice`
- `api.ts`: novo `apiGetBlob(path, token) → Blob` (download) — `apiGet` já cobre o JSON da
  Kassenmeldung.
- `App.tsx`: nova seção **Exports** — `select` de Kasse + inputs `from`/`to` + botão
  "DSFinV-K herunterladen" (baixa o `.zip` via blob + object URL) + visão da Kassenmeldung
  (busca o JSON e mostra os campos-chave).
- Precisa listar Kassen do tenant: endpoint auxiliar `GET /kassen` (read-only, RBAC mínimo) se
  ainda não existir; senão, reusa o que houver.

## Fluxo de dados (DSFinV-K)

1. Admin escolhe Kasse + intervalo no backoffice → `GET /exports/dsfinvk`.
2. Serviço: Z-Berichte da Kasse no intervalo → orders cobertos + items/payments/tse → stammdaten.
3. Normaliza (cents, datas ISO) → `buildDsfinvkPackage` → lista de arquivos → jszip → Buffer.
4. Resposta `.zip`; backoffice dispara o download.

## Erros / bordas

- **Intervalo sem Z fechado:** pacote válido, porém sem bons (só stammdaten/manifesto) + aviso.
- **Venda em Ausfall:** aparece em `tse.csv` com a marca de falha e **sem assinatura** (1d).
- **Multi-tenant:** serviço filtra por tenant do usuário; Kasse de outro tenant → 404/403.
- **Datas inválidas / from > to:** 400.
- **Read-only:** nenhum INSERT/UPDATE no ledger (a exportação não altera nada).

## Testes e verificação

- **Unit (puro, vitest):** `csv` (quoting, escape, decimais cents→`.`); `records` (cada
  mapeador, incl. `tse` com Ausfall); `index-xml` (bate com o registro de `tables`); `package`
  (conjunto de arquivos esperado); `kassenmeldung` (campos montados).
- **API (e2e):** seed Kasse com 1 Z + vendas (incl. 1 Ausfall) → `GET /exports/dsfinvk` →
  **descompacta** e afirma: arquivos presentes, `index.xml` lista as tabelas, `bonkopf` tem as
  linhas, `tse.csv` tem a marca de Ausfall, totais de `z_ust` corretos. RBAC: operador → 403.
  `GET /exports/kassenmeldung` → payload com serial da TSE.
- **Capstone:** export completo sobre dataset conhecido (Kasse única por run — ledger é
  append-only e acumula) + Kassenmeldung, ponta a ponta.

## Decomposição (6 chunks TDD)

1. **DSFinV-K puro I** — `tables` (registro) + `csv` (serializador) + `index-xml`.
2. **DSFinV-K puro II** — `records` (mapeadores dos 3 módulos) + `package` (assembler).
3. **API export** — `exports.service` (queries ledger + jszip) + controller + RBAC + e2e.
4. **Kassenmeldung** — `kassenmeldung` builder + endpoint + RBAC + teste.
5. **Backoffice** — seção Exports (download `.zip` + visão Kassenmeldung) + `apiGetBlob`.
6. **Capstone e2e + verificação.**

## Fora de escopo (YAGNI)

Módulos DSFinV-K raros (Agenturen, Preisfindung, allocation_groups, subitems, multi-moeda real);
submissão ELSTER da Kassenmeldung; validação do pacote contra o DTD/gdpdu oficial; assinatura do
export; agendamento automático; export de períodos com dia ainda aberto.

## Validações externas pendentes (rastrear, não resolver no código)

- **Versão exata da DSFinV-K** + nomes/ordem de colunas + formato decimal + `index.xml`/gdpdu
  DTD → **spec oficial vigente** (DSFinV-K do BMF/BZSt).
- **Conjunto exato de campos** e **submissão** da Kassenmeldung (ERiC + certificados + ambiente)
  → **ELSTER + Steuerberater**.
- Campos do **certificado TSE/BSI** em `stamm_tse` (Zertifikat I–IV) → fiskaly/BSI.
- Retenção e prazos (8 vs 10 anos; prazo da Kassenmeldung) → **Steuerberater**.
