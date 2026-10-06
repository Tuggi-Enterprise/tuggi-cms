// _shared/places-portal-draft.ts — the logic of the Edge Function `places-portal-draft` (#863).
//
// The anonymous draft of the Portal Locais (`tuggi-places`), its clickwrap acceptance, and the
// e-mail link that signs in and claims it. Contract: `docs/contracts/places-portal-rascunho.md`
// (workspace), §7 since `20261006110000`. Rules: BR-B2B-043 item 1 and edge cases, BR-B2B-047
// (item 3: clickwrap), BR-B2B-049 items 3 and 10, BR-B2B-055.
//
// The link comes AFTER the acceptance is settled (paid, or free): it opens the `/status` and signs
// nothing (operator, #863 issuecomment-6007476946). It is issued here (`submit` that lands in
// `in_review`, `request_link` `access` and `login`) and by the payment webhook
// (`places-payment.ts`, through `issueAccessLink`).
//
// The ONLY place where `service_role` touches the anonymous draft (security review of #863,
// option B): the portal's Worker holds no Supabase secret key. Every database call is one of a
// FIXED list of `partner.portal_draft_*` functions (`DRAFT_RPCS`); nothing generic passes. The
// user id and the session of the claim come from the user's JWT verified here, never from the
// body.
//
// Pure and import-free on purpose: the CMS tests load it under Node (`tsx`). The Deno wiring
// (supabase-js from esm.sh, Resend) lives in `places-portal-draft/index.ts`.

export const DRAFT_SECRET_HEADER = 'x-places-draft-secret';
export const DRAFT_SECRET_ENV = 'PLACES_DRAFT_SECRET';
export const PORTAL_ORIGIN_ENV = 'PLACES_PORTAL_ORIGIN';
/** The portal (#874). Same value as `tuggi-places` `src/lib/portal-origin.ts` `PORTAL_ORIGIN`. */
export const DEFAULT_PORTAL_ORIGIN = 'https://partner.tuggi.app';
/** `raw_user_meta_data.signup_origin` of a portal account: the app's trigger makes no tourist of it (`20261004150000`). */
export const PORTAL_SIGNUP_ORIGIN = 'places_portal';
export const PHOTO_BUCKET = 'place-submission-photos';
/** Bucket cap per object (migration `20261004130000`), the same as `tuggi-places` `PHOTO_MAX_BYTES`. */
export const PHOTO_MAX_BYTES = 2 * 1024 * 1024;
export const SIGNED_URL_TTL_S = 3600;

/** The fixed list. Adding a name here is a contract change (`places-portal-rascunho.md`). */
export const DRAFT_RPCS = [
  'portal_draft_create',
  'portal_draft_get',
  'portal_draft_save',
  'portal_draft_consume_generation',
  'portal_draft_get_terms',
  'portal_draft_quote',
  'portal_draft_photo_allowed',
  'portal_draft_request_claim',
  'portal_draft_claim',
  'portal_draft_submit',
  'portal_draft_payment_checkout',
  'place_issue_claim',
] as const;
export type DraftRpc = (typeof DRAFT_RPCS)[number];

export type RpcError = { code?: string; details?: string; message?: string };
export type Rpc = (fn: DraftRpc, args: Record<string, unknown>) => Promise<{ data: unknown; error: RpcError | null }>;

export type Deps = {
  /** `partner.<fn>` with the service role. */
  rpc: Rpc;
  storage: {
    list(prefix: string): Promise<{ name: string; created_at: string | null }[]>;
    sign(paths: string[]): Promise<Record<string, string>>;
    upload(path: string, bytes: Uint8Array): Promise<boolean>;
    remove(path: string): Promise<boolean>;
  };
  auth: {
    /** Creates the e-mail user if it does not exist (marked as portal). `false` = could not. */
    ensureUser(email: string): Promise<boolean>;
    /** `auth.admin.generateLink({ type: 'magiclink' })`: the hashed token, never the link GoTrue built. */
    magicLink(email: string): Promise<{ tokenHash: string; type: string } | null>;
    /** The verified claims of a user JWT, or `null`. */
    claims(jwt: string): Promise<{ sub: string; sessionId: string } | null>;
  };
  /** `fromName` replaces the display name of `RESEND_FROM` (the access e-mail is from "Tuggi Locais"). */
  sendEmail(to: string, subject: string, html: string, text: string, fromName?: string): Promise<boolean>;
  sha256Hex(s: string): Promise<string>;
  uuid(): string;
  /** 32 random bytes, base64url (43 chars): the claim token of a link this function draws. */
  randomToken(): string;
  /**
   * Service-role read of `partner.place_submissions`, outside the RPC list: the latest ownerless
   * submission of an e-mail past the acceptance and the payment (the login fallback, §7).
   */
  submissions: {
    settledOwnerless(email: string): Promise<string | null>;
  };
  origin: string;
};

/** What issuing the access link needs: the webhook of `places-payment` builds it too. */
export type AccessLinkDeps = Pick<Deps, 'sendEmail' | 'sha256Hex' | 'randomToken' | 'origin'> & {
  auth: Pick<Deps['auth'], 'ensureUser' | 'magicLink'>;
  /** `partner.place_issue_claim(p_submission_id, p_claim_sha256)` with the service role. */
  issueClaim(submissionId: string, claimSha256: string): Promise<{ data: unknown; error: RpcError | null }>;
};

export type Result = { status: number; body: Record<string, unknown> };

const HEX64 = /^[0-9a-f]{64}$/;
const CLAIM_TOKEN = /^[A-Za-z0-9_-]{43}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TERMS_VERSION = /^[a-z0-9][a-z0-9._-]{0,63}$/i;
const IP = /^[0-9a-fA-F:.]{2,45}$/;
const USER_AGENT_MAX = 1024;
const PHOTO_PATH = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/(facade|gallery)\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp)$/;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
/** Shape only (printable, no space, ≤ 64); `partner.portal_draft_quote` judges the code. */
const VOUCHER = /^[\x21-\x7e]{1,64}$/;

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const bad = (field: string): Result => ({ status: 400, body: { error: 'invalid', field } });

/** Same rule as `tuggi-places` `checkEmail`; the database checks again. */
export function normalEmail(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const e = v.trim().toLowerCase();
  return e.length <= 254 && /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(e) ? e : null;
}

/** The portal origin from the env, only `https://host[:port]`; anything else falls back. */
export function portalOrigin(raw: string | undefined): string {
  const v = (raw ?? '').trim().replace(/\/+$/, '');
  return /^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(v) ? v : DEFAULT_PORTAL_ORIGIN;
}

export type AcceptParams = { termsVersion: string; termsSha256: string; sticker: boolean; display: boolean; social: boolean; marketing: boolean };

export function parseAccept(v: unknown): AcceptParams | null {
  const a = obj(v);
  const k = obj(a?.activation_commitment);
  if (!a || !k) return null;
  if (typeof a.terms_version !== 'string' || !TERMS_VERSION.test(a.terms_version)) return null;
  if (typeof a.terms_sha256 !== 'string' || !HEX64.test(a.terms_sha256.toLowerCase())) return null;
  if (typeof k.sticker !== 'boolean' || typeof k.display !== 'boolean' || typeof k.social !== 'boolean') return null;
  if (typeof a.marketing_consent !== 'boolean') return null;
  return { termsVersion: a.terms_version, termsSha256: a.terms_sha256.toLowerCase(), sticker: k.sticker, display: k.display, social: k.social, marketing: a.marketing_consent };
}

/**
 * The link of the e-mail. NO HREF COMES FROM THE BODY (`send-transactional` lesson): the origin
 * is ours, every value is checked against its shape, and the parameter names are the contract
 * `tuggi-places` `parseEmailLink` reads (`places-portal-rascunho.md` §3). `claimToken`: the access
 * link, which claims the ownerless submission; without it, a plain sign-in.
 */
export function linkUrl(origin: string, link: { tokenHash: string; type: string }, claimToken?: string): string {
  const q = new URLSearchParams({ th: link.tokenHash, tt: link.type });
  if (claimToken && CLAIM_TOKEN.test(claimToken)) q.set('c', claimToken);
  return `${origin}/entrar?${q.toString()}`;
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const PAGE_OPEN = '<!doctype html><html lang="pt-BR"><body style="margin:0;padding:24px;background:#F7F9FA;font-family:Arial,sans-serif;color:#1A1A1A">';
const CARD_OPEN = '<div style="max-width:480px;margin:0 auto;background:#fff;border-radius:16px;padding:32px">';
const P = 'font-size:16px;line-height:1.5;margin:0 0 16px';
const SMALL = 'font-size:13px;line-height:1.5;color:#6B7280;margin:0 0 12px';
const button = (url: string, label: string) =>
  `<p style="margin:8px 0 24px"><a href="${escapeHtml(url)}" style="display:inline-block;background:#FF6F00;color:#fff;text-decoration:none;font-weight:bold;padding:14px 24px;border-radius:10px">${escapeHtml(label)}</a></p>`;

/** The sign-in e-mail (`request_link` `login` with no settled submission). Fixed text, no value from the body except the URL. */
export function linkEmail(url: string): { subject: string; html: string; text: string } {
  const subject = 'Tuggi: seu link para entrar e acompanhar o cadastro';
  const lead = 'Você pediu para entrar no cadastro do seu local no Tuggi. Toque no botão para entrar e acompanhar.';
  const help = 'O link vale por 1 hora e só funciona uma vez. Se você pediu mais de um, use o do e-mail mais recente. Se não foi você, ignore este e-mail: sem o toque, nada acontece. Dúvidas: suporte@tuggi.app.';
  const html = [PAGE_OPEN, CARD_OPEN, `<p style="${P}">${escapeHtml(lead)}</p>`, button(url, 'Entrar'), `<p style="${SMALL}">${escapeHtml(help)}</p>`, '</div></body></html>'].join('');
  return { subject, html, text: `${lead}\n\n${url}\n\n${help}` };
}

/** Sender display name of the access e-mail (spec of the `design`, #863 §2). */
export const ACCESS_FROM_NAME = 'Tuggi Locais';

/**
 * The access e-mail (spec of the `design`, #863 §2): fixed text, the same for the paid and the free
 * plan, with NO data of the submission — no trade name, CPF, CNPJ or amount. The e-mail is not
 * confirmed (BR-B2B-043), so anyone can aim it at any address: a trade name typed by the caller in
 * a subject sent from our domain with valid DKIM would be phishing with our brand (security review
 * of #863). "1 hora" is the real validity: `place_issue_claim` 1 h = GoTrue
 * `otp_expiry` 3600. The host is the portal's, the one the link opens.
 */
export function accessEmail(url: string, origin: string): { subject: string; html: string; text: string } {
  const host = new URL(origin).host;
  const subject = 'Seu local está em validação no Tuggi';
  const preheader = 'Acompanhe o cadastro pelo link abaixo.';
  const lines = {
    hello: 'Olá,',
    received: 'recebemos o cadastro do seu local no Tuggi, e a validação começou. Uma pessoa da Tuggi confere o local em até 2 dias úteis, e avisamos por este e-mail a cada etapa.',
    lead: 'Pelo botão abaixo você acompanha a validação, envia documentos e edita o local.',
    cta: 'Acompanhar o cadastro',
    ttl: `O botão vale por 1 hora e funciona uma vez. Depois disso, entre em ${host} com este e-mail, e mandamos outro.`,
    stranger: 'Não reconhece este cadastro? Escreva para suporte@tuggi.app.',
    sign: 'Equipe Tuggi',
  };
  const html = [
    PAGE_OPEN,
    `<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all">${escapeHtml(preheader)}</div>`,
    CARD_OPEN,
    `<p style="${P}">${lines.hello}</p>`,
    `<p style="${P}">${escapeHtml(lines.received)}</p>`,
    `<p style="${P}">${escapeHtml(lines.lead)}</p>`,
    button(url, lines.cta),
    `<p style="${SMALL}">${escapeHtml(lines.ttl)}</p>`,
    `<p style="${SMALL}">${escapeHtml(lines.stranger)}</p>`,
    `<p style="${P};margin:16px 0 0">${escapeHtml(lines.sign)}</p>`,
    '</div></body></html>',
  ].join('');
  const text = [lines.hello, '', lines.received, '', lines.lead, '', `${lines.cta}: ${url}`, '', lines.ttl, '', lines.stranger, '', lines.sign].join('\n');
  return { subject, html, text };
}

/**
 * The portal e-mail layout of `accessEmail`, for the transition e-mails of #813
 * (`places-transition-email.ts`): paragraphs, one button, small print, signature. Every string is
 * escaped; `links` are extra lines shown as links (the app stores).
 */
export function portalMail(m: {
  subject: string;
  preheader: string;
  paragraphs: string[];
  cta: { label: string; url: string };
  links?: { label: string; url: string }[];
  small: string[];
}): { subject: string; html: string; text: string } {
  const sign = 'Equipe Tuggi';
  const links = m.links ?? [];
  const html = [
    PAGE_OPEN,
    `<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all">${escapeHtml(m.preheader)}</div>`,
    CARD_OPEN,
    ...m.paragraphs.map((p) => `<p style="${P}">${escapeHtml(p)}</p>`),
    button(m.cta.url, m.cta.label),
    ...links.map((l) => `<p style="${P}"><a href="${escapeHtml(l.url)}" style="color:#1A1A1A">${escapeHtml(l.label)}</a></p>`),
    ...m.small.map((p) => `<p style="${SMALL}">${escapeHtml(p)}</p>`),
    `<p style="${P};margin:16px 0 0">${escapeHtml(sign)}</p>`,
    '</div></body></html>',
  ].join('');
  const text = [
    ...m.paragraphs.flatMap((p) => [p, '']),
    `${m.cta.label}: ${m.cta.url}`,
    '',
    ...links.flatMap((l) => [`${l.label}: ${l.url}`]),
    ...(links.length ? [''] : []),
    ...m.small.flatMap((p) => [p, '']),
    sign,
  ].join('\n');
  return { subject: m.subject, html, text };
}

/** Database error → Worker answer. Codes only: no message (PII) leaves. */
export function rpcFailure(e: RpcError): Result {
  const d = typeof e.details === 'string' && e.details ? e.details.slice(0, 64) : undefined;
  switch (e.code) {
    case 'TGP01':
      return { status: 404, body: { error: 'not_found' } };
    case 'TGP09':
      // The terms changed between reading and accepting (`portal_draft_submit`): show them again.
      return { status: 409, body: { error: 'terms_changed' } };
    case 'TGP10':
      return { status: 409, body: { error: 'conflict', ...(d ? { detail: d } : {}) } };
    case 'TGP22':
      return { status: 422, body: { error: 'invalid', ...(d ? { field: d } : {}) } };
    case 'TGP29':
      return { status: 429, body: { error: 'quota', ...(d ? { detail: d } : {}) } };
    case '42501':
      return { status: 403, body: { error: 'forbidden', ...(d ? { detail: d } : {}) } };
    case 'PGRST202':
      // The function is not in the database yet (migration not applied).
      return { status: 503, body: { error: 'unavailable' } };
    default:
      return { status: 502, body: { error: 'unavailable' } };
  }
}

const firstRow = (data: unknown): Record<string, unknown> | null => obj(Array.isArray(data) ? data[0] : data);

async function call(deps: Deps, fn: DraftRpc, args: Record<string, unknown>): Promise<{ ok: true; data: unknown } | { ok: false; result: Result }> {
  const { data, error } = await deps.rpc(fn, args);
  return error ? { ok: false, result: rpcFailure(error) } : { ok: true, data };
}

function decodeBase64(s: string): Uint8Array | null {
  if (!BASE64.test(s) || s.length > Math.ceil(PHOTO_MAX_BYTES / 3) * 4) return null;
  try {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out.length > 0 && out.length <= PHOTO_MAX_BYTES ? out : null;
  } catch {
    return null;
  }
}

/** JPEG/PNG/WebP by the magic bytes: the portal sends JPEG, the path says `.jpg`. */
const isJpeg = (b: Uint8Array) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;

/** The sign-in e-mail: user ensured (marked as portal), GoTrue's hashed token, our own e-mail. `null` = sent. */
async function sendLogin(deps: Deps, email: string): Promise<Result | null> {
  if (!(await deps.auth.ensureUser(email))) return { status: 502, body: { error: 'unavailable' } };
  const link = await deps.auth.magicLink(email);
  if (!link) return { status: 502, body: { error: 'unavailable' } };
  const mail = linkEmail(linkUrl(deps.origin, link));
  return (await deps.sendEmail(email, mail.subject, mail.html, mail.text)) ? null : { status: 502, body: { error: 'unavailable' } };
}

/** What an e-mail with the claim link says: `accessEmail` by default; #813 passes the approval one. */
export type LinkMail = (url: string, origin: string) => { subject: string; html: string; text: string };

/** The access e-mail to `email`, for a claim already recorded with `claimToken`'s hash. `null` = sent. */
export async function mailAccessLink(d: AccessLinkDeps, email: string, claimToken: string, build: LinkMail = accessEmail): Promise<Result | null> {
  if (!(await d.auth.ensureUser(email))) return { status: 502, body: { error: 'unavailable' } };
  const link = await d.auth.magicLink(email);
  if (!link) return { status: 502, body: { error: 'unavailable' } };
  const mail = build(linkUrl(d.origin, link, claimToken), d.origin);
  return (await d.sendEmail(email, mail.subject, mail.html, mail.text, ACCESS_FROM_NAME)) ? null : { status: 502, body: { error: 'unavailable' } };
}

export type AccessOutcome = { kind: 'sent' } | { kind: 'owned' } | { kind: 'failed'; result: Result };

/**
 * The server issues the access link of a settled submission (contract §7.3): a claim token drawn
 * here, `place_issue_claim` records its hash for the ACCEPTANCE e-mail (the caller never picks the
 * destination), then the e-mail. `owned` (`TGP10 draft_claimed`: it already has an owner, e.g. it
 * was sent signed in) is no error and sends nothing.
 */
export async function issueAccessLink(d: AccessLinkDeps, submissionId: string, build: LinkMail = accessEmail): Promise<AccessOutcome> {
  const claimToken = d.randomToken();
  if (!CLAIM_TOKEN.test(claimToken)) return { kind: 'failed', result: { status: 502, body: { error: 'unavailable' } } };
  const { data, error } = await d.issueClaim(submissionId, await d.sha256Hex(claimToken));
  if (error) return error.code === 'TGP10' && error.details === 'draft_claimed' ? { kind: 'owned' } : { kind: 'failed', result: rpcFailure(error) };
  const email = normalEmail(firstRow(data)?.email);
  if (!email) return { kind: 'failed', result: { status: 502, body: { error: 'unavailable' } } };
  const f = await mailAccessLink(d, email, claimToken, build);
  return f ? { kind: 'failed', result: f } : { kind: 'sent' };
}

const accessDeps = (deps: Deps): AccessLinkDeps => ({
  auth: deps.auth,
  sendEmail: deps.sendEmail,
  sha256Hex: deps.sha256Hex,
  randomToken: deps.randomToken,
  origin: deps.origin,
  issueClaim: (submissionId, claimSha256) => deps.rpc('place_issue_claim', { p_submission_id: submissionId, p_claim_sha256: claimSha256 }),
});

/**
 * One request of the Worker. `jwt` is the user's access token, only for `claim`.
 * Validation is shape only; the database is the judge of every rule.
 */
export async function handle(deps: Deps, raw: unknown, jwt: string): Promise<Result> {
  const b = obj(raw);
  if (!b) return bad('body');
  const action = b.action;
  const token = typeof b.token_sha256 === 'string' && HEX64.test(b.token_sha256) ? b.token_sha256 : null;
  const needsToken = action !== 'request_link' && action !== 'claim';
  if (needsToken && !token) return bad('token_sha256');

  switch (action) {
    case 'create': {
      const email = normalEmail(b.email);
      if (!email) return bad('email');
      if (!obj(b.answers)) return bad('answers');
      const r = await call(deps, 'portal_draft_create', { p_token_sha256: token, p_email: email, p_answers: b.answers });
      if (!r.ok) return r.result;
      const row = firstRow(r.data);
      return row ? { status: 200, body: { submission_id: row.submission_id, expires_at: row.expires_at } } : { status: 502, body: { error: 'unavailable' } };
    }
    case 'get': {
      const r = await call(deps, 'portal_draft_get', { p_token_sha256: token });
      if (!r.ok) return r.result;
      const row = firstRow(r.data);
      return row ? { status: 200, body: row } : { status: 404, body: { error: 'not_found' } };
    }
    case 'save': {
      if (!obj(b.answers)) return bad('answers');
      const email = b.email === undefined || b.email === null ? null : normalEmail(b.email);
      if (b.email !== undefined && b.email !== null && !email) return bad('email');
      const r = await call(deps, 'portal_draft_save', { p_token_sha256: token, p_answers: b.answers, p_email: email });
      if (!r.ok) return r.result;
      const row = firstRow(r.data);
      return row ? { status: 200, body: { updated_at: row.updated_at, expires_at: row.expires_at } } : { status: 502, body: { error: 'unavailable' } };
    }
    case 'consume_generation': {
      if (b.kind !== 'story_preview' && b.kind !== 'story_script') return bad('kind');
      const r = await call(deps, 'portal_draft_consume_generation', { p_token_sha256: token, p_kind: b.kind });
      if (!r.ok) return r.result;
      const row = firstRow(r.data);
      return row?.generation_id ? { status: 200, body: { generation_id: row.generation_id, used: row.used, remaining: row.remaining } } : { status: 502, body: { error: 'unavailable' } };
    }
    case 'terms': {
      const r = await call(deps, 'portal_draft_get_terms', { p_token_sha256: token });
      if (!r.ok) return r.result;
      const row = firstRow(r.data);
      // Zero rows = no `plan_choice` yet: an empty 200, not a 404 — the Worker clears the cookie on 404.
      return { status: 200, body: row ? { terms_version: row.terms_version, body_html: row.body_html, sha256: row.sha256, published_at: row.published_at } : {} };
    }
    case 'quote': {
      // The same row as `core.portal_quote` (BR-B2B-045); quoting never redeems the voucher.
      const period = b.billing_period;
      if (typeof period !== 'number' || !Number.isInteger(period) || period < 1 || period > 120) return bad('billing_period');
      const code = b.voucher_code === undefined || b.voucher_code === null ? null : b.voucher_code;
      if (code !== null && (typeof code !== 'string' || !VOUCHER.test(code))) return bad('voucher_code');
      const r = await call(deps, 'portal_draft_quote', { p_token_sha256: token, p_billing_period: period, p_voucher_code: code });
      if (!r.ok) return r.result;
      const row = firstRow(r.data);
      return row ? { status: 200, body: row } : { status: 502, body: { error: 'unavailable' } };
    }
    case 'photo_list': {
      const g = await call(deps, 'portal_draft_get', { p_token_sha256: token });
      if (!g.ok) return g.result;
      const sid = firstRow(g.data)?.submission_id;
      if (typeof sid !== 'string' || !UUID.test(sid)) return { status: 404, body: { error: 'not_found' } };
      const photos: { path: string; created_at: string }[] = [];
      for (const role of ['facade', 'gallery']) {
        for (const o of await deps.storage.list(`${sid}/${role}`)) {
          const path = `${sid}/${role}/${o.name}`;
          if (PHOTO_PATH.test(path)) photos.push({ path, created_at: o.created_at ?? '' });
        }
      }
      return { status: 200, body: { photos } };
    }
    case 'photo_sign': {
      const paths = Array.isArray(b.paths) ? b.paths : null;
      if (!paths || paths.length > 10 || !paths.every((p) => typeof p === 'string' && PHOTO_PATH.test(p))) return bad('paths');
      const allowed: string[] = [];
      for (const p of paths as string[]) {
        const r = await call(deps, 'portal_draft_photo_allowed', { p_token_sha256: token, p_name: p, p_action: 'read' });
        if (!r.ok) return r.result;
        if (r.data === true) allowed.push(p);
      }
      return { status: 200, body: { urls: allowed.length ? await deps.storage.sign(allowed) : {} } };
    }
    case 'photo_upload': {
      if (b.role !== 'facade' && b.role !== 'gallery') return bad('role');
      const bytes = typeof b.image_base64 === 'string' ? decodeBase64(b.image_base64) : null;
      if (!bytes || !isJpeg(bytes)) return bad('image');
      const g = await call(deps, 'portal_draft_get', { p_token_sha256: token });
      if (!g.ok) return g.result;
      const sid = firstRow(g.data)?.submission_id;
      if (typeof sid !== 'string' || !UUID.test(sid)) return { status: 404, body: { error: 'not_found' } };
      const path = `${sid}/${b.role}/${deps.uuid().toLowerCase()}.jpg`;
      const a = await call(deps, 'portal_draft_photo_allowed', { p_token_sha256: token, p_name: path, p_action: 'insert' });
      if (!a.ok) return a.result;
      // Same answer as the bucket's RLS refusal in the signed-in path (`classifyPhotoError` 403).
      if (a.data !== true) return { status: 403, body: { error: 'refused' } };
      if (!(await deps.storage.upload(path, bytes))) return { status: 502, body: { error: 'unavailable' } };
      const urls = await deps.storage.sign([path]).catch(() => ({}) as Record<string, string>);
      return { status: 200, body: { path, url: urls[path] ?? null } };
    }
    case 'photo_remove': {
      if (typeof b.path !== 'string' || !PHOTO_PATH.test(b.path)) return bad('path');
      const a = await call(deps, 'portal_draft_photo_allowed', { p_token_sha256: token, p_name: b.path, p_action: 'delete' });
      if (!a.ok) return a.result;
      if (a.data !== true) return { status: 403, body: { error: 'refused' } };
      return (await deps.storage.remove(b.path)) ? { status: 200, body: { ok: true } } : { status: 502, body: { error: 'unavailable' } };
    }
    case 'request_link': {
      const email = normalEmail(b.email);
      if (!email) return bad('email');
      if (b.purpose === 'login') {
        // §7: the owner who lost the access link (expired, other device) types the e-mail and gets
        // a NEW access link of the latest settled ownerless submission — the promise of the access
        // e-mail ("entre … com este e-mail, e mandamos outro"). None → a plain sign-in.
        const sid = await deps.submissions.settledOwnerless(email).catch(() => null);
        if (sid && UUID.test(sid)) {
          const o = await issueAccessLink(accessDeps(deps), sid);
          if (o.kind === 'sent') return { status: 200, body: { ok: true } };
          // TGP29 (5 links/h of this submission) answers like a sent link and sends nothing: a 429
          // only for an e-mail with an ownerless submission would tell anyone that it registered a
          // place (security review of #863). The address owner already has the links of this hour.
          if (o.kind === 'failed' && o.result.status === 429) return { status: 200, body: { ok: true } };
          if (o.kind === 'failed' && o.result.status !== 409) return o.result;
        }
        return (await sendLogin(deps, email)) ?? { status: 200, body: { ok: true } };
      }
      if (b.purpose !== 'access') return bad('purpose');
      // "Reenviar o link" of the cookie tab, only after the acceptance is settled (§7.4). The claim
      // exists BEFORE the e-mail; the database checks the e-mail is the submission's.
      if (!token) return bad('token_sha256');
      if (typeof b.claim_token !== 'string' || !CLAIM_TOKEN.test(b.claim_token)) return bad('claim_token');
      const c = await call(deps, 'portal_draft_request_claim', { p_token_sha256: token, p_claim_sha256: await deps.sha256Hex(b.claim_token), p_email: email });
      if (!c.ok) return c.result;
      return (await mailAccessLink(accessDeps(deps), email, b.claim_token)) ?? { status: 200, body: { ok: true, claim_expires_at: c.data } };
    }
    case 'submit': {
      // The clickwrap acceptance of the cookie's draft (§7.1, BR-B2B-047 item 3): the term marked
      // plus the e-mail of step 1. IP and user agent are the browser's, read by the Worker.
      const p = parseAccept(b.accept);
      if (!p) return bad('accept');
      const ip = b.ip === null || b.ip === undefined ? null : typeof b.ip === 'string' && IP.test(b.ip) ? b.ip : undefined;
      if (ip === undefined) return bad('ip');
      const ua = b.user_agent === null || b.user_agent === undefined ? null : typeof b.user_agent === 'string' && b.user_agent.length <= USER_AGENT_MAX ? b.user_agent : undefined;
      if (ua === undefined) return bad('user_agent');
      const r = await call(deps, 'portal_draft_submit', {
        p_token_sha256: token,
        p_terms_version: p.termsVersion,
        p_terms_sha256: p.termsSha256,
        p_ip: ip,
        p_user_agent: ua,
        p_activation_commitment: { sticker: p.sticker, display: p.display, social: p.social },
        p_marketing_consent: p.marketing,
      });
      if (!r.ok) return r.result;
      const row = firstRow(r.data);
      if (!row || typeof row.submission_id !== 'string' || !UUID.test(row.submission_id)) return { status: 502, body: { error: 'unavailable' } };
      // §8.8: the monthly fee comes from the database; no screen divides `total_cents` (BR-B2B-045, BR-B2B-046).
      const out = { submission_id: row.submission_id, status: row.status, acceptance_id: row.acceptance_id, total_cents: row.total_cents, committed_monthly_cents: row.committed_monthly_cents ?? null };
      // Paid plan with a total: the tab charges next, and the webhook sends the link (§7.3 b).
      if (row.status !== 'in_review') return { status: 200, body: out };
      // Free, or a 100% voucher: settled now, the link goes now. The acceptance stands either way:
      // a failed e-mail is `link: "failed"`, and the tab offers "Reenviar o link".
      const o = await issueAccessLink(accessDeps(deps), row.submission_id);
      return { status: 200, body: { ...out, link: o.kind === 'failed' ? 'failed' : 'sent' } };
    }
    case 'payment_state': {
      // What the cookie tab needs after the acceptance (§7.2): pay, or paid. No customer field leaves.
      const r = await call(deps, 'portal_draft_payment_checkout', { p_token_sha256: token });
      if (!r.ok) return r.result;
      const row = firstRow(r.data);
      if (!row || typeof row.submission_id !== 'string') return { status: 502, body: { error: 'unavailable' } };
      return {
        status: 200,
        body: { submission_id: row.submission_id, submission_status: row.submission_status, payment_status: row.status, amount_cents: row.next_amount_cents },
      };
    }
    case 'claim': {
      if (typeof b.claim_token !== 'string' || !CLAIM_TOKEN.test(b.claim_token)) return bad('claim_token');
      if (!jwt) return { status: 401, body: { error: 'relogin' } };
      const who = await deps.auth.claims(jwt);
      if (!who) return { status: 401, body: { error: 'relogin' } };
      const r = await call(deps, 'portal_draft_claim', { p_claim_sha256: await deps.sha256Hex(b.claim_token), p_user_id: who.sub, p_session_id: who.sessionId });
      if (!r.ok) return r.result;
      return typeof r.data === 'string' ? { status: 200, body: { submission_id: r.data } } : { status: 502, body: { error: 'unavailable' } };
    }
    default:
      return bad('action');
  }
}
