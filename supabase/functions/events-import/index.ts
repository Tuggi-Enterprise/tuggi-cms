/**
 * events-import: the weekly import of events from official tourism sources (#1075, BR-EVENTO-009).
 *
 *   POST {}   every active row of `core.event_sources` (pg_cron `events-import`, Monday 09:00 UTC)
 *   -> 200 [{ source_id, name, status, summary, recorded }], 500 when a `last_run_*` was not written
 *   -> 401 any caller without our secret key, 405 any other method, 400 a malformed chain body
 *
 *   POST { source_id }   that one active source only (a manual run of one city, #1077); same answers
 *
 *   POST { chain, run_started_at, done?, after?, only? }   the next link of a run, called by the function itself
 *   -> 202 at once; the link runs in the background (`EdgeRuntime.waitUntil`)
 *
 *   POST { sweep: true }   only closes the dead runs (#1091) -> 200 { closed: [source_id] }
 *
 * A run never stays `running` (#1091). A worker the platform shuts down with notice (memory, wall
 * clock) writes `error` with the reason on `beforeunload`. One killed without it, as the 2 s of CPU
 * do (seen on 2026-10-28, Tempora #53), is closed as `error` by the next call, once its source has
 * had no progress for `STALE_RUN_MS`.
 *
 * A link stops starting items at `RUN_BUDGET_MS`. When items are left it calls the next link,
 * without waiting, up to `MAX_CHAIN_LINKS`; the next one starts with the items not yet seen (SPTuris)
 * or after the last item key started (`after`, the generic readers), and skips the generic sources
 * already done (`done`). Sources go oldest `last_run_at` first.
 *
 * Machine key only (`isOwnSecretKey`), as `social-collect`: the cron sends the `ef_secret_key` of the
 * Vault. Deploy with `--no-verify-jwt`: no caller sends a JWT. The work is `_shared/events-import.ts`;
 * this file authenticates and wires the database and the bucket.
 */
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getSecretKey, isOwnSecretKey } from '../_shared/secret-key.ts';
import { type Geocoding } from '../_shared/events-sources.ts';
import {
  type EventSource,
  IMAGE_BUCKET,
  IMAGE_FETCH_TIMEOUT_MS,
  type ImportStore,
  isUuid,
  type KnownItem,
  messageOf,
  nextLink,
  readLink,
  runEventsImport,
  type RunLink,
  type RunningSource,
  type RunSummary,
  shutdownGuard,
  sweepStalled,
  UPLOAD_TIMEOUT_MS,
} from '../_shared/events-import.ts';

/** One row of `core.event_source_items` with the `image_url` of its attraction (FK `attraction_id`). */
interface KnownRow {
  external_id: string;
  source_hash: string;
  last_seen_at: string;
  attractions: { image_url: string | null } | { image_url: string | null }[] | null;
}

const KNOWN_ITEMS_PAGE = 1000;
/** The Places key, the same the CMS route /api/maps/geocode reads. */
const PLACES_KEY_SECRET = 'NEXT_PUBLIC_GOOGLE_MAPS_API_KEY';
const PLACES_SEARCH_URL = 'https://places.googleapis.com/v1/places:searchText';
const GEOCODE_TIMEOUT_MS = 10_000;

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void } | undefined;

/** The open calls of this worker; the platform may serve several on one. */
const openCalls = new Set<(reason: string) => Promise<void>>();

// The platform's notice before it shuts the worker down; `detail.reason` is CPUTime, Memory,
// WallClockTime, EarlyDrop or TerminationRequested (Supabase, "Edge Function shutdown reasons").
addEventListener('beforeunload', (ev) => {
  const reason = (ev as CustomEvent<{ reason?: string }>).detail?.reason ?? 'unknown';
  if (!openCalls.size) return;
  console.error(`[events-import] worker shutdown (${reason}) with ${openCalls.size} call(s) open`);
  for (const close of openCalls) inBackground(close(reason));
});

/** Keeps the worker alive for `task` after the response, where the platform offers it. */
const inBackground = (task: Promise<unknown>) => {
  if (typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(task);
};

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (!isOwnSecretKey(bearer)) return json({ error: 'unauthorized' }, 401);

  const body = await req.json().catch(() => ({}));
  const chained = readLink(body, Date.now());
  if (chained === 'invalid_chain') return json({ error: 'invalid_chain' }, 400);
  const only = (body as { source_id?: unknown } | null)?.source_id;
  if (!chained && only !== undefined && !isUuid(only)) return json({ error: 'invalid_source_id' }, 400);

  const supabaseUrl = (Deno.env.get('SUPABASE_URL') ?? '').trim();
  const secretKey = getSecretKey().trim();
  const supabase = createClient(supabaseUrl, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const core = supabase.schema('core');
  const publicUrl = (path: string) => supabase.storage.from(IMAGE_BUCKET).getPublicUrl(path).data.publicUrl;

  const db: ImportStore = {
    async runningSources() {
      const { data, error } = await core
        .from('event_sources')
        .select('id, last_run_status, last_run_summary')
        .eq('last_run_status', 'running');
      if (error) throw new Error(`event_sources running: ${error.code ?? 'unknown'}`);
      return ((data ?? []) as { id: string; last_run_status?: string; last_run_summary?: Partial<RunSummary> | null }[])
        .filter((r) => r.last_run_status === 'running')
        .map((r): RunningSource => ({ id: r.id, summary: r.last_run_summary ?? null }));
    },
    async activeSources() {
      const { data, error } = await core
        .from('event_sources')
        .select('id, name, adapter, base_url, timezone, city, state, country, credit, config')
        .eq('is_active', true)
        // The source that waited longest goes first, so 19 sources share the links of a run.
        .order('last_run_at', { ascending: true, nullsFirst: true });
      if (error) throw new Error(`event_sources: ${error.code ?? 'unknown'}`);
      return (data ?? []) as EventSource[];
    },
    // Page by page until an empty page: PostgREST cuts an answer at its max rows (1000 by default),
    // and a smaller cap must not end the walk early either.
    async knownItems(sourceId) {
      const items: KnownItem[] = [];
      for (let from = 0;;) {
        const { data, error } = await core
          .from('event_source_items')
          .select('external_id, source_hash, last_seen_at, attractions(image_url)')
          .eq('source_id', sourceId)
          .order('external_id')
          .range(from, from + KNOWN_ITEMS_PAGE - 1);
        if (error) throw new Error(`event_source_items: ${error.code ?? 'unknown'}`);
        const rows = (data ?? []) as KnownRow[];
        if (!rows.length) return items;
        for (const r of rows) {
          const attraction = Array.isArray(r.attractions) ? r.attractions[0] : r.attractions;
          items.push({
            external_id: r.external_id,
            source_hash: r.source_hash,
            last_seen_at: r.last_seen_at,
            poster_url: attraction?.image_url ?? null,
          });
        }
        from += rows.length;
      }
    },
    async saveProgress(sourceId, summary) {
      const { error } = await core
        .from('event_sources')
        .update({ last_run_status: 'running', last_run_summary: summary })
        .eq('id', sourceId);
      if (error) throw new Error(`event_sources progress: ${error.code ?? 'unknown'}`);
    },
    async upsertEvent(sourceId, externalId, payload) {
      const { data, error } = await core.rpc('import_event_upsert', {
        p_source_id: sourceId,
        p_external_id: externalId,
        p_payload: payload,
      });
      // The SQLSTATE and the message, never the payload: the message is ours (RAISE) or Postgres'.
      if (error) throw new Error(`rpc ${error.code ?? 'unknown'}: ${error.message ?? ''}`);
      return data;
    },
    async finishSource(sourceId, status, summary) {
      const { error } = await core
        .from('event_sources')
        .update({ last_run_at: new Date().toISOString(), last_run_status: status, last_run_summary: summary })
        .eq('id', sourceId);
      if (error) throw new Error(`event_sources update: ${error.code ?? 'unknown'}`);
    },
    // Storage over HTTP, not supabase-js: its upload takes no signal, and an upload that hangs must
    // end here, not at the 60 s of the gateway.
    async uploadImage(path, bytes, contentType) {
      const res = await fetch(`${supabaseUrl}/storage/v1/object/${IMAGE_BUCKET}/${path}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${secretKey}`,
          apikey: secretKey,
          'Content-Type': contentType,
          'x-upsert': 'true',
        },
        body: bytes,
        signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
      });
      await res.body?.cancel();
      if (!res.ok) throw new Error(`upload: http_${res.status}`);
      return publicUrl(path);
    },
    async storedImageUrl(path, size) {
      const url = publicUrl(path);
      const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(IMAGE_FETCH_TIMEOUT_MS) });
      await res.body?.cancel();
      return res.ok && Number(res.headers.get('content-length')) === size ? url : null;
    },
  };

  const guard = shutdownGuard(db, (l) => console.error(l));
  const store = guard.store;

  // BR-EVENTO-009 item 8. The key the CMS already uses for places:searchText (the project key has no
  // Geocoding API); without it, events with no coordinate are skipped with the reason in the summary.
  const placesKey = (Deno.env.get(PLACES_KEY_SECRET) ?? '').trim();
  const geocoding: Geocoding | undefined = placesKey
    ? {
      async cached(key) {
        const { data, error } = await core
          .from('event_geocode_cache')
          .select('lat, lon, queried_at')
          .eq('address_key', key)
          .maybeSingle();
        if (error) throw new Error(`event_geocode_cache: ${error.code ?? 'unknown'}`);
        return (data ?? null) as { lat: number | null; lon: number | null; queried_at: string } | null;
      },
      async save(key, lat, lon) {
        const { error } = await core
          .from('event_geocode_cache')
          .upsert({ address_key: key, lat, lon, queried_at: new Date().toISOString() }, { onConflict: 'address_key' });
        if (error) throw new Error(`event_geocode_cache write: ${error.code ?? 'unknown'}`);
      },
      async takeQuota() {
        const { data, error } = await core.rpc('event_geocode_take_quota');
        if (error) throw new Error(`event_geocode_take_quota: ${error.code ?? 'unknown'}`);
        return data === true;
      },
      async search(text) {
        const res = await fetch(PLACES_SEARCH_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': placesKey,
            'X-Goog-FieldMask': 'places.location',
          },
          body: JSON.stringify({ textQuery: text.slice(0, 300), pageSize: 1 }),
          signal: AbortSignal.timeout(GEOCODE_TIMEOUT_MS),
        });
        if (!res.ok) {
          await res.body?.cancel();
          throw new Error(`places: http_${res.status}`);
        }
        const body = await res.json() as { places?: { location?: { latitude?: number; longitude?: number } }[] };
        const loc = body.places?.[0]?.location;
        return typeof loc?.latitude === 'number' && typeof loc?.longitude === 'number'
          ? { lat: loc.latitude, lon: loc.longitude }
          : null;
      },
    }
    : undefined;

  /** The next link gets its own request: a new worker, with its own 150 s. */
  const callNext = (next: RunLink) =>
    fetch(`${supabaseUrl}/functions/v1/events-import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: secretKey, Authorization: `Bearer ${secretKey}` },
      body: JSON.stringify(next),
    })
      .then(async (res) => {
        await res.body?.cancel();
        if (res.status !== 202) console.error(`[events-import] link ${next.chain} answered ${res.status}`);
      })
      .catch((error) => console.error(`[events-import] link ${next.chain} not called: ${messageOf(error)}`));

  const log = (l: string) => console.log(l);
  if (!chained && (body as { sweep?: unknown } | null)?.sweep === true) {
    try {
      return json({ closed: await sweepStalled({ store: db, fetch, log }) }, 200);
    } catch (error) {
      console.error(`[events-import] sweep aborted: ${messageOf(error)}`);
      return json({ error: 'server_error' }, 500);
    }
  }

  const link: RunLink = chained ??
    { chain: 1, run_started_at: new Date().toISOString(), ...(isUuid(only) ? { only } : {}) };
  const run = async () => {
    openCalls.add(guard.close);
    try {
      const reports = await runEventsImport(
        {
          store,
          fetch: (url, init) => fetch(url, init),
          log,
          geocoding,
          geocodingOff: geocoding ? undefined : `secret ${PLACES_KEY_SECRET} missing`,
        },
        link,
      );
      const next = nextLink(reports, link);
      if (next) inBackground(callNext(next));
      return reports;
    } catch (error) {
      // A throw between a progress write and the final one closes the source here, with the cause.
      await guard.close(`aborted: ${messageOf(error)}`);
      throw error;
    } finally {
      openCalls.delete(guard.close);
    }
  };

  // A chained link answers at once, so the link that called it is not held until this one ends.
  if (chained && typeof EdgeRuntime !== 'undefined') {
    EdgeRuntime.waitUntil(
      run().catch((error) => console.error(`[events-import] link ${link.chain} aborted: ${messageOf(error)}`)),
    );
    return json({ accepted: true, chain: link.chain }, 202);
  }

  try {
    const reports = await run();
    return json(reports, reports.every((r) => r.recorded) ? 200 : 500);
  } catch (error) {
    console.error(`[events-import] run aborted: ${messageOf(error)}`);
    return json({ error: 'server_error' }, 500);
  }
});
