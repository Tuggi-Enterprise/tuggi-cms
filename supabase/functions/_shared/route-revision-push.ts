/**
 * The push to the author when a curator decides a version of a user route: BR-ROTA-006 item 3
 * (#1120). Contract: `docs/contracts/notificacoes.md` §17.
 *
 * The decision is the database's (`core.approve_route_revision`, `core.reject_route_revision`) and
 * happens first, on the curator's session in the CMS route. Only after it answered success does the
 * CMS call `firebase-push-notification/route-revision` with the version id, and that path calls
 * `runRouteRevisionPush`. Everything the push says is read back from the rows, never taken from the
 * request: the state of the version, its name, the author, the author's language.
 *
 * A failed push does not undo the decision (item 3): this module reports an outcome and never
 * throws past the read of the rows, and the CMS route answers the curator the same either way.
 *
 * The refusal is generic: it never carries the curator's reason, which the author reads in the app.
 *
 * The Correio row is written with push on or off (#1123, `PUSH_KINDS.route_revision.inboxAlways`):
 * `send` writes it before the gate, once, and the push still needs the author's consent.
 *
 * Pure: no remote import and no `Deno` global, so `_tests/route-revision-push.test.ts` drives it.
 * Logs carry outcomes and error codes, never a user id, the route name or the reason.
 */
import { singleGateOutcome } from './push-gate.ts';
import { normalizeCopyLang, type RankingCopyLang } from './ranking-comm-i18n.ts';

/** `push_kind` of the gate (`PUSH_KINDS.route_revision`). */
export const ROUTE_REVISION_PUSH_KIND = 'route_revision';

/** `data.type`: the app names the opening by it, and `route_push_opened` (#1122) reads the same pair. */
export const ROUTE_REVISION_TYPE = {
  approved: 'route_revision_approved',
  rejected: 'route_revision_rejected',
} as const;

export type RouteRevisionPiece = 'approved' | 'approved_edit' | 'rejected' | 'rejected_edit';

/** The route name is cut to this many characters, `…` included, before it enters the body. */
export const ROUTE_NAME_MAX = 40;

/**
 * The four pieces in the six server languages.
 * Copy: docs/design/copy/diario-estado-erro-e-push-2026-11.md §6
 * In `fr` the space after `«` and before `»` is U+00A0.
 */
export const ROUTE_REVISION_PUSH_COPY: Readonly<
  Record<RankingCopyLang, Record<RouteRevisionPiece, { title: string; body: string }>>
> = {
  pt: {
    approved: {
      title: 'Seu roteiro foi aprovado',
      body: '“{{name}}” já está no ar. Toque para ver e compartilhar o link.',
    },
    approved_edit: {
      title: 'Sua edição foi aprovada',
      body: 'A nova versão de “{{name}}” já está no ar, com o mesmo link.',
    },
    rejected: {
      title: 'Seu roteiro precisa de ajustes',
      body: 'Abra “{{name}}” para ver o que mudar e enviar de novo.',
    },
    rejected_edit: {
      title: 'Sua edição precisa de ajustes',
      body: '“{{name}}” continua no ar como estava. Abra para ver o que mudar.',
    },
  },
  en: {
    approved: {
      title: 'Your itinerary was approved',
      body: '“{{name}}” is live now. Tap to see it and share the link.',
    },
    approved_edit: {
      title: 'Your edit was approved',
      body: 'The new version of “{{name}}” is live, with the same link.',
    },
    rejected: {
      title: 'Your itinerary needs changes',
      body: 'Open “{{name}}” to see what to change and send it again.',
    },
    rejected_edit: {
      title: 'Your edit needs changes',
      body: '“{{name}}” stays live as it was. Open it to see what to change.',
    },
  },
  es: {
    approved: {
      title: 'Tu itinerario fue aprobado',
      body: '“{{name}}” ya está publicado. Toca para verlo y compartir el enlace.',
    },
    approved_edit: {
      title: 'Tu edición fue aprobada',
      body: 'La nueva versión de “{{name}}” ya está publicada, con el mismo enlace.',
    },
    rejected: {
      title: 'Tu itinerario necesita cambios',
      body: 'Abre “{{name}}” para ver qué cambiar y enviarlo de nuevo.',
    },
    rejected_edit: {
      title: 'Tu edición necesita cambios',
      body: '“{{name}}” sigue publicado como estaba. Ábrelo para ver qué cambiar.',
    },
  },
  fr: {
    approved: {
      title: 'Ton itinéraire est validé',
      body: '«\u00a0{{name}}\u00a0» est en ligne. Touche pour le voir et partager le lien.',
    },
    approved_edit: {
      title: 'Ta modification est validée',
      body: 'La nouvelle version de «\u00a0{{name}}\u00a0» est en ligne, avec le même lien.',
    },
    rejected: {
      title: 'Ton itinéraire doit être modifié',
      body: 'Ouvre «\u00a0{{name}}\u00a0» pour voir quoi changer et le renvoyer.',
    },
    rejected_edit: {
      title: 'Ta modification doit être revue',
      body: '«\u00a0{{name}}\u00a0» reste en ligne. Ouvre l\'itinéraire pour voir quoi changer.',
    },
  },
  it: {
    approved: {
      title: 'Il tuo itinerario è stato approvato',
      body: '“{{name}}” è online. Tocca per vederlo e condividere il link.',
    },
    approved_edit: {
      title: 'La tua modifica è stata approvata',
      body: 'La nuova versione di “{{name}}” è online, con lo stesso link.',
    },
    rejected: {
      title: 'Il tuo itinerario va modificato',
      body: 'Apri “{{name}}” per vedere cosa cambiare e inviarlo di nuovo.',
    },
    rejected_edit: {
      title: 'La tua modifica va rivista',
      body: '“{{name}}” resta online com\'era. Aprilo per vedere cosa cambiare.',
    },
  },
  de: {
    approved: {
      title: 'Deine Route ist freigegeben',
      body: '„{{name}}“ ist jetzt online. Tippe, um sie anzusehen und den Link zu teilen.',
    },
    approved_edit: {
      title: 'Deine Änderung ist freigegeben',
      body: 'Die neue Version von „{{name}}“ ist online, mit demselben Link.',
    },
    rejected: {
      title: 'Deine Route braucht Änderungen',
      body: 'Öffne „{{name}}“, um zu sehen, was zu ändern ist, und schick sie erneut.',
    },
    rejected_edit: {
      title: 'Deine Änderung braucht Anpassungen',
      body: '„{{name}}“ bleibt wie bisher online. Öffne sie, um zu sehen, was fehlt.',
    },
  },
};

/** The name as the body shows it: trimmed, and cut at `ROUTE_NAME_MAX` with `…` when longer. */
export function routeNameForPush(name: unknown): string {
  const chars = [...String(name ?? '').trim()];
  if (chars.length <= ROUTE_NAME_MAX) return chars.join('');
  return `${chars.slice(0, ROUTE_NAME_MAX - 1).join('').trimEnd()}…`;
}

/**
 * Approved opens the route; rejected opens the author's routes, where the reason is. The app has no
 * `/my-routes` path yet: until it does, a tap on the rejected push lands in the Correio (contract §2).
 */
export function routeRevisionDeeplink(decision: 'approved' | 'rejected', routeId: string): string {
  const id = encodeURIComponent(routeId);
  return decision === 'approved' ? `tuggi://route?id=${id}` : `tuggi://my-routes?route_id=${id}`;
}

/** What the rows say about one decided version. */
export interface RouteRevisionFacts {
  decision: 'approved' | 'rejected';
  /** A version was already on the air before this one was decided. */
  edit: boolean;
  routeId: string;
  routeName: string;
  authorId: string;
  /** `drive.profiles.language` as stored. */
  language: unknown;
}

export function routeRevisionPiece(facts: Pick<RouteRevisionFacts, 'decision' | 'edit'>): RouteRevisionPiece {
  return facts.edit ? `${facts.decision}_edit` : facts.decision;
}

/** The one-person `/send` body, as `firstStorySendBody`. No `localized`: the language is known. */
export function routeRevisionSendBody(facts: RouteRevisionFacts): Record<string, unknown> {
  const copy = ROUTE_REVISION_PUSH_COPY[normalizeCopyLang(typeof facts.language === 'string' ? facts.language : null)][
    routeRevisionPiece(facts)
  ];
  return {
    type: 'user',
    userIds: [facts.authorId],
    push_kind: ROUTE_REVISION_PUSH_KIND,
    notification: {
      title: copy.title,
      body: copy.body.replace('{{name}}', routeNameForPush(facts.routeName)),
      data: { type: ROUTE_REVISION_TYPE[facts.decision], deeplink: routeRevisionDeeplink(facts.decision, facts.routeId) },
    },
    priority: 'high',
    // A phone switched off for the night still gets it in the morning.
    ttl: 86400,
  };
}

type Answer = { data: unknown; error: { code?: string } | null };

/** The slice of a supabase-js query builder this module uses. */
export interface RouteRevisionQuery extends PromiseLike<Answer> {
  select(columns: string): RouteRevisionQuery;
  eq(column: string, value: unknown): RouteRevisionQuery;
  neq(column: string, value: unknown): RouteRevisionQuery;
  limit(count: number): RouteRevisionQuery;
  maybeSingle(): PromiseLike<Answer>;
}

/** A supabase-js client holding the machine key: these rows are read past RLS. */
export interface RouteRevisionDb {
  schema(name: string): { from(table: string): RouteRevisionQuery };
}

export type RouteRevisionRead =
  | { ok: true; facts: RouteRevisionFacts }
  | { ok: false; reason: 'not_found' | 'not_decided' | 'no_author' | 'read_failed'; code?: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isRevisionId(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

/**
 * Edit or first: a rejected version is an edit when the route has a version on the air (a refusal
 * does not move it); an approved one is an edit when another version of the route was approved
 * before it, because the approval itself has just made this one the version on the air. A route
 * published again is another route (BR-ROTA-006 item 11), so its first approval reads first.
 */
export async function readRouteRevisionFacts(db: RouteRevisionDb, revisionId: string): Promise<RouteRevisionRead> {
  const core = (table: string) => db.schema('core').from(table);
  const failed = (error: { code?: string }): RouteRevisionRead => ({ ok: false, reason: 'read_failed', code: error.code ?? 'unknown' });

  const rev = await core('custom_route_revisions').select('id, route_id, state, name').eq('id', revisionId).maybeSingle();
  if (rev.error) return failed(rev.error);
  const revision = rev.data as { route_id?: string; state?: string; name?: string } | null;
  if (!revision?.route_id) return { ok: false, reason: 'not_found' };
  if (revision.state !== 'approved' && revision.state !== 'rejected') return { ok: false, reason: 'not_decided' };
  const decision = revision.state;

  const route = await core('custom_routes').select('id, owner_user_id, live_revision_id').eq('id', revision.route_id).maybeSingle();
  if (route.error) return failed(route.error);
  const routeRow = route.data as { owner_user_id?: string | null; live_revision_id?: string | null } | null;
  if (!routeRow) return { ok: false, reason: 'not_found' };
  if (!isRevisionId(routeRow.owner_user_id)) return { ok: false, reason: 'no_author' };

  let edit: boolean;
  if (decision === 'rejected') {
    edit = Boolean(routeRow.live_revision_id);
  } else {
    const before = await core('custom_route_revisions')
      .select('id').eq('route_id', revision.route_id).eq('state', 'approved').neq('id', revisionId).limit(1);
    if (before.error) return failed(before.error);
    edit = Array.isArray(before.data) && before.data.length > 0;
  }

  const profile = await db.schema('drive').from('profiles').select('language').eq('id', routeRow.owner_user_id).maybeSingle();
  // No language is English (BR-IDIOMA-001 item 3); a failed read is not a reason to lose the push.
  const language = profile.error ? null : (profile.data as { language?: unknown } | null)?.language ?? null;

  return {
    ok: true,
    facts: { decision, edit, routeId: revision.route_id, routeName: String(revision.name ?? ''), authorId: routeRow.owner_user_id, language },
  };
}

export type RouteRevisionOutcome =
  | 'sent'
  | 'denied'
  | 'not_delivered'
  | 'failed'
  | 'not_found'
  | 'not_decided'
  | 'no_author'
  | 'read_failed';

export interface RouteRevisionDeps {
  db: RouteRevisionDb;
  /** `createPushSender(...).send`, or a stand-in in the tests. */
  send: (body: Record<string, unknown>) => Promise<{ status: number; body: unknown }>;
  log: (line: string) => void;
}

/** Reads the decided version and sends the one push to its author. Never throws. */
export async function runRouteRevisionPush(deps: RouteRevisionDeps, revisionId: string): Promise<RouteRevisionOutcome> {
  let read: RouteRevisionRead;
  try {
    read = await readRouteRevisionFacts(deps.db, revisionId);
  } catch (error) {
    deps.log(`[route-revision-push] read threw: ${(error as Error)?.name ?? 'Error'}`);
    return 'read_failed';
  }
  if (!read.ok) {
    deps.log(`[route-revision-push] not sent: ${read.reason}${read.code ? ` code=${read.code}` : ''}`);
    return read.reason;
  }

  let outcome: RouteRevisionOutcome;
  try {
    const { status, body } = await deps.send(routeRevisionSendBody(read.facts));
    const gate = singleGateOutcome(body);
    if (status < 200 || status >= 300) outcome = 'failed';
    else if (gate === 'sent') outcome = 'sent';
    else if (gate === 'denied' || gate === 'inactive') outcome = 'denied';
    else if (gate === 'not_delivered') outcome = 'not_delivered';
    else outcome = 'failed';
    if (outcome === 'failed') deps.log(`[route-revision-push] send failed: status=${status} gate=${gate ?? 'none'}`);
  } catch (error) {
    deps.log(`[route-revision-push] send failed: ${(error as Error)?.name ?? 'Error'}`);
    outcome = 'failed';
  }
  deps.log(`[route-revision-push] ${read.facts.decision}${read.facts.edit ? '_edit' : ''}: ${outcome}`);
  return outcome;
}
