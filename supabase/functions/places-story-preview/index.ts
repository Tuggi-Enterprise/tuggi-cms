// Edge Function: places-story-preview (#820, épico #802)
//
// The ~15 s audio preview of a place's story, for the Portal Locais. Contract:
// `docs/contracts/places-cms.md` (workspace). Rule: BR-B2B-051.
//
// Called server-to-server by the portal's Worker with `x-places-secret`, AFTER the portal
// consumed a `generation_id` with the user's session (`core.portal_consume_generation`): the
// database counts the 2 previews, this function counts nothing. Deploy with `--no-verify-jwt`.
//
// NOTHING IS WRITTEN ON FAILURE, and that is the retry contract: a 502 leaves `output_text`
// null, so the portal retries with the SAME id and the failed attempt does not cost the place
// one of its two previews (BR-B2B-051, item 6).
//
// ONLY ONE CALL REACHES THE PROVIDERS (#820, security review). Before the model, a conditional
// UPDATE of `claimed_at` takes the generation (`claimStoryGeneration`); a concurrent call with
// the same id gets 409 without spending Gemini/TTS. Every 502 after the claim gives it back, and
// a claim older than `PLACE_STORY_CLAIM_TTL_MS` is taken again, so a function that died
// mid-call does not lock the id forever. The final write stays conditional on `output_text`
// null as the second fence.

import { createAdminClient } from '../_shared/supabase-client.ts';
import { isPlacesSecret, PLACES_SECRET_HEADER } from '../_shared/places-secret.ts';
import { runGeminiPromptWithUsage } from '../_shared/translationUtility.ts';
import { synthesizeSpeech } from '../_shared/ttsGenerator.ts';
import {
  buildPlaceStoryPrompt,
  claimStoryGeneration,
  cleanStoryText,
  parseStoryPreviewRequest,
  placeStoryCostMicros,
  PLACE_STORY_LANGUAGE,
  PLACE_STORY_MAX_OUTPUT_TOKENS,
  PLACE_STORY_MODEL,
  PLACE_STORY_PROMPT_VERSION,
  PLACE_STORY_VOICE,
  releaseStoryGeneration,
} from '../_shared/place-story-preview.ts';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });
  if (!isPlacesSecret(req.headers.get(PLACES_SECRET_HEADER))) {
    return json(401, { error: 'unauthorized' });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: 'invalid_body' });
  }
  const request = parseStoryPreviewRequest(body);
  if (!request) return json(400, { error: 'invalid_body' });

  const partner = createAdminClient().schema('partner');

  const { data: generation, error: generationError } = await partner
    .from('place_generations')
    .select('id, submission_id, kind, output_text')
    .eq('id', request.generationId)
    .maybeSingle();
  if (generationError) {
    console.error('[places-story-preview] generation read failed', generationError.code);
    return json(502, { error: 'generation_failed' });
  }
  if (!generation || generation.kind !== 'story_preview') return json(404, { error: 'not_found' });
  if (generation.output_text !== null) return json(409, { error: 'already_generated' });

  const { data: submission, error: submissionError } = await partner
    .from('place_submissions')
    .select('answers')
    .eq('id', generation.submission_id)
    .maybeSingle();
  if (submissionError || !submission) {
    console.error('[places-story-preview] submission read failed', submissionError?.code ?? 'no_row');
    return json(502, { error: 'generation_failed' });
  }

  const prompt = buildPlaceStoryPrompt((submission.answers ?? {}) as Record<string, unknown>);
  if (!prompt) return json(502, { error: 'generation_failed' });

  const geminiKey = Deno.env.get('GEMINI_API_KEY') || Deno.env.get('GOOGLE_GEMINI_API_KEY') || '';
  const ttsKey = Deno.env.get('GOOGLE_TTS_API_KEY') || Deno.env.get('GOOGLE_CLOUD_API_KEY') || '';
  if (!geminiKey || !ttsKey) {
    console.error('[places-story-preview] missing GEMINI_API_KEY or GOOGLE_TTS_API_KEY');
    return json(502, { error: 'generation_failed' });
  }

  const claim = await claimStoryGeneration(partner, generation.id);
  if (claim === 'error') return json(502, { error: 'generation_failed' });
  if (claim === 'busy') return json(409, { error: 'already_generated' });

  let text: string;
  let inputTokens = 0;
  let outputTokens = 0;
  let audio: ArrayBuffer;
  let ttsCharacters: number;
  try {
    const result = await runGeminiPromptWithUsage(
      prompt,
      geminiKey,
      PLACE_STORY_MAX_OUTPUT_TOKENS,
      0.7,
      [PLACE_STORY_MODEL],
    );
    text = cleanStoryText(result.text);
    if (!text) throw new Error('empty story');
    inputTokens = result.usage?.input_tokens ?? 0;
    outputTokens = result.usage?.output_tokens ?? 0;

    const speech = await synthesizeSpeech(text, PLACE_STORY_LANGUAGE, 'male', ttsKey, {
      fullVoiceName: PLACE_STORY_VOICE,
      audioEncoding: 'MP3',
    });
    audio = speech.audio;
    ttsCharacters = speech.billedCharacters;
  } catch (error) {
    console.error(
      '[places-story-preview] provider failed',
      error instanceof Error ? error.message.slice(0, 200) : 'unknown',
    );
    await releaseStoryGeneration(partner, generation.id);
    return json(502, { error: 'generation_failed' });
  }

  const { data: written, error: writeError } = await partner
    .from('place_generations')
    .update({
      output_text: text,
      completed_at: new Date().toISOString(),
      model: PLACE_STORY_MODEL,
      prompt_version: PLACE_STORY_PROMPT_VERSION,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      tts_characters: ttsCharacters,
      cost_usd_micros: placeStoryCostMicros({ inputTokens, outputTokens, ttsCharacters }),
    })
    .eq('id', generation.id)
    .is('output_text', null)
    .select('id');
  if (writeError) {
    console.error('[places-story-preview] write failed', writeError.code);
    await releaseStoryGeneration(partner, generation.id);
    return json(502, { error: 'generation_failed' });
  }
  if (!written || written.length === 0) return json(409, { error: 'already_generated' });

  return json(200, { text, audio_base64: toBase64(audio), mime: 'audio/mpeg' });
});
