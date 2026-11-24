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
  fetchBodies,
  fetchCalls,
  GUEST,
  loadHandler,
  network,
  PERMANENT,
  request,
  scenario,
} from './harness.ts';

const handler = await loadHandler('generate-description');
/** The three filters of the imported-row read: attraction, is_original, generated_by_source (any language, #1088). */
const isImportedRead = (chain: string[]) => chain.includes('limit') && chain.filter((m) => m === 'eq').length === 3;
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
      if (isImportedRead(chain)) return []; // BR-EVENTO-009 item 4: no imported text in fr-fr
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

// ---------------------------------------------------------------------------------------------
// BR-EVENTO-009 item 4 (#1080): the description copied from an official source is not rewritten.

const EVENT_ID = '44444444-4444-4444-8444-444444444444';
const SOURCE_TEXT = 'Show gratuito na Praça das Artes, com a Orquestra Sinfônica Municipal.';
const IMPORTED_ROW = {
  id: 'imported-row',
  language: 'pt-br',
  gender: 'male',
  // Since #1082 the stored text is the source's alone; the credit is the `source_credit` field (migration 20261103140000).
  description: SOURCE_TEXT,
  description_hash: 'hash-of-the-source-text',
  facts_pack_json: null,
  audio_url: null,
  name: 'Concerto na Praça',
  verification_status: null,
  updated_at: null,
};

/** An event whose imported text is IMPORTED_ROW (pt-br); `translation` is the stored row of the asked language. */
function importedScenario(translation: Record<string, unknown> | null = null) {
  scenario.user = PERMANENT;
  scenario.entitlement = { data: [{ state: 'metered' }], error: null };
  scenario.tables = {
    attractions: { name: 'Concerto na Praça', city: 'São Paulo', state: 'SP', country: 'Brazil', entity_kind: 'event' },
    attraction_descriptions: (chain: string[]) => {
      if (isImportedRead(chain)) return [IMPORTED_ROW];
      if (chain.includes('update') && chain.includes('select')) return [{ id: IMPORTED_ROW.id }];
      if (chain.includes('upsert') && chain.includes('single')) return { id: 'translated-row' };
      if (chain.includes('maybeSingle')) return translation;
      if (chain.includes('neq')) {
        return [{ description: IMPORTED_ROW.description, facts_pack_json: null, language: 'pt-br', generation_meta: null }];
      }
      return null;
    },
  };
}

function reset() {
  scenario.tables = {};
  network.reply = () => new Response('{}', { status: 400 });
}

const descriptionWrites = () => scenario.writes.filter((w) => w.table === 'attraction_descriptions');

Deno.test('BR-EVENTO-009 item 4 (#1080, #1081): an old imported row with updated_at null keeps its text, and the TTS reads it whole', async () => {
  importedScenario();
  network.reply = (url) =>
    url.includes('texttospeech.googleapis.com')
      ? new Response(JSON.stringify({ audioContent: btoa('mp3') }), { status: 200 })
      : new Response('{}', { status: 400 });
  try {
    const response = await handler(request({ poi_id: EVENT_ID, language: 'pt-br', gender: 'male' }));
    const answer = await response.json();
    assert(response.status === 200, JSON.stringify(answer));
    assertEquals(answer.data.description, IMPORTED_ROW.description);

    // The only write is the voice: no lock, no upsert, no text, no generated-by stamp.
    assertEquals(descriptionWrites().map((w) => [w.op, Object.keys(w.values as object)]), [['update', ['audio_url']]]);

    // Only the TTS was paid for, with the source text, read without asking for the credit of the source (#1081).
    assert(fetchCalls.length === 1, JSON.stringify(fetchCalls));
    assert(fetchCalls[0].includes('texttospeech.googleapis.com'));
    const ssml = JSON.parse(fetchBodies[0]!).input.ssml as string;
    assert(ssml.includes('Show gratuito na Praça das Artes') && ssml.includes('Orquestra Sinfônica Municipal.'), ssml);
    assert(!ssml.includes('Informações'), `the credit line was spoken: ${ssml}`);
    assert(!ssml.includes('cidadedesaopaulo.com'), `the credit line was spoken: ${ssml}`);
  } finally {
    reset();
  }
});

Deno.test('BR-EVENTO-009 item 4 (#1080): the other gender and force in the source language still do not generate a text', async () => {
  importedScenario();
  try {
    const response = await handler(
      request({ poi_id: EVENT_ID, language: 'pt-br', gender: 'female', force: true, generate_audio: false }),
    );
    const answer = await response.json();
    assert(response.status === 200, JSON.stringify(answer));
    assertEquals(answer.data.description, IMPORTED_ROW.description);
    assertEquals(descriptionWrites(), []);
    assertEquals(fetchCalls, []);
  } finally {
    reset();
  }
});

Deno.test('BR-EVENTO-009 item 3 (#1081): a language the source did not write is translated from a text without the credit', async () => {
  importedScenario();
  network.reply = () => geminiText('Concert gratuit sur la Praça das Artes.');
  try {
    const response = await handler(request({ poi_id: EVENT_ID, language: 'fr-fr', generate_audio: false }));
    const answer = await response.json();
    assert(response.status === 200, JSON.stringify(answer));
    const upsert = descriptionWrites().find((w) =>
      w.op === 'upsert' && (w.values as Record<string, unknown>).description !== '[PROCESSING]'
    );
    assert(upsert, `no text was written: ${JSON.stringify(descriptionWrites())}`);
    assertEquals((upsert.values as Record<string, unknown>).language, 'fr-fr');
    assertEquals((upsert.values as Record<string, unknown>).description, 'Concert gratuit sur la Praça das Artes.');
    // The translation started from the stored source text, which carries no credit line to translate.
    const asked = fetchBodies.filter((b): b is string => typeof b === 'string' && b.includes('Orquestra Sinfônica'));
    assert(asked.length >= 1, `the source text was not sent to the translation: ${JSON.stringify(fetchCalls)}`);
    assert(asked.every((b) => !b.includes('Informações') && !b.includes('cidadedesaopaulo.com')), asked.join('\n'));
  } finally {
    reset();
  }
});

// ---------------------------------------------------------------------------------------------
// #1088, BR-EVENTO-009 item 4: a translation of an imported event follows the imported text it came from.

const TRANSLATED = 'Concert gratuit sur la Praça des Arts.';
const UPDATED_TRANSLATION = 'Concert gratuit, nouvelle date, sur la Praça des Arts.';

function storedTranslation(meta: Record<string, unknown> | null, audioUrl: string | null) {
  return {
    id: 'translated-row',
    updated_at: new Date().toISOString(),
    facts_pack_json: null,
    description: TRANSLATED,
    audio_url: audioUrl,
    generation_meta: meta,
    name: 'Concert sur la place',
    verification_status: null,
  };
}

/** Gemini answers the translation, Google answers the voice. */
function paidApis(translation: string) {
  network.reply = (url) =>
    url.includes('texttospeech.googleapis.com')
      ? new Response(JSON.stringify({ audioContent: btoa('mp3') }), { status: 200 })
      : geminiText(translation);
}

const textWrite = () =>
  descriptionWrites().find((w) => w.op === 'upsert' && (w.values as Record<string, unknown>).description !== '[PROCESSING]');
const trailWrite = () =>
  descriptionWrites().find((w) => w.op === 'update' && 'generation_meta' in (w.values as Record<string, unknown>));
/** Gemini calls that translated the description: the ones that carried the imported text (the name has its own call). */
const askedGemini = () =>
  fetchCalls.filter((u, i) => u.includes('generativelanguage.googleapis.com') && (fetchBodies[i] ?? '').includes('Orquestra Sinfônica'));
const askedTts = () => fetchCalls.filter((u) => u.includes('texttospeech.googleapis.com'));

Deno.test('BR-EVENTO-009 item 4 (#1088): the source changed the imported text, so the translation and its voice are redone in the same row', async () => {
  importedScenario(storedTranslation({ kind: 'translation', source_description_hash: 'hash-of-an-older-text' }, 'https://old.mp3'));
  paidApis(UPDATED_TRANSLATION);
  try {
    const response = await handler(request({ poi_id: EVENT_ID, language: 'fr-fr', gender: 'male' }));
    const answer = await response.json();
    assert(response.status === 200, JSON.stringify(answer));

    const written = textWrite();
    assert(written, `no text was written: ${JSON.stringify(descriptionWrites())}`);
    const values = written.values as Record<string, unknown>;
    assertEquals([values.language, values.gender, values.description], ['fr-fr', 'male', UPDATED_TRANSLATION]);
    assert(String(values.audio_url).includes(`${EVENT_ID}-fr-fr-male.mp3`), `the voice was not redone: ${values.audio_url}`);
    // The same row is rewritten (upsert on attraction, language, gender), never deleted, and the imported row is untouched.
    assert(!scenario.calls.some((c) => c === 'delete'), JSON.stringify(scenario.calls));
    assert(descriptionWrites().every((w) => (w.values as Record<string, unknown>).language !== 'pt-br'));

    // Translated from the imported text, and the trail records which text that was.
    assert(askedGemini().length === 1, `not translated once from the imported text: ${JSON.stringify(fetchCalls)}`);
    assert(askedTts().length === 1, JSON.stringify(fetchCalls));
    const trail = trailWrite();
    assert(trail, `no trail was written: ${JSON.stringify(descriptionWrites())}`);
    assertEquals((trail.values as { generation_meta: Record<string, unknown> }).generation_meta.source_description_hash, IMPORTED_ROW.description_hash);
  } finally {
    reset();
  }
});

Deno.test('BR-EVENTO-009 item 4 (#1088): the imported text did not change, so the translation and its voice are reused and nothing is paid', async () => {
  importedScenario(storedTranslation({ kind: 'translation', source_description_hash: IMPORTED_ROW.description_hash }, 'https://kept.mp3'));
  try {
    const response = await handler(request({ poi_id: EVENT_ID, language: 'fr-fr', gender: 'male' }));
    const answer = await response.json();
    assert(response.status === 200, JSON.stringify(answer));
    assertEquals([answer.data.description, answer.data.audio_url, answer.data.status], [TRANSLATED, 'https://kept.mp3', 'hit']);
    assertEquals(answer.data.generation_meta, undefined);
    assertEquals(descriptionWrites(), []);
    assertEquals(fetchCalls, []);
  } finally {
    reset();
  }
});

Deno.test('BR-EVENTO-009 item 4 (#1088): a current translation without voice gets only the TTS, and keeps the hash', async () => {
  importedScenario(storedTranslation({ kind: 'translation', source_description_hash: IMPORTED_ROW.description_hash }, null));
  paidApis('must not be asked');
  try {
    const response = await handler(request({ poi_id: EVENT_ID, language: 'fr-fr', gender: 'male' }));
    const answer = await response.json();
    assert(response.status === 200, JSON.stringify(answer));
    assertEquals((textWrite()?.values as Record<string, unknown>).description, TRANSLATED);
    assertEquals(askedGemini(), []);
    assert(askedTts().length === 1, JSON.stringify(fetchCalls));
    const meta = (trailWrite()?.values as { generation_meta: Record<string, unknown> }).generation_meta;
    assertEquals([meta.kind, meta.source_description_hash], ['tts_only', IMPORTED_ROW.description_hash]);
  } finally {
    reset();
  }
});

Deno.test('BR-EVENTO-009 item 4 (#1088): a translation written before the hash existed is translated once more', async () => {
  importedScenario(storedTranslation({ kind: 'translation', source_language: 'pt-br', grounded: null }, 'https://old.mp3'));
  paidApis(UPDATED_TRANSLATION);
  try {
    const response = await handler(request({ poi_id: EVENT_ID, language: 'fr-fr', gender: 'male', generate_audio: false }));
    const answer = await response.json();
    assert(response.status === 200, JSON.stringify(answer));
    assertEquals((textWrite()?.values as Record<string, unknown>).description, UPDATED_TRANSLATION);
    assert(askedGemini().length === 1, JSON.stringify(fetchCalls));
    const meta = (trailWrite()?.values as { generation_meta: Record<string, unknown> }).generation_meta;
    assertEquals(meta.source_description_hash, IMPORTED_ROW.description_hash);
  } finally {
    reset();
  }
});
