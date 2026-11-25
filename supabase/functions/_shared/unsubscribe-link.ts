// _shared/unsubscribe-link.ts
//
// The signed unsubscribe link and the RFC 8058 one-click headers of every Tuggi e-mail that is
// not transactional: the newsletter, the ranking e-mail (`send-newsletter`) and the tourist
// e-mails of `send-transactional` (#957). One mechanism, one list, `marketing.email_unsubscribes`
// (BR-COMUNICACAO-015; BR-COMUNICACAO-020 item 4). Moved out of `send-newsletter` in #957 so the
// second sender does not grow a second copy. Pure: no remote import, so `tests/api` loads it.

import { constantTimeEqual } from './constant-time.ts';

const toBase64Url = (bytes: Uint8Array): string => {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
};

export const encodeEmail = (email: string): string =>
  toBase64Url(new TextEncoder().encode(email.toLowerCase().trim()));

/** HMAC-SHA256 of the exact text, base64url. The one signer of every link below. */
async function hmac(text: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text));
  return toBase64Url(new Uint8Array(sig));
}

// HMAC-SHA256 signature of the address (stateless): unsubscribe without pre-populated rows,
// and no unsubscribe of an arbitrary address.
export function signEmail(email: string, secret: string): Promise<string> {
  return hmac(email.toLowerCase().trim(), secret);
}

// O unsubscribe é hospedado no site público (tuggi.app), cujos locales são
// en/es/pt-br/pt-pt (sem italiano). Mapeamos o idioma do conteúdo para um locale
// VÁLIDO do site para a rota, e passamos &lang= para a página exibir o idioma real
// (ex.: it usa a rota /en mas mostra texto em italiano).
const SITE_LOCALE: Record<string, string> = { pt: 'pt-br', en: 'en', es: 'es', it: 'en' };

export async function buildUnsubscribeUrl(email: string, appUrl: string, secret: string, lang: string): Promise<string> {
  const e = encodeEmail(email);
  const s = await signEmail(email, secret);
  const base = appUrl.replace(/\/$/, '');
  const siteLocale = SITE_LOCALE[lang] || 'en';
  return `${base}/${siteLocale}/unsubscribe?e=${e}&s=${s}&lang=${lang}`;
}

/**
 * The address the `List-Unsubscribe` HEADER carries, and why it is NOT the site page.
 *
 * RFC 8058 is a POST: the mail client sends `List-Unsubscribe=One-Click` as the body of the
 * https URI and expects 2xx. The site page (`tuggi-enterprise`,
 * `src/app/[locale]/unsubscribe/page.tsx`) is a Server Component — it answers GET only, and a
 * POST to it returns 405. Advertising `List-Unsubscribe-Post` pointed at it would leave Gmail's
 * unsubscribe button erroring out, which is worse than having no button.
 *
 * So the header points at `POST /unsubscribe` on THIS function, which accepts the POST and
 * writes; the visible footer link in the body stays the site page, which is localized and
 * readable. Two surfaces, one secret, the same `e`/`s` pair.
 */
export async function buildOneClickUrl(email: string, functionsUrl: string, secret: string): Promise<string> {
  const e = encodeEmail(email);
  const s = await signEmail(email, secret);
  return `${functionsUrl.replace(/\/$/, '')}/send-newsletter/unsubscribe?e=${e}&s=${s}`;
}

/**
 * Both one-click unsubscribe headers. Gmail requires BOTH of any sender doing 5,000 messages a
 * day — https://support.google.com/a/answer/81126: "Marketing messages and subscribed messages
 * must support one-click unsubscribe", with `List-Unsubscribe-Post: List-Unsubscribe=One-Click`
 * and `List-Unsubscribe: <https://…>`, citing RFC 2369 and RFC 8058. The same page requires
 * "spam rates reported in Postmaster Tools below 0.30%".
 *
 * Until 2026-09-10 only the first was sent, and on its own it does not meet the requirement.
 */
export function unsubscribeHeaders(oneClickUrl: string): Record<string, string> {
  return {
    'List-Unsubscribe': `<${oneClickUrl}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  };
}

/**
 * A link with a SCOPE (#1231): it stops one kind of message and nothing else, and the general link
 * above cannot be replayed as a scoped one, nor the other way round, because the signed text differs
 * (`<scope>:<address>` against the bare address). Same secret, `NEWSLETTER_SECRET`.
 *
 * The one scope today is `trip_reminder`: the trip reminder was asked for by the person, so the
 * general unsubscribe of BR-COMUNICACAO-020 item 4 also stops it, and this link stops only it
 * (`docs/design/copy/proxima-viagem-1229-2026-11.md` §9.b). The function that honours it is
 * `trip-reminder/stop`, which calls `drive.stop_trip_reminder_emails`.
 */
export type UnsubscribeScope = 'trip_reminder';

export function signScopedEmail(scope: UnsubscribeScope, email: string, secret: string): Promise<string> {
  return signEmail(`${scope}:${email.toLowerCase().trim()}`, secret);
}

export async function buildScopedStopUrl(
  scope: UnsubscribeScope,
  email: string,
  functionsUrl: string,
  secret: string,
  lang: string
): Promise<string> {
  const e = encodeEmail(email);
  const s = await signScopedEmail(scope, email, secret);
  return `${functionsUrl.replace(/\/$/, '')}/trip-reminder/stop?e=${e}&s=${s}&scope=${scope}&lang=${encodeURIComponent(lang)}`;
}

/** The address of a scoped link, or `null` when the link was not signed by us for that scope. */
export async function verifyScopedStop(
  scope: UnsubscribeScope,
  encoded: string | null,
  signature: string | null,
  secret: string
): Promise<string | null> {
  if (!encoded || !signature || !secret) return null;
  let email: string;
  try {
    const b64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
    email = new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  } catch {
    return null;
  }
  if (!/^[^\s@]{1,128}@[^\s@]{1,253}$/.test(email)) return null;
  const expected = await signScopedEmail(scope, email, secret);
  return constantTimeEqual(expected, signature) ? email.toLowerCase().trim() : null;
}

/**
 * Links signed over a ROW ID instead of an address (#1264, BR-COMUNICACAO-026 item 5.d). The
 * partner message e-mail carries no account id and no address in its links
 * (`docs/contracts/tuggi-do-parceiro.md` §11.3): the id is the `recipient_id` of
 * `drive.partner_message_recipients`, one per message and person.
 *
 * - `partner_message`: the footer "stop messages from @partner" and the `List-Unsubscribe` header.
 *   Signed text `partner_message:<recipient_id>`.
 * - `partner_message_click`: the button. Signed text `partner_message_click:<recipient_id>\n<url>`,
 *   so the redirect goes only to the URL this sender put in the e-mail, never to one typed in the
 *   query string (no open redirect).
 *
 * The scope is inside the signed text, so a stop link cannot be replayed as a click nor the other
 * way round, and none of them as the address-signed links above. Same secret, `NEWSLETTER_SECRET`.
 */
export type SignedIdScope = 'partner_message' | 'partner_message_click';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function signScopedId(scope: SignedIdScope, id: string, secret: string, extra = ''): Promise<string> {
  return hmac(`${scope}:${id.toLowerCase()}${extra ? `\n${extra}` : ''}`, secret);
}

/** The id when the link was signed by us for that scope (and `extra`), `null` otherwise. */
export async function verifyScopedId(
  scope: SignedIdScope,
  id: string | null,
  signature: string | null,
  secret: string,
  extra = ''
): Promise<string | null> {
  if (!id || !signature || !secret || !UUID_RE.test(id)) return null;
  const expected = await signScopedId(scope, id, secret, extra);
  return constantTimeEqual(expected, signature) ? id.toLowerCase() : null;
}
