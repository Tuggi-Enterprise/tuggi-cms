/**
 * #1120: the author's push after a curator decided a version, `_shared/route-revision-push.ts` and
 * the `/route-revision` path of `firebase-push-notification`. BR-ROTA-006 item 3. Copy:
 * `docs/design/copy/diario-estado-erro-e-push-2026-11.md` §6; contract `docs/contracts/notificacoes.md` §17.
 *
 * The module gets a fake client (rows by table) and a fake `send`. The handler test proves the
 * path refuses a bad id before any read.
 */
import { assert, assertEquals } from './assert.ts';
import { loadHandler, request } from './harness.ts';
import { PUSH_KINDS } from '../_shared/push-gate.ts';
import {
  ROUTE_NAME_MAX,
  ROUTE_REVISION_PUSH_COPY,
  type RouteRevisionDb,
  type RouteRevisionDeps,
  type RouteRevisionQuery,
  routeNameForPush,
  runRouteRevisionPush,
} from '../_shared/route-revision-push.ts';

const REVISION = '11111111-2222-4333-8444-555555555555';
const OLDER = '66666666-2222-4333-8444-555555555555';
const ROUTE = '22222222-3333-4444-8555-666666666666';
const AUTHOR = '33333333-4444-4555-8666-777777777777';
const NAME_40 = 'Mirantes e praias escondidas de Búzios R';

type Answer = { data: unknown; error: { code?: string } | null };

interface Rows {
  revision: Record<string, unknown> | null;
  route: Record<string, unknown> | null;
  /** Other approved versions of the route. */
  approvedBefore: Array<{ id: string }>;
  language: unknown;
  /** A table whose read answers this error. */
  failing?: string;
}

function fakeDb(rows: Rows, reads: string[]): RouteRevisionDb {
  const query = (schema: string, table: string): RouteRevisionQuery => {
    const filters: Array<[string, string, unknown]> = [];
    const answer = (): Answer => {
      reads.push(`${schema}.${table} ${JSON.stringify(filters)}`);
      if (rows.failing === table) return { data: null, error: { code: '57014' } };
      if (table === 'custom_route_revisions') {
        const byId = filters.find(([op, col]) => op === 'eq' && col === 'id');
        return { data: byId ? rows.revision : rows.approvedBefore, error: null };
      }
      if (table === 'custom_routes') return { data: rows.route, error: null };
      if (table === 'profiles') return { data: { language: rows.language }, error: null };
      return { data: null, error: { code: 'unexpected' } };
    };
    const q: RouteRevisionQuery = {
      select: () => q,
      eq: (col, value) => (filters.push(['eq', col, value]), q),
      neq: (col, value) => (filters.push(['neq', col, value]), q),
      limit: () => q,
      maybeSingle: () => Promise.resolve(answer()),
      then: (ok, ko) => Promise.resolve(answer()).then(ok, ko),
    };
    return q;
  };
  return { schema: (schema) => ({ from: (table) => query(schema, table) }) };
}

function rowsOf(over: Partial<Rows> = {}): Rows {
  return {
    revision: { id: REVISION, route_id: ROUTE, state: 'approved', name: 'Orla de Búzios' },
    route: { id: ROUTE, owner_user_id: AUTHOR, live_revision_id: REVISION },
    approvedBefore: [],
    language: 'pt-BR',
    ...over,
  };
}

function gateAnswer(outcome: string, status = 200) {
  return { status, body: { success: true, gate: { [outcome]: 1 } } };
}

function run(rows: Rows, reply: () => Promise<{ status: number; body: unknown }> = async () => gateAnswer('sent')) {
  const sends: Array<Record<string, unknown>> = [];
  const logs: string[] = [];
  const reads: string[] = [];
  const deps: RouteRevisionDeps = {
    db: fakeDb(rows, reads),
    send: async (body) => {
      sends.push(body);
      return await reply();
    },
    log: (line) => logs.push(line),
  };
  return { deps, sends, logs, reads };
}

const notification = (body: Record<string, unknown>) =>
  body.notification as { title: string; body: string; data: Record<string, string> };

// ---- the copy: §6 ----

Deno.test('BR-ROTA-006 item 3, §6: four pieces in six languages, title up to 40 and body up to 110 with a 40-character name', () => {
  assertEquals(Object.keys(ROUTE_REVISION_PUSH_COPY).sort(), ['de', 'en', 'es', 'fr', 'it', 'pt']);
  assertEquals([...NAME_40].length, ROUTE_NAME_MAX);
  for (const [lang, pieces] of Object.entries(ROUTE_REVISION_PUSH_COPY)) {
    assertEquals(Object.keys(pieces).sort(), ['approved', 'approved_edit', 'rejected', 'rejected_edit'], lang);
    for (const [piece, copy] of Object.entries(pieces)) {
      const body = copy.body.replace('{{name}}', NAME_40);
      assert(copy.body.includes('{{name}}'), `${lang}.${piece} has the name`);
      assert(copy.title.length <= 40, `${lang}.${piece} title ${copy.title.length}`);
      assert(body.length <= 110, `${lang}.${piece} body ${body.length}`);
    }
  }
});

Deno.test('BR-ROTA-006 item 3: no dash, no "soon", no deadline in days or hours', () => {
  const soon = /em breve|soon|pronto|bientôt|presto|\bbald\b/i;
  const deadline = /\d|\b(dia|dias|day|days|día|días|jour|jours|giorno|giorni|Tag|Tagen|hora|horas|hour|hours|heure|heures|ora|ore|Stunde|Stunden)\b/i;
  for (const [lang, pieces] of Object.entries(ROUTE_REVISION_PUSH_COPY)) {
    for (const [piece, copy] of Object.entries(pieces)) {
      for (const s of [copy.title, copy.body]) {
        assert(!/[–—]/.test(s), `${lang}.${piece} dash: ${s}`);
        assert(!soon.test(s), `${lang}.${piece} soon: ${s}`);
        assert(!deadline.test(s), `${lang}.${piece} deadline: ${s}`);
      }
    }
  }
});

Deno.test('§6: the name is cut at 40 characters with the ellipsis, and a short one is kept', () => {
  assertEquals(routeNameForPush('  Orla  '), 'Orla');
  assertEquals(routeNameForPush(NAME_40), NAME_40);
  const long = routeNameForPush(`${NAME_40} e arredores`);
  // The space before the cut is trimmed, so a cut on a word break comes out one shorter.
  assertEquals(long, 'Mirantes e praias escondidas de Búzios…');
  assert([...long].length <= ROUTE_NAME_MAX, long);
  // An emoji at the cut is never split into half a surrogate pair.
  const emoji = routeNameForPush('🌊'.repeat(50));
  assertEquals([...emoji].length, ROUTE_NAME_MAX);
  assert(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(emoji), 'no lone surrogate');
});

Deno.test('BR-ROTA-006 item 3: the push kind is outside every cap and asks consent only', () => {
  assertEquals(PUSH_KINDS.route_revision, { requested: false, requiresActive: false, vacancyPriority: 4, outsideCaps: true });
});

// ---- who, what, where ----

Deno.test('BR-ROTA-006 item 3: an approved first version goes to the author, approved piece, opens the route', async () => {
  const { deps, sends } = run(rowsOf());
  assertEquals(await runRouteRevisionPush(deps, REVISION), 'sent');
  assertEquals(sends.length, 1);
  assertEquals(sends[0].type, 'user');
  assertEquals(sends[0].userIds, [AUTHOR]);
  assertEquals(sends[0].push_kind, 'route_revision');
  assert(!('localized' in sends[0]), 'the language of one person is already known');
  const n = notification(sends[0]);
  assertEquals(n.title, ROUTE_REVISION_PUSH_COPY.pt.approved.title);
  assertEquals(n.body, '“Orla de Búzios” já está no ar. Toque para ver e compartilhar o link.');
  assertEquals(n.data, { type: 'route_revision_approved', deeplink: `tuggi://route?id=${ROUTE}` });
});

Deno.test('BR-ROTA-006 items 3 and 10: an approved edit (another version approved before) reads approved_edit', async () => {
  const { deps, sends, reads } = run(rowsOf({ approvedBefore: [{ id: OLDER }], language: 'de-AT' }));
  assertEquals(await runRouteRevisionPush(deps, REVISION), 'sent');
  const n = notification(sends[0]);
  assertEquals(n.title, ROUTE_REVISION_PUSH_COPY.de.approved_edit.title);
  assertEquals(n.data.type, 'route_revision_approved');
  assert(reads.some((r) => r.includes('["neq","id","' + REVISION + '"]') && r.includes('["eq","state","approved"]')), reads.join('\n'));
});

Deno.test('BR-ROTA-006 item 3: a refused first version reads rejected, never the reason, and opens the author routes', async () => {
  const reason = 'Tire o telefone da anotação 3.';
  const { deps, sends } = run(rowsOf({
    revision: { id: REVISION, route_id: ROUTE, state: 'rejected', name: 'Orla', reason },
    route: { id: ROUTE, owner_user_id: AUTHOR, live_revision_id: null },
    language: 'fr',
  }));
  assertEquals(await runRouteRevisionPush(deps, REVISION), 'sent');
  assertEquals(sends[0].userIds, [AUTHOR]);
  const n = notification(sends[0]);
  assertEquals(n.title, ROUTE_REVISION_PUSH_COPY.fr.rejected.title);
  assertEquals(n.body, 'Ouvre « Orla » pour voir quoi changer et le renvoyer.');
  assertEquals(n.data, { type: 'route_revision_rejected', deeplink: `tuggi://my-routes?route_id=${ROUTE}` });
  assert(!JSON.stringify(sends[0]).includes(reason), 'the reason stays in the app');
});

Deno.test('BR-ROTA-006 items 3 and 10: a refused edit (a version on the air) reads rejected_edit; outside the six reads English', async () => {
  const { deps, sends } = run(rowsOf({
    revision: { id: REVISION, route_id: ROUTE, state: 'rejected', name: 'Orla' },
    route: { id: ROUTE, owner_user_id: AUTHOR, live_revision_id: OLDER },
    language: 'zh-CN',
  }));
  assertEquals(await runRouteRevisionPush(deps, REVISION), 'sent');
  assertEquals(notification(sends[0]).title, ROUTE_REVISION_PUSH_COPY.en.rejected_edit.title);
});

Deno.test('BR-ROTA-006 item 3: a pending, cancelled or unknown version, or a route without author, sends nothing', async () => {
  for (const state of ['pending', 'cancelled']) {
    const { deps, sends } = run(rowsOf({ revision: { id: REVISION, route_id: ROUTE, state, name: 'Orla' } }));
    assertEquals(await runRouteRevisionPush(deps, REVISION), 'not_decided');
    assertEquals(sends.length, 0);
  }
  const unknown = run(rowsOf({ revision: null }));
  assertEquals(await runRouteRevisionPush(unknown.deps, REVISION), 'not_found');
  const cms = run(rowsOf({ route: { id: ROUTE, owner_user_id: null, live_revision_id: null } }));
  assertEquals(await runRouteRevisionPush(cms.deps, REVISION), 'no_author');
  assertEquals(unknown.sends.length + cms.sends.length, 0);
});

Deno.test('BR-ROTA-006 item 3: a failed send or read is an outcome, never a throw, and the log has no id, name or text', async () => {
  const cases: Array<[() => Promise<{ status: number; body: unknown }>, string]> = [
    [() => Promise.reject(new TypeError('network')), 'failed'],
    [async () => ({ status: 500, body: { error: 'x' } }), 'failed'],
    [async () => gateAnswer('denied'), 'denied'],
    [async () => gateAnswer('not_delivered'), 'not_delivered'],
  ];
  for (const [reply, expected] of cases) {
    const { deps, logs } = run(rowsOf({ revision: { id: REVISION, route_id: ROUTE, state: 'approved', name: 'Orla secreta' } }), reply);
    assertEquals(await runRouteRevisionPush(deps, REVISION), expected);
    for (const line of logs) {
      assert(!line.includes(AUTHOR) && !line.includes(ROUTE) && !line.includes(REVISION) && !line.includes('Orla'), line);
    }
  }
  const broken = run(rowsOf({ failing: 'custom_routes' }));
  assertEquals(await runRouteRevisionPush(broken.deps, REVISION), 'read_failed');
  assertEquals(broken.sends.length, 0);
  // A failed language read still sends, in English.
  const noLang = run(rowsOf({ failing: 'profiles' }));
  assertEquals(await runRouteRevisionPush(noLang.deps, REVISION), 'sent');
  assertEquals(notification(noLang.sends[0]).title, ROUTE_REVISION_PUSH_COPY.en.approved.title);
});

Deno.test('firebase-push-notification /route-revision: an id that is not a uuid is 400 before any read', async () => {
  const handler = await loadHandler('firebase-push-notification');
  const req = request({ revisionId: 'nope' });
  const res = await handler(
    new Request('http://edge.test/firebase-push-notification/route-revision', {
      method: 'POST',
      headers: { authorization: 'Bearer test-service-role-key', 'content-type': 'application/json' },
      body: await req.text(),
    }),
  );
  assertEquals(res.status, 400);
  assertEquals(await res.json(), { error: 'invalid_revision_id' });
});
