# Briefing para o `design` — a tela `Parcerias` (`/admin/clients`)

**Pedido do operador, 2026-08-17:** *"peça ao time de designer para olhar toda a estrutura dessa
página, ela precisa estar no padrão que temos no projeto."*

Este documento existe porque sobrevive ao card: ele registra **duas divergências de sistema já
medidas** e **três decisões pendentes de dono**, e nenhuma das cinco morre quando a implementação
fecha. O que é levantamento de execução está no card, não aqui.

---

## 1. O que a tela é hoje

Uma lista só, em `/admin/clients`, chamada **Parcerias** no menu e no `<h1>`. Ela absorveu duas
telas que liam tabelas diferentes:

| Tela retirada | Lia | Onde está agora |
| :-- | :-- | :-- |
| `ClientsListAdmin` (`/admin/clients`) | `core.clients` | `ClientDirectory` |
| `PartnershipsQueue` (`/admin/partnerships`) | `core.partner_form_submissions` | filtro `?state=in_progress` da mesma lista |

Arquivos: `components/admin/clients/ClientDirectory.tsx` (tela),
`lib/clients/directory-filter.ts` (decisão pura), `lib/services/partnership-service.ts`
(`loadClientDirectory`), `app/api/admin/clients/directory/route.ts`.

A ficha do cliente é `ClientEditorModal`, drawer de 85vw com 8 abas — `Parceria` (as cinco
faixas), `Perfil`, `Fiscal & Pagamentos`, `Contrato`, `Equipe`, `Usuários do App`, `Locais`,
`Cupons`.

---

## 2. O que mudou em 2026-08-17, depois deste briefing ser escrito

O operador pediu que a tela seguisse o padrão das outras e apontou a `/pois` como exemplo. A
estrutura foi adotada: moldura `min-h-screen bg-gray-50 dark:bg-gray-950 p-6 lg:p-8`, trilho de
`w-[18%]` em cartão de vidro `rounded-3xl backdrop-blur-xl` fixo em `top-24`, barra de números
fixa no topo da coluna de `82%`, tabela dentro de cartão de vidro, e **tema escuro em toda a
tela**.

O que NÃO foi copiado, e por quê — as duas medições abaixo são novas:

**A tinta.** `/pois` pinta texto e ícone com `text-tuggi-blue`. Aqui a estrutura é a mesma e a
tinta é `text-primary-800` (5,44:1). A marca continua presente como **superfície**
(`bg-tuggi-blue/10` no chip do trilho) e como ícone **decorativo** com `aria-hidden` — o título
ao lado carrega o significado, o que isenta o ícone de SC 1.4.11.

**No escuro, a marca funciona.** `#00A8E8` sobre `gray-900` mede **6,57:1** e passa com folga —
é 2,70:1 sobre branco que reprova. Então links e opções do trilho são
`text-primary-800 dark:text-tuggi-blue`. Não é inconsistência: é a mesma medição lida em duas
superfícies, e vale registrar porque contradiz a leitura fácil de D-001 ("a marca não serve de
tinta"). Ela não serve **de dia**.

## 2.1 Divergência D-C — o rótulo micro-caps da `/pois` reprova AA — **nova**

O elemento mais característico do padrão — `text-[10px] font-bold text-gray-400 uppercase
tracking-widest`, usado em toda seção de filtro, cabeçalho de tabela e rótulo de número — mede
**2,51:1** (#9CA3AF sobre o painel). SC 1.4.3 pede 4,5:1, e 10px não é texto grande sob nenhuma
leitura.

Achado pelo `axe-core` no minuto em que esta tela adotou o idioma. Corrigi localmente para
`text-gray-500` (#6B7280, **4,83:1**), que é o mesmo rótulo no mesmo peso. **Isto não é um
defeito desta tela: é do padrão**, e ele está em `/pois`, na ficha do cliente e em toda tela do
dialeto A. A correção certa é sua, e é uma linha no design system.

## 2.2 Divergência D-D — o variant PADRÃO do `Button` reprova AA — **nova, e é a mais cara**

`components/ui/button.tsx`, variant `default`: `bg-primary text-primary-foreground` = branco
sobre `#00A8E8` = **2,70:1**. Reprova SC 1.4.3, e reprovaria até os 3:1 de não-texto.

Ao lado, no mesmo arquivo, existe `variant="cta"` = `bg-primary-800 text-white`, com o
comentário que diz exatamente isto: *"o primeiro degrau de `primary` que carrega texto branco em
AA"*.

**O padrão é o errado.** Quem escreve `<Button>` sem variant — o caminho de menor esforço —
produz um botão que reprova; quem lembra de escrever `variant="cta"` produz um que passa. São
**33 `<Button>` sem variant** no CMS hoje (`grep -rn "<Button" components/ app/ | grep -v
"variant="`).

Corrigi os três das telas de parceria que o `axe` alcançou (`Promover`, `Salvar` da anotação, e
o `Promover` do painel). **Não troquei o default global**: isso repinta o CTA de toda tela do
CMS e é decisão sua, não minha. Mas enquanto o default for este, cada botão novo nasce
reprovando — é o formato de defeito que CLAUDE.md §10 diz que devia ser hook, não regra escrita.

## 3. Divergência D-A — dois dialetos visuais convivem a um clique

**Medido, não impressão.**

**Dialeto A** — o resto do CMS (`/pois`, `ClientEditorModal`, `PlaceFormModal`):
`bg-white/70 dark:bg-gray-900/70 backdrop-blur-xl rounded-3xl shadow-2xl`, sidebar `w-[18%]
sticky top-24`, ícone em `bg-tuggi-blue/10 rounded-xl`, pills `rounded-2xl`, tema escuro.

**Dialeto B** — `PartnershipDetail` (e, até 2026-08-17, `ClientDirectory` e as telas de
proposta): `max-w-7xl px-6 py-6`, `rounded-md border-gray-300`, `<table>` cru,
`text-primary-800`, **sem `dark:`**.

`ClientDirectory` e `partnerships/proposals/` já migraram para a moldura do dialeto A com a
tinta do B. **Falta `PartnershipDetail`** — que é também a aba `Parceria` dentro do drawer, e
por isso é o último ponto onde os dois dialetos se encostam.

O dialeto B é escolha declarada de acessibilidade: `text-tuggi-blue` (#00A8E8) mede **2,70:1** e
reprova SC 1.4.3; `text-primary-800` (#00719F) mede **5,44:1**. Bate com **D-001** em
`docs/design/sistema.md`, medido em 2026-08-05.

**A fronteira agora é visível numa tela só:** a aba `Parceria` (dialeto B) vive dentro do drawer
de vidro (dialeto A), e `ContractTab` (`rounded-3xl shadow-sm`, dialeto A) linka para
`ContractManager` (dialeto B).

**A decisão é sua, e é uma só:** ou o dialeto B vira o padrão do CMS, ou existe um par acessível
declarado (`primary-800` como tinta, `tuggi-blue` restrito a superfície não-texto) e o dialeto A
migra. Repintar a esteira no vidro é regressão de acessibilidade e não vou fazer sem sua régua.

**Lacunas mecânicas, independentes dessa decisão:** `ContractManager` não usa nenhuma primitiva
de `components/ui/` (botão e select crus); a esteira inteira não tem `dark:`, então quem vem de
`/pois` no escuro leva um clarão branco.

---

## 4. Divergência D-B — a rampa `secondary` não tem degrau que passe AA para texto

**Novo, medido em 2026-08-17 por `axe-core` em `tests/ct/partnerships-a11y.spec.tsx`.**

`tailwind.config.js` para em `secondary.700` = `#CC5200`. Sobre a superfície da lista
(`#F7F9FA`), a 12px:

| Uso | Razão | Critério | Veredito |
| :-- | --: | :-- | :-- |
| `text-secondary-700` como **texto** do badge | 4,16:1 | 1.4.3 (4,5:1) | **falha** |
| `border-secondary-700` como **borda** do badge | 4,16:1 | 1.4.11 (3:1) | passa |

Resolvi localmente: o texto do badge virou `text-gray-900` e a borda ficou com o acento. **Não é
a correção certa** — é a correção possível sem inventar token. É o mesmo formato de D-001, agora
no laranja, e o par que falta é seu.

---

## 4.1 As superfícies do contrato — e a que NÃO é sua para repintar

São três, e o dono é diferente em cada uma:

| Superfície | Arquivo | Dono do visual |
| :-- | :-- | :-- |
| Operador: gerar, enviar, conferir | `components/admin/contract/ContractManager.tsx` | CMS — migrada para a moldura em 2026-08-17 |
| Parceiro: ler e assinar | `app/[locale]/contrato/[token]/page.tsx`, `SigningBlock`, `SigningSurface` | **sua spec, §4.2** — não toquei na linguagem visual |
| O documento | `components/contract/ContractText.tsx` | compartilhado pelas duas, e pelo PDF |

A tela do parceiro está desenhada em `spec-parceria-formulario-e-contrato-2026-08.md` §4.2 —
`pt` fixo, 360 px, índice ancorado, proibição de `max-height` + `overflow-hidden`, os dois atos
afirmativos. O que está implementado bate com o que está escrito. Repintá-la no vidro do CMS
seria contrariar spec sua, e não fiz.

## 4.2 Divergência D-E — nada no produto sabia imprimir — **nova**

`grep -rn "@media print\|print:"` no repositório inteiro devolvia **zero**. Consequência nas
duas pontas:

- o parceiro que aperta Ctrl+P na tela de assinatura levava para o papel a linha de orientação,
  o botão `Baixar o PDF`, o link de pular e o **formulário de aceite em branco**;
- o operador que imprimia a página do contrato levava o checklist, o formulário de geração e a
  trilha do aceite.

A spec §4.2 diz que o PDF é *"cópia para arquivo, nunca o único caminho de leitura"*, e a razão é
CDC art. 46. O papel é o terceiro caminho, e ele estava quebrado.

Implementei o mínimo defensável e travei por teste (`tests/api/contract-print.test.ts`): a
moldura sai (`print:hidden`), **o documento fica**, e a prévia do operador solta o cartão no
papel em vez de emoldurar o instrumento.

**Uma decisão dentro disso é de produto, não minha, e vale sua leitura:** o **formulário de
aceite em branco não vai para o papel**. Uma folha com dois checkboxes e um campo de nome
convida alguém a assinar algo que não registra nada — o aceite é ato contra o servidor, com IP,
user agent e hash (BR-B2B-026). O **recibo assinado imprime**, porque é o que se arquiva. Se
`produto` discordar, é uma linha.

O que NÃO fiz e é seu: `@page` (margens, tamanho), quebra de página entre cláusulas
(`break-inside: avoid`), e se o cabeçalho da Tuggi deve repetir por página. Isso é composição de
documento impresso e tem régua própria.

---

## 5. Decisões pendentes, com dono

### D-1 — a aba `Parceria` aparece para todo cliente

`client_type` aceita sete valores (`business`, `influencer`, `hotel`, `partner`, `creator`,
`driver`, `venue`). A aba mostra as cinco faixas para todos, inclusive um `influencer` que nunca
teve proposta — que lê `ainda não` em cinco faixas.

Gatear por `client_type === 'partner'` **erra**: `venue` e `hotel` também são parceiros
(BR-B2B-020, item 5). O sinal honesto é o pipeline não ter submissão, contrato nem local — mas
isso custa um fetch antes de desenhar a tira de abas.

### D-2 — o nome `Parcerias` sobre uma lista que contém `driver` e `influencer`

Decisão do operador em 2026-08-17. Registro o risco: `.claude/rules` e CLAUDE.md §6 tratam nome
que mente como defeito, e a rota continua sendo `/admin/clients` enquanto o rótulo diz
`Parcerias`. Se o nome vale, a rota devia acompanhar — e aí é card de renomeação com churn real
(`detailPath`, `returnTo`, `?clientId=`, a página do contrato, as rotas de API). **Você decide o
rótulo; o Tech Lead decide se a rota segue.**

### D-3 — a ordem e o peso das colunas

São nove: Cliente, Onde, Tipo, Estado, Contrato, O que falta, Parado há, Triagem, Abrir. Herdei
seis da fila e acrescentei três (Tipo, Contrato, e a `Situação do cadastro` como segunda linha
sob o nome). Não medi se nove cabem no monitor do time comercial; por ora o cartão rola a tabela
dentro dele (`overflow-x-auto`), então a página nunca rola de lado — mas rolagem horizontal
dentro de um cartão continua sendo custo de leitura, e cortar coluna é decisão sua.

### D-4 — o trilho usa botões com contagem, e a `/pois` usa `<select>`

`/pois` filtra país, estado e cidade com três `<select>`. Aqui são listas de botões, porque cada
opção carrega **a contagem que ela abre** — informação que um `<select>` não mostra, e que é o
que torna a união das duas listas útil. Mantive os botões e registro a divergência: se o padrão
tem de ser `<select>`, a contagem morre junto.

---

## 6. O que já está travado por teste — não mexa sem trocar a asserção

- **Todo estado é texto**, nunca cor ou ícone sozinho (DS-A11Y-003): estado do pipeline,
  contrato, relógio da triagem.
- **`#00A8E8` não pinta texto nem ícone informativo** dentro da esteira —
  `tests/ct/partnerships-a11y.spec.tsx`, critério 25.
- **Alvos de 24×24 CSS px** e **`axe-core` limpo** em quatro estados da lista e três do detalhe.
- **Toda contagem de faceta abre exatamente as linhas que promete** —
  `tests/api/client-directory-filter.test.ts`.
- **Dimensão sem valor não desenha**: em 2026-08-17, 3 de 11 clientes tinham país.

## 7. Como validar

```
npm run test:api                              # 570 casos
npx playwright test -c playwright-ct.config.ts # 14 casos, Chromium real
```
