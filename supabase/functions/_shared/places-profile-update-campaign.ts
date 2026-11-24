// _shared/places-profile-update-campaign.ts — the e-mail that calls the partners to complete their
// place in the portal (#931). Same recipients as `places-legacy-access` (approved venues of
// `core.clients`), same layout (`portalMail`), same access link (`issueAccessLink`).
//
// Caller: `places-profile-update-campaign/index.ts`, run by hand by the operator. Pure and import-free
// but the pure siblings, so the CMS tests run it under Node.
//
// Three modes: `dry_run` (default) lists who would get it; `test` sends ONE e-mail to a `@tuggi.app`
// address with a real place name and the plain sign-in URL (no claim, nobody's account is touched);
// `send` mails every client, once: `partner.record_place_submission_notice` with
// `PROFILE_UPDATE_NOTICE_KIND` is recorded before the e-mail, and a second run skips the recorded ones.

import { ACCESS_FROM_NAME, issueAccessLink, normalEmail, placeNameForMail, portalMail, type AccessLinkDeps, type RpcError } from './places-portal-draft.ts';
import { isPayingLegacy, SEND_SPACING_MS } from './places-legacy-access.ts';

export { LEGACY_ACCESS_FILTER as CAMPAIGN_FILTER } from './places-legacy-access.ts';
export const CAMPAIGN_COLUMNS = 'id, name, email, monthly_fee_cents, is_courtesy';

/** `partner.place_submission_notices.kind` of this campaign: the database must accept it before a real run. */
export const PROFILE_UPDATE_NOTICE_KIND = 'profile_update_campaign';

/** Only our own mailbox may get the test (the operator's order, #931). */
export const TEST_DOMAIN = '@tuggi.app';

export type CampaignRow = { id: string; name?: string | null; email?: string | null; monthly_fee_cents?: number | null; is_courtesy?: boolean | null };
export type Mail = { subject: string; html: string; text: string };

/** The text approved by the operator (#931), word for word. No name → "o seu local". */
export function profileUpdateEmail(url: string, origin: string, placeName: string): Mail {
  const host = new URL(origin).host;
  const name = placeNameForMail(placeName) || 'o seu local';
  return portalMail({
    subject: 'Novidade para parceiros Tuggi',
    preheader: 'Agora você pode deixar o seu local mais completo.',
    paragraphs: [
      'Olá,',
      `Temos uma novidade: agora, como parceiro Tuggi, você pode atualizar os dados de ${name} com fotos, prato principal, horário de funcionamento e outras opções.`,
      'Para conferir tudo o que dá para mudar, é só entrar no painel.',
    ],
    cta: { label: 'Atualizar meu local', url },
    small: [`Se o botão não abrir, entre em ${host} com este e-mail.`],
  });
}

/** The portal's sign-in page: the button of the test and of a client that already has an account. */
export const signInUrl = (origin: string): string => new URL('/entrar', origin).href;

export type CampaignMode = { mode: 'dry_run' } | { mode: 'test'; to: string } | { mode: 'send' };

/**
 * The body. `test_to` wins over `dry_run` and must be a `@tuggi.app` address, or the call is refused:
 * a bad `test_to` never falls through to the real run. Only `dry_run: false` sends for real.
 */
export function parseCampaignBody(raw: unknown): CampaignMode | { error: 'invalid'; field: 'test_to' } {
  const b = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  if (b.test_to !== undefined) {
    const to = normalEmail(b.test_to);
    return to && to.endsWith(TEST_DOMAIN) ? { mode: 'test', to } : { error: 'invalid', field: 'test_to' };
  }
  return b.dry_run === false ? { mode: 'send' } : { mode: 'dry_run' };
}

export type Plan = 'paying' | 'free';
const planOf = (r: CampaignRow): Plan => (isPayingLegacy(r) ? 'paying' : 'free');

/** Who would get it: the operator's own call, so name and e-mail go in the answer (never in the log). */
export function campaignAudience(rows: CampaignRow[]): { counts: Record<Plan, number>; recipients: { client_id: string; place: string; email: string | null; plan: Plan }[] } {
  const counts: Record<Plan, number> = { paying: 0, free: 0 };
  const recipients = rows.map((r) => {
    const plan = planOf(r);
    counts[plan] += 1;
    return { client_id: r.id, place: placeNameForMail(r.name), email: normalEmail(r.email), plan };
  });
  return { counts, recipients };
}

/** The test: the first client with a name lends it; the button is the plain sign-in URL. */
export function testMail(rows: CampaignRow[], origin: string): { clientId: string | null; mail: Mail } {
  const row = rows.find((r) => placeNameForMail(r.name)) ?? null;
  return { clientId: row?.id ?? null, mail: profileUpdateEmail(signInUrl(origin), origin, row?.name ?? '') };
}

export type CampaignStatus = 'sent' | 'already_sent' | 'refused' | 'failed';
/** Ids, plan and codes only: no name, no e-mail. */
export type CampaignOutcome = { client_id: string; plan: Plan; status: CampaignStatus; submission_id?: string; code?: string; detail?: string };

export type CampaignDeps = {
  links: AccessLinkDeps;
  /** `partner.place_seed_legacy_submission(p_client_id)`: the mirror submission, idempotent. */
  seed: (clientId: string) => Promise<{ data: unknown; error: RpcError | null }>;
  /** `partner.record_place_submission_notice(p_submission_id, p_kind)`: true only the first time. */
  recordNotice: (submissionId: string, kind: string) => Promise<{ data: unknown; error: RpcError | null }>;
  pause: (ms: number) => Promise<void>;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const firstScalar = (data: unknown): unknown => {
  const v = Array.isArray(data) ? data[0] : data;
  return v && typeof v === 'object' ? Object.values(v as Record<string, unknown>)[0] : v;
};
const codeOf = (e: RpcError) => ({ code: e.code ?? 'unknown', ...(e.details ? { detail: String(e.details).slice(0, 64) } : {}) });

/**
 * The real run, one client at a time; a client that fails never stops the next. The notice is
 * recorded BEFORE the e-mail: a crash between the two costs one e-mail, never two (the precedent of
 * the kit reminder, #813). A client that already owns the submission gets the sign-in URL instead
 * of a claim link (`issueAccessLink` answers `owned` and sends nothing).
 */
export async function runCampaign(deps: CampaignDeps, rows: CampaignRow[]): Promise<CampaignOutcome[]> {
  const out: CampaignOutcome[] = [];
  for (const row of rows) {
    const base = { client_id: row.id, plan: planOf(row) };
    const seeded = await deps.seed(row.id);
    if (seeded.error) {
      out.push({ ...base, status: /^TGP\d\d$/.test(seeded.error.code ?? '') ? 'refused' : 'failed', ...codeOf(seeded.error) });
      continue;
    }
    const sid = firstScalar(seeded.data);
    if (typeof sid !== 'string' || !UUID.test(sid)) {
      out.push({ ...base, status: 'failed', code: 'no_submission' });
      continue;
    }
    const submission_id = sid.toLowerCase();
    const noticed = await deps.recordNotice(submission_id, PROFILE_UPDATE_NOTICE_KIND);
    if (noticed.error) {
      out.push({ ...base, submission_id, status: 'failed', ...codeOf(noticed.error) });
      continue;
    }
    if (firstScalar(noticed.data) !== true) {
      out.push({ ...base, submission_id, status: 'already_sent' });
      continue;
    }
    const name = row.name ?? '';
    const r = await issueAccessLink(deps.links, submission_id, (url, origin) => profileUpdateEmail(url, origin, name));
    let ok = r.kind === 'sent';
    let code: string | undefined = r.kind === 'failed' ? String(r.result.body.error ?? 'unavailable') : undefined;
    if (r.kind === 'owned') {
      const to = normalEmail(row.email);
      const m = profileUpdateEmail(signInUrl(deps.links.origin), deps.links.origin, name);
      ok = !!to && (await deps.links.sendEmail(to, m.subject, m.html, m.text, ACCESS_FROM_NAME));
      code = ok ? undefined : to ? 'unavailable' : 'email';
    }
    out.push({ ...base, submission_id, status: ok ? 'sent' : 'failed', ...(code ? { code } : {}) });
    if (ok) await deps.pause(SEND_SPACING_MS);
  }
  return out;
}
