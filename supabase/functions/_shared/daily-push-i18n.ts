/**
 * The daily summary push: the copy and how one person's numbers compose it.
 * BR-COMUNICACAO-019 item 3.i (#1071), BR-COMUNICACAO-007, BR-COMUNICACAO-008, BR-IDIOMA-001 item 3.
 *
 * The sentences are `copy`'s, transcribed from `docs/design/copy/push-2026-11.md`, section A.4.
 * Whoever wants a different sentence changes that document first.
 *
 * The numbers come from `drive.get_morning_push_candidates()` (rows of `drive.daily_user_fomo_stats`),
 * and the database decides who is a candidate and when: the local morning hour and "used the app
 * yesterday" are not filtered again here. This module only decides what the text says:
 *
 *   heard >= 1, missed >= 1   title = heard title    body = nearby body + map body
 *   heard >= 1, missed = 0    title = heard title    body = map body
 *   heard = 0,  missed >= 1   title = nearby title   body = map body
 *   heard = 0,  missed = 0    nothing is sent (no fact to tell)
 *
 * Zero never renders as a number: the zero case changes the sentence. One and many are two
 * complete sentences, never a noun glued to a number. No sentence orders the guide on
 * (BR-COMUNICACAO-008): the guest and the free tier are in the audience, and the tap opens the
 * map, which every tier has (BR-MONETIZACAO-056).
 *
 * Pure: no remote import and no `Deno` global, so `tests/api/daily-summary-push.test.ts` loads it.
 */
import { normalizeCopyLang, type PluralForms, type RankingCopyLang } from './ranking-comm-i18n.ts';

/** `data.type` of the piece, and the kind the gate knows (`_shared/push-gate.ts`). */
export const DAILY_SUMMARY_TYPE = 'daily_summary';

/** Free in every tier (BR-COMUNICACAO-008 item 4). */
export const DAILY_SUMMARY_DEEPLINK = 'tuggi://map';

interface DailySummaryCopy {
  /** `daily.push.heard.title`, `{{heard}}`. */
  heardTitle: PluralForms;
  /** `daily.push.nearby.title`, `{{missed}}`. */
  nearbyTitle: PluralForms;
  /** `daily.push.nearby.body`, `{{missed}}`. */
  nearbyBody: PluralForms;
  /** `daily.push.map.body`. */
  mapBody: string;
}

export const DAILY_SUMMARY_COPY: Readonly<Record<RankingCopyLang, DailySummaryCopy>> = {
  pt: {
    heardTitle: { one: 'Ontem você ouviu 1 história', other: 'Ontem você ouviu {{heard}} histórias' },
    nearbyTitle: { one: 'Ontem você passou perto de 1 lugar', other: 'Ontem você passou perto de {{missed}} lugares' },
    nearbyBody: { one: 'Você também passou perto de 1 lugar.', other: 'Você também passou perto de {{missed}} lugares.' },
    mapBody: 'Veja no mapa o que tem ao redor de você hoje.',
  },
  en: {
    heardTitle: { one: 'Yesterday you heard 1 story', other: 'Yesterday you heard {{heard}} stories' },
    nearbyTitle: { one: 'Yesterday you passed near 1 place', other: 'Yesterday you passed near {{missed}} places' },
    nearbyBody: { one: 'You also passed near 1 place.', other: 'You also passed near {{missed}} places.' },
    mapBody: "Check the map for what's around you today.",
  },
  es: {
    heardTitle: { one: 'Ayer escuchaste 1 historia', other: 'Ayer escuchaste {{heard}} historias' },
    nearbyTitle: { one: 'Ayer pasaste cerca de 1 lugar', other: 'Ayer pasaste cerca de {{missed}} lugares' },
    nearbyBody: { one: 'También pasaste cerca de 1 lugar.', other: 'También pasaste cerca de {{missed}} lugares.' },
    mapBody: 'Mira en el mapa lo que tienes cerca hoy.',
  },
  fr: {
    heardTitle: { one: 'Hier, tu as écouté 1 histoire', other: 'Hier, tu as écouté {{heard}} histoires' },
    nearbyTitle: { one: 'Hier, 1 lieu sur ta route', other: 'Hier, {{missed}} lieux sur ta route' },
    nearbyBody: { one: 'Et 1 autre lieu sur ta route.', other: 'Et {{missed}} autres lieux sur ta route.' },
    mapBody: "Regarde sur la carte ce qu'il y a autour de toi aujourd'hui.",
  },
  it: {
    heardTitle: { one: 'Ieri hai ascoltato 1 storia', other: 'Ieri hai ascoltato {{heard}} storie' },
    nearbyTitle: { one: 'Ieri, 1 luogo lungo la tua strada', other: 'Ieri, {{missed}} luoghi lungo la tua strada' },
    nearbyBody: { one: "Lungo la strada c'era 1 altro luogo.", other: "Lungo la strada c'erano altri {{missed}} luoghi." },
    mapBody: "Guarda sulla mappa cosa c'è intorno a te oggi.",
  },
};

/** A whole number of 1 or more, or 0. A missing or broken count is no fact, so it reads 0. */
function count(raw: unknown): number {
  const n = Math.trunc(Number(raw));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function plural(forms: PluralForms, name: 'heard' | 'missed', n: number): string {
  return (n === 1 ? forms.one : forms.other).replace(`{{${name}}}`, String(n));
}

/**
 * Title and body for one person, or `null` when both counts are zero. `language` is
 * `drive.profiles.language` as stored; anything outside the catalogue reads English
 * (BR-COMUNICACAO-019 item 11).
 */
export function composeDailySummaryPush(
  language: string | null | undefined,
  heardCount: unknown,
  missedCount: unknown
): { title: string; body: string } | null {
  const heard = count(heardCount);
  const missed = count(missedCount);
  if (heard === 0 && missed === 0) return null;
  const copy = DAILY_SUMMARY_COPY[normalizeCopyLang(language)];
  if (heard === 0) return { title: plural(copy.nearbyTitle, 'missed', missed), body: copy.mapBody };
  const title = plural(copy.heardTitle, 'heard', heard);
  if (missed === 0) return { title, body: copy.mapBody };
  return { title, body: `${plural(copy.nearbyBody, 'missed', missed)} ${copy.mapBody}` };
}

/** The one-person `/send` body of the piece, the same body `firebase-push-notification/send` takes. */
export function dailySummarySendBody(userId: string, copy: { title: string; body: string }, date: string) {
  return {
    type: 'user',
    userIds: [userId],
    push_kind: DAILY_SUMMARY_TYPE,
    notification: {
      title: copy.title,
      body: copy.body,
      data: { type: DAILY_SUMMARY_TYPE, deeplink: DAILY_SUMMARY_DEEPLINK, date },
    },
    priority: 'high',
    // The body speaks of today; a push that reaches a phone switched on tomorrow is wrong.
    ttl: 43200,
  };
}
