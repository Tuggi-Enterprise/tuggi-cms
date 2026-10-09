// _shared/places-story-suspension-runtime.ts — the Deno wiring of `places-story-suspension.ts`
// (#889, BR-B2B-019). Service-role reads and the filtered writes; the logic and the guards that
// decide WHEN to write live in the pure module. Used by `places-payment-sweep`.

import { createAdminClient } from './supabase-client.ts';
import { alert } from './places-payment-runtime.ts';
import { rebuildReadModel } from './read-model.ts';
import { BASE_GENDER, BASE_LANGUAGE, type StoryPlace, type SuspensionDeps } from './places-story-suspension.ts';

/** The bucket and the path convention of `generate-description` / `generate-translated-audio`. */
const AUDIO_BUCKET = 'travel-app-audios';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function suspensionDeps(): SuspensionDeps {
  const admin = createAdminClient();
  const descriptions = () => admin.schema('core').from('attraction_descriptions');

  return {
    alert,
    now: () => new Date(),

    async storyPlaces(): Promise<StoryPlace[]> {
      const subs = await admin
        .schema('partner')
        .from('place_subscriptions')
        .select('place_acceptances(submission_id)')
        .neq('status', 'pending_payment');
      if (subs.error) throw new Error(`subscriptions read ${subs.error.code}`);
      const ids = new Set<string>();
      // deno-lint-ignore no-explicit-any
      for (const r of (subs.data ?? []) as any[]) {
        const acc = Array.isArray(r.place_acceptances) ? r.place_acceptances[0] : r.place_acceptances;
        if (typeof acc?.submission_id === 'string') ids.add(acc.submission_id);
      }
      if (ids.size === 0) return [];
      // Only the one answer it needs travels: `answers` carries CNPJ, name and phone.
      const rows = await admin
        .schema('partner')
        .from('place_submissions')
        .select('id, attraction_id, story:answers->>story_script')
        .in('id', [...ids])
        .not('attraction_id', 'is', null);
      if (rows.error) throw new Error(`submissions read ${rows.error.code}`);
      // deno-lint-ignore no-explicit-any
      return ((rows.data ?? []) as any[]).map((r) => ({
        submissionId: r.id,
        attractionId: r.attraction_id,
        story: typeof r.story === 'string' ? r.story : null,
      }));
    },

    async entitled(submissionId) {
      const { data, error } = await admin.schema('partner').rpc('place_story_entitled', { p_submission_id: submissionId });
      if (error) throw new Error(`entitled ${error.code}`);
      if (typeof data !== 'boolean') throw new Error('entitled not boolean');
      return data;
    },

    async placeFacts(attractionId) {
      const { data, error } = await admin
        .schema('core')
        .from('attractions')
        .select('name, partner_description_exception_at')
        .eq('id', attractionId)
        .maybeSingle();
      if (error) throw new Error(`attraction read ${error.code}`);
      if (!data) return null;
      return { name: typeof data.name === 'string' ? data.name : '', hasException: data.partner_description_exception_at != null };
    },

    async baseKind(attractionId) {
      const { data, error } = await descriptions()
        .select('kind:generation_meta->>kind')
        .eq('attraction_id', attractionId)
        .eq('language', BASE_LANGUAGE)
        .eq('gender', BASE_GENDER)
        .maybeSingle();
      if (error) throw new Error(`base read ${error.code}`);
      return typeof data?.kind === 'string' ? data.kind : null;
    },

    async removeVoicedCopies(attractionId) {
      if (!UUID.test(attractionId)) throw new Error('attraction id not uuid');
      // Every row of THIS place except the base one: translations and the other voice.
      const del = await descriptions()
        .delete()
        .eq('attraction_id', attractionId)
        .or(`language.neq.${BASE_LANGUAGE},gender.neq.${BASE_GENDER}`);
      if (del.error) throw new Error(`copies delete ${del.error.code}`);

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

    async writeBase(attractionId, fromKind, row) {
      const { data, error } = await descriptions()
        .update(row)
        .eq('attraction_id', attractionId)
        .eq('language', BASE_LANGUAGE)
        .eq('gender', BASE_GENDER)
        .eq('generation_meta->>kind', fromKind)
        .select('id');
      if (error) throw new Error(`base write ${error.code}`);
      return (data ?? []).length > 0;
    },

    rebuildReadModel: (attractionId) => rebuildReadModel(admin, attractionId),
  };
}
