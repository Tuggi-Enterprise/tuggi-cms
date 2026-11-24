/**
 * The trip question out of the app (BR-COMUNICACAO-019 3.u, #1276, epic #1272): "Quando é sua
 * próxima viagem?" goes back, by push and by e-mail, to whoever has no active trip, once per
 * calendar month counting both channels; the push is a piece of its own, on the first Sunday.
 *
 * The database decides WHO and WHEN (`drive.trip_question_audience`, 3.u.1 and the spent month of
 * 3.u.2; `drive.claim_weekly_push` for the first Sunday at 19h, 3.u.3) and keeps the month
 * (`drive.mark_trip_question_sent`, called only after the FCM accepted the push or the e-mail left).
 * Contract: `docs/contracts/viagem-marcada-e-lembrete.md`, Parte 4. This file holds what both senders
 * share: the piece name, the link the app opens, the reading of the reminder switches and the push
 * words.
 *
 * Pure: no remote import and no `Deno` global.
 */
import { normalizeCopyLang } from './ranking-comm-i18n.ts';
import { TRIP_PUSH_COPY } from './trip-message-copy.ts';
import { TRIP_DEEPLINK } from './trip-reminder.ts';

/** `notification.data.piece` of the push; the app (#1277) reads the same name. */
export const TRIP_QUESTION_PIECE = 'trip_next_ask';

/**
 * The Passport sheet of a new trip, in question mode, with no trip (3.u.3). Same route as the day
 * ask of #1244 (`tuggi://trip?id=`), with `ask=1` in place of the id. Interface fixed with #1277.
 */
export const TRIP_ASK_DEEPLINK = `${TRIP_DEEPLINK}?ask=1`;

export type TripQuestionChannel = 'push' | 'email';

/**
 * Whether a reminder can reach the person by `channel`, read from `drive.cms_get_trip_settings`
 * (`switches: [{key, is_on}]`): `trip_reminder.enabled` (BR-COMUNICACAO-023 item 5) and the channel
 * switch. Anything unreadable is `false`, and the words then promise no reminder (copy §1 and §2):
 * a missing promise costs nothing, a false one breaks 023.
 */
export function reminderReachable(settings: unknown, channel: TripQuestionChannel): boolean {
  const switches = (settings as { switches?: unknown } | null)?.switches;
  if (!Array.isArray(switches)) return false;
  const on = (key: string) =>
    switches.some((s) => (s as { key?: unknown })?.key === key && (s as { is_on?: unknown })?.is_on === true);
  return on('trip_reminder.enabled') && on(`channel.${channel}`);
}

/** The user ids of a `trip_question_audience` answer (`[{user_id}]`); anything else is nobody. */
export function audienceIds(data: unknown): Set<string> {
  const out = new Set<string>();
  if (!Array.isArray(data)) return out;
  for (const row of data) {
    const id = (row as { user_id?: unknown } | null)?.user_id;
    if (typeof id === 'string' && id !== '') out.add(id);
  }
  return out;
}

/** The push of the question, in the person's language (3.u.5: no destination, no hours). */
export function tripQuestionPush(language: unknown, reminder: boolean): { title: string; body: string } {
  const lang = normalizeCopyLang(typeof language === 'string' ? language : null);
  return {
    title: TRIP_PUSH_COPY.next_ask_title[lang],
    body: (reminder ? TRIP_PUSH_COPY.next_ask_body : TRIP_PUSH_COPY.next_ask_body_no_reminder)[lang],
  };
}
