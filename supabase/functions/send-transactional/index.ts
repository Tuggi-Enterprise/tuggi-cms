// Edge Function: send-transactional
//
// Single-recipient transactional emails (NOT batch campaigns) for the partner
// registration/approval flow. Mirrors the send-newsletter Resend pattern but uses
// the single-send endpoint (api.resend.com/emails).
//
// Routes:
//   POST /send   { type, to, data, lang }
//   GET  /health
//
// type:
//   'partner_new'      -> internal alert to the team (a new partner registered, pt)
//   'partner_received' -> to the user (registration received, under review)
//   'partner_approved' -> to the user (partnership approved)
//   'partner_rejected' -> to the user (registration not approved + reason)
//   'partner_form_invite' -> to the establishment (link to the external form of #341, pt)
//
// lang: 'pt' | 'en' | 'es' | 'fr' | 'it' (normalized; defaults to 'pt'). Applies
//       to the user-facing types; partner_new (team) is always pt.
//
// Secrets: RESEND_API_KEY, RESEND_FROM (default "Tuggi <news@tuggi.app>"),
//          PARTNER_ALERT_TO (default "suporte@tuggi.app"), APP_URL (optional),
//          PARTNER_FORM_ORIGIN (optional)
//
// NO LINK IN THESE E-MAILS COMES FROM THE CALLER. This function is reachable with the
// publishable key (it has no authorization of its own until #346), so any href it accepts
// from the body is an open phishing kit signed with our SPF/DKIM/DMARC — and the audience
// here is exactly the partner we ask for CNPJ, alvará and a contrato social carrying the
// CPF and RG of the members. Every `href` below is composed from an origin of ours plus a
// value whose shape is verified. `data.url` and `data.app_url` are ignored on purpose.

import {
  partnerStrings,
  type PartnerEvent,
} from '../_shared/partner-i18n.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
};

const RESEND_URL = 'https://api.resend.com/emails';
const TUGGI_BLUE = '#00A8E8';

/** Where the app lives, for the only CTA of the `approved` e-mail. */
const DEFAULT_APP_ORIGIN = 'https://tuggi.app';

/**
 * Where the partner form of #341 lives — the CMS, not the public site, which is why this
 * is its own secret and not `APP_URL` (that one points at `tuggi-enterprise`, the host of
 * `/unsubscribe`).
 */
const DEFAULT_PARTNER_FORM_ORIGIN = 'https://cms.tuggi.app';

/**
 * Twin of `lib/partner-form/link.ts`, symbols `PARTNER_FORM_LOCALE` and `partnerFormPath`.
 * It is duplicated because Deno cannot import the Next side, and the two are held together
 * by a parity assertion in `tests/api/partner-form.test.ts` — change one and it goes red.
 */
const PARTNER_FORM_LOCALE = 'pt';

/**
 * 32 random bytes in base64url, the shape `partner-proposal-service.ts` mints and
 * `isWellFormedToken` demands. Anything else is refused before it reaches an `href`:
 * without this, a "token" of `../..%2Fevil` or a whole URL walks straight back out.
 */
const INVITE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{40,64}$/;

/** An https origin of ours, or the default. Never the caller's. */
function ownOrigin(secret: string, fallback: string): string {
  const configured = (Deno.env.get(secret) ?? '').trim().replace(/\/+$/, '');
  return /^https:\/\/[^\s/?#]+$/.test(configured) ? configured : fallback;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

const esc = (s: unknown) =>
  String(s ?? '').replace(/[<>&"]/g, c =>
    c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '&' ? '&amp;' : '&quot;'
  );

function shell(title: string, bodyHtml: string): string {
  return `<!doctype html><html><body style="margin:0;background:#f4f6f8;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1c2638">
  <div style="max-width:520px;margin:0 auto;padding:24px">
    <div style="background:${TUGGI_BLUE};border-radius:16px 16px 0 0;padding:20px 24px">
      <span style="color:#fff;font-size:20px;font-weight:800;letter-spacing:.5px">TUGGI</span>
    </div>
    <div style="background:#fff;border-radius:0 0 16px 16px;padding:28px 24px">
      <h1 style="font-size:20px;margin:0 0 12px">${esc(title)}</h1>
      ${bodyHtml}
    </div>
    <p style="color:#8a93a3;font-size:12px;text-align:center;margin:16px 0">© Tuggi</p>
  </div></body></html>`;
}

// Internal team alert — always pt (not user-facing).
function renderTeamAlert(data: Record<string, unknown>): {
  subject: string;
  html: string;
} {
  const name = esc(data.partner_name ?? data.name ?? '');
  const ctype = esc(data.client_type ?? '');
  return {
    subject: `Novo parceiro: ${name || ctype || 'cadastro'}`,
    html: shell(
      'Novo cadastro de parceiro',
      `<p>Um novo parceiro se cadastrou e está aguardando análise.</p>
       <p><b>Nome:</b> ${name || '—'}<br/>
          <b>Tipo:</b> ${ctype || '—'}<br/>
          <b>Email:</b> ${esc(data.email ?? '—')}<br/>
          <b>Cidade:</b> ${esc(data.city ?? '—')}</p>
       <p>Analise no CMS para aprovar ou rejeitar.</p>`
    ),
  };
}

// User-facing, localized (received/approved/rejected).
function renderLocalized(
  event: PartnerEvent,
  lang: string | undefined,
  data: Record<string, unknown>
): { subject: string; html: string } {
  const s = partnerStrings(event, lang);
  const name = esc(data.partner_name ?? data.name ?? '');
  const namePart = name ? ' ' + name : '';

  const paras = s.email.paragraphs
    .map(p => `<p>${esc(p).replace('%NAME%', namePart)}</p>`)
    .join('\n');

  const reason =
    event === 'rejected' && s.email.reasonLabel && data.reason
      ? `<p><b>${esc(s.email.reasonLabel)}</b> ${esc(data.reason)}</p>`
      : '';

  const cta =
    event === 'approved' && s.email.cta
      ? `<p style="margin-top:20px">
           <a href="${esc(ownOrigin('APP_URL', DEFAULT_APP_ORIGIN))}" style="background:${TUGGI_BLUE};color:#fff;text-decoration:none;padding:12px 22px;border-radius:12px;font-weight:700;display:inline-block">${esc(s.email.cta)}</a>
         </p>`
      : '';

  return {
    subject: s.email.subject,
    html: shell(s.email.heading, `${paras}\n${reason}\n${cta}`),
  };
}

/**
 * Invite to the external partner form (#341). Portuguese only, and the reason is not
 * laziness: the form asks for CNPJ and alvará, which are Brazilian documents, so the
 * surface exists in `pt` by decision (spec do `design`, §8.3).
 *
 * The button is `#00719F` and not `TUGGI_BLUE`: white on #00A8E8 measures 2.70:1 and
 * fails even the 3:1 of the non-text criterion. The `shell()` band above is inherited
 * and is not part of this delivery.
 *
 * It says nothing about price, recurrence or what the partnership costs — the capture
 * surface is closed for that (BR-B2B-015, item 8; BR-B2B-016, item 6).
 *
 * It takes the TOKEN and composes the link itself. It used to take `data.url` behind an
 * `^https://` test, which accepts every host on the internet: this e-mail carries our
 * brand to the very people we then ask for the documents of the members, so the one thing
 * it must never do is point somewhere we do not own.
 */
const CTA_BLUE = '#00719F';

function renderFormInvite(data: Record<string, unknown>): {
  subject: string;
  html: string;
} {
  const name = esc(data.name ?? data.partner_name ?? '');
  const tradeName = esc(data.trade_name ?? '');
  const token = String(data.token ?? '');
  if (!INVITE_TOKEN_PATTERN.test(token)) {
    throw new Error('partner_form_invite requires a well-formed invite token');
  }
  const href = `${ownOrigin('PARTNER_FORM_ORIGIN', DEFAULT_PARTNER_FORM_ORIGIN)}/${PARTNER_FORM_LOCALE}/parceria/${token}`;

  const place = tradeName || 'seu estabelecimento';
  const greeting = name ? `Olá, ${name}.` : 'Olá.';

  return {
    subject: `Complete o cadastro de ${tradeName || 'seu estabelecimento'} — Tuggi`,
    html: shell(
      'Complete o cadastro do seu estabelecimento',
      `<p>${greeting}</p>
       <p>Para seguir com a parceria, a gente precisa de alguns dados do ${place}. É rápido e dá para fazer pelo celular.</p>
       <p style="margin-top:20px">
         <a href="${esc(href)}" style="background:${CTA_BLUE};color:#fff;text-decoration:none;padding:12px 22px;border-radius:12px;font-weight:700;display:inline-block">Preencher agora</a>
       </p>
       <p>O link é só seu. Se não foi você quem pediu, ignore este e-mail.</p>`
    ),
  };
}

const EVENT_BY_TYPE: Record<string, PartnerEvent> = {
  partner_received: 'received',
  partner_approved: 'approved',
  partner_rejected: 'rejected',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const url = new URL(req.url);
  const path = url.pathname.replace(/.*\/send-transactional/, '') || '/';
  if (path === '/health') return json({ status: 'ok' });

  if (path !== '/send' || req.method !== 'POST') {
    return json({ error: 'not_found' }, 404);
  }

  try {
    const RESEND_API_KEY = (Deno.env.get('RESEND_API_KEY') ?? '').trim();
    const RESEND_FROM = (
      Deno.env.get('RESEND_FROM') ?? 'Tuggi <news@tuggi.app>'
    ).trim();
    const PARTNER_ALERT_TO = (
      Deno.env.get('PARTNER_ALERT_TO') ?? 'suporte@tuggi.app'
    ).trim();
    if (!RESEND_API_KEY) return json({ error: 'RESEND_API_KEY missing' }, 500);

    const body = await req.json();
    const { type, to, data = {}, lang } = body ?? {};
    if (!type) return json({ error: 'type required' }, 400);

    // Internal alert defaults to the team address; user emails require `to`.
    const recipient = type === 'partner_new' ? to || PARTNER_ALERT_TO : to;
    if (!recipient) return json({ error: 'to required' }, 400);

    const { subject, html } =
      type === 'partner_new'
        ? renderTeamAlert(data)
        : type === 'partner_form_invite'
          ? renderFormInvite(data)
          : EVENT_BY_TYPE[type]
            ? renderLocalized(EVENT_BY_TYPE[type], lang, data)
            : (() => {
                throw new Error(`unknown type: ${type}`);
              })();

    const res = await fetch(RESEND_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: RESEND_FROM,
        to: [recipient],
        subject,
        html,
      }),
    });
    const out = await res.json();
    if (!res.ok) return json({ error: 'resend_failed', detail: out }, 502);
    return json({ success: true, id: out.id });
  } catch (e) {
    return json({ error: 'exception', message: String(e) }, 500);
  }
});
