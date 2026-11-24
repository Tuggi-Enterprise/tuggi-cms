// _shared/places-story-suspension-runtime.ts — the Deno wiring of `places-story-suspension.ts`
// (#889, #1055, BR-B2B-019). Three service-role RPCs and the removal of the voiced files; the
// database decides what changes, the pure module decides what follows. Used by `places-payment-sweep`.

import { createAdminClient } from './supabase-client.ts';
import { alert } from './places-payment-runtime.ts';
import { rebuildReadModel } from './read-model.ts';
import {
  RESTORE_OUTCOMES,
  SUSPEND_OUTCOMES,
  type PaidContentPlace,
  type RestoreOutcome,
  type SuspendOutcome,
  type SuspensionDeps,
} from './places-story-suspension.ts';

/** The bucket and the path convention of `generate-description` / `generate-translated-audio`. */
const AUDIO_BUCKET = 'travel-app-audios';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// deno-lint-ignore no-explicit-any
function firstRow(data: any): any {
  return Array.isArray(data) ? data[0] : data;
}

export function suspensionDeps(): SuspensionDeps {
  const admin = createAdminClient();
  const partner = () => admin.schema('partner');

  return {
    alert,

    async places(): Promise<PaidContentPlace[]> {
      const { data, error } = await partner().rpc('place_paid_content_places', {});
      if (error) throw new Error(`places read ${error.code}`);
      // deno-lint-ignore no-explicit-any
      return ((data ?? []) as any[])
        .filter((r) => typeof r?.attraction_id === 'string' && (r.state === 'paid' || r.state === 'ended'))
        .map((r) => ({ attractionId: r.attraction_id, state: r.state, archived: r.archived === true }));
    },

    async suspend(attractionId): Promise<SuspendOutcome> {
      const { data, error } = await partner().rpc('place_suspend_paid_content', { p_attraction_id: attractionId });
      if (error) throw new Error(`suspend ${error.code}`);
      const outcome = firstRow(data)?.outcome;
      if (!(SUSPEND_OUTCOMES as readonly string[]).includes(outcome)) throw new Error('suspend outcome unknown');
      return outcome as SuspendOutcome;
    },

    async restore(attractionId) {
      const { data, error } = await partner().rpc('place_restore_paid_content', { p_attraction_id: attractionId });
      if (error) throw new Error(`restore ${error.code}`);
      const row = firstRow(data);
      if (!(RESTORE_OUTCOMES as readonly string[]).includes(row?.outcome)) throw new Error('restore outcome unknown');
      return {
        outcome: row.outcome as RestoreOutcome,
        textRestored: row.text_restored === true,
        imagesRestored: typeof row.images_restored === 'number' ? row.images_restored : 0,
      };
    },

    async removeVoicedFiles(attractionId) {
      if (!UUID.test(attractionId)) throw new Error('attraction id not uuid');
      // The files of THIS place only, by exact path: list the folder, keep `{id}-*.mp3`, remove those.
      // TWIN IN NODE: `lib/partnerships/place-changes.ts` (`voicedAudioPaths`), for the CMS approval of
      // a new text (#922). Change one, change the other.
      const folder = `master_audio/${attractionId}`;
      const listed = await admin.storage.from(AUDIO_BUCKET).list(folder, { limit: 100 });
      if (listed.error) throw new Error('audio list failed');
      const paths = (listed.data ?? [])
        .map((f: { name: string }) => f.name)
        .filter((n: string) => n.startsWith(`${attractionId}-`) && n.endsWith('.mp3') && !n.includes('/'))
        .map((n: string) => `${folder}/${n}`);
      if (paths.length === 0) return;
      const removed = await admin.storage.from(AUDIO_BUCKET).remove(paths);
      if (removed.error) throw new Error('audio remove failed');
    },

    rebuildReadModel: (attractionId) => rebuildReadModel(admin, attractionId),
  };
}
