/**
 * Single source of truth for which partner.clients columns a CMS route may write.
 *
 * Admin and coordinator share the same client editor UI but not the same
 * authorization scope, so the allowlists differ by *what a scope may touch* —
 * never by *which columns exist*. The profile block used to be declared once per
 * route; the copies drifted and the partner columns added by
 * 20260528125114_clients_supports_partners (client_type, avatar_url,
 * social_handle, bio_one_line) were silently dropped by the admin routes: the
 * operator saved a partner logo and the value never persisted.
 */

import { schemas } from '@/lib/input-validation'

/**
 * Profile columns. Every scope that can edit a client can edit these.
 */
export const CLIENT_PROFILE_FIELDS = [
  'name', 'email', 'phone', 'company_name', 'address', 'city', 'state',
  'country', 'postal_code', 'industry', 'website', 'client_type',
  'avatar_url', 'social_handle', 'bio_one_line',
] as const

/**
 * Columns only the Tuggi admin may write — money, hierarchy, lifecycle and the
 * public URL. Deliberately out of CLIENT_PROFILE_FIELDS, and therefore out of
 * the coordinator scope:
 *   parent_client_id  → moving a child between umbrellas is not profile editing
 *   is_coordinator    → promoting a client is a Tuggi commercial decision
 *   is_platform_owner → only Tuggi owns the platform
 *   commission_rate   → money; the Fiscal tab is admin-only
 *   monthly_fee_cents → money, and the value a contract freezes (BR-B2B-017)
 *   is_courtesy       → "no fee" is a decision, and a partner does not take it
 *   courtesy_reason   → the decision without its reason is an unexplained discount
 *   status            → a child is born 'approved' and only Tuggi demotes it
 *   slug              → changes the URL of an already printed QR code
 */
export const CLIENT_ADMIN_ONLY_FIELDS = [
  'status', 'rejection_reason', 'notes', 'slug',
  'tax_id', 'tax_id_type', 'legal_representative_name', 'legal_representative_role',
  'billing_email', 'iban', 'bic_swift', 'bank_account_number', 'bank_routing_number', 'bank_name',
  'commission_rate', 'is_platform_owner', 'welcome_poi_id', 'is_coordinator', 'parent_client_id',
  'monthly_fee_cents', 'is_courtesy', 'courtesy_reason',
] as const

export const CLIENT_ADMIN_EDITABLE_FIELDS = [
  ...CLIENT_PROFILE_FIELDS,
  ...CLIENT_ADMIN_ONLY_FIELDS,
] as const

export const CLIENT_COORDINATOR_EDITABLE_FIELDS = CLIENT_PROFILE_FIELDS

/**
 * Allowlist, not denylist: a new column in partner.clients does not become editable
 * by accident.
 */
export function pickEditableFields(
  body: Record<string, unknown>,
  fields: readonly string[]
): Record<string, any> {
  const updates: Record<string, any> = {}
  for (const field of fields) {
    if (field in body) updates[field] = body[field] ?? null
  }
  return updates
}

/**
 * avatar_url is free text typed by an operator and rendered as an <img src> by
 * the public site, so `javascript:` and friends must not reach the database —
 * and z.string().url() alone accepts them. Empty clears the field.
 */
const httpAvatarUrl = schemas.url.refine(
  (value: string) => {
    try {
      const protocol = new URL(value).protocol
      return protocol === 'http:' || protocol === 'https:'
    } catch {
      return false
    }
  },
  { message: 'must use the http or https protocol' }
)

export type AvatarUrlValidation =
  | { ok: true; value: string | null }
  | { ok: false; error: string }

export function validateAvatarUrl(value: unknown): AvatarUrlValidation {
  if (value === null || value === undefined || value === '') {
    return { ok: true, value: null }
  }

  const parsed = httpAvatarUrl.safeParse(value)
  if (!parsed.success) {
    return { ok: false, error: 'avatar_url must be a valid http(s) URL' }
  }

  return { ok: true, value: parsed.data }
}
