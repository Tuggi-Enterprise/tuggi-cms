// _shared/places-legacy-access.ts — the clients from before the portal get into `/status` (#916).
//
// Each legacy client (`core.clients` venue, approved) gets a mirror submission
// (`partner.place_seed_legacy_submission`: `live`, no acceptance, idempotent) and the access link of
// the portal (`issueAccessLink`, the claim of `places-portal-draft.ts`), in the e-mail written by
// `design` (#916 spec §1, two variants). Contract: `docs/contracts/places-portal-rascunho.md`
// (workspace), the legacy client section.
//
// Caller: `places-legacy-access/index.ts`, run by hand by the operator. Pure and import-free but the
// two pure siblings, so the CMS tests run it under Node.
//
// Rerun: the seed answers the submission it already made, a claimed submission is `owned` (nothing
// is sent), and an unclaimed one gets a new link (the database caps it at 5 an hour).
//
// Second action, `create_accounts` (#997): the mirrors still without an owner get their portal account
// now, with no e-mail and no link (`runLegacyAccounts`, below).

import { legacyAccessEmail, normalEmail, type AccessOutcome, type LinkMail, type RpcError } from './places-portal-draft.ts';

export { legacyAccessEmail };

/** Who may get the link: every approved venue. The database refuses the ones it cannot mirror. */
export const LEGACY_ACCESS_FILTER = { client_type: 'venue', status: 'approved' } as const;
export const LEGACY_ACCESS_COLUMNS = 'id, name, monthly_fee_cents, is_courtesy';

export type LegacyAccessRow = { id: string; name?: string | null; monthly_fee_cents?: number | null; is_courtesy?: boolean | null };

/** Pays the legacy fee: a fee above zero and no courtesy (the same reading as `cms_place_description_facts`). */
export const isPayingLegacy = (r: Pick<LegacyAccessRow, 'monthly_fee_cents' | 'is_courtesy'>): boolean => (r.monthly_fee_cents ?? 0) > 0 && r.is_courtesy !== true;

/**
 * Resend accepts 10 requests per second per team (resend.com/docs/api-reference/rate-limit, 429
 * above it). The run is sequential and each e-mail comes after two Auth calls, so it is far below;
 * this pause keeps it below even if Auth answers instantly.
 */
export const SEND_SPACING_MS = 150;

export type LegacyAccessStatus = 'would_send' | 'sent' | 'owned' | 'refused' | 'failed';

/** Ids, variant and codes only: no name, no e-mail. */
export type LegacyAccessOutcome = {
  client_id: string;
  variant: 'paying' | 'free';
  status: LegacyAccessStatus;
  submission_id?: string;
  /** The database's refusal or the failure: code and short detail, never a message. */
  code?: string;
  detail?: string;
};

export type LegacyAccessDeps = {
  /** `partner.place_seed_legacy_submission(p_client_id)`, service role. */
  seed: (clientId: string) => Promise<{ data: unknown; error: RpcError | null }>;
  /** `issueAccessLink(accessLinkDeps(), submissionId, build)`. */
  link: (submissionId: string, build: LinkMail) => Promise<AccessOutcome>;
  pause: (ms: number) => Promise<void>;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function seededId(data: unknown): string | null {
  const v = Array.isArray(data) ? data[0] : data;
  const id = typeof v === 'string' ? v : v && typeof v === 'object' ? Object.values(v as Record<string, unknown>)[0] : null;
  return typeof id === 'string' && UUID.test(id) ? id.toLowerCase() : null;
}

/** The whole run, one client at a time. A client that fails never stops the next one. */
export async function runLegacyAccess(deps: LegacyAccessDeps, rows: LegacyAccessRow[], dryRun: boolean): Promise<LegacyAccessOutcome[]> {
  const out: LegacyAccessOutcome[] = [];
  for (const row of rows) {
    const base = { client_id: row.id, variant: isPayingLegacy(row) ? ('paying' as const) : ('free' as const) };
    if (dryRun) {
      out.push({ ...base, status: 'would_send' });
      continue;
    }
    const seeded = await deps.seed(row.id);
    if (seeded.error) {
      // `TGP*` is the database refusing this client (no place, no e-mail, already in the portal…).
      const refused = /^TGP\d\d$/.test(seeded.error.code ?? '');
      out.push({ ...base, status: refused ? 'refused' : 'failed', code: seeded.error.code ?? 'unknown', ...(seeded.error.details ? { detail: String(seeded.error.details).slice(0, 64) } : {}) });
      continue;
    }
    const submissionId = seededId(seeded.data);
    if (!submissionId) {
      out.push({ ...base, status: 'failed', code: 'no_submission' });
      continue;
    }
    const placeName = row.name ?? '';
    const paying = base.variant === 'paying';
    const r = await deps.link(submissionId, (url, origin) => legacyAccessEmail(url, origin, { placeName, paying }));
    if (r.kind === 'failed') {
      const e = r.result.body;
      out.push({ ...base, submission_id: submissionId, status: 'failed', code: String(e.error ?? 'unavailable'), ...(e.detail ? { detail: String(e.detail).slice(0, 64) } : {}) });
    } else {
      out.push({ ...base, submission_id: submissionId, status: r.kind });
    }
    if (r.kind === 'sent') await deps.pause(SEND_SPACING_MS);
  }
  return out;
}

// ─── action `create_accounts`: the account of every mirror without an owner (#997) ──────────────

/**
 * Operator's decision, 2026-10-22: the legacy clients that never clicked the #916 link get their
 * portal account now, silently. The account only used to be born at the click, so without it the
 * client cannot sign in at the portal and the admin's "see as the partner" answers 409.
 *
 * For each mirror (`legacy_client_id` set) with no `account_id`: the Auth user of `contact_email`
 * (created confirmed and marked as portal, or the existing one), then
 * `partner.place_bind_legacy_account(p_submission_id, p_user_id) → account_id`, which is idempotent and
 * refuses with `TGP10` what is not a mirror, has another owner or whose user e-mail differs.
 * No e-mail is sent and no link is generated. Rerun: a bound mirror has `account_id` and is not read
 * again; a user created on a run whose bind failed is found and reused on the next one.
 */
export const LEGACY_ACCOUNT_COLUMNS = 'id, contact_email';

export type LegacyAccountRow = { id: string; contact_email?: string | null };

export type LegacyAccountStatus = 'would_bind' | 'created' | 'reused' | 'refused' | 'failed';

/** Ids and codes only: never the e-mail. */
export type LegacyAccountOutcome = {
  submission_id: string;
  status: LegacyAccountStatus;
  account_id?: string;
  code?: string;
  detail?: string;
};

/** What `auth.admin.createUser` answered: a new user, an e-mail already taken, or another error. */
export type PortalUser = { kind: 'created'; id: string | null } | { kind: 'exists' } | { kind: 'failed'; code: string };

/**
 * GoTrue's codes for an e-mail already registered (supabase.com/docs/guides/auth/debugging/error-codes,
 * conferred 2026-10-22). The 422 stays as the old `ensureUser` read it: GoTrue answered it for the
 * taken e-mail before the codes existed.
 */
export function portalUserOutcome(id: unknown, error: { code?: string; status?: number } | null): PortalUser {
  if (!error) return { kind: 'created', id: typeof id === 'string' && UUID.test(id) ? id.toLowerCase() : null };
  if (error.code === 'email_exists' || error.code === 'user_already_exists' || error.status === 422) return { kind: 'exists' };
  return { kind: 'failed', code: safeToken(error.code) ?? (error.status ? `http_${error.status}` : 'unknown') };
}

/** An existing Auth user, as much as the run needs: the id and whether the e-mail was confirmed. */
export type FoundUser = { id: string; confirmed: boolean };

/** One page of `auth.admin.listUsers({ page, perPage })`: the users, or the error code. */
export type ListUsersPage = (page: number, perPage: number) => Promise<{ users: { id?: unknown; email?: unknown; email_confirmed_at?: unknown }[] } | { error: string }>;

export const LIST_USERS_PER_PAGE = 1000;
/** A ceiling, never reached by the project today: a broken pagination must not spin until the timeout. */
export const LIST_USERS_MAX_PAGES = 500;

/**
 * Finds the existing user of an e-mail. supabase-js has no lookup by e-mail (`auth.admin` offers
 * `getUserById` and `listUsers({ page, perPage })` only, supabase.com/docs/reference/javascript/auth-admin-listusers,
 * conferred 2026-10-22), so the pages are read on demand and kept: the whole run reads the user list
 * at most once. Throws on a page error, which becomes that mirror's `failed`.
 */
export function userFinder(listPage: ListUsersPage): (email: string) => Promise<FoundUser | null> {
  const seen = new Map<string, FoundUser>();
  let next = 1;
  let done = false;
  return async (email) => {
    const want = email.toLowerCase();
    while (!seen.has(want) && !done) {
      if (next > LIST_USERS_MAX_PAGES) throw new Error('user_list_too_long');
      const r = await listPage(next, LIST_USERS_PER_PAGE);
      if ('error' in r) throw new Error('user_list');
      for (const u of r.users) {
        if (typeof u.email !== 'string' || typeof u.id !== 'string' || !UUID.test(u.id)) continue;
        seen.set(u.email.toLowerCase(), { id: u.id.toLowerCase(), confirmed: typeof u.email_confirmed_at === 'string' && u.email_confirmed_at !== '' });
      }
      next += 1;
      done = r.users.length < LIST_USERS_PER_PAGE;
    }
    return seen.get(want) ?? null;
  };
}

export type LegacyAccountDeps = {
  /** `auth.admin.createUser({ email, email_confirm: true, user_metadata: { signup_origin } })`. */
  createUser: (email: string) => Promise<PortalUser>;
  /** `userFinder(listUsers)`. */
  findUser: (email: string) => Promise<FoundUser | null>;
  /** `partner.place_bind_legacy_account(p_submission_id, p_user_id)`, service role. */
  bind: (submissionId: string, userId: string) => Promise<{ data: unknown; error: RpcError | null }>;
};

/** A database code or reason only when it is a bare token: never a message that could carry an e-mail. */
function safeToken(v: unknown): string | undefined {
  return typeof v === 'string' && /^[A-Za-z0-9_]{1,64}$/.test(v) ? v : undefined;
}

async function accountOf(deps: LegacyAccountDeps, row: LegacyAccountRow): Promise<LegacyAccountOutcome> {
  const base = { submission_id: row.id };
  const email = normalEmail(row.contact_email);
  if (!email) return { ...base, status: 'failed', code: 'no_email' };

  const made = await deps.createUser(email);
  if (made.kind === 'failed') return { ...base, status: 'failed', code: made.code };
  let userId: string | null;
  if (made.kind === 'created') {
    userId = made.id;
    if (!userId) return { ...base, status: 'failed', code: 'no_user' };
  } else {
    const found = await deps.findUser(email);
    if (!found) return { ...base, status: 'failed', code: 'user_not_found' };
    // Whoever signed up with this address without confirming it does not get the venue's account.
    if (!found.confirmed) return { ...base, status: 'refused', code: 'user_unconfirmed' };
    userId = found.id;
  }

  const bound = await deps.bind(row.id, userId);
  if (bound.error) {
    const code = bound.error.code ?? 'unknown';
    const detail = safeToken(bound.error.details);
    return { ...base, status: /^TGP\d\d$/.test(code) ? 'refused' : 'failed', code, ...(detail ? { detail } : {}) };
  }
  const accountId = seededId(bound.data);
  if (!accountId) return { ...base, status: 'failed', code: 'no_account' };
  return { ...base, status: made.kind === 'created' ? 'created' : 'reused', account_id: accountId };
}

/** The whole run, one mirror at a time. A mirror that fails, even by throwing, never stops the next. */
export async function runLegacyAccounts(deps: LegacyAccountDeps, rows: LegacyAccountRow[], dryRun: boolean): Promise<LegacyAccountOutcome[]> {
  const out: LegacyAccountOutcome[] = [];
  for (const row of rows) {
    if (dryRun) {
      out.push({ submission_id: row.id, status: 'would_bind' });
      continue;
    }
    try {
      out.push(await accountOf(deps, row));
    } catch (e) {
      out.push({ submission_id: row.id, status: 'failed', code: safeToken(e instanceof Error ? e.message : '') ?? 'unexpected' });
    }
  }
  return out;
}
