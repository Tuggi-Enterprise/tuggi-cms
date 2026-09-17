/**
 * The copy catalogue of the three ranking pieces — DECLARED HERE, WRITTEN ELSEWHERE.
 *
 * Card #747. The sentences are the `design` agent's (CLAUDE.md §1: user-facing text is written by
 * `design`, and `produto` owns what may be asserted), and on the night this file was written they
 * did not exist yet. So the catalogue below ships with the KEYS declared and NO VALUES, and the
 * behaviour of a missing value is **the piece does not leave**.
 *
 * That is not a placeholder waiting to be forgotten: `resolveRankingCopy` returns `null` for any
 * key without a value, `buildRankingDispatch`'s caller skips the send, and
 * `tests/api/ranking-comm-copy.test.ts` proves the empty catalogue sends nothing. Filling a value
 * is the only thing needed to turn a piece on, and it is one edit in one file.
 *
 * ---------------------------------------------------------------------------------------------
 * WHAT THE SENTENCES MAY AND MAY NOT CONTAIN — the ceiling is not editorial, it is structural
 * ---------------------------------------------------------------------------------------------
 *
 * 1. **Two variables exist, and only two: `{{rank}}` and `{{points}}`.** Both are facts about the
 *    recipient themselves (BR-MONETIZACAO-081 item 6.5). A value that names any other variable
 *    fails closed — see `resolveRankingCopy` — because the mechanism has nothing else to give it.
 * 2. **`streak_at_risk` has NO variables at all.** The cross-week streak counter of BR-RANKING-008
 *    item 5.a has no implementation in the database; a day count in that sentence would have to be
 *    invented, and an invented number of business is a defect (CLAUDE.md §6).
 * 3. **No literal digits.** BR-RANKING-002 item 2 forbids the denominator AND anything it can be
 *    deduced from — a fraction, a percentage of position, "the last placed". Every number in these
 *    pieces comes from a variable or does not exist, so a literal digit in the sentence is refused
 *    by `resolveRankingCopy` rather than argued about in review.
 * 4. **No countdown in hours.** BR-COMUNICACAO-012 item 1.4.e: the daily window cannot sustain
 *    "3 hours left". Rule 3 above already makes the sentence unable to state one.
 * 5. **No cadence promise** — "no spam", "at most N per week" — while BR-COMUNICACAO-014 is
 *    `proposta` (BR-COMUNICACAO-012 item 2). Again, rule 3 covers the numeric half.
 */

import type { RankingPiece } from './ranking-communication.ts';

/** The five languages the app publishes, and the ones `daily-push-i18n.ts` already serves. */
export type RankingCopyLang = 'pt-br' | 'pt-pt' | 'en' | 'es' | 'it';

export const RANKING_COPY_LANGS: readonly RankingCopyLang[] = ['pt-br', 'pt-pt', 'en', 'es', 'it'];

/** Same normalisation as the daily push: `pt-BR` and `pt_br` are the same language. */
export function normalizeCopyLang(raw: string | null | undefined): RankingCopyLang {
  const value = String(raw ?? '').toLowerCase().replace('_', '-');
  if (value.startsWith('pt-pt')) return 'pt-pt';
  if (value.startsWith('pt')) return 'pt-br';
  if (value.startsWith('es')) return 'es';
  if (value.startsWith('it')) return 'it';
  return 'en';
}

/** The i18n keys of one push piece. */
export interface PushCopyKeys {
  title: string;
  body: string;
}

/** The i18n keys of one e-mail piece. */
export interface EmailCopyKeys {
  subject: string;
  heading: string;
  body: string;
}

/**
 * The key of every sentence this mechanism can emit. This object IS the list the `design` agent
 * fills; nothing sends until the matching entry exists in `RANKING_COPY_CATALOG`.
 */
export const RANKING_PUSH_COPY_KEYS: Record<RankingPiece, PushCopyKeys> = {
  streak_at_risk: {
    title: 'ranking.push.streak_at_risk.title',
    body: 'ranking.push.streak_at_risk.body',
  },
  rank_at_risk: {
    title: 'ranking.push.rank_at_risk.title',
    body: 'ranking.push.rank_at_risk.body',
  },
  rank_drop: {
    title: 'ranking.push.rank_drop.title',
    body: 'ranking.push.rank_drop.body',
  },
};

export const RANKING_EMAIL_COPY_KEYS: Record<RankingPiece, EmailCopyKeys> = {
  streak_at_risk: {
    subject: 'ranking.email.streak_at_risk.subject',
    heading: 'ranking.email.streak_at_risk.heading',
    body: 'ranking.email.streak_at_risk.body',
  },
  rank_at_risk: {
    subject: 'ranking.email.rank_at_risk.subject',
    heading: 'ranking.email.rank_at_risk.heading',
    body: 'ranking.email.rank_at_risk.body',
  },
  rank_drop: {
    subject: 'ranking.email.rank_drop.subject',
    heading: 'ranking.email.rank_drop.heading',
    body: 'ranking.email.rank_drop.body',
  },
};

/** Every key this module knows, flattened — what the `design` handover has to cover. */
export const RANKING_COPY_KEYS: readonly string[] = [
  ...Object.values(RANKING_PUSH_COPY_KEYS).flatMap((k) => [k.title, k.body]),
  ...Object.values(RANKING_EMAIL_COPY_KEYS).flatMap((k) => [k.subject, k.heading, k.body]),
];

/** The only variables a sentence of this mechanism may name. */
export const RANKING_COPY_VARIABLES: readonly string[] = ['rank', 'points'];

/**
 * key → language → sentence.
 *
 * **Empty on purpose, and the emptiness is load-bearing.** Every key of `RANKING_COPY_KEYS` is
 * pending a value from `design`; until then every piece fails closed. Fill a key for a language
 * and that piece starts leaving for that language, and only for it.
 */
export const RANKING_COPY_CATALOG: Record<string, Partial<Record<RankingCopyLang, string>>> = {};

const PLACEHOLDER = /\{\{\s*([a-z_]+)\s*\}\}/g;

/** A digit that is not inside a placeholder — rule 3 of the header. */
function hasLiteralDigit(value: string): boolean {
  return /\d/.test(value.replace(PLACEHOLDER, ''));
}

/**
 * One sentence, or `null`.
 *
 * `null` for every one of these, and all of them are "do not send", never "send something else":
 *   - the key has no value for this language (the normal state today);
 *   - the value is blank once trimmed;
 *   - the value carries a literal digit (BR-RANKING-002 item 2);
 *   - the value names a variable this piece does not supply — including `{{rank}}` inside
 *     `streak_at_risk`, which has no rank to give.
 *
 * There is no fallback to another language. A Portuguese sentence in an Italian push is a worse
 * failure than silence, and silence is the behaviour the card asked for.
 */
export function resolveRankingCopy(
  key: string,
  lang: RankingCopyLang,
  vars: Readonly<Record<string, string | number>>
): string | null {
  const raw = RANKING_COPY_CATALOG[key]?.[lang];
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  if (!value) return null;
  if (hasLiteralDigit(value)) return null;

  let unresolved = false;
  const rendered = value.replace(PLACEHOLDER, (_match, name: string) => {
    if (!RANKING_COPY_VARIABLES.includes(name) || vars[name] === undefined || vars[name] === null) {
      unresolved = true;
      return '';
    }
    return String(vars[name]);
  });
  return unresolved ? null : rendered;
}

/**
 * The whole push copy of one piece, or `null` if ANY of its keys is missing. A push with a title
 * and no body, or a body in the wrong language, is not a degraded piece — it is a defect that
 * costs an iOS permission that never comes back (BR-COMUNICACAO-012, `Contexto`).
 */
export function resolveRankingPushCopy(
  piece: RankingPiece,
  lang: RankingCopyLang,
  vars: Readonly<Record<string, string | number>>
): { title: string; body: string } | null {
  const keys = RANKING_PUSH_COPY_KEYS[piece];
  const title = resolveRankingCopy(keys.title, lang, vars);
  const body = resolveRankingCopy(keys.body, lang, vars);
  if (title === null || body === null) return null;
  return { title, body };
}

/** The whole e-mail copy of one piece, or `null` if any of its three keys is missing. */
export function resolveRankingEmailCopy(
  piece: RankingPiece,
  lang: RankingCopyLang,
  vars: Readonly<Record<string, string | number>>
): { subject: string; heading: string; body: string } | null {
  const keys = RANKING_EMAIL_COPY_KEYS[piece];
  const subject = resolveRankingCopy(keys.subject, lang, vars);
  const heading = resolveRankingCopy(keys.heading, lang, vars);
  const body = resolveRankingCopy(keys.body, lang, vars);
  if (subject === null || heading === null || body === null) return null;
  return { subject, heading, body };
}

/**
 * The variables one piece supplies to its sentences. `streak_at_risk` supplies none — see rule 2
 * of the header — so any placeholder in its copy fails closed.
 */
export function rankingCopyVars(
  piece: RankingPiece,
  decision: { rank: number | null; points: number | null }
): Record<string, string | number> {
  if (piece === 'streak_at_risk') return {};
  const vars: Record<string, string | number> = {};
  if (decision.rank !== null) vars.rank = decision.rank;
  if (decision.points !== null) vars.points = Math.round(decision.points);
  return vars;
}
