/**
 * #1007: the decision both producers share, `_shared/content-production-gate.ts`. The function tests
 * prove each `index.ts` returns it before spending; these prove every way the state read can fail
 * ends in the same refusal, and that the guest is refused before anything is read.
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

Deno.test('BR-USUARIO-037 4.i: a guest is refused with account_required even carrying an operator role', async () => {
  for (const role of [undefined, 'admin', 'service_role']) {
    const decision = await decideContentProduction(
      { valid: true, userId: 'guest', isAnonymous: true, role },
      'test',
      { readEntitlement: mustNotRead },
    );
    assertEquals(decision, { allowed: false, source: decision.source, state: 'guest', refusal: 'account_required' });
  }
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

Deno.test('BR-CONTEUDO-003 item 1: metered and unlimited produce, free is refused as not_entitled', async () => {
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

Deno.test('#1007 contract: the three refusals map to 403 account_required, 503 and 403 not_entitled', async () => {
  const headers = { 'X-Test': '1' };
  const guest = createProductionRefusedResponse(
    { allowed: false, source: 'app_user', state: 'guest', refusal: 'account_required' },
    headers,
  );
  const down = createProductionRefusedResponse(
    { allowed: false, source: 'app_user', state: 'unresolved', refusal: 'entitlement_unavailable' },
    headers,
  );
  const free = createProductionRefusedResponse(
    { allowed: false, source: 'app_user', state: 'free', refusal: 'not_entitled' },
    headers,
  );
  assertEquals([guest.status, await guest.json()], [403, { error: 'account_required', rule: 'BR-USUARIO-037' }]);
  assertEquals([down.status, await down.json()], [503, { error: 'entitlement_unavailable', rule: 'BR-CONTEUDO-003' }]);
  assertEquals([free.status, await free.json()], [403, {
    error: 'content_production_not_entitled',
    rule: 'BR-CONTEUDO-003',
    state: 'free',
  }]);
  assertEquals(guest.headers.get('content-type'), 'application/json');
  assertEquals(guest.headers.get('x-test'), '1');
});
