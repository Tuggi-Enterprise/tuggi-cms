/**
 * #1007, #1021: `generate-description` decides the guest by his state like any tourist (BR-CONTEUDO-003 item 1)
 * and refuses when the entitlement cannot be read (BR-CONTEUDO-003 item 5), before any paid call.
 *
 * Run: deno test --allow-env --allow-read --import-map=supabase/functions/_tests/import_map.json \
 *   supabase/functions/_tests/
 */
import { assert, assertEquals } from './assert.ts';
import {
  callsPastTheGate,
  fetchCalls,
  GUEST,
  loadHandler,
  network,
  PERMANENT,
  request,
  scenario,
} from './harness.ts';

const handler = await loadHandler('generate-description');
const BODY = { poi_id: '33333333-3333-4333-8333-333333333333', language: 'fr-fr' };

Deno.test('BR-CONTEUDO-003 item 1 (#1021): guest in free gets 403 content_production_not_entitled, nothing paid runs', async () => {
  scenario.user = GUEST;
  scenario.entitlement = { data: [{ state: 'free' }], error: null };
  const response = await handler(request(BODY));

  assertEquals(response.status, 403);
  assertEquals(await response.json(), { error: 'content_production_not_entitled', rule: 'BR-CONTEUDO-003', state: 'free' });
  assert(scenario.calls.includes('rpc:get_entitlement'), 'the guest is decided by his state');
  assert(!scenario.calls.includes('from:cms_users'), 'a guest has no operator row to look up');
  assertEquals(callsPastTheGate(), []);
  assertEquals(fetchCalls, []);
});

Deno.test('BR-CONTEUDO-003 item 1 (#1021): guest in metered passes the gate', async () => {
  scenario.user = GUEST;
  scenario.entitlement = { data: [{ state: 'metered' }], error: null };
  const response = await handler(request(BODY));
  await response.body?.cancel();

  assert(scenario.calls.includes('rpc:get_entitlement'));
  assert(callsPastTheGate().length > 0, `stopped at the gate with ${response.status}`);
  assert(fetchCalls.length > 0, 'the paid generator was never reached');
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
  const response = await handler(request(BODY));
  await response.body?.cancel();

  assert(scenario.calls.includes('rpc:get_entitlement'));
  assert(callsPastTheGate().length > 0, `stopped at the gate with ${response.status}`);
  assert(fetchCalls.length > 0, 'the paid generator was never reached');
});

/** A Gemini `generateContent` answer the translation helper accepts. */
function geminiText(text: string): Response {
  return new Response(
    JSON.stringify({
      candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

/** Runs `fn` with every console method captured; returns what was printed, one string per call. */
async function capturingConsole<T>(fn: () => Promise<T>): Promise<{ result: T; printed: string[] }> {
  const printed: string[] = [];
  const methods = ['log', 'info', 'warn', 'error', 'debug'] as const;
  const saved = methods.map((m) => console[m]);
  for (const m of methods) {
    console[m] = (...args: unknown[]) => {
      printed.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
    };
  }
  try {
    return { result: await fn(), printed };
  } finally {
    methods.forEach((m, i) => (console[m] = saved[i]));
  }
}

Deno.test('#1014: a generation that reaches the write records who asked without the e-mail, and logs no e-mail', async () => {
  scenario.user = PERMANENT;
  scenario.entitlement = { data: [{ state: 'metered' }], error: null };
  scenario.tables = {
    attractions: { name: 'Praia do Forno', city: 'Arraial do Cabo', state: 'RJ', country: 'Brazil' },
    attraction_descriptions: (chain: string[]) => {
      if (chain.includes('upsert') && chain.includes('single')) return { id: 'row-1' };
      if (chain.includes('maybeSingle')) return null;
      if (chain.includes('neq')) {
        return [{ description: 'Texto aprovado em português.', facts_pack_json: [], language: 'pt-br', generation_meta: null }];
      }
      return null;
    },
  };
  network.reply = () => geminiText('Texte traduit en français.');
  try {
    const { result: response, printed } = await capturingConsole(() =>
      Promise.resolve(handler(request({ ...BODY, generate_audio: false })))
    );
    const answer = await response.json();
    assertEquals(response.status, 200);

    const descriptionWrites = scenario.writes.filter((w) => w.table === 'attraction_descriptions');
    const tracking = descriptionWrites.find((w) =>
      w.op === 'update' && (w.values as Record<string, unknown>).generated_by_user_id !== undefined
    );
    assert(tracking, `the generated-by update never ran: ${JSON.stringify(descriptionWrites)}`);
    assertEquals(tracking.values, { generated_by_user_id: PERMANENT.id, generated_by_source: 'app_user' });

    for (const write of descriptionWrites) {
      const values = JSON.stringify(write.values);
      assert(!values.includes('generated_by_email'), `${write.op} wrote generated_by_email: ${values}`);
      assert(!values.includes(PERMANENT.email!), `${write.op} carried the e-mail: ${values}`);
    }
    assert(!JSON.stringify(answer).includes(PERMANENT.email!), 'the response carries the e-mail');
    const leaked = printed.filter((line) => line.includes(PERMANENT.email!));
    assertEquals(leaked, []);
  } finally {
    scenario.tables = {};
    network.reply = () => new Response('{}', { status: 400 });
  }
});
