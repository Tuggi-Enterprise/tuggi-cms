# Navegação e acesso — o que mudou em 2026-09-01, e o que ficou aberto

Rodada pedida pelo operador: reorganizar o menu, revisar as permissões de visualização das
páginas, implementar com DRY/SSOT/KISS. Um designer analisou a heurística, um revisor de
segurança analisou o acesso, e o que segue é o que foi feito e o que **não** foi.

---

## 1. A regra que passou a existir

> **Um item visível no menu é um caminho que o portão admite para aquele usuário.**

Antes, essa frase era falsa para dois dos quatro roles. `proxy.ts` decidia o acesso e
`components/ui/Header.tsx` decidia a visibilidade, cada um com condições próprias — e as duas
discordavam. Agora existe um módulo só:

| arquivo | responsabilidade |
| :-- | :-- |
| `lib/navigation/access.ts` | `resolveAccess(path, ctx)` → `allow` / `unauthorized` / `redirect` |
| `lib/navigation/menu.ts` | `buildNavTree(ctx)` → a árvore, podada por `canReach` |
| `proxy.ts` | locale, sessão, identidade — e **pergunta** a `resolveAccess` |
| `components/ui/Header.tsx` | desenha, duas vezes (barra e gaveta), a partir da mesma árvore |

`tests/api/navigation.test.ts` prova a tabela inteira sem banco e sem `mock.module` — o que
importa nesta máquina, onde `mock.module` não resolve o alias `@/`.

### O defeito concreto que isso corrigiu

Um `editor` via no menu "Dashboard", "Pontos de Interesse" e "Rotas Customizadas". Os três
respondiam `/unauthorized`, porque `proxy.ts` só consulta `ALLOWED_CLIENT_PATHS` **dentro** do
ramo `isClient`, e editor não é client. Um `viewer` via os mesmos três links quebrados.

---

## 2. O menu

`Admin` deixou de existir como grupo. Ele reunia dez itens de **cinco naturezas** — pipeline de
ingestão, diagnóstico, conteúdo, comercial e operação da ferramenta — pela única coisa que
tinham em comum: quem podia vê-los. Categoria e permissão são eixos ortogonais; usar um como o
outro produz uma gaveta que só cresce. `Parcerias`, objeto comercial de uso diário, estava a
dois cliques lá dentro, entre um importador de OSM e um log de auditoria.

```
ANTES   Dashboard | Minha rede | Financeiro | Gestão de Pontos ▾ | Marketing ▾
                              | Relatórios ▾ | Usuários ▾ | Admin ▾ (10 itens)

DEPOIS  Dashboard | Minha rede | Financeiro | Pontos ▾ | Parceiros ▾ | Marketing ▾
                              | Relatórios ▾ | Sistema ▾
```

- **Pontos** — três seções nomeadas: *Publicar* (POIs, Eventos, Locais, Rotas, Áudios de
  Sistema), *Ingestão* (OSM, Busca, Processamento), *Diagnóstico* (Mapa de Gatilhos, Trilhas,
  TP Teste Único). Para um `client`, colapsa em dois itens sem cabeçalho.
- **Parceiros** — Parcerias, Material, Cupons. `Material` é **irmã** de `Parcerias`, nunca
  filha: o objeto da tela é o pedido, não o parceiro.
- **Sistema** — Equipe CMS, Usuários do App, Registros de Auditoria.
- **Relatórios** — o item de `/dashboard/reports/users` virou **"Base de Usuários"**. O rótulo
  `Usuários` nomeava três destinos diferentes na mesma barra.

### Decisões preservadas

`Parcerias` é uma entrada só e abre a lista inteira (sem `?state=`); `Financeiro` é entrada de
topo porque é gateado por módulo e não por role; o coordenador usa `Minha rede` e não recebe
Dashboard; a Overview global não é oferecida a `client`.

### Uma escolha que é sua para reverter

**`Equipe CMS` passou a apontar para `/admin/users`, não para `/users/cms`.** As duas telas
gerenciam `core.cms_users`. A escolhida passa pela API (`withAuth` + validação de
`enabled_modules`); a outra escreve na tabela **direto do navegador**, inclusive `role`
(`app/[locale]/users/cms/page.tsx:290`) — que a API declara imutável. `/users/cms` continua
alcançável por URL; nada foi apagado.

---

## 3. Segurança — corrigido nesta rodada

| # | O quê | Onde |
| :-- | :-- | :-- |
| S1 | `/api/pois/bulk-garbage` apagava POIs em massa sem checar role. O docstring dizia "only system admins"; o código nunca comparava. A UI era a única barreira | commit `cd50b5e` |
| S2 | `/api/migration/{migrate-batch,migrate-stream,list-candidates}` disparavam o pipeline (escrita, LLM/TTS, leitura de `homolog`) só com "existe sessão" | commit `cd50b5e` |
| S3 | Menu e portão discordavam para `editor` e `viewer` | esta rodada |

---

## 4. Segurança — ABERTO, e por quê

### 4.1 Precisa de acesso ao banco (não dá para responder pelo repositório)

As migrations aqui são aplicadas à mão no painel, então o repositório **não é** fonte da
verdade sobre o schema. Rode no SQL Editor:

```sql
-- `core.attractions` tem RLS? Se não, todo client logado lê qualquer POI/place por
-- /pois/<uuid> — a página consulta a tabela direto do browser.
select relrowsecurity from pg_class where oid = 'core.attractions'::regclass;
select * from pg_policies where schemaname='core' and tablename='attractions';

-- `core.cms_users` tem RLS? Não há policy nenhuma para ele no repositório; as que existem
-- são de `homolog.cms_users`, outro schema. Se houver uma self_update no molde da de
-- homolog (USING id = auth.uid() sem restringir coluna), qualquer usuário promove a
-- própria linha a admin.
select relrowsecurity from pg_class where oid = 'core.cms_users'::regclass;
select * from pg_policies where schemaname='core' and tablename='cms_users';

-- O CHECK de role de fato exclui 'super_admin'?
select pg_get_constraintdef(oid) from pg_constraint
 where conrelid='core.cms_users'::regclass and contype='c';

-- A RPC de SQL arbitrário ainda existe? `supabase/manual/exec_sql_temp.sql` a define como
-- TEMPORÁRIA e manda apagá-la depois da normalização.
select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='core' and proname='exec_sql';

-- Impacto real dos itens abaixo:
select role, count(*) from core.cms_users where is_active group by 1;
select count(*) from core.cms_users where role='client' and is_active = false;
```

### 4.2 Precisa de decisão sua

1. **`viewer` é um role que não abre nada.** Está em `CMS_ROLES`, o admin pode criá-lo, e
   `/api/auth/check` responde **403** para ele (`app/api/auth/check/route.ts:69`) — então nem o
   menu monta. Ou ele ganha um caminho, ou sai do vocabulário. Não mexi: as duas saídas mudam
   comportamento e nenhuma é obviamente a certa.
2. **`events` e `places` não têm piso de role** em `MODULE_MIN_ROLES`, então aceitam `viewer`
   pelo proxy — enquanto o menu e o layout o expulsam. Três portões, três respostas. O piso de
   `finance` (`['editor']`) resolveu isso lá; aqui falta decidir qual é.
3. **`client` desativado continua entrando.** `proxy.ts` tem `is_active === false && role !== 'client'`
   — a exceção faz um parceiro desativado seguir passando por `/clients`, `/pois`, `/routes`.
   Ou é intencional e falta o comentário, ou é o inverso de uma intenção.
4. **62 rotas de API ainda autorizam por `getSession()`.** `npm run check:routes` sabe apontar
   todas e **não trava build** — não está em `check-all`, nem em `pre-build`, nem no workflow de
   deploy. Colocá-lo lá é uma linha; consertar as 62 é uma rodada inteira.
5. **`/client-registration` é um redirect atrás do portão.** Quem tem o link legado e não tem
   conta recebe 307 para `/login` — o redirect nunca roda. Pertence a `next.config.js`, como
   `/parceria`.
6. **`/dashboard/my-clients` é órfã de verdade**: zero links de entrada no repositório,
   renderiza o mesmo componente de `/clients/dashboard`. Apagar ou redirecionar.
7. **`/debug` está em `PUBLIC_EXACT_PATHS` e não existe página.** Porta pública para um 404.
8. **`super_admin` é código morto que CONCEDE privilégio** em cinco lugares do TS ativo
   (`Header` não mais, mas `useCmsUser.ts:49` e quatro pontos de `app/api/clients/pois/`).
   Código morto que concede privilégio é o tipo que ressuscita.

---

## 5. Armadilhas novas desta máquina

**`npm run build` não conclui aqui, e não é por causa do código.** `node_modules/es-toolkit`
(1.49.0, dependência transitiva do `recharts` 3.6) declara em `exports` o subpath `./compat/*`
apontando para `./compat/*.mjs` — e **não existe diretório `compat/` no disco**. A instalação
está incompleta. O build morre em `es-toolkit/compat/uniqBy`, arrastando
`components/dashboard/UserGrowthChart.tsx`, `PlatformPieChart.tsx`, `dashboard/page.tsx` e
`dashboard/reports/engagement/page.tsx` — nenhum deles tocado nesta rodada. Não há `.next/BUILD_ID`.

Consertar pede reinstalar a dependência, e **`npm install` reescreve o `yarn.lock`** trocando
entradas de macOS por Windows (seção 4 do handover do Financeiro). Por isso não foi feito aqui:
é decisão do operador, não efeito colateral de uma rodada de menu. A verificação usada foi a que
o próprio repositório prescreve — `tsc`, `eslint` e as suítes de teste.

**Testes que leem o texto-fonte procurando `\n\n` falham por CRLF.** `core.autocrlf=true`, então
os arquivos no working tree têm `\r\n`. `client-board-surface.test.ts:125` faz
`new RegExp('export type BoardAct =([\\s\\S]*?)\n\n')` sobre `lib/clients/board-transitions.ts`
(387 CRLF, 0 LF puro) e nunca casa. **Não é defeito de código** — mas é a única falha da suíte
que se disfarça de `ERR_ASSERTION` em vez de erro de módulo, então custa tempo toda vez.

---

## 6. Verificação desta rodada

```
npx tsc --noEmit --skipLibCheck --incremental false      # 0 erros
npx eslint app components lib scripts tests proxy.ts     # 0 erros (2546 warnings; era 2557)
npx tsx --test tests/api/navigation.test.ts              # 23
npx tsx --test tests/api/privileged-routes.test.ts       #  3
npx tsx --experimental-test-module-mocks --test tests/api/finance-*.test.ts   # 100
```

O conjunto `{partnerships-pipeline, client-board-surface, finance-surface, public-pages}` dá
97 testes / 25 pass / 72 fail **antes e depois** — as 72 são a armadilha do Node 20 (71 de
`mock.module`, 1 de CRLF). Os dois testes daquele conjunto que passaram a ler
`lib/navigation/menu.ts` (o 8 e o 9 de `client-board-surface`) **passam**.

---

## 7. O que a revisão de QA mudou

O QA aprovou com ressalvas e achou coisas que eu tinha errado. Corrigido antes do commit:

1. **Eu tinha perdido uma decisão de produto.** O menu antigo escondia o dropdown de Pontos
   inteiro do coordenador (`!isCoordinator`); minha primeira versão só aplicava a regra aos
   links de topo, e o coordenador passaria a ver "Pontos". Ele não gerencia POIs —
   `useCmsUser.canManagePois` é `canEdit && !isCoordinator` —, então seria a porta de uma sala
   onde ele não age. Regra restaurada e agora travada em teste.
2. **`aria-controls` pendurado** no botão do menu mobile: o painel só existia no DOM quando
   aberto. Agora ele fica e some por `hidden`, como o do dropdown.
3. **`aria-current="page"` mentia** em telas fora do menu: o realce segue o casamento mais
   longo (para acender numa tela de detalhe), mas `aria-current` só vale na página exata.
4. **`aria-haspopup="true"` foi removido**: é sinônimo de "menu", e o comentário logo acima
   explica que o painel deliberadamente NÃO é um menu. Prometer teclado de menu sem entregar
   setas ↑/↓ é pior para leitor de tela do que uma lista de links honesta.
5. **Quatro rótulos de a11y estavam em português fixo** (`Principal`, `Menu`, e o
   `title="Switch Language"` do seletor de idioma, que eu tinha deixado de fora do passe por
   contar três botões-ícone onde havia quatro). Viraram chave nos três idiomas.
6. **`onBlur` fechava o painel no alt-tab**, porque `relatedTarget` nulo não é saída do grupo.
7. **Quatro mutações plausíveis passavam verdes.** Fechadas: apagar um destino do catálogo
   (lista explícita), apontar para página inexistente (cruzamento com o disco), inverter a
   ordem módulo/client em `resolveAccess`, e voltar `startsWith` puro. A do meio eu verifiquei
   aplicando a mutação de verdade: o teste novo ficou vermelho, e só ele.
8. **Uma asserção reapontada tinha ficado fraca** — `/CLIENT_DIRECTORY_PATH/` casava com a
   linha do `import`. Agora casa a chamada `item(CLIENT_DIRECTORY_PATH,` e recusa o literal.
9. **Filtro morto removido**: `isMarketingEnabled` é um stub que devolve `true` sempre, e os
   dois itens de marketing já eram podados por `canReach`.

**O que eu NÃO aceitei da revisão.** O QA sugeriu tirar de `buildNavTree` o passe que retira o
título de um grupo com uma seção só, movendo a decisão para o Header. Mantive nos dados: o
Header renderiza barra e gaveta separadamente, e a condição apareceria nos dois lugares —
reintroduzindo em pequeno a duplicação que esta rodada existe para eliminar.

Fica registrado também, como dívida e não como pendência desta rodada: os comentários contam a
mesma história em quatro arquivos (`access.ts`, `menu.ts`, `Header.tsx`, `navigation.test.ts`).
