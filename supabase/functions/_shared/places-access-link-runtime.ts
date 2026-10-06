// _shared/places-access-link-runtime.ts — the Deno wiring of the access link (#863, §7.3 of
// `places-portal-rascunho.md`): Auth admin, Resend and the two service-role reads of
// `partner.place_submissions`. Two functions issue the link: `places-portal-draft` (`submit` in
// `in_review`, `request_link`) and `places-payment-webhook` (first charge confirmed). The logic is
// `issueAccessLink` in `places-portal-draft.ts`, which the CMS tests load under Node.

import { createAdminClient } from './supabase-client.ts';
import { PORTAL_ORIGIN_ENV, PORTAL_SIGNUP_ORIGIN, portalOrigin, type AccessLinkDeps, type Deps } from './places-portal-draft.ts';

const RESEND_URL = 'https://api.resend.com/emails';

type Admin = ReturnType<typeof createAdminClient>;

/** `RESEND_FROM` with another display name: `"Tuggi <news@tuggi.app>"` + `"Tuggi Locais"` → `"Tuggi Locais <news@tuggi.app>"`. */
export function fromWithName(from: string, name?: string): string {
  if (!name) return from;
  const address = /<([^>]+)>/.exec(from)?.[1] ?? from.trim();
  return `${name} <${address}>`;
}

export async function sendEmail(to: string, subject: string, html: string, text: string, fromName?: string): Promise<boolean> {
  const key = (Deno.env.get('RESEND_API_KEY') ?? '').trim();
  if (!key) return false;
  try {
    const res = await fetch(RESEND_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: fromWithName((Deno.env.get('RESEND_FROM') ?? 'Tuggi <news@tuggi.app>').trim(), fromName), to: [to], subject, html, text }),
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** 32 random bytes, base64url without padding: 43 chars. */
export function randomToken(): string {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function authAdmin(admin: Admin): Pick<Deps['auth'], 'ensureUser' | 'magicLink'> {
  return {
    async ensureUser(email) {
      const { error } = await admin.auth.admin.createUser({ email, email_confirm: true, user_metadata: { signup_origin: PORTAL_SIGNUP_ORIGIN } });
      return !error || error.code === 'email_exists' || error.status === 422;
    },
    async magicLink(email) {
      const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
      const p = data?.properties;
      return !error && p?.hashed_token ? { tokenHash: p.hashed_token, type: p.verification_type || 'magiclink' } : null;
    },
  };
}

export function submissionReads(admin: Admin): Deps['submissions'] {
  const table = () => admin.schema('partner').from('place_submissions');
  return {
    async tradeName(submissionId) {
      const { data, error } = await table().select('trade_name:answers->>trade_name').eq('id', submissionId).maybeSingle();
      if (error) throw new Error(`submission read ${error.code}`);
      return typeof data?.trade_name === 'string' ? data.trade_name : null;
    },
    async settledOwnerless(email) {
      // `contact_email` is stored lower-cased (`place_clean_email`); partial index
      // `place_submissions_anonymous_contact_email_idx` (account_id IS NULL).
      const { data, error } = await table()
        .select('id')
        .eq('contact_email', email)
        .is('account_id', null)
        .not('status', 'in', '(draft,awaiting_payment)')
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(`submission read ${error.code}`);
      return typeof data?.id === 'string' ? data.id : null;
    },
  };
}

/** Everything `issueAccessLink` needs, on the service role. */
export function accessLinkDeps(admin: Admin = createAdminClient()): AccessLinkDeps {
  return {
    auth: authAdmin(admin),
    sendEmail,
    sha256Hex,
    randomToken,
    origin: portalOrigin(Deno.env.get(PORTAL_ORIGIN_ENV)),
    issueClaim: async (submissionId, claimSha256) => {
      try {
        const { data, error } = await admin.schema('partner').rpc('place_issue_claim', { p_submission_id: submissionId, p_claim_sha256: claimSha256 });
        return { data, error: error ? { code: error.code, details: error.details, message: error.message } : null };
      } catch {
        return { data: null, error: { code: 'network' } };
      }
    },
    tradeName: (id) => submissionReads(admin).tradeName(id),
  };
}
