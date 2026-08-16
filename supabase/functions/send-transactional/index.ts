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
//   'partner_contract_sign'   -> to the legal representative (read and sign, #342, pt)
//   'partner_contract_signed' -> to the legal representative (signed copy, #342, pt)
//
// lang: 'pt' | 'en' | 'es' | 'fr' | 'it' (normalized; defaults to 'pt'). Applies
//       to the user-facing types; partner_new (team) is always pt.
//
// Secrets: RESEND_API_KEY, RESEND_FROM (default "Tuggi <news@tuggi.app>"),
//          PARTNER_ALERT_TO (default "suporte@tuggi.app"), APP_URL (optional),
//          PARTNER_FORM_ORIGIN (optional)
//
// `partner_form_invite` WAS HERE AND IS GONE (#341, 2026-08-16). The partner form has no
// invite: one address serves every establishment, it carries no token, and the team sends it
// by hand to whoever they already met. A template whose whole job was to compose a link from a
// secret token has nothing left to compose. A caller that still asks for the type now gets
// `unknown type`, which is the truth — see docs/contracts/edge-functions.md.
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
 * 32 random bytes in base64url, the shape `lib/security/single-use-token.ts` mints and
 * `isWellFormedSingleUseToken` demands, for the contract link of #342. Anything else is
 * refused before it reaches an `href`: without this, a "token" of `../..%2Fevil` or a whole
 * URL walks straight back out.
 */
const SIGNING_TOKEN_PATTERN = /^[A-Za-z0-9_-]{40,64}$/;

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
 * The button is `#00719F` and not `TUGGI_BLUE`: white on #00A8E8 measures 2.70:1 and fails
 * even the 3:1 of the non-text criterion. The `shell()` band above is inherited and is not
 * part of this delivery.
 */
const CTA_BLUE = '#00719F';

/**
 * Twin of `lib/contract/link.ts`, symbols `CONTRACT_LOCALE` and `contractPath`. Duplicated
 * for the same reason as the form locale above, and held by the same kind of parity
 * assertion in `tests/api/partner-contract.test.ts`.
 */
const CONTRACT_LOCALE = 'pt';

function contractHref(token: string): string {
  if (!SIGNING_TOKEN_PATTERN.test(token)) {
    throw new Error('contract e-mail requires a well-formed signing token');
  }
  return `${ownOrigin('PARTNER_FORM_ORIGIN', DEFAULT_PARTNER_FORM_ORIGIN)}/${CONTRACT_LOCALE}/contrato/${token}`;
}

/** #342 — the contract is ready, come and read it. It never mentions the value. */
function renderContractSign(data: Record<string, unknown>): {
  subject: string;
  html: string;
} {
  const name = esc(data.name ?? '');
  const legalName = esc(data.legal_name ?? 'seu estabelecimento');
  const href = contractHref(String(data.token ?? ''));
  const greeting = name ? `Olá, ${name}.` : 'Olá.';

  return {
    subject: 'Seu contrato de parceria está pronto para assinatura',
    html: shell(
      'Seu contrato de parceria está pronto',
      `<p>${greeting}</p>
       <p>O contrato de parceria de ${legalName} está pronto. Você lê o texto inteiro na tela e assina por lá — não precisa imprimir nem instalar nada.</p>
       <p style="margin-top:20px">
         <a href="${esc(href)}" style="background:${CTA_BLUE};color:#fff;text-decoration:none;padding:12px 22px;border-radius:12px;font-weight:700;display:inline-block">Ler e assinar</a>
       </p>
       <p>Qualquer dúvida, é só responder este e-mail.</p>`
    ),
  };
}

/**
 * #342 — the copy of the signed contract.
 *
 * It carries a LINK back to the same page, which serves the archived PDF, and NOT an
 * attachment. This function has no authorization of its own until #346, so an attachment
 * parameter here would let any holder of the publishable key send an arbitrary file with
 * our DKIM on it. The `design` copy says the PDF is attached; the narrowing and its reason
 * are registered in #342.
 */
function renderContractSigned(data: Record<string, unknown>): {
  subject: string;
  html: string;
} {
  const name = esc(data.name ?? '');
  const role = esc(data.role ?? '');
  const legalName = esc(data.legal_name ?? '');
  const acceptedAt = esc(data.accepted_at ?? '');
  const code = esc(data.verification_code ?? '');
  const href = contractHref(String(data.token ?? ''));

  return {
    subject: `Contrato de parceria assinado — ${legalName}`,
    html: shell(
      'Contrato de parceria assinado',
      `<p>Assinado por ${name}${role ? ` (${role})` : ''} em ${acceptedAt}, horário de Brasília.</p>
       <p style="margin-top:20px">
         <a href="${esc(href)}" style="background:${CTA_BLUE};color:#fff;text-decoration:none;padding:12px 22px;border-radius:12px;font-weight:700;display:inline-block">Baixar o contrato assinado</a>
       </p>
       <p>O código de verificação do documento é <strong>${code}</strong> — guarde junto com o arquivo.</p>`
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
        : type === 'partner_contract_sign'
          ? renderContractSign(data)
          : type === 'partner_contract_signed'
            ? renderContractSigned(data)
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
