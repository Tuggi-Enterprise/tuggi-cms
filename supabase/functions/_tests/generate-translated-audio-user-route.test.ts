/**
 * #1106: `generate-translated-audio` on a user route after a person approved it (BR-ROTA-006 item 3)
 * translates and narrates the version on the air, the route text AND each annotation (BR-ROTA-008
 * item 5), whatever the model says about the text; a route still in review gets nothing; the batch
 * screens the PENDING version and only records a signal.
 *
 * Run: deno test --allow-env --allow-read --import-map=supabase/functions/_tests/import_map.json \
 *   supabase/functions/_tests/
 */
import { assert, assertEquals } from './assert.ts';
import { fetchBodies, fetchCalls, loadHandler, network, request, scenario } from './harness.ts';

const handler = await loadHandler('generate-translated-audio');

const ROUTE_ID = '44444444-4444-4444-8444-444444444444';
const LIVE_REVISION = '55555555-5555-4555-8555-555555555555';
const ANNOTATION = '66666666-6666-4666-8666-666666666666';
const CURATOR = { id: '77777777-7777-4777-8777-777777777777', email: 'curator@tuggi.app', is_anonymous: false };

const BODY = { routeId: ROUTE_ID, targetLanguage: 'en-us', voiceGender: 'male' };

function userRoute(status: string) {
  scenario.user = CURATOR;
  scenario.tables = {
    cms_users: { role: 'admin' },
    custom_routes: {
      name: 'Rota da orla', description: 'Pela praia.', metadata: { source: 'user_trip' },
      owner_user_id: '88888888-8888-4888-8888-888888888888', status, live_revision_id: LIVE_REVISION,
    },
    custom_route_revisions: {
      stops: [
        { kind: 'poi', ref: '99999999-9999-4999-8999-999999999999', title: 'Forte', photo_keys: [] },
        { kind: 'annotation', ref: ANNOTATION, title: 'Mirante', description: 'Vista do farol.', photo_keys: [] },
      ],
    },
  };
}

/** Gemini answers the translation with a "flagged" the code must ignore; TTS answers an mp3. */
function scriptProviders(answer: Record<string, unknown>) {
  network.reply = (url) => {
    if (url.includes('generativelanguage.googleapis.com')) {
      return new Response(JSON.stringify({
        candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(answer) }] } }],
      }), { status: 200 });
    }
    if (url.includes('texttospeech.googleapis.com')) {
      return new Response(JSON.stringify({ audioContent: btoa('mp3') }), { status: 200 });
    }
    return new Response('{}', { status: 400 });
  };
}

function reset() {
  scenario.tables = {};
  network.reply = () => new Response('{}', { status: 400 });
}

Deno.test('BR-ROTA-006 item 3 (#1106): an approved user route is translated even when the model flags its text, and its annotation is stored', async () => {
  userRoute('active');
  scriptProviders({
    name: 'Seafront route', description: 'Along the beach.',
    stops: [{ ref: ANNOTATION, title: 'Lookout', description: 'View of the lighthouse.' }],
    flagged: true, category: 'offensive',
  });
  const response = await handler(request(BODY));
  const body = await response.json();
  reset();

  assertEquals(response.status, 200, JSON.stringify(body));
  assertEquals(body.data.stops, 1);
  assertEquals(body.data.stopsFailed, 0);

  const route = scenario.writes.find((w) => w.table === 'custom_route_descriptions' && (w.values as { status?: string }).status === 'ready');
  assert(route, 'the route translation is stored ready');
  assertEquals((route.values as { name: string }).name, 'Seafront route');

  const stop = scenario.writes.find((w) => w.table === 'custom_route_stop_descriptions');
  assert(stop, 'BR-ROTA-008 item 5: the annotation is stored');
  const values = stop.values as Record<string, unknown>;
  assertEquals(values.revision_id, LIVE_REVISION);
  assertEquals(values.annotation_id, ANNOTATION);
  assertEquals(values.description, 'View of the lighthouse.');
  assertEquals(values.status, 'ready');
  assert(String(values.audio_url).includes(`route-audios/${ROUTE_ID}/stops/${LIVE_REVISION}/${ANNOTATION}-en-us-male.mp3`));

  assert(!scenario.calls.includes('rpc:set_route_moderation_result'), 'the route mode records no verdict');
  assertEquals(fetchCalls.filter((u) => u.includes('texttospeech')).length, 2, 'route audio and annotation audio');
  const prompt = fetchBodies[fetchCalls.findIndex((u) => u.includes('generativelanguage'))] ?? '';
  assert(prompt.includes('Vista do farol.'), 'the annotation text of the version on the air is what is translated');
});

Deno.test('BR-ROTA-006 edge case (#1106): a user route without description translates the name and its annotations', async () => {
  userRoute('active');
  (scenario.tables.custom_routes as Record<string, unknown>).description = null;
  scriptProviders({ name: 'Seafront route', stops: [{ ref: ANNOTATION, title: 'Lookout', description: 'View.' }] });
  const response = await handler(request(BODY));
  const body = await response.json();
  reset();

  assertEquals(response.status, 200, JSON.stringify(body));
  assertEquals(body.data.description, null);
  assertEquals(body.data.audioUrl, null, 'no description, no route audio');
  assert(scenario.writes.some((w) => w.table === 'custom_route_stop_descriptions'));
});

Deno.test('BR-ROTA-006 item 3 (#1106): a user route still in review gets 422 and nothing paid runs, even for the CMS', async () => {
  userRoute('pending_review');
  const response = await handler(request(BODY));
  const body = await response.json();
  reset();

  assertEquals(response.status, 422);
  assertEquals(body.error, 'route_under_review');
  assertEquals(fetchCalls, []);
  assert(!scenario.writes.some((w) => w.table === 'custom_route_descriptions'), 'no lock taken');
});

Deno.test('BR-ROTA-006 item 3 (#1106): the batch screens the PENDING version and only records the signal', async () => {
  scenario.user = null;
  scenario.tables = {
    custom_route_revisions: { name: 'Pending name', description: 'Pending text', stops: [] },
  };
  scenario.rpcs = { claim_user_routes_for_moderation: { data: [{ id: ROUTE_ID, attempt: 1 }], error: null } };
  scriptProviders({ flagged: true, category: 'hate' });
  const req = new Request('http://edge.test/fn', {
    method: 'POST',
    headers: { authorization: 'Bearer test-service-role-key', 'content-type': 'application/json', 'x-forwarded-for': '10.9.9.9' },
    body: JSON.stringify({ mode: 'moderate_pending_user_routes', limit: 5 }),
  });
  scenario.calls.length = 0;
  scenario.writes.length = 0;
  fetchCalls.length = 0;
  fetchBodies.length = 0;
  const response = await handler(req);
  const body = await response.json();
  scenario.rpcs = {};
  reset();

  assertEquals(response.status, 200, JSON.stringify(body));
  assertEquals(body.flagged, 1);
  assert(scenario.calls.includes('from:custom_route_revisions'), 'reads the pending version');
  assert(scenario.calls.includes('rpc:set_route_moderation_result'));
  assert(!scenario.calls.includes('from:custom_routes'), 'never the text on the air');
  assertEquals(fetchCalls.filter((u) => u.includes('texttospeech')).length, 0, 'no audio');
  assert(!scenario.writes.some((w) => w.table === 'custom_route_descriptions'), 'no translation');
  const prompt = fetchBodies[0] ?? '';
  assert(prompt.includes('Pending text'));
});
