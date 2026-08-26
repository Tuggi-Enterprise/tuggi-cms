# Backfill: o local de parceiro que não paga volta a ser só o nome

Decisão do operador em **2026-08-26**, olhando a medição: *"analise os locais que nao sao pagantes
e que tem descriçao que nao seja o nome, e ajuste"*.

Isto está em `docs/dev/` e não no card porque é o que **sobrevive ao card**: uma reescrita de
conteúdo publicado, e o caminho de volta dela.

## O que ela é, e por que não é a RPC

`core.cms_apply_name_only_description` **recusa** quando há descrição de outra origem no caminho —
devolve `blocked`. Essa recusa é o 5º caso de borda de **BR-B2B-016** em código: *"'Somente o nome'
não é degradação do que já existe. POI de parceiro já publicado com descrição não perde a descrição
por causa desta regra"*. Ela vale para sempre no caminho do produto.

O backfill é a **decisão nova** que aquele caso de borda exige, e decisão nova se executa uma vez,
com rastro — não afrouxando a guarda do dia a dia. Um parâmetro `force` na RPC seria a guarda com
uma porta dos fundos permanente.

## Quem entra

`scripts/backfill-partner-name-only-descriptions.ts`. Ele **não decide nada**: importa
`derivePartnerPlan` e `describeDescriptionPolicy`, os mesmos módulos que a tela e a rota usam, e
obedece. Consequência que importa: parceiro com **exceção aberta** responde `partner_story` e não é
tocado, sem o script saber que exceções existem.

Medido em **2026-08-26**, depois de fechado — 23 locais de faixa não pagante, nas TRÊS fontes:

| | |
| :-- | :-- |
| `attractions.description` com texto | **0** |
| `app_poi_read.description` com texto | **0** |
| locais sem linha de narração | **0** |
| narração diferente do nome (qualquer idioma) | **0** |

## Como voltar atrás

O texto substituído **não é apagado**. Vai para `generation_meta`:

```json
{
  "kind": "partner_name_only",
  "replaced_description": "<o texto que estava no ar>",
  "replaced_kind": "master_2step",
  "replaced_at": "2026-08-26T…",
  "replaced_by": "backfill-partner-name-only-descriptions"
}
```

Reverter um local:

```sql
UPDATE core.attraction_descriptions
   SET description     = generation_meta ->> 'replaced_description',
       audio_url       = NULL,
       generation_meta = jsonb_build_object('kind', generation_meta ->> 'replaced_kind'),
       updated_at      = now()
 WHERE attraction_id = '<uuid>'
   AND language = 'pt-br' AND gender = 'male'
   AND generation_meta ? 'replaced_description';
```

Reverter todos: o mesmo `UPDATE` trocando a linha do `attraction_id` por
`AND generation_meta ->> 'replaced_by' = 'backfill-partner-name-only-descriptions'`. **O `WHERE`
não é opcional** — sem ele isto é a linha que a §3 do CLAUDE.md manda o humano executar, e este
comando não é essa classe justamente por causa dele.

Depois de reverter, o áudio precisa ser regerado: `audio_url = NULL` é texto sem voz, e o app tem
guarda nativa contra tocar o direcional sozinho.

## O pré-requisito, e por que ele existe

**A Edge Function precisa estar deployada com o caminho `tts_only`** (`generate-description`,
`cachedForAudioOnly`). Sem ele o backfill deixa 13 locais mudos:

A guarda `PARTNER_WITHOUT_INPUT`, escrita em 2026-08-26, recusa gerar narração de local de parceiro
sem insumo no corpo — certo. Mas ela alcançava também o caminho de **só sintetizar voz sobre texto
já gravado**, que não produz afirmação nenhuma sobre o lugar e é BR-CONTEUDO-001 modo 1 pelo mesmo
motivo que traduzir não é produzir. O conserto reusa o texto guardado em vez de regerar — o que o
comentário daquele bloco já prometia desde sempre e o código não fazia, gastando uma chamada de LLM
e trocando pelas costas o texto que o curador aprovou.

Ordem: **deploy da EF → `--apply`**. Ao contrário, o texto muda e o áudio falha local a local.

## O que a execução de 2026-08-26 ensinou

O `--apply` rodou e ajustou **19 textos com 0 áudios**. Dois bloqueios, e nenhum dos dois era o que
eu esperava — o erro de método foi não ter testado a voz em UM local antes de passar nos 20:

1. **A chave.** `db.functions.invoke` manda o `SUPABASE_SECRET_KEY` do CMS, e a Edge Function
   compara o bearer com a `ef_secret_key` (`_shared/secret-key.ts`). São duas das quatro chaves do
   projeto, e a separação é deliberada: o token chega desconhecido, `getUser()` o rejeita, e a
   resposta é `401 Invalid or expired token`. O script passou a ler `EF_SECRET_KEY` do ambiente e a
   chamar a função por `fetch`.
2. **O gate de `facts_pack_json`.** O ramo de "descrição existe, áudio não" exigia
   `facts_pack_json?.length > 0`. A descrição da faixa gratuita é o NOME e nasce com `[]` — porque
   nome próprio não tem fato a empacotar, e inventar um para satisfazer o gate seria mentir na
   trilha. Sem fatos, a linha caía para geração fresca e batia na guarda `PARTNER_WITHOUT_INPUT`.
   O ramo do TTS deixou de exigir fatos; o de "cache hit completo" continua exigindo.

3. **Só `pt-br/male`, e o resto rebrotou.** O script cravou uma "linha base" e deixou as outras em
   paz. Três locais tinham também uma linha `en-us` com a narração antiga — e **dez minutos depois
   do backfill o `Brigaderia da Vovó` estava de volta com 183 caracteres**: o app pediu a
   descrição, não achou áudio, a EF caiu no passo de TRADUÇÃO, achou o inglês intacto e traduziu o
   texto velho de volta para português, com voz. A régua não fala de idioma; o ajuste passou a
   tocar TODAS as linhas do local. Enquanto sobrar uma, ela é a semente de que o resto rebrota.
4. **`.update()` sem `.select()` mente.** O PostgREST devolve sucesso para um UPDATE que casou ZERO
   linhas, e foi assim que três locais entraram na contagem de "19 ajustados" sem nunca terem sido
   escritos — só a medição no banco denunciou (16 marcados contra 19 relatados). O script agora
   pede as linhas de volta e conta o que veio.

5. **A Edge Function estava APAGANDO a descrição a cada visita do app.** A pior das cinco, e a
   guarda `PARTNER_WITHOUT_INPUT` foi quem a acordou. Sequência: o passo 2 toma o lock
   **sobrescrevendo a linha com `[PROCESSING]`**; o passo 3 estoura na guarda; o `catch` **apaga a
   linha**. Resultado: cada vez que o app encostava num local de faixa gratuita, a descrição dele
   era destruída — `Sabor e Arte Restaurante` e `Cafeteria Encontros` ficaram sem linha nenhuma
   antes de alguém notar. O `catch` passou a **restaurar** o que o lock sobrescreveu, e isso
   conserta a classe inteira: falha de rede, `finishReason` ruim ou cota estourada também não
   custam mais o que estava no ar.
6. **Havia uma TERCEIRA fonte de texto, e é a que o turista LÊ.** `core.attractions.description`
   guardava a promoção do festival em 23 locais, e `core.app_poi_read.description` a espelhava —
   ela sai de `a.description` em `app_poi_read_build`. O áudio dizia só o nome e a tela mostrava a
   promoção. O script limpa a fonte e manda **reconstruir** o read model; escrever no derivado
   seria a segunda casa do mesmo fato.

**Não se reverte para recuperar o áudio.** Reverter põe de volta no ar exatamente o conteúdo que o
operador mandou tirar — inclusive as promoções de festival, que são oferta comercial em faixa
gratuita e reprovam pela alínea (b) do portão 2. Silêncio é o estado interino correto; o conserto é
o `--voice`.

## Rodar

```bash
npx tsx --env-file=.env scripts/backfill-partner-name-only-descriptions.ts          # análise
npx tsx --env-file=.env scripts/backfill-partner-name-only-descriptions.ts --apply  # aplica
npx tsx --env-file=.env scripts/backfill-partner-name-only-descriptions.ts --voice          # quem está mudo
npx tsx --env-file=.env scripts/backfill-partner-name-only-descriptions.ts --voice --apply  # gera a voz
```

O `--voice` exige `EF_SECRET_KEY` no ambiente — a `ef_secret_key` do projeto, que é a que a Edge
Function valida. Ela nunca sai da máquina de quem roda.

A análise é leitura pura. O `--apply` escreve texto e chama a EF para a voz, um local por vez, para
que uma falha no meio diga onde parou.

## O que este backfill NÃO resolve

As 3 descrições de parceiro **pagante** continuam no ar e **não passam no portão 2** de
BR-B2B-011 — *"o nome já diz tudo, não é?"*, *"imagine sabores caseiros"* sobrevivem inteiros ao
teste do substituto. Elas não são caso deste script (o pagante tem direito a descrição); são caso
de regeração pelo estúdio, com o insumo que o parceiro enviou. Decisão separada, do operador.
