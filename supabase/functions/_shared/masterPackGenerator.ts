// _shared/masterPackGenerator.ts

// DRY: SSOT de nomes de idioma (cobre Ásia/Rússia/Tailândia com script).
import { getLanguageName } from './translationUtility.ts';

interface GeminiUsage {
    input_tokens: number;
    output_tokens: number;
    model: string;
}

interface MasterPackResult {
    description: string;
    facts_pack_json: any;
    usage: GeminiUsage | null;
    // grounded=true: passo 1 buscou e achou fontes reais (groundingChunks) → approved.
    // grounded=false: nenhuma fonte (NONE) → SAFE MODE genérico → needs_review.
    grounded?: boolean;
    sourceCount?: number;
    modelUsed?: string;
}

// thinking baixo (tarefas determinísticas): gemini-3* → thinkingLevel low; 2.5* → off.
const buildThinkingConfig = (model: string): Record<string, unknown> | undefined => {
    const m = model.toLowerCase();
    if (m.startsWith('gemini-3')) return { thinkingLevel: 'low' };
    if (m.startsWith('gemini-2.5')) return { thinkingBudget: 0 };
    return undefined;
};

interface GeminiCallResult {
    ok: boolean;
    error?: string;
    finishReason?: string | null;
    rawText?: string;
    gm?: any;
    usage?: GeminiUsage;
}

// Uma chamada generateContent crua, com tratamento de erro/finishReason.
const callGemini = async (model: string, fetchBody: any, apiKey: string): Promise<GeminiCallResult> => {
    try {
        const r = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
            { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fetchBody) },
        );
        if (!r.ok) {
            const ed = await r.json().catch(() => ({ error: { message: r.statusText } }));
            return { ok: false, error: `HTTP ${r.status} ${ed?.error?.message || r.statusText}` };
        }
        const data = await r.json();
        if (data.error) return { ok: false, error: data.error.message };
        const cand = data.candidates?.[0];
        const rawText = (cand?.content?.parts || []).map((p: any) => p.text || '').join('');
        const um = data.usageMetadata || {};
        return {
            ok: true,
            finishReason: cand?.finishReason ?? null,
            rawText,
            gm: cand?.groundingMetadata,
            usage: { input_tokens: um.promptTokenCount ?? 0, output_tokens: um.candidatesTokenCount ?? 0, model },
        };
    } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
};

/**
 * Master Content Generator — pipeline RAG de 2 passos (grounding garantido).
 *
 * O google_search do Gemini é DISCRICIONÁRIO e não dispara num prompt de "escreva
 * uma narração" (o modelo responde de memória → alucina/confunde). Comprovado por
 * diagnóstico direto. Solução:
 *   PASSO 1 (BUSCAR): prompt de LOOKUP factual → o modelo SEMPRE busca → fatos
 *           verificados + fontes reais (ou "NONE"). Grounding é grátis (cota free).
 *   PASSO 2 (ESCREVER): compõe a narração no idioma/formato usando SÓ os fatos do
 *           passo 1 (sem busca) → não tem como alucinar. Se NONE → genérico curto.
 */
export const generateMasterPack = async (
    poiName: string,
    city: string,
    rawContext: string,
    language: string,
    apiKey: string,
    poiData: any = {},
    audioDuration: number = 25,
    memberPois: any[] = [],
    referenceLinks: string[] = [] // Links de referência do CMS (Wikipedia, sites oficiais, etc.)
): Promise<MasterPackResult> => {

    const audioTarget = `${audioDuration}s`;
    // Caracteres por segundo de fala variam MUITO por script: no latino/cirílico
    // ~18 chars/s, mas em CJK (ja/ko/zh) cada caractere carrega uma sílaba/palavra,
    // então ~18 geraria áudio 2–3x mais longo que o alvo. Alvo de chars por script.
    const lc = language.toLowerCase();
    const isCJK = /^(ja|ko|zh|cmn|yue)(-|$)/.test(lc);
    const charsPerSecond = isCJK ? 7 : 18;
    const maxChars = Math.floor(audioDuration * charsPerSecond);
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
    const retrievalPrompt = [
        `Using Google Search, research this SPECIFIC place: "${poiName}", near ${city}.`,
        `Your goal is to gather raw material for a ~${audioTarget} spoken story a great tour guide would tell — so look BEYOND dry data.`,
        `Find ONLY what the sources actually state about THIS EXACT place. Gather, when available:`,
        `- [type] What it is, plus core dates/numbers (founding/opening year, size/capacity) — briefly.`,
        `- [character] A real person tied to this place (founder, architect, resident, someone who changed it) and something human about them.`,
        `- [conflict] A struggle, controversy, disaster, transformation, rivalry, or surprising change in its history.`,
        `- [sensory] Concrete visible/audible detail the sources describe — what you notice standing here.`,
        `- [why] What makes it significant, unusual, or a "first / only / largest".`,
        `- [curiosity] ONE genuinely surprising detail, if the sources mention one.`,
        `- [legend] A local legend or folklore — ONLY if the sources present it as lore/myth (keep the [legend] tag so it is never told as fact). Do NOT tag uncertain-but-real history as [legend].`,
        `Rules:`,
        `- Use ONLY what the sources actually say. Never invent, guess, approximate or embellish. If a category has nothing in the sources, SKIP it — do not fill it with generic filler.`,
        `- This is one specific place. If the sources are about the surrounding town, resort, region or a different nearby place, do NOT include those facts.`,
        hasReferenceLinks ? `- The provided reference URLs are your PRIORITY source — read them first; use Google Search to complement.` : ``,
        isComplex ? `- If supported by sources, note its key internal highlights: ${membersSummary}` : ``,
        rawContext ? `- Additional hint (verify against sources): ${rawContext}` : ``,
        `Output: a short plain bullet list in English. Start each bullet with its tag in brackets, e.g. "[character] ...". No intro, no narration.`,
        `If you cannot find reliable sources specifically about THIS place, reply with exactly: NONE`,
    ].filter(Boolean).join('\n');

    // Retrieval PRECISA buscar de verdade. gemini-2.5-flash busca de forma confiável e
    // puxa mais fontes/retrieval (preferido p/ qualidade de grounding). Testado:
    // gemini-3.1-flash-lite NÃO dispara o google_search em POIs obscuros. 3.5-flash
    // como fallback vivo p/ quando o 2.5-flash flapar (404 de aposentadoria em rollout).
    const retrievalModels = ['gemini-2.5-flash', 'gemini-3.5-flash'];
    let facts: string | null = null;
    let sourceCount = 0;
    let retrievalModelUsed = '';

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
        if (!res.ok) { attempts.push(`retrieve ${model}: ${res.error}`); continue; }
        if (res.finishReason && res.finishReason !== 'STOP') { attempts.push(`retrieve ${model}: finishReason ${res.finishReason}`); continue; }

        step1Usage = res.usage ?? null;
        retrievalModelUsed = model;
        const sc = res.gm?.groundingChunks?.length ?? 0;
        if (sc > sourceCount) sourceCount = sc;

        const txt = (res.rawText || '').trim();
        console.log(`[MasterPack][retrieve] ${model} searched=${(res.gm?.webSearchQueries?.length ?? 0) > 0} chunks=${sc} chars=${txt.length}`);
        if (txt && txt.toUpperCase() !== 'NONE') { facts = txt; break; } // achou fatos → segue
        // NONE → tenta o próximo modelo (pode achar o que o primeiro não achou)
    }

    // grounded = buscou com fontes reais E temos fatos. (Search é grátis na cota free.)
    const grounded = sourceCount > 0 && !!facts;

    // ─────────────────────────────────────────────────────────────────────────
    // PASSO 2 — ESCREVER (sem busca). Usa SÓ os fatos do passo 1, no idioma/formato.
    // ─────────────────────────────────────────────────────────────────────────
    // Data de hoje p/ o modelo não narrar evento passado (ex.: 2025) no futuro.
    const todayStr = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    const systemInstruction = [
        `You are Tuggi, a charismatic local guide speaking through the traveler's earphones. The listener is standing in front of this place RIGHT NOW. In about ${audioTarget} of speech, make them see it with new eyes.`,
        ``,
        `Today's date is ${todayStr}. Any date before today is in the PAST — narrate it in the past tense.`,
        ``,
        `LANGUAGE RULE (mandatory): Write ALL output exclusively in ${langName}, using its native script (kanji/kana, Hangul, Hanzi, Cyrillic, Thai script, etc.). Do not use English, do not romanize, do not use any other language.`,
        ``,
        `FACTUAL GROUNDING (overrides everything): You are strictly limited to the facts inside <verified_facts>. Rely ONLY on facts directly mentioned there. Never add, invent, adjust or approximate any date, number, name, statistic or event. Preserve each fact exactly — its tense, its quantities, and what each number counts. Rounding a number for speech is fine; changing its meaning is not.`,
        `- A bullet tagged [legend] is folklore. ONLY then may you frame it as lore ("reza a lenda que...", "conta a lenda...", "legend says..."). NEVER apply legend framing to real history. If a historical fact is merely uncertain, hedge honestly instead ("segundo historiadores", "reportedly"), never call it a legend.`,
        `- Treat sensitive history — slavery, death, tragedy — with respect and directness. Never present it as a fun "legend" or a light "curiosity".`,
        `- You MAY use a universal comparison to make a number vivid, but never introduce a new claim about this place.`,
        ``,
        `HOW TO TELL IT — you are telling ONE story, not reading a timeline:`,
        `1. HARD RULE — the narration's literal first words are the POI name. No warm-up before it ("Olha só", "This is", "Imagine", "Este é").`,
        `2. SELECT ONE THREAD: You will receive MORE facts than fit in ${audioTarget}. Do NOT summarize them all. Choose the single strongest thread — a character and what they wanted, a conflict or reversal, or the one most surprising fact — and tell only THAT, well. A tight story beats a rushed inventory. (The unused facts still go into <master_facts>.)`,
        `3. OPEN A LOOP: right after the name, hook them with that thread — an intriguing person, a tension, or an implied question. Never open with a flat definition like "X is a Y".`,
        `4. CLOSE THE LOOP LAST: land the resolution or the surprise at the very end — never announce it ("A fun fact is", "Uma curiosidade é que", "Interestingly", "Sabia que", "Você sabia"). If there is no real surprise, end cleanly.`,
        `5. SUBSTANCE OVER PRAISE: lead with the surprising and specific, never generic beauty. Words like "paraíso", "lugar especial", "cristalino", "deslumbrante", "special place", "stunning" are NOT content — if you catch yourself praising, replace it with a concrete fact.`,
        `6. IMAGE OVER NUMBER: tie a bare number to something the listener can picture or feel, or leave it out. Do not recite a chain of dates.`,
        `7. Vary the rhythm — mix short punches with longer flowing sentences. Warm and conversational, clear for a curious 15-year-old.`,
        `8. If the facts are thin (fewer than 3 substantive facts, or no character/conflict), tell a SHORTER, honest story. Never pad, never gush.`,
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
        `[UP TO 5 lines — only facts from <verified_facts>. Fewer is fine; never pad. Format each line: Category|Fact — no Markdown, no table headers, no pipes except as separator]`,
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

    const composeUser = facts
        ? `<verified_facts poi="${poiName}">\n${facts}\n</verified_facts>\n\nBased only on the facts above, write <master_description> and <master_facts> in ${langName}.`
        : `No verified facts were found for "${poiName}". Write a SHORT, generic, atmospheric description based ONLY on its name and category — include NO date, number, founder, statistic, legend or specific claim. For <master_facts> give at most 2 generic facts, or leave it minimal.`;

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
        if (!res.ok) { attempts.push(`compose ${model}: ${res.error}`); lastError = new Error(res.error); continue; }
        if (res.finishReason && res.finishReason !== 'STOP') { attempts.push(`compose ${model}: finishReason ${res.finishReason}`); lastError = new Error(`compose finishReason ${res.finishReason}`); continue; }

        const rawText = res.rawText || '';
        if (!rawText) { attempts.push(`compose ${model}: empty`); lastError = new Error('compose empty'); continue; }
        step2Usage = res.usage ?? null;

        // Extração das tags (case-insensitive) + fallback por linhas "Category|Fact".
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
        if (!description) { attempts.push(`compose ${model}: extraction failed`); lastError = new Error('compose extraction failed'); continue; }

        const facts_pack_json = (rawFactsText ? rawFactsText.split('\n') : []).map((line: string) => {
            const [category, ...textParts] = line.split('|');
            return {
                category: (category || 'history').trim().toLowerCase().replace(/[^a-z]/g, ''),
                text: textParts.join('|').trim().replace(/\[cite: \d+\]/g, '').replace(/\[\d+\]/g, ''),
            };
        }).filter((f: any) => f.text.length > 5);

        const finalDescription = description
            .replace(/<\/?master_[a-z_]*>/gi, '')
            .replace(/\[cite: \d+\]/g, '')
            .replace(/\[\d+\]/g, '')
            .trim();

        const usage: GeminiUsage = {
            input_tokens: (step1Usage?.input_tokens ?? 0) + (step2Usage?.input_tokens ?? 0),
            output_tokens: (step1Usage?.output_tokens ?? 0) + (step2Usage?.output_tokens ?? 0),
            model: `${retrievalModelUsed || 'n/a'}+${model}`,
        };

        console.log(`[MasterPack] grounded=${grounded} sources=${sourceCount} facts=${!!facts} compose=${model} descLen=${finalDescription.length}`);

        return {
            description: finalDescription,
            facts_pack_json,
            usage,
            grounded,
            sourceCount,
            modelUsed: `retrieve:${retrievalModelUsed || 'none'} compose:${model}`,
        };
    }

    const finalErrorMessage = `MasterPack failed: ${attempts.join(' | ')}`;
    console.error(`[MasterPack] ${finalErrorMessage}`);
    throw lastError ? new Error(finalErrorMessage) : new Error(finalErrorMessage);
};
