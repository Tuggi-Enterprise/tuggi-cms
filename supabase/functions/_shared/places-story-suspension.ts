// _shared/places-story-suspension.ts — the paid content follows the payment (#889, #1055).
//
// BR-B2B-019: when the paid plan of a place ends, the story AND the photos come off at the end of
// the period already paid and the app says only the name (items 1, 3 and 7); story and photos are
// kept, and they come back by themselves when the partner pays again (item 6). It holds for the
// Experiência plan of the portal and for the pre-portal plan alike (BR-B2B-060, BR-B2B-044). The
// operator's exception (`partner_description_exception_*`) wins over all of it.
//
// THE DATABASE DECIDES, THIS MODULE CALLS (#1055). One list and two atomic actions, all
// `service_role`, all in `db-tuggiApp` migration `20261029120100`:
//  · `partner.place_paid_content_places()` → every place whose paid right is `paid` or `ended`
//    (`partner.place_paid_content_state`: portal entitlement with its grace, running pre-portal fee,
//    or the month already paid of an ended one) and whether its archive is open;
//  · `partner.place_suspend_paid_content(attraction)` → keeps every description row, `image_url`
//    and every `core.attraction_image` row in `core.attraction_content_archive`, then leaves the
//    base row with the name only, no other language, no photo;
//  · `partner.place_restore_paid_content(attraction)` → puts the kept content back (a text written
//    in between wins) and closes the archive; it also restores the places #889 suspended before the
//    archive existed. No day count, no exception check and no row write lives here.
//
// WHAT IS LEFT TO THIS MODULE:
//  · the voiced files under `master_audio/{attraction_id}/` named `{attraction_id}-*.mp3` — listed,
//    then removed by exact path, never a bucket, never a prefix delete. After `suspended` always;
//    after `restored` only when the text came back (`text_restored`): a text written in between
//    may be voiced, and its files are not ours to remove;
//  · `core.app_poi_read_build` after `suspended` and `restored` (best effort; the backstop cron
//    covers a failure).
//
// RECONCILIATION, NOT EVENTS: every run walks the whole list; both actions answer a no-op outcome
// when there is nothing to do. Each place is independent: an error (a 23503 from a trigger point
// that points at a translation included) alerts and the run goes on to the next place; tomorrow's
// run tries again.
//
// TWINS, ON PURPOSE AND NAMED: the name-only row the suspension writes is the row of
// `core.cms_apply_name_only_description`, and the story row the restore writes for a #889 place is
// the row of `applyPartnerPlaceDescription` (`lib/services/place-description-policy-service.ts`).
// Since #1055 both twins are SQL, inside the two functions above. Change one, change the other.
//
// Import-free, every effect injected: the CMS tests load it under Node.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One row of `partner.place_paid_content_places()`. */
export type PaidContentPlace = { attractionId: string; state: 'paid' | 'ended'; archived: boolean };

/** `outcome` of `partner.place_suspend_paid_content`. */
export const SUSPEND_OUTCOMES = ['suspended', 'already_suspended', 'not_ended', 'exception', 'no_name', 'processing'] as const;
export type SuspendOutcome = (typeof SUSPEND_OUTCOMES)[number];

/** `outcome` of `partner.place_restore_paid_content`. */
export const RESTORE_OUTCOMES = ['restored', 'nothing_archived', 'not_paid', 'exception'] as const;
export type RestoreOutcome = (typeof RESTORE_OUTCOMES)[number];
export type RestoreResult = { outcome: RestoreOutcome; textRestored: boolean; imagesRestored: number };

export type SuspensionDeps = {
  /** `partner.place_paid_content_places()`. Throws on error. */
  places: () => Promise<PaidContentPlace[]>;
  /** `partner.place_suspend_paid_content`. Throws on error (with the SQLSTATE in the message). */
  suspend: (attractionId: string) => Promise<SuspendOutcome>;
  /** `partner.place_restore_paid_content`. Throws on error (with the SQLSTATE in the message). */
  restore: (attractionId: string) => Promise<RestoreResult>;
  /** Removes `master_audio/{id}/{id}-*.mp3` of THIS place by exact path. Throws on error. */
  removeVoicedFiles: (attractionId: string) => Promise<void>;
  /** `core.app_poi_read_build` for the place — best effort, never throws. */
  rebuildReadModel: (attractionId: string) => Promise<void>;
  /** Ids and outcomes only. */
  alert: (what: string, fields: Record<string, string | number | null | undefined>) => Promise<void>;
};

/** `waiting`: `processing` (generate-description holds the row) — the next run takes it. */
export type SuspensionSummary = {
  suspended: number;
  restored: number;
  exception: number;
  waiting: number;
  failed: number;
};

/** BR-B2B-019 items 1, 3, 6 and 7, for every place with a paid plan. One failure alerts and the rest go on. */
export async function reconcilePartnerStories(deps: SuspensionDeps): Promise<SuspensionSummary> {
  const summary: SuspensionSummary = { suspended: 0, restored: 0, exception: 0, waiting: 0, failed: 0 };

  for (const place of await deps.places()) {
    if (!UUID.test(place.attractionId)) continue;
    // An ended place with its archive open was suspended on an earlier run: nothing to call.
    if (place.state === 'ended' && place.archived) continue;
    try {
      const counted = place.state === 'ended' ? await suspendPlace(deps, place.attractionId) : await restorePlace(deps, place.attractionId);
      if (counted) summary[counted]++;
    } catch (e) {
      summary.failed++;
      await safeAlert(deps, 'story_suspension_failed', {
        attraction_id: place.attractionId,
        state: place.state,
        error: e instanceof Error ? e.message.slice(0, 200) : 'unknown',
      });
    }
  }
  return summary;
}

async function suspendPlace(deps: SuspensionDeps, attractionId: string): Promise<keyof SuspensionSummary | null> {
  const outcome = await deps.suspend(attractionId);
  switch (outcome) {
    case 'suspended':
      // The rows are already off (one transaction); the files go after, and a failure here is
      // alerted: no row points at them any more, and the restore of the text removes them again.
      await removeFilesOrAlert(deps, attractionId, outcome);
      await deps.rebuildReadModel(attractionId);
      return 'suspended';
    case 'exception':
      return 'exception';
    case 'processing':
      return 'waiting';
    case 'no_name':
      // Without a name there is nothing to leave on the place; it never resolves alone.
      await safeAlert(deps, 'story_suspension_no_name', { attraction_id: attractionId });
      return 'failed';
    case 'already_suspended':
    case 'not_ended':
      return null;
  }
}

async function restorePlace(deps: SuspensionDeps, attractionId: string): Promise<keyof SuspensionSummary | null> {
  const r = await deps.restore(attractionId);
  switch (r.outcome) {
    case 'restored':
      // The name's voiced files would contradict the text that came back.
      if (r.textRestored) await removeFilesOrAlert(deps, attractionId, r.outcome);
      await deps.rebuildReadModel(attractionId);
      return 'restored';
    case 'exception':
      return 'exception';
    case 'nothing_archived':
    case 'not_paid':
      return null;
  }
}

async function removeFilesOrAlert(deps: SuspensionDeps, attractionId: string, outcome: string): Promise<void> {
  try {
    await deps.removeVoicedFiles(attractionId);
  } catch (e) {
    await safeAlert(deps, 'story_suspension_files_failed', {
      attraction_id: attractionId,
      outcome,
      error: e instanceof Error ? e.message.slice(0, 200) : 'unknown',
    });
  }
}

// A failed alert must not stop the loop (security review #889, R4).
async function safeAlert(deps: SuspensionDeps, what: string, fields: Record<string, string | number | null | undefined>): Promise<void> {
  try {
    await deps.alert(what, fields);
  } catch {
    // swallowed on purpose: the loop is the product, the alert is the net
  }
}
