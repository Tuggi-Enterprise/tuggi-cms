/**
 * #1007: `generate-translated-audio` refuses the guest (BR-USUARIO-037 item 4.i) and refuses when the
 * entitlement cannot be read (BR-CONTEUDO-003 item 5), before any paid call.
 *
 * Run: deno test --allow-env --allow-read --import-map=supabase/functions/_tests/import_map.json \
 *   supabase/functions/_tests/
 */
import { assert, assertEquals } from './assert.ts';
import { callsPastTheGate, fetchCalls, GUEST, loadHandler, PERMANENT, request, scenario } from './harness.ts';

const handler = await loadHandler('generate-translated-audio');
const BODY = {
  attractionId: '33333333-3333-4333-8333-333333333333',
  targetLanguage: 'fr-fr',
  voiceGender: 'female',
};

Deno.test('BR-USUARIO-037 4.i: guest gets 403 account_required, state is not read, nothing paid runs', async () => {
  scenario.user = GUEST;
  scenario.entitlement = { data: [{ state: 'unlimited' }], error: null };
  const response = await handler(request(BODY));

  assertEquals(response.status, 403);
  assertEquals(await response.json(), { error: 'account_required', rule: 'BR-USUARIO-037' });
  assert(!scenario.calls.includes('rpc:get_entitlement'), 'guest must not reach get_entitlement');
  assert(!scenario.calls.includes('from:cms_users'), 'a guest has no operator row to look up');
  assertEquals(callsPastTheGate(), []);
  assertEquals(fetchCalls, []);
});

Deno.test('BR-CONTEUDO-003 item 5: get_entitlement error gives 503 entitlement_unavailable and no generation', async () => {
  scenario.user = PERMANENT;
  scenario.entitlement = { data: null, error: { code: 'XX000' } };
  const response = await handler(request(BODY));

  assertEquals(response.status, 503);
  assertEquals(await response.json(), { error: 'entitlement_unavailable', rule: 'BR-CONTEUDO-003' });
  assertEquals(callsPastTheGate(), []);
  assertEquals(fetchCalls, []);
});

Deno.test('BR-CONTEUDO-003 item 1: free permanent account still gets 403 content_production_not_entitled', async () => {
  scenario.user = PERMANENT;
  scenario.entitlement = { data: [{ state: 'free' }], error: null };
  const response = await handler(request(BODY));

  assertEquals(response.status, 403);
  assertEquals((await response.json()).error, 'content_production_not_entitled');
  assertEquals(callsPastTheGate(), []);
  assertEquals(fetchCalls, []);
});

Deno.test('BR-CONTEUDO-003 item 1: permanent account in metered passes the gate', async () => {
  scenario.user = PERMANENT;
  scenario.entitlement = { data: [{ state: 'metered' }], error: null };
  scenario.tables = {
    attraction_descriptions: { description: 'Texto de origem.', language: 'pt-br' },
    attractions: { name: 'Praia' },
  };
  const response = await handler(request(BODY));
  await response.body?.cancel();
  scenario.tables = {};

  assert(scenario.calls.includes('rpc:get_entitlement'));
  assert(callsPastTheGate().length > 0, `stopped at the gate with ${response.status}`);
  assert(fetchCalls.length > 0, 'the paid generator was never reached');
});
