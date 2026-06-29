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
    const retrievalPrompt = [
        `Using Google Search, research this SPECIFIC place: "${poiName}", near ${city}.`,
        `Find ONLY verified facts that the sources state about THIS EXACT place: what it is (its type), founding/opening year, founder(s) or architect, key historical dates, size/capacity, and ONE genuine surprising curiosity if the sources mention one.`,
        `Rules:`,
        `- Use ONLY what the sources actually say. Never invent, guess or approximate.`,
        `- This is one specific place. If the sources are about the surrounding town, resort, region or a different nearby place, do NOT include those facts.`,
        hasReferenceLinks ? `- The provided reference URLs are your PRIORITY source — read them first; use Google Search to complement.` : ``,
        isComplex ? `- If supported by sources, note its key internal highlights: ${membersSummary}` : ``,
        rawContext ? `- Additional hint (verify against sources): ${rawContext}` : ``,
        `Output: a short plain bullet list of factual statements in English. No intro, no narration.`,
        `If you cannot find reliable sources specifically about THIS place, reply with exactly: NONE`,
    ].filter(Boolean).join('\n');

    const retrievalModels = ['gemini-3.1-flash-lite', 'gemini-2.5-flash'];
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
    const systemInstruction = [
        `LANGUAGE RULE (mandatory): Write ALL output exclusively in ${langName}, using its native script (kanji/kana, Hangul, Hanzi, Cyrillic, Thai script, etc.). Do not use English, do not romanize, do not use any other language.`,
        `You are a friendly, knowledgeable tour guide who must communicate with EVERYONE — from teenagers to senior citizens.`,
        `Your style is warm, clear, and conversational. Avoid complex vocabulary, long subordinate clauses, or academic jargon.`,
        `Imagine you are speaking to a curious 15-year-old who wants to learn and have fun.`,
        ``,
        `FACTUAL INTEGRITY (overrides everything): use ONLY the VERIFIED FACTS given to you below. Never add, invent or approximate any date, number, founder, statistic or legend that is not in that list.`,
        ``,
        `OUTPUT FORMAT — use these exact XML tags. Do NOT use Markdown tables or headers inside the tags:`,
        `<master_description>`,
        `[Follow this narrative structure:]`,
        `1. OPEN with the POI name as the very first words (the listener just heard a directional cue, so they must immediately know WHAT it is).`,
        `2. HISTORICAL CONTEXT: weave in the verified dates/milestones from the facts. Omit anything not in the facts.`,
        `3. CURIOSITY: IF the facts contain a genuine surprising detail, end with it naturally (NEVER announce it with "A fun fact is", "Uma curiosidade é que", "Interestingly"). If there is none, end without one.`,
        ``,
        `CONSTRAINTS:`,
        `- Target: ~${maxChars} characters (~${audioTarget} of natural speech).`,
        `- Do NOT mention standalone city or state names.`,
        `- Use SHORT sentences. Prefer active voice. Avoid subordinate clause chains.`,
        `- This text will be synthesized by TTS — avoid abbreviations, acronyms, or symbols.`,
        `</master_description>`,
        ``,
        `<master_facts>`,
        `[UP TO 5 lines — only facts from the verified list. Fewer is fine; never pad. Format each line: Category|Fact — no Markdown, no table headers, no pipes except as separator]`,
        `Example line: Fundação|Inaugurado em 1991`,
        `Example line: Arquitetura|Estilo colonial com fachada de pedra`,
        `</master_facts>`,
        ``,
        `REMINDER: All text inside the XML tags must be in ${langName}.`,
    ].join('\n');

    const composeUser = facts
        ? `VERIFIED FACTS about "${poiName}" (use ONLY these — you may omit weak ones, but add nothing new):\n${facts}\n\nNow write <master_description> and <master_facts> following the format and language rules.`
        : `No verified facts were found for "${poiName}". Write a SHORT, generic, atmospheric description based ONLY on its name and category — include NO date, number, founder, statistic, legend or specific claim. For <master_facts> give at most 2 generic facts, or leave it minimal.`;

    const composeModels = ['gemini-2.5-flash-lite', 'gemini-3.1-flash-lite'];
    let lastError: Error | null = null;

    for (const model of composeModels) {
        const body: any = {
            system_instruction: { parts: [{ text: systemInstruction }] },
            contents: [{ parts: [{ text: composeUser }] }],
            generationConfig: { temperature: 0.1, maxOutputTokens: 4096, ...(buildThinkingConfig(model) ? { thinkingConfig: buildThinkingConfig(model) } : {}) },
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
