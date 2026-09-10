/**
 * One reading of an audience filter, in words, for every surface that shows one.
 *
 * Four callers today: both send-confirmation dialogs and both history lists. The sentence a
 * dialog shows before an irreversible send and the sentence a history row shows about a send
 * that already happened have to be THE SAME sentence — an operator who reads "Android" in the
 * dialog and something else in the history cannot tell which one is the campaign.
 *
 * It lives in `shared/` for that reason, not for tidiness: it was written inside the newsletter
 * dialog first, and the push side imported it across the module boundary rather than writing a
 * second one (§6 DRY). This is where it belonged.
 */

import type { AudienceFilters } from '@/lib/services/marketing/audience-types';

/**
 * The active filters as sentences. An EMPTY list means the whole base, and the caller is what
 * says so in words — returning a "whole base" sentence from here would make "no filter" look
 * like just another filter in the list.
 */
export function describeFilters(
  filters: AudienceFilters,
  tAudience: (key: string) => string,
  tierNames: Record<string, string>,
): string[] {
  const lines: string[] = [];
  const label = (key: string) => tAudience(key);

  if (filters.last_platform) {
    lines.push(`${label('platform.label')}: ${label(`platform.${filters.last_platform}`)}`);
  }
  if (filters.subscription_tier_id) {
    lines.push(`${label('tier.label')}: ${tierNames[filters.subscription_tier_id] ?? filters.subscription_tier_id}`);
  }
  if (filters.language) {
    const known = ['pt', 'en', 'es', 'it', 'fr'].includes(filters.language);
    lines.push(`${label('language.label')}: ${known ? label(`language.${filters.language}`) : filters.language}`);
  }
  if (filters.onboarding_completed) {
    lines.push(label('onboarding.label'));
  }
  if (filters.created_after) lines.push(`${label('activity.createdAfter')}: ${filters.created_after}`);
  if (filters.created_before) lines.push(`${label('activity.createdBefore')}: ${filters.created_before}`);
  if (filters.last_active_after) lines.push(`${label('activity.lastActiveAfter')}: ${filters.last_active_after}`);
  if (filters.app_version_lt) lines.push(`${label('activity.appVersionLt')}: ${filters.app_version_lt}`);

  return lines;
}
