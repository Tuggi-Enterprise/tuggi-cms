import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { generateMasterPack } from "../_shared/masterPackGenerator.ts";
import { translateWithGemini } from "../_shared/translationUtility.ts";
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
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
    Deno.env.get("SERVICE_ROLE_KEY") || "";
const GEMINI_API_KEY = Deno.env.get("GOOGLE_GEMINI_API_KEY") ||
    Deno.env.get("GEMINI_API_KEY") || "";
const GOOGLE_TTS_API_KEY = Deno.env.get("GOOGLE_TTS_API_KEY") ||
    Deno.env.get("GOOGLE_CLOUD_API_KEY") || "";

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

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
): Promise<any> {
    const LOG_PREFIX = `[Gen-Desc::${poi_id}]`;
    console.log(`${LOG_PREFIX} Processing for ${language} (${gender})...`);

    // 1. Optimistic Locking / Cache Check Loop (Max 15s)
    // We check if content exists. If it's "[PROCESSING]", we wait.
    let attempts = 0;
    while (attempts < 15) {
        const { data: existing } = await supabaseAdmin.schema("core")
            .from("attraction_descriptions")
            .select("updated_at, facts_pack_json, description, audio_url, id")
            .eq("attraction_id", poi_id)
            .eq("language", language)
            .eq("gender", gender)
            .maybeSingle();

        if (existing) {
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
                if (!force && !isStale && (existing.facts_pack_json?.length > 0) && hasAudio) {
                    console.log(`${LOG_PREFIX} Cache Hit (Fresh). Returning.`);
                    return { ...existing, status: "hit" };
                }
                if (!force && !isStale && (existing.facts_pack_json?.length > 0) && !hasAudio) {
                    console.log(`${LOG_PREFIX} Cache Hit (Description only, audio_url missing). Proceeding to TTS synthesis.`);
                    // Fall through — description will be reused in step 3.1 (translation candidates)
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
            `${LOG_PREFIX} Failed to acquire lock, assuming race condition. Returning partial error (client will retry).`,
            lockError,
        );
        // Ideally we would loop back to check, but for simplicity/safety we return error or wait
        return {
            error: "Race condition detected - please retry",
            status: "retry",
        };
    }

    try {
        // 3. Generation Logic
        let result: { description: string; facts_pack_json: any } | null = null;
        const cityName = poiDataFromDB?.city ||
            poiDataFromDB?.osm_tags?.["addr:city"] || (poiDataFromDB?.state
                ? `${poiDataFromDB.state}, Brazil`
                : "Brazil");
        const poiName = poiDataFromDB?.name || "Unknown Point";

        // 3.1 Check existing descriptions for potential translation source
        // We try to find any existing description to translate FROM, 
        // prioritizing pt-br if target is not pt-br, or just taking any available one.
        // SKIP this if 'force' is true (user wants a fresh generation)
        if (!force) {
            const { data: candidates } = await supabaseAdmin.schema("core")
                .from("attraction_descriptions")
                .select("description, facts_pack_json, language")
                .eq("attraction_id", poi_id)
                .neq("description", "[PROCESSING]") // Ignore locks
                .limit(10);

            if (candidates && candidates.length > 0) {
                // Find a source that is different from our target language
                // Prioritize pt-br as source, otherwise take the first one available
                const source = candidates.find((c: any) =>
                    c.language === "pt-br" && c.language !== language
                ) || candidates.find((c: any) => c.language !== language);

                if (source) {
                    console.log(
                        `${LOG_PREFIX} Translating from existing ${source.language} to ${language}...`,
                    );
                    const translated = await translateWithGemini(
                        source.description,
                        language,
                        GEMINI_API_KEY,
                    );
                    result = {
                        description: translated,
                        facts_pack_json: source.facts_pack_json,
                    };
                }
            }
        } else {
            console.log(`${LOG_PREFIX} Force flag detected. Skipping translation and generating fresh.`);
        }

        // 3.2 Full Generation
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

            result = await generateMasterPack(
                poiName,
                cityName,
                rawContextOverride || "App Batch Generation",
                language,
                GEMINI_API_KEY,
                undefined, // poiData
                audioDuration,
                memberPois,
                poiDataFromDB?.reference_links || [], // Links de referência do CMS
            );

        }

        // 4. Save & Audio
        const scoreResult = calculateHeuristicScore(
            result.description,
            result.facts_pack_json || [],
            poiName,
            cityName,
        );
        console.log(`${LOG_PREFIX} Heuristic Score calculated:`, scoreResult.score_overall);
        const descHash = await hashDescription(result.description);
        const isApproved = true; // Auto-approve so it plays immediately. Score is for analytics.

        let publicUrl: string | null = null;
        if (shouldGenerateAudio && GOOGLE_TTS_API_KEY) {
            const audioBuffer = await generateAudioWithTTS(
                result.description,
                language,
                gender,
                GOOGLE_TTS_API_KEY,
            );
            const fileName = `${poi_id}-${language}-${gender}.mp3`;
            const storagePath = `master_audio/${poi_id}/${fileName}`;
            const { error: upErr } = await supabaseAdmin.storage.from(
                "travel-app-audios",
            ).upload(storagePath, audioBuffer, {
                contentType: "audio/mpeg",
                upsert: true,
            });
            if (!upErr) {
                const { data: urlData } = supabaseAdmin.storage.from(
                    "travel-app-audios",
                ).getPublicUrl(storagePath);
                publicUrl = urlData.publicUrl;
            }
        }

        // 5. Final Update (Release Lock)
        const { data: finalRows } = await supabaseAdmin.schema("core").from(
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
        }, { onConflict: "attraction_id,language,gender" }).select().single();

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

        console.log(`${LOG_PREFIX} Final Upsert Score:`, scoreResult.score_overall);
        return { ...finalRows, status: "generated", last_score_overall: scoreResult.score_overall };
    } catch (e) {
        console.error(`${LOG_PREFIX} Fatal Generation Error:`, e);
        // Clear Lock (Negative Cache - or just delete)
        // For risk mitigation, we leave it or update to "[ERROR]"?
        // We DELETE it so next retry works.
        await supabaseAdmin.schema("core").from("attraction_descriptions")
            .delete()
            .eq("attraction_id", poi_id).eq("language", language).eq(
                "gender",
                gender,
            ).eq("description", "[PROCESSING]");
        throw e;
    }
}

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
            source: authResult.role === "service_role"
                ? "system"
                : (authResult.role === "admin" || authResult.role === "super_admin" || authResult.role === "editor")
                    ? "cms_admin"
                    : "app_user",
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
                .select("id, name, city, state, osm_tags, website, reference_links")

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
                    results.push({
                        trigger_point_id: item.trigger_point_id,
                        poi_id: item.poi_id,
                        status: "error",
                        error: String(e),
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
                .select("name, city, state, osm_tags, website, reference_links")

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

        return new Response(JSON.stringify({ error: String(e) }), {
            status: 500,
            headers: createSecureHeaders(corsHeaders),
        });
    }
});
