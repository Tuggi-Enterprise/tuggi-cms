/**
 * The push of the eve of a short concession's expiry: BR-COMUNICACAO-019 3.h.2, BR-MONETIZACAO-086
 * item 6.b, type `hours_expiring` (BR-COMUNICACAO-016). #1231.
 *
 * Copy: `docs/design/copy/voz-do-push-2026-11.md` §3.1, variants A and B, pt, en and fr. es, it and
 * de are the dev's over the pt, with the glossary of `push-2026-11.md` (de: du, Guthaben); they are
 * provisional until the `copy` reviews them. Each person gets one variant for good, by the id
 * (`eveVariant`), and `data.variant` carries it for the measurement (no new type, 016 item 3).
 *
 * 3.h.2.f, the ceiling: how much expires (the served value, as the balance), that it expires
 * tomorrow, and the invitation to listen, which holds because every recipient has a balance. No
 * price, no offer, no "last chance", no countdown. The tap opens `tuggi://map`.
 *
 * Pure: no remote import and no `Deno` global.
 */
import { normalizeCopyLang, type RankingCopyLang } from './ranking-comm-i18n.ts';
import { formatDuration } from './tourist-email.ts';

export const HOURS_EXPIRING_TYPE = 'hours_expiring';

/** BR-COMUNICACAO-008 item 4: the hours are used on the map. */
export const HOURS_EXPIRING_DEEPLINK = 'tuggi://map';

export type EveVariant = 'a' | 'b';

/** The variants in the draw. Leave `['a']` to send A to everyone. */
export const EVE_VARIANTS: readonly EveVariant[] = ['a', 'b'];

type Piece = { title: string; body: string };

export const HOURS_EXPIRING_PUSH_COPY: Readonly<Record<EveVariant, Record<RankingCopyLang, Piece>>> = {
  a: {
    pt: {
      title: 'Suas horas grátis vencem amanhã',
      body: 'Você tem {{duration}} de guia grátis. Ligue o guia e ouça a história dos lugares por onde passar.',
    },
    en: {
      title: 'Your free hours expire tomorrow',
      body: 'You have {{duration}} of free guide time. Turn on the guide and hear the stories of the places you pass.',
    },
    es: {
      title: 'Tus horas gratis vencen mañana',
      body: 'Tienes {{duration}} de guía gratis. Activa la guía y escucha la historia de los lugares por donde pases.',
    },
    fr: {
      title: 'Tes heures offertes expirent demain',
      body: "Tu as {{duration}} de guide offert. Active le guide et écoute l'histoire des lieux où tu passes.",
    },
    it: {
      title: 'Le tue ore gratuite scadono domani',
      body: 'Hai {{duration}} di guida gratis. Attiva la guida e ascolta la storia dei luoghi dove passi.',
    },
    de: {
      title: 'Deine Gratis-Stunden laufen morgen ab',
      body: 'Du hast {{duration}} Guide gratis. Schalte ihn ein und hör die Geschichten der Orte, an denen du vorbeikommst.',
    },
  },
  b: {
    pt: {
      title: '{{duration}} de guia grátis para ouvir',
      body: 'Ligue o guia e ouça a história dos lugares por onde passar. Essas horas vencem amanhã.',
    },
    en: {
      title: '{{duration}} of free guide time to use',
      body: 'Turn on the guide and hear the stories of the places you pass. These hours expire tomorrow.',
    },
    es: {
      title: '{{duration}} de guía gratis para escuchar',
      body: 'Activa la guía y escucha la historia de los lugares por donde pases. Estas horas vencen mañana.',
    },
    fr: {
      title: '{{duration}} de guide offert à écouter',
      body: "Active le guide et écoute l'histoire des lieux où tu passes. Ces heures expirent demain.",
    },
    it: {
      title: '{{duration}} di guida gratis da ascoltare',
      body: 'Attiva la guida e ascolta la storia dei luoghi dove passi. Queste ore scadono domani.',
    },
    de: {
      title: '{{duration}} Guide gratis zum Hören',
      body: 'Schalte den Guide ein und hör die Geschichten der Orte unterwegs. Die Stunden laufen morgen ab.',
    },
  },
};

/** One variant per person, for good: the last hex digit of the id, which is random in a v4 uuid. */
export function eveVariant(userId: string): EveVariant {
  if (EVE_VARIANTS.length === 1) return EVE_VARIANTS[0];
  const digit = parseInt(userId.replace(/[^0-9a-f]/gi, '').slice(-1) || '0', 16);
  return EVE_VARIANTS[(Number.isNaN(digit) ? 0 : digit) % EVE_VARIANTS.length];
}

/** The push, or `null` without a positive number of minutes: an hours push without hours is worse than none. */
export function hoursExpiringPush(
  language: unknown,
  minutes: unknown,
  variant: EveVariant
): Piece | null {
  const duration = formatDuration(minutes);
  if (!duration) return null;
  const copy = HOURS_EXPIRING_PUSH_COPY[variant][normalizeCopyLang(typeof language === 'string' ? language : null)];
  return {
    title: copy.title.replace('{{duration}}', duration),
    body: copy.body.replace('{{duration}}', duration),
  };
}

/** The one-person `/send` body of `firebase-push-notification`, or `null` when there is nothing to say. */
export function hoursExpiringSendBody(
  userId: string,
  language: unknown,
  minutes: unknown
): Record<string, unknown> | null {
  const variant = eveVariant(userId);
  const push = hoursExpiringPush(language, minutes, variant);
  if (!push) return null;
  return {
    type: 'user',
    userIds: [userId],
    push_kind: HOURS_EXPIRING_TYPE,
    notification: {
      title: push.title,
      body: push.body,
      data: { type: HOURS_EXPIRING_TYPE, deeplink: HOURS_EXPIRING_DEEPLINK, variant },
    },
    priority: 'high',
    // Sent outside the quiet hours; a push held longer by a phone switched off could land in them.
    ttl: 3600,
  };
}
