// _shared/places-story-suspension.ts — the paid description follows the payment (#889, épico #876).
//
// BR-B2B-019: when the partner stops paying, the description comes off and the place is the name
// again (items 1 and 3); paying again brings it back from the same input, with no new screening
// (item 6); nothing of it reaches the tourist (item 7). The operator's exception
// (`partner_description_exception_*`, migration `20260826_02`) wins over all of it.
//
// ONE SOURCE OF "IS IT PAID?": `partner.place_story_entitled(submission_id)` — the function the
// payment contract names as the single answer (`docs/contracts/places-pagamento.md` §2). It already
// folds cancellation (renewal off → ends at `paid_through`) and dunning (past due → ends at
// `paid_through` + `place_renewal_grace_days()`). No day count lives here.
//
// RECONCILIATION, NOT EVENTS: the daily sweep compares, for every place that ever had a paid
// portal subscription, what the payment says with what the description row carries, and moves the
// row only when they disagree. Idempotent by construction, and a failure is retried the next day.
//
// WHAT IT TOUCHES, AND THE FILTER ON EACH:
//  · the base row (`pt-br`, `male`) of `core.attraction_descriptions` — ONLY by a conditional
//    UPDATE on `generation_meta.kind`: suspend moves `partner_story_script` → `partner_name_only`,
//    restore moves `partner_name_only` → `partner_story_script`. A catalogue description, an
//    operator's edit or a `[PROCESSING]` row carries another kind and is never matched;
//  · every OTHER row of that `attraction_id` (translations, other voice) — `DELETE` filtered by
//    `attraction_id` AND (language ≠ base OR gender ≠ base);
//  · the files under `master_audio/{attraction_id}/` named `{attraction_id}-*.mp3` — listed, then
//    removed by exact path. Never a bucket, never a prefix delete.
// The partner's input (`answers.story_script`, `answers`) is read, never written: the description is
// suspended, not deleted (BR-B2B-019, 1st edge case).
//
// TWINS, ON PURPOSE AND NAMED: the CMS writes these same two rows from the operator's session —
// `core.cms_apply_name_only_description` (SQL) and `applyPartnerPlaceDescription`
// (`lib/services/place-description-policy-service.ts`). Both gate on the operator's JWT, and the
// sweep has none; this module is their `service_role` twin. Change one, change the other.
//
// Import-free, every effect injected: the CMS tests load it under Node.

/** `BASE_LANGUAGE` / `BASE_GENDER` of `place-description-policy-service.ts`. */
export const BASE_LANGUAGE = 'pt-br';
export const BASE_GENDER = 'male';
/** `generation_meta.kind` values — the same strings the CMS writes. */
export const PARTNER_STORY_SCRIPT_KIND = 'partner_story_script';
export const PARTNER_NAME_ONLY_KIND = 'partner_name_only';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One portal submission whose subscription was paid at least once, with the place it became. */
export type StoryPlace = { submissionId: string; attractionId: string; story: string | null };

export type BaseRow = {
  description: string;
  audio_url: null;
  updated_at: string;
  verification_status: 'approved';
  generation_meta: { kind: string };
  facts_pack_json?: unknown[];
};

export type SuspensionDeps = {
  /** Submissions with `attraction_id` whose subscription left `pending_payment` at least once. Throws on error. */
  storyPlaces: () => Promise<StoryPlace[]>;
  /** `partner.place_story_entitled(submission_id)`. Throws on error — never "false" by accident. */
  entitled: (submissionId: string) => Promise<boolean>;
  /** `core.attractions` name and whether the operator's exception is set; `null` when the place is gone. */
  placeFacts: (attractionId: string) => Promise<{ name: string; hasException: boolean } | null>;
  /** `generation_meta->>kind` of the base row; `null` when there is no base row. Throws on error. */
  baseKind: (attractionId: string) => Promise<string | null>;
  /** Deletes the non-base rows and the voiced files of THIS attraction (filters above). Throws on error. */
  removeVoicedCopies: (attractionId: string) => Promise<void>;
  /** Conditional UPDATE of the base row where its kind is `fromKind`; true when a row changed. Throws on error. */
  writeBase: (attractionId: string, fromKind: string, row: BaseRow) => Promise<boolean>;
  /** `core.app_poi_read_build` for the place — best effort, never throws. */
  rebuildReadModel: (attractionId: string) => Promise<void>;
  /** Ids and outcomes only. */
  alert: (what: string, fields: Record<string, string | number | null | undefined>) => Promise<void>;
  now: () => Date;
};

export type SuspensionSummary = { suspended: number; restored: number; exception: number; failed: number };

/** Same row `cms_apply_name_only_description` inserts. */
export function nameOnlyRow(name: string, now: Date): BaseRow {
  return {
    description: name,
    audio_url: null,
    facts_pack_json: [],
    updated_at: now.toISOString(),
    verification_status: 'approved',
    generation_meta: { kind: PARTNER_NAME_ONLY_KIND },
  };
}

/** Same row `applyPartnerPlaceDescription` writes. */
export function storyRow(story: string, now: Date): BaseRow {
  return {
    description: story,
    audio_url: null,
    updated_at: now.toISOString(),
    verification_status: 'approved',
    generation_meta: { kind: PARTNER_STORY_SCRIPT_KIND },
  };
}

/** BR-B2B-019 items 1, 3, 6 and 7, for every portal place. Each place is independent: one failure alerts and the rest go on. */
export async function reconcilePartnerStories(deps: SuspensionDeps): Promise<SuspensionSummary> {
  const summary: SuspensionSummary = { suspended: 0, restored: 0, exception: 0, failed: 0 };

  const byPlace = new Map<string, StoryPlace[]>();
  for (const p of await deps.storyPlaces()) {
    if (!UUID.test(p.attractionId) || !UUID.test(p.submissionId)) continue;
    byPlace.set(p.attractionId, [...(byPlace.get(p.attractionId) ?? []), p]);
  }

  for (const [attractionId, submissions] of byPlace) {
    try {
      const outcome = await reconcilePlace(deps, attractionId, submissions);
      if (outcome !== 'none') summary[outcome]++;
    } catch (e) {
      summary.failed++;
      try { await deps.alert('story_suspension_failed', { attraction_id: attractionId, error: e instanceof Error ? e.message.slice(0, 200) : 'unknown' }); } catch { // a failed alert must not stop the loop (security review #889, R4)
      }
    }
  }
  return summary;
}

async function reconcilePlace(
  deps: SuspensionDeps,
  attractionId: string,
  submissions: StoryPlace[],
): Promise<'suspended' | 'restored' | 'exception' | 'none'> {
  // Two submissions on one place: the place is paid while ANY of them is (BR-B2B-019 item 4 — the
  // reach is that place's paid description, and a live payment keeps it).
  let paying: StoryPlace | null = null;
  for (const s of submissions) {
    if (await deps.entitled(s.submissionId)) {
      paying = s;
      break;
    }
  }

  const facts = await deps.placeFacts(attractionId);
  if (!facts) return 'none';
  if (facts.hasException) return 'exception';

  const kind = await deps.baseKind(attractionId);

  if (!paying && kind === PARTNER_STORY_SCRIPT_KIND) {
    const name = facts.name.trim();
    if (!name) return 'none';
    // Copies first: if the base write then fails, the base still says `partner_story_script` and
    // tomorrow's run redoes both. The other order would leave voiced copies behind for good.
    await deps.removeVoicedCopies(attractionId);
    if (!(await deps.writeBase(attractionId, PARTNER_STORY_SCRIPT_KIND, nameOnlyRow(name, deps.now())))) return 'none';
    await deps.rebuildReadModel(attractionId);
    return 'suspended';
  }

  if (paying && kind === PARTNER_NAME_ONLY_KIND) {
    const story = (paying.story ?? '').trim();
    // No text: the studio produces it (BR-B2B-011 gate 2 is a person), as on approval.
    if (!story) return 'none';
    // The name's voiced copies would now contradict the restored text.
    await deps.removeVoicedCopies(attractionId);
    if (!(await deps.writeBase(attractionId, PARTNER_NAME_ONLY_KIND, storyRow(story, deps.now())))) return 'none';
    await deps.rebuildReadModel(attractionId);
    return 'restored';
  }

  return 'none';
}
