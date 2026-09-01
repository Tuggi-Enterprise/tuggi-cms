import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { getSecretKey } from '../_shared/secret-key.ts';
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { generateMasterPack } from "../_shared/masterPackGenerator.ts";
import {
    generatePartnerPack,
    type PartnerPackInput,
} from "../_shared/partnerPackGenerator.ts";
import { translateWithGeminiWithUsage, translatePoiNameWithUsage } from "../_shared/translationUtility.ts";

type GenerationKind = "master" | "translation";
interface CallUsage {
    input_tokens: number;
    output_tokens: number;
    model: string;
    kind: GenerationKind;
}
import { generateAudioWithTTS } from "../_shared/ttsGenerator.ts";
import { calculateHeuristicScore } from "../_shared/scoring.ts";
import {
    corsHeaders as getAuthCorsHeaders,
    validateAuthHeader,
} from "../_shared/auth-middleware.ts";
import {
    checkRateLimit,
    createRateLimitResponse,
    RATE_LIMIT_CONFIG,
} from "../_shared/rate-limiter.ts";
import { createSecureHeaders } from "../_shared/security-headers.ts";
// Validation schemas removidos - aceitamos qualquer idioma agora
import { createAuditLogger } from "../_shared/audit-logger.ts";
import { rebuildReadModel } from "../_shared/read-model.ts";
import {
    asGenerationFailure,
    createGenerationFailureResponse,
    GenerationFailure,
    GenerationFailureCode,
} from "../_shared/generation-failures.ts";
import {
    classifyProductionRequester,
    decideContentProduction,
    createProductionRefusedResponse,
} from "../_shared/content-production-gate.ts";
import {
    isComposedWithVenue,
    linkedVenueId,
    resolveVenueContext,
    selectTranslationSource,
    venueCompositionMeta,
} from "../_shared/venueComposition.ts";

// --- Types ---
interface GeneratedByInfo {
    user_id: string;
    email: string;
    source: "app_user" | "cms_admin" | "system";
}

interface SingleRequest {
    poi_id: string;
    language: string;
    gender?: "male" | "female";
    generate_audio?: boolean; // Default true
    audio_duration?: number;
    raw_context?: string; // CMS override
    force?: boolean;
    /**
     * WHAT THE PARTNER SENT ABOUT THEIR OWN PLACE — the only source a partner narration has.
     *
     * BR-B2B-016, item 1: the paid tier's description is produced out of what the establishment
     * sends, and BR-B2B-025 says why that matters — Tuggi NARRATES it, as reported, and does not
     * verify it. It arrives in the request instead of being read from `partner` here because the
     * curator is who assembles it: gate 2 of BR-B2B-011 is applied by a person, and the CMS is
     * where they see the answers, correct them and decide there is something to tell.
     *
     * Absent on every other request, and every other request behaves exactly as it always has.
     */
    partner_input?: PartnerPackInput;
}

interface BatchRequest {
    user_location?: { lat: number; lng: number };
    language: string;
    gender?: "male" | "female";
    user_tier?: string;
    requests: {
        poi_id: string;
        trigger_point_id?: string;
        trigger_point?: { lat: number; lng: number };
        poi_type?: string;
    }[];
    generate_audio?: boolean;
    audio_duration?: number;
    force?: boolean;
}

// --- Configuration ---
const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers":
        "authorization, x-client-info, apikey, content-type, x-requested-with, accept, origin, referer, user-agent",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SECRET_KEY = getSecretKey();
const GEMINI_API_KEY = Deno.env.get("GOOGLE_GEMINI_API_KEY") ||
    Deno.env.get("GEMINI_API_KEY") || "";
const GOOGLE_TTS_API_KEY = Deno.env.get("GOOGLE_TTS_API_KEY") ||
    Deno.env.get("GOOGLE_CLOUD_API_KEY") || "";

const supabaseAdmin = createClient(SUPABASE_URL, SECRET_KEY);

// --- Helpers ---
function calculateDistance(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number,
): number {
    const R = 6371e3; // metres
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
        Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

async function hashDescription(text: string): Promise<string> {
    const msgUint8 = new TextEncoder().encode(text);
    const hashBuffer = await crypto.subtle.digest("SHA-256", msgUint8);
    return Array.from(new Uint8Array(hashBuffer)).map((b) =>
        b.toString(16).padStart(2, "0")
    ).join("");
}

// --- Core Processor (Sync) ---
/**
 * A PARTNER'S PLACE IS NEVER RESEARCHED, and this is the error that says so.
 *
 * BR-B2B-016, item 9: a free-tier partner place does not trigger on-demand narration production —
 * the first named exception to BR-CONTEUDO-001 mode 2. If it did, it would be getting the paid
 * tier for free and item 1 would be false with nobody having decided anything.
 *
 * THE GUARD IS WIDER THAN THE TIER, AND ON PURPOSE. It does not ask which tier the place is on —
 * resolving that here would mean a second implementation of `derivePartnerPlan`, in Deno, three
 * tables away, and the two would disagree the first time one moved. It asserts the invariant that
 * covers both tiers instead: **a narration about a partner's place comes from the partner's own
 * input, never from a web search**. That is BR-B2B-025 — Tuggi narrates what the establishment
 * asserts — and the CMS is the only caller that has that input to send.
 *
 * What it does NOT block is translating a description that already exists, whatever produced it.
 * That is BR-CONTEUDO-001 mode 1, it makes no new claim about the place, and blocking it would
 * degrade a partner POI that the catalogue narrated long before the partnership — which the 5th
 * edge case of BR-B2B-016 forbids ("'Somente o nome' não é degradação do que já existe").
 */
const PARTNER_WITHOUT_INPUT = "partner_place_requires_partner_input";

async function processPOIItem(
    poi_id: string,
    language: string,
    gender: "male" | "female",
    shouldGenerateAudio: boolean,
    poiDataFromDB: any,
    rawContextOverride?: string,
    force?: boolean,
    audioDuration?: number,
    generatedBy?: GeneratedByInfo,
    partnerInput?: PartnerPackInput,
): Promise<any> {
    const LOG_PREFIX = `[Gen-Desc::${poi_id}]`;
    console.log(`${LOG_PREFIX} Processing for ${language} (${gender})...`);

    /**
     * LATÊNCIA POR ETAPA — uma linha, em ms, no fim do processamento de cada POI.
     *
     * POR QUE MEDIR AQUI. Os `console.log` existentes marcavam POSIÇÃO, não tempo: dava para
     * saber que a geração passou pelo retrieval, não quanto ela ficou lá. Reconstruir a
     * duração por delta de timestamp entre linhas de log funciona para uma medição pontual e
     * não sobrevive a um lote (várias iterações no mesmo isolate) nem a uma etapa que não
     * loga — TTS e upload não logavam nada.
     *
     * O relógio é sequencial de propósito: cada `mark` fecha o intervalo desde o anterior, o
     * que só é verdade porque este caminho é serial do começo ao fim.
     */
    const t0 = Date.now();
    const stage: Record<string, number> = {};
    let lastMark = t0;
    const mark = (name: string) => {
        const now = Date.now();
        stage[name] = (stage[name] ?? 0) + (now - lastMark);
        lastMark = now;
    };
    const logTiming = (outcome: string) => {
        const parts = Object.entries(stage).map(([k, v]) => `${k}_ms=${v}`).join(" ");
        console.log(`${LOG_PREFIX}[timing] outcome=${outcome} total_ms=${Date.now() - t0} ${parts}`);
    };

    // ✅ TIPO DA ENTIDADE: POI, evento e local vivem na mesma tabela e até aqui
    // recebiam o mesmo prompt de "lugar" — que pede ano de fundação e fala em
    // "standing in front of this place". Certo para um POI, errado para um show
    // daqui a três semanas ou para um hotel.
    //
    // As extensões vêm como array no PostgREST (relação 1:1 declarada como
    // to-many), daí o [0]. Ausentes = undefined, e o gerador cai no ramo 'poi',
    // que é idêntico ao comportamento de sempre.
    const eventDetails = Array.isArray(poiDataFromDB?.event_details)
        ? poiDataFromDB.event_details[0]
        : poiDataFromDB?.event_details;
    const placeDetails = Array.isArray(poiDataFromDB?.place_details)
        ? poiDataFromDB.place_details[0]
        : poiDataFromDB?.place_details;

    // BR-EVENTO-002 — id do POI anfitrião, e o portão de tudo que é composição.
    // null para POI, para `place` e para o evento autônomo (que "narra por conta
    // própria e não passa por esta regra"): com null, cada passo abaixo fica
    // idêntico ao que era. Resolvido aqui em cima, e não só na geração fresca,
    // porque o cache e a tradução também precisam dele — sem custo de query, o
    // vínculo já veio junto com o POI.
    const venueId = linkedVenueId(poiDataFromDB?.entity_kind, eventDetails);

    /**
     * TEXTO QUE JÁ EXISTE E SÓ PRECISA DE VOZ — capturado aqui e reusado lá embaixo.
     *
     * O caminho "descrição existe, `audio_url` não" cai do cache para a geração, e o comentário
     * dele sempre disse `The description text will be reused (no LLM call needed)`. Não era
     * verdade: o passo 3.1 só reusa por TRADUÇÃO, e tradução exige uma fonte em OUTRO idioma —
     * no mesmo idioma não há fonte, então o texto era regerado do zero, com chamada de LLM, e
     * substituía o que já estava lá.
     *
     * Isso passou despercebido porque o resultado ainda era uma descrição. Deixou de passar em
     * 2026-08-26, quando o local de parceiro ganhou a guarda `PARTNER_WITHOUT_INPUT`: sem insumo
     * no corpo, gerar é recusado — e pedir só o áudio de um parceiro passou a estourar. A guarda
     * está certa e o que estava errado é ela alcançar este caminho: **sintetizar voz sobre um
     * texto gravado não produz afirmação nenhuma sobre o lugar**, e é BR-CONTEUDO-001 modo 1 pelo
     * mesmo motivo que traduzir não é produzir.
     *
     * Vale para todo o catálogo, não só para parceiro: uma chamada de LLM a menos por POI nesse
     * estado, e o texto que o curador aprovou para de ser trocado por um novo pelas costas.
     */
    let cachedForAudioOnly: { description: string; facts_pack_json: any } | null = null;

    /**
     * A LINHA COMO ELA ESTAVA ANTES DO LOCK — para devolvê-la se a geração falhar.
     *
     * O passo 2 toma o lock SOBRESCREVENDO a linha com `[PROCESSING]`, e o `catch` do passo 3
     * APAGA essa linha. Juntos, os dois transformam qualquer falha de geração na destruição
     * silenciosa do que já estava publicado — inclusive uma narração que um curador aprovou.
     *
     * Ficou latente por muito tempo porque falha de geração era rara e o retry seguinte
     * reescrevia algo. Deixou de ser latente em 2026-08-26: a guarda `PARTNER_WITHOUT_INPUT`
     * recusa local de parceiro sem insumo, e ela estoura DEPOIS do lock — então cada visita do
     * app a um local de faixa gratuita apagava a descrição dele. Foi assim que
     * `Sabor e Arte Restaurante` ficou sem linha nenhuma.
     *
     * Guardar e restaurar conserta a classe inteira, não só o caso do parceiro: falha de rede,
     * finishReason ruim, cota da API — nenhuma delas deveria custar o conteúdo que estava no ar.
     */
    let rowBeforeLock: Record<string, unknown> | null = null;

    // 1. Optimistic Locking / Cache Check Loop (Max 15s)
    // We check if content exists. If it's "[PROCESSING]", we wait.
    let attempts = 0;
    while (attempts < 15) {
        const { data: existing } = await supabaseAdmin.schema("core")
            .from("attraction_descriptions")
            // `generation_meta` entra na mesma query (custo zero) porque é a única
            // coisa que distingue uma descrição de evento composta com o anfitrião
            // de uma escrita quando ele ainda não estava vinculado — BR-EVENTO-002.
            .select("updated_at, facts_pack_json, description, audio_url, id, generation_meta, name, verification_status")
            .eq("attraction_id", poi_id)
            .eq("language", language)
            .eq("gender", gender)
            .maybeSingle();

        if (existing) {
            // O que o lock vai sobrescrever. `[PROCESSING]` não se guarda: é o próprio lock.
            if (existing.description && existing.description !== "[PROCESSING]") {
                rowBeforeLock = existing as Record<string, unknown>;
            }
            // If valid content found
            if (
                existing.description && existing.description !== "[PROCESSING]"
            ) {
                // Check staleness (30 days)
                const isStale = new Date().getTime() -
                        new Date(existing.updated_at).getTime() >
                    1000 * 60 * 60 * 24 * 30;
                // ✅ FIX: Cache hit is only valid if audio_url ALSO exists.
                // A record with description but null audio_url means TTS synthesis
                // never ran (or failed). We must continue to generate the audio.
                // The description text will be reused (no LLM call needed).
                const hasAudio = shouldGenerateAudio ? !!existing.audio_url : true;
                // ✅ BR-EVENTO-002 item 2: a narração composta CONTÉM o POI anfitrião.
                // Compor só acontece na geração fresca, então a descrição escrita
                // enquanto o evento ainda era autônomo sobrevive no cache depois que
                // o curador cria o vínculo no CMS — e nunca menciona o POI. Sem a
                // marca na trilha não há como distinguir uma da outra, então isto
                // falha FECHADO: sem marca, regera uma vez (e sai marcada). Só vale
                // para evento vinculado — venueId é null em todo o resto.
                const composedWithVenue = !venueId ||
                    isComposedWithVenue(existing.generation_meta, venueId);
                if (!composedWithVenue) {
                    console.log(
                        `${LOG_PREFIX} Cache Hit, mas a descrição não foi composta com o anfitrião ${venueId} (BR-EVENTO-002). Regerando uma vez.`,
                    );
                }
                if (!force && !isStale && (existing.facts_pack_json?.length > 0) && hasAudio && composedWithVenue) {
                    console.log(`${LOG_PREFIX} Cache Hit (Fresh). Returning.`);
                    // `generation_meta` é trilha interna e entrou na query só para a
                    // decisão acima: fica fora da resposta, que continua byte a byte
                    // a de antes.
                    const { generation_meta: _trail, ...hit } = existing;
                    mark("lookup");
                    logTiming("hit");
                    return { ...hit, status: "hit" };
                }
                // SEM EXIGIR `facts_pack_json`, e a assimetria com o ramo acima é o ponto.
                //
                // Ter fatos responde `esta narração está completa o bastante para eu devolvê-la
                // como hit?`. Só falar o texto que já está gravado não faz essa pergunta: não há
                // narração sendo produzida, há voz sendo dada a um texto que alguém já aprovou.
                //
                // Medido em 2026-08-26: a descrição da faixa gratuita é o NOME do estabelecimento
                // e nasce com `facts_pack_json = []` — porque um nome próprio não tem fato a
                // empacotar, e inventar um para satisfazer este gate seria mentir na trilha. Com a
                // exigência aqui, os 19 locais do backfill caíam para a geração fresca e batiam na
                // guarda `PARTNER_WITHOUT_INPUT`: texto trocado, áudio nenhum, local mudo.
                if (!force && !isStale && !hasAudio) {
                    console.log(`${LOG_PREFIX} Cache Hit (Description only, audio_url missing). Proceeding to TTS synthesis.`);
                    // E o texto vai JUNTO, que é o que o comentário sempre prometeu — ver
                    // `cachedForAudioOnly` no topo. Sem isto o passo 3 regera do zero.
                    cachedForAudioOnly = {
                        description: existing.description,
                        facts_pack_json: existing.facts_pack_json,
                    };
                }
                // If Stale, fall through to regenerate
            } else if (existing.description === "[PROCESSING]") {
                // Check if Lock is Zombie (> 60s)
                const lockTime = new Date(existing.updated_at).getTime();
                const now = new Date().getTime();
                if (now - lockTime > 60000) {
                    console.warn(
                        `${LOG_PREFIX} Zombie Lock detected. Taking over.`,
                    );
                    // Break loop to regenerate
                    break;
                }
                // Wait and Retry
                console.log(
                    `${LOG_PREFIX} Locked by another process. Waiting...`,
                );
                await new Promise((r) => setTimeout(r, 1000));
                attempts++;
                continue;
            }
        }
        break; // No existing record (or stale/zombie), proceed to generate
    }
    mark("lookup");

    // 2. Lock Acquisition
    // Attempt to insert "Processing" placeholder
    // If conflict, another process just started -> Loop again (via recursion/retry logic ideally, but simple here)
    const { error: lockError } = await supabaseAdmin.schema("core").from(
        "attraction_descriptions",
    ).upsert({
        attraction_id: poi_id,
        language: language,
        gender: gender,
        description: "[PROCESSING]",
        updated_at: new Date().toISOString(),
    }, { onConflict: "attraction_id,language,gender" });

    if (lockError) {
        console.warn(
            `${LOG_PREFIX} Failed to acquire lock, assuming race condition. Raising a typed failure (client will retry).`,
            lockError,
        );
        // ISTO ERA UM `return { error, status: "retry" }` — e o chamador single o
        // embrulhava em **HTTP 200 `{ success: true, data: … }`**, o lote em
        // `status: "success"`. Objeto com a chave `error` dentro de um 200 é
        // invisível para o app: o ramo que classifica é o `if (error)` de
        // `invokeWithAuthRetry`, que só existe para não-2xx (contrato
        // `docs/contracts/edge-functions.md`). Ninguém retentava porque ninguém
        // via, e o POI ficava sem narração para a avaliação seguinte —
        // BR-CONTEUDO-004 item 5.
        logTiming("locked");
        throw new GenerationFailure(GenerationFailureCode.GENERATION_LOCKED);
    }
    mark("lock");

    try {
        // 3. Generation Logic
        let result: { description: string; facts_pack_json: any } | null = null;
        let callUsage: CallUsage | null = null;
        // Confiança factual: true por padrão (tradução herda do master vetado).
        // Vira false quando a geração fresca caiu no SAFE MODE (sem grounding) →
        // marca needs_review pra um humano conferir antes de "aprovar".
        let groundedOk = true;
        // Trilha de procedência da descrição (gravada de forma defensiva no fim).
        let generationMeta: Record<string, unknown> | null = null;
        // Location context for grounding — use the POI's real country (canonical,
        // English) instead of assuming Brazil. Falls back from city → state → country.
        const cityName = [
            poiDataFromDB?.city || poiDataFromDB?.osm_tags?.["addr:city"] || null,
            poiDataFromDB?.state || null,
            poiDataFromDB?.country || null,
        ].filter(Boolean).join(", ") || "an unknown location";
        const poiName = poiDataFromDB?.name || "Unknown Point";

        // 3.0 O texto que já estava lá, quando a única coisa que falta é a voz. Vem antes da
        // tradução e antes da geração porque é mais barato que as duas e mais fiel que ambas: é
        // exatamente o texto que o curador aprovou.
        if (!force && cachedForAudioOnly) {
            console.log(`${LOG_PREFIX} Reusing the stored ${language} text — TTS only, no LLM call.`);
            result = cachedForAudioOnly;
            generationMeta = { kind: "tts_only", grounded: null };
        }

        // 3.1 Check existing descriptions for potential translation source
        // We try to find any existing description to translate FROM, 
        // prioritizing pt-br if target is not pt-br, or just taking any available one.
        // SKIP this if 'force' is true (user wants a fresh generation)
        if (!force && !result) {
            const { data: candidates } = await supabaseAdmin.schema("core")
                .from("attraction_descriptions")
                .select("description, facts_pack_json, language, generation_meta")
                .eq("attraction_id", poi_id)
                .neq("description", "[PROCESSING]") // Ignore locks
                .limit(10);

            if (candidates && candidates.length > 0) {
                // Find a source that is different from our target language,
                // prioritizing pt-br. Para evento vinculado, a fonte precisa ter sido
                // composta com o MESMO anfitrião (BR-EVENTO-002 item 2) — a escolha
                // inteira mora em _shared/venueComposition.ts, com os testes.
                // Sem fonte utilizável, cai na geração fresca abaixo, que compõe.
                const source = selectTranslationSource(candidates, language, venueId);

                if (source) {
                    console.log(
                        `${LOG_PREFIX} Translating from existing ${source.language} to ${language}...`,
                    );
                    const { text: translated, usage: tUsage } = await translateWithGeminiWithUsage(
                        source.description,
                        language,
                        GEMINI_API_KEY,
                    );
                    result = {
                        description: translated,
                        facts_pack_json: source.facts_pack_json,
                    };
                    if (tUsage) {
                        callUsage = { ...tUsage, kind: "translation" };
                    }
                    // Trilha: traduzido de outro idioma (grounding herdado do master).
                    // A marca do anfitrião também é herdada: a fonte só chegou aqui
                    // por ter sido composta com ele, e o texto traduzido carrega o
                    // POI junto — sem isto, o idioma novo seria regerado a cada
                    // disparo por parecer não-composto (BR-EVENTO-002 item 2).
                    generationMeta = {
                        kind: "translation",
                        source_language: source.language,
                        grounded: null,
                        ...(venueId
                            ? venueCompositionMeta(
                                venueId,
                                (source.generation_meta as { venue_facts_language?: string | null })
                                    ?.venue_facts_language ?? null,
                                true,
                            )
                            : {}),
                    };
                }
            }
        } else {
            console.log(`${LOG_PREFIX} Force flag detected. Skipping translation and generating fresh.`);
        }

        // 3.2 Full Generation
        //
        // A PARTNER GOES THROUGH HERE AND NEVER THROUGH THE MASTER. `generateMasterPack` is a
        // two-step RAG that MAKES THE MODEL SEARCH the web; for a partner's place that is wrong by
        // rule and not by taste — BR-B2B-025: the input is theirs, they answer for it, and Tuggi
        // narrates what they assert. See `PARTNER_WITHOUT_INPUT` above.
        const partnerClientId = poiDataFromDB?.partner_client_id ?? null;
        if (!result && partnerClientId) {
            if (!partnerInput || !(partnerInput.blocks || []).length) {
                console.warn(
                    `${LOG_PREFIX} Partner place (client ${partnerClientId}) with no input in the request — nothing is generated (BR-B2B-016, item 9).`,
                );
                throw new Error(PARTNER_WITHOUT_INPUT);
            }

            // `audioDuration` comes from the CMS, the only caller with input to send, and the
            // 10–15s target lives there (`PARTNER_AUDIO_SECONDS`). No number is born here: a
            // partner default on this line would be the second home of the same target.
            const partnerResult = await generatePartnerPack(
                partnerInput,
                language,
                GEMINI_API_KEY,
                audioDuration ?? 25,
            );
            result = {
                description: partnerResult.description,
                facts_pack_json: partnerResult.facts_pack_json,
            };
            // `grounded` stays true: there IS a factual base and it is the establishment itself —
            // the narration was not invented by the model, which is what `groundedOk` guards.
            // Whoever asserted the fact answers for it (BR-B2B-025, item 1).
            generationMeta = {
                kind: "partner_story",
                grounded: true,
                partner_client_id: partnerClientId,
                // Whether the audio carries the identified commercial closing (BR-B2B-016, item
                // 8). Recorded because it is what tells a description that may go on air from one
                // still waiting on the identification formula — `_perguntas-abertas.md` 85.
                offer: !!(partnerInput.withOffer && partnerInput.socialHandle),
                models: partnerResult.modelUsed,
            };
            if (partnerResult.usage) {
                callUsage = { ...partnerResult.usage, kind: "master" };
            }
        }

        if (!result) {
            console.log(`${LOG_PREFIX} Generating FRESH Master (Gemini)...`);
            
            // Check for group membership (Parent/Main POI)
            let memberPois = [];
            const { data: groupMembership } = await supabaseAdmin.schema("core")
                .from("attraction_group_members")
                .select("group_id")
                .eq("attraction_id", poi_id)
                .eq("group_role", "main")
                .maybeSingle();
            
            if (groupMembership) {
                console.log(`${LOG_PREFIX} Recognized as Group Parent (Group: ${groupMembership.group_id}). Fetching members...`);
                const { data: siblings } = await supabaseAdmin.schema("core")
                    .from("attraction_group_members")
                    .select("attraction_id")
                    .eq("group_id", groupMembership.group_id)
                    .neq("attraction_id", poi_id);
                
                if (siblings && siblings.length > 0) {
                    const siblingIds = siblings.map(s => s.attraction_id);
                    const { data: memberInfos } = await supabaseAdmin.schema("core")
                        .from("attractions")
                        .select("name, category, type")
                        .in("id", siblingIds);
                    memberPois = memberInfos || [];
                    console.log(`${LOG_PREFIX} Found ${memberPois.length} member POIs for context.`);
                }
            }

            // ✅ Cenário 1 — evento vinculado a um POI anfitrião: compõe "dados do
            // POI + evento de forma contextual". SÓ entra quando há vínculo (o
            // `venueId` resolvido no topo). POI e evento-sem-vínculo passam por aqui
            // com venue=null e o prompt fica idêntico ao de sempre.
            let venue: { name: string; facts?: string | null } | null = null;
            // Marca da trilha (BR-EVENTO-002 item 2). Escrita SEMPRE que há vínculo,
            // inclusive quando a composição não foi possível: sem marca, o cache
            // acima nunca aceita a linha e todo disparo paga uma geração nova.
            let venueMeta: Record<string, unknown> | null = null;
            if (venueId) {
                const { data: venueRow } = await supabaseAdmin.schema("core")
                    .from("attractions").select("name").eq("id", venueId).maybeSingle();
                if (venueRow?.name) {
                    // Usa a narração JÁ existente do POI como contexto: não re-pesquisa
                    // o POI e NUNCA escreve nele — BR-EVENTO-002 item 3, a descrição e o
                    // áudio do anfitrião não são tocados por causa de evento. Se o POI
                    // não tem descrição em idioma nenhum, o gerador ancora só pelo nome
                    // (BR-CONTEUDO-002: isso não bloqueia nem dispara geração do POI).
                    // A escolha de nome e fatos por idioma é BR-CONTEUDO-001 e mora em
                    // _shared/venueComposition.ts. `name` sai da mesma query dos fatos.
                    // Limite 20 (era 8): um POI com 5 idiomas × 2 gêneros tem 10 linhas,
                    // e as 8 mais recentes podiam não incluir a do idioma-alvo.
                    const { data: venueDescs } = await supabaseAdmin.schema("core")
                        .from("attraction_descriptions")
                        .select("description, language, name")
                        .eq("attraction_id", venueId)
                        .neq("description", "[PROCESSING]")
                        .order("updated_at", { ascending: false })
                        .limit(20);
                    const ctx = resolveVenueContext(
                        venueRow.name,
                        language,
                        venueDescs || [],
                    );
                    venue = { name: ctx.name, facts: ctx.facts };
                    venueMeta = venueCompositionMeta(venueId, ctx.factsLanguage, true);
                    console.log(
                        `${LOG_PREFIX} Compondo com o anfitrião ${venueId} (nome="${ctx.name}", fatos=${ctx.factsLanguage ?? "nenhum"}).`,
                    );
                } else {
                    // Vínculo pendurado: o anfitrião não existe. Regerar não conserta —
                    // o conserto é no cadastro, pelo CMS. Marca assim mesmo para não
                    // virar geração infinita atrás de uma composição impossível.
                    console.warn(
                        `${LOG_PREFIX} venue_attraction_id ${venueId} não resolve para nenhuma attraction — evento narrado sem o anfitrião (BR-EVENTO-002).`,
                    );
                    venueMeta = venueCompositionMeta(venueId, null, false);
                }
            }

            const masterResult = await generateMasterPack(
                poiName,
                cityName,
                rawContextOverride || "App Batch Generation",
                language,
                GEMINI_API_KEY,
                undefined, // poiData
                audioDuration,
                memberPois,
                poiDataFromDB?.reference_links || [], // Links de referência do CMS
                {
                    kind: (poiDataFromDB?.entity_kind === "event" ||
                            poiDataFromDB?.entity_kind === "place")
                        ? poiDataFromDB.entity_kind
                        : "poi",
                    startsAt: eventDetails?.starts_at ?? null,
                    endsAt: eventDetails?.ends_at ?? null,
                    category: eventDetails?.event_category ?? null,
                    placeType: placeDetails?.place_type ?? null,
                    venue,
                },
            );
            result = {
                description: masterResult.description,
                facts_pack_json: masterResult.facts_pack_json,
            };
            // Geração fresca sem fontes (SAFE MODE) → baixa confiança factual.
            groundedOk = masterResult.grounded !== false;
            // Trilha: gerado via RAG 2 passos.
            generationMeta = {
                kind: "master_2step",
                grounded: masterResult.grounded ?? null,
                sources: masterResult.sourceCount ?? 0,
                models: masterResult.modelUsed ?? null,
                safe_mode: masterResult.grounded === false,
                // #652 — o pedágio de grounding é 94% da conta de Gemini, e a família 3.x
                // cobra por search QUERY executada (US$ 14/1.000) enquanto a 2.5 cobra por
                // prompt (US$ 35/1.000). A fatura sozinha dá o total e não dá queries/prompt,
                // que é o número que decide a família em outubro/2026 — equilíbrio em ~2,95.
                // Fica na trilha porque ela já é payload JSON: nenhuma coluna nova.
                search_queries: masterResult.searchQueryCount ?? 0,
                retrieval_attempts: masterResult.retrievalAttempts ?? 0,
                ...(venueMeta || {}),
            };
            if (!groundedOk) {
                console.warn(`${LOG_PREFIX} SAFE MODE (sem grounding) — marcando needs_review.`);
            }
            if (masterResult.usage) {
                callUsage = { ...masterResult.usage, kind: "master" };
            }
        }

        mark(generationMeta?.kind ? `gen_${generationMeta.kind}` : "gen");

        // 4. Save & Audio
        const scoreResult = calculateHeuristicScore(
            result.description,
            result.facts_pack_json || [],
            poiName,
            cityName,
        );
        console.log(`${LOG_PREFIX} Heuristic Score calculated:`, scoreResult.score_overall);
        const descHash = await hashDescription(result.description);
        // Auto-aprova só quando há base factual (grounded ou tradução de master vetado).
        // SAFE MODE (sem fontes) → needs_review, pra um humano conferir.
        const isApproved = groundedOk;

        // 4.1 Translate the POI name into the target language (proper-noun aware:
        // exonym, else transliterate). Gender-independent; uses the generated
        // description as disambiguation context. Best-effort — a name failure
        // must not block the description/audio package.
        let translatedName: string | null = null;
        if (poiName && poiName !== "Unknown Point") {
            try {
                const { text: nameText } = await translatePoiNameWithUsage(
                    poiName,
                    language,
                    GEMINI_API_KEY,
                    result.description.slice(0, 200),
                );
                translatedName = nameText;
                console.log(`${LOG_PREFIX} Name translated="${translatedName}"`);
            } catch (nameErr) {
                console.warn(`${LOG_PREFIX} ⚠️ Name translation skipped:`, nameErr);
            }
            mark("name_translate");
        }

        let publicUrl: string | null = null;
        /**
         * POR QUE A FALHA DE ÁUDIO É GUARDADA E NÃO LANÇADA AQUI.
         *
         * Pedimos áudio e não temos áudio: isso não é 200 (ver o `throw` no fim
         * deste bloco `try`). Mas lançar NESTA linha jogaria fora o texto que
         * acabou de custar uma chamada de LLM — e o passo 5 abaixo é justamente
         * o que torna a próxima tentativa barata: com a linha gravada e
         * `audio_url` nulo, o retry cai no caminho `cachedForAudioOnly`
         * ("Cache Hit (Description only, audio_url missing)") e refaz **só** o
         * TTS. Grava-se tudo, contabiliza-se tudo, e só então se responde erro.
         *
         * As duas causas ficam separadas porque têm donos diferentes: chave de
         * TTS ausente é configuração nossa e some com um `secrets set`; upload
         * recusado é o Storage. Antes, as duas eram o mesmo silêncio — o `upErr`
         * nem log tinha.
         */
        let audioFailureReason: string | null = null;
        if (shouldGenerateAudio) {
            if (!GOOGLE_TTS_API_KEY) {
                console.error(
                    `${LOG_PREFIX} ❌ GOOGLE_TTS_API_KEY ausente — nenhum áudio pode ser sintetizado.`,
                );
                audioFailureReason = "tts_key_missing";
            } else {
                const audioBuffer = await generateAudioWithTTS(
                    result.description,
                    language,
                    gender,
                    GOOGLE_TTS_API_KEY,
                );
                mark("tts");
                const fileName = `${poi_id}-${language}-${gender}.mp3`;
                const storagePath = `master_audio/${poi_id}/${fileName}`;
                const { error: upErr } = await supabaseAdmin.storage.from(
                    "travel-app-audios",
                ).upload(storagePath, audioBuffer, {
                    contentType: "audio/mpeg",
                    upsert: true,
                });
                mark("audio_upload");
                if (upErr) {
                    console.error(
                        `${LOG_PREFIX} ❌ Falha ao subir ${storagePath}: ${upErr.message}`,
                    );
                    audioFailureReason = "storage_upload_failed";
                } else {
                    const { data: urlData } = supabaseAdmin.storage.from(
                        "travel-app-audios",
                    ).getPublicUrl(storagePath);
                    publicUrl = urlData.publicUrl;
                }
            }
        }

        // 5. Final Update (Release Lock)
        const { data: finalRows, error: finalError } = await supabaseAdmin.schema("core").from(
            "attraction_descriptions",
        ).upsert({
            attraction_id: poi_id,
            language: language,
            gender: gender,
            description: result.description,
            facts_pack_json: result.facts_pack_json,
            audio_url: publicUrl,
            updated_at: new Date().toISOString(),
            verification_status: isApproved ? "approved" : "needs_review",
            last_score_overall: scoreResult.score_overall,
            last_score_version: "v2-flash-heuristic",
            facts_version: 2,
            // Gender-independent translated name (null only if translation failed).
            ...(translatedName ? { name: translatedName } : {}),
        }, { onConflict: "attraction_id,language,gender" }).select().single();
        mark("upsert");

        // 5.0.-1 O UPSERT PODE FALHAR, E ELE NÃO ERA CONFERIDO.
        //
        // Sem esta guarda, `finalRows` voltava `null`, o `return` lá embaixo
        // espalhava `{ ...null, status: "generated" }` — um 200 `success: true`
        // SEM a chave `audio_url` e sem uma linha gravada —, e os passos 5.1 a
        // 5.3 se puliam sozinhos por `finalRows?.id`. Falhar de tudo respondendo
        // sucesso é a pior das três formas do mesmo defeito.
        //
        // O `throw` sai ANTES da remoção do mp3 antigo (5.0.0), e a ordem é o
        // ponto: o banco ainda aponta para o áudio que estava no ar, então
        // apagá-lo aqui deixaria o POI mudo por uma falha nossa. O `catch`
        // devolve a linha de antes do lock — ela ainda está em `[PROCESSING]`,
        // que é o filtro que a restauração usa.
        if (finalError || !finalRows) {
            console.error(
                `${LOG_PREFIX} ❌ Upsert final não gravou: ${finalError?.message ?? "sem linha de retorno"}`,
            );
            throw new GenerationFailure(
                GenerationFailureCode.DESCRIPTION_WRITE_FAILED,
                finalError?.code ?? "no_row_returned",
            );
        }

        // 5.0.0 REGRA (invariante de áudio): texto novo NUNCA pode ficar pareado com
        // áudio antigo. Quando não geramos áudio novo (text-only, ou TTS falhou),
        // publicUrl é null → apagamos o mp3 antigo do storage. Assim `audio_url null`
        // ⟺ nenhum arquivo existe, e o app não baixa/toca áudio velho — nem por URL
        // cacheada, nem por reconstrução determinística do path. O áudio será regerado
        // limpo no futuro. Roda DEPOIS do upsert (que já gravou audio_url=null): se a
        // remoção falhar, o banco já não aponta pro arquivo, então nada é servido.
        // (Quando geramos áudio, o TTS já sobrescreve o mesmo path via upsert:true.)
        if (!publicUrl) {
            const stalePath = `master_audio/${poi_id}/${poi_id}-${language}-${gender}.mp3`;
            const { error: rmErr } = await supabaseAdmin.storage
                .from("travel-app-audios").remove([stalePath]);
            if (rmErr) {
                console.warn(`${LOG_PREFIX} ⚠️ Falha ao remover áudio antigo ${stalePath}: ${rmErr.message}`);
            } else {
                console.log(`${LOG_PREFIX} 🗑️ Áudio antigo removido (texto novo sem áudio novo): ${stalePath}`);
            }
        }

        // 5.0.1 Passo (c): reconstruir a linha do POI no read-model app_poi_read
        // logo após gravar description/audio_url, senão o guia (app_get_pois_by_cone)
        // não enxerga o conteúdo novo até o cron rodar. Best-effort (não bloqueia).
        await rebuildReadModel(supabaseAdmin, poi_id);
        mark("read_model");

        // 5.1 Track who generated this description (non-blocking, defensive)
        // Runs as a separate UPDATE so that if the generated_by columns don't exist
        // yet (migration not applied), the main generation flow is NOT affected.
        if (generatedBy && finalRows?.id) {
            try {
                await supabaseAdmin.schema("core")
                    .from("attraction_descriptions")
                    .update({
                        generated_by_user_id: generatedBy.user_id,
                        generated_by_email: generatedBy.email,
                        generated_by_source: generatedBy.source,
                    })
                    .eq("id", finalRows.id);
                console.log(`${LOG_PREFIX} ✅ Generated-by tracked: ${generatedBy.source} (${generatedBy.email})`);
            } catch (trackingErr) {
                console.warn(`${LOG_PREFIX} ⚠️ Generated-by tracking skipped (columns may not exist yet):`, trackingErr);
            }
        }

        // 5.2 Track Gemini token usage (non-blocking, defensive)
        // Same pattern as generated_by: separate UPDATE so a missing migration
        // doesn't break the main generation flow.
        if (callUsage && finalRows?.id) {
            try {
                await supabaseAdmin.schema("core")
                    .from("attraction_descriptions")
                    .update({
                        input_tokens: callUsage.input_tokens,
                        output_tokens: callUsage.output_tokens,
                        llm_model: callUsage.model,
                        generation_kind: callUsage.kind,
                    })
                    .eq("id", finalRows.id);
                console.log(`${LOG_PREFIX} ✅ Token usage tracked: kind=${callUsage.kind} model=${callUsage.model} in=${callUsage.input_tokens} out=${callUsage.output_tokens}`);
            } catch (tokenErr) {
                console.warn(`${LOG_PREFIX} ⚠️ Token usage tracking skipped (columns may not exist yet):`, tokenErr);
            }
        }

        // 5.3 Track grounding provenance (trilha de criação) — defensivo: UPDATE
        // separado pra não quebrar se as colunas (grounded/generation_meta) ainda
        // não existirem no banco. Co-localizado p/ análise futura sem fetch extra.
        if (generationMeta && finalRows?.id) {
            try {
                const groundedVal = (generationMeta.grounded === true || generationMeta.grounded === false)
                    ? generationMeta.grounded
                    : null;
                await supabaseAdmin.schema("core")
                    .from("attraction_descriptions")
                    .update({ grounded: groundedVal, generation_meta: generationMeta })
                    .eq("id", finalRows.id);
                console.log(`${LOG_PREFIX} ✅ Grounding trail tracked:`, JSON.stringify(generationMeta));
            } catch (gErr) {
                console.warn(`${LOG_PREFIX} ⚠️ Grounding trail skipped (columns may not exist yet):`, gErr);
            }
        }

        console.log(`${LOG_PREFIX} Final Upsert Score:`, scoreResult.score_overall);

        // PEDIU ÁUDIO E NÃO HÁ ÁUDIO: ISSO NÃO É SUCESSO — BR-CONTEUDO-004 item 5.
        //
        // Aqui embaixo de propósito: o texto já está gravado, o read-model já
        // foi reconstruído e os tokens já foram contabilizados. O que muda é só
        // a resposta — de 200 com `audio_url: null` para 502
        // `audio_synthesis_failed`, que é o que o app consegue classificar
        // (`audioGenerationFailure.ts`; um 200 nunca entra no ramo `if (error)`).
        //
        // O `catch` abaixo NÃO desfaz nada neste ponto: a restauração e o
        // `delete` filtram por `description = "[PROCESSING]"`, e a linha já saiu
        // desse estado no passo 5. Era isto que fazia valer a pena gravar antes
        // de falhar — a próxima tentativa refaz só o TTS.
        //
        // `shouldGenerateAudio === false` (texto puro, pedido do CMS) não passa
        // por aqui: `audioFailureReason` só é escrito quando o áudio foi pedido.
        if (audioFailureReason) {
            mark("tail");
            logTiming(audioFailureReason);
            throw new GenerationFailure(
                GenerationFailureCode.AUDIO_SYNTHESIS_FAILED,
                audioFailureReason,
            );
        }

        mark("tail");
        logTiming("generated");
        return { ...finalRows, status: "generated", last_score_overall: scoreResult.score_overall };
    } catch (e) {
        if (!(asGenerationFailure(e)?.code === GenerationFailureCode.AUDIO_SYNTHESIS_FAILED)) {
            mark("tail");
            logTiming("failed");
        }
        console.error(`${LOG_PREFIX} Fatal Generation Error:`, e);
        // A falha de áudio é a única que acontece com a linha JÁ gravada: o lock
        // saiu no passo 5 e não há nada a restaurar. Sem esta saída, o UPDATE
        // abaixo casaria zero linhas (ele filtra por `[PROCESSING]`) e ainda
        // assim logaria "Pre-lock content restored" — um log que mente.
        if (
            asGenerationFailure(e)?.code ===
                GenerationFailureCode.AUDIO_SYNTHESIS_FAILED
        ) {
            throw e;
        }
        // O LOCK SAI. O QUE ESTAVA NO AR VOLTA — ver `rowBeforeLock` no topo.
        //
        // Apagar era certo enquanto não havia nada a preservar: o `[PROCESSING]` precisa sumir
        // para o próximo retry funcionar. O que estava errado era apagar TAMBÉM o conteúdo que o
        // lock tinha acabado de sobrescrever. Falhar em produzir algo novo nunca deveria custar o
        // que já estava publicado.
        if (rowBeforeLock) {
            const { error: restoreError } = await supabaseAdmin.schema("core")
                .from("attraction_descriptions")
                .update({
                    description: rowBeforeLock.description,
                    facts_pack_json: rowBeforeLock.facts_pack_json,
                    audio_url: rowBeforeLock.audio_url,
                    generation_meta: rowBeforeLock.generation_meta,
                    verification_status: rowBeforeLock.verification_status,
                    name: rowBeforeLock.name,
                    updated_at: rowBeforeLock.updated_at,
                })
                .eq("attraction_id", poi_id)
                .eq("language", language)
                .eq("gender", gender)
                .eq("description", "[PROCESSING]");
            if (restoreError) {
                console.error(`${LOG_PREFIX} ⚠️ Could not restore the pre-lock row:`, restoreError);
            } else {
                console.log(`${LOG_PREFIX} Pre-lock content restored after failure.`);
            }
        } else {
            // Não havia nada antes: o lock é tudo o que existe, e ele sai.
            await supabaseAdmin.schema("core").from("attraction_descriptions")
                .delete()
                .eq("attraction_id", poi_id).eq("language", language).eq(
                    "gender",
                    gender,
                ).eq("description", "[PROCESSING]");
        }
        throw e;
    }
}

/**
 * Marca de nascimento do isolate. `cold=true` sai UMA vez por isolate, na primeira requisição
 * atendida: é o único ponto em que "cold start" é observável de dentro da função.
 */
const ISOLATE_BOOTED_AT = Date.now();
let requestsServed = 0;

// --- Main Entry Point ---
serve(async (req) => {
    if (req.method === "OPTIONS") {
        return new Response("ok", {
            headers: createSecureHeaders(corsHeaders),
        });
    }

    // 📋 INITIALIZE AUDIT LOGGER
    const auditLogger = createAuditLogger("Generate-Description");
    const startTime = Date.now();
    const isColdStart = requestsServed === 0;
    requestsServed += 1;
    console.log(
        `[Generate-Description][timing] cold=${isColdStart} isolate_age_ms=${startTime - ISOLATE_BOOTED_AT} served=${requestsServed}`,
    );

    try {
        // ✅ VALIDAR AUTENTICAÇÃO
        const authResult = await validateAuthHeader(req);
        if (!authResult.valid) {
            console.warn(
                `[Generate-Description] ❌ Unauthorized: ${authResult.error}`,
            );
            return new Response(
                JSON.stringify({
                    error: "Unauthorized",
                    detail: authResult.error,
                }),
                { status: 401, headers: createSecureHeaders(corsHeaders) },
            );
        }
        console.log(
            `[Generate-Description] ✅ Authorized: ${authResult.email}`,
        );

        // ✅ VERIFICAR RATE LIMIT
        const config = RATE_LIMIT_CONFIG["generate-description"];
        const rateLimit = checkRateLimit(
            req,
            "generate-description",
            config.maxRequests,
            config.windowSeconds,
        );
        if (!rateLimit.allowed) {
            console.warn(
                `[Generate-Description] 🚫 Rate limit exceeded for ${authResult.email}`,
            );
            return createRateLimitResponse(rateLimit, corsHeaders);
        }
        console.log(
            `[Generate-Description] ✅ Rate limit OK (${rateLimit.remaining} remaining)`,
        );

        // ✅ BR-CONTEUDO-003 item 5 — GATE DE PRODUÇÃO, NO CORPO DA FUNÇÃO.
        // Both bodies of this endpoint spend LLM + TTS (contract
        // `docs/contracts/edge-functions.md`): the batch is the native
        // pre-fetch, the single is the tourist's approach. The CMS operator and
        // the platform are out of the rule's scope, not exempted from it — the
        // gate itself makes that distinction.
        //
        // It runs BEFORE the body is parsed on purpose: the answer does not
        // depend on which POI was asked for, and reading the entitlement is one
        // round trip against a request that would otherwise cost two paid APIs
        // per item.
        const productionGate = await decideContentProduction(
            authResult,
            "Generate-Description",
        );
        if (!productionGate.allowed) {
            console.log(
                `[Generate-Description] ⛔ BR-CONTEUDO-003: production refused (state=${productionGate.state})`,
            );
            return createProductionRefusedResponse(
                productionGate,
                createSecureHeaders(corsHeaders),
            );
        }

        // ✅ PARSE REQUEST BODY (sem validação Zod - aceita qualquer idioma)
        const body = await req.json();
        const isBatch = !!body.requests && Array.isArray(body.requests);

        console.log(
            `[Generate-Description] Received request. Batch Mode: ${isBatch}`,
        );

        // --- Derive generatedBy from auth result ---
        const generatedBy: GeneratedByInfo = {
            user_id: authResult.userId!,
            email: authResult.email!,
            // SSOT with the production gate above: one spelling of "who is
            // asking", in `_shared/content-production-gate.ts`.
            source: classifyProductionRequester(authResult.role),
        };
        console.log(
            `[Generate-Description] 📋 Generated-by: ${generatedBy.source} (${generatedBy.email})`,
        );

        // --- BATCH PATH (APP) ---
        if (isBatch) {
            const batch = body as BatchRequest;
            const sharedLang = (batch.language || "pt-br").toLowerCase();
            const sharedGender = batch.gender || "male";
            const userLocation = batch.user_location;
            const shouldGenAudio = batch.generate_audio !== false;

            // 1. Sort by Proximity
            let targetRequests = batch.requests;
            if (userLocation) {
                targetRequests = targetRequests
                    .map((r) => ({
                        ...r,
                        distance: (r.trigger_point
                            ? calculateDistance(
                                userLocation.lat,
                                userLocation.lng,
                                r.trigger_point.lat,
                                r.trigger_point.lng,
                            )
                            : 9999999),
                    }))
                    .sort((a, b) => a.distance - b.distance);
                console.log(
                    `[Generate-Description] Sorted ${targetRequests.length} items by proximity.`,
                );
            }

            // 2. Fetch POI Info (Efficiently)
            const poiIds = Array.from(
                new Set(targetRequests.map((r) => r.poi_id)),
            );
            const { data: poiInfos } = await supabaseAdmin.schema("core")
                .from("attractions")
                // ✅ entity_kind + extensões 1:1 — core.attractions guarda POI,
                // evento e local na mesma tabela, e o prompt precisa saber qual é
                // (evento tem data e não tem "ano de fundação"; local tem tipo).
                .select(
                    "id, name, city, state, osm_tags, website, reference_links, entity_kind, partner_client_id, event_details!event_details_attraction_id_fkey(starts_at, ends_at, event_category, venue_attraction_id), place_details(place_type)",
                )

                .in("id", poiIds);

            // 3. Process Sequentially (or chunked)
            // Sequential is safer for rate limits and order priority
            const results = [];
            for (const item of targetRequests) {
                const poiData = poiInfos?.find((p: any) => p.id === item.poi_id) ||
                    {};
                try {
                    const res = await processPOIItem(
                        item.poi_id,
                        sharedLang,
                        sharedGender,
                        shouldGenAudio,
                        poiData,
                        undefined, // context override
                        batch.force, // Use batch force if available
                        batch.audio_duration, // Pass audio_duration from batch request
                        generatedBy, // Track who generated this description
                    );
                    results.push({
                        trigger_point_id: item.trigger_point_id,
                        poi_id: item.poi_id,
                        status: "success",
                        data: res,
                    });
                } catch (e) {
                    console.error(`Error processing item ${item.poi_id}:`, e);
                    // Falha tipada entra como CÓDIGO puro, o mesmo que o single
                    // devolve em `error`. Sem isto o item traria
                    // `"GenerationFailure: audio_synthesis_failed"` e o lote
                    // falaria um dialeto do vocabulário do contrato.
                    const failure = asGenerationFailure(e);
                    results.push({
                        trigger_point_id: item.trigger_point_id,
                        poi_id: item.poi_id,
                        status: "error",
                        error: failure ? failure.code : String(e),
                    });
                }
            }

            // 📋 LOG BATCH SUCCESS
            const successCount = results.filter((r) =>
                r.status === "success"
            ).length;
            const failureCount = results.filter((r) =>
                r.status === "error"
            ).length;
            await auditLogger.logPartial(
                req,
                "generate_description",
                "batch",
                `batch_${results.length}_items`,
                successCount,
                failureCount,
                {
                    request_count: results.length,
                    language: (body as BatchRequest).language,
                    duration_ms: Date.now() - startTime,
                },
            );

            return new Response(
                JSON.stringify({ success: true, batch_results: results }),
                { headers: createSecureHeaders(corsHeaders) },
            );
        } // --- LEGACY PATH (CMS) ---
        else {
            const manual = body as SingleRequest;
            const language = (manual.language || "pt-br").toLowerCase();
            const gender = manual.gender || "male";

            // Fetch POI Data
            const { data: poiData } = await supabaseAdmin.schema("core")
                .from("attractions")
                // ✅ ver o comentário no caminho de batch: o prompt ramifica por
                // entity_kind (poi | event | place).
                .select(
                    "name, city, state, osm_tags, website, reference_links, entity_kind, partner_client_id, event_details!event_details_attraction_id_fkey(starts_at, ends_at, event_category, venue_attraction_id), place_details(place_type)",
                )

                .eq("id", manual.poi_id)
                .single();

            const result = await processPOIItem(
                manual.poi_id,
                language,
                gender,
                manual.generate_audio !== false,
                poiData,
                manual.raw_context,
                manual.force, // Pass force flag from CMS
                manual.audio_duration,
                generatedBy, // Track who generated this description
                // Only ever present on a CMS call about a partner's place. Absent everywhere else,
                // and absent is what every other request has always sent.
                manual.partner_input,
            );

            // 📋 LOG SINGLE SUCCESS
            await auditLogger.logSuccess(
                req,
                "generate_description",
                "poi",
                manual.poi_id,
                {
                    language,
                    gender,
                    duration_ms: Date.now() - startTime,
                },
            );

            return new Response(
                JSON.stringify({ success: true, data: result }),
                { headers: createSecureHeaders(corsHeaders) },
            );
        }
    } catch (e) {
        console.error(`[Generate-Description] Global Error:`, e);

        // 📋 LOG ERROR
        // (o lote nunca chega aqui por falha de item: o laço trata item a item)
        await auditLogger.logFailure(
            req,
            "generate_description",
            "unknown",
            "error",
            String(e),
            {
                error_type: e instanceof Error ? e.name : "unknown",
                duration_ms: Date.now() - startTime,
            },
        );

        // Falha tipada do caminho single → status e código que o app classifica,
        // no vocabulário do gate de produção (`{ error, rule, … }`). O 500 com
        // `String(e)` continua sendo a resposta de tudo o mais: mensagem de
        // exceção não é código, e prometer que é seria pior do que não ter.
        const failure = asGenerationFailure(e);
        if (failure) {
            return createGenerationFailureResponse(
                failure,
                createSecureHeaders(corsHeaders),
            );
        }

        return new Response(JSON.stringify({ error: String(e) }), {
            status: 500,
            headers: createSecureHeaders(corsHeaders),
        });
    }
});
