/**
 * events-import: the weekly import of events from official tourism sources (#1075, BR-EVENTO-009).
 *
 *   POST {}   every active row of `core.event_sources` (pg_cron `events-import`, Monday 09:00 UTC)
 *   -> 200 [{ source_id, name, status, summary, recorded }], 500 when a `last_run_*` was not written
 *   -> 401 any caller without our secret key, 405 any other method, 400 a malformed chain body
 *
 *   POST { chain, run_started_at }   the next link of a run, called by the function itself
 *   -> 202 at once; the link runs in the background (`EdgeRuntime.waitUntil`)
 *
 * A link stops starting items at `RUN_BUDGET_MS`. When items are left it calls the next link,
 * without waiting, up to `MAX_CHAIN_LINKS`; the next one starts with the items not yet seen.
 *
 * Machine key only (`isOwnSecretKey`), as `social-collect`: the cron sends the `ef_secret_key` of the
 * Vault. Deploy with `--no-verify-jwt`: no caller sends a JWT. The work is `_shared/events-import.ts`;
 * this file authenticates and wires the database and the bucket.
 */
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getSecretKey, isOwnSecretKey } from '../_shared/secret-key.ts';
import {
  type EventSource,
  IMAGE_BUCKET,
  IMAGE_FETCH_TIMEOUT_MS,
  type ImportStore,
  type KnownItem,
  messageOf,
  nextLink,
  readLink,
  runEventsImport,
  type RunLink,
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

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void } | undefined;

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

  const supabaseUrl = (Deno.env.get('SUPABASE_URL') ?? '').trim();
  const secretKey = getSecretKey().trim();
  const supabase = createClient(supabaseUrl, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const core = supabase.schema('core');
  const publicUrl = (path: string) => supabase.storage.from(IMAGE_BUCKET).getPublicUrl(path).data.publicUrl;

  const store: ImportStore = {
    async activeSources() {
      const { data, error } = await core
        .from('event_sources')
        .select('id, name, adapter, base_url, timezone')
        .eq('is_active', true);
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

  const link: RunLink = chained ?? { chain: 1, run_started_at: new Date().toISOString() };
  const run = async () => {
    const reports = await runEventsImport(
      { store, fetch: (url, init) => fetch(url, init), log: (l) => console.log(l) },
      link,
    );
    const next = nextLink(reports, link);
    if (next) inBackground(callNext(next));
    return reports;
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
