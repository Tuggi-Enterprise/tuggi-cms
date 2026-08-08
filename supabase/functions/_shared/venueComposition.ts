// _shared/venueComposition.ts
//
// BR-EVENTO-002 — inside the event window, whoever reaches the HOST POI hears the
// event narration generated WITH the host's facts ("Igreja Matriz da Nossa Senhora
// da Assunção, ... and from the 13th to the 17th the Festa da Padroeira happens
// here"). Item 2 of the rule is the load-bearing one: **the composed narration
// contains the POI** — that is the only reason substituting the base narration does
// not lose the POI. Item 3 is the fence around this module: the host POI is READ
// here and never written, because dated content lives in the event.
//
// This module owns the three decisions that guarantee item 2 and are otherwise
// buried inside `generate-description`, which cannot be imported from a test (it
// pulls `https://deno.land/...` and `https://esm.sh/...`):
//
//   1. WHETHER this entity is an event with a host at all — the gate that keeps a
//      POI and an autonomous event on exactly the path they were on before.
//   2. WHICH host name and host facts feed the prompt, given the listener's
//      language — BR-CONTEUDO-001.
//   3. WHETHER a stored description of a linked event was actually composed with
//      that host, so that a cache hit or a translation cannot silently deliver a
//      narration that never mentions the POI — BR-EVENTO-002 item 2.
//
// Pure: no I/O, no Deno globals. The caller does the querying.

/** A row of `core.attraction_descriptions` for the host POI. */
export interface VenueDescriptionRow {
    language?: string | null;
    /** Per-language translated name (BR-CONTEUDO-001). Null when not translated yet. */
    name?: string | null;
    description?: string | null;
}

export interface VenueContext {
    /** The name the narration must literally open with, in the listener's language. */
    name: string;
    /** The host's existing narration, used as context. Null when the host has none. */
    facts: string | null;
    /** Language `facts` came from — recorded in the trail, never delivered as-is. */
    factsLanguage: string | null;
}

/** `pt-br` → `pt`. Empty string for a missing language. */
function baseLanguage(language?: string | null): string {
    return (language || "").toLowerCase().split("-")[0];
}

function sameLanguage(row: VenueDescriptionRow, language: string): boolean {
    return (row.language || "").toLowerCase() === language.toLowerCase();
}

/**
 * BR-EVENTO-002 — the gate. Returns the host POI id only for an entity that is an
 * event AND carries a link; `null` for a POI, for a `place`, and for the autonomous
 * event that "narra por conta própria e não passa por esta regra".
 *
 * `entity_kind` is checked as well as the link because `core.attractions` holds POI,
 * event and place in one table: a stray `venue_attraction_id` on a non-event must
 * not turn its narration into someone else's.
 *
 * @param entityKind   `core.attractions.entity_kind`.
 * @param eventDetails the `core.event_details` row, already unwrapped from the
 *                     PostgREST array. `undefined`/`null` when the extension is
 *                     absent, which is the common case and returns `null`.
 */
export function linkedVenueId(
    entityKind: unknown,
    eventDetails: { venue_attraction_id?: string | null } | null | undefined,
): string | null {
    if (entityKind !== "event") return null;
    return eventDetails?.venue_attraction_id ?? null;
}

/**
 * BR-CONTEUDO-001 — "narration, NAME and description of the POI follow the user's
 * language". The host name is not decoration here: `masterPackGenerator` turns it
 * into a HARD RULE ("the narration's literal first words are <name>"), so reading
 * only the canonical `core.attractions.name` would force a Latin-script name as the
 * opening words of a narration the same prompt requires to be entirely in kanji —
 * and then hand that to a ja-JP TTS voice. The catalog already holds the translated
 * name in `attraction_descriptions.name`, and it comes from the very same query as
 * the facts, so preferring it costs nothing.
 *
 * Name: exact language → same base language → canonical. It never falls through to
 * an unrelated language: delivering `コロッセオ` inside an en-us narration is the
 * "idioma errado" BR-CONTEUDO-001 forbids, while the canonical name is the local
 * proper noun — the correct thing to say when no exonym is known.
 *
 * Facts: exact → same base → en → any, unchanged from what shipped in the event
 * branch. Facts are INPUT to the generator, never delivered text, and
 * BR-CONTEUDO-001 explicitly allows composing from whatever language exists ("a
 * tradução parte da descrição mais recente, qualquer que seja o idioma dela").
 *
 * BR-CONTEUDO-002 — a host with no description in any language is not an error and
 * not a reason to skip composing: `facts` comes back null and the generator grounds
 * the listener by NAME alone, which is what item 2 asks for. The host gets its own
 * description through its own trigger; generating it from here would write to the
 * POI because of an event, which item 3 forbids.
 *
 * @param canonicalName `core.attractions.name` of the host POI.
 * @param language      the listener's language.
 * @param rows          host descriptions, `[PROCESSING]` already filtered out by
 *                      the caller, most recently updated first.
 */
export function resolveVenueContext(
    canonicalName: string,
    language: string,
    rows: VenueDescriptionRow[],
): VenueContext {
    const base = baseLanguage(language);
    const available = rows || [];

    const namedRow = available.find((r) => sameLanguage(r, language) && !!r.name) ||
        available.find((r) => baseLanguage(r.language) === base && !!r.name);

    const factsRow =
        available.find((r) => sameLanguage(r, language) && !!r.description) ||
        available.find((r) => baseLanguage(r.language) === base && !!r.description) ||
        available.find((r) =>
            ["en", "en-us"].includes((r.language || "").toLowerCase()) && !!r.description
        ) ||
        available.find((r) => !!r.description);

    return {
        name: namedRow?.name || canonicalName,
        facts: factsRow?.description ?? null,
        factsLanguage: factsRow?.language ?? null,
    };
}

/**
 * The trail entry that proves a stored description was composed with a given host.
 * Reader and writer share this key on purpose: the guard below is only as good as
 * the mark, and a drifting literal would fail open — every linked event would look
 * composed and the promise would break silently.
 */
export const VENUE_META_KEY = "venue_attraction_id";

/**
 * @param venueId       the host this description was composed against.
 * @param factsLanguage language of the host facts used, null when the host had none.
 * @param composed      false only when the host row itself could not be read (a
 *                      dangling link). The mark is still written in that case, on
 *                      purpose: without it every trigger would regenerate forever,
 *                      and regenerating cannot fix a link that points nowhere.
 */
export function venueCompositionMeta(
    venueId: string,
    factsLanguage: string | null,
    composed: boolean,
): Record<string, unknown> {
    return {
        [VENUE_META_KEY]: venueId,
        venue_facts_language: factsLanguage,
        venue_composed: composed,
    };
}

/**
 * BR-EVENTO-002 item 2 — was this stored description composed with THIS host?
 *
 * Why it exists: composing only happens on a fresh generation. A description
 * produced while the event was still autonomous stays in the cache after a curator
 * links the host in the CMS, and every other language is then translated FROM it —
 * so the promise breaks for every language, not just the first. Without a mark there
 * is no way to tell the two apart: read on 2026-08-08, the composed `pt-br` row of
 * the Festa da Padroeira and its `en-us` translation carry the same
 * `generation_meta` shape as any unlinked event.
 *
 * Fails CLOSED against cost, not against correctness: an unreadable or absent trail
 * answers `false`, which sends the caller to a fresh (composed) generation. That
 * costs one generation per language of a linked event, ONCE — the mark is written on
 * the way out — and only for linked events, which is why the caller must not call
 * this for a POI or an autonomous event. BR-CONTEUDO-003 (no ceiling, no tier gate)
 * makes that cost acceptable; a narration that never names the POI is not.
 */
export function isComposedWithVenue(
    generationMeta: unknown,
    venueId: string,
): boolean {
    if (!generationMeta || typeof generationMeta !== "object") return false;
    return (generationMeta as Record<string, unknown>)[VENUE_META_KEY] === venueId;
}
