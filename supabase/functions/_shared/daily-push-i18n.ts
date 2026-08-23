/**
 * Copy of the daily retention push, in the five languages the
 * `daily-gamification-orchestrator` Edge Function serves.
 *
 * It lives here and not inside that function for one reason: the function
 * imports `https://esm.sh/@supabase/supabase-js@2` on its first line, which
 * Node cannot resolve, so nothing declared in it can be exercised by a test.
 * This module has NO remote import on purpose — see
 * `tests/api/edge-daily-push-copy.test.ts`.
 *
 * Spec: `docs/design/copy-push-diario-2026-08.md`.
 * Rules: DS-COPY-004 (tone of voice), BR-MONETIZACAO-055 (the copy must not
 * order the traveller to switch the guide on: in `free` that act is refused),
 * BR-COMUNICACAO-002 item 2 (`missed` counts places, never pieces of content —
 * 0.83% of mapped places have produced audio).
 *
 * Three shapes here are load-bearing, not decoration:
 *
 * 1. Every countable sentence has TWO complete variants, `one` and `other`.
 *    Not a number-neutral sentence, not a noun glued to a digit: in Italian the
 *    verb changes with the count (`c'era 1 altro luogo` vs `c'erano altri 12
 *    luoghi`), and a bare noun breaks exactly there. CLDR 47 gives `pt`,
 *    `pt_PT`, `es`, `it` and `en` two categories over the range these counts
 *    reach, and zero never renders (see `compose`), so the selector is
 *    `n === 1 ? one : other` and nothing else.
 * 2. `${name}` is never in the first sentence. `drive.profiles.nickname` is
 *    `text` with no limit and the app sets no `maxLength`; a long nickname up
 *    front pushes the number out of the single line a collapsed Android
 *    notification shows (Android, *Create a notification*: the text content is
 *    truncated to fit one line, and nothing in the app sets `BigTextStyle`).
 * 3. `missed === 0` is reachable in production: `get_morning_push_candidates()`
 *    filters `(missed_count > 0 OR heard_count > 0)` while the orchestrator
 *    picks the body by `heard_count` alone. That case renders the map sentence,
 *    never a literal zero.
 */

export type DailyPushLang = 'pt-br' | 'pt-pt' | 'en' | 'es' | 'it';

/** The two CLDR plural categories these counts can reach. */
interface PluralForms<T> {
  one: T;
  other: T;
}

const pluralize = <T>(n: number, forms: PluralForms<T>): T => (n === 1 ? forms.one : forms.other);

/** The four sentences the two bodies are composed from, per the spec, section 6. */
interface DailyPushPhrases {
  title: string;
  fallback: string;
  /** H — what the traveller heard. Countable. Leads the body, so it has no name. */
  heardSentence: PluralForms<(heard: number) => string>;
  /** M — places nearby, as the SECOND sentence. Countable, carries the name. */
  nearbySentence: PluralForms<(name: string, missed: number) => string>;
  /** L — places nearby, as the FIRST sentence (nothing was heard). Countable, no name. */
  nearbyLeadSentence: PluralForms<(missed: number) => string>;
  /** P — the map sentence. Closes the body when `missed === 0`. Carries the name. */
  mapSentence: (name: string) => string;
}

const PHRASES: Record<DailyPushLang, DailyPushPhrases> = {
  'pt-br': {
    title: 'Sua jornada de ontem',
    fallback: 'Viajante',
    heardSentence: {
      one: () => 'Você ouviu 1 história no caminho.',
      other: (heard: number) => `Você ouviu ${heard} histórias no caminho.`,
    },
    nearbySentence: {
      one: (name: string) => `${name}, você passou perto de mais 1 ponto.`,
      other: (name: string, missed: number) => `${name}, você passou perto de mais ${missed} pontos.`,
    },
    nearbyLeadSentence: {
      one: () => 'Você passou perto de 1 ponto no caminho.',
      other: (missed: number) => `Você passou perto de ${missed} pontos no caminho.`,
    },
    mapSentence: (name: string) => `${name}, o mapa mostra o que está por perto.`,
  },
  'pt-pt': {
    title: 'A sua jornada de ontem',
    fallback: 'Viajante',
    heardSentence: {
      one: () => 'Ouviu 1 história pelo caminho.',
      other: (heard: number) => `Ouviu ${heard} histórias pelo caminho.`,
    },
    nearbySentence: {
      one: (name: string) => `${name}, passou perto de mais 1 ponto.`,
      other: (name: string, missed: number) => `${name}, passou perto de mais ${missed} pontos.`,
    },
    nearbyLeadSentence: {
      one: () => 'Passou perto de 1 ponto pelo caminho.',
      other: (missed: number) => `Passou perto de ${missed} pontos pelo caminho.`,
    },
    mapSentence: (name: string) => `${name}, o mapa mostra o que tem perto de si.`,
  },
  'en': {
    title: 'Your journey yesterday',
    fallback: 'Traveler',
    heardSentence: {
      one: () => 'You heard 1 story along the way.',
      other: (heard: number) => `You heard ${heard} stories along the way.`,
    },
    nearbySentence: {
      one: (name: string) => `${name}, you passed near 1 more place.`,
      other: (name: string, missed: number) => `${name}, you passed near ${missed} more places.`,
    },
    nearbyLeadSentence: {
      one: () => 'You passed near 1 place along the way.',
      other: (missed: number) => `You passed near ${missed} places along the way.`,
    },
    mapSentence: (name: string) => `${name}, the map shows what's nearby.`,
  },
  'es': {
    // `jornada` in Spanish is a working day; for a route it is a lusism.
    title: 'Tu recorrido de ayer',
    fallback: 'Viajero',
    heardSentence: {
      one: () => 'Escuchaste 1 historia por el camino.',
      other: (heard: number) => `Escuchaste ${heard} historias por el camino.`,
    },
    nearbySentence: {
      one: (name: string) => `${name}, pasaste cerca de 1 punto más.`,
      other: (name: string, missed: number) => `${name}, pasaste cerca de ${missed} puntos más.`,
    },
    nearbyLeadSentence: {
      one: () => 'Pasaste cerca de 1 punto por el camino.',
      other: (missed: number) => `Pasaste cerca de ${missed} puntos por el camino.`,
    },
    mapSentence: (name: string) => `${name}, el mapa te muestra lo que tienes cerca.`,
  },
  'it': {
    title: 'Il tuo viaggio di ieri',
    fallback: 'Viaggiatore',
    heardSentence: {
      one: () => 'Hai ascoltato 1 storia lungo la strada.',
      other: (heard: number) => `Hai ascoltato ${heard} storie lungo la strada.`,
    },
    nearbySentence: {
      one: (name: string) => `${name}, lungo la strada c'era 1 altro luogo.`,
      other: (name: string, missed: number) => `${name}, lungo la strada c'erano altri ${missed} luoghi.`,
    },
    nearbyLeadSentence: {
      one: () => "Lungo il tuo percorso c'era 1 luogo.",
      other: (missed: number) => `Lungo il tuo percorso c'erano ${missed} luoghi.`,
    },
    mapSentence: (name: string) => `${name}, la mappa ti mostra cosa c'è qui intorno.`,
  },
};

export interface DailyPushStrings {
  title: string;
  fallback: string;
  /** Used when the traveller heard at least one story. */
  body: (name: string, heard: number, missed: number) => string;
  /** Used when nothing was heard — the candidate filter then guarantees `missed >= 1`. */
  body_zero_heard: (name: string, missed: number) => string;
}

/**
 * The composition, written once for all five languages (spec, section 6):
 *
 *   body(name, heard, missed)     = H(heard) + " " + (missed > 0 ? M(name, missed) : P(name))
 *   body_zero_heard(name, missed) = L(missed) + " " + P(name)
 */
const compose = (phrases: DailyPushPhrases): DailyPushStrings => ({
  title: phrases.title,
  fallback: phrases.fallback,
  body: (name: string, heard: number, missed: number) => {
    const first = pluralize(heard, phrases.heardSentence)(heard);
    const second =
      missed > 0 ? pluralize(missed, phrases.nearbySentence)(name, missed) : phrases.mapSentence(name);
    return `${first} ${second}`;
  },
  body_zero_heard: (name: string, missed: number) =>
    `${pluralize(missed, phrases.nearbyLeadSentence)(missed)} ${phrases.mapSentence(name)}`,
});

export const TRANSLATIONS: Record<DailyPushLang, DailyPushStrings> = {
  'pt-br': compose(PHRASES['pt-br']),
  'pt-pt': compose(PHRASES['pt-pt']),
  'en': compose(PHRASES['en']),
  'es': compose(PHRASES['es']),
  'it': compose(PHRASES['it']),
};

/** Maps a BCP-47-ish tag to one of the five sets. Anything else (e.g. `fr`) gets `en`. */
export const getTranslation = (lang: string): DailyPushStrings => {
  const code = (lang || 'pt-br').toLowerCase();
  if (code.startsWith('pt-br')) return TRANSLATIONS['pt-br'];
  if (code.startsWith('pt-pt')) return TRANSLATIONS['pt-pt'];
  if (code.startsWith('pt')) return TRANSLATIONS['pt-br'];
  if (code.startsWith('it')) return TRANSLATIONS['it'];
  if (code.startsWith('es')) return TRANSLATIONS['es'];
  return TRANSLATIONS['en'];
};
