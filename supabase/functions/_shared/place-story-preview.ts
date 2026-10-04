// _shared/place-story-preview.ts
//
// The pure half of the two functions the Portal Locais calls (#820, #827). Contract:
// `docs/contracts/places-cms.md` (workspace). Import-free, so the CMS tests run it under
// Node; the `index.ts` files hold the network and the database.
//
// BR-B2B-051 item 4: text by Gemini 2.5 Flash-Lite from the submission's own answers, no
// search; voice by Google Cloud TTS, Standard tier, pt-BR only. BR-B2B-053 item 5: no offer is
// ever narrated, so `offer_*` is outside the allowlist below.

/** The one model, pinned: the price below is this model's. */
export const PLACE_STORY_MODEL = 'gemini-2.5-flash-lite';
export const PLACE_STORY_PROMPT_VERSION = 'place-story-preview-v1';

/** Standard voice, MALE. Confirmed on Google's voice list on 2026-10-04 (A and C are FEMALE). */
export const PLACE_STORY_VOICE = 'pt-BR-Standard-B';
export const PLACE_STORY_LANGUAGE = 'pt-BR';

/** ~15 s at the narration's 1.1 speaking rate. Same ceiling the CMS review counts (#812). */
export const PLACE_STORY_MAX_WORDS = 40;
export const PLACE_STORY_MAX_OUTPUT_TOKENS = 200;

/**
 * Unit prices in micro-USD, from Google's official pricing pages, checked on 2026-10-04:
 *  · Gemini 2.5 Flash-Lite, paid tier: US$ 0.10 / 1M input tokens, US$ 0.40 / 1M output tokens;
 *  · Cloud TTS Standard voices: US$ 4 / 1M characters (SSML tags count), after 4M free a month.
 * The free tier is ignored on purpose: the column is the marginal cost of one preview.
 */
export const GEMINI_INPUT_MICROS_PER_TOKEN = 0.1;
export const GEMINI_OUTPUT_MICROS_PER_TOKEN = 0.4;
export const TTS_STANDARD_MICROS_PER_CHARACTER = 4;

export function placeStoryCostMicros(usage: {
  inputTokens: number;
  outputTokens: number;
  ttsCharacters: number;
}): number {
  return Math.ceil(
    usage.inputTokens * GEMINI_INPUT_MICROS_PER_TOKEN +
      usage.outputTokens * GEMINI_OUTPUT_MICROS_PER_TOKEN +
      usage.ttsCharacters * TTS_STANDARD_MICROS_PER_CHARACTER,
  );
}

/**
 * The answers that may reach the prompt, with the label the model reads. An ALLOWLIST: CPF,
 * phone, e-mail, tax id and the two offers can never be narrated because they are not here.
 */
const STORY_INPUTS: ReadonlyArray<readonly [key: string, label: string]> = [
  ['trade_name', 'Nome do local'],
  ['category', 'Categoria'],
  ['city', 'Cidade'],
  ['district', 'Bairro'],
  ['signature_item', 'O que é a cara do lugar'],
  ['story_founder', 'Quem fundou e como começou'],
  ['story_before', 'O que havia ali antes'],
  ['story_unique', 'O que só existe ali'],
  ['story_event', 'Uma história que o bairro conta'],
  ['story_script', 'Roteiro escrito pelo local'],
];

const FIELD_CAP = 600;

function clean(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, FIELD_CAP);
}

/** The allowlisted answers, in prompt order. Exported for the test of the allowlist. */
export function storyInputs(answers: Record<string, unknown>): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const [key, label] of STORY_INPUTS) {
    const value = clean(answers[key]);
    if (value) out.push([label, value]);
  }
  return out;
}

/** `null` when the answers do not even name the place: there is nothing to tell. */
export function buildPlaceStoryPrompt(answers: Record<string, unknown>): string | null {
  if (!clean(answers.trade_name)) return null;
  const facts = storyInputs(answers)
    .map(([label, value]) => `- ${label}: ${value}`)
    .join('\n');

  return `Você escreve a narração de um guia turístico em áudio, em português do Brasil.

Escreva uma historinha curta sobre o local abaixo, para ser ouvida por um turista que passa na frente dele.

Regras:
- No máximo ${PLACE_STORY_MAX_WORDS} palavras (cerca de 15 segundos de fala).
- Use só os fatos abaixo. Não invente datas, nomes, números nem fatos.
- Comece pelo nome do local.
- Tom de conversa, caloroso, sem exagero.
- Nada de oferta, preço, desconto, promoção, cardápio ou chamada para comprar.
- Texto corrido, sem título, sem aspas, sem emoji, sem marcação.

Fatos do local:
${facts}

Responda só com o texto da narração.`;
}

/** The model's text, ready to speak: one paragraph, no wrapping quotes or markdown. */
export function cleanStoryText(raw: string): string {
  return raw
    .replace(/[*_#`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^["“”']+|["“”']+$/g, '')
    .trim();
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseStoryPreviewRequest(body: unknown): { generationId: string } | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const id = (body as Record<string, unknown>).generation_id;
  return typeof id === 'string' && UUID.test(id) ? { generationId: id.toLowerCase() } : null;
}

export function parseMovementRequest(body: unknown): { lat: number; lng: number } | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const { lat, lng } = body as Record<string, unknown>;
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

export interface MovementResponse {
  has_data: boolean;
  people_count: number | null;
  radius_m: number;
  window_days: number;
}

/** `partner.place_movement`'s row, in the contract's shape. No data means no number. */
export function shapeMovementResponse(row: Record<string, unknown>): MovementResponse {
  const hasData = row.has_data === true;
  const count = Number(row.people_count);
  return {
    has_data: hasData,
    people_count: hasData && Number.isFinite(count) ? count : null,
    radius_m: Number(row.radius_m),
    window_days: Number(row.window_days),
  };
}

// ── The claim (#820, security review) ──────────────────────────────────────────────────────
// N parallel calls with the same pending `generation_id` used to reach Gemini/TTS N times,
// with the same keys that narrate to the tourist. A conditional UPDATE of `claimed_at` BEFORE
// the model is the lock: Postgres re-checks the WHERE of the second UPDATE after the first one
// commits, so exactly one call gets the row back. The TTL is what keeps a function that died
// mid-call from locking the generation forever.

/** A claim older than this is abandoned and can be taken again. */
export const PLACE_STORY_CLAIM_TTL_MS = 60_000;

/** The `.or()` filter that admits an unclaimed generation or an abandoned claim. */
export function storyClaimFilter(now: Date): string {
  const staleBefore = new Date(now.getTime() - PLACE_STORY_CLAIM_TTL_MS).toISOString();
  return `claimed_at.is.null,claimed_at.lt.${staleBefore}`;
}

interface ClaimQuery
  extends PromiseLike<{ data: unknown[] | null; error: { code?: string } | null }> {
  eq(column: string, value: string): ClaimQuery;
  is(column: string, value: null): ClaimQuery;
  or(filter: string): ClaimQuery;
  select(columns: string): ClaimQuery;
}

/** The slice of the `partner` schema client the claim uses. */
export interface GenerationTable {
  from(table: 'place_generations'): { update(values: Record<string, unknown>): ClaimQuery };
}

export type StoryClaim = 'claimed' | 'busy' | 'error';

/** Takes the generation for this call, or says someone else holds it (or it is done). */
export async function claimStoryGeneration(
  partner: GenerationTable,
  generationId: string,
  now: Date = new Date(),
): Promise<StoryClaim> {
  const { data, error } = await partner
    .from('place_generations')
    .update({ claimed_at: now.toISOString() })
    .eq('id', generationId)
    .is('output_text', null)
    .or(storyClaimFilter(now))
    .select('id');
  if (error) return 'error';
  return data && data.length > 0 ? 'claimed' : 'busy';
}

/** Gives the claim back on failure, so the portal's retry with the same id is not a 409. */
export async function releaseStoryGeneration(
  partner: GenerationTable,
  generationId: string,
): Promise<void> {
  const { error } = await partner
    .from('place_generations')
    .update({ claimed_at: null })
    .eq('id', generationId)
    .is('output_text', null)
    .select('id');
  // A failed release only delays the retry by the TTL; it never double-bills.
  if (error) console.error('[places-story-preview] claim release failed', error.code);
}
