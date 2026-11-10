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
//
// #1168: `apple-store-funnel.ts` reads three more reports of the same ONGOING request with the same key,
// through the token, request, instance and segment helpers exported here.

/** Tuggi on the App Store (`App Apple Identifier`). */
export const APPLE_APP_ID = '6744379818';
export const ASC_HOST = 'https://api.appstoreconnect.apple.com';
/**
 * The `name` App Store Connect lists the report under: not the documentation title ("App Store
 * Downloads"), see the header of `apple-store-funnel.ts` (#1168, the first run listed no
 * "App Store Downloads Standard").
 */
export const APPLE_REPORT_NAME = 'App Downloads Detailed';
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

/**
 * Apple's own words on a refusal (`errors[0]` of the App Store Connect error body: code and detail, or
 * title), one line, capped. They never carry the token, the URL or the key; `redact` still runs on them.
 */
async function appleWords(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as { errors?: Array<Record<string, unknown>> } | null;
  const first = Array.isArray(body?.errors) ? body.errors[0] : undefined;
  const text = (v: unknown) => (typeof v === 'string' ? v : '');
  const words = [text(first?.code), text(first?.detail) || text(first?.title)].filter(Boolean).join(': ');
  return words.replace(/\s+/g, ' ').trim().slice(0, 200);
}

/**
 * One App Store Connect call. The error is `apple_<status>` plus Apple's words when the body has them
 * (`apple_403 FORBIDDEN_ERROR: The API key in use does not allow this request`), never the URL or the token.
 */
export async function asc(
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
  if (!res.ok) {
    const words = await appleWords(res);
    throw new Error(words ? `apple_${res.status} ${words}` : `apple_${res.status}`);
  }
  return ((await res.json().catch(() => null)) ?? {}) as Record<string, unknown>;
}

/** The key id and the issuer id out of any message that leaves the module (a log line, `collector_runs.detail`). */
export function redact(message: string, config: AppleConfig): string {
  let out = message;
  for (const secret of [config.keyId, config.issuerId]) if (secret) out = out.split(secret).join('[redacted]');
  return out;
}

export type Resource = { id?: unknown; attributes?: Record<string, unknown> };
export const dataOf = (body: Record<string, unknown>): Resource[] => (Array.isArray(body.data) ? (body.data as Resource[]) : []);

/** The ONGOING request of the app, created when there is none or the last one stopped. */
export async function ongoingRequest(fetchFn: FetchFn, token: string): Promise<string> {
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
export async function segmentText(res: Response): Promise<string> {
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
 * The rows of one report file that are ours, as records by column name: tab or comma separated, by the
 * header line; a row needs a `YYYY-MM-DD` Date, and another app's `App Apple Identifier` drops it.
 * Throws `apple_report_columns` when a required column is not in the header (the format changed).
 */
export function reportRows(text: string, required: string[]): Array<Record<string, string>> {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];
  const sep = lines[0].includes('\t') ? '\t' : ',';
  const clean = (v: string) => v.trim().replace(/^"|"$/g, '');
  const head = lines[0].split(sep).map(clean);
  if (!['Date', ...required].every((c) => head.includes(c))) throw new Error('apple_report_columns');
  const out: Array<Record<string, string>> = [];
  for (const line of lines.slice(1)) {
    const f = line.split(sep).map(clean);
    const row: Record<string, string> = {};
    head.forEach((h, i) => (row[h] = f[i] ?? ''));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.Date)) continue;
    if (row['App Apple Identifier'] && row['App Apple Identifier'] !== APPLE_APP_ID) continue;
    out.push(row);
  }
  return out;
}

/**
 * One report file: first-time downloads of our app per Date and Campaign, and every Date the file
 * covers (with or without a campaign), which is what makes a day "covered". Tab or comma separated,
 * by the header line; fields found by name, never by position.
 */
export function parseDownloads(text: string): { rows: AppleRow[]; days: string[] } {
  const sums = new Map<string, AppleRow>();
  const days = new Set<string>();
  for (const f of reportRows(text, ['Download Type', 'Campaign', 'Counts'])) {
    const day = f.Date;
    days.add(day);
    const campaign = f.Campaign.trim();
    const counts = Number(f.Counts);
    if (f['Download Type'].toLowerCase() !== FIRST_TIME_DOWNLOAD || !campaign || !Number.isFinite(counts)) continue;
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
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * The DAILY instances of a report, oldest first: all of them on the first run (`since` null), else those
 * processed on or after `since`. A later instance can carry a corrected past day, so the reader applies
 * them in this order and the later one wins.
 */
export async function dailyInstances(
  fetchFn: FetchFn,
  token: string,
  reportId: string,
  since: string | null,
): Promise<Array<{ id: string; date: string }>> {
  const listed = await asc(fetchFn, token, `/v1/analyticsReports/${reportId}/instances?filter[granularity]=DAILY&limit=200`);
  return dataOf(listed)
    .map((i) => ({ id: String(i.id), date: String(i.attributes?.processingDate ?? '') }))
    .filter((i) => i.id && /^\d{4}-\d{2}-\d{2}$/.test(i.date) && (!since || i.date >= since))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** The text of every segment file of one instance. */
export async function instanceFiles(fetchFn: FetchFn, token: string, instanceId: string): Promise<string[]> {
  const segments = await asc(fetchFn, token, `/v1/analyticsReportInstances/${instanceId}/segments`);
  const files: string[] = [];
  for (const segment of dataOf(segments)) {
    const url = segment.attributes?.url;
    if (typeof url !== 'string') continue;
    // A pre-signed download URL: it carries its own authorization, and the token is not sent to it.
    const res = await fetchFn(url, { signal: AbortSignal.timeout(60_000) }).catch(() => null);
    if (!res || !res.ok) throw new Error(`apple_segment_${res?.status ?? 'network'}`);
    files.push(await segmentText(res));
  }
  return files;
}

/** The first day a reread starts from: null on the first run (nothing covered yet), so every instance is read. */
export const rereadSince = (now: Date, coveredFrom: string | null): string | null =>
  coveredFrom ? addDays(now.toISOString().slice(0, 10), -APPLE_REREAD_DAYS) : null;

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

  const instances = await dailyInstances(deps.fetch, token, String(report.id), rereadSince(now, deps.coveredFrom));
  let rows = 0;
  let first: string | null = null;
  for (const instance of instances) {
    const merged = new Map<string, AppleRow>();
    for (const text of await instanceFiles(deps.fetch, token, instance.id)) {
      const parsed = parseDownloads(text);
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
