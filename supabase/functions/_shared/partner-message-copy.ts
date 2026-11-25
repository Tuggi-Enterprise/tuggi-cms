/**
 * The Tuggi frame of the partner message e-mail (#1264, BR-COMUNICACAO-026 items 5.d, 6.c and 7,
 * identification). Text: `docs/design/copy/mensagem-do-parceiro-2026-11.md` §3.2, word for word.
 * The partner writes none of this; the curator approves the partner's six fields in the CMS.
 *
 * Languages: pt, en, es, it, the ones the footer exists in (copy §3.2). The database never answers
 * another language for this message (`drive.claim_partner_message_recipients`, 6.f).
 *
 * Pure: no remote import, so `tests/api` can load it if it ever needs to.
 */

export const PARTNER_MESSAGE_LANGS = ['pt', 'en', 'es', 'it'] as const;
export type PartnerMessageLang = (typeof PARTNER_MESSAGE_LANGS)[number];

/** `pt` for `pt-BR`, `en` for anything outside the four (the database already chose one of them). */
export function partnerMessageLang(raw: unknown): PartnerMessageLang {
  const base = String(raw ?? '').trim().slice(0, 2).toLowerCase();
  return (PARTNER_MESSAGE_LANGS as readonly string[]).includes(base) ? (base as PartnerMessageLang) : 'en';
}

type Copy = Record<PartnerMessageLang, string>;

/**
 * The version of the footer text, recorded with the act "no" when the person leaves by the e-mail
 * (`drive.stop_partner_messages_by_link`, BR-B2B-072 item 3), in the form the app uses for the other
 * ways out (`com-026.inbox.v1`, `com-026.settings.v1`). A new footer text gets a new version.
 */
export const PARTNER_MESSAGE_FOOTER_VERSION = 'com-026.email.v1';

/** The Android channel the app creates with IMPORTANCE_LOW (BR-COMUNICACAO-026 item 3.b). */
export const PARTNER_MESSAGE_ANDROID_CHANNEL = 'partner_messages';

export const PARTNER_EMAIL_COPY: Record<
  'eyebrow' | 'footer_why' | 'footer_reply' | 'footer_stop_partner' | 'stop_done' | 'stop_error',
  Copy
> = {
  eyebrow: {
    pt: 'Mensagem de parceiro',
    en: 'Partner message',
    es: 'Mensaje de un socio',
    it: 'Messaggio di un partner',
  },
  footer_why: {
    pt: 'Você recebe este e-mail porque aceitou as mensagens de @{{handle}} pelo Tuggi em {{date}}.',
    en: "You're getting this email because you agreed to messages from @{{handle}} through Tuggi on {{date}}.",
    es: 'Recibes este correo porque aceptaste los mensajes de @{{handle}} a través de Tuggi el {{date}}.',
    it: 'Ricevi questa e-mail perché il {{date}} hai accettato i messaggi di @{{handle}} tramite Tuggi.',
  },
  footer_reply: {
    pt: 'Respostas a este e-mail chegam ao Tuggi.',
    en: 'Replies to this email go to Tuggi.',
    es: 'Las respuestas a este correo llegan a Tuggi.',
    it: 'Le risposte a questa e-mail arrivano a Tuggi.',
  },
  footer_stop_partner: {
    pt: 'Parar as mensagens de @{{handle}}',
    en: 'Stop messages from @{{handle}}',
    es: 'Parar mensajes de @{{handle}}',
    it: 'Stop ai messaggi di @{{handle}}',
  },
  stop_done: {
    pt: 'Pronto. Você não recebe mais as mensagens de @{{handle}}. Os outros avisos do Tuggi continuam como estavam.',
    en: "Done. You won't get messages from @{{handle}} anymore. Your other Tuggi notifications stay as they were.",
    es: 'Listo. Ya no recibirás mensajes de @{{handle}}. Los demás avisos de Tuggi siguen igual.',
    it: 'Fatto. Non riceverai più messaggi di @{{handle}}. Gli altri avvisi di Tuggi restano come prima.',
  },
  stop_error: {
    pt: 'Não deu para registrar agora. Abra o link de novo daqui a pouco, ou pare pelo app, nos Ajustes.',
    en: "We couldn't save that right now. Open the link again in a moment, or stop them in the app, under Settings.",
    es: 'No pudimos registrarlo ahora. Abre el enlace de nuevo en un rato o páralos desde la app, en Ajustes.',
    it: "Non siamo riusciti a registrarlo ora. Riapri il link tra poco oppure fermali dall'app, nelle Impostazioni.",
  },
};

const DATE_LOCALE: Copy = { pt: 'pt-BR', en: 'en-US', es: 'es-ES', it: 'it-IT' };

/** The date of the yes, spelled out with the year (copy, "Como ler"), in Sao Paulo time. */
export function consentDate(iso: unknown, lang: PartnerMessageLang): string | null {
  const parsed = new Date(String(iso ?? ''));
  if (!iso || Number.isNaN(parsed.getTime())) return null;
  return new Intl.DateTimeFormat(DATE_LOCALE[lang], {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'America/Sao_Paulo',
  }).format(parsed);
}

/** `{{handle}}` and `{{date}}` filled in. A value never carries markup: the layout escapes it. */
export function fill(template: string, vars: { handle?: string; date?: string }): string {
  return template.replace(/\{\{(handle|date)\}\}/g, (_, key: 'handle' | 'date') => vars[key] ?? '');
}
