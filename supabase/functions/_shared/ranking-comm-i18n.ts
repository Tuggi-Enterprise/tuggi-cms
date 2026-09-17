/**
 * The copy catalogue of the three ranking pieces — the sentences are `design`'s, transcribed.
 *
 * Card #747. The mechanism shipped on 2026-09-17 with the KEYS declared and NO VALUES, because
 * user-facing text is written by `design` (CLAUDE.md §1) and the sentences did not exist yet.
 * They exist now: `docs/design/spec-comunicacao-ranking-2026-09.md` (§1.2, §1.3, §1.4) and the
 * `design` handover on #747. **Nothing below is written here; everything below is copied from
 * there, character for character.** Whoever wants a different sentence changes the spec first.
 *
 * The key names are the MECHANISM's (`ranking.push.rank_drop.title`); the spec writes the same
 * sentences under reading paths of its own (`rankingPush.drop.title`). The map between the two is
 * in the #747 report and is not re-stated per key here — the sentence is the contract, the path is
 * a filing system.
 *
 * ---------------------------------------------------------------------------------------------
 * WHAT THE SENTENCES MAY AND MAY NOT CONTAIN — the ceiling is not editorial, it is structural
 * ---------------------------------------------------------------------------------------------
 *
 * 1. **Three variables exist, and only three: `{{rank}}`, `{{points}}` and `{{count}}`.** All
 *    three are facts about the recipient themselves (BR-MONETIZACAO-081 item 6.5). A value that
 *    names any other variable fails closed — see `resolveRankingCopy` — because the mechanism has
 *    nothing else to give it. `{{rank}}` renders as the ORDINAL of the reader's language, never as
 *    a bare number: `formatRankOrdinal` below is the server mirror of the app's table.
 * 2. **Each piece supplies only its own variables.** `streak_at_risk` supplies `{{count}}` and no
 *    position; `rank_at_risk` and `rank_drop` supply `{{rank}}`/`{{points}}` and no day count. The
 *    scoping is enforced by `rankingCopyVars`, so a sentence that reaches for the other piece's
 *    variable fails closed instead of rendering a blank.
 * 3. **No literal digits.** BR-RANKING-002 item 2 forbids the denominator AND anything it can be
 *    deduced from — a fraction, a percentage of position, "the last placed". Every number in these
 *    pieces comes from a variable or does not exist, so a literal digit in the sentence is refused
 *    by `resolveRankingCopy` rather than argued about in review.
 * 4. **No clock, and the ban reaches what can be deduced from one** — DS-COPY-070, and
 *    BR-COMUNICACAO-012 item 1.4.e underneath it. Two clocks disagree here and neither is the
 *    tourist's: the sending window is daily and the streak day boundary is midnight UTC. "Today",
 *    "tomorrow", "still time" are as forbidden as "3 hours left". Rule 3 covers the numeric half;
 *    `tests/api/ranking-comm-copy.test.ts` covers the words.
 * 5. **No cadence promise** — "no spam", "at most N per week" — while BR-COMUNICACAO-014 is
 *    `proposta` (BR-COMUNICACAO-012 item 2). Again, rule 3 covers the numeric half.
 *
 * ---------------------------------------------------------------------------------------------
 * WHY THE E-MAIL HALF IS STILL EMPTY, AND IT IS NOT AN OVERSIGHT
 * ---------------------------------------------------------------------------------------------
 *
 * `design` delivered ONE e-mail piece (spec §2.2/§2.3), not three, and it is not a catalogue value
 * in this shape for three independent reasons, any one of which is enough:
 *
 *   a. **Different audience.** The sentence is *"your line was not there this week"* — it is true
 *      only for an account ABSENT from the current roster (the 105 that uninstalled). Every e-mail
 *      decision `buildRankingDispatch` produces is for an account that IS in the roster, so the
 *      sentence would be false for the only recipients this mechanism can name today.
 *   b. **Different shape.** `send-newsletter` consumes `subject`, `preheader`, `title`,
 *      `paragraphs[]` and `cta_label`; `EmailCopyKeys` has three fields. `preheader` and
 *      `cta_label` have nowhere to land.
 *   c. **Different variable.** The paragraphs interpolate `{{first_name}}`, which
 *      `send-newsletter` substitutes and which `RankingDecision` deliberately does not carry —
 *      the decision payload holds no name, and widening it would undo that.
 *
 * So the nine `ranking.email.*` keys stay pending, the pieces keep failing closed on that channel,
 * and the e-mail is the `send-newsletter` campaign the #747 report asks for. Filling them from
 * the spec would publish a false sentence the day somebody wires the send.
 */

import type { RankingPiece } from './ranking-communication.ts';

/**
 * The five languages the app publishes — spec §1.1. **`fr` is here on purpose**: the daily module
 * (`daily-push-i18n.ts`, `getTranslation`) sends ENGLISH to whoever reads French, in writing, and
 * a ranking family that inherited that map would ship French pushes in English with no log and no
 * failure. Spec §1.6 and §8 item 2.
 *
 * And there is ONE Portuguese, not two. The daily module keeps `pt-br` and `pt-pt` because its
 * copy was written that way; this family has no pair that would justify a second translation
 * surface, and `design` chose one (§1.6, "Escolhi um português só. Registrado, não escalado.").
 */
export type RankingCopyLang = 'pt' | 'en' | 'es' | 'fr' | 'it';

export const RANKING_COPY_LANGS: readonly RankingCopyLang[] = ['pt', 'en', 'es', 'fr', 'it'];

/**
 * The languages the PROMOTIONAL e-mail sender publishes — four, not five.
 *
 * Spec §2.1: `FOOTER_LABELS` (`_shared/emailLayout.ts`), `FALLBACK_NAME` and `SITE_LOCALE`
 * (`send-newsletter/index.ts`) each carry `pt`, `en`, `es`, `it` and none carries `fr`. A French
 * recipient today would read a PORTUGUESE footer and be called `traveler`, in English. Turning
 * `fr` on is three lines in two files and it is a card of its own (spec §8 item 4) — until then
 * **`fr` is not in the e-mail audience**, and `mailableEmailLang` below is where that is enforced.
 */
export const RANKING_EMAIL_LANGS: readonly RankingCopyLang[] = ['pt', 'en', 'es', 'it'];

/**
 * The language cascade of spec §1.6, and it is NOT the daily module's.
 *
 * `pt-br` / `pt-pt` / `pt` → `pt` · `en` → `en` · `es` → `es` · `fr` → `fr` · `it` → `it` ·
 * anything else → `en`.
 */
export function normalizeCopyLang(raw: string | null | undefined): RankingCopyLang {
  const value = String(raw ?? '').toLowerCase().replace('_', '-');
  if (value.startsWith('pt')) return 'pt';
  if (value.startsWith('es')) return 'es';
  if (value.startsWith('fr')) return 'fr';
  if (value.startsWith('it')) return 'it';
  return 'en';
}

/**
 * The reader's language if the e-mail sender can address them, `null` if it cannot.
 *
 * `null` means "not in the audience", never "send in English": a French e-mail with a Portuguese
 * footer is worse than no e-mail, which is the same judgement `resolveRankingCopy` makes for a
 * missing sentence.
 */
export function mailableEmailLang(raw: string | null | undefined): RankingCopyLang | null {
  const lang = normalizeCopyLang(raw);
  return RANKING_EMAIL_LANGS.includes(lang) ? lang : null;
}

/**
 * `3º` / `3rd` / `3.º` / `3e` — the ordinal, per language.
 *
 * **This is a MIRROR, and a mirror without a test diverges.** The owner of the table is the app
 * (`tuggi-drive-v2/src/modules/wrapped/utils/rankingFormat.ts`, `ORDINAL_CONTEXT` +
 * `formatRankOrdinal`, published in the five `src/locales/*.json`); the Edge Function cannot
 * import from the app, so CLAUDE.md §6 allows the duplication and demands the parity test in
 * exchange — `tests/api/ranking-comm-copy.test.ts`, ranks 1 to 30, five languages. Spec §1.5.
 *
 * The two traps the parity test exists to catch, both from applying one language's rule to
 * another: English's teens exception is on the LAST TWO digits (11th, 12th, 13th — not 11st), and
 * French's `er` belongs to the number 1 ALONE (21 is `21e`, never `21er`).
 */
export function formatRankOrdinal(rank: number, lang: RankingCopyLang): string {
  const n = Math.trunc(rank);
  switch (lang) {
    case 'es':
      return `${n}.º`;
    case 'fr':
      return n === 1 ? `${n}er` : `${n}e`;
    case 'en': {
      const lastTwo = n % 100;
      if (lastTwo >= 11 && lastTwo <= 13) return `${n}th`;
      switch (n % 10) {
        case 1:
          return `${n}st`;
        case 2:
          return `${n}nd`;
        case 3:
          return `${n}rd`;
        default:
          return `${n}th`;
      }
    }
    case 'pt':
    case 'it':
    default:
      return `${n}º`;
  }
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
 * The key of every sentence this mechanism can emit. This object IS the list `design` fills;
 * nothing sends until the matching entry exists in `RANKING_COPY_CATALOG`.
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
export const RANKING_COPY_VARIABLES: readonly string[] = ['rank', 'points', 'count'];

/**
 * The two CLDR plural categories these counts reach, exactly as `daily-push-i18n.ts` carries them.
 *
 * A countable sentence has TWO complete variants and never a noun glued to a number: in Italian
 * the verb changes with the count, and a bare noun breaks exactly there. Selection is
 * `n === 1 ? one : other` and nothing else — the counts here never reach zero.
 */
export interface PluralForms {
  one: string;
  other: string;
}

/** A sentence, or the two forms of a countable sentence. */
export type CopyValue = string | PluralForms;

/**
 * key → language → sentence.
 *
 * The push half is FILLED, from spec §1.2 / §1.3 / §1.4. The e-mail half is empty and stays empty
 * — see the header. A key with no value for a language means that piece does not leave for that
 * language; there is no fallback, and silence beats a sentence in the wrong language.
 */
export const RANKING_COPY_CATALOG: Record<string, Partial<Record<RankingCopyLang, CopyValue>>> = {
  // -------------------------------------------------------------------------------------------
  // Piece 1 — rank drop. Spec §1.2, read there as `rankingPush.drop.*`.
  //
  // The body names the EXTERNAL cause (`someone moved ahead of you`) and not the recipient's
  // failure, which is DS-COPY-071: the account dropped because another one scored, and a piece
  // that accuses somebody who did nothing wrong costs an iOS permission that never comes back.
  // `fr` and `it` carry no drop verb in the TITLE because `être`/`essere` + participle inflects
  // for the reader's gender, which we decided not to know (DS-COPY-069).
  // -------------------------------------------------------------------------------------------
  'ranking.push.rank_drop.title': {
    pt: 'Você caiu para {{rank}} lugar',
    en: 'You dropped to {{rank}} place',
    es: 'Bajaste al {{rank}} puesto',
    fr: 'Tu passes {{rank}} au classement',
    it: 'Ora sei {{rank}} in classifica',
  },
  'ranking.push.rank_drop.body': {
    pt: 'Alguém passou à sua frente no placar desta semana. E a semana ainda não acabou.',
    en: "Someone moved ahead of you on this week's scoreboard. And the week is not over.",
    es: 'Alguien te adelantó en el marcador de esta semana. Y la semana no ha terminado.',
    fr: "Quelqu'un est passé devant toi au classement de cette semaine. Et la semaine n'est pas finie.",
    it: 'Qualcuno ti ha superato nella classifica di questa settimana. E la settimana non è finita.',
  },

  // -------------------------------------------------------------------------------------------
  // Piece 2 — streak at risk. Spec §1.3, read there as `rankingPush.streak.title.one` /
  // `.other` / `rankingPush.streak.body`.
  //
  // `one` never renders — the sender only evaluates this piece from two days up — and it is
  // written anyway, because a missing plural form becomes an empty string or an exception, not a
  // visible bug. The body is the SAME sentence the app's band already publishes
  // (`ranking.streak.at_risk`, #746): push and screen saying the same thing in different words is
  // what makes the tourist believe they are two states.
  // -------------------------------------------------------------------------------------------
  'ranking.push.streak_at_risk.title': {
    pt: { one: 'Sua sequência está em {{count}} dia', other: 'Sua sequência está em {{count}} dias' },
    en: { one: 'Your streak is at {{count}} day', other: 'Your streak is at {{count}} days' },
    es: { one: 'Tu racha está en {{count}} día', other: 'Tu racha está en {{count}} días' },
    fr: { one: 'Ta série est à {{count}} jour', other: 'Ta série est à {{count}} jours' },
    it: { one: 'La tua serie è a {{count}} giorno', other: 'La tua serie è a {{count}} giorni' },
  },
  'ranking.push.streak_at_risk.body': {
    pt: 'Falta uma história para ela continuar.',
    en: 'One more story keeps it going.',
    es: 'Falta una historia para que continúe.',
    fr: "Il manque une histoire pour qu'elle continue.",
    it: 'Manca una storia perché continui.',
  },

  // -------------------------------------------------------------------------------------------
  // Piece 3 — the balance ran out with the position in dispute. Spec §1.4, read there as
  // `rankingPush.balanceAtRisk.*`.
  //
  // Speaking of HOURS in a ranking piece opens no new purpose: *hours consumed* is purpose 1.1
  // and *ranking* is 1.4, both already on the closed list of BR-COMUNICACAO-012 item 1, and this
  // piece is their intersection (spec §1.4 and §8 item 5). The body orders nothing — it states
  // three facts about the recipient and stops, because in `free` the act would be refused
  // (BR-COMUNICACAO-008, BR-MONETIZACAO-055). "Someone a few points away" is neither the total
  // nor deducible from it (BR-RANKING-002 item 2).
  // -------------------------------------------------------------------------------------------
  'ranking.push.rank_at_risk.title': {
    pt: 'Suas horas acabaram',
    en: 'Your hours have run out',
    es: 'Se acabaron tus horas',
    fr: 'Tes heures sont terminées',
    it: 'Le tue ore sono finite',
  },
  'ranking.push.rank_at_risk.body': {
    pt: 'Você está em {{rank}} lugar, com alguém a poucos pontos de distância. Sem horas, o guia para de narrar.',
    en: 'You are in {{rank}} place, with someone just a few points away. With no hours, the guide stops narrating.',
    es: 'Estás en el {{rank}} puesto, con alguien a pocos puntos de distancia. Sin horas, la guía deja de narrar.',
    fr: "Tu es {{rank}} au classement, avec quelqu'un à quelques points de toi. Sans heures, le guide arrête de raconter.",
    it: 'Sei {{rank}} in classifica, con qualcuno a pochi punti da te. Senza ore, la guida smette di raccontare.',
  },
};

const PLACEHOLDER = /\{\{\s*([a-z_]+)\s*\}\}/g;

/** A digit that is not inside a placeholder — rule 3 of the header. */
function hasLiteralDigit(value: string): boolean {
  return /\d/.test(value.replace(PLACEHOLDER, ''));
}

/**
 * One sentence, or `null`.
 *
 * `null` for every one of these, and all of them are "do not send", never "send something else":
 *   - the key has no value for this language;
 *   - the value is a plural pair and `{{count}}` was not supplied — which is also what keeps the
 *     streak piece silent while the migration behind `core.account_streak` is not applied;
 *   - the value is blank once trimmed;
 *   - the value carries a literal digit (BR-RANKING-002 item 2);
 *   - the value names a variable this piece does not supply — including `{{rank}}` inside
 *     `streak_at_risk`, which has no rank to give, and `{{count}}` inside the other two.
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

  let picked: string;
  if (typeof raw === 'string') {
    picked = raw;
  } else if (raw && typeof raw === 'object') {
    const count = vars.count;
    if (typeof count !== 'number' || !Number.isFinite(count)) return null;
    picked = count === 1 ? raw.one : raw.other;
  } else {
    return null;
  }

  const value = String(picked ?? '').trim();
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
 * The facts one piece may state about its own recipient. Nothing here is a second source: the
 * rank and the points come from the scoreboard row, and the streak length comes from
 * `core.account_streak` — the only implementation of that count there is (CLAUDE.md §6).
 */
export interface RankingCopyFacts {
  rank: number | null;
  points: number | null;
  /**
   * `current_streak_days` of `core.account_streak`, for a run that is ALIVE and not yet completed
   * today. `undefined`/`null` is "not measured", and not measured is not zero: the streak piece
   * then has no `{{count}}` and its copy fails closed.
   *
   * **This depends on migration `20260917120000` of `db-tuggiApp` being applied.** Until it is,
   * the read fails, this arrives `null`, and the streak piece does not leave — which is the
   * behaviour we want from a piece that would otherwise state a number nobody computed.
   */
  streakDays?: number | null;
}

/**
 * The variables one piece supplies to its sentences, SCOPED to that piece.
 *
 * `streak_at_risk` gets `{{count}}` and no position; the other two get `{{rank}}` and
 * `{{points}}` and no day count. The scoping is the enforcement of rule 2 of the header: a
 * sentence reaching for the other piece's variable finds `undefined` and fails closed.
 *
 * `{{rank}}` is handed over ALREADY FORMATTED as the ordinal of the reader's language. Passing
 * the bare number would print "You dropped to 4 place", and a template has no way to fix that.
 */
export function rankingCopyVars(
  piece: RankingPiece,
  lang: RankingCopyLang,
  facts: Readonly<RankingCopyFacts>
): Record<string, string | number> {
  if (piece === 'streak_at_risk') {
    const days = facts.streakDays;
    if (typeof days !== 'number' || !Number.isFinite(days) || days < 1) return {};
    return { count: Math.trunc(days) };
  }
  const vars: Record<string, string | number> = {};
  if (facts.rank !== null && facts.rank !== undefined) vars.rank = formatRankOrdinal(facts.rank, lang);
  if (facts.points !== null && facts.points !== undefined) vars.points = Math.round(facts.points);
  return vars;
}
