/**
 * The words of the trip messages (#1231, #1244): the reminder N days before and on the day, and the
 * day ask of a month-only trip (BR-COMUNICACAO-023 items 2 and 2.1), by push, e-mail, SMS and
 * WhatsApp, and the confirmation of the number (BR-COMUNICACAO-024 item 5) by SMS and WhatsApp.
 *
 * Source: `docs/design/copy/lembrete-concierge-1244-2026-11.md` (push §2, e-mail §3, SMS §4.2,
 * WhatsApp parameters §4.1 and §4.3), which replaces where it conflicts `proxima-viagem-1229-2026-11.md`
 * §9 and `voz-do-push-2026-11.md` §3. SMS M1 to M5 and the stop replies are still the §9 ones.
 * The voice is the concierge of 023 item 6.1: the subject is Tuggi on the trip, not the trip.
 *
 * What the copy may say (023, ceiling): the date, the destination when given, and in the first send
 * the trip hours and until when they are valid (BR-MONETIZACAO-091 item 9). Hours are named only
 * where the message carries `trip_hours` or the balance. Nothing a person typed goes into a message
 * model (security-reviewer, #1230, condition 2): the destination is the geocoder's city name, never
 * free text, and it goes only into the push and the e-mail, never into SMS or WhatsApp.
 *
 * Pure: no remote import and no `Deno` global.
 */
import { normalizeCopyLang, type RankingCopyLang } from './ranking-comm-i18n.ts';
import { DEFAULT_TIME_ZONE, formatDuration, normalizeTouristLang, type TouristEmailLang } from './tourist-email.ts';

/** `drive.claim_due_trip_reminders.piece`; `trip_month_ask` is the day ask of 023 item 2.1 (#1244). */
export type TripPiece = 'trip_reminder_before' | 'trip_reminder_day' | 'trip_month_ask';

/**
 * Which message: M1 confirmation, M2 hours released, M3 upcoming, M4 day with balance, M5 day, and
 * the day ask (`month_ask`, and `month_ask_nodate` for a number not yet confirmed, BR-COMUNICACAO-024
 * item 14.a, which only the SMS has: on WhatsApp that number gets the M3 model, copy §4.1).
 */
export type CopyPiece = 'M1' | 'M2' | 'M3' | 'M4' | 'M5' | 'month_ask' | 'month_ask_nodate';

/** What a reminder carries, from `drive.claim_due_trip_reminders`, plus the balance on the day. */
export interface TripFacts {
  piece: TripPiece;
  trip_date: string;
  date_precision: 'day' | 'month';
  destination: { city: string | null; country_code: string } | null;
  trip_hours: { minutes: number; expires_at: string } | null;
  /** The balance on the day (`drive.get_entitlement`); `null` when unknown or not read. */
  balance_minutes: number | null;
}

/** The payload carries hours credited to this trip: it is the first send of the trip (023 item 6). */
function hasTripHours(facts: TripFacts): boolean {
  return !!facts.trip_hours && facts.trip_hours.minutes > 0;
}

/** BR-COMUNICACAO-023 items 2.1 and 6: the message the facts call for. */
export function copyPieceOf(facts: TripFacts): CopyPiece {
  if (facts.piece === 'trip_month_ask') return 'month_ask';
  if (facts.piece === 'trip_reminder_before') return hasTripHours(facts) ? 'M2' : 'M3';
  return (facts.balance_minutes ?? 0) > 0 ? 'M4' : 'M5';
}

// ------------------------------------------------------------------------------------- numbers

const DATE_LOCALE: Record<RankingCopyLang, string> = {
  pt: 'pt-BR',
  en: 'en-US',
  es: 'es-ES',
  fr: 'fr-FR',
  it: 'it-IT',
  de: 'de-DE',
};

/** `{{days}}` with the plural (and the German dative of "in ... Tagen"), as §9 asks the dev. */
export function formatDays(days: number, lang: RankingCopyLang): string {
  const one = days === 1;
  const word: Record<RankingCopyLang, [string, string]> = {
    pt: ['dia', 'dias'],
    en: ['day', 'days'],
    es: ['día', 'días'],
    fr: ['jour', 'jours'],
    it: ['giorno', 'giorni'],
    de: ['Tag', 'Tagen'],
  };
  return `${days} ${word[lang][one ? 0 : 1]}`;
}

/** Whole days from today (UTC calendar) to a `YYYY-MM-DD`, at least 1. */
export function daysUntilDate(tripDate: string, now: Date): number {
  const trip = Date.parse(`${tripDate}T00:00:00Z`);
  const today = Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(trip)) return 1;
  return Math.max(1, Math.round((trip - today) / 86_400_000));
}

const longFormats = new Map<string, Intl.DateTimeFormat>();
function cachedFormat(locale: string, options: Intl.DateTimeFormatOptions, zone: string): Intl.DateTimeFormat {
  const key = `${locale}|${JSON.stringify(options)}|${zone}`;
  let f = longFormats.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(locale, { ...options, timeZone: zone });
    longFormats.set(key, f);
  }
  return f;
}

/** `21 de janeiro`: long month, no year, in São Paulo (the reminder has no zone of its own). */
export function longDateNoYear(iso: string, lang: RankingCopyLang): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return cachedFormat(DATE_LOCALE[lang], { day: 'numeric', month: 'long' }, DEFAULT_TIME_ZONE).format(d);
}

/** The trip date of the e-mail detail line: `12 de janeiro de 2027`, or `janeiro de 2027` for a month. */
export function tripDateLine(tripDate: string, precision: 'day' | 'month', lang: RankingCopyLang): string | null {
  const d = new Date(`${tripDate}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  const options: Intl.DateTimeFormatOptions =
    precision === 'month' ? { month: 'long', year: 'numeric' } : { day: 'numeric', month: 'long', year: 'numeric' };
  return cachedFormat(DATE_LOCALE[lang], options, 'UTC').format(d);
}

/**
 * `{{month}}`, copy "Como ler": the month of the trip date, spelled out, no year, as `Intl` gives it
 * (lower case in pt, es, fr and it, capitalised in en and de).
 */
export function tripMonth(tripDate: string, lang: RankingCopyLang): string | null {
  const d = new Date(`${tripDate}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return cachedFormat(DATE_LOCALE[lang], { month: 'long' }, 'UTC').format(d);
}

/** §9.d: the SMS date is numeric, `21/01` (`01/21` in English, `21.01.` in German). */
export function numericDate(iso: string, lang: RankingCopyLang): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const parts = cachedFormat('en-CA', { month: '2-digit', day: '2-digit' }, DEFAULT_TIME_ZONE).formatToParts(d);
  const dd = parts.find((p) => p.type === 'day')?.value ?? '';
  const mm = parts.find((p) => p.type === 'month')?.value ?? '';
  if (lang === 'en') return `${mm}/${dd}`;
  if (lang === 'de') return `${dd}.${mm}.`;
  return `${dd}/${mm}`;
}

/**
 * The destination city as it may appear in the push and the e-mail. It comes from the geocoder on the
 * phone, but the RPC takes whatever the client sends, so it is held to a name: letters, spaces,
 * dots, hyphens and apostrophes, up to 40. Anything else drops the destination, never the message.
 */
export function safeCity(value: unknown): string | null {
  const city = String(value ?? '').trim().replace(/\s+/g, ' ');
  return /^[\p{L}\p{M}][\p{L}\p{M} .'’-]{0,39}$/u.test(city) ? city : null;
}

function fill(template: string, vars: Record<string, string>): string | null {
  const out = template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? `{{${key}}}`);
  return out.includes('{{') ? null : out;
}

/** The hours of this trip and until when, written out; `null` when absent or not writable. */
function grantedHours(facts: TripFacts, lang: RankingCopyLang): { trip_hours: string; valid_until: string } | null {
  if (!facts.trip_hours) return null;
  const hours = formatDuration(facts.trip_hours.minutes);
  const valid = longDateNoYear(facts.trip_hours.expires_at, lang);
  return hours && valid ? { trip_hours: hours, valid_until: valid } : null;
}

// ------------------------------------------------------------------------------------------ push

type Six = Record<RankingCopyLang, string>;

/** Push copy, §2. Title up to 40, body up to 110. */
export const TRIP_PUSH_COPY = {
  m2_title_destination: {
    pt: '{{destination}} te espera',
    en: '{{destination}} awaits',
    es: '{{destination}} te espera',
    fr: "{{destination}} t'attend",
    it: '{{destination}} ti aspetta',
    de: '{{destination}} wartet auf dich',
  },
  m2_title: {
    pt: 'Falta pouco para a sua viagem',
    en: 'Your trip is almost here',
    es: 'Ya falta poco para tu viaje',
    fr: "C'est bientôt le départ",
    it: 'Manca poco alla partenza',
    de: 'Bald geht die Reise los',
  },
  m2_body: {
    pt: 'Você ganhou {{trip_hours}} de guia para usar até {{date}}. Com ele ligado, nenhuma história passa batido.',
    en: 'You got {{trip_hours}} of guide time, valid until {{date}}. Turn it on along the way and no story slips by.',
    es: 'Ganaste {{trip_hours}} de guía para usar hasta el {{date}}. Actívala y no se te escapa ninguna historia.',
    fr: "Tu as gagné {{trip_hours}} de guide à utiliser jusqu'au {{date}}. Active-le et aucune histoire ne t'échappe.",
    it: 'Hai ricevuto {{trip_hours}} di guida, da usare entro il {{date}}. Attivala e nessuna storia ti sfugge.',
    de: 'Du hast {{trip_hours}} Guide bekommen, gültig bis zum {{date}}. So entgeht dir unterwegs keine Geschichte.',
  },
  m3_body: {
    pt: 'Leve o Tuggi e nenhum lugar com história passa batido: ele vai contando enquanto você dirige ou caminha.',
    en: 'Take Tuggi along and no place with a story slips by. It tells you the story as you drive or walk past.',
    es: 'Lleva Tuggi y ningún lugar con historia se te escapa: te la va contando mientras conduces o caminas.',
    fr: "Emporte Tuggi et aucun lieu qui a une histoire ne t'échappe. Il te la raconte en route, à pied ou en voiture.",
    it: 'Porta Tuggi e nessun luogo con una storia ti sfugge: te la racconta mentre guidi o cammini.',
    de: 'Nimm Tuggi mit, dann entgeht dir kein Ort mit Geschichte. Tuggi erzählt sie dir beim Fahren oder Gehen.',
  },
  m4_title: {
    pt: 'Boa viagem, o Tuggi vai junto',
    en: "Have a great trip, Tuggi's coming too",
    es: 'Buen viaje, Tuggi te acompaña',
    fr: "Bon voyage, Tuggi t'accompagne",
    it: 'Buon viaggio, Tuggi viene con te',
    de: 'Gute Reise, Tuggi kommt mit',
  },
  m4_body: {
    pt: 'Você tem {{balance}} de guia. Ligue o guia e ouça a história dos lugares por onde passar, até dirigindo.',
    en: 'You have {{balance}} of guide time. Turn it on and hear the stories along the way, even while driving.',
    es: 'Tienes {{balance}} de guía. Actívala y escucha la historia de los lugares por donde pases, incluso al volante.',
    fr: "Tu as {{balance}} de guide. Active-le et écoute l'histoire des lieux où tu passes, même au volant.",
    it: 'Hai {{balance}} di guida. Attivala e ascolta la storia dei luoghi dove passi, anche mentre guidi.',
    de: 'Du hast {{balance}} Guide. Schalt ihn ein und hör die Geschichten der Orte unterwegs, auch beim Fahren.',
  },
  m5_body: {
    pt: 'Hoje, não deixe a história do caminho passar batido. O Tuggi te conta enquanto você segue, de carro ou a pé.',
    en: "Don't let the stories along the way slip by today. Tuggi tells them as you go, by car or on foot.",
    es: 'Que hoy no se te escape la historia del camino. Tuggi te la cuenta mientras avanzas, a pie o al volante.',
    fr: 'Ne laisse pas filer les histoires de la route. Tuggi te les raconte en chemin, en voiture ou à pied.',
    it: 'Oggi non perderti le storie lungo la strada. Tuggi te le racconta mentre vai, in auto o a piedi.',
    de: 'Lass dir heute die Geschichten am Weg nicht entgehen. Tuggi erzählt sie dir, im Auto oder zu Fuß.',
  },
  month_ask_title_destination: {
    pt: 'Chegou {{month}}, e {{destination}} te espera',
    en: "It's {{month}}, and {{destination}} awaits",
    es: 'Llegó {{month}}, {{destination}} te espera',
    fr: "Voilà {{month}}, et {{destination}} t'attend",
    it: 'Ecco {{month}}, e {{destination}} ti aspetta',
    de: '{{month}} ist da, {{destination}} wartet',
  },
  month_ask_title: {
    pt: 'Chegou {{month}}, o mês da sua viagem',
    en: "It's {{month}}, the month of your trip",
    es: 'Llegó {{month}}, el mes de tu viaje',
    fr: 'Voilà {{month}}, le mois de ton voyage',
    it: 'Ecco {{month}}, il mese del tuo viaggio',
    de: '{{month}} ist da, dein Reisemonat',
  },
  month_ask_body: {
    pt: 'Já sabe o dia? Marque no Tuggi, e a gente te lembra na hora certa de ouvir as histórias do caminho.',
    en: "Know the day yet? Add it in Tuggi and we'll remind you right on time to hear the stories on the way.",
    es: '¿Ya sabes el día? Márcalo en Tuggi y te avisamos a tiempo para escuchar las historias del camino.',
    fr: 'Tu connais le jour ? Note-le dans Tuggi et on te prévient à temps pour écouter les histoires de la route.',
    it: 'Sai già il giorno? Segnalo su Tuggi e ti avvisiamo al momento giusto per ascoltare le storie del viaggio.',
    de: 'Weißt du schon den Tag? Trag ihn in Tuggi ein, dann erinnern wir dich rechtzeitig an die Geschichten am Weg.',
  },
  /**
   * The day ask that is also the first send of the trip (023 2.1.f): the hours it got and until
   * when, then the ask. Copy §2; `{{date}}` is the validity, as in `m2_body`.
   */
  month_ask_hours_body: {
    pt: 'Você ganhou {{trip_hours}} para ouvir a história do caminho até {{date}}. Já sabe o dia? Marque no Tuggi.',
    en: 'You got {{trip_hours}} to hear the stories on the way, until {{date}}. Know the day yet? Add it in Tuggi.',
    es: 'Ganaste {{trip_hours}} para oír las historias del camino hasta el {{date}}. ¿Ya sabes el día? Márcalo.',
    fr: "Tu as gagné {{trip_hours}} pour écouter l'histoire du chemin jusqu'au {{date}}. Tu connais le jour\u00a0? Note-le.",
    it: 'Hai ricevuto {{trip_hours}} per ascoltare le storie del viaggio fino al {{date}}. Sai già il giorno? Segnalo.',
    de: 'Du hast {{trip_hours}} für die Geschichten am Weg, gültig bis zum {{date}}. Weißt du den Tag? Trag ihn ein.',
  },
} satisfies Record<string, Six>;

export const PUSH_TITLE_MAX = 40;
export const PUSH_BODY_MAX = 110;

/** The push of one reminder, or `null` when a fact it needs is missing. */
export function tripReminderPush(facts: TripFacts, language: unknown): { title: string; body: string } | null {
  const lang = normalizeCopyLang(typeof language === 'string' ? language : null);
  const c = TRIP_PUSH_COPY;
  const vars: Record<string, string> = {};
  const city = safeCity(facts.destination?.city);
  if (city) vars.destination = city;
  const month = tripMonth(facts.trip_date, lang);
  if (month) vars.month = month;
  const titleWith = (withDestination: string, without: string): string | null => {
    const t = city ? fill(withDestination, vars) : null;
    return t && t.length <= PUSH_TITLE_MAX ? t : fill(without, vars);
  };
  const hours = grantedHours(facts, lang);
  const hoursVars = hours ? { trip_hours: hours.trip_hours, date: hours.valid_until } : null;
  const piece = copyPieceOf(facts);
  let title: string | null;
  let body: string | null;
  if (piece === 'month_ask') {
    // 023 2.1.f: being the first send of the trip, it also says the hours it got.
    if (hasTripHours(facts) && !hoursVars) return null;
    title = titleWith(c.month_ask_title_destination[lang], c.month_ask_title[lang]);
    body = hoursVars ? fill(c.month_ask_hours_body[lang], hoursVars) : c.month_ask_body[lang];
  } else if (piece === 'M2' || piece === 'M3') {
    // One title for both, with no count: a month-only trip is not "in 3 days" (023 item 6).
    title = titleWith(c.m2_title_destination[lang], c.m2_title[lang]);
    if (piece === 'M3') body = c.m3_body[lang];
    else if (!hoursVars) return null;
    else body = fill(c.m2_body[lang], hoursVars);
  } else {
    title = c.m4_title[lang];
    const balance = formatDuration(facts.balance_minutes);
    if (piece === 'M4' && !balance) return null;
    body = piece === 'M4' && balance ? fill(c.m4_body[lang], { balance }) : c.m5_body[lang];
  }
  return title && body ? { title, body } : null;
}

// ---------------------------------------------------------------------------------------- e-mail

type Five = Record<TouristEmailLang, string>;

/** §3. Greeting without a name, the paragraphs, a detail line, one button, and a footer of its own. */
export const TRIP_EMAIL_COPY = {
  greeting: {
    pt: 'Olá,',
    en: 'Hi,',
    es: 'Hola,',
    fr: 'Bonjour,',
    it: 'Ciao,',
  },
  m2_subject: {
    pt: 'Você ganhou {{trip_hours}} de guia para a viagem',
    en: 'You got {{trip_hours}} of guide time for your trip',
    es: 'Ganaste {{trip_hours}} de guía para tu viaje',
    fr: 'Tu as gagné {{trip_hours}} de guide pour ton voyage',
    it: 'Hai ricevuto {{trip_hours}} di guida per il viaggio',
  },
  m2_body: {
    pt: 'Sua viagem está chegando, e você ganhou {{trip_hours}} de guia para ela, já no seu saldo do Tuggi e com validade até {{valid_until}}.',
    en: 'Your trip is almost here, and you got {{trip_hours}} of guide time for it, already in your Tuggi balance and valid until {{valid_until}}.',
    es: 'Tu viaje se acerca, y ganaste {{trip_hours}} de guía para él, ya en tu saldo de Tuggi y con validez hasta el {{valid_until}}.',
    fr: "Ton voyage approche, et tu as gagné {{trip_hours}} de guide pour l'occasion, déjà dans ton solde Tuggi, à utiliser jusqu'au {{valid_until}}.",
    it: 'Il viaggio si avvicina e hai ricevuto {{trip_hours}} di guida, già nel tuo saldo Tuggi, da usare entro il {{valid_until}}.',
  },
  m2_call: {
    pt: 'No caminho, ligue o guia e o Tuggi conta em áudio a história dos lugares por onde você passa, até enquanto dirige. Sem o Tuggi, essas histórias ficam sem ninguém contar.',
    en: 'Along the way, turn on the guide and Tuggi tells you the story of the places you pass, out loud, even while you drive. Without Tuggi, those stories go untold.',
    es: 'En el camino, activa la guía y Tuggi te cuenta en audio la historia de los lugares por donde pasas, incluso mientras conduces. Sin Tuggi, esas historias pasan de largo.',
    fr: "En route, active le guide et Tuggi te raconte en audio l'histoire des lieux où tu passes, même au volant. Sans Tuggi, ces histoires passent inaperçues.",
    it: 'Lungo la strada, attiva la guida e Tuggi ti racconta in audio la storia dei luoghi dove passi, anche mentre guidi. Senza Tuggi, quelle storie passano inosservate.',
  },
  m3_subject: {
    pt: 'Falta pouco para a viagem. Leve o Tuggi junto',
    en: 'Your trip is almost here. Take Tuggi along',
    es: 'Falta poco para tu viaje. Lleva Tuggi contigo',
    fr: "C'est bientôt le départ. Emporte Tuggi",
    it: 'Manca poco alla partenza. Porta Tuggi con te',
  },
  m3_body: {
    pt: 'Onde houver história no caminho, o Tuggi te conta em áudio enquanto você passa pelo lugar, dirigindo ou andando. Sem o Tuggi, essas histórias ficam sem ninguém contar.',
    en: "Wherever there's a story along the way, Tuggi tells it to you out loud as you pass by, driving or walking. Without Tuggi, those stories go untold.",
    es: 'Donde haya una historia en el camino, Tuggi te la cuenta en audio mientras pasas por el lugar, conduciendo o caminando. Sin Tuggi, esas historias pasan de largo.',
    fr: 'Là où la route a une histoire, Tuggi te la raconte en audio au moment où tu passes, en voiture ou à pied. Sans Tuggi, ces histoires passent inaperçues.',
    it: 'Dove la strada ha una storia, Tuggi te la racconta in audio mentre passi, in auto o a piedi. Senza Tuggi, quelle storie passano inosservate.',
  },
  day_subject: {
    pt: 'Boa viagem, o Tuggi vai junto',
    en: "Have a great trip, Tuggi's coming too",
    es: 'Buen viaje, Tuggi te acompaña',
    fr: "Bon voyage, Tuggi t'accompagne",
    it: 'Buon viaggio, Tuggi viene con te',
  },
  day_balance_body: {
    pt: 'Hoje é dia de viagem, e você tem {{balance}} de guia no Tuggi. No caminho, ligue o guia e ouça a história dos lugares por onde você passa, até enquanto dirige.',
    en: "Today's the day, and you have {{balance}} of guide time in Tuggi. Along the way, turn on the guide and hear the story of the places you pass, even while you drive.",
    es: 'Hoy es día de viaje y tienes {{balance}} de guía en Tuggi. En el camino, activa la guía y escucha la historia de los lugares por donde pasas, incluso mientras conduces.',
    fr: "C'est le jour du départ, et tu as {{balance}} de guide dans Tuggi. En route, active le guide et écoute l'histoire des lieux où tu passes, même au volant.",
    it: 'Oggi si parte, e hai {{balance}} di guida su Tuggi. Lungo la strada, attiva la guida e ascolta la storia dei luoghi dove passi, anche mentre guidi.',
  },
  day_free_body: {
    pt: 'Hoje é dia de viagem, e a história do caminho não precisa passar batido. Onde houver uma, o Tuggi te conta em áudio enquanto você passa, dirigindo ou andando.',
    en: "Today's the day, and the stories along the way don't have to slip by. Wherever there's one, Tuggi tells it to you out loud as you pass, driving or walking.",
    es: 'Hoy es día de viaje, y la historia del camino no tiene por qué pasar de largo. Donde haya una, Tuggi te la cuenta en audio mientras pasas, conduciendo o caminando.',
    fr: "C'est le jour du départ, et les histoires de la route n'ont pas à passer inaperçues. Là où il y en a une, Tuggi te la raconte en audio quand tu passes, en voiture ou à pied.",
    it: "Oggi si parte, e le storie lungo la strada non devono passare inosservate. Dove ce n'è una, Tuggi te la racconta in audio mentre passi, in auto o a piedi.",
  },
  month_ask_body: {
    pt: 'Sua viagem é em {{month}}, e o Tuggi quer ir junto. Já sabe o dia? Marque no app, e a gente te lembra na hora certa.',
    en: "Your trip is in {{month}}, and Tuggi wants to come along. Know the day yet? Add it in the app and we'll remind you right on time.",
    es: 'Tu viaje es en {{month}} y Tuggi quiere acompañarte. ¿Ya sabes el día? Márcalo en la app y te avisamos a tiempo.',
    fr: "Ton voyage, c'est en {{month}}, et Tuggi compte bien t'accompagner. Tu connais le jour ? Note-le dans l'app, et on te prévient au bon moment.",
    it: "Il tuo viaggio è in {{month}} e Tuggi vuole venire con te. Sai già il giorno? Segnalo nell'app e ti avvisiamo al momento giusto.",
  },
  month_ask_call: {
    pt: 'No caminho, o Tuggi conta em áudio a história dos lugares por onde você passa. Seria uma pena essas histórias ficarem sem ninguém contar.',
    en: 'Along the way, Tuggi tells you the story of the places you pass, out loud. It would be a shame to let those stories go untold.',
    es: 'En el camino, Tuggi te cuenta en audio la historia de los lugares por donde pasas. Sería una pena que esas historias pasaran de largo.',
    fr: "En route, Tuggi te raconte en audio l'histoire des lieux où tu passes. Ce serait dommage de laisser ces histoires passer inaperçues.",
    it: 'Lungo la strada, Tuggi ti racconta in audio la storia dei luoghi dove passi. Sarebbe un peccato lasciar passare inosservate quelle storie.',
  },
  button: {
    pt: 'Abrir o Tuggi',
    en: 'Open Tuggi',
    es: 'Abrir Tuggi',
    fr: 'Ouvrir Tuggi',
    it: 'Apri Tuggi',
  },
  month_ask_button: {
    pt: 'Marcar o dia',
    en: 'Add the day',
    es: 'Marcar el día',
    fr: 'Indiquer le jour',
    it: 'Segna il giorno',
  },
  footer: {
    pt: 'Você recebe este e-mail porque marcou a data da sua viagem no Tuggi.',
    en: "You're getting this email because you added your trip date in Tuggi.",
    es: 'Recibes este correo porque marcaste la fecha de tu viaje en Tuggi.',
    fr: 'Tu reçois cet e-mail parce que tu as noté la date de ton voyage dans Tuggi.',
    it: 'Ricevi questa e-mail perché hai segnato la data del tuo viaggio su Tuggi.',
  },
  stop_link: {
    pt: 'Prefiro não receber os lembretes por e-mail',
    en: "I'd rather not get these reminders by email",
    es: 'Prefiero no recibir estos recordatorios por correo',
    fr: 'Je préfère ne plus recevoir ces rappels par e-mail',
    it: 'Preferisco non ricevere questi promemoria via e-mail',
  },
  stop_done: {
    pt: 'Pronto, não mandamos mais lembretes de viagem para este e-mail. Boa viagem.',
    en: "Done. We won't send trip reminders to this email anymore. Have a great trip.",
    es: 'Listo, ya no enviamos recordatorios de viaje a este correo. Buen viaje.',
    fr: "C'est fait, on n'envoie plus de rappels de voyage à cette adresse. Bon voyage.",
    it: 'Fatto, non mandiamo più promemoria di viaggio a questa e-mail. Buon viaggio.',
  },
} satisfies Record<string, Five>;

/** §3: the day ask's subject keeps the destination while the push title fits in this. */
export const EMAIL_SUBJECT_MAX = 50;

export interface TripEmail {
  lang: TouristEmailLang;
  subject: string;
  paragraphs: string[];
  /** `Lisboa · 12 de janeiro de 2027`, or the date alone. */
  detail: string;
  button: string;
  footer: string;
  stopLabel: string;
}

export function tripReminderEmail(facts: TripFacts, language: unknown): TripEmail | null {
  const lang = normalizeTouristLang(language);
  const c = TRIP_EMAIL_COPY;
  const dateLine = tripDateLine(facts.trip_date, facts.date_precision, lang);
  if (!dateLine) return null;
  const city = safeCity(facts.destination?.city);
  const hours = grantedHours(facts, lang);
  // M2, and the day ask that is the first send (023 2.1.f): the hours, then the call to turn the guide on.
  const hoursParagraphs = hours ? [fill(c.m2_body[lang], hours), c.m2_call[lang]] : null;
  const piece = copyPieceOf(facts);
  let subject: string | null;
  let body: (string | null)[];
  let button = c.button[lang];
  if (piece === 'month_ask') {
    const month = tripMonth(facts.trip_date, lang);
    if (!month || (hasTripHours(facts) && !hoursParagraphs)) return null;
    const p = TRIP_PUSH_COPY;
    const withCity = city ? fill(p.month_ask_title_destination[lang], { month, destination: city }) : null;
    subject = withCity && withCity.length <= EMAIL_SUBJECT_MAX ? withCity : fill(p.month_ask_title[lang], { month });
    body = [fill(c.month_ask_body[lang], { month }), ...(hoursParagraphs ?? [c.month_ask_call[lang]])];
    button = c.month_ask_button[lang];
  } else if (piece === 'M2') {
    if (!hours || !hoursParagraphs) return null;
    subject = fill(c.m2_subject[lang], { trip_hours: hours.trip_hours });
    body = hoursParagraphs;
  } else if (piece === 'M3') {
    subject = c.m3_subject[lang];
    body = [c.m3_body[lang]];
  } else {
    subject = c.day_subject[lang];
    const balance = formatDuration(facts.balance_minutes);
    if (piece === 'M4' && !balance) return null;
    body = [piece === 'M4' && balance ? fill(c.day_balance_body[lang], { balance }) : c.day_free_body[lang]];
  }
  if (!subject || body.some((p) => p === null)) return null;
  return {
    lang,
    subject,
    paragraphs: [c.greeting[lang], ...(body as string[])],
    detail: city ? `${city} · ${dateLine}` : dateLine,
    button,
    footer: c.footer[lang],
    stopLabel: c.stop_link[lang],
  };
}

// ------------------------------------------------------------------------------------------- SMS

/** §9.d and §4.2. GSM-7, straight quotes, no U+00A0 in fr. Every message opens with "Tuggi:" and ends with the way out. */
export const TRIP_SMS_COPY = {
  M1: {
    pt: 'Tuggi: pronto, vamos te lembrar da sua viagem por aqui. Para sair, responda STOP.',
    en: "Tuggi: you're set, we'll remind you about your trip here. Msg frequency varies. Msg & data rates may apply. Reply HELP for help, STOP to cancel.",
    es: 'Tuggi: listo, te recordaremos tu viaje por SMS. Para salir, responde STOP.',
    fr: "Tuggi : c'est noté, on te rappellera ton voyage par SMS. Pour te désinscrire, réponds STOP.",
    it: 'Tuggi: fatto, ti ricorderemo il viaggio via SMS. Per non ricevere più messaggi, rispondi STOP.',
    de: 'Tuggi: Alles klar, wir erinnern dich per SMS an deine Reise. Abmelden: STOP antworten.',
  },
  M2: {
    pt: 'Tuggi: colocamos {{trip_hours}} de guia no seu saldo para a viagem, com validade até {{valid_until}}. Para sair, responda STOP.',
    en: 'Tuggi: you got {{trip_hours}} of guide time for your trip, in your balance until {{valid_until}}. Reply STOP to cancel.',
    es: 'Tuggi: ganaste {{trip_hours}} para el viaje, ya en tu saldo hasta el {{valid_until}}. Para salir, responde STOP.',
    fr: "Tuggi : tu as gagné {{trip_hours}} de guide pour le voyage, à utiliser jusqu'au {{valid_until}}. Pour te désinscrire, réponds STOP.",
    it: 'Tuggi: hai ricevuto {{trip_hours}} di guida per il viaggio, da usare entro il {{valid_until}}. Per non ricevere più messaggi, rispondi STOP.',
    de: 'Tuggi: Du hast {{trip_hours}} Guide für deine Reise bekommen, gültig bis {{valid_until}}. Abmelden: STOP antworten.',
  },
  M3: {
    pt: 'Tuggi: lembrete da sua viagem marcada, daqui a {{days}}. Para sair, responda STOP.',
    en: 'Tuggi: reminder, your trip is in {{days}}. Reply STOP to cancel.',
    es: 'Tuggi: tu viaje es dentro de {{days}}. Para salir, responde STOP.',
    fr: "Tuggi : rappel, ton voyage c'est dans {{days}}. Pour te désinscrire, réponds STOP.",
    it: 'Tuggi: promemoria, il tuo viaggio è tra {{days}}. Per non ricevere più messaggi, rispondi STOP.',
    de: 'Tuggi: Erinnerung, deine Reise ist in {{days}}. Abmelden: STOP antworten.',
  },
  M4: {
    pt: 'Tuggi: boa viagem. Hoje é o dia da sua viagem e sua carteira tem {{balance}}. Para sair, responda STOP.',
    en: "Tuggi: have a great trip. Today's your trip day and your wallet has {{balance}}. Reply STOP to cancel.",
    es: 'Tuggi: buen viaje. Hoy empieza tu viaje y tienes {{balance}} en tu cartera. Para salir, responde STOP.',
    fr: "Tuggi : bon voyage. C'est aujourd'hui, ton voyage, et tu as {{balance}} dans ton portefeuille. Pour te désinscrire, réponds STOP.",
    it: 'Tuggi: buon viaggio. Oggi parti e hai {{balance}} nel portafoglio. Per non ricevere più messaggi, rispondi STOP.',
    de: 'Tuggi: Gute Reise. Heute geht deine Reise los, und du hast {{balance}} Guthaben. Abmelden: STOP antworten.',
  },
  M5: {
    pt: 'Tuggi: boa viagem. Hoje é o dia da sua viagem. Para sair, responda STOP.',
    en: "Tuggi: have a great trip. Today's your trip day. Reply STOP to cancel.",
    es: 'Tuggi: buen viaje. Hoy empieza tu viaje. Para salir, responde STOP.',
    fr: "Tuggi : bon voyage. C'est aujourd'hui, ton voyage. Pour te désinscrire, réponds STOP.",
    it: 'Tuggi: buon viaggio. Oggi parti. Per non ricevere più messaggi, rispondi STOP.',
    de: 'Tuggi: Gute Reise. Heute geht deine Reise los. Abmelden: STOP antworten.',
  },
  month_ask: {
    pt: 'Tuggi: sua viagem é em {{month}} e ainda falta o dia. Marque no app para receber o lembrete na data certa. Para sair, responda STOP.',
    en: 'Tuggi: your trip is in {{month}} and the day is still missing. Add it in the app to get your reminder on time. Reply STOP to cancel.',
    es: 'Tuggi: tu viaje es en {{month}}. Marca la fecha exacta en la app para recibir el recordatorio a tiempo. Para salir, responde STOP.',
    fr: "Tuggi : ton voyage, c'est en {{month}}. Indique le jour dans l'app pour un rappel au bon moment. Pour te désinscrire, réponds STOP.",
    it: "Tuggi: il tuo viaggio è in {{month}}. Segna il giorno nell'app per ricevere il promemoria al momento giusto. Per non ricevere più messaggi, rispondi STOP.",
    de: 'Tuggi: Deine Reise ist im {{month}}. Trag den Tag in der App ein, damit die Erinnerung rechtzeitig kommt. Abmelden: STOP antworten.',
  },
  month_ask_nodate: {
    pt: 'Tuggi: falta o dia da sua viagem. Marque no app para receber o lembrete na data certa. Para sair, responda STOP.',
    en: 'Tuggi: your trip still needs a day. Add it in the app to get your reminder on time. Reply STOP to cancel.',
    es: 'Tuggi: marca la fecha exacta de tu viaje en la app para recibir el recordatorio a tiempo. Para salir, responde STOP.',
    fr: "Tuggi : il manque le jour de ton voyage. Indique-le dans l'app pour recevoir le rappel au bon moment. Pour te désinscrire, réponds STOP.",
    it: "Tuggi: manca il giorno del tuo viaggio. Segnalo nell'app per ricevere il promemoria al momento giusto. Per non ricevere più messaggi, rispondi STOP.",
    de: 'Tuggi: Für deine Reise fehlt noch der Tag. Trag ihn in der App ein, damit die Erinnerung rechtzeitig kommt. Abmelden: STOP antworten.',
  },
  stop_reply: {
    pt: 'Tuggi: lembretes desligados. Para voltar, cadastre o celular de novo no app.',
    en: "Tuggi: you're unsubscribed and won't get more messages. Reply START to resubscribe.",
    es: 'Tuggi: recordatorios desactivados. Para volver, guarda tu teléfono de nuevo en la app.',
    fr: "Tuggi : rappels désactivés sur ce numéro. Pour revenir, enregistre le numéro à nouveau dans l'app.",
    it: "Tuggi: promemoria disattivati su questo numero. Per riattivarli, salva di nuovo il numero nell'app.",
    de: 'Tuggi: Erinnerungen für diese Nummer ausgeschaltet. Zum Wiedereinschalten speichere die Nummer erneut in der App.',
  },
} satisfies Record<string, Six>;

/** §9.c, the free-text answer to a stop on WhatsApp (inside the 24 h window the reply opens). */
export const WHATSAPP_STOP_REPLY: Six = {
  pt: 'Pronto, não mandamos mais lembretes neste número. Para voltar, salve o número de novo no app.',
  en: 'Done, no more reminders to this number. To turn them back on, save the number again in the app.',
  es: 'Listo, no enviamos más recordatorios a este número. Para volver, guarda el número de nuevo en la app.',
  fr: "C'est fait, plus de rappels sur ce numéro. Pour les réactiver, enregistre le numéro à nouveau dans l'app.",
  it: "Fatto, niente più promemoria su questo numero. Per riattivarli, salva di nuovo il numero nell'app.",
  de: 'Erledigt, keine Erinnerungen mehr an diese Nummer. Zum Wiedereinschalten speichere die Nummer erneut in der App.',
};

/**
 * §9.d note: STOP in every language, and these synonyms on the SMS provider and on the WhatsApp
 * webhook. A reply is a stop when its whole text, trimmed and upper-cased, is one of them, or the
 * quick-reply button "Stop reminders" of the models.
 */
export const STOP_WORDS: readonly string[] = [
  'STOP',
  'PARAR',
  'SAIR',
  'BAJA',
  'ARRET',
  'ARRÊT',
  'STOPP',
  'ANNULLA',
  'UNSUBSCRIBE',
  'CANCEL',
  'END',
  'QUIT',
  'STOPALL',
  'PARAR LEMBRETES',
  'STOP REMINDERS',
  'PARAR RECORDATORIOS',
  'ARRÊTER LES RAPPELS',
  'STOP PROMEMORIA',
  'ERINNERUNGEN STOPPEN',
];

export function isStopReply(text: unknown): boolean {
  const t = String(text ?? '').trim().toUpperCase().replace(/\s+/g, ' ');
  return t !== '' && STOP_WORDS.includes(t);
}

/** The variables a phone message carries: only numbers and dates, never what a person typed. */
export interface PhoneVars {
  days: string;
  trip_hours: string;
  valid_until: string;
  valid_until_numeric: string;
  balance: string;
  /** The month of the trip date, for the day ask. */
  month: string;
}

export function phoneVars(facts: TripFacts | null, language: unknown, now: Date): { lang: RankingCopyLang; vars: Partial<PhoneVars> } {
  const lang = normalizeCopyLang(typeof language === 'string' ? language : null);
  if (!facts) return { lang, vars: {} };
  const vars: Partial<PhoneVars> = { days: formatDays(daysUntilDate(facts.trip_date, now), lang) };
  const hours = formatDuration(facts.trip_hours?.minutes);
  if (hours) vars.trip_hours = hours;
  if (facts.trip_hours) {
    vars.valid_until = longDateNoYear(facts.trip_hours.expires_at, lang) ?? undefined;
    vars.valid_until_numeric = numericDate(facts.trip_hours.expires_at, lang) ?? undefined;
  }
  const balance = formatDuration(facts.balance_minutes);
  if (balance) vars.balance = balance;
  const month = tripMonth(facts.trip_date, lang);
  if (month) vars.month = month;
  return { lang, vars };
}

/** The SMS of a message, or `null` when a variable is missing. */
export function smsText(piece: CopyPiece, lang: RankingCopyLang, vars: Partial<PhoneVars>): string | null {
  return fill(TRIP_SMS_COPY[piece][lang], {
    ...(vars as Record<string, string>),
    valid_until: vars.valid_until_numeric ?? '',
  });
}

/**
 * §4.3 and §4.1 "Parâmetros na ordem": the body parameters of each WhatsApp model. M2 has no days
 * and M3 none at all (#1244): the count spoke of the trip, not of Tuggi. `null` when one is missing.
 */
export function whatsappParameters(piece: CopyPiece, vars: Partial<PhoneVars>): string[] | null {
  const list: (string | undefined)[] =
    piece === 'M2' ? [vars.trip_hours, vars.valid_until] : piece === 'M4' ? [vars.balance] : piece === 'month_ask' ? [vars.month] : [];
  return list.every((v) => typeof v === 'string' && v !== '') ? (list as string[]) : null;
}
