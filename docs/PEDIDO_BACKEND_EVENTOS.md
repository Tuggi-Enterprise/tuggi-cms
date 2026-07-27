# Pedido ao time de backend — narração de eventos

Três entregas, nesta ordem. A 1 é independente e destrava um teste parado; a 2 é análise e desenho; a 3 depende da 2.

**Regra do projeto que vale para tudo aqui:** migrations são aplicadas **manualmente pelo painel (SQL Editor)**, nunca via CLI.

---

# Entrega 1 — Deploy imediato: `generate-translated-audio`

## O que está errado hoje

O app iOS **não lê** `attraction_descriptions.audio_url`. Ele monta a URL do áudio por convenção:

```
travel-app-audios/master_audio/{id}/{id}-{lang}-{gender}.mp3
```

As duas edge functions gravam em prefixos **diferentes** do mesmo bucket:

| Edge function | Grava em | iOS acha? |
|---|---|---|
| `generate-description` | `master_audio/{id}/…` | ✅ |
| `generate-translated-audio` | `audio/{id}/…` | ❌ |

E a aba de narração do CMS chama **as duas**, dependendo do botão: "regenerar áudio" usa a primeira, "gerar áudio multi-idioma" usa a segunda.

## Evidência medida em produção (27/jul/2026)

- Em 3 amostras de 400 linhas com áudio: **75 estão em `/audio/`** (~6% do acervo). **Todas mudas no iOS.**
- Reproduzido ponta a ponta com o evento *Festa da Padroeira* (`f6c5e31a-8a1f-4d92-8aa7-f5996f4169b7`): trigger point disparou, download falhou.

```
master_audio/{id}/{id}-pt-br-male.mp3  → HTTP 400 (não existe)  ← o que o iOS pede
audio/{id}/{id}-pt-br-male.mp3         → HTTP 200, 223 KB       ← onde o CMS gravou
master_audio/{id}/{id}-en-us-male.mp3  → HTTP 200, 199 KB       ← onde a outra EF gravou
```

O Android nunca foi afetado: ele lê o `audio_url` do banco.

## A mudança (já feita, aguardando deploy)

`supabase/functions/generate-translated-audio/index.ts`, função `uploadAudioToStorage`:

```diff
- const storagePath = `audio/${attractionId}/${fileName}`;
+ const storagePath = `master_audio/${attractionId}/${fileName}`;
```

Só afeta escritas novas. As linhas antigas guardam a URL absoluta e continuam válidas no Android; voltam a tocar no iOS quando o áudio for regerado.

⚠️ **Não mexer** no `route-audios/` (modo rota, na mesma função) — é outro namespace, com caminho próprio no app.

## Deploy

```bash
npx supabase functions deploy generate-translated-audio --project-ref tysnkzmljlmmqpbotkxv
```

## Como validar

1. No CMS, gerar áudio multi-idioma para qualquer atrativo.
2. Conferir que o `audio_url` gravado contém `/master_audio/`.
3. `curl -I` nessa URL → 200.

## Nota

O app iOS também foi corrigido (commit `66efbbbc`) para ler o `audio_url` do banco em vez de montar por convenção. As duas correções são complementares: a do app conserta retroativamente, a da EF impede a divergência de voltar. **Não depende uma da outra para deployar.**

---

# Entrega 2 — Análise e desenho: vínculo POI ↔ Evento

## O problema de produto

Um evento quase sempre acontece **dentro de um POI**. A Festa da Padroeira acontece na igreja. Hoje o app narraria o evento como assunto autônomo, ao lado do POI — o certo é a **igreja** narrar e mencionar a festa enquanto ela é relevante:

> "Igreja Xpto, bla bla bla… e nos dias 13 a 17 acontece aqui a Festa da Padroeira."

Quando a festa acaba, a igreja volta a ser narrada normalmente.

## Por que é impossível hoje

`core.event_details` tem **25 colunas e nenhuma aponta para um atrativo anfitrião**:

```
attraction_id, starts_at, ends_at, timezone, all_day, rrule, recurrence_end,
status, organizer_name, organizer_url, organizer_contact, ticket_url, is_free,
price_min, price_max, currency, capacity, age_restriction, poster_url,
event_category, tags, created_at, updated_at, created_by, updated_by
```

O evento é uma `core.attractions` independente, com coordenada própria e sem relação com o POI onde ocorre.

## Os dois cenários que precisam coexistir

| | Cenário 1 — evento em POI | Cenário 2 — evento autônomo |
|---|---|---|
| Exemplo | Festa da Padroeira na igreja | Bloco de rua, corrida, festival na praia |
| Quem narra | O **POI**, mencionando o evento | O **próprio evento** |
| Trigger point | Do POI (o evento **não pode ter**) | Do evento |
| Estado no app | A construir | ✅ Já funciona |

## O que pedimos que vocês analisem e proponham

**a) Como modelar o vínculo.** Avaliar pelo menos estas duas, com prós e contras:

- **Reusar `core.attraction_group_members`** — o primitivo já existe e a `generate-description` já o lê (POI pai + membros, `group_role = 'main'`). Evitaria migration de schema, mas o `group_role` passaria a carregar um significado diferente do uso atual.
- **Coluna nova** `event_details.venue_attraction_id` — explícita e sem ambiguidade semântica, ao custo de migration + UI.

Descartamos inferência espacial: a coordenada da festa costuma ser a praça, não a igreja.

**b) A regra "evento vinculado não pode ter trigger point".** Ela precisa viver **no banco**, não no app. Concretamente: `app_get_nearby_events` deve **suprimir `trigger_points`** quando o evento tem vínculo.

Motivo: o app decide narrar por presença de TP. Se alguém autorar vínculo **e** TP, o usuário ouve duas vezes — uma na narração do POI, outra no TP do evento. Resolvendo na RPC, a regra fica num lugar só e o app não precisa aprender o conceito de vínculo (que viraria mais uma cópia de regra em JS + Kotlin + ObjC).

**c) Como o usuário faz o vínculo no CMS.** Hoje a aba de Trigger Points é oferecida igual para POI, evento e local (`EntityManagementDrawer` reusa `TriggerPointsTab` para os três). Precisa de:
- uma forma de vincular o evento a um POI anfitrião;
- e um aviso ou bloqueio na aba de TP quando há vínculo.

**d) O ajuste manual do que já existe.** Levantar quais dos 442 eventos aprovados já acontecem em POIs cadastrados e propor como fazer essa amarração inicial.

## Contexto adicional que pode poupar tempo

- **433 dos 442 eventos têm `priority_level = 3`** (só 9 são nível 2). É valor default de importação, não curadoria — o app **ignora** esse campo para eventos de propósito, porque o `DEFAULT_POI_DETAIL_LEVEL` é 2 e aplicar o corte apagaria 98% do acervo.
- **`app_get_pois_by_cone` não projeta** `boundary_geojson`, `category`, `boundary_area_m2` nem `business_status`, embora `core.app_poi_read` tenha as quatro. `app_get_nearby_pois` projeta. Isso bloqueia detecção por boundary no modo navegação e provavelmente vira tarefa em breve — é migration pequena, não falta de dado.

---

# Entrega 3 — Ajustar as EFs e deployar

Só depois da entrega 2, porque o desenho define o formato.

## 3.1 Prompt composto (`generate-description` + `_shared/masterPackGenerator.ts`)

Já está feito e **aguardando deploy**: o prompt passou a ramificar por `entity_kind` (poi | event | place). O caminho de **POI ficou byte a byte idêntico** — as 10 strings foram preservadas e só movidas para o ramo `else`. Evento e local ganharam enquadramento próprio (evento não tem "ano de fundação"; hotel não tem "história de conflito").

O plumbing também está pronto: a EF passou a buscar `entity_kind`, `event_details(starts_at, ends_at, event_category)` e `place_details(place_type)` e a repassá-los ao gerador.

**Falta**, e depende da entrega 2: o ramo do **cenário 1** — POI como assunto, evento como adendo datado, com tempo verbal ancorado em `todayStr`.

## 3.2 Validade de conteúdo

Quando a narração do POI menciona um evento, o áudio passa a **depender de data**: precisa parar de mencionar quando o evento acaba.

Desenho acordado:

- coluna `valid_until timestamptz NULL` em `core.attraction_descriptions`;
- a EF grava `valid_until = ends_at` ao gerar descrição enriquecida com evento; descrição base fica `NULL` (nunca expira);
- **a RPC EXPÕE o `valid_until`, não só filtra por ele.** Filtrar sozinho protege quem está online; offline o app só tem a linha cacheada e a tocaria. O app precisa guardar a validade e aplicá-la localmente;
- expiração **degrada para a descrição base**, nunca para o silêncio. Emudecer conteúdo baixado numa área offline seria regressão séria num recurso pago.

## 3.3 Três armadilhas mapeadas

**Não apagar a descrição antiga — sobrescrever.** A `generate-description` (passo 3.1) procura uma linha em **outro idioma** para traduzir a partir dela. Apagar a mestra faz a regeração cair no passo 3.2 e **inventar** em vez de traduzir.

**Falta o gatilho no sentido de entrada.** Filtrar por `valid_until` tira a menção quando o evento acaba, mas nada a coloca quando ele começa: a descrição base tem `valid_until = NULL` e nunca expira. Precisa de um gatilho que invalide a descrição do POI anfitrião quando um evento é vinculado/aprovado — simétrico ao que a migration `20260715_02` já faz para mudança de texto.

**O mp3 vencido pode continuar tocando no iOS.** O app mantém a convenção `master_audio/…` como *fallback* quando `audio_descriptions` vem vazio — que é exatamente o que a expiração por filtro produz. O blob antigo ainda está no storage e tocaria.
→ Boa notícia: a `generate-description` **já apaga o blob antigo** nesse caso (variável `stalePath`, ~linha 421, "áudio antigo removido"). O mecanismo existe e provavelmente é só estendê-lo, sem inventar nada.

---

# Resumo das entregas

| # | Entrega | Depende de |
|---|---|---|
| 1 | `generate-translated-audio` deployada gravando em `master_audio/` | — |
| 2 | Desenho do vínculo POI↔evento: modelagem no banco, regra na RPC, UI no CMS, plano de amarração do acervo atual | — |
| 3 | EFs ajustadas (prompt composto + validade) e deployadas | 2 |
