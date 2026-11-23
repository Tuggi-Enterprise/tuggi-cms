/**
 * The words of the trip messages (#1231): the reminder N days before and on the day
 * (BR-COMUNICACAO-023) by push, e-mail, SMS and WhatsApp, and the confirmation of the number
 * (BR-COMUNICACAO-024 item 5) by SMS and WhatsApp.
 *
 * Sources:
 * - push: `docs/design/copy/voz-do-push-2026-11.md` §3.2 to §3.5, variant A (pt, en, fr), which
 *   fixes three holes of `proxima-viagem-1229-2026-11.md` §9.a (M2 without the validity, M3 and M5
 *   claiming a story at the destination, the day without the month-only version). es, it and de
 *   were written over the pt with the words of §9.a and the glossary of `push-2026-11.md`, and
 *   reviewed by the `copy` on 2026-11-23. The validity line never agrees with the hours (es "con
 *   validez hasta el", it "da usare entro il", de "gültig bis zum"), as the SMS of §9.d.
 * - e-mail: §9.b (five languages; a German reader gets English, BR-COMUNICACAO-020 item 6).
 * - SMS: §9.d. WhatsApp: the parameters of the models of §9.c; the text is Meta's, by model name.
 * - The month-only body of the e-mail day reminder (023 item 6: with a month only, the day reminder
 *   does not say "today") is the `copy`'s, 2026-11-23. Its subject is the push month title (#1238).
 * - M2 (#1236, 2026-11-23): nothing in the app speaks of trip hours before the credit, so this reminder
 *   is where the person learns of them. It says what was gained and until when, never "held" or
 *   "released", and never a recurrence such as "every trip" (BR-MONETIZACAO-091, ceiling).
 *
 * What the copy may say (023, ceiling): the date, the destination when given, and in the first
 * reminder the trip hours and until when they are valid. No welcome hours, no tip about the
 * destination, no offer. Nothing a person typed goes into a message model (security-reviewer, #1230,
 * condition 2): the destination is the geocoder's city name, never free text, and it goes only into
 * the push and the e-mail, never into SMS or WhatsApp.
 *
 * Pure: no remote import and no `Deno` global.
 */
import { normalizeCopyLang, type RankingCopyLang } from './ranking-comm-i18n.ts';
import { DEFAULT_TIME_ZONE, formatDuration, normalizeTouristLang, type TouristEmailLang } from './tourist-email.ts';

export type TripPiece = 'trip_reminder_before' | 'trip_reminder_day';

/** Which of the five messages of §9: M1 confirmation, M2 hours released, M3 upcoming, M4 day with balance, M5 day. */
export type CopyPiece = 'M1' | 'M2' | 'M3' | 'M4' | 'M5';

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

/** BR-COMUNICACAO-023 item 6 and §9: the message the facts call for. */
export function copyPieceOf(facts: TripFacts): CopyPiece {
  if (facts.piece === 'trip_reminder_before') return facts.trip_hours && facts.trip_hours.minutes > 0 ? 'M2' : 'M3';
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

// ------------------------------------------------------------------------------------------ push

type Six = Record<RankingCopyLang, string>;

/** Push copy, variant A of voz-do-push §3. Title up to 40, body up to 110. */
export const TRIP_PUSH_COPY = {
  m2_title_destination: {
    pt: '{{destination}} está chegando',
    en: '{{destination}} is coming up',
    es: '{{destination}} se acerca',
    fr: '{{destination}} approche',
    it: '{{destination}} si avvicina',
    de: '{{destination}} rückt näher',
  },
  m2_title: {
    pt: 'Sua viagem está chegando',
    en: 'Your trip is coming up',
    es: 'Tu viaje se acerca',
    fr: 'Ton voyage approche',
    it: 'Il tuo viaggio si avvicina',
    de: 'Deine Reise rückt näher',
  },
  m2_body: {
    pt: 'Você ganhou {{trip_hours}} de guia para a viagem, já no seu saldo. Vale até {{date}}.',
    en: 'You got {{trip_hours}} of guide time for the trip, already in your balance. Valid until {{date}}.',
    es: 'Ganaste {{trip_hours}} de guía para el viaje, ya en tu saldo, con validez hasta el {{date}}.',
    fr: "Tu as gagné {{trip_hours}} de guide pour le voyage, déjà dans ton solde, à utiliser jusqu'au {{date}}.",
    it: 'Hai ricevuto {{trip_hours}} di guida per il viaggio, già nel tuo saldo. Da usare entro il {{date}}.',
    de: 'Du hast {{trip_hours}} Guide für die Reise bekommen, schon in deinem Guthaben. Gültig bis zum {{date}}.',
  },
  m3_title_destination: {
    pt: '{{destination}} daqui a {{days}}',
    en: '{{destination}} in {{days}}',
    es: '{{destination}} en {{days}}',
    fr: '{{destination}} dans {{days}}',
    it: '{{destination}} tra {{days}}',
    de: '{{destination}} in {{days}}',
  },
  m3_title: {
    pt: 'Sua viagem é daqui a {{days}}',
    en: 'Your trip is in {{days}}',
    es: 'Tu viaje es dentro de {{days}}',
    fr: "Ton voyage, c'est dans {{days}}",
    it: 'Il tuo viaggio è tra {{days}}',
    de: 'Deine Reise ist in {{days}}',
  },
  m3_body: {
    pt: 'Deixe o Tuggi no celular. Onde houver história, um toque no lugar do mapa e você ouve, sem precisar de horas.',
    en: "Keep Tuggi on your phone. Wherever there's a story, tap the place on the map to listen, no hours needed.",
    es: 'Deja Tuggi en el móvil. Donde haya una historia, toca el lugar en el mapa y escucha, sin necesidad de horas.',
    fr: 'Garde Tuggi sur ton téléphone. Là où il y a une histoire, touche le lieu sur la carte, même sans heures.',
    it: "Tieni Tuggi sul telefono. Dove c'è una storia, tocca il luogo sulla mappa e ascolta, senza bisogno di ore.",
    de: 'Lass Tuggi auf dem Handy. Wo es eine Geschichte gibt: auf der Karte antippen und zuhören, auch ohne Guthaben.',
  },
  m4_title: {
    pt: 'Boa viagem · {{balance}} de guia',
    en: 'Have a great trip · {{balance}} of guide',
    es: 'Buen viaje · {{balance}} de guía',
    fr: 'Bon voyage · {{balance}} de guide',
    it: 'Buon viaggio · {{balance}} di guida',
    de: 'Gute Reise · {{balance}} Guide',
  },
  m4_body: {
    pt: 'Ligue o guia e ouça a história dos lugares por onde passar.',
    en: 'Turn on the guide and hear the stories of the places you pass.',
    es: 'Activa la guía y escucha la historia de los lugares por donde pases.',
    fr: "Active le guide et écoute l'histoire des lieux où tu passes.",
    it: 'Attiva la guida e ascolta la storia dei luoghi dove passi.',
    de: 'Schalte den Guide ein und hör die Geschichten der Orte, an denen du vorbeikommst.',
  },
  month_title: {
    pt: 'Sua viagem é este mês',
    en: 'Your trip is this month',
    es: 'Tu viaje es este mes',
    fr: "Ton voyage, c'est ce mois-ci",
    it: 'Il tuo viaggio è questo mese',
    de: 'Deine Reise ist diesen Monat',
  },
  m4_month_body: {
    pt: 'Você tem {{balance}} de guia. No dia, ligue o guia e ouça a história dos lugares por onde passar.',
    en: 'You have {{balance}} of guide time. On the day, turn on the guide and hear the stories of the places you pass.',
    es: 'Tienes {{balance}} de guía. El día del viaje, activa la guía y escucha la historia de los lugares del camino.',
    fr: "Tu as {{balance}} de guide. Le jour J, active le guide et écoute l'histoire des lieux où tu passes.",
    it: 'Hai {{balance}} di guida. Il giorno del viaggio, attiva la guida e ascolta la storia dei luoghi dove passi.',
    de: 'Du hast {{balance}} Guide. Schalte ihn am Reisetag ein und hör die Geschichten der Orte unterwegs.',
  },
  m5_title: {
    pt: 'Boa viagem',
    en: 'Have a great trip',
    es: 'Buen viaje',
    fr: 'Bon voyage',
    it: 'Buon viaggio',
    de: 'Gute Reise',
  },
  m5_body: {
    pt: 'No mapa, toque num lugar com história e ouça, sem precisar de horas.',
    en: 'On the map, tap a place with a story and listen, no hours needed.',
    es: 'En el mapa, toca un lugar con historia y escucha, sin necesidad de horas.',
    fr: 'Sur la carte, touche un lieu qui a une histoire et écoute-la, même sans heures.',
    it: 'Sulla mappa, tocca un luogo con una storia e ascolta, senza bisogno di ore.',
    de: 'Tipp auf der Karte einen Ort mit Geschichte an und hör zu, auch ohne Guthaben.',
  },
} satisfies Record<string, Six>;

export const PUSH_TITLE_MAX = 40;
export const PUSH_BODY_MAX = 110;

/** The push of one reminder, or `null` when a fact it needs is missing. */
export function tripReminderPush(facts: TripFacts, language: unknown, now: Date): { title: string; body: string } | null {
  const lang = normalizeCopyLang(typeof language === 'string' ? language : null);
  const c = TRIP_PUSH_COPY;
  const month = facts.date_precision === 'month';
  const vars: Record<string, string> = { days: formatDays(daysUntilDate(facts.trip_date, now), lang) };
  const city = safeCity(facts.destination?.city);
  if (city) vars.destination = city;
  const titleWith = (withDestination: string, without: string): string | null => {
    const t = city ? fill(withDestination, vars) : null;
    return t && t.length <= PUSH_TITLE_MAX ? t : fill(without, vars);
  };
  const piece = copyPieceOf(facts);
  if (piece === 'M2') {
    const hours = formatDuration(facts.trip_hours?.minutes);
    const date = facts.trip_hours ? longDateNoYear(facts.trip_hours.expires_at, lang) : null;
    if (!hours || !date) return null;
    const body = fill(c.m2_body[lang], { ...vars, trip_hours: hours, date });
    const title = titleWith(c.m2_title_destination[lang], c.m2_title[lang]);
    return title && body ? { title, body } : null;
  }
  if (piece === 'M3') {
    // A month-only trip is not "in 7 days": the title without the count.
    const title = month ? fill(c.m2_title[lang], vars) : titleWith(c.m3_title_destination[lang], c.m3_title[lang]);
    return title ? { title, body: c.m3_body[lang] } : null;
  }
  if (piece === 'M4') {
    const balance = formatDuration(facts.balance_minutes);
    if (!balance) return null;
    const title = month ? c.month_title[lang] : fill(c.m4_title[lang], { balance });
    const body = month ? fill(c.m4_month_body[lang], { balance }) : c.m4_body[lang];
    return title && body ? { title, body } : null;
  }
  return { title: month ? c.month_title[lang] : c.m5_title[lang], body: c.m5_body[lang] };
}

// ---------------------------------------------------------------------------------------- e-mail

type Five = Record<TouristEmailLang, string>;

/** §9.b. Greeting without a name, the fact, a detail line, one button, and a footer of its own. */
export const TRIP_EMAIL_COPY = {
  greeting: { pt: 'Olá,', en: 'Hi,', es: 'Hola,', fr: 'Bonjour,', it: 'Ciao,' },
  m2_subject: {
    pt: 'Você ganhou horas de guia para a viagem',
    en: 'You got guide hours for your trip',
    es: 'Ganaste horas de guía para tu viaje',
    fr: 'Tu as gagné des heures de guide pour ton voyage',
    it: 'Hai ricevuto ore di guida per il tuo viaggio',
  },
  m2_body: {
    pt: 'Sua viagem é daqui a {{days}}, e você ganhou {{trip_hours}} de guia para ela, já no seu saldo do Tuggi e com validade até {{valid_until}}.',
    en: 'Your trip is in {{days}}, and you got {{trip_hours}} of guide time for it, already in your Tuggi balance and valid until {{valid_until}}.',
    es: 'Tu viaje es dentro de {{days}}, y ganaste {{trip_hours}} de guía para él, ya en tu saldo de Tuggi y con validez hasta el {{valid_until}}.',
    fr: "Ton voyage, c'est dans {{days}}. Tu as gagné {{trip_hours}} de guide pour ce voyage, déjà dans ton solde Tuggi, à utiliser jusqu'au {{valid_until}}.",
    it: 'Il tuo viaggio è tra {{days}}. Per questo viaggio hai ricevuto {{trip_hours}} di guida, già nel tuo saldo Tuggi e da usare entro il {{valid_until}}.',
  },
  m3_subject: {
    pt: 'Sua viagem é daqui a {{days}}',
    en: 'Your trip is in {{days}}',
    es: 'Tu viaje es dentro de {{days}}',
    fr: "Ton voyage, c'est dans {{days}}",
    it: 'Il tuo viaggio è tra {{days}}',
  },
  m3_body: {
    pt: 'Este é o lembrete que você pediu no Tuggi.',
    en: 'This is the reminder you asked for in Tuggi.',
    es: 'Este es el recordatorio que pediste en Tuggi.',
    fr: 'Voici le rappel que tu as demandé dans Tuggi.',
    it: 'Ecco il promemoria che hai chiesto su Tuggi.',
  },
  day_subject: { pt: 'Boa viagem', en: 'Have a great trip', es: 'Buen viaje', fr: 'Bon voyage', it: 'Buon viaggio' },
  day_body: {
    pt: 'Hoje é o dia da viagem que você marcou no Tuggi.',
    en: "Today's the day of the trip you added in Tuggi.",
    es: 'Hoy es el día del viaje que marcaste en Tuggi.',
    fr: "C'est aujourd'hui, le voyage que tu as noté dans Tuggi.",
    it: 'Oggi è il giorno del viaggio che hai segnato su Tuggi.',
  },
  day_month_body: {
    pt: 'A viagem que você marcou no Tuggi é este mês.',
    en: 'The trip you added in Tuggi is this month.',
    es: 'El viaje que marcaste en Tuggi es este mes.',
    fr: "Le voyage que tu as noté dans Tuggi, c'est ce mois-ci.",
    it: 'Il viaggio che hai segnato su Tuggi è questo mese.',
  },
  balance: {
    pt: 'Você tem {{balance}} na carteira.',
    en: 'You have {{balance}} in your wallet.',
    es: 'Tienes {{balance}} en tu cartera.',
    fr: 'Tu as {{balance}} dans ton portefeuille.',
    it: 'Hai {{balance}} nel tuo portafoglio.',
  },
  button: { pt: 'Abrir o Tuggi', en: 'Open Tuggi', es: 'Abrir Tuggi', fr: 'Ouvrir Tuggi', it: 'Apri Tuggi' },
  footer: {
    pt: 'Você recebe este e-mail porque pediu o lembrete da sua viagem no Tuggi.',
    en: "You're getting this email because you asked for a trip reminder in Tuggi.",
    es: 'Recibes este correo porque pediste el recordatorio de tu viaje en Tuggi.',
    fr: 'Tu reçois cet e-mail parce que tu as demandé le rappel de ton voyage dans Tuggi.',
    it: 'Ricevi questa e-mail perché hai chiesto il promemoria del viaggio su Tuggi.',
  },
  stop_link: {
    pt: 'Parar os lembretes de viagem por e-mail',
    en: 'Stop trip reminders by email',
    es: 'Dejar de recibir recordatorios de viaje por correo',
    fr: 'Ne plus recevoir les rappels de voyage par e-mail',
    it: 'Non ricevere più promemoria di viaggio via e-mail',
  },
  stop_done: {
    pt: 'Pronto, você não recebe mais lembretes de viagem por e-mail.',
    en: "Done. You won't get trip reminders by email anymore.",
    es: 'Listo, ya no recibirás recordatorios de viaje por correo.',
    fr: "C'est fait, tu ne recevras plus de rappels de voyage par e-mail.",
    it: 'Fatto, non riceverai più promemoria di viaggio via e-mail.',
  },
} satisfies Record<string, Five>;

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

export function tripReminderEmail(facts: TripFacts, language: unknown, now: Date): TripEmail | null {
  const lang = normalizeTouristLang(language);
  const c = TRIP_EMAIL_COPY;
  const days = formatDays(daysUntilDate(facts.trip_date, now), lang);
  const dateLine = tripDateLine(facts.trip_date, facts.date_precision, lang);
  if (!dateLine) return null;
  const city = safeCity(facts.destination?.city);
  const piece = copyPieceOf(facts);
  let subject: string | null;
  const body: (string | null)[] = [];
  if (piece === 'M2') {
    const hours = formatDuration(facts.trip_hours?.minutes);
    const valid = facts.trip_hours ? longDateNoYear(facts.trip_hours.expires_at, lang) : null;
    if (!hours || !valid) return null;
    subject = c.m2_subject[lang];
    body.push(fill(c.m2_body[lang], { days, trip_hours: hours, valid_until: valid }));
  } else if (piece === 'M3') {
    // A month-only trip is not "in 7 days": the subject without the count.
    subject = facts.date_precision === 'month' ? TRIP_PUSH_COPY.m2_title[lang] : fill(c.m3_subject[lang], { days });
    body.push(c.m3_body[lang]);
  } else {
    // A month-only trip is reminded on day 1, which is not the day of the trip: no "Have a great trip"
    // in the subject, the push month title instead (#1238).
    const month = facts.date_precision === 'month';
    subject = month ? TRIP_PUSH_COPY.month_title[lang] : c.day_subject[lang];
    body.push(month ? c.day_month_body[lang] : c.day_body[lang]);
    const balance = formatDuration(facts.balance_minutes);
    if (piece === 'M4' && balance) body.push(fill(c.balance[lang], { balance }));
  }
  if (!subject || body.some((p) => p === null)) return null;
  return {
    lang,
    subject,
    paragraphs: [c.greeting[lang], ...(body as string[])],
    detail: city ? `${city} · ${dateLine}` : dateLine,
    button: c.button[lang],
    footer: c.footer[lang],
    stopLabel: c.stop_link[lang],
  };
}

// ------------------------------------------------------------------------------------------- SMS

/** §9.d. GSM-7, straight quotes, no U+00A0 in fr. Every message opens with "Tuggi:" and ends with the way out. */
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
  return { lang, vars };
}

/** The SMS of a message, or `null` when a variable is missing. */
export function smsText(piece: CopyPiece, lang: RankingCopyLang, vars: Partial<PhoneVars>): string | null {
  return fill(TRIP_SMS_COPY[piece][lang], {
    ...(vars as Record<string, string>),
    valid_until: vars.valid_until_numeric ?? '',
  });
}

/** §9.c: the body parameters of each WhatsApp model, in order. `null` when one is missing. */
export function whatsappParameters(piece: CopyPiece, vars: Partial<PhoneVars>): string[] | null {
  const list: (string | undefined)[] =
    piece === 'M2' ? [vars.days, vars.trip_hours, vars.valid_until] : piece === 'M3' ? [vars.days] : piece === 'M4' ? [vars.balance] : [];
  return list.every((v) => typeof v === 'string' && v !== '') ? (list as string[]) : null;
}
