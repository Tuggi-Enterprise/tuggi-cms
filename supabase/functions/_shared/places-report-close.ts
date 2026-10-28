// _shared/places-report-close.ts
//
// The pure half of `places-report-close` (#993): the cycle report of every live place is frozen,
// gets its site block from GA4, is published, and the owner gets one e-mail. Rule BR-B2B-059
// items 3, 4, 5 and 7e. Contract: `docs/contracts/places-cms.md` (workspace), common contract of
// #992 to #994 for the table and the payload.
//
// The numbers of the app are the database's (`partner.report_cycle_compute`); this file adds only
// the `site` block and the e-mail. Import-free but pure siblings, so the CMS tests run it under
// Node; `places-report-close-runtime.ts` wires the database, GA4 and Resend.
//
// Order of a run: check the cycle, compute (skipped in dry run), site block of each row not yet
// published, publish, then the e-mail of each published row without `email_sent_at`. GA4 down or
// not configured stops the run BEFORE publishing: a cycle published without its site block would
// stay without it (item 3, frozen), so the run alerts and the operator runs it again.

import { saoPauloDate, SUPPORT_EMAIL } from './places-payment.ts';
import { ACCESS_FROM_NAME, placeNameForMail, portalMail, type RpcError } from './places-portal-draft.ts';
import { SEND_SPACING_MS } from './places-legacy-access.ts';
import type { Ga4, Ga4Row } from './ga4-data.ts';

/** BR-B2B-059 item 5: the first cycle the platform publishes. */
export const FIRST_CYCLE_END = '2026-09-20';
/** BR-B2B-059 item 2: the cycle closes on this day of the month, America/Sao_Paulo. */
export const CYCLE_END_DAY = 20;
/** BR-B2B-059 item 7e: the Institucional property of GA4. */
export const GA4_PROPERTY_ID = '494999879';
/** The reports tab of the portal (#994). */
export const REPORTS_PATH = '/status/relatorios';
/** BR-B2B-059 item 7e: how many cities the block lists. */
export const TOP_CITIES = 3;

export { ACCESS_FROM_NAME, SUPPORT_EMAIL };

// ─── the request ───────────────────────────────────────────────────────────────────────────────

export type CloseRequest = { cycleEnd: string | null; sendEmail: boolean; dryRun: boolean };

const CYCLE_END = /^(\d{4})-(0[1-9]|1[0-2])-20$/;
const KEYS = new Set(['cycle_end', 'send_email', 'dry_run']);

/**
 * `{ cycle_end?: "YYYY-MM-20", send_email?: boolean, dry_run?: boolean }`. An empty body (the cron)
 * takes the defaults: the last closed cycle, e-mail on, for real. An unknown key is refused, so a
 * typo in `dry_run` never becomes a real run that e-mails the clients.
 */
export function parseCloseRequest(raw: string): CloseRequest | null {
  const text = raw.trim();
  let body: unknown = {};
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      return null;
    }
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const b = body as Record<string, unknown>;
  if (Object.keys(b).some((k) => !KEYS.has(k))) return null;
  const { cycle_end, send_email, dry_run } = b;
  if (cycle_end !== undefined && cycle_end !== null && (typeof cycle_end !== 'string' || !CYCLE_END.test(cycle_end))) return null;
  if (send_email !== undefined && typeof send_email !== 'boolean') return null;
  if (dry_run !== undefined && typeof dry_run !== 'boolean') return null;
  return { cycleEnd: (cycle_end as string | null | undefined) ?? null, sendEmail: send_email ?? true, dryRun: dry_run ?? false };
}

const pad = (n: number) => String(n).padStart(2, '0');

/** The day 20 of the month `delta` months from `y-m`, `YYYY-MM-20`. */
function day20(y: number, m: number, delta: number): string {
  const d = new Date(Date.UTC(y, m - 1 + delta, CYCLE_END_DAY));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(CYCLE_END_DAY)}`;
}

/** The last cycle whose day 20 is over in America/Sao_Paulo (BR-B2B-059 item 3). */
export function latestClosedCycleEnd(now: Date): string {
  const [y, m, d] = saoPauloDate(now).split('-').map(Number);
  return day20(y, m, d > CYCLE_END_DAY ? 0 : -1);
}

/** The first day of the cycle that ends on `cycleEnd`: the 21st of the month before. */
export function cycleStart(cycleEnd: string): string {
  const [y, m] = cycleEnd.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 2, CYCLE_END_DAY + 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function cycleRefusal(cycleEnd: string, now: Date): 'cycle_not_closed' | 'before_first_cycle' | null {
  if (cycleEnd < FIRST_CYCLE_END) return 'before_first_cycle';
  if (saoPauloDate(now) <= cycleEnd) return 'cycle_not_closed';
  return null;
}

// ─── the pages of the site where a place appears ───────────────────────────────────────────────

/**
 * Twin of `slugify` in `tuggi-enterprise/scripts/update-routes.mjs`, the script that builds the
 * route pages of the site from the same rows (`core.custom_routes`). A change there changes this.
 */
export function slugify(s: unknown): string {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['`]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

/** Twin of `countrySlugOf` in the same script. */
export function countrySlugOf(raw: unknown): string {
  const s = slugify(raw);
  const map: Record<string, string> = {
    brasil: 'brazil',
    espanha: 'spain',
    espana: 'spain',
    'estados-unidos': 'united-states',
    usa: 'united-states',
    us: 'united-states',
    'reino-unido': 'united-kingdom',
    uk: 'united-kingdom',
    italia: 'italy',
    franca: 'france',
  };
  return map[s] ?? s;
}

/** A row of `core.custom_routes`, active and public: the routes the site publishes. */
export type PublishedRoute = { id: string; name: string | null; country: string | null; metadata: unknown; waypoints: unknown };

export type SiteRoute = {
  id: string;
  title: string;
  /** The path shown in the report: the Portuguese page. */
  path: string;
  /** The page path without locale, as a regex fragment (both slugs the site may have given it). */
  pattern: string;
  attractionIds: Set<string>;
};

const asJson = (v: unknown, fallback: unknown): unknown => {
  if (v == null) return fallback;
  if (typeof v === 'object') return v;
  try {
    return JSON.parse(String(v));
  } catch {
    return fallback;
  }
};

/**
 * The route pages of the site, with the places that are a stop of each one (the `attraction_id`
 * of a waypoint that is not generic, as the site reads it). The site gives a colliding name the
 * suffix `-<6 chars of the id>` in the order the rows come; both forms match here, and GA4 is the
 * judge of which page exists: a page that never existed has no user.
 */
export function siteRoutes(rows: PublishedRoute[]): SiteRoute[] {
  const out: SiteRoute[] = [];
  for (const r of rows) {
    const metadata = asJson(r.metadata, {}) as Record<string, unknown>;
    const country = r.country ?? (typeof metadata?.country === 'string' ? metadata.country : null);
    if (!country || !r.id) continue;
    const id6 = String(r.id).slice(0, 6);
    const slug = slugify(r.name) || `route-${id6}`;
    const countrySlug = countrySlugOf(country);
    if (!countrySlug) continue;
    const attractionIds = new Set<string>();
    const waypoints = asJson(r.waypoints, []);
    for (const w of Array.isArray(waypoints) ? waypoints : []) {
      const wm = (w?.metadata ?? {}) as Record<string, unknown>;
      const aid = wm.attraction_id ?? w?.attraction_id ?? null;
      if (typeof aid === 'string' && aid && wm.is_generic !== true) attractionIds.add(aid.toLowerCase());
    }
    if (!attractionIds.size) continue;
    out.push({
      id: r.id,
      title: (r.name ?? '').trim() || slug,
      path: `/pt/tours/${countrySlug}/${slug}`,
      pattern: `tours/${countrySlug}/(${slug}|${slug}-${id6})`,
      attractionIds,
    });
  }
  return out;
}

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
/** A page of the site, with or without the locale prefix, with or without the trailing slash. */
const pagePattern = (fragments: string[]) => `^(/[a-z]{2})?/(${fragments.join('|')})/?$`;
/** The partner link `/d/<slug>` and `/{locale}/d/<slug>`, for every slug of the place. */
export const ownLinkPattern = (slugs: string[]): string | null => {
  const ok = [...new Set(slugs.map((s) => s.trim().toLowerCase()).filter((s) => SLUG.test(s)))].sort();
  return ok.length ? pagePattern(ok.map((s) => `d/${s}`)) : null;
};
export const routePattern = (routes: Pick<SiteRoute, 'pattern'>[]): string => pagePattern(routes.map((r) => r.pattern).sort());

// ─── the site block ────────────────────────────────────────────────────────────────────────────

export type SitePage = { path: string; title: string; users: number };
export type SiteBlock = {
  pages?: SitePage[];
  cities_count?: number;
  outside_city_pct?: number;
  top_cities?: { name: string; users: number }[];
  own_link_users?: number;
};

const NOT_SET = '(not set)';
const cityKey = (s: string) => slugify(s);

/**
 * BR-B2B-059 items 6 and 7e: a zero is never a number, `(not set)` is no city, and a block with
 * nothing is no block (null). The cities are the ones of the route pages: the partner link is
 * opened from the QR on the table, by people already in the city. The share outside the place's
 * city is rounded down, like every percentage of the report (item 8), and it is the share of the
 * people who opened the site, by GA4's city.
 */
export function siteBlock(input: { pages: SitePage[]; cities: Ga4Row[]; ownLinkUsers: number; cityName: string | null }): SiteBlock | null {
  const block: SiteBlock = {};
  const pages = input.pages.filter((p) => p.users > 0).sort((a, b) => b.users - a.users || a.path.localeCompare(b.path));
  if (pages.length) block.pages = pages;
  const cities = input.cities.filter((c) => c.users > 0 && typeof c.city === 'string' && c.city.trim() && c.city.trim() !== NOT_SET);
  if (pages.length && cities.length) {
    cities.sort((a, b) => b.users - a.users);
    block.cities_count = cities.length;
    block.top_cities = cities.slice(0, TOP_CITIES).map((c) => ({ name: (c.city as string).trim(), users: c.users }));
    if (input.cityName && cityKey(input.cityName)) {
      const total = cities.reduce((n, c) => n + c.users, 0);
      const outside = cities.filter((c) => cityKey(c.city as string) !== cityKey(input.cityName as string)).reduce((n, c) => n + c.users, 0);
      const pct = Math.floor((100 * outside) / total);
      if (pct > 0) block.outside_city_pct = pct;
    }
  }
  if (input.ownLinkUsers > 0) block.own_link_users = input.ownLinkUsers;
  return Object.keys(block).length ? block : null;
}

// ─── the e-mail ────────────────────────────────────────────────────────────────────────────────

export type ReportMail = { placeName: string; cityName: string | null; cycleEnd: string; periodFrom: string; plan: string; hasCompare: boolean };

const monthName = (date: string) => new Intl.DateTimeFormat('pt-BR', { month: 'long', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));
const dayMonth = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`;

/**
 * The e-mail of the day 21 (copy `docs/design/copy/relatorio-do-ciclo-2026-10.md` §7, in the layout
 * of `legacyAccessEmail`). BR-B2B-059 items 1 and 4: it says the report is ready and leads to the
 * portal, with no number of the report. The only digits are the two dates of the period. The free
 * plan gets the comparison paragraph only when the payload has `compare` (without both sides in
 * the city the sentence would lie).
 */
export function reportCycleEmail(v: ReportMail, origin: string): { subject: string; html: string; text: string } {
  const host = new URL(origin).host;
  const name = placeNameForMail(v.placeName) || 'Seu local';
  const month = monthName(v.cycleEnd);
  const city = (v.cityName ?? '').trim();
  const inCity = city ? `em ${city}` : 'na sua cidade';
  const from = dayMonth(v.periodFrom);
  const to = dayMonth(v.cycleEnd);
  return portalMail({
    subject: `Seu relatório de ${month} no Tuggi está pronto`,
    preheader: `Quanta gente usou o Tuggi ${inCity} de ${from} a ${to}, e quantas passaram pela sua porta.`,
    paragraphs: [
      'Olá,',
      `${name} já tem o relatório de ${month} no painel: quanta gente usou o Tuggi ${inCity}, quantas pessoas passaram pela sua porta e o que o local aproveitou no período.`,
      'Dá para baixar em PDF e mandar para o sócio.',
      ...(v.plan === 'free' && v.hasCompare
        ? [`O relatório também mostra o que os locais do plano Experiência alcançam a mais ${inCity}, e a troca de plano é feita no mesmo painel.`]
        : []),
    ],
    cta: { label: 'Ver o relatório', url: `${origin}${REPORTS_PATH}` },
    small: [`Se o botão não abrir, entre em ${host} com este e-mail.`, 'Não reconhece este local? Escreva para suporte@tuggi.app.'],
  });
}

// ─── the run ───────────────────────────────────────────────────────────────────────────────────

/** A row of `partner.place_report_cycles` for the cycle, with what the run needs of the payload. */
export type CycleRow = {
  submissionId: string;
  periodFrom: string;
  plan: string;
  cityName: string | null;
  hasCompare: boolean;
  publishedAt: string | null;
  emailSentAt: string | null;
};

/** What the site block and the e-mail need of a submission. */
export type PlaceRef = { attractionId: string | null; ownSlugs: string[]; placeName: string };

export type CloseDeps = {
  /** `partner.report_cycle_compute(p_cycle_end, false)`: rows written. */
  compute: (cycleEnd: string) => Promise<{ data: unknown; error: RpcError | null }>;
  /** `partner.report_cycle_publish(p_cycle_end, p_site)`. */
  publish: (cycleEnd: string, site: Record<string, SiteBlock>) => Promise<{ data: unknown; error: RpcError | null }>;
  /** Every row of the cycle. Throws when the read fails. */
  cycleRows: (cycleEnd: string) => Promise<CycleRow[]>;
  /** Dry run before the compute: the live submissions with a place, and the city they typed. */
  liveTargets: () => Promise<{ submissionId: string; cityName: string | null }[]>;
  placeRefs: (submissionIds: string[]) => Promise<Map<string, PlaceRef>>;
  publishedRoutes: () => Promise<PublishedRoute[]>;
  /** Null when `GA4_SERVICE_ACCOUNT_JSON` is absent or not a service account key. */
  ga4: Ga4 | null;
  /**
   * Marks the e-mail of one row as sent BEFORE sending it, only if the row is published and has no
   * `email_sent_at` (a conditional update). The mark it wrote, or null when another run has it.
   * Throws when the write fails.
   */
  claimEmail: (submissionId: string, cycleEnd: string) => Promise<string | null>;
  /** Undoes the mark of a send that failed, only if it is still `claimedAt`. */
  releaseEmail: (submissionId: string, cycleEnd: string, claimedAt: string) => Promise<void>;
  /** The e-mail the owner signs in with, or null. */
  recipient: (submissionId: string) => Promise<string | null>;
  sendEmail: (to: string, mail: { subject: string; html: string; text: string }) => Promise<boolean>;
  alert: (what: string, fields: Record<string, string | number | null | undefined>) => Promise<void>;
  pause: (ms: number) => Promise<void>;
  origin: string;
  now: () => Date;
};

export type EmailStatus = 'sent' | 'failed' | 'no_recipient' | 'already_sent' | 'would_send' | 'off';
export type CloseOutcome = { submission_id: string; site: boolean | SiteBlock | null; email?: EmailStatus };
export type CloseResult = { status: number; body: Record<string, unknown> };

const codeOf = (e: unknown) => (e instanceof Error ? e.message.slice(0, 64) : 'unknown');

/** The site block of every target, one GA4 report per distinct page set and period. */
async function siteBlocks(
  ga4: Ga4,
  targets: { submissionId: string; periodFrom: string; cityName: string | null }[],
  refs: Map<string, PlaceRef>,
  routes: SiteRoute[],
  cycleEnd: string,
): Promise<Map<string, SiteBlock | null>> {
  const cache = new Map<string, Promise<Ga4Row[]>>();
  const report = (pathPattern: string, from: string, byCity: boolean) => {
    const key = `${byCity ? 'city' : 'users'}|${from}|${pathPattern}`;
    if (!cache.has(key)) cache.set(key, ga4({ pathPattern, from, to: cycleEnd, byCity }));
    return cache.get(key) as Promise<Ga4Row[]>;
  };
  const out = new Map<string, SiteBlock | null>();
  for (const t of targets) {
    const ref = refs.get(t.submissionId);
    const aid = ref?.attractionId?.toLowerCase() ?? null;
    const mine = aid ? routes.filter((r) => r.attractionIds.has(aid)) : [];
    const pages: SitePage[] = [];
    for (const r of mine) {
      const rows = await report(routePattern([r]), t.periodFrom, false);
      pages.push({ path: r.path, title: r.title, users: rows[0]?.users ?? 0 });
    }
    const cities = pages.some((p) => p.users > 0) ? await report(routePattern(mine), t.periodFrom, true) : [];
    const own = ownLinkPattern(ref?.ownSlugs ?? []);
    const ownLinkUsers = own ? ((await report(own, t.periodFrom, false))[0]?.users ?? 0) : 0;
    out.set(t.submissionId, siteBlock({ pages, cities, ownLinkUsers, cityName: t.cityName }));
  }
  return out;
}

/**
 * One run. 200 with the outcome of each submission (ids, site block present or not, e-mail status;
 * the dry run shows the block itself); 400 for a body or a cycle it refuses; 502 when the database
 * fails; 503 when GA4 cannot be read, with nothing published. No name and no e-mail address in the
 * answer or in the log.
 */
export async function runReportClose(deps: CloseDeps, raw: string): Promise<CloseResult> {
  const req = parseCloseRequest(raw);
  if (!req) return { status: 400, body: { error: 'invalid_body' } };
  const now = deps.now();
  const cycleEnd = req.cycleEnd ?? latestClosedCycleEnd(now);
  const refusal = cycleRefusal(cycleEnd, now);
  if (refusal) return { status: 400, body: { error: refusal, cycle_end: cycleEnd } };
  const head = { cycle_end: cycleEnd, dry_run: req.dryRun, send_email: req.sendEmail };

  let computed: number | null = null;
  if (!req.dryRun) {
    const c = await deps.compute(cycleEnd);
    if (c.error) {
      await deps.alert('report_close_compute_failed', { cycle_end: cycleEnd, code: c.error.code ?? 'unknown' });
      return { status: 502, body: { ...head, error: 'compute_failed' } };
    }
    computed = typeof c.data === 'number' ? c.data : Number(c.data) || 0;
  }

  let rows: CycleRow[];
  try {
    rows = await deps.cycleRows(cycleEnd);
  } catch (e) {
    await deps.alert('report_close_read_failed', { cycle_end: cycleEnd, code: codeOf(e) });
    return { status: 502, body: { ...head, error: 'read_failed' } };
  }

  // The site block of the rows still hidden; a published row is frozen (item 3). The dry run shows
  // every row, and before the compute the live submissions.
  let targets = rows.filter((r) => req.dryRun || !r.publishedAt).map((r) => ({ submissionId: r.submissionId, periodFrom: r.periodFrom, cityName: r.cityName }));
  if (req.dryRun && !rows.length) {
    const start = cycleStart(cycleEnd);
    try {
      targets = (await deps.liveTargets()).map((t) => ({ ...t, periodFrom: start }));
    } catch (e) {
      return { status: 502, body: { ...head, error: 'read_failed', code: codeOf(e) } };
    }
  }

  const blocks = new Map<string, SiteBlock | null>();
  if (targets.length) {
    if (!deps.ga4) {
      await deps.alert('report_close_ga4_not_configured', { cycle_end: cycleEnd });
      return { status: 503, body: { ...head, computed, error: 'ga4_unavailable' } };
    }
    try {
      const refs = await deps.placeRefs(targets.map((t) => t.submissionId));
      const routes = siteRoutes(await deps.publishedRoutes());
      for (const [id, b] of await siteBlocks(deps.ga4, targets, refs, routes, cycleEnd)) blocks.set(id, b);
    } catch (e) {
      await deps.alert('report_close_ga4_failed', { cycle_end: cycleEnd, code: codeOf(e) });
      return { status: 503, body: { ...head, computed, error: 'ga4_unavailable' } };
    }
  }

  if (req.dryRun) {
    const pending = new Set(rows.filter((r) => !r.emailSentAt).map((r) => r.submissionId));
    const results: CloseOutcome[] = targets.map((t) => ({
      submission_id: t.submissionId,
      site: blocks.get(t.submissionId) ?? null,
      email: !req.sendEmail ? 'off' : rows.length && !pending.has(t.submissionId) ? 'already_sent' : 'would_send',
    }));
    return { status: 200, body: { ...head, computed: null, published: 0, targets: targets.length, results } };
  }

  let published = 0;
  if (targets.length) {
    const site: Record<string, SiteBlock> = {};
    for (const [id, b] of blocks) if (b) site[id] = b;
    const p = await deps.publish(cycleEnd, site);
    if (p.error) {
      await deps.alert('report_close_publish_failed', { cycle_end: cycleEnd, code: p.error.code ?? 'unknown' });
      return { status: 502, body: { ...head, computed, error: 'publish_failed' } };
    }
    published = typeof p.data === 'number' ? p.data : Number(p.data) || 0;
  }

  const results = new Map<string, CloseOutcome>();
  for (const t of targets) results.set(t.submissionId, { submission_id: t.submissionId, site: Boolean(blocks.get(t.submissionId)) });

  if (req.sendEmail) {
    let after: CycleRow[];
    try {
      after = await deps.cycleRows(cycleEnd);
    } catch (e) {
      await deps.alert('report_close_read_failed', { cycle_end: cycleEnd, code: codeOf(e) });
      return { status: 502, body: { ...head, computed, published, error: 'read_failed' } };
    }
    const pending = after.filter((r) => r.publishedAt && !r.emailSentAt);
    const refs = pending.length ? await deps.placeRefs(pending.map((r) => r.submissionId)) : new Map<string, PlaceRef>();
    for (const r of after) {
      const out = results.get(r.submissionId) ?? { submission_id: r.submissionId, site: false };
      results.set(r.submissionId, out);
      if (!r.publishedAt) continue;
      if (r.emailSentAt) {
        out.email = 'already_sent';
        continue;
      }
      out.email = await mailOne(deps, r, refs.get(r.submissionId), cycleEnd);
    }
  }

  const list = [...results.values()];
  const counts: Record<string, number> = {};
  for (const o of list) {
    const k = `email:${o.email ?? 'off'}`;
    counts[k] = (counts[k] ?? 0) + 1;
  }
  counts.site = list.filter((o) => o.site === true).length;
  return { status: 200, body: { ...head, computed, published, counts, results: list } };
}

/** BR-B2B-059 item 4: claim, send, and undo the claim when the send fails (the next run retries). */
async function mailOne(deps: CloseDeps, r: CycleRow, ref: PlaceRef | undefined, cycleEnd: string): Promise<EmailStatus> {
  let claimed: string | null;
  try {
    claimed = await deps.claimEmail(r.submissionId, cycleEnd);
  } catch (e) {
    await deps.alert('report_email_claim_failed', { submission_id: r.submissionId, code: codeOf(e) });
    return 'failed';
  }
  if (!claimed) return 'already_sent';
  const release = async (what: string) => {
    try {
      await deps.releaseEmail(r.submissionId, cycleEnd, claimed as string);
    } catch (e) {
      await deps.alert('report_email_release_failed', { submission_id: r.submissionId, code: codeOf(e) });
    }
    await deps.alert(what, { submission_id: r.submissionId, cycle_end: cycleEnd });
  };
  let to: string | null;
  try {
    to = await deps.recipient(r.submissionId);
  } catch {
    to = null;
  }
  if (!to) {
    await release('report_email_no_recipient');
    return 'no_recipient';
  }
  const mail = reportCycleEmail(
    { placeName: ref?.placeName ?? '', cityName: r.cityName, cycleEnd, periodFrom: r.periodFrom, plan: r.plan, hasCompare: r.hasCompare },
    deps.origin,
  );
  if (!(await deps.sendEmail(to, mail))) {
    await release('report_email_failed');
    return 'failed';
  }
  await deps.pause(SEND_SPACING_MS);
  return 'sent';
}
