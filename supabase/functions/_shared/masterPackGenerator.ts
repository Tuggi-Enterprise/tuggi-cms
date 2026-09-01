// _shared/masterPackGenerator.ts

// DRY: SSOT de nomes de idioma (cobre Ásia/Rússia/Tailândia com script).
import { getLanguageName } from './translationUtility.ts';

export interface GeminiUsage {
    input_tokens: number;
    output_tokens: number;
    model: string;
}

/**
 * Speech characters per second, by script. Latin/Cyrillic run ~18, but in CJK (ja/ko/zh) each
 * character carries a syllable or a word, so 18 would produce audio 2–3× longer than the target.
 * Exported because the partner generator aims at the same wall from a different prompt, and two
 * copies of this number is how one of them starts producing 30s "15s" audio.
 */
export const charsPerSecondFor = (language: string): number =>
    /^(ja|ko|zh|cmn|yue)(-|$)/.test(language.toLowerCase()) ? 7 : 18;

/**
 * REFUSAL DETECTION — #651.
 *
 * WHY THIS EXISTS. Step 1 asks the model to answer `NONE` when it finds nothing, and the loop
 * tested `txt.toUpperCase() !== 'NONE'`. When the model refuses in PROSE instead — "Não foi
 * possível encontrar informações sobre…" — that equality passes, the refusal becomes
 * `<verified_facts>`, and step 2 narrates the refusal to a tourist standing in front of the place.
 * Measured on 2026-09-01, before this fix: 126 rows of `core.attraction_descriptions` opened with a
 * refusal, ALL 126 with a synthesized mp3 and ALL 126 reachable by the app.
 *
 * TWO SIGNALS, ON PURPOSE.
 * - STRONG lead: a first-person apology or inability. A tour narration never opens like this — the
 *   HARD RULE of the compose prompt is that the literal first words are the POI name — so the lead
 *   alone is enough.
 * - WEAK lead ("unfortunately", "não foi possível", "there is no"): only a refusal when a META word
 *   (information / sources / search results / find / identify …) shows up near it. Alone it could
 *   open a legitimate sentence ("Não foi possível terminar a torre em pedra…").
 *
 * SECOND PASS, 2026-09-01 (BR-CONTEUDO-008 item 1). A count over the live catalogue found 92
 * published descriptions opening with a refusal — whole languages were walking through: German and
 * Italian had no impersonal form, and the plain statement of absence WITHOUT an apology
 * ("no se dispone de", "es gibt keine Informationen") had no entry at all. What entered was
 * vocabulary only: first-person inability goes to STRONG, impersonal absence goes to WEAK and still
 * needs a META word beside it.
 *
 * WHAT DID NOT CHANGE, ON PURPOSE: the OPENING anchor. `LEAD_PREFIX` was suspected of breaking on a
 * POI name that carries quotes ('Geoffrey C. "Grof" Goodfellow Sesquicentennial Park. Unfortunately,
 * I cannot find…'); measured against this module, it matches — the prefix is `[^\n]{0,80}?`, it
 * never looked at quotes. Loosening the separator to `,`/`:`/`-` would buy nothing here and would
 * start matching legitimate narration ("Museu do Ipiranga: não há informações sobre o autor do
 * afresco"). A false positive costs a good narration and leaves the POI mute, so the tie is broken
 * towards catching less. The refusal buried in the SECOND sentence stays out of reach by design.
 *
 * KNOWN LIMIT, stated instead of hidden: the vocabulary covers pt/en/es/fr/it/de. A refusal written
 * in Japanese, Korean, Chinese, Russian or Thai passes this net. It is not the main line of defence
 * — `retrievalLooksUsable` is, and it works on the step 1 output, which is always English by prompt.
 */
const STRONG_REFUSAL_LEAD = [
    // English
    "i(?:'|’)?m sorry", "i am sorry", "sorry[,!]? (?:but|i)", "i(?:'|’)?m (?:un)?able to",
    "i am (?:un)?able to", "i can ?not", "i can(?:'|’)t", "i could ?n(?:'|’)?o?t find",
    "i could not find", "i do(?: |)not have", "i don(?:'|’)t have", "as an ai",
    // Portuguese
    "desculpe", "sinto muito", "n[aã]o posso", "n[aã]o consigo", "n[aã]o encontrei",
    // Spanish
    "lo siento", "no puedo", "no he podido", "no encontr[eé]",
    // French
    "d[eé]sol[eé]", "je ne (?:peux|puis) pas", "je n(?:'|’)ai pas",
    // Italian
    "mi dispiace", "non posso", "non sono riuscito", "non ho (?:trovato|informazioni)",
    // German
    "es tut mir leid", "ich (?:kann|konnte|k[oö]nnte) (?:kein|nicht|leider|ihnen)",
];
const WEAK_REFUSAL_LEAD = [
    "unfortunately", "infelizmente", "lamentablemente", "desafortunadamente", "malheureusement",
    "leider", "n[aã]o (?:foi|é|e) poss[ií]vel", "no (?:fue|es) posible",
    "il n(?:'|’)est pas possible", "il n(?:'|’)y a (?:pas|aucun)", "non (?:è|e) possibile",
    "es (?:war|ist) nicht m[oö]glich",
    "there (?:is|are) no", "no (?:reliable|verified|specific)", "n[aã]o h[aá]", "no hay",
    "n[aã]o (?:existe|existem)", "no se dispone de", "es gibt kein",
];
const REFUSAL_META =
    "informa(?:tion|ç|c|ci|zio)|dados|datos|donn[eé]es|daten|sources?|fontes|fuentes|quellen|" +
    "search results|resultados|r[eé]sultats|risultati|suchergebnisse|encontr|find |finding|trouv|" +
    "finden|identific|identify|determin|facts|fatos|hechos|fatti|request|solicita|verified|verific|" +
    "confi[aá]ve|fiable|reliable|espec[ií]fic|specific|sp[eé]cifique|enough|suficiente";

// Um prefixo curto antes da recusa é comum e não a descaracteriza: o modelo escreve o nome do POI,
// pontua, e só então se desculpa ("Ponderosa Woods... I'm unable to find…").
const LEAD_PREFIX = "^\\s*(?:[^\\n]{0,80}?(?:[.!?…]+|\\n)\\s*)?";
const STRONG_RE = new RegExp(LEAD_PREFIX + "(?:" + STRONG_REFUSAL_LEAD.join("|") + ")", "i");
const WEAK_RE = new RegExp(LEAD_PREFIX + "(?:" + WEAK_REFUSAL_LEAD.join("|") + ")", "i");
const META_RE = new RegExp(REFUSAL_META, "i");

/**
 * O texto é uma recusa do modelo ("não achei / não posso"), em vez do conteúdo pedido?
 * Vale para as duas pontas: a saída do passo 1 e a narração do passo 2.
 */
export const isRefusalText = (text: string): boolean => {
    const t = (text || '').trim();
    if (!t) return false;
    if (/^none[.!…]*$/i.test(t)) return true;
    const head = t.slice(0, 260);
    if (STRONG_RE.test(head)) return true;
    return WEAK_RE.test(head) && META_RE.test(head);
};

/** As etiquetas que o prompt de retrieval manda abrir cada bullet. É o contrato da saída. */
export const FACT_BULLET_TAGS = ['type', 'character', 'conflict', 'sensory', 'why', 'curiosity', 'legend', 'area'] as const;
const TAGGED_BULLET_RE = new RegExp("^\\s*[-*•]?\\s*\\[(?:" + FACT_BULLET_TAGS.join('|') + ")\\]", 'i');
const ANY_BULLET_RE = /^\s*[-*•]\s+\S/;
const AREA_BULLET_RE = /^\s*[-*•]?\s*\[area\]/i;

/**
 * WHERE THE HARVESTED MATERIAL CAME FROM — #653.
 *
 * `place`: every bullet is about the POI itself, which is how step 1 always worked.
 * `area`:  EVERY bullet is `[area]` — surroundings only (street, neighbourhood, town, trade). The
 *          narration is honest, but it is not sustained by a fact about this place.
 * `mixed`: both.
 *
 * WHY IT IS A RETURNED FIELD AND NOT A GUESS DOWNSTREAM. Loosening the retrieval radius is what
 * makes an obscure POI narratable instead of falling into SAFE MODE, but it also makes two very
 * different kinds of content look identical in `core.attraction_descriptions` — and one of them
 * is what BR-CONTEUDO-008 item 4 says does not sustain a description. Keeping the provenance in
 * `generation_meta.fact_scope` is what lets that population be counted, filtered or reverted
 * later; without it the loosening is irreversible in practice.
 */
export type FactScope = 'place' | 'area' | 'mixed';

/** Derived from the step 1 output, never from the narration: the harvest is the only place where
 *  provenance is still explicit. Returns `undefined` when there was no harvest at all (SAFE MODE). */
export const scopeOfFacts = (facts: string | null | undefined): FactScope | undefined => {
    const lines = (facts || '').split('\n').filter((l) => TAGGED_BULLET_RE.test(l) || ANY_BULLET_RE.test(l));
    if (lines.length === 0) return undefined;
    const area = lines.filter((l) => AREA_BULLET_RE.test(l)).length;
    if (area === 0) return 'place';
    return area === lines.length ? 'area' : 'mixed';
};

/**
 * THE WIDENED RADIUS — #653. One text, used by the POI branch and by the establishment branch,
 * because two copies of an editorial boundary is how one of them quietly stops matching the
 * compose prompt that has to honour it.
 *
 * WHAT IT BUYS. In August/2026, 17.8% of 11,227 generations paid the grounding toll twice because
 * step 1 answered NONE, and 799 of those ended in SAFE MODE — generic text, `needs_review`, not
 * publishable. Most of the catalogue is an obscure POI with no source about itself, and the old
 * rule threw away material that makes an honest, interesting narration.
 *
 * WHAT IT DOES NOT BUY. The radius of the acceptable SOURCE widened; the licence to invent did
 * not. An `[area]` fact stays attributed to the area — moving it onto the POI is the false
 * statement BR-CONTEUDO-008 item 4 names, and it is forbidden here and again at compose time.
 *
 * AND IT DOES NOT BUY THE GENERIC BACK. BR-CONTEUDO-008 item 5 applies the substitute test to the
 * area itself: swap the street, the neighbourhood or the town and the sentence has to stop being
 * true. Without that condition the harvest accepts "this neighbourhood is known for its
 * restaurants" — the atmospheric generic of item 2 wearing context as a costume, and the only way
 * the widened radius could hand the acervo back the problem it came to solve. The gate is here, at
 * harvest, because what is not gathered cannot be narrated.
 */
const AREA_BULLET_INSTRUCTION =
    `- [area] Context about WHERE THIS STANDS, when the place itself is thinly documented: its street, ` +
    `its neighbourhood, when and why this part of town was built, what this kind of place has meant here, ` +
    `what the surrounding town is known for. Tag EVERY such bullet [area] — the tag is what keeps it ` +
    `honest downstream. Each [area] bullet must be SPECIFIC to that street, neighbourhood or town: ` +
    `swap it for another street, another neighbourhood or another town and the sentence must STOP ` +
    `being true. "This neighbourhood is known for its restaurants" stays true almost anywhere — drop ` +
    `it; "the street it stands on was the town's first paved road, in 1890" does not — keep it. ` +
    `It is context, never a fact about this place: an [area] date, number, person or ` +
    `event belongs to the street or the town, and must never be restated as this place's own.`;

export interface RetrievalVerdict {
    usable: boolean;
    /** Por que foi recusada — vai para o log, e é o que permite medir a taxa depois do deploy. */
    reason: 'ok' | 'empty' | 'none' | 'refusal' | 'no_bullets';
    taggedBullets: number;
}

/**
 * O portão do passo 1. Endurece o contrato que o prompt já pede — bullets etiquetados — em vez de
 * confiar numa igualdade de string com `NONE`.
 *
 * A assimetria é deliberada. Falso negativo custa uma tentativa no segundo modelo, que é
 * exatamente o que o `NONE` já fazia. Falso positivo custa uma recusa narrada para o turista, com
 * mp3 pago. Na dúvida, recusa.
 */
export const judgeRetrievalOutput = (text: string): RetrievalVerdict => {
    const t = (text || '').trim();
    if (!t) return { usable: false, reason: 'empty', taggedBullets: 0 };
    const lines = t.split('\n');
    const tagged = lines.filter((l) => TAGGED_BULLET_RE.test(l)).length;
    const bullets = lines.filter((l) => ANY_BULLET_RE.test(l)).length;
    if (/^none[.!…]*$/i.test(t)) return { usable: false, reason: 'none', taggedBullets: tagged };
    if (isRefusalText(t)) return { usable: false, reason: 'refusal', taggedBullets: tagged };
    if (tagged < 1 && bullets < 2) return { usable: false, reason: 'no_bullets', taggedBullets: tagged };
    return { usable: true, reason: 'ok', taggedBullets: tagged };
};

export interface ParsedNarration {
    description: string;
    facts_pack_json: { category: string; text: string }[];
}

/**
 * The `<master_description>` / `<master_facts>` envelope, unwrapped — with the line-based fallback
 * for when the model answers without the tags.
 *
 * Extracted so `partnerPackGenerator` shares it: the two prompts ask for the SAME output format on
 * purpose, so that `generate-description` stores, scores and audits both the same way. Returns
 * `null` when no narration could be recovered, which is the caller's signal to try the next model.
 */
export const parseNarrationOutput = (rawText: string): ParsedNarration | null => {
    const descMatch = rawText.match(/<master_description>([\s\S]*?)<\/master_description>/i);
    const factsMatch = rawText.match(/<master_facts>([\s\S]*?)<\/master_facts>/i);
    const isFactLine = (line: string) => { const t = line.trim(); return t.includes('|') && t.length < 200 && !t.startsWith('<'); };

    let description = descMatch ? descMatch[1].trim() : '';
    let rawFactsText = factsMatch ? factsMatch[1].trim() : '';
    if (!description) {
        const lines = rawText.split('\n').map((l: string) => l.trim()).filter((l: string) => l.length > 0);
        const descLines: string[] = []; const factLines: string[] = [];
        for (const line of lines) {
            if (isFactLine(line)) factLines.push(line);
            else if (factLines.length === 0) descLines.push(line);
        }
        description = descLines.join(' ').trim();
        if (!rawFactsText && factLines.length > 0) rawFactsText = factLines.join('\n');
    }
    if (!description) return null;

    const facts_pack_json = (rawFactsText ? rawFactsText.split('\n') : []).map((line: string) => {
        const [category, ...textParts] = line.split('|');
        return {
            category: (category || 'history').trim().toLowerCase().replace(/[^a-z]/g, ''),
            text: textParts.join('|').trim().replace(/\[cite: \d+\]/g, '').replace(/\[\d+\]/g, ''),
        };
    }).filter((f: any) => f.text.length > 5);

    return {
        description: description
            .replace(/<\/?master_[a-z_]*>/gi, '')
            .replace(/\[cite: \d+\]/g, '')
            .replace(/\[\d+\]/g, '')
            .trim(),
        facts_pack_json,
    };
};

interface MasterPackResult {
    description: string;
    facts_pack_json: any;
    usage: GeminiUsage | null;
    // grounded=true: passo 1 buscou e achou fontes reais (groundingChunks) → approved.
    // grounded=false: nenhuma fonte (NONE) → SAFE MODE genérico → needs_review.
    grounded?: boolean;
    sourceCount?: number;
    /** #652 — search queries que o passo 1 EXECUTOU, somadas todas as tentativas de retrieval.
     *  Não é o mesmo que `sourceCount` (fontes devolvidas) nem que `retrievalAttempts`
     *  (chamadas feitas): é a unidade que a família 3.x cobra, US$ 14 por 1.000. Sem este
     *  número a fatura de setembro/2026 diz o total e não diz queries/prompt, que é o que
     *  decide a família em outubro — ponto de equilíbrio em ~2,95. */
    searchQueryCount?: number;
    /** #652 — quantas chamadas de retrieval rodaram (1, ou 2 quando o fallback disparou). É o
     *  denominador de `searchQueryCount`: sem ele, duas tentativas parecem um prompt caro. */
    retrievalAttempts?: number;
    /** #653 — provenance of the harvested facts. `undefined` when nothing was harvested (SAFE
     *  MODE), which `grounded === false` already reports. See `FactScope`. */
    factScope?: FactScope;
    modelUsed?: string;
    /** Latência por etapa, em ms. Quem consome é o orquestrador, que soma TTS e gravação e emite
     *  uma linha só — sem isto, "a geração está lenta" não tem onde ser medida. */
    timings?: MasterPackTimings;
}

export interface MasterPackTimings {
    /** Uma entrada por chamada de retrieval TENTADA, na ordem. Duas entradas = o primeiro modelo
     *  não serviu, e o custo disso é visível. */
    retrieve: { model: string; ms: number; verdict: string }[];
    retrieveMs: number;
    compose: { model: string; ms: number }[];
    composeMs: number;
    totalMs: number;
}

// thinking baixo (tarefas determinísticas): gemini-3* → thinkingLevel low; 2.5* → off.
const buildThinkingConfig = (model: string): Record<string, unknown> | undefined => {
    const m = model.toLowerCase();
    if (m.startsWith('gemini-3')) return { thinkingLevel: 'low' };
    if (m.startsWith('gemini-2.5')) return { thinkingBudget: 0 };
    return undefined;
};

export interface GeminiCallResult {
    ok: boolean;
    error?: string;
    finishReason?: string | null;
    rawText?: string;
    gm?: any;
    usage?: GeminiUsage;
    /** Tempo de parede da chamada, em ms. Medido aqui porque é aqui que a chamada existe:
     *  qualquer cronômetro do lado de fora mede também o que o chamador fez no meio. */
    elapsedMs?: number;
}

// Uma chamada generateContent crua, com tratamento de erro/finishReason.
export const callGemini = async (model: string, fetchBody: any, apiKey: string): Promise<GeminiCallResult> => {
    const startedAt = Date.now();
    try {
        const r = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
            { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fetchBody) },
        );
        if (!r.ok) {
            const ed = await r.json().catch(() => ({ error: { message: r.statusText } }));
            return { ok: false, error: `HTTP ${r.status} ${ed?.error?.message || r.statusText}`, elapsedMs: Date.now() - startedAt };
        }
        const data = await r.json();
        if (data.error) return { ok: false, error: data.error.message, elapsedMs: Date.now() - startedAt };
        const cand = data.candidates?.[0];
        const rawText = (cand?.content?.parts || []).map((p: any) => p.text || '').join('');
        const um = data.usageMetadata || {};
        return {
            ok: true,
            finishReason: cand?.finishReason ?? null,
            rawText,
            gm: cand?.groundingMetadata,
            usage: { input_tokens: um.promptTokenCount ?? 0, output_tokens: um.candidatesTokenCount ?? 0, model },
            elapsedMs: Date.now() - startedAt,
        };
    } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e), elapsedMs: Date.now() - startedAt };
    }
};

/**
 * Master Content Generator — pipeline RAG de 2 passos (grounding garantido).
 *
 * O google_search do Gemini é DISCRICIONÁRIO e não dispara num prompt de "escreva
 * uma narração" (o modelo responde de memória → alucina/confunde). Comprovado por
 * diagnóstico direto. Solução:
 *   PASSO 1 (BUSCAR): prompt de LOOKUP factual → o modelo SEMPRE busca → fatos
 *           verificados + fontes reais (ou "NONE").
 *   PASSO 2 (ESCREVER): compõe a narração no idioma/formato usando SÓ os fatos do
 *           passo 1 (sem busca) → não tem como alucinar. Se NONE → genérico curto.
 *
 * CUSTO DO PASSO 1 — o grounding NÃO é grátis (#652). A franquia de 1.500 buscas/dia é do
 * tier gratuito e este projeto é pago; enquanto o comentário antigo dizia "grátis", o
 * pedágio virou 94% da conta de Gemini de agosto/2026 (11.193 chamadas, ~US$ 392, contra
 * ~US$ 29 de token de geração no mês inteiro). Doc oficial, conferida em 2026-09-01:
 *   - Gemini 2.5: US$ 35 por 1.000 PROMPTS com a tool ligada.
 *   - Gemini 3.x: US$ 14 por 1.000 SEARCH QUERIES executadas, 5.000 grátis/mês
 *     compartilhadas pela família. Quantas o modelo executa por prompt é DECISÃO DELE — a
 *     doc não expõe teto (não há max_searches nem search_budget), então o número se mede,
 *     não se configura. Equilíbrio entre as duas cobranças: ~2,95 queries por prompt.
 * O passo 2 não usa a tool e por isso não paga pedágio nenhum — só token.
 */
/**
 * Contexto de TIPO da entidade narrada.
 *
 * core.attractions guarda POI, evento e local na mesma tabela (entity_kind), e
 * até aqui o gerador tratava os três como "lugar": o prompt pede ano de fundação,
 * fala em "standing in front of this place" e busca história. Isso é certo para
 * um POI e errado para um show que acontece em três semanas ou para um hotel.
 *
 * `kind: 'poi'` (o default) e `kind: 'place'` compartilham a régua de escopo; o ramo
 * de evento tem a sua, mais estreita de propósito — uma edição não se confunde com
 * outra, e o entorno de um festival não explica o festival (#653).
 */
export type EntityContext = {
    kind: 'poi' | 'event' | 'place';
    startsAt?: string | null;   // evento: ISO
    endsAt?: string | null;     // evento: ISO
    category?: string | null;   // evento: music, sports, festival…
    placeType?: string | null;  // local: hotel, restaurant, guesthouse…
    // evento vinculado a um POI anfitrião (cenário 1): compõe "POI + evento
    // contextual". `facts` = narração JÁ existente do POI, usada como contexto
    // (sem re-pesquisar). Só definido para eventos vinculados; ausente = comportamento
    // de sempre, byte a byte.
    venue?: { name: string; facts?: string | null } | null;
};

export const generateMasterPack = async (
    poiName: string,
    // #654 — cidade + estado + país do POI, já montado pelo chamador (não é só a cidade,
    // apesar do que o nome antigo `city` dizia). É o que faz a busca do passo 1 achar ESTE
    // "Fonte da Juventude" e não um homônimo a mil quilômetros. Pode vir só com a cidade,
    // ou com "an unknown location" quando não há nada.
    locationContext: string,
    rawContext: string,
    language: string,
    apiKey: string,
    poiData: any = {},
    audioDuration: number = 25,
    memberPois: any[] = [],
    referenceLinks: string[] = [], // Links de referência do CMS (Wikipedia, sites oficiais, etc.)
    entity: EntityContext = { kind: 'poi' }
): Promise<MasterPackResult> => {

    const audioTarget = `${audioDuration}s`;
    // Chars per second of speech vary a lot by script — see `charsPerSecondFor`, which the
    // partner generator shares.
    const maxChars = Math.floor(audioDuration * charsPerSecondFor(language));
    const langName = getLanguageName(language);

    const isComplex = memberPois && memberPois.length > 0;
    const membersSummary = isComplex
        ? memberPois.map(p => `- ${p.name} (${p.category || p.type || 'highlight'})`).join('\n')
        : '';
    const hasReferenceLinks = referenceLinks && referenceLinks.length > 0;

    const attempts: string[] = [];
    let step1Usage: GeminiUsage | null = null;
    let step2Usage: GeminiUsage | null = null;

    // ─────────────────────────────────────────────────────────────────────────
    // PASSO 1 — BUSCAR (grounded). Framing de LOOKUP força a busca de verdade.
    // ─────────────────────────────────────────────────────────────────────────
    // Lista de compras EXPANDIDA: além de datas, busca personagem/conflito/sensorial/
    // por-que-importa/curiosidade/lenda — a matéria-prima de uma HISTÓRIA, não de um
    // almanaque. Continua 100% grounded (só o que as fontes dizem). Bullets etiquetados
    // por tipo p/ o compose escolher o melhor fio.
    // ── Ramos por tipo de entidade ────────────────────────────────────────────
    // #653 — POI e local passaram a aceitar material do entorno, sempre etiquetado [area].
    // Evento não: o ramo dele continua palavra por palavra como era.
    const isEvent = entity.kind === 'event';
    const isPlace = entity.kind === 'place';
    // Evento COM POI anfitrião. Gate de tudo que é do cenário 1 — nulo para POI,
    // local e evento-sem-vínculo, então esses caminhos ficam idênticos.
    const venue = isEvent && entity.venue && entity.venue.name ? entity.venue : null;

    const fmtDate = (iso?: string | null): string | null => {
        if (!iso) return null;
        const d = new Date(iso);
        return isNaN(d.getTime())
            ? null
            : d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    };
    const eventStart = fmtDate(entity.startsAt);
    const eventEnd = fmtDate(entity.endsAt);
    const eventWhen = eventStart
        ? (eventEnd && eventEnd !== eventStart ? `${eventStart} to ${eventEnd}` : eventStart)
        : null;

    // #654 — o lugar é `in`, não `near`: `locationContext` é a cidade DO PRÓPRIO POI
    // (`attractions.city`, com fallback para `osm_tags["addr:city"]`), não a cidade mais
    // próxima. `near` afrouxava a busca sem ser mais honesto — e é justamente o afrouxamento
    // que traz o homônimo de outra cidade. O evento continua `held near`: a sede fica na
    // cidade, a edição nem sempre.
    const subjectLine = isEvent
        ? `Using Google Search, research this SPECIFIC event: "${poiName}", held near ${locationContext}${eventWhen ? `, scheduled for ${eventWhen}` : ''}${entity.category ? ` (category: ${entity.category})` : ''}.`
        : isPlace
            ? `Using Google Search, research this SPECIFIC establishment: "${poiName}", in ${locationContext}${entity.placeType ? ` (a ${entity.placeType})` : ''}.`
            : `Using Google Search, research this SPECIFIC place: "${poiName}", in ${locationContext}.`;

    // O que colher muda com o tipo: um evento não tem "ano de fundação", e um
    // hotel não tem "história de conflito" — insistir nisso empurra o modelo a
    // inventar. Cada ramo pede o que realmente existe para aquele tipo.
    const gatherBullets = isEvent
        ? [
            `Find ONLY what the sources actually state about THIS EXACT event. Gather, when available:`,
            `- [type] What the event is, its edition/number, and how long it has existed.`,
            `- [character] A real person tied to it (founder, organizer, headline performer, a recurring figure) and something human about them.`,
            `- [conflict] A memorable edition, a turning point, a controversy, a year it nearly did not happen.`,
            `- [sensory] What the event actually looks/sounds/smells like according to the sources.`,
            `- [why] Why it matters to this city — scale, tradition, what it is known for.`,
            `- [curiosity] ONE genuinely surprising detail about the event, if the sources mention one.`,
        ]
        : isPlace
            ? [
                `Find ONLY what the sources actually state. Aim at THIS EXACT establishment first; when it is thinly documented, widen to where it stands (see [area]). Gather, when available:`,
                `- [type] What it is, when it opened, and what it is known for.`,
                `- [character] A real person tied to it (founder, chef, owner, a notable guest) and something human about them.`,
                `- [conflict] A transformation, a reinvention, a hard period, a change of hands.`,
                `- [sensory] Concrete visible/audible detail the sources describe — what you notice on arriving.`,
                `- [why] What sets it apart from others of its kind nearby.`,
                `- [curiosity] ONE genuinely surprising detail, if the sources mention one.`,
                AREA_BULLET_INSTRUCTION,
            ]
            : [
                `Find ONLY what the sources actually state. Aim at THIS EXACT place first; when it is thinly documented, widen to where it stands (see [area]). Gather, when available:`,
                `- [type] What it is, plus core dates/numbers (founding/opening year, size/capacity) — briefly.`,
                `- [character] A real person tied to this place (founder, architect, resident, someone who changed it) and something human about them.`,
                `- [conflict] A struggle, controversy, disaster, transformation, rivalry, or surprising change in its history.`,
                `- [sensory] Concrete visible/audible detail the sources describe — what you notice standing here.`,
                `- [why] What makes it significant, unusual, or a "first / only / largest".`,
                `- [curiosity] ONE genuinely surprising detail, if the sources mention one.`,
                AREA_BULLET_INSTRUCTION,
            ];

    const retrievalPrompt = [
        subjectLine,
        `Your goal is to gather raw material for a ~${audioTarget} spoken story a great tour guide would tell — so look BEYOND dry data. A great guide standing in front of an ordinary building does not go silent: they tell you about the street, the trade, the decade it belongs to. Be generous about what counts as usable material, and strict about what is true.`,
        ...gatherBullets,
        `- [legend] A local legend or folklore — ONLY if the sources present it as lore/myth (keep the [legend] tag so it is never told as fact). Do NOT tag uncertain-but-real history as [legend].`,
        `Rules:`,
        `- Use ONLY what the sources actually say. Never invent, guess, approximate or embellish. If a category has nothing in the sources, SKIP it — do not fill it with generic filler.`,
        // #651 — uma das narrações citou "uma publicação no Facebook de Julie Pruitt": pessoa
        // privada, nome real, numa descrição turística. O corte é na COLHEITA, porque o que não
        // for colhido não pode ser narrado.
        `- PEOPLE: name a person ONLY if they are a public or historical figure tied to this place by a role — founder, architect, chef, recognized owner, artist, ruler, a documented historical figure. NEVER name a private individual. A social-media post, a user review, a personal blog or an individual profile is NOT a source for a person's name: if a name appears only there, drop the name and the fact with it. Never cite the platform as the source ("according to a Facebook post by ...").`,
        // #651 — ao descrever uma prefeitura, a narração afirmou que o prefeito está sendo
        // investigado por corrupção. Afirmação sobre pessoa viva num produto de turismo.
        `- OUT OF SCOPE, always: party politics, elections, the current holder of any elected or appointed office, investigations, lawsuits, criminal charges, corruption allegations, scandals and recent crime. Do not gather them even if the sources lead with them. Research a public building for what it IS — architecture, founding, function, what you see from here — never for who occupies it today. Consolidated, distant political history (it was a seat of government; a treaty was signed here) IS in scope.`,
        isEvent
            ? `- This is one specific event. If the sources are about the venue, the city, or a different event, do NOT include those facts. Do not confuse this edition with other editions unless the source ties them together.`
            // #653 — era uma proibição inteira ("do NOT include those facts"), e é ela que
            // devolvia NONE para o POI obscuro. O que continua proibido é a CONFUSÃO — outro
            // lugar, ou o entorno vestido de fato daqui.
            : `- SCOPE: a source about a DIFFERENT place — a similar name elsewhere, another landmark nearby — is wrong material: drop it. A source about the SURROUNDINGS of this place is usable, and goes in as [area], never as a fact about this place. Anything you gather about the place itself comes first; [area] fills what is missing, it does not replace what exists.`,
        hasReferenceLinks ? `- The provided reference URLs are your PRIORITY source — read them first; use Google Search to complement.` : ``,
        isComplex ? `- If supported by sources, note its key internal highlights: ${membersSummary}` : ``,
        rawContext ? `- Additional hint (verify against sources): ${rawContext}` : ``,
        `Output: a short plain bullet list in English. Start each bullet with its tag in brackets, e.g. "[character] ...". No intro, no narration.`,
        // #653 — o NONE deixou de ser a saída fácil e virou último recurso, mas continua
        // existindo: sem fonte nenhuma, nada substitui o NONE — inventar segue fora.
        isEvent
            ? `NONE is the last resort, not the safe answer. Reply with exactly NONE only if the sources give you nothing usable about this event at all.`
            : `NONE is the last resort, not the safe answer: two honest [area] bullets are worth more than NONE. Reply with exactly NONE only if the sources give you nothing usable at all — nothing about this place AND nothing about its street, neighbourhood, town or kind. Never fill the gap by inventing or by guessing what a place like this "probably" is.`,
    ].filter(Boolean).join('\n');

    // Retrieval PRECISA buscar de verdade. Testado: gemini-3.1-flash-lite NÃO dispara o
    // google_search em POIs obscuros — por isso nenhum lite entra aqui.
    //
    // #652 — as DUAS posições ficam na família 3.x de propósito, e isso não é preferência de
    // modelo: é o que torna a fatura de setembro/2026 legível. O pedágio de grounding tem SKU
    // por família (2.5 cobra por prompt, 3.x cobra por search query — ver o bloco de custo no
    // topo do pipeline), e lista misturada devolve a mesma ambiguidade de atribuição por SKU
    // que travou a conciliação de agosto. Setembro é mês de MEDIÇÃO: `searchQueries` abaixo é
    // o número que decide, em outubro, qual família fica. Não troque nenhum dos dois sem o
    // card — o experimento só vale se a lista ficar parada até 2026-09-30.
    const retrievalModels = ['gemini-3.7-flash', 'gemini-3.5-flash'];
    let facts: string | null = null;
    let sourceCount = 0;
    // #652 — SOMA, nunca máximo nem última tentativa: o pedágio do 3.x é cobrado por search
    // query executada, e o fallback executa um segundo lote que a fatura cobra igual.
    let searchQueries = 0;
    let retrievalModelUsed = '';
    const startedAt = Date.now();
    const retrieveTimings: { model: string; ms: number; verdict: string }[] = [];
    const composeTimings: { model: string; ms: number }[] = [];

    for (const model of retrievalModels) {
        const body: any = {
            contents: [{ parts: [{ text: retrievalPrompt }] }],
            tools: [{ google_search: {} }],
            generationConfig: { temperature: 0.0, maxOutputTokens: 2048, ...(buildThinkingConfig(model) ? { thinkingConfig: buildThinkingConfig(model) } : {}) },
            safetySettings: [
                { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
                { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
                { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
                { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
                { category: "HARM_CATEGORY_CIVIC_INTEGRITY", threshold: "BLOCK_NONE" },
            ],
        };
        if (hasReferenceLinks) body.tools.push({ url_context: { urls: referenceLinks.slice(0, 5) } });

        const res = await callGemini(model, body, apiKey);
        // #652 — contado ANTES dos portões: a query que o modelo executou já foi cobrada,
        // mesmo quando a resposta é descartada depois por finishReason ou por veredito. Contar
        // só o que serviu subestimaria justamente o custo do fallback, que é o que se mede.
        const queriesThisAttempt = res.gm?.webSearchQueries?.length ?? 0;
        searchQueries += queriesThisAttempt;
        if (!res.ok) { retrieveTimings.push({ model, ms: res.elapsedMs ?? 0, verdict: 'error' }); attempts.push(`retrieve ${model}: ${res.error}`); continue; }
        if (res.finishReason && res.finishReason !== 'STOP') { retrieveTimings.push({ model, ms: res.elapsedMs ?? 0, verdict: `finish_${res.finishReason}` }); attempts.push(`retrieve ${model}: finishReason ${res.finishReason}`); continue; }

        step1Usage = res.usage ?? null;
        retrievalModelUsed = model;
        const sc = res.gm?.groundingChunks?.length ?? 0;
        if (sc > sourceCount) sourceCount = sc;

        const txt = (res.rawText || '').trim();
        // #651 — o portão deixou de ser `txt !== 'NONE'`. Recusa em prosa e saída sem os bullets
        // etiquetados contam como "não achei", exatamente como o NONE literal sempre contou: o
        // laço segue para o próximo modelo em vez de mandar a recusa para o passo 2.
        const verdict = judgeRetrievalOutput(txt);
        retrieveTimings.push({ model, ms: res.elapsedMs ?? 0, verdict: verdict.reason });
        console.log(`[MasterPack][retrieve] ${model} queries=${queriesThisAttempt} chunks=${sc} chars=${txt.length} usable=${verdict.usable} reason=${verdict.reason} bullets=${verdict.taggedBullets} ms=${res.elapsedMs ?? 0}`);
        if (verdict.usable) { facts = txt; break; } // achou fatos → segue
        // NONE, recusa em prosa ou saída fora do contrato → tenta o próximo modelo.
    }
    const retrieveMs = retrieveTimings.reduce((a, t) => a + t.ms, 0);

    // grounded = buscou com fontes reais E temos fatos. O grounding é PAGO desde que o projeto
    // saiu do tier gratuito (#652): 2.5 cobra US$ 35/1.000 prompts, 3.x cobra US$ 14/1.000
    // search queries executadas — doc oficial, conferida em 2026-09-01. Quem mede o custo é
    // `searchQueries`, não este booleano: `grounded=true` não diz quantas buscas foram pagas.
    const grounded = sourceCount > 0 && !!facts;
    // #653 — de onde veio o material. Calculado uma vez, aqui, sobre a colheita do passo 1: o
    // passo 2 já não tem como distinguir a procedência depois de compor. `grounded` diz que HÁ
    // lastro; isto diz de QUEM ele é, e é a única coisa que torna a população de narração por
    // entorno contável (e reversível) depois do deploy.
    const factScope = scopeOfFacts(facts);

    // ─────────────────────────────────────────────────────────────────────────
    // PASSO 2 — ESCREVER (sem busca). Usa SÓ os fatos do passo 1, no idioma/formato.
    // ─────────────────────────────────────────────────────────────────────────
    // Data de hoje p/ o modelo não narrar evento passado (ex.: 2025) no futuro.
    const todayStr = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    const systemInstruction = [
        venue
            ? `You are Tuggi, a charismatic local guide speaking through the traveler's earphones. The listener is standing at ${venue.name} RIGHT NOW. Ground them in ${venue.name} in ONE short brushstroke, then make the EVENT the heart of it: what happens, why it is special, why to come. Do NOT dwell on the venue's history — the event is the point. In about ${audioTarget} of speech, make them not want to miss it.`
            : isEvent
            ? `You are Tuggi, a charismatic local guide speaking through the traveler's earphones. The listener is passing RIGHT NOW by the place where this event happens. In about ${audioTarget} of speech, make them want to come back for it.`
            : isPlace
                ? `You are Tuggi, a charismatic local guide speaking through the traveler's earphones. The listener is passing in front of this establishment RIGHT NOW. In about ${audioTarget} of speech, make them curious about what is inside.`
                : `You are Tuggi, a charismatic local guide speaking through the traveler's earphones. The listener is standing in front of this place RIGHT NOW. In about ${audioTarget} of speech, make them see it with new eyes.`,
        ``,
        `Today's date is ${todayStr}. Any date before today is in the PAST — narrate it in the past tense.`,
        // O evento é a ÚNICA entidade com data futura: sem esta regra o modelo
        // narra "acontece o festival" para algo que só ocorre em três semanas, e
        // o ouvinte que está passando ali agora não entende que precisa voltar.
        //
        // Spread (e não string vazia): este array é unido com .join('\n') SEM
        // filter(Boolean), porque as strings vazias dele são separadores de
        // parágrafo intencionais. Um `''` condicional aqui inseriria uma linha em
        // branco no prompt de POI — que precisa ficar idêntico ao de sempre.
        ...(isEvent && eventWhen
            ? [`This event is scheduled for ${eventWhen}. State WHEN it happens, in natural spoken form, and use the tense that matches today's date — future if it has not started, present if it is happening now. Never imply it is happening at this moment if it is not.`]
            : []),
        ``,
        `LANGUAGE RULE (mandatory): Write ALL output exclusively in ${langName}, using its native script (kanji/kana, Hangul, Hanzi, Cyrillic, Thai script, etc.). Do not use English, do not romanize, do not use any other language.`,
        ``,
        `FACTUAL GROUNDING (overrides everything): You are strictly limited to the facts inside <verified_facts>. Rely ONLY on facts directly mentioned there. Never add, invent, adjust or approximate any date, number, name, statistic or event. Preserve each fact exactly — its tense, its quantities, and what each number counts. Rounding a number for speech is fine; changing its meaning is not.`,
        // #653 — a outra ponta do raio ampliado. Colher entorno sem esta regra é como o fato da
        // rua vira "fundado em 1890" do POI: exatamente a afirmação falsa que BR-CONTEUDO-008
        // item 4 nomeia, e que o afrouxamento NÃO autoriza.
        `- A bullet tagged [area] is context about the SURROUNDINGS — the street, the neighbourhood, the town, the trade — and NOT about this place. Use it to set the scene, and always attribute it to what it actually describes ("the street it stands on", "this part of town", "shops like this one"). NEVER move an [area] date, number, person or event onto this place, never say this place was founded/built/opened when only the area has a date, and never imply it already existed at the time an [area] fact describes unless a non-[area] fact says so. When in doubt, say less.`,
        `- A bullet tagged [legend] is folklore. ONLY then may you frame it as lore ("reza a lenda que...", "conta a lenda...", "legend says..."). NEVER apply legend framing to real history. If a historical fact is merely uncertain, hedge honestly instead ("segundo historiadores", "reportedly"), never call it a legend.`,
        `- Treat sensitive history — slavery, death, tragedy — with respect and directness. Never present it as a fun "legend" or a light "curiosity".`,
        `- DARK OR PAINFUL HISTORY — decide by the place's IDENTITY, not by shock value. If people come here BECAUSE of that history — the place IS a site of it (a battlefield, catacombs, a memorial, a haunted or dark-tourism landmark) — then it is the point: tell it, with gravity and respect. But if the place's real identity is something else (a park, church, beach, market, square, restaurant) and the dark event is an incidental crime or misfortune that merely happened there, do NOT make it the story. Lead with what the place IS and why someone enjoys being here, and in a short narration LEAVE the incidental dark event OUT — include it only if it is genuinely the single most interesting thing about the place, and even then briefly and never as the opening. A one-off theft at a church whose story is faith and community is a footnote to drop, not a beat to spend. Never spend a beat that dampens the desire to be here — or, for an event, the desire to attend. The test: would a visitor seek this place OUT for that story, or are they simply here for the place itself? Either way never invent — stay inside the facts; you are only choosing whether the dark thread is the place's identity or a footnote.`,
        // #651 — as duas regras abaixo moram AQUI, coladas em DARK OR PAINFUL HISTORY, e não num
        // bloco novo: as três decidem a mesma coisa (que fio não se conta), e regra dispersa num
        // prompt deste tamanho se contradiz.
        `- PEOPLE — never pronounce the name of a person who is not a public or historical figure, even if the name appears inside <verified_facts>. Public or historical means tied to this place by a role a visitor could look up: founder, architect, chef, recognized owner, artist, ruler, documented historical figure. A name that reached the facts from a social-media post, a review or a personal profile belongs to a private person: drop that thread and tell a shorter story (rule 8 allows it). Never mention the platform a fact came from.`,
        `- CONTEMPORARY POLITICS AND ACCUSATIONS ARE OUT — never narrate party politics, elections, the current occupant of an office, an investigation, a lawsuit, a criminal charge, a corruption allegation, a scandal or a recent crime, even if it sits in <verified_facts>. Tell a public building by what it IS — architecture, founding, function, what you see from here — never by who occupies it today. This does not erase history: consolidated, distant political fact (it was the seat of government; a treaty was signed here) stays narrable. The cut is on the contemporary, the personal and the accusatory — when in doubt, tell the shorter story.`,
        `- You MAY use a universal comparison to make a number vivid, but never introduce a new claim about this place.`,
        ``,
        `HOW TO TELL IT — you are telling ONE story, not reading a timeline:`,
        `1. HARD RULE — the narration's literal first words are ${venue ? `"${venue.name}" (the place the listener is standing at)` : 'the POI name'}. No warm-up before it ("Olha só", "This is", "Imagine", "Este é").`,
        `2. SELECT ONE THREAD: You will receive MORE facts than fit in ${audioTarget}. Do NOT summarize them all. Choose the single strongest thread — a character and what they wanted, a conflict or reversal, or the one most surprising fact — and tell only THAT, well. A tight story beats a rushed inventory. (The unused facts still go into <master_facts>.)`,
        `3. OPEN A LOOP: right after the name, hook them with that thread — an intriguing person, a tension, or an implied question. Never open with a flat definition like "X is a Y".`,
        `4. CLOSE THE LOOP LAST: land the resolution or the surprise at the very end — never announce it ("A fun fact is", "Uma curiosidade é que", "Interestingly", "Sabia que", "Você sabia"). If there is no real surprise, end cleanly.`,
        `5. SUBSTANCE OVER PRAISE: lead with the surprising and specific, never generic beauty. Words like "paraíso", "lugar especial", "cristalino", "deslumbrante", "special place", "stunning" are NOT content — if you catch yourself praising, replace it with a concrete fact.`,
        `6. IMAGE OVER NUMBER: tie a bare number to something the listener can picture or feel, or leave it out. Do not recite a chain of dates.`,
        `7. Vary the rhythm — mix short punches with longer flowing sentences. Warm and conversational, clear for a curious 15-year-old.`,
        `8. If the facts are thin (fewer than 3 substantive facts, or no character/conflict), tell a SHORTER, honest story. Never pad, never gush.`,
        `9. If the only substantial material is [area] context, tell THAT story — about the street, the neighbourhood or the trade — with this place as where the listener happens to be standing, and say so plainly ("a rua onde você está", "este bairro"). A true, small story about the setting is worth telling; a grand one about a place you know nothing about is not. Still open with the name (rule 1), and still never dress area context as this place's own history.`,
        ``,
        `VOICE & TTS:`,
        `- No greetings, no "welcome". Do NOT mention standalone city or state names.`,
        `- This text will be synthesized by TTS — no abbreviations, no acronyms, no symbols.`,
        `- HARD LENGTH LIMIT: keep the narration UNDER ${maxChars} characters (~${audioTarget}). If your draft runs longer, cut the weakest thread — never compress by dropping words or articles.`,
        ``,
        `OUTPUT FORMAT — use these exact XML tags, nothing outside them. Do NOT use Markdown tables or headers inside the tags:`,
        `<master_description>`,
        `[the narration — one thread, under ${maxChars} characters]`,
        `</master_description>`,
        `<master_facts>`,
        `[UP TO 5 lines — only facts from <verified_facts>. Fewer is fine; never pad. Format each line: Category|Fact — no Markdown, no table headers, no pipes except as separator. Any line that came from an [area] bullet MUST use the literal category "Area", e.g. "Area|The street was the town's first paved road, opened in 1890" — that is how a curator can still tell the setting apart from the place itself]`,
        `</master_facts>`,
        ``,
        `EXAMPLE (illustrative only — it shows the craft, not the language; YOUR output must be entirely in ${langName}):`,
        `<example_verified_facts>`,
        `- [type] Crêperie, opened in 1983`,
        `- [character] Founded by Michelle Faure, a French woman known as "Michou"`,
        `- [conflict] Started as a tiny window on Rua das Pedras; grew and moved to a bigger house in 1986`,
        `- [curiosity] The 1986 move was celebrated with a "chocolate war" among the staff`,
        `</example_verified_facts>`,
        `<example_output>`,
        `<master_description>Chez Michou started as nothing more than a little crepe window on Rua das Pedras, run by a French woman everyone called Michou. It got so popular there was no room to breathe — so she took over the house next door. And the day they moved in, the staff didn't cut a ribbon. They threw chocolate at each other, in an all out chocolate war.</master_description>`,
        `<master_facts>`,
        `Type|Crêperie, opened in 1983`,
        `Founder|Michelle "Michou" Faure`,
        `Milestone|Moved to the current house in 1986`,
        `Curiosity|The move was celebrated with a "chocolate war"`,
        `</master_facts>`,
        `</example_output>`,
        ``,
        `REMINDER: All text inside the XML tags must be in ${langName}.`,
    ].join('\n');

    // Cenário 1: bloco de contexto do POI anfitrião, anexado ao compose. Vazio
    // (não interfere) quando não há venue. Usa a narração existente do POI como
    // contexto — nunca re-pesquisa nem inventa sobre o POI.
    const venueBlock = venue
        ? (venue.facts
            ? `\n\n<venue_context name="${venue.name}">\n${venue.facts}\n</venue_context>\nThe listener is standing at ${venue.name}. OPEN the narration at ${venue.name} using ONE thread from venue_context, THEN pivot to the event above happening HERE, stating its dates. Use ONLY venue_context for the venue — never research or invent about it.`
            : `\n\nThe listener is standing at "${venue.name}" (the event's venue). OPEN by grounding them at ${venue.name} by name, THEN present the event above happening HERE, with its dates. Do not invent facts about the venue.`)
        : '';

    // #653 — o ramo genérico ficou como último recurso de verdade: com o raio ampliado, chegar
    // aqui passou a significar "as fontes não deram NADA", nem sobre o lugar nem sobre a rua.
    // O texto dele não afrouxou e não pode afrouxar — é o mesmo genérico sem fato que
    // BR-CONTEUDO-008 item 2 já declara não publicável, divergência registrada pelo `produto`
    // em 2026-09-01 e que não é deste card.
    const composeUser = (facts
        ? `<verified_facts poi="${poiName}">\n${facts}\n</verified_facts>\n\nBased only on the facts above, write <master_description> and <master_facts> in ${langName}.`
        : `No verified facts were found for "${poiName}". Write a SHORT, generic, atmospheric description based ONLY on its name and category — include NO date, number, founder, statistic, legend or specific claim. For <master_facts> give at most 2 generic facts, or leave it minimal.`)
        + venueBlock;

    // Primeira descrição (compose) no gemini-2.5-flash, como o grounding. Fallback vivo
    // no 3.1-flash-lite p/ quando o 2.5-flash flapar (404 de aposentadoria em rollout).
    const composeModels = ['gemini-2.5-flash', 'gemini-3.1-flash-lite'];
    let lastError: Error | null = null;

    for (const model of composeModels) {
        const body: any = {
            system_instruction: { parts: [{ text: systemInstruction }] },
            contents: [{ parts: [{ text: composeUser }] }],
            // 0.7: storytelling precisa de variação (0.1 achatava em lista de fatos).
            generationConfig: { temperature: 0.7, maxOutputTokens: 4096, ...(buildThinkingConfig(model) ? { thinkingConfig: buildThinkingConfig(model) } : {}) },
        };

        const res = await callGemini(model, body, apiKey);
        composeTimings.push({ model, ms: res.elapsedMs ?? 0 });
        if (!res.ok) { attempts.push(`compose ${model}: ${res.error}`); lastError = new Error(res.error); continue; }
        if (res.finishReason && res.finishReason !== 'STOP') { attempts.push(`compose ${model}: finishReason ${res.finishReason}`); lastError = new Error(`compose finishReason ${res.finishReason}`); continue; }

        const rawText = res.rawText || '';
        if (!rawText) { attempts.push(`compose ${model}: empty`); lastError = new Error('compose empty'); continue; }
        step2Usage = res.usage ?? null;

        // Tag extraction + the "Category|Fact" line fallback, shared with the partner generator.
        const parsed = parseNarrationOutput(rawText);
        if (!parsed) { attempts.push(`compose ${model}: extraction failed`); lastError = new Error('compose extraction failed'); continue; }
        const { description: finalDescription, facts_pack_json } = parsed;

        // #651 — a segunda ponta. O passo 1 já não entrega recusa, mas o passo 2 tem recusa
        // PRÓPRIA: com `facts` nulo ele às vezes se desculpa em vez de escrever o genérico, e
        // ainda recusa por causa da LANGUAGE RULE. Medido em 2026-09-01: das 126 linhas de
        // recusa gravadas, 48 nasceram já em SAFE MODE — ou seja, sem passar pelo passo 1.
        // Recusa nunca vira linha gravada: tenta o próximo modelo, e se nenhum escrever, o
        // `throw` do fim do arquivo deixa o POI virgem (BR-CONTEUDO-004 item 5) em vez de
        // publicar um pedido de desculpas com mp3 pago.
        if (isRefusalText(finalDescription)) {
            console.warn(`[MasterPack] compose ${model}: refusal detected, discarding — "${finalDescription.slice(0, 80)}"`);
            attempts.push(`compose ${model}: refusal`);
            lastError = new Error('compose refused');
            continue;
        }

        const usage: GeminiUsage = {
            input_tokens: (step1Usage?.input_tokens ?? 0) + (step2Usage?.input_tokens ?? 0),
            output_tokens: (step1Usage?.output_tokens ?? 0) + (step2Usage?.output_tokens ?? 0),
            model: `${retrievalModelUsed || 'n/a'}+${model}`,
        };

        const composeMs = composeTimings.reduce((a, t) => a + t.ms, 0);
        const timings: MasterPackTimings = {
            retrieve: retrieveTimings,
            retrieveMs,
            compose: composeTimings,
            composeMs,
            totalMs: Date.now() - startedAt,
        };

        console.log(`[MasterPack] grounded=${grounded} scope=${factScope ?? 'none'} sources=${sourceCount} queries=${searchQueries} retrieve_attempts=${retrieveTimings.length} facts=${!!facts} compose=${model} descLen=${finalDescription.length}`);
        // Uma linha, em ms, com a etapa que gastou. `retrieve` traz UMA entrada por modelo
        // tentado: é assim que o custo do fallback aparece em vez de se diluir no total.
        console.log(`[MasterPack][timing] total_ms=${timings.totalMs} retrieve_ms=${retrieveMs} compose_ms=${composeMs} retrieve=${retrieveTimings.map((t) => `${t.model}:${t.ms}:${t.verdict}`).join(',')} compose=${composeTimings.map((t) => `${t.model}:${t.ms}`).join(',')}`);

        return {
            description: finalDescription,
            facts_pack_json,
            usage,
            grounded,
            sourceCount,
            searchQueryCount: searchQueries,
            // SSOT: a contagem de tentativas é a mesma lista que o timing publica — uma entrada
            // por chamada tentada. Um contador próprio aqui seria o segundo dono do mesmo fato.
            retrievalAttempts: retrieveTimings.length,
            factScope,
            modelUsed: `retrieve:${retrievalModelUsed || 'none'} compose:${model}`,
            timings,
        };
    }

    const finalErrorMessage = `MasterPack failed: ${attempts.join(' | ')}`;
    console.error(`[MasterPack] ${finalErrorMessage}`);
    console.log(`[MasterPack][timing] total_ms=${Date.now() - startedAt} retrieve_ms=${retrieveMs} compose_ms=${composeTimings.reduce((a, t) => a + t.ms, 0)} outcome=failed`);
    throw lastError ? new Error(finalErrorMessage) : new Error(finalErrorMessage);
};
