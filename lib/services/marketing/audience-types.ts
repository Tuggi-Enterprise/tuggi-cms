/**
 * Marketing module — shared audience segmentation types (SSOT).
 *
 * Both the push-notification sender and the newsletter sender segment
 * `drive.profiles` with the exact same filters, so the filter shape lives here
 * and is imported by both services (DRY).
 *
 * BR-USUARIO-043 item 5b — the demographic profile survey exists for one purpose,
 * deciding what to produce, and that purpose does NOT authorize campaign targeting
 * (push, e-mail, ads, broadcast lists). `country` and `driver_type` were declared
 * here and are gone (#720): `core.build_audience_filter` now raises SQLSTATE
 * `TGU43` (HTTP 400) for either key instead of silently dropping it, so any key
 * left in this interface would be an invitation to a 400. The filter is an explicit
 * allowlist on both sides — a new profile column never leaks into it on its own,
 * and adding one is a new purpose: human decision, with ID and date, in
 * `docs/business-rules/`.
 *
 * Reaching the PARTNER driver is done through the commercial link
 * (`drive.profiles.client_id`), never through a survey answer.
 * See `docs/contracts/banco-para-cms.md`, Part 5.
 */

export interface AudienceFilters {
  subscription_tier_id?: string;
  last_platform?: 'ios' | 'android';
  /** Interface locale the app writes by itself (BR-AUDIO-017) — not `spoken_languages`. */
  language?: string;
  onboarding_completed?: boolean;
  created_after?: string;
  created_before?: string;
  last_active_after?: string;
  app_version_lt?: string;
}
