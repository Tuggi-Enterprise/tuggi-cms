/**
 * Who an auth uid is, in something an operator can read — the one answer to that question.
 *
 * WHY THE AUTH ADMIN API AND NOT A JOIN: `core.cms_users` is keyed by e-mail and has no column
 * holding the auth uid, so there is no path in `core` from `reviewed_by`, `promoted_by`,
 * `approved_by` or `partner_triage_refusals.decided_by` to a person. This lookup is the only one
 * that resolves them.
 *
 * It fails to null on purpose. A trail line is worth showing or leaving out; it is not worth
 * failing the whole screen, and printing the uuid would be the third option that helps nobody.
 *
 * IT LIVES HERE because it had two identical copies — `partner-proposal-admin-service` and
 * `partnership-service` — and the pipeline needed a third for the triage refusal. Two answers to
 * "who is this uid" is how one of them starts printing something else (CLAUDE.md §6, DRY).
 */

import { getSupabaseService } from '@/lib/core/supabase-client'

export async function operatorLabel(userId: string | null): Promise<string | null> {
  if (!userId) return null
  try {
    const { data, error } = await getSupabaseService().auth.admin.getUserById(userId)
    if (error || !data?.user?.email) return null
    return data.user.email
  } catch {
    return null
  }
}
