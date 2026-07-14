# Pipelines de Geração de Conteúdo (descrição, narração JIT, tradução, áudio)

> Mapa de referência dos três fluxos de geração de conteúdo de POI e quais serviços/modelos cada um usa.
> Última revisão: 2026-07-14.

## Visão geral rápida

| Fluxo | Edge Function | Gerador de texto (LLM) | TTS | Onde grava | Status |
|---|---|---|---|---|---|
| **1. Descrição Master** | `generate-description` | Google **Gemini** (RAG 2 passos) | Google Cloud TTS | `core.attraction_descriptions` + bucket `master_audio/` | ✅ Ativo |
| **2. Narração Contextual (JIT)** | `generate-contextual-narration` | Google **Gemini** (`gemini-3.1-flash-lite`) | Google Cloud TTS | `core.cache_narrations` + bucket `contextual_audio/` | ⛔ **Desligado** (`isEnabled = false`, retorna 503) |
| **3. Tradução de descrição + áudio** | `generate-translated-audio` | Google **Gemini** (`gemini-2.5-flash-lite`) | Google Cloud TTS | `core.attraction_descriptions` (POI) / `core.custom_route_descriptions` (rota) | ✅ Ativo |

**Serviços externos usados em todos:**
- **Google Gemini** (`generativelanguage.googleapis.com/v1beta`) — geração e tradução de texto. Chave: `GOOGLE_GEMINI_API_KEY` / `GEMINI_API_KEY`.
- **Google Cloud Text-to-Speech** (`texttospeech.googleapis.com/v1`) — síntese de áudio. Chave: `GOOGLE_TTS_API_KEY` / `GOOGLE_CLOUD_API_KEY`.
- **Supabase** — Storage (bucket `travel-app-audios`), Postgres (schema `core`).

Nenhum fluxo usa OpenAI, Claude ou ElevenLabs. **100% Google (Gemini + Cloud TTS).**

---

## 1. Descrição Master

**Arquivos:** [supabase/functions/generate-description/index.ts](../supabase/functions/generate-description/index.ts) → [supabase/functions/_shared/masterPackGenerator.ts](../supabase/functions/_shared/masterPackGenerator.ts)

É a descrição "canônica" de um POI: um texto narrado (~25s por padrão) + um "facts pack" (até 5 fatos verificados). É gerada em lote pelo app (por proximidade) ou manualmente pelo CMS.

### Fluxo interno

1. **Lock otimista / cache** — checa `attraction_descriptions` por `(attraction_id, language, gender)`. Cache válido = fresco (< 30 dias), com `facts_pack_json`, **e** com `audio_url` (se áudio foi pedido). Usa placeholder `[PROCESSING]` como lock (com detecção de "zombie lock" > 60s).
2. **Atalho de tradução** (se não for `force`) — se já existe descrição em **outro idioma**, traduz a partir dela (prioriza `pt-br` como fonte) em vez de regerar do zero. Herda o `facts_pack_json` e o grounding do master original.
3. **Geração fresca (RAG 2 passos)** — via `generateMasterPack`:
   - **Passo 1 — BUSCAR (grounded):** prompt de *lookup* factual que força o `google_search` a disparar de verdade (o search do Gemini é discricionário e não dispara em prompt de "escreva uma narração"). Coleta bullets etiquetados `[type] [character] [conflict] [sensory] [why] [curiosity] [legend]`. Se há `reference_links` do CMS, usa `url_context` como fonte prioritária. Retorna `NONE` se não achar fontes confiáveis.
   - **Passo 2 — ESCREVER (sem busca):** compõe a narração no idioma-alvo usando **só** os fatos do passo 1 → não tem como alucinar. Regras fortes: 1ª palavra = nome do POI, escolhe **um** fio narrativo, escreve no script nativo do idioma, respeita limite de caracteres (ajustado por script: ~7 chars/s em CJK vs ~18 em latino/cirílico). Se `NONE` → **SAFE MODE**: texto genérico curto sem datas/números → marca `needs_review`.
4. **Tradução do nome do POI** — `translatePoiNameWithUsage` (exônimo estabelecido, senão transliteração; nunca inventa). Independente de gênero. Best-effort.
5. **Score heurístico** (`calculateHeuristicScore`) → grava em `last_score_overall`.
6. **Áudio (TTS)** → grava em `master_audio/{poi_id}/{poi_id}-{lang}-{gender}.mp3`.
7. **Grava** em `core.attraction_descriptions` e reconstrói o read-model `app_poi_read` (`rebuildReadModel`).

### Modelos Gemini (com fallback vivo)

| Passo | Modelos (em ordem) | Config |
|---|---|---|
| Retrieval (busca) | `gemini-2.5-flash` → `gemini-3.5-flash` | temp **0.0**, maxOutputTokens **2048**, tools: `google_search` (+ `url_context`), thinking baixo, todas as `safetySettings` em `BLOCK_NONE` |
| Compose (escrita) | `gemini-2.5-flash` → `gemini-3.1-flash-lite` | temp **0.7**, maxOutputTokens **4096**, thinking baixo |
| Tradução de nome | `gemini-2.5-flash-lite` → `gemini-3.1-flash-lite` | temp **0.1**, maxOutputTokens 1024 |
| Atalho de tradução (passo 2 acima) | `gemini-2.5-flash-lite` → `gemini-3.1-flash-lite` | temp **0.3**, maxOutputTokens 2048 |

**`thinkingConfig` por geração:** `gemini-3*` → `thinkingLevel: 'low'`; `gemini-2.5*` → `thinkingBudget: 0` (desligado, tarefa determinística). Sem isto, o thinking consome o orçamento de tokens e volta vazio (`MAX_TOKENS`).

### Armazenamento

- **Tabela:** `core.attraction_descriptions` — colunas: `description`, `facts_pack_json`, `audio_url`, `name` (nome traduzido, gender-independent), `verification_status` (`approved`/`needs_review`), `last_score_overall`, `grounded`, `generation_meta`, `input_tokens`/`output_tokens`/`llm_model` (telemetria), `generated_by_*`.
- **Áudio:** bucket `travel-app-audios`, path `master_audio/{poi_id}/{poi_id}-{lang}-{gender}.mp3`.
- **Invariante de áudio:** texto novo nunca fica pareado com áudio antigo — se não gerou áudio novo, o mp3 antigo é removido do storage (`audio_url null` ⟺ nenhum arquivo existe).

---

## 2. Narração Contextual (JIT) — ⛔ DESLIGADA

**Arquivos:** [supabase/functions/generate-contextual-narration/index.ts](../supabase/functions/generate-contextual-narration/index.ts) → [supabase/functions/_shared/contextualGenerator.ts](../supabase/functions/_shared/contextualGenerator.ts)

> ⚠️ **Estado atual:** a função tem uma feature flag hardcoded `isEnabled = false` ([index.ts:175](../supabase/functions/generate-contextual-narration/index.ts#L175)). Qualquer chamada é curto-circuitada **antes** de auth/rate-limit/modelo e retorna `503 SERVICE_UNAVAILABLE`. A única geração de texto/tradução ativa hoje é a do master. O código abaixo descreve o comportamento quando ligada.

É a narração "just-in-time" gerada em tempo de viagem: pega o master do POI-alvo e adiciona um **gancho navegacional** ("virando à direita você vê…", transição do POI anterior), adaptado à posição/rumo do usuário. **Não** faz busca/grounding nova — reaproveita a descrição+facts do master.

### Fluxo interno

1. Ações: `wake_up` (aquece a edge function), `generate_text`, `generate_audio`.
2. **Regras de corte:** sem `previous_poi` (primeiro POI da viagem) → aborta (app toca fallback estático). POI atrás do usuário (`direction bucket = behind`) → pula.
3. **Cache** em `core.cache_narrations` por `(cache_key, language)`. O `cache_key` (hash) é gerado pelo **app mobile** e é obrigatório. TTL 30 dias.
4. **Atalho de tradução:** se existe a mesma narração (mesmo `cache_key`) em outro idioma, traduz em vez de gerar (`translateNarrative`).
5. **Geração:** busca a descrição+facts do master (`attraction_descriptions`) para o POI-alvo e, se estiver a ≤ 800m, do POI anterior. Monta o script com `generateNarrativeScript`.
6. **Auto-heal:** se o master do POI-alvo não existe, dispara `generate-description` em background (`triggerMasterGeneration`) e retorna `BASE_CONTENT_MISSING`.
7. **Áudio (TTS)** → `contextual_audio/{poi_id}/{cache_key}_{lang}.mp3` (voz sempre `male`).

### Modelo Gemini

- **Modelo:** `gemini-3.1-flash-lite` (chamada única, sem fallback).
- **Config:** temp **0.8**, topP **0.95**, maxOutputTokens **200** (~30-50s falados), `thinkingBudget: 0` (senão o thinking consome os 200 tokens e volta vazio).
- **System instruction 100% estática** (persona TUGGI + regras) para maximizar cache implícito do Gemini entre requests; o `user prompt` carrega o dinâmico (facts, descrição, transição, posição relativa).
- **Contexto de entrada:** velocidade, heading, bearing/posição relativa (LEFT/RIGHT/AHEAD/BEHIND), POI anterior, candidatos a próximo POI, `travel_mode`, idioma.
- **Tradução** (quando reaproveita outro idioma): `gemini-2.5-flash-lite` → `gemini-3.1-flash-lite` (via `translateWithGemini`).

---

## 3. Tradução de descrição + áudio

**Arquivos:** [supabase/functions/generate-translated-audio/index.ts](../supabase/functions/generate-translated-audio/index.ts) → [supabase/functions/_shared/translationUtility.ts](../supabase/functions/_shared/translationUtility.ts)

Pega conteúdo já existente e produz a versão traduzida (texto + nome + áudio) num idioma-alvo. Três modos:

| Modo | Gatilho | O que faz | Grava em |
|---|---|---|---|
| **POI full** | `attractionId` | Traduz descrição (da versão mais recente em qualquer idioma) + nome + gera áudio | `core.attraction_descriptions` + `audio/{poi_id}/…` |
| **POI nameOnly** | `attractionId` + `nameOnly:true` | Só traduz o **nome** e carimba nas linhas existentes (backfill lazy de POIs legados). Sem áudio, sem reescrever descrição | `core.attraction_descriptions.name` |
| **Route** | `routeId` | Traduz nome + descrição da rota custom + áudio. Lock otimista via `status` (`generating`/`ready`/`failed`) | `core.custom_route_descriptions` + `route-audios/{route_id}/…` |

### Fluxo interno (POI full)

1. Busca a descrição-fonte mais recente (`getOriginalDescription`, ignora `[PROCESSING]`) — qualquer idioma.
2. Traduz descrição + nome **em paralelo** (`Promise.all`). Se a fonte já está no idioma-alvo, só o nome é (re)localizado. Nome sempre localizado (exônimo/transliteração).
3. Gera áudio (TTS) → upload.
4. Upsert em `attraction_descriptions` + `rebuildReadModel` (torna áudio/tradução visível ao disparo do app na hora).

### Modelos Gemini

- **Tradução de descrição/texto:** `gemini-2.5-flash-lite` → `gemini-3.1-flash-lite` (fallback). temp **0.3**, maxOutputTokens **2048** (folga p/ JP/Thai/Cirílico + thinking). Prompt preserva tom/carisma/direções espaciais e **exige script nativo** (sem romanização).
- **Tradução de nome:** `translatePoiNameWithUsage`, mesmos modelos, temp **0.1**, maxOutputTokens 1024. Prioridade: exônimo estabelecido → traduzir termo genérico + manter nome próprio → script nativo p/ línguas não-latinas.
- `getLanguageName` é o SSOT de nomes de idioma (com script explícito p/ CJK/Cirílico/Thai/Árabe), reusado por todos os prompts.

---

## Camada de TTS (compartilhada)

**Arquivo:** [supabase/functions/_shared/ttsGenerator.ts](../supabase/functions/_shared/ttsGenerator.ts) — `generateAudioWithTTS(text, language, gender, apiKey)`

Usada pelos **três** fluxos. **Google Cloud Text-to-Speech** (`texttospeech.googleapis.com/v1`).

- **Vozes:** mapa por idioma/gênero (13 idiomas). Neural2 na maioria; **WaveNet** onde não há Neural2 (Chinês `cmn-CN`, Russo `ru-RU`, Português-PT). Fallback = inglês Neural2.
- **SSML:** pausa inicial de 500ms (evita clip em Bluetooth) + pausa dramática de 300ms após o nome do POI (primeira pontuação).
- **AudioConfig:** `MP3` (32kbps fixo no Google v1), `speakingRate` **1.1** (mais claro p/ idosos/não-nativos/CJK), `effectsProfileId: ['large-automotive-class-device']` (perfil automotivo — Tuggi é guia de carro; normaliza loudness e ignora `volumeGainDb`), sample rate nativo da voz (24kHz).

---

## Notas / pegadinhas

- **Fallback de modelos é "vivo":** a lista `gemini-2.5-* → gemini-3.x-*` existe porque o 2.5 pode dar 404 de aposentadoria em rollout. Ordem importa (retrieval prefere 2.5-flash porque dispara o `google_search` de forma confiável; o 3.1-flash-lite **não** dispara em POIs obscuros).
- **Grounding é a espinha dorsal do master:** `grounded=false` (SAFE MODE) → `needs_review`. Tradução herda o grounding do master vetado.
- **Telemetria de tokens:** `input_tokens`/`output_tokens`/`llm_model`/`generation_kind` são gravados em UPDATEs separados e defensivos (não quebram se a migration não foi aplicada).
- **A narração contextual está desligada** — se o objetivo é "melhorar a narração em tempo real", primeiro é preciso religar a flag `isEnabled`.
