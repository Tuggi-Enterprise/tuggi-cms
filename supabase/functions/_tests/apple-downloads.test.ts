/**
 * #1062: the Apple side of "Por campanha", `_shared/apple-downloads.ts`, and the `apple` job of the
 * daily run. App Store Connect is recorded by URL; the key is a P-256 key generated per run, so the
 * JWT is verified with its public half and no real secret exists here.
 */
import { assert, assertEquals } from './assert.ts';
import {
  APPLE_APP_ID,
  type AppleConfig,
  appleConfig,
  type AppleRow,
  ascToken,
  collectAppleDownloads,
  parseDownloads,
} from '../_shared/apple-downloads.ts';
import { type CollectDeps, runSocialCollect, type SocialStore, type SocialTable } from '../_shared/social-collect.ts';

const NOW = new Date('2026-11-04T09:00:00Z');

async function keyPair(): Promise<{ config: AppleConfig; publicKey: CryptoKey }> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const der = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  const b64 = btoa(String.fromCharCode(...der)).replace(/(.{64})/g, '$1\n');
  return {
    config: { keyId: 'TESTKEYID1', issuerId: '00000000-0000-4000-8000-000000000000', privateKey: `-----BEGIN PRIVATE KEY-----\n${b64}\n-----END PRIVATE KEY-----` },
    publicKey: pair.publicKey,
  };
}

const b64urlDecode = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0));

const HEAD = 'Date\tApp Name\tApp Apple Identifier\tDownload Type\tApp Version\tDevice\tPlatform Version\tSource Type\tSource Info\tCampaign\tPage Type\tPage Title\tPre-Order\tTerritory\tCounts';
const line = (date: string, type: string, campaign: string, counts: number, app = APPLE_APP_ID) =>
  [date, 'Tuggi', app, type, '2.1', 'iPhone', 'iOS 26', 'Web referrer', 'tuggi.app', campaign, 'Product page', '', 'No', 'BR', counts].join('\t');

async function gzip(text: string): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([new TextEncoder().encode(text)]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

interface AscOptions {
  requests?: Array<{ id: string; attributes: Record<string, unknown> }>;
  report?: boolean;
  status?: number;
}

/** App Store Connect, recorded. Two daily instances; the later one corrects 2026-11-01. */
function asc(opts: AscOptions = {}) {
  const calls: Array<{ url: string; method: string; auth: string | null }> = [];
  const files: Record<string, string> = {
    'i1': [HEAD, line('2026-10-31', 'First-time Download', 'bio_novembro', 2), line('2026-10-31', 'Redownload', 'bio_novembro', 9), line('2026-11-01', 'First-time Download', 'bio_novembro', 1), line('2026-11-01', 'First-time Download', '', 30)].join('\n'),
    'i2': [HEAD, line('2026-11-01', 'First-time Download', 'bio_novembro', 3), line('2026-11-01', 'first-time download', 'story_buzios', 4), line('2026-11-01', 'First-time Download', 'outro_app', 50, '999')].join('\n'),
  };
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  const fetchFn = async (url: string, init?: RequestInit) => {
    const auth = new Headers(init?.headers).get('authorization');
    calls.push({ url, method: init?.method ?? 'GET', auth });
    if (opts.status) return json({ errors: [{ status: String(opts.status) }] }, opts.status);
    const u = new URL(url);
    if (u.host === 'segments.example.com') return new Response(await gzip(files[u.pathname.slice(1)]), { status: 200 });
    if (u.pathname === `/v1/apps/${APPLE_APP_ID}/analyticsReportRequests`) return json({ data: opts.requests ?? [] });
    if (u.pathname === '/v1/analyticsReportRequests' && init?.method === 'POST') return json({ data: { id: 'req-new', type: 'analyticsReportRequests' } }, 201);
    if (/^\/v1\/analyticsReportRequests\/[^/]+\/reports$/.test(u.pathname)) {
      return json({ data: opts.report === false ? [] : [{ id: 'rep-1', attributes: { name: 'App Store Downloads Detailed', category: 'COMMERCE' } }] });
    }
    if (u.pathname === '/v1/analyticsReports/rep-1/instances') {
      return json({ data: [{ id: 'i2', attributes: { granularity: 'DAILY', processingDate: '2026-11-03' } }, { id: 'i1', attributes: { granularity: 'DAILY', processingDate: '2026-11-02' } }] });
    }
    const seg = /^\/v1\/analyticsReportInstances\/(i\d)\/segments$/.exec(u.pathname);
    if (seg) return json({ data: [{ id: `s-${seg[1]}`, attributes: { url: `https://segments.example.com/${seg[1]}`, sizeInBytes: 10 } }] });
    return json({}, 404);
  };
  return { calls, fetch: fetchFn };
}

Deno.test('#1062: the App Store Connect token is ES256, signed by the key, ten minutes long, with the documented claims', async () => {
  const { config, publicKey } = await keyPair();
  const token = await ascToken(config, 1_800_000_000);
  const [h, p, sig] = token.split('.');
  assertEquals(JSON.parse(new TextDecoder().decode(b64urlDecode(h))), { alg: 'ES256', kid: 'TESTKEYID1', typ: 'JWT' });
  const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(p)));
  assertEquals(payload, { iss: config.issuerId, iat: 1_800_000_000, exp: 1_800_000_600, aud: 'appstoreconnect-v1' });
  const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, publicKey, b64urlDecode(sig), new TextEncoder().encode(`${h}.${p}`));
  assert(ok, 'signature does not verify');
  let refused = '';
  await ascToken({ ...config, privateKey: 'not a key' }, 1).catch((e) => (refused = e.message));
  assertEquals(refused, 'apple_key_invalid');
});

Deno.test('#1062: the three secrets are all required; an escaped newline in the key is restored', () => {
  const env: Record<string, string> = { APPLE_ASC_KEY_ID: 'K', APPLE_ASC_ISSUER_ID: 'I', APPLE_ASC_PRIVATE_KEY: 'a\\nb' };
  assertEquals(appleConfig((n) => env[n])?.privateKey, 'a\nb');
  for (const missing of Object.keys(env)) assertEquals(appleConfig((n) => (n === missing ? ' ' : env[n])), null);
});

Deno.test('#1062: the report keeps first-time downloads of our app with a campaign, and says every day it covers', () => {
  const text = [HEAD, line('2026-10-31', 'First-time Download', 'bio', 2), line('2026-10-31', 'First-time Download', 'bio', 1), line('2026-10-30', 'Redownload', 'bio', 7), line('2026-10-29', 'First-time Download', '', 5), line('2026-10-31', 'First-time Download', 'bio', 9, '1')].join('\n');
  assertEquals(parseDownloads(text), { rows: [{ day: '2026-10-31', campaign: 'bio', downloads: 3 }], days: ['2026-10-29', '2026-10-30', '2026-10-31'] });
  let refused = '';
  try {
    parseDownloads('Date\tCounts\n2026-10-31\t1');
  } catch (e) {
    refused = (e as Error).message;
  }
  assertEquals(refused, 'apple_report_columns');
});

Deno.test('#1062: the first run creates the ONGOING request, reads every instance oldest first, and the later one overwrites', async () => {
  const { config } = await keyPair();
  const rig = asc();
  const written: AppleRow[] = [];
  const result = await collectAppleDownloads({ config, fetch: rig.fetch, now: () => NOW, coveredFrom: null, write: (rows) => (written.push(...rows), Promise.resolve()) });
  assertEquals(result, { state: 'read', instances: 2, rows: 4, first_day: '2026-10-31' });
  const post = rig.calls.find((c) => c.method === 'POST');
  assert(post?.url.endsWith('/v1/analyticsReportRequests'), 'no ONGOING request created');
  // i1 (2026-11-02) first, then i2 (2026-11-03): the corrected 2026-11-01 lands last.
  assertEquals(written, [
    { day: '2026-10-31', campaign: 'bio_novembro', downloads: 2 },
    { day: '2026-11-01', campaign: 'bio_novembro', downloads: 1 },
    { day: '2026-11-01', campaign: 'bio_novembro', downloads: 3 },
    { day: '2026-11-01', campaign: 'story_buzios', downloads: 4 },
  ]);
  // The pre-signed file URL gets no token; every App Store Connect call does.
  for (const c of rig.calls) assertEquals([c.url, c.auth?.startsWith('Bearer ') ?? false], [c.url, !c.url.includes('segments.example.com')]);
  assert(rig.calls.some((c) => c.url.includes('filter[name]=App%20Store%20Downloads%20Detailed')), 'not the detailed report');
});

Deno.test('#1062: a live request is reused, a stopped one replaced; no report yet is pending', async () => {
  const { config } = await keyPair();
  const live = asc({ requests: [{ id: 'req-1', attributes: { accessType: 'ONGOING', stoppedDueToInactivity: false } }], report: false });
  const pending = await collectAppleDownloads({ config, fetch: live.fetch, now: () => NOW, coveredFrom: null, write: () => Promise.resolve() });
  assertEquals(pending, { state: 'pending', instances: 0, rows: 0, first_day: null });
  assertEquals(live.calls.filter((c) => c.method === 'POST').length, 0);
  assert(live.calls.some((c) => c.url.includes('/analyticsReportRequests/req-1/reports')));
  const stopped = asc({ requests: [{ id: 'req-1', attributes: { stoppedDueToInactivity: true } }], report: false });
  await collectAppleDownloads({ config, fetch: stopped.fetch, now: () => NOW, coveredFrom: null, write: () => Promise.resolve() });
  assertEquals(stopped.calls.filter((c) => c.method === 'POST').length, 1);
});

// ------------------------------------------------------------------------------------------------
// The `apple` job of the daily run, with everything else of the run switched off

function store(initial: Record<string, unknown> | null = null) {
  const tables: Record<string, Map<string, Record<string, unknown>>> = { collector_runs: new Map(), apple_downloads_daily: new Map() };
  if (initial) tables.collector_runs.set('apple', initial);
  const s: SocialStore = {
    activeAccounts: () => Promise.resolve([]),
    setIgUserId: () => Promise.resolve(),
    upsert: (table: SocialTable, rows: Record<string, unknown>[], onConflict: string) => {
      for (const r of rows) {
        const k = onConflict.split(',').map((c) => String(r[c])).join('|');
        tables[table].set(k, { ...(tables[table].get(k) ?? {}), ...r });
      }
      return Promise.resolve();
    },
    untaggedMedia: () => Promise.resolve([]),
    setTheme: () => Promise.resolve(),
    hasWeekly: () => Promise.resolve(true),
    hasAudience: () => Promise.resolve(true),
    appleCoveredFrom: () => Promise.resolve((tables.collector_runs.get('apple')?.covered_from as string | undefined) ?? null),
    rpc: () => Promise.resolve([]),
    ownPostsSince: () => Promise.resolve([]),
    funnelSince: () => Promise.resolve([]),
    firstPostDay: () => Promise.resolve(null),
    followersSince: () => Promise.resolve([]),
  };
  return { s, tables };
}

const deps = (s: SocialStore, apple: CollectDeps['apple'], logs: string[] = []): CollectDeps => ({
  store: s,
  meta: { igUserId: 'x', get: () => Promise.reject(new Error('no meta here')) },
  ga4: null,
  gemini: null,
  now: () => NOW,
  log: (l) => logs.push(l),
  apple,
});

Deno.test('#1062: without the Apple secrets the job is not_configured, with no call and no error', async () => {
  const { s, tables } = store();
  const rig = asc();
  const report = await runSocialCollect(deps(s, { config: null, fetch: rig.fetch }));
  assertEquals(report.apple, 'not_configured');
  assertEquals(rig.calls.length, 0);
  const run = tables.collector_runs.get('apple');
  assertEquals([run?.status, run?.covered_from], ['not_configured', undefined]);
});

Deno.test('#1062: with the report read, covered_from is the first covered day and only moves back; a refusal keeps it', async () => {
  const { config } = await keyPair();
  const { s, tables } = store({ job: 'apple', status: 'ok', covered_from: '2026-11-01' });
  const report = await runSocialCollect(deps(s, { config, fetch: asc().fetch }));
  assertEquals(report.apple, 'read');
  assertEquals(tables.collector_runs.get('apple')?.covered_from, '2026-10-31');
  assertEquals(tables.apple_downloads_daily.get('2026-11-01|bio_novembro')?.downloads, 3);
  // Already covered from earlier: a later first day does not move it forward.
  tables.collector_runs.set('apple', { job: 'apple', status: 'ok', covered_from: '2026-10-01' });
  await runSocialCollect(deps(s, { config, fetch: asc().fetch }));
  assertEquals(tables.collector_runs.get('apple')?.covered_from, '2026-10-01');
  // Apple refuses (a key without the role): error recorded, coverage kept, the key never in a log line.
  const logs: string[] = [];
  const refused = await runSocialCollect(deps(s, { config, fetch: asc({ status: 403 }).fetch }, logs));
  assertEquals(refused.apple, 'failed');
  assertEquals([tables.collector_runs.get('apple')?.status, tables.collector_runs.get('apple')?.detail], ['error', 'apple_403']);
  assertEquals(tables.collector_runs.get('apple')?.covered_from, '2026-10-01');
  const body = config.privateKey.split('\n')[1];
  assert(!logs.join('\n').includes(body) && !logs.join('\n').includes(config.keyId), 'a secret reached a log line');
});
