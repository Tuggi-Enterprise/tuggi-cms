// _shared/places-report-close-runtime.ts — the Deno wiring of `places-report-close.ts` (#993):
// service-role reads and RPCs of the cycle report, GA4 from the secret, Resend with the reply to
// the support. Every database read throws on error; the run turns it into an alert and a status.

import { createAdminClient } from './supabase-client.ts';
import { alert } from './places-payment-runtime.ts';
import { sendEmailWithId } from './places-access-link-runtime.ts';
import { normalEmail, portalOrigin, PORTAL_ORIGIN_ENV } from './places-portal-draft.ts';
import { GA4_CREDENTIALS_ENV, ga4Client, parseServiceAccount } from './ga4-data.ts';
import {
  ACCESS_FROM_NAME,
  GA4_PROPERTY_ID,
  SUPPORT_EMAIL,
  type CloseDeps,
  type CycleRow,
  type PlaceRef,
  type PublishedRoute,
} from './places-report-close.ts';

/** Ids per `.in()`: keeps the URL of the request short whatever the number of places. */
const CHUNK = 100;
const chunks = <T>(xs: T[]): T[][] => Array.from({ length: Math.ceil(xs.length / CHUNK) }, (_, i) => xs.slice(i * CHUNK, (i + 1) * CHUNK));
const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
type Rec = Record<string, unknown>;
const recs = (data: unknown): Rec[] => (Array.isArray(data) ? (data as Rec[]) : []);

export function reportCloseDeps(): CloseDeps {
  const admin = createAdminClient();
  const partner = () => admin.schema('partner');
  const cycles = () => partner().from('place_report_cycles');
  const rpc = async (fn: string, args: Record<string, unknown>) => {
    try {
      const { data, error } = await partner().rpc(fn, args);
      return { data, error: error ? { code: error.code, details: error.details, message: error.message } : null };
    } catch {
      return { data: null, error: { code: 'network' } };
    }
  };
  const sa = parseServiceAccount(Deno.env.get(GA4_CREDENTIALS_ENV));

  return {
    compute: (cycleEnd) => rpc('report_cycle_compute', { p_cycle_end: cycleEnd, p_force: false }),
    publish: (cycleEnd, site) => rpc('report_cycle_publish', { p_cycle_end: cycleEnd, p_site: site }),

    async cycleRows(cycleEnd): Promise<CycleRow[]> {
      const { data, error } = await cycles()
        .select('submission_id, period_from, plan, published_at, email_sent_at, city:payload->city->>name, compare:payload->compare')
        .eq('cycle_end', cycleEnd)
        .order('submission_id')
        .limit(5000);
      if (error) throw new Error(`cycles read ${error.code}`);
      return recs(data).map((r) => ({
        submissionId: String(r.submission_id),
        periodFrom: String(r.period_from),
        plan: String(r.plan),
        cityName: str(r.city),
        hasCompare: !!r.compare && typeof r.compare === 'object' && Object.keys(r.compare).length > 0,
        publishedAt: str(r.published_at),
        emailSentAt: str(r.email_sent_at),
      }));
    },

    async liveTargets() {
      const { data, error } = await partner()
        .from('place_submissions')
        .select('id, city:answers->>city')
        .eq('status', 'live')
        .not('attraction_id', 'is', null)
        .order('id')
        .limit(5000);
      if (error) throw new Error(`live read ${error.code}`);
      return recs(data).map((r) => ({ submissionId: String(r.id), cityName: str(r.city) }));
    },

    async placeRefs(ids): Promise<Map<string, PlaceRef>> {
      const out = new Map<string, PlaceRef>();
      for (const part of chunks(ids)) {
        const [subs, slugs] = await Promise.all([
          partner().from('place_submissions').select('id, attraction_id, trade_name:answers->>trade_name').in('id', part),
          partner().from('place_slugs').select('slug, submission_id').in('submission_id', part),
        ]);
        if (subs.error || slugs.error) throw new Error(`refs read ${subs.error?.code ?? slugs.error?.code}`);
          const subRows = recs(subs.data);
        // The `/d/` of the client the place belongs to: the page the place slug answers with (resolve_partner_slug).
        const poiIds = subRows.map((s) => str(s.attraction_id)).filter((x): x is string => !!x);
        const clientOf = new Map<string, string>();
        if (poiIds.length) {
          const pois = await admin.schema('core').from('attractions').select('id, partner_client_id').in('id', poiIds);
          if (pois.error) throw new Error(`attractions read ${pois.error.code}`);
              for (const p of recs(pois.data)) {
            const cid = str(p.partner_client_id);
            if (cid) clientOf.set(String(p.id), cid);
          }
        }
        const clientSlug = new Map<string, string>();
        const clientIds = [...new Set(clientOf.values())];
        if (clientIds.length) {
          const cs = await partner().from('clients').select('id, slug').in('id', clientIds);
          if (cs.error) throw new Error(`clients read ${cs.error.code}`);
              for (const c of recs(cs.data)) {
            const slug = str(c.slug);
            if (slug) clientSlug.set(String(c.id), slug);
          }
        }
          const slugRows = recs(slugs.data);
        for (const s of subRows) {
          const aid = str(s.attraction_id);
          const own = slugRows.filter((x) => x.submission_id === s.id).map((x) => String(x.slug));
          const cid = aid ? clientOf.get(aid) : undefined;
          const cslug = cid ? clientSlug.get(cid) : undefined;
          if (cslug) own.push(cslug);
          out.set(String(s.id), { attractionId: aid, ownSlugs: own, placeName: str(s.trade_name) ?? '' });
        }
      }
      return out;
    },

    async publishedRoutes(): Promise<PublishedRoute[]> {
      const { data, error } = await admin
        .schema('core')
        .from('custom_routes')
        .select('id, name, country, metadata, waypoints')
        .eq('is_active', true)
        .eq('visibility', 'public');
      if (error) throw new Error(`routes read ${error.code}`);
      return (data ?? []) as PublishedRoute[];
    },

    ga4: sa ? ga4Client(sa, GA4_PROPERTY_ID, (url, init) => fetch(url, init)) : null,

    async claimEmail(submissionId, cycleEnd) {
      const { data, error } = await cycles()
        .update({ email_sent_at: new Date().toISOString() })
        .eq('submission_id', submissionId)
        .eq('cycle_end', cycleEnd)
        .is('email_sent_at', null)
        .not('published_at', 'is', null)
        .select('email_sent_at');
      if (error) throw new Error(`claim ${error.code}`);
      return Array.isArray(data) && data.length === 1 ? str(data[0].email_sent_at) : null;
    },

    async releaseEmail(submissionId, cycleEnd, claimedAt) {
      const { error } = await cycles()
        .update({ email_sent_at: null })
        .eq('submission_id', submissionId)
        .eq('cycle_end', cycleEnd)
        .eq('email_sent_at', claimedAt);
      if (error) throw new Error(`release ${error.code}`);
    },

    /** The owner's sign-in e-mail; before the claim, the acceptance's; a legacy mirror, its contact (as `place_issue_claim`). */
    async recipient(submissionId) {
      const { data, error } = await partner().from('place_submissions').select('account_id, contact_email').eq('id', submissionId).maybeSingle();
      if (error) throw new Error(`recipient read ${error.code}`);
      if (str(data?.account_id)) {
        const u = await admin.auth.admin.getUserById(data!.account_id);
        const email = normalEmail(u.data?.user?.email);
        if (email) return email;
      }
      const acc = await partner().from('place_acceptances').select('email').eq('submission_id', submissionId).maybeSingle();
      if (acc.error) throw new Error(`acceptance read ${acc.error.code}`);
      return normalEmail(acc.data?.email) ?? normalEmail(data?.contact_email);
    },

    sendEmail: async (to, mail) => (await sendEmailWithId(to, mail.subject, mail.html, mail.text, ACCESS_FROM_NAME, SUPPORT_EMAIL)) !== null,
    alert,
    pause: (ms) => new Promise((r) => setTimeout(r, ms)),
    origin: portalOrigin(Deno.env.get(PORTAL_ORIGIN_ENV)),
    now: () => new Date(),
  };
}
