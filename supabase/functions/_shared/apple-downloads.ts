// _shared/apple-downloads.ts
//
// The Apple side of "Por campanha" (#1062, spec R2.3 and R4 item 4): first-time downloads of the app
// per day and campaign token, from the App Store Connect Analytics Reports API, into
// `social.apple_downloads_daily`, and the first day the report covers into `social.collector_runs`
// (job `apple`, `covered_from`). Without that day `social.campaign_totals` never answers a number.
//
// Import-free: `fetch`, the clock and the database are parameters, so the Deno tests drive it with
// recorded answers. Checked 2026-10-29 against the official documentation:
// - "Generating Tokens for API Requests": ES256 JWT, header { alg, kid, typ: JWT }, payload { iss,
//   iat, exp, aud: "appstoreconnect-v1" }, lifetime at most 20 minutes. WebCrypto's ECDSA signature
//   is already the raw r||s that JWS ES256 expects.
// - "Downloading Analytics Reports": request an ONGOING report once (Admin role for the first request
//   of a report type), list its reports, list the DAILY instances, download the segments. "Your first
//   report request generates in 1–2 days"; a request left unread turns `stoppedDueToInactivity` and a
//   new one is needed. An instance's `processingDate` "might contain data for that day, full data for
//   past dates, or both", so instances are read oldest first and a later one overwrites.
// - "App Store Downloads" report: the `Campaign` column exists only in the Detailed report (since
//   2024-11-19); fields Date, App Apple Identifier, Download Type, Campaign, Counts; Download Type
//   "First-time Download" is "Counted when a user taps the Buy or Get button".
//
// The private key is read from the function's secrets and never leaves this module: no log line, no
// error message and no report carries it, the key id or the issuer id.

/** Tuggi on the App Store (`App Apple Identifier`). */
export const APPLE_APP_ID = '6744379818';
export const ASC_HOST = 'https://api.appstoreconnect.apple.com';
export const APPLE_REPORT_NAME = 'App Store Downloads Detailed';
export const FIRST_TIME_DOWNLOAD = 'first-time download';
export const APPLE_ENV = {
  keyId: 'APPLE_ASC_KEY_ID',
  issuerId: 'APPLE_ASC_ISSUER_ID',
  privateKey: 'APPLE_ASC_PRIVATE_KEY',
} as const;
/** Ten minutes: under Apple's 20-minute ceiling, long enough for one run. */
export const TOKEN_LIFETIME_S = 600;
/** After the first run, instances processed in the last two weeks are read again (late corrections). */
export const APPLE_REREAD_DAYS = 14;

export interface AppleConfig {
  keyId: string;
  issuerId: string;
  privateKey: string;
}

/** The three secrets, or null when any of them is missing: the job is then `not_configured`. */
export function appleConfig(get: (name: string) => string | undefined): AppleConfig | null {
  const keyId = (get(APPLE_ENV.keyId) ?? '').trim();
  const issuerId = (get(APPLE_ENV.issuerId) ?? '').trim();
  const privateKey = (get(APPLE_ENV.privateKey) ?? '').replace(/\\n/g, '\n').trim();
  return keyId && issuerId && privateKey ? { keyId, issuerId, privateKey } : null;
}

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const utf8 = (s: string) => new TextEncoder().encode(s);

/** The `.p8` App Store Connect gives: PKCS#8 PEM of a P-256 key. */
function pemToDer(pem: string): Uint8Array<ArrayBuffer> {
  const bin = atob(pem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '').replace(/\s+/g, ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** A signed App Store Connect JWT. Throws `apple_key_invalid` (never the key) when the PEM does not import. */
export async function ascToken(config: AppleConfig, nowSeconds: number): Promise<string> {
  let key: CryptoKey;
  try {
    key = await crypto.subtle.importKey(
      'pkcs8',
      pemToDer(config.privateKey),
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['sign'],
    );
  } catch {
    throw new Error('apple_key_invalid');
  }
  const header = b64url(utf8(JSON.stringify({ alg: 'ES256', kid: config.keyId, typ: 'JWT' })));
  const payload = b64url(
    utf8(
      JSON.stringify({
        iss: config.issuerId,
        iat: nowSeconds,
        exp: nowSeconds + TOKEN_LIFETIME_S,
        aud: 'appstoreconnect-v1',
      }),
    ),
  );
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, utf8(`${header}.${payload}`));
  return `${header}.${payload}.${b64url(new Uint8Array(signature))}`;
}

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

/** One App Store Connect call. Errors carry the HTTP status only (`apple_403`), never the URL or the token. */
async function asc(
  fetchFn: FetchFn,
  token: string,
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetchFn(`${ASC_HOST}${path}`, {
      method: init.method ?? 'GET',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new Error('apple_network');
  }
  if (!res.ok) throw new Error(`apple_${res.status}`);
  return ((await res.json().catch(() => null)) ?? {}) as Record<string, unknown>;
}

type Resource = { id?: unknown; attributes?: Record<string, unknown> };
const dataOf = (body: Record<string, unknown>): Resource[] => (Array.isArray(body.data) ? (body.data as Resource[]) : []);

/** The ONGOING request of the app, created when there is none or the last one stopped. */
async function ongoingRequest(fetchFn: FetchFn, token: string): Promise<string> {
  const listed = await asc(
    fetchFn,
    token,
    `/v1/apps/${APPLE_APP_ID}/analyticsReportRequests?filter[accessType]=ONGOING`,
  );
  const live = dataOf(listed).find((r) => r.attributes?.stoppedDueToInactivity !== true && typeof r.id === 'string');
  if (live) return String(live.id);
  const created = await asc(fetchFn, token, '/v1/analyticsReportRequests', {
    method: 'POST',
    body: {
      data: {
        type: 'analyticsReportRequests',
        attributes: { accessType: 'ONGOING' },
        relationships: { app: { data: { type: 'apps', id: APPLE_APP_ID } } },
      },
    },
  });
  const id = (created.data as Resource | undefined)?.id;
  if (typeof id !== 'string') throw new Error('apple_request_without_id');
  return id;
}

/** Gzip by its magic bytes (the segment files are compressed), plain text otherwise. */
async function segmentText(res: Response): Promise<string> {
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    return await new Response(stream).text();
  }
  return new TextDecoder().decode(bytes);
}

export interface AppleRow {
  day: string;
  campaign: string;
  downloads: number;
}

/**
 * One report file: first-time downloads of our app per Date and Campaign, and every Date the file
 * covers (with or without a campaign), which is what makes a day "covered". Tab or comma separated,
 * by the header line; fields found by name, never by position.
 */
export function parseDownloads(text: string): { rows: AppleRow[]; days: string[] } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { rows: [], days: [] };
  const sep = lines[0].includes('\t') ? '\t' : ',';
  const head = lines[0].split(sep).map((h) => h.trim().replace(/^"|"$/g, ''));
  const col = (name: string) => head.indexOf(name);
  const [iDate, iApp, iType, iCampaign, iCounts] = ['Date', 'App Apple Identifier', 'Download Type', 'Campaign', 'Counts'].map(
    col,
  );
  if (iDate < 0 || iType < 0 || iCampaign < 0 || iCounts < 0) throw new Error('apple_report_columns');
  const sums = new Map<string, AppleRow>();
  const days = new Set<string>();
  for (const line of lines.slice(1)) {
    const f = line.split(sep).map((v) => v.trim().replace(/^"|"$/g, ''));
    const day = f[iDate];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day ?? '')) continue;
    if (iApp >= 0 && f[iApp] && f[iApp] !== APPLE_APP_ID) continue;
    days.add(day);
    const campaign = (f[iCampaign] ?? '').trim();
    const counts = Number(f[iCounts]);
    if ((f[iType] ?? '').toLowerCase() !== FIRST_TIME_DOWNLOAD || !campaign || !Number.isFinite(counts)) continue;
    const k = `${day}|${campaign}`;
    sums.set(k, { day, campaign, downloads: (sums.get(k)?.downloads ?? 0) + Math.trunc(counts) });
  }
  return { rows: [...sums.values()], days: [...days].sort() };
}

export interface AppleResult {
  /** `pending`: the request exists and Apple has not generated the report yet (1 to 2 days). */
  state: 'read' | 'pending';
  instances: number;
  rows: number;
  /** The first day any read file covered, or null when none did yet. */
  first_day: string | null;
}

export interface AppleDeps {
  config: AppleConfig;
  fetch: FetchFn;
  now: () => Date;
  /** Upsert of `social.apple_downloads_daily` on `(day, campaign)`. */
  write: (rows: AppleRow[]) => Promise<void>;
  /** The `covered_from` already recorded: null on the first run, which then reads every instance. */
  coveredFrom: string | null;
}

/** Calendar arithmetic on a `YYYY-MM-DD`, free of any zone. */
function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export async function collectAppleDownloads(deps: AppleDeps): Promise<AppleResult> {
  const now = deps.now();
  const token = await ascToken(deps.config, Math.floor(now.getTime() / 1000));
  const requestId = await ongoingRequest(deps.fetch, token);
  const reports = await asc(
    deps.fetch,
    token,
    `/v1/analyticsReportRequests/${requestId}/reports?filter[name]=${encodeURIComponent(APPLE_REPORT_NAME)}`,
  );
  const report = dataOf(reports).find((r) => r.attributes?.name === APPLE_REPORT_NAME && typeof r.id === 'string');
  if (!report) return { state: 'pending', instances: 0, rows: 0, first_day: null };

  const listed = await asc(deps.fetch, token, `/v1/analyticsReports/${report.id}/instances?filter[granularity]=DAILY&limit=200`);
  const since = deps.coveredFrom ? addDays(now.toISOString().slice(0, 10), -APPLE_REREAD_DAYS) : null;
  const instances = dataOf(listed)
    .map((i) => ({ id: String(i.id), date: String(i.attributes?.processingDate ?? '') }))
    .filter((i) => i.id && /^\d{4}-\d{2}-\d{2}$/.test(i.date) && (!since || i.date >= since))
    .sort((a, b) => a.date.localeCompare(b.date));

  let rows = 0;
  let first: string | null = null;
  for (const instance of instances) {
    const segments = await asc(deps.fetch, token, `/v1/analyticsReportInstances/${instance.id}/segments`);
    const merged = new Map<string, AppleRow>();
    for (const segment of dataOf(segments)) {
      const url = segment.attributes?.url;
      if (typeof url !== 'string') continue;
      // A pre-signed download URL: it carries its own authorization, and the token is not sent to it.
      const res = await deps.fetch(url, { signal: AbortSignal.timeout(60_000) }).catch(() => null);
      if (!res || !res.ok) throw new Error(`apple_segment_${res?.status ?? 'network'}`);
      const parsed = parseDownloads(await segmentText(res));
      for (const r of parsed.rows) {
        const k = `${r.day}|${r.campaign}`;
        merged.set(k, { ...r, downloads: (merged.get(k)?.downloads ?? 0) + r.downloads });
      }
      if (parsed.days[0] && (!first || parsed.days[0] < first)) first = parsed.days[0];
    }
    if (merged.size > 0) await deps.write([...merged.values()]);
    rows += merged.size;
  }
  return { state: 'read', instances: instances.length, rows, first_day: first };
}
