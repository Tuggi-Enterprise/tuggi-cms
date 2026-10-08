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

import { portalMail, type AccessOutcome, type LinkMail, type RpcError } from './places-portal-draft.ts';

/** Who may get the link: every approved venue. The database refuses the ones it cannot mirror. */
export const LEGACY_ACCESS_FILTER = { client_type: 'venue', status: 'approved' } as const;
export const LEGACY_ACCESS_COLUMNS = 'id, name, monthly_fee_cents, is_courtesy';

export type LegacyAccessRow = { id: string; name?: string | null; monthly_fee_cents?: number | null; is_courtesy?: boolean | null };

/** Pays the legacy fee: a fee above zero and no courtesy (the same reading as `cms_place_description_facts`). */
export const isPayingLegacy = (r: LegacyAccessRow): boolean => (r.monthly_fee_cents ?? 0) > 0 && r.is_courtesy !== true;

/**
 * Resend accepts 10 requests per second per team (resend.com/docs/api-reference/rate-limit, 429
 * above it). The run is sequential and each e-mail comes after two Auth calls, so it is far below;
 * this pause keeps it below even if Auth answers instantly.
 */
export const SEND_SPACING_MS = 150;

/** One line of the place name: our database's, but still no control character and no runaway length. */
export function placeNameForMail(raw: unknown): string {
  const s = typeof raw === 'string' ? raw.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim() : '';
  return s.length > 120 ? `${s.slice(0, 119)}…` : s;
}

/**
 * The legacy access e-mail (spec of `design`, #916 §1). The place name goes in the body because it
 * comes from `core.clients`, typed by the operator, never by whoever asks for a link (the reason
 * `accessEmail` carries none). No name → "o seu local". Sender `ACCESS_FROM_NAME`, set by `mailAccessLink`. "1 hora" is `place_issue_claim` 1 h = GoTrue
 * `otp_expiry` 3600, as in `accessEmail`.
 */
export function legacyAccessEmail(url: string, origin: string, v: { placeName: string; paying: boolean }): { subject: string; html: string; text: string } {
  const host = new URL(origin).host;
  const name = placeNameForMail(v.placeName) || 'seu local';
  return portalMail({
    subject: 'Acesse o portal do seu local no Tuggi',
    preheader: 'Veja o seu plano e mude quando quiser.',
    paragraphs: [
      'Olá,',
      `o ${name} já está no app do Tuggi, e agora você acompanha a sua conta pelo portal de parceiros.`,
      v.paying
        ? 'Lá você vê o seu plano, o valor e o vencimento, e pode trocar de plano ou cancelar quando quiser, sem taxa de saída.'
        : 'Lá você vê o seu plano e pode adicionar a história em áudio do seu local quando quiser.',
    ],
    cta: { label: 'Entrar no portal', url },
    small: [
      `O botão vale por 1 hora e funciona uma vez. Depois disso, entre em ${host} com este e-mail, e mandamos outro.`,
      'Não reconhece este local? Escreva para suporte@tuggi.app.',
    ],
  });
}

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
