# Verfahrensdokumentation (GoBD) — gelato-core

> Documento exigível em auditoria (GoBD). Escrito em paralelo ao código. Esta é a versão
> inicial do Ciclo 0 e evolui a cada ciclo. **Não substitui aconselhamento de Steuerberater.**

## 1. Visão geral do sistema
gelato-core é um sistema de PDV (Kassensystem) multi-tenant. Cada rede (`Tenant`) tem filiais
(`Betriebsstätte`), cada filial tem caixas (`Kasse`), e cada caixa vincula um cliente TSE.
O terminal opera localmente e sincroniza com um servidor central (Postgres), que é a
**fonte de verdade fiscal durável**.

## 2. Processo de uma venda (Ciclo 0)
1. Operador autentica-se por PIN (turno).
2. Monta o pedido localmente; escolhe o modo de consumo (`im_haus`/`ausser_haus`) por pedido.
3. O motor de MwSt calcula a decomposição por alíquota a partir da tabela `tax_rates`
   vigente na data — **nunca de valores fixos em código**.
4. Ao finalizar, a transação é assinada pela **TSE** (Technische Sicherheitseinrichtung).
   No Ciclo 0 a assinatura é online (cloud-TSE); falha de assinatura **bloqueia** a
   finalização. O modo de falha documentado (TSE-Ausfall) entra no Ciclo 1.
5. É emitido um **recibo** (Belegausgabepflicht) com QR-Code de verificação (formato DFKA).
6. O evento é gravado **append-only** localmente e enfileirado (outbox) para o central.
7. O central recebe o evento de forma **idempotente** (`client_event_id`), persiste no
   **ledger imutável** e registra a trilha de auditoria (`audit_log`).

## 3. Imutabilidade (GoBD)
- As tabelas fiscais são **append-only**. O role de runtime do banco (`gelato_app`) não tem
  privilégio de `UPDATE`/`DELETE` nessas tabelas; além disso, um *trigger* barra `UPDATE`/`DELETE`
  mesmo para o owner (defense-in-depth). Há testes automatizados que provam esse comportamento.
- Qualquer correção de uma venda finalizada é feita por um **novo registro de Storno**
  referenciando o original (Ciclo 1), nunca por edição/remoção.

## 4. Trilha de auditoria
- Ações sensíveis (no Ciclo 0: criação de venda, login/escalonamento) geram entrada em
  `audit_log` com autor, ação, entidade, timestamp e dispositivo.

## 5. Retenção
- Parâmetro de retenção (padrão conservador: **10 anos**) — **a confirmar com Steuerberater**
  (houve redução recente para certos Buchungsbelege).

## 6. TSE e fornecedor
- A TSE é acessada por uma interface (`TseProvider`); a implementação padrão de produção
  prevista é **cloud-TSE (fiskaly)**, com adapter preparado para Hardware-TSE (Swissbit).
- Antes de produção: validar a integração no sandbox e confirmar a **certificação BSI vigente**.

## 7. Pendências de validação fiscal/jurídica
- Alíquotas MwSt para gelato (salão × takeaway), prazos da Kassenmeldung e o formato exato do
  QR DFKA devem ser confirmados com Steuerberater / contra a especificação oficial.
