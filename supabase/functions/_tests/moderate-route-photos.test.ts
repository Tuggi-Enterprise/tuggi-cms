/**
 * #1114: `moderate-route-photos` screens each diary photo with Google Cloud Vision SafeSearch
 * (BR-ROTA-006 item 3, the filter only signals). Flagged at adult or violence LIKELY and up, and at
 * racy VERY_LIKELY; medical and spoof never flag; a failure leaves the photo `unchecked`, never
 * `clean`. The Vision `fetch` is faked: no call leaves the process.
 *
 * Run: deno test --allow-env --allow-read --import-map=supabase/functions/_tests/import_map.json \
 *   supabase/functions/_tests/moderate-route-photos.test.ts
 */
import { assert, assertEquals } from './assert.ts';
import {
  classifyWithSafeSearch,
  moderatePhotos,
  PHOTO_MODERATION_MAX_BYTES,
  SAFE_SEARCH_URL,
} from '../_shared/photo-moderation.ts';

const KEY = 'test-google-key';
const PHOTO = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

type Call = { url: string; init: RequestInit };

function fakeFetch(answer: () => Response | Promise<Response>) {
  const calls: Call[] = [];
  const impl = ((url: string, init: RequestInit) => {
    calls.push({ url: String(url), init });
    return Promise.resolve().then(answer);
  }) as unknown as typeof fetch;
  return { calls, impl };
}

const annotation = (a: Record<string, string>) =>
  new Response(JSON.stringify({ responses: [{ safeSearchAnnotation: a }] }), { status: 200 });

const SAFE = { adult: 'VERY_UNLIKELY', spoof: 'VERY_UNLIKELY', medical: 'VERY_UNLIKELY', violence: 'UNLIKELY', racy: 'POSSIBLE' };

/** Runs one photo through the screening with the faked Vision and returns its verdict and the trail. */
async function screen(answer: () => Response | Promise<Response>) {
  const net = fakeFetch(answer);
  const reasons: string[] = [];
  const [verdict] = await moderatePhotos(
    ['u/d/p1.jpg'],
    { readPhoto: () => Promise.resolve(PHOTO), classify: (bytes) => classifyWithSafeSearch(bytes, KEY, net.impl) },
    (reason) => reasons.push(reason),
  );
  return { verdict, calls: net.calls, reasons };
}

Deno.test('BR-ROTA-006 item 3 (#1114): a safe photo is clean, sent as base64 bytes with the key in a header', async () => {
  const { verdict, calls } = await screen(() => annotation(SAFE));
  assertEquals(verdict, { key: 'u/d/p1.jpg', status: 'clean', categories: [] });
  assertEquals(calls.length, 1);
  assertEquals(calls[0].url, SAFE_SEARCH_URL, 'the key never rides in the URL');
  const headers = calls[0].init.headers as Record<string, string>;
  assertEquals(headers['x-goog-api-key'], KEY);
  assert(calls[0].init.signal instanceof AbortSignal, 'every call carries the timeout');
  assertEquals(JSON.parse(String(calls[0].init.body)), {
    requests: [{ image: { content: btoa(String.fromCharCode(...PHOTO)) }, features: [{ type: 'SAFE_SEARCH_DETECTION' }] }],
  });
});

Deno.test('BR-ROTA-006 item 3 (#1114): adult LIKELY flags the photo', async () => {
  const { verdict } = await screen(() => annotation({ ...SAFE, adult: 'LIKELY' }));
  assertEquals(verdict, { key: 'u/d/p1.jpg', status: 'flagged', categories: ['adult'] });
});

Deno.test('BR-ROTA-006 item 3 (#1114): violence VERY_LIKELY flags, and medical or spoof VERY_LIKELY never do', async () => {
  const flagged = await screen(() => annotation({ ...SAFE, violence: 'VERY_LIKELY' }));
  assertEquals(flagged.verdict.categories, ['violence']);
  const ignored = await screen(() => annotation({ ...SAFE, medical: 'VERY_LIKELY', spoof: 'VERY_LIKELY' }));
  assertEquals(ignored.verdict.status, 'clean');
});

Deno.test('BR-ROTA-006 item 3 (#1114): racy VERY_LIKELY flags the photo', async () => {
  const { verdict } = await screen(() => annotation({ ...SAFE, racy: 'VERY_LIKELY' }));
  assertEquals(verdict, { key: 'u/d/p1.jpg', status: 'flagged', categories: ['racy'] });
});

Deno.test('BR-ROTA-006 item 3 (#1114): racy LIKELY stays clean', async () => {
  const { verdict } = await screen(() => annotation({ ...SAFE, racy: 'LIKELY' }));
  assertEquals(verdict.status, 'clean');
});

Deno.test('#1114: a 403 from Vision leaves the photo unchecked, for a new try', async () => {
  const { verdict, reasons } = await screen(() => new Response('{"error":{"code":403}}', { status: 403 }));
  assertEquals(verdict, { key: 'u/d/p1.jpg', status: 'unchecked', categories: [] });
  assertEquals(reasons, ['provider']);
});

Deno.test('#1114: a timeout leaves the photo unchecked, for a new try', async () => {
  const { verdict, reasons } = await screen(() => Promise.reject(new DOMException('signal timed out', 'TimeoutError')));
  assertEquals(verdict.status, 'unchecked');
  assertEquals(reasons, ['provider']);
});

Deno.test('#1114: no safeSearchAnnotation, a per-image error or an UNKNOWN level never approves', async () => {
  const answers = [
    () => new Response(JSON.stringify({ responses: [{}] }), { status: 200 }),
    () => new Response(JSON.stringify({ responses: [{ error: { code: 3, message: 'Bad image data.' } }] }), { status: 200 }),
    () => annotation({ ...SAFE, adult: 'UNKNOWN' }),
    () => new Response('not json', { status: 200 }),
  ];
  for (const answer of answers) assertEquals((await screen(answer)).verdict.status, 'unchecked');
});

Deno.test('#1114: a photo over the request limit or unreadable is never sent', async () => {
  const net = fakeFetch(() => annotation(SAFE));
  const reasons: string[] = [];
  const out = await moderatePhotos(
    ['u/d/big.jpg', 'u/d/gone.jpg', 'u/d/p.heic'],
    {
      readPhoto: (key) => Promise.resolve(key.endsWith('big.jpg') ? new Uint8Array(PHOTO_MODERATION_MAX_BYTES + 1) : null),
      classify: (bytes) => classifyWithSafeSearch(bytes, KEY, net.impl),
    },
    (reason) => reasons.push(reason),
  );
  assertEquals(out.map((v) => v.status), ['unchecked', 'unchecked', 'unchecked']);
  assertEquals(reasons.sort(), ['format', 'read', 'size']);
  assertEquals(net.calls.length, 0);
});
