// _shared/partnerPackGenerator.ts

/**
 * THE PAID PARTNER'S NARRATION — and it is a different machine from the curated one.
 *
 * `generateMasterPack` is a two-step RAG: step 1 makes Gemini SEARCH, step 2 writes using only
 * what the sources said. That is exactly right for a POI of the catalogue and exactly wrong here,
 * for a reason that is a rule and not a preference — **BR-B2B-025**: the establishment declares
 * that what it sends is true, and *"o motivo é o que a Tuggi faz com o insumo: nós narramos"*.
 * The paid tier's description is produced out of what the partner SENDS (BR-B2B-016, item 1), and
 * Tuggi neither checks it nor certifies it (item 4 of the same rule). Letting the model search the
 * web here would do three wrong things at once: it would put claims Tuggi cannot attribute into
 * the partner's mouth, it would import the sort of review-site copy the substitute test exists to
 * strip out, and it would spend a grounding call on content that has a source already.
 *
 * SO THERE IS ONE CALL, AND ITS ONLY SOURCE IS `<partner_input>`.
 *
 * WHAT THIS GENERATOR DOES NOT DECIDE. Whether this place may have a description at all is
 * `lib/partnerships/place-description-policy.ts`, in the CMS — a free-tier place never reaches
 * here, and the guard that keeps the APP from reaching here is in `generate-description` itself
 * (BR-B2B-016, item 9). Gate 2 of BR-B2B-011 — whether the input has anything to tell — is a
 * human's, and always was: *"quem decide quem entra é operador, nao o sistema"*.
 */

import { getLanguageName } from './translationUtility.ts';
import {
    callGemini,
    charsPerSecondFor,
    parseNarrationOutput,
    type GeminiUsage,
} from './masterPackGenerator.ts';

/** One answer the establishment wrote, with the question it answered. */
export interface PartnerStoryBlock {
    /** Semantic id — `story_founder`, `story_before`, `story_unique`, `story_event`. */
    id: string;
    /** The question, in English, for the model. Never the form's Portuguese copy. */
    label: string;
    answer: string;
}

export interface PartnerPackInput {
    /** The establishment's name, as the narration's first words must say it. */
    name: string;
    city: string;
    blocks: PartnerStoryBlock[];
    /**
     * The handle the closing invites the listener to follow, already stripped of `@` and of any
     * URL. `null` when the establishment left it blank, and then there is no closing at all.
     */
    socialHandle: string | null;
    /**
     * WHETHER THE COMMERCIAL CLOSING GOES IN, and it is a parameter because it is a decision with
     * an owner, not a property of the input.
     *
     * BR-B2B-016, item 8: the paid description MAY carry a commercial offer — Instagram, a dish, a
     * contact — **in the audio, with explicit identification**. Without identification it does not
     * go on air: an unidentified offer consumed as curation is what **CDC art. 36** reaches, and it
     * is the option the operator did NOT choose. `false` produces history alone, which is what the
     * paid tier already was before 2026-08-14 and is liberated with no further decision.
     */
    withOffer: boolean;
}

export interface PartnerPackResult {
    description: string;
    facts_pack_json: any;
    usage: GeminiUsage | null;
    modelUsed: string;
}

/**
 * WHERE THE IDENTIFICATION GOES — decided by the operator on 2026-08-26, answering
 * `_perguntas-abertas.md` **85**: at the END of the audio, together with the invitation.
 * *"a sua direita, restaurante Cozi Mais … com toda a descriçao e no final, nos siga nas redes"*.
 *
 * It is option (c) of that question, and the cost the question named travels with it: identifying
 * at the end informs AFTER the fact, which is the thinnest reading of "fácil e imediatamente" in
 * CDC art. 36. The decision is the operator's and it is recorded here so the next reader of this
 * prompt does not re-open it by accident. `produto` owes it a `BR-*` id.
 *
 * THE WORDING IS NOT DECIDED HERE. Text a tourist hears is the `design`'s (CLAUDE.md §1), and what
 * this constant carries is the SHAPE the operator decided — last beat, identified, one sentence.
 * The model writes it in the target language; the example below is craft, not copy.
 */
const OFFER_CLOSING_RULES = (handle: string) => [
    ``,
    `THE CLOSING — the LAST beat of the audio, and the ONLY part that may be commercial:`,
    `- End with ONE short sentence that does two things at once: it makes audible that this last beat comes FROM THE ESTABLISHMENT ITSELF, and it invites the listener to follow it.`,
    `- The listener must be able to tell, from the sentence alone, that they are hearing the establishment and not the guide. Attribute it out loud — the establishment invites, the establishment asks. Never let the invitation sound like Tuggi's own recommendation.`,
    `- Say the handle exactly as "${handle}". Do not spell it out letter by letter, do not add "arroba", "at", "www", "dot com" or any URL. TTS reads what you write.`,
    `- NOTHING comes after it. The closing is the end of the audio.`,
    `- This is the only place a commercial invitation may appear. The story before it never advertises.`,
].join('\n');

/**
 * THE PARTNER'S TEXT IS UNTRUSTED INPUT, and the frame around it is what makes it readable.
 *
 * Everything in `<partner_input>` was typed into a public form by someone outside the company
 * (BR-B2B-026, items 1 to 3). An answer containing `</partner_input>` — by accident or on purpose —
 * would close the frame early and turn the rest of that answer into instructions the model reads as
 * ours. Angle brackets are the whole attack surface here, and a partner narration has no use for
 * them: this is the establishment's history, not markup.
 *
 * Quotes go too, because two of these values are XML ATTRIBUTES: a name carrying `"` would end the
 * attribute and put the rest of the name where the parser expects another one.
 */
const escapeForPrompt = (value: string): string =>
    (value ?? '')
        .replace(/[<>]/g, ' ')
        .replace(/["]/g, "'")
        .trim();

/**
 * The narration, from the partner's own words. Throws when every model attempt failed — the caller
 * turns that into a message, and a failed generation writes nothing.
 */
export const generatePartnerPack = async (
    input: PartnerPackInput,
    language: string,
    apiKey: string,
    audioDuration: number,
): Promise<PartnerPackResult> => {
    const audioTarget = `${audioDuration}s`;
    const maxChars = Math.floor(audioDuration * charsPerSecondFor(language));
    const langName = getLanguageName(language);

    // The offer only exists when there is something to point at. A closing that invites the
    // listener to follow an establishment nowhere is worse than no closing.
    const withOffer = input.withOffer && !!input.socialHandle;

    const systemInstruction = [
        `You are Tuggi, a charismatic local guide speaking through the traveler's earphones. The listener is passing in front of this establishment RIGHT NOW, and the app has just told them which side of the road it is on. In about ${audioTarget} of speech, make them want to walk in.`,
        ``,
        `LANGUAGE RULE (mandatory): Write ALL output exclusively in ${langName}, using its native script. Do not use English, do not romanize, do not use any other language.`,
        ``,
        // ── The half that is a rule and not craft ────────────────────────────────
        `SOURCE OF TRUTH (overrides everything below): the establishment wrote <partner_input> about itself, and it is the WHOLE of what you know. You are narrating what THEY assert.`,
        `- NEVER research, recall or infer anything about this establishment, its street, its city or its owners. If you happen to know something about it, you do not know it here.`,
        `- NEVER add, invent, adjust or approximate a date, a number, a name or a claim that is not written in <partner_input>. Preserve each one exactly — a year, a quantity, and what each number counts.`,
        `- What the input does NOT say is not a gap to fill and not a gap to mention. Never narrate an absence ("nobody knows what was here before", "the story does not say").`,
        `- Do not verify, certify, rank or crown. If the input calls itself "the most famous", you may say the establishment says so; you may not upgrade a plain claim into a superlative of your own.`,
        ``,
        // ── The half that decides whether it is worth hearing ────────────────────
        `HOW TO TELL IT — one story, not a summary of the form:`,
        `1. HARD RULE — the narration's literal first words are the establishment's name, exactly as written in <partner_input>. No warm-up before it ("Olha só", "Este é", "Imagine", "This is").`,
        `2. SELECT ONE THREAD. You will receive more than fits in ${audioTarget}. Choose the SINGLE most specific thing and tell only that, well: a named person and what they did, what stood at this address before, a dated change, the one thing that exists here and nowhere else. A tight story beats a rushed inventory. (The threads you drop still go into <master_facts>.)`,
        `3. THE SUBSTITUTE TEST decides what counts as specific, and you apply it to every sentence: swap this establishment's name for another of the same kind in the same city. If the sentence stays true, it is not about this place — cut it. "Ambiente acolhedor", "sabores autorais", "feito com afeto", "uma experiência para guardar na memória" all survive the swap and are therefore not content. A founder's name, a predecessor business, a dated reversal do not survive it.`,
        `4. NO SERVICE SHEET, and this holds even though the input may be full of one: opening hours, prices, the menu, dishes on offer, payment, delivery, booking and contact are never the story. They are what every establishment has.`,
        `5. OPEN A LOOP: right after the name, hook them with the thread — a person, a tension, an implied question. Never open with a flat definition ("X é um restaurante que...").`,
        `6. CLOSE THE LOOP: land the resolution at the end of the story. Never announce it ("Uma curiosidade é que", "Sabia que", "Interestingly").`,
        `7. Vary the rhythm — mix a short punch with a longer flowing sentence. Warm and conversational, clear for a curious 15-year-old.`,
        `8. If the input is thin, tell a SHORTER, honest story. Never pad, never gush, never fill the time with praise.`,
        ...(withOffer ? [OFFER_CLOSING_RULES(input.socialHandle as string)] : []),
        ``,
        `VOICE & TTS:`,
        `- No greetings, no "welcome". Do NOT mention standalone city or state names.`,
        `- This text will be synthesized by TTS — no abbreviations, no acronyms, no symbols, no emoji.`,
        `- HARD LENGTH LIMIT: keep the narration UNDER ${maxChars} characters (~${audioTarget}${withOffer ? ', closing included' : ''}). If your draft runs longer, cut the weakest part of the STORY — never the closing, and never compress by dropping words or articles.`,
        ``,
        `OUTPUT FORMAT — use these exact XML tags, nothing outside them:`,
        `<master_description>`,
        `[the narration — one thread, under ${maxChars} characters]`,
        `</master_description>`,
        `<master_facts>`,
        `[UP TO 5 lines, ONLY facts written in <partner_input>. Fewer is fine; never pad. Format each line: Category|Fact]`,
        `</master_facts>`,
        ``,
        `EXAMPLE (illustrative only — it shows the craft, not the language; YOUR output must be entirely in ${langName}):`,
        `<example_partner_input name="Chez Michou" city="Búzios">`,
        `<answer q="who founded it and when">Uma francesa que todo mundo chamava de Michou abriu em 1983.</answer>`,
        `<answer q="what stood at this address before">Era uma janelinha de crepe na Rua das Pedras.</answer>`,
        `<answer q="what exists here that exists nowhere else">Ambiente acolhedor, sabores autorais e um atendimento que faz cada visita ser especial.</answer>`,
        `</example_partner_input>`,
        `<example_output>`,
        `<master_description>Chez Michou começou como uma janelinha de crepe na Rua das Pedras, tocada por uma francesa que todo mundo chamava de Michou. Isso foi em 1983. A fila não coube mais na calçada, e a janelinha virou a casa que está aqui na sua frente.</master_description>`,
        `<master_facts>`,
        `Founder|Uma francesa conhecida como Michou`,
        `Origin|Abriu em 1983 como uma janela de crepe na Rua das Pedras`,
        `</master_facts>`,
        `</example_output>`,
        `Note what the example DROPPED: "ambiente acolhedor, sabores autorais e um atendimento especial" survives the substitute test, so it is not in the narration and not in the facts.`,
        ``,
        `REMINDER: all text inside the XML tags must be in ${langName}.`,
    ].join('\n');

    const answers = input.blocks
        .map((block) => `<answer q="${escapeForPrompt(block.label)}">${escapeForPrompt(block.answer)}</answer>`)
        .join('\n');

    const composeUser = [
        `<partner_input name="${escapeForPrompt(input.name)}" city="${escapeForPrompt(input.city)}">`,
        answers,
        `</partner_input>`,
        withOffer
            ? `\nThe establishment's social handle, for the closing: ${input.socialHandle}`
            : `\nThere is no commercial closing in this narration. Tell the story and stop.`,
    ].join('\n');

    // Same ladder as the compose step of `generateMasterPack`, and for the same reason: the
    // flash-lite is there for when 2.5-flash flaps with a retirement 404 mid-rollout.
    const models = ['gemini-2.5-flash', 'gemini-3.1-flash-lite'];
    const attempts: string[] = [];
    let lastError: Error | null = null;

    for (const model of models) {
        const res = await callGemini(model, {
            system_instruction: { parts: [{ text: systemInstruction }] },
            contents: [{ parts: [{ text: composeUser }] }],
            // 0.7, like the master compose: storytelling needs variation, and 0.1 flattens it into
            // a list of facts — which is precisely what the substitute test is trying to avoid.
            generationConfig: { temperature: 0.7, maxOutputTokens: 4096 },
        }, apiKey);

        if (!res.ok) { attempts.push(`${model}: ${res.error}`); lastError = new Error(res.error); continue; }
        if (res.finishReason && res.finishReason !== 'STOP') {
            attempts.push(`${model}: finishReason ${res.finishReason}`);
            lastError = new Error(`finishReason ${res.finishReason}`);
            continue;
        }

        const parsed = parseNarrationOutput(res.rawText || '');
        if (!parsed) { attempts.push(`${model}: extraction failed`); lastError = new Error('extraction failed'); continue; }

        console.log(
            `[PartnerPack] model=${model} blocks=${input.blocks.length} offer=${withOffer} descLen=${parsed.description.length}`,
        );

        return {
            description: parsed.description,
            facts_pack_json: parsed.facts_pack_json,
            usage: res.usage ?? null,
            modelUsed: `partner:${model}`,
        };
    }

    const message = `PartnerPack failed: ${attempts.join(' | ')}`;
    console.error(`[PartnerPack] ${message}`);
    throw lastError ? new Error(message) : new Error(message);
};
