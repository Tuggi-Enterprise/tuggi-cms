# Resposta backend — Entrega 3 (final): narração do evento no TP do POI

Spec da Entrega 3 do [PEDIDO_BACKEND_EVENTOS.md](./PEDIDO_BACKEND_EVENTOS.md), **modelo final** acordado com o usuário (27/jul/2026). Continuação da [Entrega 2](./RESPOSTA_BACKEND_ENTREGA2_VINCULO_POI_EVENTO.md) (vínculo `event_details.venue_attraction_id`, já aplicado e validado).

> ⚠️ Este documento **substitui** o desenho anterior "Forma A / tabela separada / `valid_until`". O usuário propôs um modelo mais simples que colapsa quase toda aquela máquina.

**Só desenho.** Nada aplicado.

## O modelo

O áudio/descrição enriquecidos são **do evento** — nas `attraction_descriptions` do próprio evento (que já é uma `attraction`), compostos como **"contexto do POI + evento"**. Não há variante do POI, não há coluna de expiração.

**O ciclo de vida do evento é o controle único:** as datas (`event_details.starts_at/ends_at`) e o delete/cancel do evento governam tudo. **A descrição do POI nunca é tocada.**

## Runtime — a escolha acontece **só no TP**

O evento vinculado **não tem TP** (desativado na Entrega 2). Quem dispara é o **TP do POI**. No disparo, o app decide:

```
evento_ativo = evento vinculado a este POI com starts_at <= agora <= ends_at
tocar = evento_ativo ? áudio_do_evento : áudio_do_POI
```

- **Durante o evento** → toca o áudio **do evento** (que já é "POI + evento contextual", logo cobre o POI — não toca os dois, sem narração dupla).
- **Fora da janela** → toca o áudio **do POI**, normal.

Offline-safe: a decisão usa as **datas reais do evento** (cacheadas), sem `valid_until` paralelo. Degradação nunca vira silêncio, desde que o POI tenha o áudio dele (já é o normal).

## Geração/tradução do evento = **idêntica à do POI**

O evento é só mais uma `attraction` → reusa **a mesma pipeline on-demand**, sem caso especial. Quando o TP escolhe o evento:

- **não tem descrição** → gera **descrição + áudio** (do evento);
- **tem descrição, mas não na língua pedida** → **traduz** para a língua + gera áudio;
- **tem descrição e áudio na língua** → toca.

Exatamente o fluxo que o POI já faz hoje. A regra **"gera o master uma vez, traduz, nunca regera"** aplica ao evento como seu próprio master (regera só se o *evento* mudar).

## As ÚNICAS mudanças de backend

1. **EF `generate-description`, ramo `kind='event'`:** quando o evento tem `venue_attraction_id`, puxar os fatos do **POI anfitrião** e compor "POI + evento de forma contextual". **O restante do prompt de evento continua igual** — só ganha o contexto do POI. O plumbing por `entity_kind` já existe ([index.ts:311-338](../supabase/functions/generate-description/index.ts#L311)); falta buscar o venue e injetar seus fatos no gerador.
2. **RPC `app_get_nearby_events`: expor `venue_attraction_id`** — para o app casar "este evento acontece neste POI" no disparo do TP. A RPC já devolve os eventos + `audio_descriptions` + datas; falta só o campo do vínculo. Muda a assinatura (`RETURNS TABLE`) → DROP+CREATE.
3. **App (`tuggi-drive-v2`, outro repo):** a regra de seleção no TP (acima) + rodar a **mesma** lógica on-demand na attraction escolhida (evento ou POI).

Nada mais. Compare com o desenho anterior — **cai tudo isto:** tabela `attraction_event_descriptions`, coluna `valid_until`, UNION no read-model, gatilhos *dirty* de variante e o job de GC dedicado.

## Ciclo de vida — herdado do evento, nada novo a construir

- **Evento passa** (`ends_at < now`) → `app_get_nearby_events` já filtra (`COALESCE(ends_at, starts_at+24h) >= now`) → o app deixa de ver → o TP do POI volta a tocar o POI. Offline, o próprio teste `starts_at<=agora<=ends_at` no app resolve, mesmo com a lista em cache.
- **Evento apagado/cancelado** → `ON DELETE CASCADE` remove as descrições do evento; os mp3 viram órfãos e o cron **`cleanup-orphan-audios` (`automated_audio_cleanup`) já existente** recolhe.

Ou seja: **sem `valid_until`, sem job de GC novo, sem UNION, sem gatilho de variante.**

## Base-first / nunca silêncio

- O POI tem o **áudio dele** (fallback quando não há evento ativo) — já é o normal.
- O evento tem o **áudio dele** (POI + evento).
- Independentes. Nunca silêncio enquanto o POI tiver áudio.

## Trade-off (honesto)

A descrição do evento **duplica** os fatos do POI. Se os fatos do POI mudarem **durante** a janela do evento, o áudio do evento fica levemente desatualizado nesse ponto. Eventos são curtos → aceitável. **Opcional** (não obrigatório): um gatilho que, ao mudar a descrição do POI, invalide as descrições dos eventos **ativos** naquele POI.

## Ordem de aplicação

1. **EF `generate-description`** (contexto do POI no ramo de evento) → **deploy via npx**.
2. **`app_get_nearby_events` expõe `venue_attraction_id`** → SQL manual no painel.
3. **App** (`tuggi-drive-v2`): seleção no TP + on-demand — quando o app for narrar POIs/eventos.

## Decisões (resolvidas)

1. **2+ eventos ativos no mesmo POI ao mesmo tempo** → tocar **o mais próximo**; **empate na mesma data** → **modo random + telemetria** (registrar qual tocou; medir qual performa mais) até haver inteligência para decidir. Regra no app.
   - Operacionalização de "mais próximo" (os dois já ativos, "agora" dentro das duas janelas): **`ends_at` mais cedo** (o que fecha primeiro = mais urgente). Empate de datas → random. *(alternativa, se preferir: `starts_at DESC` = o que começou mais recentemente.)*
2. **Invalidação das descrições de evento quando o POI muda** → **descartada** por ora — o POI dificilmente muda. (O trade-off de duplicação de fatos fica aceito.)
