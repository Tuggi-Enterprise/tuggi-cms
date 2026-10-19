/**
 * Text filter of a route published by an app user (#945, BR-ROTA-006), riding on the translation.
 *
 * The same LLM call that translates the route also answers whether its text is improper: offensive,
 * sexual, hateful, or personal data of a third party, in any language. It reads the NAME and the
 * DESCRIPTION; a user route may have no description, and then it reads the name only and goes on
 * (before, `getRouteData` refused a route without description, and a user route would sit in review
 * forever).
 *
 * The verdict goes to `core.set_route_moderation_result` (service_role). A user route is born
 * `pending_review`; it goes `active` only when this filter says it is clean. A failure of the LLM,
 * or an answer that does not parse, writes nothing, and the route stays where it is: in review.
 *
 * Deno module with no imports, so `tests/api` loads it through a path built at run time.
 */

export const MODERATION_CATEGORIES = ['offensive', 'sexual', 'hate', 'third_party_personal_data'] as const
export type ModerationCategory = typeof MODERATION_CATEGORIES[number]

export interface RouteSourceRow {
  name: string
  description: string | null
  owner_user_id?: string | null
  metadata?: { source?: unknown } | null
}

/** Only a user route goes through the filter; a CMS route is curated. */
export function isUserRoute(row: Pick<RouteSourceRow, 'owner_user_id' | 'metadata'>): boolean {
  return Boolean(row.owner_user_id) || row.metadata?.source === 'user_trip'
}

export interface ModeratedTranslation {
  name: string
  description: string | null
  flagged: boolean
  category: ModerationCategory | null
}

export function buildModeratedRouteTranslationPrompt(
  name: string,
  description: string | null,
  targetLanguageName: string,
  targetLanguageCode: string,
): string {
  const hasDescription = Boolean(description && description.trim())
  return `You translate tourist route texts and screen them before they are published.

A traveller wrote the route NAME${hasDescription ? ' and DESCRIPTION' : ''} below, in any language.

1. Translate it into ${targetLanguageName} (code ${targetLanguageCode}), natural and fluent, written only in that language and its native script. Keep proper nouns.
2. Decide if the ORIGINAL text is improper to publish. It is improper only if it contains:
   - "offensive": insults, harassment, slurs, threats, or obscene language;
   - "sexual": sexual content;
   - "hate": hate or discrimination against a group;
   - "third_party_personal_data": personal data of another person (full name with address, phone, e-mail, document number, licence plate).
   Ordinary place names, street names, opening hours and the traveller's own route are NOT improper.

NAME:
"""${name}"""
${hasDescription ? `\nDESCRIPTION:\n"""${description}"""\n` : ''}
Answer with ONE JSON object and nothing else:
{"name": "<translated name>", "description": ${hasDescription ? '"<translated description>"' : 'null'}, "flagged": <true|false>, "category": <one of "offensive", "sexual", "hate", "third_party_personal_data", or null>}`
}

/**
 * Parses the answer. Anything that is not the agreed object throws: the caller treats it as an LLM
 * failure, and the route stays in review. A flagged answer without a known category keeps the flag.
 */
export function parseModeratedRouteTranslation(raw: string, expectsDescription: boolean): ModeratedTranslation {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('moderated translation: no JSON object in the answer')

  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(text.slice(start, end + 1))
  } catch {
    throw new Error('moderated translation: the answer is not valid JSON')
  }

  if (typeof parsed.flagged !== 'boolean') throw new Error('moderated translation: "flagged" is not a boolean')
  if (typeof parsed.name !== 'string' || !parsed.name.trim()) throw new Error('moderated translation: empty name')
  const description = typeof parsed.description === 'string' && parsed.description.trim() ? parsed.description.trim() : null
  if (expectsDescription && !description && !parsed.flagged) {
    throw new Error('moderated translation: the description was not translated')
  }
  const category = (MODERATION_CATEGORIES as readonly unknown[]).includes(parsed.category)
    ? (parsed.category as ModerationCategory)
    : null

  return { name: parsed.name.trim(), description, flagged: parsed.flagged, category: parsed.flagged ? category : null }
}

export interface ModerateRouteDeps {
  /** Runs the prompt on the LLM and returns its text. Throws on failure. */
  runPrompt: (prompt: string) => Promise<string>
  /** `core.set_route_moderation_result(p_route_id, p_flagged, p_reason)`. Throws on failure. */
  setModerationResult: (flagged: boolean, reason: string | null) => Promise<void>
}

/**
 * Translates a user route and records the verdict. Throws when the LLM fails or answers out of
 * shape, BEFORE recording anything: the route keeps its status (born `pending_review`).
 */
export async function translateAndModerateUserRoute(
  route: Pick<RouteSourceRow, 'name' | 'description'>,
  targetLanguageName: string,
  targetLanguageCode: string,
  deps: ModerateRouteDeps,
): Promise<ModeratedTranslation> {
  const description = route.description && route.description.trim() ? route.description : null
  const prompt = buildModeratedRouteTranslationPrompt(route.name, description, targetLanguageName, targetLanguageCode)
  const answer = await deps.runPrompt(prompt)
  const result = parseModeratedRouteTranslation(answer, Boolean(description))
  await deps.setModerationResult(result.flagged, result.flagged ? result.category ?? 'flagged by the text filter' : null)
  return result
}
