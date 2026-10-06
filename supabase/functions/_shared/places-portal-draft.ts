// _shared/places-portal-draft.ts — the logic of the Edge Function `places-portal-draft` (#863).
//
// The anonymous draft of the Portal Locais (`tuggi-places`) and the e-mail link that signs in
// and claims it. Contract: `docs/contracts/places-portal-rascunho.md` (workspace). Rules:
// BR-B2B-043 item 1 and edge cases, BR-B2B-047, BR-B2B-049 items 3 and 10.
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
export const DEFAULT_PORTAL_ORIGIN = 'https://places.tuggi.app';
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
  sendEmail(to: string, subject: string, html: string, text: string): Promise<boolean>;
  sha256Hex(s: string): Promise<string>;
  uuid(): string;
  origin: string;
};

export type Result = { status: number; body: Record<string, unknown> };

const HEX64 = /^[0-9a-f]{64}$/;
const CLAIM_TOKEN = /^[A-Za-z0-9_-]{43}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TERMS_VERSION = /^[a-z0-9][a-z0-9._-]{0,63}$/i;
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

const bit = (b: boolean) => (b ? '1' : '0');

/**
 * The link of the e-mail. NO HREF COMES FROM THE BODY (`send-transactional` lesson): the origin
 * is ours, every value is checked against its shape above, and the parameter names are the
 * contract `tuggi-places` `parseEmailLink` reads (`places-portal-rascunho.md` §3).
 */
export function linkUrl(
  origin: string,
  link: { tokenHash: string; type: string },
  accept?: { claimToken?: string; submissionId?: string; params: AcceptParams },
): string {
  const q = new URLSearchParams({ th: link.tokenHash, tt: link.type });
  if (accept) {
    if (accept.claimToken) q.set('c', accept.claimToken);
    if (accept.submissionId) q.set('s', accept.submissionId);
    const p = accept.params;
    q.set('tv', p.termsVersion);
    q.set('ts', p.termsSha256);
    q.set('ac', bit(p.sticker) + bit(p.display) + bit(p.social));
    q.set('mk', bit(p.marketing));
  }
  return `${origin}/entrar?${q.toString()}`;
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The two e-mails. Fixed text, no value from the body except the URL built above. */
export function linkEmail(purpose: 'login' | 'accept', url: string): { subject: string; html: string; text: string } {
  const t =
    purpose === 'accept'
      ? {
          subject: 'Tuggi: confirme o e-mail e assine o aceite do seu local',
          lead: 'Você está cadastrando o seu local no Tuggi. Toque no botão para confirmar o seu e-mail: esse toque assina o termo de parceria com a Tuggi.',
          cta: 'Confirmar e assinar',
        }
      : {
          subject: 'Tuggi: seu link para entrar e acompanhar o cadastro',
          lead: 'Você pediu para entrar no cadastro do seu local no Tuggi. Toque no botão para entrar e acompanhar.',
          cta: 'Entrar',
        };
  const help = 'O link vale por 1 hora e só funciona uma vez. Se você pediu mais de um, use o do e-mail mais recente. Se não foi você, ignore este e-mail: sem o toque, nada acontece. Dúvidas: suporte@tuggi.app.';
  const html = [
    '<!doctype html><html lang="pt-BR"><body style="margin:0;padding:24px;background:#F7F9FA;font-family:Arial,sans-serif;color:#1A1A1A">',
    '<div style="max-width:480px;margin:0 auto;background:#fff;border-radius:16px;padding:32px">',
    `<p style="font-size:16px;line-height:1.5;margin:0 0 24px">${escapeHtml(t.lead)}</p>`,
    `<p style="margin:0 0 24px"><a href="${escapeHtml(url)}" style="display:inline-block;background:#FF6F00;color:#fff;text-decoration:none;font-weight:bold;padding:14px 24px;border-radius:10px">${escapeHtml(t.cta)}</a></p>`,
    `<p style="font-size:13px;line-height:1.5;color:#6B7280;margin:0">${escapeHtml(help)}</p>`,
    '</div></body></html>',
  ].join('');
  return { subject: t.subject, html, text: `${t.lead}\n\n${url}\n\n${help}` };
}

/** Database error → Worker answer. Codes only: no message (PII) leaves. */
export function rpcFailure(e: RpcError): Result {
  const d = typeof e.details === 'string' && e.details ? e.details.slice(0, 64) : undefined;
  switch (e.code) {
    case 'TGP01':
      return { status: 404, body: { error: 'not_found' } };
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

async function sendLink(deps: Deps, purpose: 'login' | 'accept', email: string, accept?: Parameters<typeof linkUrl>[2]): Promise<Result | null> {
  if (!(await deps.auth.ensureUser(email))) return { status: 502, body: { error: 'unavailable' } };
  const link = await deps.auth.magicLink(email);
  if (!link) return { status: 502, body: { error: 'unavailable' } };
  const mail = linkEmail(purpose, linkUrl(deps.origin, link, accept));
  if (!(await deps.sendEmail(email, mail.subject, mail.html, mail.text))) return { status: 502, body: { error: 'unavailable' } };
  return null;
}

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
      if (b.purpose === 'login') return (await sendLink(deps, 'login', email)) ?? { status: 200, body: { ok: true } };
      if (b.purpose !== 'accept') return bad('purpose');
      const params = parseAccept(b.accept);
      if (!params) return bad('accept');
      // Signed-in owner (draft already in an account): no claim, the link only signs in and accepts.
      if (b.token_sha256 === undefined && typeof b.submission_id === 'string' && UUID.test(b.submission_id)) {
        return (await sendLink(deps, 'accept', email, { submissionId: b.submission_id, params })) ?? { status: 200, body: { ok: true } };
      }
      if (!token) return bad('token_sha256');
      if (typeof b.claim_token !== 'string' || !CLAIM_TOKEN.test(b.claim_token)) return bad('claim_token');
      // The claim exists BEFORE the e-mail: a link that arrives always has a claim to redeem.
      const c = await call(deps, 'portal_draft_request_claim', { p_token_sha256: token, p_claim_sha256: await deps.sha256Hex(b.claim_token), p_email: email });
      if (!c.ok) return c.result;
      return (await sendLink(deps, 'accept', email, { claimToken: b.claim_token, params })) ?? { status: 200, body: { ok: true, claim_expires_at: c.data } };
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
