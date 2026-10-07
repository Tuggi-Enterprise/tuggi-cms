// _shared/places-transition-email.ts — the client's e-mails at the portal's transitions (#813,
// BR-B2B-049 item 10, BR-B2B-050 item 1): approval (kit ready), kit reminder, and "no ar".
//
// Pure: every side effect is in `TransitionDeps`, wired for Deno in
// `places-transition-email-runtime.ts`; the CMS tests load this file under Node.
//
// WHO SENDS WHAT, AND WHY EACH ONE GOES ONCE
//  · approval — `places-portal-notify`, called by the CMS route right after the operator's
//    `in_review → approved` (`app/api/admin/partnerships/validation/[submissionId]/route.ts`). The
//    transition happens once (TGP10 on a second one), so the e-mail does too.
//  · no ar — at the act (#906): the CMS publish route moves the submission `approved → live`
//    (actor `operator`) and then calls `places-portal-notify` with `live`. The daily sweep is the
//    net: an `approved` submission whose POI was published (`core.attractions.approved`) goes
//    `approved → live` (actor `system`) and THEN gets the e-mail. The state machine is the
//    once-guard on both paths; the sweep catches every other publish path, including the POI
//    screen, which writes from the browser.
//  · kit reminder — the daily sweep, `KIT_REMINDER_AFTER_MS` after the approval, only while still
//    `approved` (the "no ar" e-mail already reminds of the kit). Once-guard:
//    `partner.record_place_submission_notice`, recorded BEFORE sending — a lost reminder is better
//    than two.
//
// Recipient: always the acceptance e-mail (BR-B2B-049 item 10). No data of the submission in any of
// them — no trade name, CPF, CNPJ or amount: the e-mail was never confirmed (BR-B2B-043), the same
// rule as `accessEmail` (security review of #863).

import { ACCESS_FROM_NAME, issueAccessLink, portalMail, type AccessLinkDeps, type LinkMail, type RpcError } from './places-portal-draft.ts';

/** The stores of the app — the same URLs as `tuggi-enterprise/src/lib/app-meta.ts` (`APP_STORE_URL`, `PLAY_STORE_URL`). */
export const APP_STORE_URL = 'https://apps.apple.com/app/tuggi-drive/id6744379818';
export const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.tuggidrive.app';

/** One reminder, 3 days after the approval (market benchmark, #813). */
export const KIT_REMINDER_AFTER_MS = 3 * 24 * 3600 * 1000;
export const KIT_REMINDER = 'kit_reminder';

/** `partner.place_acceptances.plan_choice`. */
export type Plan = 'map_only' | 'map_and_description';

export type NoticeTarget = { submissionId: string; status: string; email: string | null; plan: Plan | null };

/** A submission in `approved`: its acceptance e-mail and plan, whether its POI is published, and when it was approved. */
export type ApprovedRow = { submissionId: string; email: string | null; plan: Plan | null; published: boolean; approvedAt: string | null };

export type TransitionDeps = AccessLinkDeps & {
  /** Status, acceptance e-mail and plan of one submission; `null` = no such submission. Throws on a read error. */
  target(submissionId: string): Promise<NoticeTarget | null>;
  /** Every submission in `approved`. Throws on a read error. */
  approvedRows(): Promise<ApprovedRow[]>;
  /** `partner.transition_place_submission(id, 'live', 'system')`. */
  goLive(submissionId: string): Promise<RpcError | null>;
  /** `partner.record_place_submission_notice(id, kind)`: `data === true` only the first time. */
  recordNotice(submissionId: string, kind: string): Promise<{ data: unknown; error: RpcError | null }>;
  /** Ids and codes only — never an e-mail. */
  alert(what: string, fields: Record<string, string | number | null | undefined>): Promise<void>;
  now(): Date;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const statusUrl = (origin: string): string => `${origin}/status`;

const STRANGER = 'Não reconhece este cadastro? Escreva para suporte@tuggi.app.';
const plainEntry = (origin: string) => `Para entrar no portal (${new URL(origin).host}), use este e-mail: o link de acesso chega aqui na hora.`;
const claimEntry = (origin: string) =>
  `O botão vale por 1 hora e funciona uma vez. Depois disso, entre em ${new URL(origin).host} com este e-mail, e mandamos outro.`;

/**
 * Approval: the kit is ready in the portal. `claim`: the URL carries the claim of an ownerless
 * submission (1 h, one use) — the small print says so; otherwise it is the plain `/status`.
 * Paid and free differ only in what comes next (BR-B2B-050 item 3: the free never promises a story).
 */
export function approvedEmail(plan: Plan | null, claim: boolean): LinkMail {
  return (url, origin) =>
    portalMail({
      subject: 'Seu local foi aprovado no Tuggi',
      preheader: 'O kit de ativação já está liberado no portal.',
      paragraphs: [
        'Olá,',
        'o cadastro do seu local foi aprovado. O kit de ativação já está liberado no portal: adesivo e display com o QR Code do seu local, para baixar e imprimir.',
        plan === 'map_and_description'
          ? 'Agora preparamos a história do seu local. Avisamos por este e-mail quando ela estiver no ar no app.'
          : 'Avisamos por este e-mail quando o seu local estiver no mapa do app.',
      ],
      cta: { label: 'Baixar o kit', url },
      small: [claim ? claimEntry(origin) : plainEntry(origin), STRANGER],
    });
}

/** "No ar": the place is in the app — print the kit, and get the app to see it. */
export function liveEmail(plan: Plan | null): LinkMail {
  const paid = plan === 'map_and_description';
  return (url, origin) =>
    portalMail({
      subject: paid ? 'A história do seu local está no ar no Tuggi' : 'Seu local está no mapa do Tuggi',
      preheader: 'Falta imprimir o kit com o QR Code do seu local.',
      paragraphs: [
        'Olá,',
        paid ? 'a história do seu local já está no ar no app do Tuggi.' : 'o seu local já aparece no mapa do app do Tuggi.',
        'Se ainda não imprimiu o kit, baixe no portal o adesivo e o display com o QR Code do seu local e coloque onde o cliente para: é por ele que o cliente chega ao app.',
        'Para ver o seu local no app, baixe o Tuggi:',
      ],
      cta: { label: 'Baixar o kit', url },
      links: [
        { label: 'Tuggi na App Store (iPhone)', url: APP_STORE_URL },
        { label: 'Tuggi no Google Play (Android)', url: PLAY_STORE_URL },
      ],
      small: [plainEntry(origin), STRANGER],
    });
}

/** The single kit reminder. */
export function kitReminderEmail(): LinkMail {
  return (url, origin) =>
    portalMail({
      subject: 'Já imprimiu o kit do seu local?',
      preheader: 'Adesivo e display com o QR Code do seu local.',
      paragraphs: [
        'Olá,',
        'o kit de ativação do seu local está esperando no portal: adesivo para a porta e display para o balcão, com o QR Code do seu local.',
        'Imprima e coloque onde o cliente para: é pelo QR que ele chega ao app do Tuggi.',
      ],
      cta: { label: 'Baixar o kit', url },
      small: [plainEntry(origin), STRANGER],
    });
}

export type NotifyEvent = 'approved' | 'live';

/** The body of `places-portal-notify`: `approved` (#813) or `live` (#906). */
export function parseNotify(body: unknown): { event: NotifyEvent; submissionId: string } | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const b = body as Record<string, unknown>;
  if (b.event !== 'approved' && b.event !== 'live') return null;
  if (typeof b.submission_id !== 'string' || !UUID.test(b.submission_id)) return null;
  return { event: b.event, submissionId: b.submission_id };
}

export type NotifyOutcome = 'sent' | 'not_found' | 'not_approved' | 'not_live' | 'failed';

/**
 * The approval e-mail. An ownerless submission (cookie flow, #863) gets the claim link — the only
 * way that session reaches `/status` for it; one with an owner (`owned`), or a claim that could not
 * be issued (quota, network), gets the plain `/status` link: the login there claims it (§7 of
 * `places-portal-rascunho.md`).
 */
export async function notifyApproved(d: TransitionDeps, submissionId: string): Promise<NotifyOutcome> {
  let t: NoticeTarget | null;
  try {
    t = await d.target(submissionId);
  } catch {
    return 'failed';
  }
  if (!t) return 'not_found';
  if (t.status !== 'approved') return 'not_approved';

  const viaClaim = await issueAccessLink(d, submissionId, approvedEmail(t.plan, true));
  if (viaClaim.kind === 'sent') return 'sent';
  if (!t.email) return 'failed';
  const mail = approvedEmail(t.plan, false)(statusUrl(d.origin), d.origin);
  return (await d.sendEmail(t.email, mail.subject, mail.html, mail.text, ACCESS_FROM_NAME)) ? 'sent' : 'failed';
}

async function send(d: TransitionDeps, to: string | null, build: LinkMail): Promise<boolean> {
  if (!to) return false;
  const mail = build(statusUrl(d.origin), d.origin);
  return d.sendEmail(to, mail.subject, mail.html, mail.text, ACCESS_FROM_NAME);
}

/**
 * The "no ar" e-mail at the act (#906): the CMS publish route calls this right after its own
 * `approved → live`. Only a submission in `live` gets it — the transition happens once, so the
 * e-mail does too, the same guard as `notifyApproved`.
 */
export async function notifyLive(d: TransitionDeps, submissionId: string): Promise<NotifyOutcome> {
  let t: NoticeTarget | null;
  try {
    t = await d.target(submissionId);
  } catch {
    return 'failed';
  }
  if (!t) return 'not_found';
  if (t.status !== 'live') return 'not_live';
  return (await send(d, t.email, liveEmail(t.plan))) ? 'sent' : 'failed';
}

/**
 * The sweep's part (#813): published → `live` + e-mail, then the kit reminder. Each runs even if
 * the other failed. `kit_reminder: 'not_migrated'` = `record_place_submission_notice` is not in
 * the database yet (PGRST202): nothing is sent, nothing alerts.
 */
export async function runTransitionEmails(d: TransitionDeps): Promise<Record<string, unknown>> {
  let rows: ApprovedRow[];
  try {
    rows = await d.approvedRows();
  } catch (e) {
    await d.alert('sweep_approved_read_failed', { error: e instanceof Error ? e.message.slice(0, 120) : 'unknown' });
    return { live: 'db_error', kit_reminder: 'db_error' };
  }

  let live = 0;
  for (const r of rows.filter((x) => x.published)) {
    const err = await d.goLive(r.submissionId);
    if (err) {
      // TGP10: someone moved it first — nothing to do.
      if (err.code !== 'TGP10') await d.alert('sweep_live_transition_failed', { submission_id: r.submissionId, code: err.code });
      continue;
    }
    live++;
    if (!(await send(d, r.email, liveEmail(r.plan)))) await d.alert('sweep_live_email_failed', { submission_id: r.submissionId });
  }

  const cutoff = d.now().getTime() - KIT_REMINDER_AFTER_MS;
  let reminded = 0;
  let notMigrated = false;
  for (const r of rows) {
    if (r.published || !r.approvedAt || Date.parse(r.approvedAt) > cutoff) continue;
    const rec = await d.recordNotice(r.submissionId, KIT_REMINDER);
    if (rec.error) {
      if (rec.error.code === 'PGRST202') {
        notMigrated = true;
        break;
      }
      await d.alert('sweep_kit_reminder_record_failed', { submission_id: r.submissionId, code: rec.error.code });
      continue;
    }
    if (rec.data !== true) continue;
    if (await send(d, r.email, kitReminderEmail())) reminded++;
    else await d.alert('sweep_kit_reminder_email_failed', { submission_id: r.submissionId });
  }
  return { live, kit_reminder: notMigrated ? 'not_migrated' : reminded };
}
