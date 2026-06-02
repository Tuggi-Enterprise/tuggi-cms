/**
 * Marketing module — shared audience segmentation types (SSOT).
 *
 * Both the push-notification sender and the newsletter sender segment
 * `drive.profiles` with the exact same filters, so the filter shape lives here
 * and is imported by both services (DRY).
 */

export interface AudienceFilters {
  subscription_tier_id?: string;
  last_platform?: 'ios' | 'android';
  country?: string;
  language?: string;
  driver_type?: string;
  onboarding_completed?: boolean;
  created_after?: string;
  created_before?: string;
  last_active_after?: string;
  app_version_lt?: string;
}
