/**
 * The tourist e-mails of #957 — the sentence, per type and language, and nothing else.
 *
 * BR-COMUNICACAO-020: two classes. SERVICE (item 2: hours earned, hours expiring) goes to whoever
 * has an account, without opt-in; REENGAGEMENT (item 3: 7, 14 and 30 days without use) only with
 * `email_opt_in = true`. Both carry the one-tap unsubscribe (item 4), and the footer says which
 * class the reader is in. Who receives which one is `tourist-lifecycle-email.ts`, not this file.
 *
 * Copy: `docs/design/copy-notificacoes-e-email-turista-2026-10.md` §3, verbatim. Pure (no remote
 * import), so `tests/api/tourist-email.test.ts` renders it under Node; `send-transactional` wraps
 * it in the layout of `emailLayout.ts`.
 *
 * NO LINK COMES FROM THE CALLER (see the header of `send-transactional`): the one button points at
 * `TOURIST_APP_LINK`, a universal link of ours. `/download` is claimed by the app on both
 * platforms (iOS `applinks:tuggi.app`, Android `pathPrefix="/download"`), so the phone opens
 * Tuggi and the desktop lands on the site's download page.
 */

import type { NewsletterContent } from './emailLayout.ts';

export const TOURIST_APP_LINK = 'https://tuggi.app/download';

export const TOURIST_EMAIL_TYPES = [
  'tourist_hours_earned',
  'tourist_hours_expiring',
  'tourist_reengagement_7',
  'tourist_reengagement_14',
  'tourist_reengagement_30',
] as const;
export type TouristEmailType = (typeof TOURIST_EMAIL_TYPES)[number];

export const TOURIST_EMAIL_LANGS = ['pt', 'en', 'es', 'fr', 'it'] as const;
export type TouristEmailLang = (typeof TOURIST_EMAIL_LANGS)[number];

/** BR-COMUNICACAO-019 (#955): the zone of an account that has none. */
export const DEFAULT_TIME_ZONE = 'America/Sao_Paulo';

export function isTouristEmailType(value: unknown): value is TouristEmailType {
  return typeof value === 'string' && (TOURIST_EMAIL_TYPES as readonly string[]).includes(value);
}

/** `pt-br`, `pt_BR`, `PT` → `pt`. A language Tuggi does not publish reads English. */
export function normalizeTouristLang(raw: unknown): TouristEmailLang {
  const base = String(raw ?? '').trim().slice(0, 2).toLowerCase();
  return (TOURIST_EMAIL_LANGS as readonly string[]).includes(base) ? (base as TouristEmailLang) : 'en';
}

/** `5 h`, `45 min`, `1 h 30 min` — the same in the five languages. `null` for no positive number. */
export function formatDuration(minutes: unknown): string | null {
  const total = Math.round(Number(minutes));
  if (!Number.isFinite(total) || total <= 0) return null;
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

const DATE_LOCALE: Record<TouristEmailLang, string> = {
  pt: 'pt-BR',
  en: 'en-US',
  es: 'es-ES',
  fr: 'fr-FR',
  it: 'it-IT',
};

/**
 * `18 de outubro`, `October 18`, `18 octobre`: long month, no year, in the reader's zone. The
 * month is spelled out, so no abbreviation dot is left in pt (spec §3). An unknown zone falls back
 * to `DEFAULT_TIME_ZONE` instead of throwing the e-mail away.
 */
export function formatLongDate(iso: unknown, lang: TouristEmailLang, timeZone?: string | null): string | null {
  const parsed = new Date(String(iso ?? ''));
  if (!iso || Number.isNaN(parsed.getTime())) return null;
  const format = (zone: string) =>
    new Intl.DateTimeFormat(DATE_LOCALE[lang], { day: 'numeric', month: 'long', timeZone: zone }).format(parsed);
  try {
    return format(timeZone || DEFAULT_TIME_ZONE);
  } catch {
    return format(DEFAULT_TIME_ZONE);
  }
}

/** The local calendar day `YYYY-MM-DD` of an instant, in the reader's zone. */
export function localDay(iso: unknown, timeZone?: string | null): string | null {
  const parsed = new Date(String(iso ?? ''));
  if (!iso || Number.isNaN(parsed.getTime())) return null;
  const format = (zone: string) =>
    new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: zone }).format(parsed);
  try {
    return format(timeZone || DEFAULT_TIME_ZONE);
  } catch {
    return format(DEFAULT_TIME_ZONE);
  }
}

type Copy = Record<TouristEmailLang, string>;

const GREETING: Copy = { pt: 'Olá,', en: 'Hi,', es: 'Hola,', fr: 'Bonjour,', it: 'Ciao,' };
const BUTTON: Copy = { pt: 'Abrir o Tuggi', en: 'Open Tuggi', es: 'Abrir Tuggi', fr: 'Ouvrir Tuggi', it: 'Apri Tuggi' };

/** §3.1 — the footer of each class. Reengagement uses the layout's own `unsubscribe` label. */
const SERVICE_FOOTER_NOTE: Copy = {
  pt: 'Você recebe este e-mail porque tem uma conta no Tuggi.',
  en: "You're getting this email because you have a Tuggi account.",
  es: 'Recibes este correo porque tienes una cuenta en Tuggi.',
  fr: 'Tu reçois cet e-mail parce que tu as un compte Tuggi.',
  it: 'Ricevi questa e-mail perché hai un account Tuggi.',
};
const SERVICE_UNSUBSCRIBE: Copy = {
  pt: 'Não quero mais avisos sobre minhas horas',
  en: 'Stop emails about my hours',
  es: 'No quiero más avisos sobre mis horas',
  fr: "Ne plus recevoir d'e-mails sur mes heures",
  it: 'Non voglio più avvisi sulle mie ore',
};
const REENGAGEMENT_FOOTER_NOTE: Copy = {
  pt: 'Você recebe este e-mail porque pediu novidades e lembretes do Tuggi.',
  en: "You're getting this email because you asked for Tuggi news and reminders.",
  es: 'Recibes este correo porque pediste novedades y recordatorios de Tuggi.',
  fr: 'Tu reçois cet e-mail parce que tu as demandé les nouveautés et rappels de Tuggi.',
  it: 'Ricevi questa e-mail perché hai chiesto novità e promemoria di Tuggi.',
};

/** §3.2 */
const HOURS_EARNED = {
  subject: {
    pt: 'Você ganhou {{duration}} no Tuggi',
    en: 'You earned {{duration}} on Tuggi',
    es: 'Ganaste {{duration}} en Tuggi',
    fr: 'Tu as gagné {{duration}} sur Tuggi',
    it: 'Hai guadagnato {{duration}} su Tuggi',
  },
  preheader: {
    pt: 'As horas já estão na sua conta.',
    en: 'The hours are already in your account.',
    es: 'Las horas ya están en tu cuenta.',
    fr: 'Les heures sont déjà sur ton compte.',
    it: 'Le ore sono già nel tuo account.',
  },
  referral: {
    pt: '{{nickname}} usou seu código, e {{duration}} entraram no seu saldo.',
    en: '{{nickname}} used your code, and {{duration}} were added to your balance.',
    es: '{{nickname}} usó tu código y sumamos {{duration}} a tu saldo.',
    fr: '{{nickname}} a utilisé ton code, et {{duration}} ont été ajoutées à ton solde.',
    it: '{{nickname}} ha usato il tuo codice e abbiamo aggiunto {{duration}} al tuo saldo.',
  },
  generic: {
    pt: 'Somamos {{duration}} ao seu saldo.',
    en: 'We added {{duration}} to your balance.',
    es: 'Sumamos {{duration}} a tu saldo.',
    fr: 'Nous avons ajouté {{duration}} à ton solde.',
    it: 'Abbiamo aggiunto {{duration}} al tuo saldo.',
  },
  validity: {
    pt: 'São horas grátis e valem até {{date}}.',
    en: 'These are free hours, valid until {{date}}.',
    es: 'Son horas gratis y valen hasta el {{date}}.',
    fr: "Ce sont des heures gratuites, valables jusqu'au {{date}}.",
    it: 'Sono ore gratuite e valgono fino al {{date}}.',
  },
  closing: {
    pt: 'Ligue o guia na próxima saída.',
    en: 'Turn on the guide next time you head out.',
    es: 'Enciende la guía en tu próxima salida.',
    fr: 'Allume le guide à ta prochaine sortie.',
    it: 'Accendi la guida alla prossima uscita.',
  },
} satisfies Record<string, Copy>;

/** §3.3 — the spec publishes the plural only; the selection sends it at 3 days (and never at 1). */
const HOURS_EXPIRING = {
  subject: {
    pt: 'Suas horas grátis vencem em {{count}} dias',
    en: 'Your free hours expire in {{count}} days',
    es: 'Tus horas gratis vencen en {{count}} días',
    fr: 'Tes heures gratuites expirent dans {{count}} jours',
    it: 'Le tue ore gratuite scadono tra {{count}} giorni',
  },
  preheader: {
    pt: 'Ainda dá tempo de usar {{duration}}.',
    en: "There's still time to use {{duration}}.",
    es: 'Todavía puedes usar {{duration}}.',
    fr: "Il est encore temps d'utiliser {{duration}}.",
    it: 'Sei ancora in tempo per usare {{duration}}.',
  },
  paragraph: {
    pt: 'Você tem {{duration}} em horas grátis, e elas vencem em {{date}}.',
    en: 'You have {{duration}} in free hours, and they expire on {{date}}.',
    es: 'Tienes {{duration}} en horas gratis y vencen el {{date}}.',
    fr: "Tu as {{duration}} d'heures gratuites, et elles expirent le {{date}}.",
    it: 'Hai {{duration}} di ore gratuite e scadono il {{date}}.',
  },
  closing: {
    pt: 'Ligue o guia antes disso e ouça a história dos lugares por onde passar.',
    en: 'Turn on the guide before then and hear the stories of the places you pass.',
    es: 'Enciende la guía antes y escucha la historia de los lugares por donde pases.',
    fr: "Allume le guide d'ici là et écoute l'histoire des lieux où tu passes.",
    it: 'Accendi la guida prima di allora e ascolta la storia dei luoghi dove passi.',
  },
} satisfies Record<string, Copy>;

/** §3.4. French puts a no-break space before `?`, as the app's `fr.json` does. */
const REENGAGEMENT_7 = {
  subject: {
    pt: 'Vai sair por aí?',
    en: 'Heading out soon?',
    es: '¿Vas a salir?',
    fr: 'Tu pars bientôt ?',
    it: 'Stai per partire?',
  },
  preheader: {
    pt: 'Ligue o guia e ouça a história dos lugares no caminho.',
    en: 'Turn on the guide and hear the stories along the way.',
    es: 'Enciende la guía y escucha la historia de los lugares del camino.',
    fr: "Allume le guide et écoute l'histoire des lieux sur ta route.",
    it: 'Accendi la guida e ascolta la storia dei luoghi lungo la strada.',
  },
  paragraph: {
    pt: 'Com o guia ligado, o Tuggi conta a história dos lugares por onde você passa.',
    en: 'With the guide on, Tuggi tells you the stories of the places you pass.',
    es: 'Con la guía encendida, Tuggi te cuenta la historia de los lugares por donde pasas.',
    fr: "Avec le guide allumé, Tuggi te raconte l'histoire des lieux où tu passes.",
    it: 'Con la guida accesa, Tuggi ti racconta la storia dei luoghi dove passi.',
  },
  balance: {
    pt: 'Você tem {{duration}} guardadas na sua conta.',
    en: 'You have {{duration}} kept in your account.',
    es: 'Tienes {{duration}} guardadas en tu cuenta.',
    fr: 'Tu as {{duration}} en réserve sur ton compte.',
    it: 'Hai {{duration}} conservate nel tuo account.',
  },
} satisfies Record<string, Copy>;

const REENGAGEMENT_14 = {
  subject: {
    pt: 'Seu Passaporte espera a próxima viagem',
    en: 'Your Passport is waiting for your next trip',
    es: 'Tu Pasaporte espera tu próximo viaje',
    fr: 'Ton Passeport attend ton prochain trajet',
    it: 'Il tuo Passaporto aspetta il prossimo viaggio',
  },
  preheader: {
    pt: 'Cada história que você ouve fica guardada lá.',
    en: 'Every story you hear is saved there.',
    es: 'Cada historia que escuchas queda guardada ahí.',
    fr: 'Chaque histoire que tu écoutes y est gardée.',
    it: 'Ogni storia che ascolti resta lì.',
  },
  paragraph: {
    pt: 'Cada história que você ouve com o Tuggi entra no seu Passaporte.',
    en: 'Every story you hear with Tuggi goes into your Passport.',
    es: 'Cada historia que escuchas con Tuggi entra en tu Pasaporte.',
    fr: 'Chaque histoire que tu écoutes avec Tuggi rejoint ton Passeport.',
    it: 'Ogni storia che ascolti con Tuggi entra nel tuo Passaporto.',
  },
  closing: {
    pt: 'Na próxima saída, ligue o guia antes de começar.',
    en: 'Next time you head out, turn on the guide before you start.',
    es: 'En tu próxima salida, enciende la guía antes de empezar.',
    fr: 'À ta prochaine sortie, allume le guide avant de partir.',
    it: 'Alla prossima uscita, accendi la guida prima di partire.',
  },
} satisfies Record<string, Copy>;

/** The 30-day one says it is the last, and never speaks of hours: they may have expired. */
const REENGAGEMENT_30 = {
  subject: {
    pt: 'Este é o nosso último lembrete',
    en: 'This is our last reminder',
    es: 'Este es nuestro último recordatorio',
    fr: "C'est notre dernier rappel",
    it: 'Questo è il nostro ultimo promemoria',
  },
  preheader: {
    pt: 'Depois dele, paramos de mandar lembretes.',
    en: "After this one, we'll stop sending reminders.",
    es: 'Después de este, dejamos de enviar recordatorios.',
    fr: 'Après celui-ci, on arrête les rappels.',
    it: 'Dopo questo, smettiamo di inviarti promemoria.',
  },
  paragraph: {
    pt: 'Faz um mês que você não abre o Tuggi, então este é o último lembrete que mandamos.',
    en: "It's been a month since you opened Tuggi, so this is the last reminder we'll send.",
    es: 'Hace un mes que no abres Tuggi, así que este es el último recordatorio que te enviamos.',
    fr: "Ça fait un mois que tu n'as pas ouvert Tuggi, alors c'est le dernier rappel qu'on t'envoie.",
    it: "È passato un mese dall'ultima volta che hai aperto Tuggi, quindi questo è l'ultimo promemoria.",
  },
  closing: {
    pt: 'Quando quiser voltar, seu Passaporte continua na sua conta.',
    en: 'Whenever you come back, your Passport is still in your account.',
    es: 'Cuando quieras volver, tu Pasaporte sigue en tu cuenta.',
    fr: 'Quand tu voudras revenir, ton Passeport sera toujours sur ton compte.',
    it: 'Quando vorrai tornare, il tuo Passaporto sarà ancora nel tuo account.',
  },
} satisfies Record<string, Copy>;

/** Every sentence this file can emit, for the copy guards of the test. */
export const TOURIST_EMAIL_CATALOGUE = {
  GREETING,
  BUTTON,
  SERVICE_FOOTER_NOTE,
  SERVICE_UNSUBSCRIBE,
  REENGAGEMENT_FOOTER_NOTE,
  HOURS_EARNED,
  HOURS_EXPIRING,
  REENGAGEMENT_7,
  REENGAGEMENT_14,
  REENGAGEMENT_30,
} as const;

/** What the caller sends in `data`. Numbers and dates only; no sentence and no link. */
export interface TouristEmailData {
  /** hours_earned: unseen minutes · hours_expiring: minutes that expire. */
  minutes?: number | null;
  /** hours_earned: nearest expiry of those minutes · hours_expiring: the expiry. */
  expires_at?: string | null;
  /** hours_earned: the friend who used the code, only when ONE credit is reported. */
  nickname?: string | null;
  /** reengagement_7: the balance, shown only when > 0. */
  balance_minutes?: number | null;
  timezone?: string | null;
}

export interface RenderedTouristEmail {
  content: NewsletterContent;
  footerNote: string;
  /** `undefined` = the layout's own `unsubscribe` label (reengagement). */
  unsubscribeLabel?: string;
  utmCampaign: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole days until `iso`, rounded UP: 2 d 23 h is "3 days". */
export function daysUntil(iso: unknown, now: Date): number | null {
  const parsed = new Date(String(iso ?? ''));
  if (!iso || Number.isNaN(parsed.getTime())) return null;
  return Math.ceil((parsed.getTime() - now.getTime()) / DAY_MS);
}

function fill(template: string, vars: Record<string, string>): string | null {
  const out = template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? `{{${key}}}`);
  return out.includes('{{') ? null : out;
}

/**
 * The e-mail, or `null` when a fact it needs is missing. `null` is a refusal, not a fallback: an
 * hours e-mail without the number of hours is worse than no e-mail.
 */
export function renderTouristEmail(
  type: TouristEmailType,
  langRaw: unknown,
  data: TouristEmailData,
  now: Date = new Date()
): RenderedTouristEmail | null {
  const lang = normalizeTouristLang(langRaw);
  const service = type === 'tourist_hours_earned' || type === 'tourist_hours_expiring';
  const duration = formatDuration(data.minutes) ?? '';
  const date = formatLongDate(data.expires_at, lang, data.timezone) ?? '';
  const vars: Record<string, string> = {};
  if (duration) vars.duration = duration;
  if (date) vars.date = date;

  let subject: string | null;
  let preheader: string | null;
  const body: (string | null)[] = [];

  if (type === 'tourist_hours_earned') {
    if (!duration) return null;
    const nickname = String(data.nickname ?? '').trim();
    subject = fill(HOURS_EARNED.subject[lang], vars);
    preheader = fill(HOURS_EARNED.preheader[lang], vars);
    body.push(
      nickname
        ? fill(HOURS_EARNED.referral[lang], { ...vars, nickname })
        : fill(HOURS_EARNED.generic[lang], vars)
    );
    // Without an expiry (coupon, cms, partner never expire) the validity line leaves.
    if (date) body.push(fill(HOURS_EARNED.validity[lang], vars));
    body.push(HOURS_EARNED.closing[lang]);
  } else if (type === 'tourist_hours_expiring') {
    const count = daysUntil(data.expires_at, now);
    // Plural only (spec §3.3), and an expiry already past is not a warning.
    if (!duration || !date || count === null || count < 2) return null;
    subject = fill(HOURS_EXPIRING.subject[lang], { ...vars, count: String(count) });
    preheader = fill(HOURS_EXPIRING.preheader[lang], vars);
    body.push(fill(HOURS_EXPIRING.paragraph[lang], vars), HOURS_EXPIRING.closing[lang]);
  } else if (type === 'tourist_reengagement_7') {
    subject = REENGAGEMENT_7.subject[lang];
    preheader = REENGAGEMENT_7.preheader[lang];
    body.push(REENGAGEMENT_7.paragraph[lang]);
    const balance = formatDuration(data.balance_minutes);
    if (balance) body.push(fill(REENGAGEMENT_7.balance[lang], { duration: balance }));
  } else if (type === 'tourist_reengagement_14') {
    subject = REENGAGEMENT_14.subject[lang];
    preheader = REENGAGEMENT_14.preheader[lang];
    body.push(REENGAGEMENT_14.paragraph[lang], REENGAGEMENT_14.closing[lang]);
  } else {
    subject = REENGAGEMENT_30.subject[lang];
    preheader = REENGAGEMENT_30.preheader[lang];
    body.push(REENGAGEMENT_30.paragraph[lang], REENGAGEMENT_30.closing[lang]);
  }

  if (!subject || !preheader || body.some((p) => p === null)) return null;

  return {
    content: {
      subject,
      preheader,
      paragraphs: [GREETING[lang], ...(body as string[])],
      cta_label: BUTTON[lang],
      cta_url: TOURIST_APP_LINK,
    },
    footerNote: service ? SERVICE_FOOTER_NOTE[lang] : REENGAGEMENT_FOOTER_NOTE[lang],
    unsubscribeLabel: service ? SERVICE_UNSUBSCRIBE[lang] : undefined,
    utmCampaign: type.replace(/_/g, '-'),
  };
}
