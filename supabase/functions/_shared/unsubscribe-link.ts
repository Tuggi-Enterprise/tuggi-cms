// _shared/unsubscribe-link.ts
//
// The signed unsubscribe link and the RFC 8058 one-click headers of every Tuggi e-mail that is
// not transactional: the newsletter, the ranking e-mail (`send-newsletter`) and the tourist
// e-mails of `send-transactional` (#957). One mechanism, one list, `marketing.email_unsubscribes`
// (BR-COMUNICACAO-015; BR-COMUNICACAO-020 item 4). Moved out of `send-newsletter` in #957 so the
// second sender does not grow a second copy. Pure: no remote import, so `tests/api` loads it.

const toBase64Url = (bytes: Uint8Array): string => {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
};

export const encodeEmail = (email: string): string =>
  toBase64Url(new TextEncoder().encode(email.toLowerCase().trim()));

// Assinatura HMAC-SHA256 do email (stateless): permite descadastro sem
// pré-popular linhas no banco e impede unsubscribe de emails arbitrários.
export async function signEmail(email: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(email.toLowerCase().trim()));
  return toBase64Url(new Uint8Array(sig));
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
