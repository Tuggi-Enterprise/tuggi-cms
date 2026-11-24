/**
 * #1007: the decision both producers share, `_shared/content-production-gate.ts`. The function tests
 * prove each `index.ts` returns it before spending; these prove every way the state read can fail
 * ends in the same refusal, and (#1021) that the guest is decided by his state, not by his account.
 */
import { assert, assertEquals } from './assert.ts';
import {
  createProductionRefusedResponse,
  decideContentProduction,
  type EntitlementReader,
} from '../_shared/content-production-gate.ts';

const TOURIST = { valid: true, userId: '22222222-2222-4222-8222-222222222222', isAnonymous: false };

function reader(answer: Awaited<ReturnType<EntitlementReader>>): EntitlementReader {
  return () => Promise.resolve(answer);
}

const mustNotRead: EntitlementReader = () => {
  throw new Error('get_entitlement must not be read here');
};

const GUEST = { valid: true, userId: '11111111-1111-4111-8111-111111111111', isAnonymous: true };

Deno.test('BR-CONTEUDO-003 item 1 (#1021): a guest in metered produces, a guest in free is refused as not_entitled', async () => {
  for (const [state, allowed] of [['metered', true], ['unlimited', true], ['free', false]] as const) {
    const asked: string[] = [];
    const decision = await decideContentProduction(GUEST, 'test', {
      readEntitlement: (userId) => {
        asked.push(userId);
        return Promise.resolve({ data: [{ state }], error: null });
      },
    });
    assertEquals([state, decision], [state, {
      allowed,
      source: 'app_user',
      state,
      ...(allowed ? {} : { refusal: 'not_entitled' }),
    }]);
    assertEquals(asked, [GUEST.userId]);
  }
});

Deno.test('BR-CONTEUDO-003 item 1 (#1021): a guest carrying an operator role is still read as a tourist', async () => {
  for (const role of ['admin', 'editor', 'service_role']) {
    const decision = await decideContentProduction({ ...GUEST, role }, 'test', {
      readEntitlement: reader({ data: [{ state: 'free' }], error: null }),
    });
    assertEquals([role, decision.allowed, decision.source, decision.refusal], [role, false, 'app_user', 'not_entitled']);
  }
});

Deno.test('BR-CONTEUDO-003 item 5 (#1021): a guest whose state cannot be read gets 503, never a pass', async () => {
  const decision = await decideContentProduction(GUEST, 'test', {
    readEntitlement: reader({ data: null, error: { code: '57014' } }),
  });
  assertEquals([decision.allowed, decision.refusal], [false, 'entitlement_unavailable']);
});

Deno.test('BR-CONTEUDO-003 item 5: every unresolved read refuses with entitlement_unavailable', async () => {
  const cases: Array<[string, EntitlementReader]> = [
    ['error', reader({ data: null, error: { code: '57014' } })],
    ['row without state', reader({ data: [{}], error: null })],
    ['empty array', reader({ data: [], error: null })],
    ['thrown', () => Promise.reject(new TypeError('network'))],
    ['timeout', () => new Promise(() => {})],
  ];
  for (const [label, readEntitlement] of cases) {
    const decision = await decideContentProduction(TOURIST, 'test', { readEntitlement, timeoutMs: 20 });
    assertEquals([label, decision.allowed, decision.state, decision.refusal], [
      label,
      false,
      'unresolved',
      'entitlement_unavailable',
    ]);
  }
});

Deno.test('BR-CONTEUDO-003 item 5: the timeout aborts the read it gave up on', async () => {
  let seen: AbortSignal | undefined;
  await decideContentProduction(TOURIST, 'test', {
    readEntitlement: (_id, signal) => {
      seen = signal;
      return new Promise(() => {});
    },
    timeoutMs: 10,
  });
  assert(seen?.aborted === true, 'signal was not aborted');
});

Deno.test('BR-CONTEUDO-003 item 5: missing env and a token without subject refuse instead of allowing', async () => {
  const savedUrl = Deno.env.get('SUPABASE_URL');
  Deno.env.delete('SUPABASE_URL');
  Deno.env.delete('PROJECT_URL');
  try {
    assertEquals((await decideContentProduction(TOURIST, 'test')).refusal, 'entitlement_unavailable');
  } finally {
    if (savedUrl) Deno.env.set('SUPABASE_URL', savedUrl);
  }
  const noSubject = await decideContentProduction({ valid: true }, 'test', { readEntitlement: mustNotRead });
  assertEquals(noSubject.refusal, 'entitlement_unavailable');
});

Deno.test('BR-CONTEUDO-003 item 1: permanent account, metered and unlimited produce, free is refused as not_entitled', async () => {
  for (const [state, allowed] of [['metered', true], ['unlimited', true], ['free', false]] as const) {
    const decision = await decideContentProduction(TOURIST, 'test', {
      readEntitlement: reader({ data: [{ state }], error: null }),
    });
    assertEquals([state, decision.allowed, decision.refusal], [state, allowed, allowed ? undefined : 'not_entitled']);
  }
});

Deno.test('BR-CONTEUDO-004 2.b: the platform and the CMS operator are out of scope and never read the state', async () => {
  for (const role of ['service_role', 'admin', 'editor']) {
    const decision = await decideContentProduction({ valid: true, userId: 'x', role }, 'test', {
      readEntitlement: mustNotRead,
    });
    assertEquals([role, decision.allowed, decision.state], [role, true, 'not_applicable']);
  }
});

Deno.test('BR-CONTEUDO-003 contract (#1021): the two refusals map to 503 and 403 not_entitled', async () => {
  const headers = { 'X-Test': '1' };
  const down = createProductionRefusedResponse(
    { allowed: false, source: 'app_user', state: 'unresolved', refusal: 'entitlement_unavailable' },
    headers,
  );
  const free = createProductionRefusedResponse(
    { allowed: false, source: 'app_user', state: 'free', refusal: 'not_entitled' },
    headers,
  );
  assertEquals([down.status, await down.json()], [503, { error: 'entitlement_unavailable', rule: 'BR-CONTEUDO-003' }]);
  assertEquals([free.status, await free.json()], [403, {
    error: 'content_production_not_entitled',
    rule: 'BR-CONTEUDO-003',
    state: 'free',
  }]);
  assertEquals(free.headers.get('content-type'), 'application/json');
  assertEquals(free.headers.get('x-test'), '1');
});
