/**
 * The envelope of `drive.get_time_credit_ledger`, as `docs/contracts/entitlement.md`
 * declares it ("A porta de leitura"). Nothing here is recomputed on the screen: `state`,
 * `balance_minutes` and `ends_at` come from `drive.get_entitlement` through that RPC,
 * and BR-MONETIZACAO-046 allows exactly one implementation of that resolution.
 */

/**
 * There is no fourth value, and there is one owner: `lib/credit/entitlement.ts`, which
 * the dashboard reads too. Re-exported here so this envelope stays readable on its own.
 */
import type { EntitlementState } from '@/lib/credit/entitlement'

export type { EntitlementState }

export interface LedgerGrant {
  id: string
  grant_type: 'minutes' | 'until'
  source: string
  source_ref: string | null
  product_id: string | null
  minutes_granted: number | null
  /** How much of THIS grant was already spent — what the revoke dialog states up front. */
  minutes_consumed: number
  ends_at: string | null
  granted_at: string
  /** `null` for self-service ports (welcome, coupon): there is no operator to name. */
  granted_by_email: string | null
  granted_by_name: string | null
  invalidated_at: string | null
  invalidation_reason: string | null
  transferred_from_grant_id: string | null
}

/**
 * One row per session, already aggregated by the database. There is no scalar `origin`:
 * a session mixes online and offline blocks, so the three labels of the screen come from
 * the counts.
 */
export interface LedgerSession {
  session_id: string
  blocks: number
  minutes: number
  first_consumed_at: string
  last_consumed_at: string
  blocks_offline: number
  blocks_offline_pending: number
  last_reconciled_at: string | null
}

export interface LedgerEnvelope {
  ok: true
  user_id: string
  state: EntitlementState
  balance_minutes: number
  ends_at: string | null
  grants: LedgerGrant[]
  grants_count: number
  consumption: LedgerSession[]
  consumption_sessions_total: number
  session_limit: number
  session_offset: number
}

/**
 * A person the grant dialog is about — `nickname` and e-mail, never the full name.
 *
 * The e-mail is the ONE nominal exception to BR-USUARIO-042, opened by the founder on
 * 2026-09-01 and confined to this dialog; the label is composed by `grantTargetLabel`.
 */
export interface GrantTarget {
  userId: string
  nickname: string | null
  email: string | null
}

export type GrantType = 'minutes' | 'until'

/** What the form holds while the operator composes. Hours and minutes stay separate. */
export interface GrantDraft {
  grantType: GrantType
  hours: number
  minutes: number
  endsAt: string
  tierId: string
  sourceRef: string
}
