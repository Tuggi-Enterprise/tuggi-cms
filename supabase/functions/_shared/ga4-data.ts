// _shared/ga4-data.ts
//
// The Google Analytics Data API v1beta, read only, for the site block of the cycle report (#993,
// BR-B2B-059 item 7e). A service account signs a JWT (RS256, WebCrypto), Google trades it for an
// access token, and `runReport` reads one property.
//
// Docs, checked 2026-10-22: runReport is `POST https://analyticsdata.googleapis.com/v1beta/
// properties/{id}:runReport` with the scope `analytics.readonly`; the pagePath filter is a
// `StringFilter` with `matchType: FULL_REGEXP`; rows whose metrics are all zero are left out unless
// `keepEmptyRows`. Token: the OAuth 2.0 service account flow (grant type jwt-bearer).
//
// Import-free: WebCrypto and `fetch` exist in Deno and in Node, so the CMS tests run it as is.
// The credential is the secret `GA4_SERVICE_ACCOUNT_JSON` (the JSON key Google downloads); only
// `client_email` and `private_key` are read, and the token goes to Google's own URL, never to a
// `token_uri` written in the secret.

export const GA4_CREDENTIALS_ENV = 'GA4_SERVICE_ACCOUNT_JSON';
export const GA4_SCOPE = 'https://www.googleapis.com/auth/analytics.readonly';
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const GA4_API = 'https://analyticsdata.googleapis.com/v1beta';
/** The API's default and the most this job ever reads: the city list of a page. */
export const GA4_ROW_LIMIT = 10000;

export type ServiceAccount = { clientEmail: string; privateKey: string };

/** The JSON key of the service account, or null when it is absent or not one. */
export function parseServiceAccount(raw: string | undefined | null): ServiceAccount | null {
  if (!raw || !raw.trim()) return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!v || typeof v !== 'object') return null;
  const { client_email, private_key } = v as Record<string, unknown>;
  if (typeof client_email !== 'string' || !client_email.includes('@')) return null;
  if (typeof private_key !== 'string' || !private_key.includes('PRIVATE KEY')) return null;
  return { clientEmail: client_email, privateKey: private_key };
}

/** One report: users of the pages whose path fully matches `pathPattern`, optionally by city. */
export type Ga4Query = { pathPattern: string; from: string; to: string; byCity?: boolean };
export type Ga4Row = { city: string | null; users: number };
/** Throws when Google refuses or does not answer: the caller decides what a failed read means. */
export type Ga4 = (q: Ga4Query) => Promise<Ga4Row[]>;

export function ga4ReportBody(q: Ga4Query): Record<string, unknown> {
  return {
    dateRanges: [{ startDate: q.from, endDate: q.to }],
    ...(q.byCity ? { dimensions: [{ name: 'city' }] } : {}),
    metrics: [{ name: 'totalUsers' }],
    dimensionFilter: {
      filter: { fieldName: 'pagePath', stringFilter: { matchType: 'FULL_REGEXP', value: q.pathPattern, caseSensitive: false } },
    },
    ...(q.byCity ? { orderBys: [{ metric: { metricName: 'totalUsers' }, desc: true }] } : {}),
    limit: String(GA4_ROW_LIMIT),
  };
}

/** `rows[].dimensionValues[0].value` and `metricValues[0].value` (a string); no rows is no users. */
export function ga4Rows(body: unknown, byCity: boolean): Ga4Row[] {
  const rows = body && typeof body === 'object' ? (body as { rows?: unknown }).rows : undefined;
  if (!Array.isArray(rows)) return [];
  const out: Ga4Row[] = [];
  for (const r of rows) {
    const metric = Number((r as { metricValues?: { value?: unknown }[] })?.metricValues?.[0]?.value);
    if (!Number.isFinite(metric) || metric <= 0) continue;
    const dim = (r as { dimensionValues?: { value?: unknown }[] })?.dimensionValues?.[0]?.value;
    out.push({ city: byCity && typeof dim === 'string' ? dim : null, users: Math.floor(metric) });
  }
  return out;
}

const b64url = (bytes: Uint8Array): string => {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
};

function pemToDer(pem: string): Uint8Array<ArrayBuffer> {
  const body = pem.replace(/\\n/g, '\n').replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '').replace(/\s+/g, '');
  const bin = atob(body);
  const der = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) der[i] = bin.charCodeAt(i);
  return der;
}

/** The signed assertion of the jwt-bearer grant, valid for one hour (Google's maximum). */
export async function serviceAccountAssertion(sa: ServiceAccount, nowSeconds: number): Promise<string> {
  const enc = new TextEncoder();
  const header = b64url(enc.encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const claims = b64url(enc.encode(JSON.stringify({ iss: sa.clientEmail, scope: GA4_SCOPE, aud: GOOGLE_TOKEN_URL, iat: nowSeconds, exp: nowSeconds + 3600 })));
  const key = await crypto.subtle.importKey('pkcs8', pemToDer(sa.privateKey), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(`${header}.${claims}`)));
  return `${header}.${claims}.${b64url(sig)}`;
}

type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

/**
 * A `Ga4` for one property. The token is drawn on the first report and reused for the run (the job
 * lasts seconds; the token one hour). Errors carry the HTTP status only: Google's body can echo the
 * request, and nothing of it goes to the log.
 */
export function ga4Client(sa: ServiceAccount, propertyId: string, fetchFn: FetchFn, now: () => number = Date.now): Ga4 {
  let token: Promise<string> | null = null;
  const accessToken = () =>
    (token ??= (async () => {
      const assertion = await serviceAccountAssertion(sa, Math.floor(now() / 1000));
      const res = await fetchFn(GOOGLE_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${assertion}`,
        signal: AbortSignal.timeout(10_000),
      });
      const body = (await res.json().catch(() => null)) as { access_token?: unknown } | null;
      if (!res.ok || typeof body?.access_token !== 'string') {
        token = null;
        throw new Error(`ga4_token_${res.status}`);
      }
      return body.access_token;
    })());
  return async (q) => {
    const res = await fetchFn(`${GA4_API}/properties/${propertyId}:runReport`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(ga4ReportBody(q)),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`ga4_report_${res.status}`);
    return ga4Rows(await res.json(), q.byCity === true);
  };
}
