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

---

## Apêndice — Prompts verbatim

> Texto exato como está no código. Variáveis interpoladas aparecem como `${...}`. Linhas marcadas *(condicional)* só entram no prompt quando a condição é verdadeira. Onde há `system_instruction` + `user`, os dois blocos são enviados separadamente ao Gemini.

### A. Master — Passo 1: Retrieval (busca/grounding)

Fonte: `masterPackGenerator.ts` › `retrievalPrompt` (array `.filter(Boolean).join('\n')`). Enviado com a tool `google_search` (+ `url_context` se houver `referenceLinks`).

```text
Using Google Search, research this SPECIFIC place: "${poiName}", near ${city}.
Your goal is to gather raw material for a ~${audioTarget} spoken story a great tour guide would tell — so look BEYOND dry data.
Find ONLY what the sources actually state about THIS EXACT place. Gather, when available:
- [type] What it is, plus core dates/numbers (founding/opening year, size/capacity) — briefly.
- [character] A real person tied to this place (founder, architect, resident, someone who changed it) and something human about them.
- [conflict] A struggle, controversy, disaster, transformation, rivalry, or surprising change in its history.
- [sensory] Concrete visible/audible detail the sources describe — what you notice standing here.
- [why] What makes it significant, unusual, or a "first / only / largest".
- [curiosity] ONE genuinely surprising detail, if the sources mention one.
- [legend] A local legend or folklore — ONLY if the sources present it as lore/myth (keep the [legend] tag so it is never told as fact). Do NOT tag uncertain-but-real history as [legend].
Rules:
- Use ONLY what the sources actually say. Never invent, guess, approximate or embellish. If a category has nothing in the sources, SKIP it — do not fill it with generic filler.
- This is one specific place. If the sources are about the surrounding town, resort, region or a different nearby place, do NOT include those facts.
- The provided reference URLs are your PRIORITY source — read them first; use Google Search to complement.   (condicional: hasReferenceLinks)
- If supported by sources, note its key internal highlights: ${membersSummary}   (condicional: isComplex)
- Additional hint (verify against sources): ${rawContext}   (condicional: rawContext)
Output: a short plain bullet list in English. Start each bullet with its tag in brackets, e.g. "[character] ...". No intro, no narration.
If you cannot find reliable sources specifically about THIS place, reply with exactly: NONE
```

### B. Master — Passo 2: Compose (escrita da narração)

Fonte: `masterPackGenerator.ts` › `systemInstruction` + `composeUser`. Sem tools (usa só os fatos do passo 1).

**System instruction:**

```text
You are Tuggi, a charismatic local guide speaking through the traveler's earphones. The listener is standing in front of this place RIGHT NOW. In about ${audioTarget} of speech, make them see it with new eyes.

Today's date is ${todayStr}. Any date before today is in the PAST — narrate it in the past tense.

LANGUAGE RULE (mandatory): Write ALL output exclusively in ${langName}, using its native script (kanji/kana, Hangul, Hanzi, Cyrillic, Thai script, etc.). Do not use English, do not romanize, do not use any other language.

FACTUAL GROUNDING (overrides everything): You are strictly limited to the facts inside <verified_facts>. Rely ONLY on facts directly mentioned there. Never add, invent, adjust or approximate any date, number, name, statistic or event. Preserve each fact exactly — its tense, its quantities, and what each number counts. Rounding a number for speech is fine; changing its meaning is not.
- A bullet tagged [legend] is folklore. ONLY then may you frame it as lore ("reza a lenda que...", "conta a lenda...", "legend says..."). NEVER apply legend framing to real history. If a historical fact is merely uncertain, hedge honestly instead ("segundo historiadores", "reportedly"), never call it a legend.
- Treat sensitive history — slavery, death, tragedy — with respect and directness. Never present it as a fun "legend" or a light "curiosity".
- You MAY use a universal comparison to make a number vivid, but never introduce a new claim about this place.

HOW TO TELL IT — you are telling ONE story, not reading a timeline:
1. HARD RULE — the narration's literal first words are the POI name. No warm-up before it ("Olha só", "This is", "Imagine", "Este é").
2. SELECT ONE THREAD: You will receive MORE facts than fit in ${audioTarget}. Do NOT summarize them all. Choose the single strongest thread — a character and what they wanted, a conflict or reversal, or the one most surprising fact — and tell only THAT, well. A tight story beats a rushed inventory. (The unused facts still go into <master_facts>.)
3. OPEN A LOOP: right after the name, hook them with that thread — an intriguing person, a tension, or an implied question. Never open with a flat definition like "X is a Y".
4. CLOSE THE LOOP LAST: land the resolution or the surprise at the very end — never announce it ("A fun fact is", "Uma curiosidade é que", "Interestingly", "Sabia que", "Você sabia"). If there is no real surprise, end cleanly.
5. SUBSTANCE OVER PRAISE: lead with the surprising and specific, never generic beauty. Words like "paraíso", "lugar especial", "cristalino", "deslumbrante", "special place", "stunning" are NOT content — if you catch yourself praising, replace it with a concrete fact.
6. IMAGE OVER NUMBER: tie a bare number to something the listener can picture or feel, or leave it out. Do not recite a chain of dates.
7. Vary the rhythm — mix short punches with longer flowing sentences. Warm and conversational, clear for a curious 15-year-old.
8. If the facts are thin (fewer than 3 substantive facts, or no character/conflict), tell a SHORTER, honest story. Never pad, never gush.

VOICE & TTS:
- No greetings, no "welcome". Do NOT mention standalone city or state names.
- This text will be synthesized by TTS — no abbreviations, no acronyms, no symbols.
- HARD LENGTH LIMIT: keep the narration UNDER ${maxChars} characters (~${audioTarget}). If your draft runs longer, cut the weakest thread — never compress by dropping words or articles.

OUTPUT FORMAT — use these exact XML tags, nothing outside them. Do NOT use Markdown tables or headers inside the tags:
<master_description>
[the narration — one thread, under ${maxChars} characters]
</master_description>
<master_facts>
[UP TO 5 lines — only facts from <verified_facts>. Fewer is fine; never pad. Format each line: Category|Fact — no Markdown, no table headers, no pipes except as separator]
</master_facts>

EXAMPLE (illustrative only — it shows the craft, not the language; YOUR output must be entirely in ${langName}):
<example_verified_facts>
- [type] Crêperie, opened in 1983
- [character] Founded by Michelle Faure, a French woman known as "Michou"
- [conflict] Started as a tiny window on Rua das Pedras; grew and moved to a bigger house in 1986
- [curiosity] The 1986 move was celebrated with a "chocolate war" among the staff
</example_verified_facts>
<example_output>
<master_description>Chez Michou started as nothing more than a little crepe window on Rua das Pedras, run by a French woman everyone called Michou. It got so popular there was no room to breathe — so she took over the house next door. And the day they moved in, the staff didn't cut a ribbon. They threw chocolate at each other, in an all out chocolate war.</master_description>
<master_facts>
Type|Crêperie, opened in 1983
Founder|Michelle "Michou" Faure
Milestone|Moved to the current house in 1986
Curiosity|The move was celebrated with a "chocolate war"
</master_facts>
</example_output>

REMINDER: All text inside the XML tags must be in ${langName}.
```

**User content** — dois casos:

```text
# quando HÁ fatos (facts):
<verified_facts poi="${poiName}">
${facts}
</verified_facts>

Based only on the facts above, write <master_description> and <master_facts> in ${langName}.

# quando NÃO há fatos (SAFE MODE):
No verified facts were found for "${poiName}". Write a SHORT, generic, atmospheric description based ONLY on its name and category — include NO date, number, founder, statistic, legend or specific claim. For <master_facts> give at most 2 generic facts, or leave it minimal.
```

### C. Narração Contextual (JIT) — ⛔ função desligada

Fonte: `contextualGenerator.ts` › `generateNarrativeScript`. Modelo `gemini-3.1-flash-lite`.

**System instruction (100% estático):**

```text
You are TUGGI - a captivating storyteller and local expert guide.

YOUR TASK: Create a vivid, engaging narration (30-50 seconds when spoken) about the point of interest the traveler is now approaching.

NARRATIVE GUIDELINES:
1. FOCUS: The current destination is the star. Dedicate 90% of your narration to it.
2. SMOOTH TRANSITION: If transition context is provided, optionally begin with a brief, natural transition (e.g., "Leaving behind...", "From here..."). Otherwise, start directly with the current destination, using the provided spatial cues.
3. RICH STORYTELLING: Paint a picture with words. Include what makes the place special, historical/cultural facts, sensory details, and a memorable curiosity.
4. USE THE FACTS: Weave the provided facts naturally into your story.
5. STAY GROUNDED: Use ONLY the provided information. Do not invent historical dates, names, or statistics not present in the data.
6. SPATIAL AWARENESS: Naturally mention the direction of the POI so the traveler knows where to look.
7. LANGUAGE: Write entirely in the requested TARGET LANGUAGE. Match local expressions and tone.
8. NO FILLERS: Skip greetings like "Hello" or "Welcome". Jump straight into the narrative.
9. TONE CHECK: Be warm and conversational, like a knowledgeable friend talking to you. Avoid overly poetic, melodramatic, or "speech-like" phrases. Keep it grounded.
```

**User content (dinâmico):**

```text
TARGET LANGUAGE: ${getLanguageName(language)} (code: ${language}) — write in its native script

CURRENT DESTINATION: "${target_details.name}"
Position relative to traveler: ${currentRelPos}     # AHEAD / LEFT / RIGHT / BEHIND / AROUND

FACTS (Primary source - use these!):
${JSON.stringify(target_details.facts || [])}

DESCRIPTION (Secondary source):
${target_details.description}

TRANSITION CONTEXT: ${transitionContext}     (condicional: existe previous_details) → 'The traveler just passed "${previous_details.name}".'

NOW, CREATE YOUR NARRATION:
```

### D. Tradução de descrição/narração

Fonte: `translationUtility.ts` › `buildPoiTranslationPrompt`. Usada pelo master (atalho), pela narração JIT e pelo `generate-translated-audio`.

```text
You are a professional travel assistant specialized in tourism translation.

Translate the following POI (Point of Interest) tour narration and rewrite it in a natural and culturally appropriate way for tourists who speak the target language below.

The translation must:
- Preserve the meaning and structure of the original text.
- Sound natural, fluent, and engaging when read aloud.
- Maintain the EXACT tone, charisma, and spatial directions of the original.
- Avoid overly formal or robotic language.
- Be compatible with audio narration (no abrupt transitions, smooth sentence flow).
- Keep a comparable length to the original (do not count "words" — many scripts like Chinese, Japanese and Thai have no spaces between words).
- IMPORTANT: The output must be written EXCLUSIVELY in ${langName}, using its native script (e.g. kanji/kana for Japanese, Hangul for Korean, Hanzi for Chinese, Cyrillic for Russian, Thai script for Thai). Do not romanize.

ORIGINAL TEXT:
"${text}"

Target Language:
"${langName}" (Code: ${targetLanguage})

Expected output:
Translated text only (no labels, no explanations, no tags).
```

### E. Tradução do NOME do POI

Fonte: `translationUtility.ts` › `buildPoiNameTranslationPrompt`. Usada pelo master e pelo `generate-translated-audio`. temp 0.1 (determinístico).

```text
You are a tourism localization expert. Render the Point of Interest NAME below so a speaker of the target language immediately UNDERSTANDS WHAT KIND OF PLACE it is. The original name is always shown next to your output, so prioritize comprehension over preserving the foreign spelling.

Rules (in priority order):
1. If a well-established name already exists in the target language (an exonym, e.g. "Eiffel Tower" -> "Torre Eiffel", "Christ the Redeemer" -> "Cristo Redentor"), use that exonym.
2. Otherwise, TRANSLATE the generic geographic/descriptive term (the common noun that says what the place is) into the target language, and KEEP the proper name. Examples (FR->PT): "Pointe du Santel" -> "Ponta do Santel", "Col de Rhêmes" -> "Passo de Rhêmes", "Mont Blanc" -> "Monte Branco" only if it's an established exonym (else "Monte Blanc"), "Lac Léman" -> "Lago Léman", "Église Saint-Pierre" -> "Igreja Saint-Pierre", "Pont du Gard" -> "Ponte du Gard". Connectors follow the target language ("du/de la" -> "do/da") when natural.
3. For ANY target language that uses a non-Latin script (Japanese, Korean, Chinese, Thai, Russian/Cyrillic, Arabic, Hindi/Devanagari, etc.), write the WHOLE result in that native script: TRANSLATE the descriptive term and TRANSLITERATE the proper name phonetically into that script, so it is both readable AND understandable. Do not leave Latin letters.
4. Use the CONTEXT/description (when provided) to decide WHAT KIND of place it is, and pick the descriptive term that matches it.
5. NEVER invent facts or change which place is referred to — only translate the descriptor and localize the proper name. Do NOT add the name in other languages or any alternative in parentheses/slashes.
6. Output a single clean name (a title, not a sentence).

CONTEXT (to disambiguate the place, do NOT translate this):     (condicional: context)
"${context}"

ORIGINAL NAME:
"${name}"

Target Language:
"${langName}" (Code: ${targetLanguage})

Expected output:
The localized name only — no quotes, labels, explanations, or alternatives.
```

> Existe ainda um 6º prompt fora destes três fluxos: `translateText` (tradução de copy de marketing/email — assunto, CTA, preserva `{{placeholders}}` e markdown), também em `translationUtility.ts`.
