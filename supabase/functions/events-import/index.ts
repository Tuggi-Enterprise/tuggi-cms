/**
 * events-import: the weekly import of events from official tourism sources (#1075, BR-EVENTO-009).
 *
 *   POST {}   every active row of `core.event_sources` (pg_cron `events-import`, Monday 09:00 UTC)
 *   -> 200 [{ source_id, name, status, summary, recorded }], 500 when a `last_run_*` was not written
 *   -> 401 any caller without our secret key, 405 any other method
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
  type ImportStore,
  messageOf,
  runEventsImport,
} from '../_shared/events-import.ts';

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (!isOwnSecretKey(bearer)) return json({ error: 'unauthorized' }, 401);

  const supabase = createClient((Deno.env.get('SUPABASE_URL') ?? '').trim(), getSecretKey().trim(), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const core = supabase.schema('core');

  const store: ImportStore = {
    async activeSources() {
      const { data, error } = await core
        .from('event_sources')
        .select('id, name, adapter, base_url, timezone')
        .eq('is_active', true);
      if (error) throw new Error(`event_sources: ${error.code ?? 'unknown'}`);
      return (data ?? []) as EventSource[];
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
    async uploadImage(path, bytes, contentType) {
      const bucket = supabase.storage.from(IMAGE_BUCKET);
      const { error } = await bucket.upload(path, bytes, { upsert: true, contentType });
      if (error) throw new Error(`upload: ${error.message ?? 'unknown'}`);
      return bucket.getPublicUrl(path).data.publicUrl;
    },
  };

  try {
    const reports = await runEventsImport({
      store,
      fetch: (url, init) => fetch(url, init),
      log: (line) => console.log(line),
    });
    return json(reports, reports.every((r) => r.recorded) ? 200 : 500);
  } catch (error) {
    console.error(`[events-import] run aborted: ${messageOf(error)}`);
    return json({ error: 'server_error' }, 500);
  }
});
