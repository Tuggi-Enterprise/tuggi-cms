/**
 * What a live pin says about the person behind it (#1266): is the guide on, and is there balance.
 *
 * The position on the live map comes from `drive.user_location_history`, which the app sends with
 * the guide on or off. Without this, a tourist driving with the guide on and no balance left looks
 * the same as one with the app in the pocket. Three states, and nothing else:
 *
 * - `guide_on`: guide on and an entitlement state other than `free`.
 * - `guide_on_no_balance`: guide on and `free`.
 * - `location_only`: guide off, or the RPC did not say (field absent before the migration).
 *
 * The entitlement state arrives resolved by `drive.get_entitlement`, BR-MONETIZACAO-046: this file
 * only reads it. A state that is missing or unknown with the guide on is NOT read as `free`, by the
 * same rule's edge case ("estado desconhecido nunca vira free por omissão").
 *
 * Both pages that draw live pins (Overview and Radar) read here, so pin colour, legend and title
 * cannot drift apart.
 */

import { CHART_COLORS, CHART_NEUTRAL } from '@/lib/constants/chart-colors'
import { appUserLabel } from '@/lib/format/user-identity'
import type { EntitlementState } from '@/lib/credit/entitlement'

export type LivePinState = 'guide_on' | 'guide_on_no_balance' | 'location_only'

/** The fields of a `core.dashboard_realtime_activity` row this file reads. */
export interface LivePinInput {
  user_id?: string | null
  nickname?: string | null
  guide_on?: boolean | null
  entitlement_state?: EntitlementState | string | null
  balance_minutes?: number | null
}

/** Legend order, and the colour of each state. Labels live in i18n under `Pages.Dashboard.live_pin`. */
export const LIVE_PIN_STATES: ReadonlyArray<{ state: LivePinState; color: string }> = [
  { state: 'guide_on', color: CHART_COLORS.green },
  { state: 'guide_on_no_balance', color: CHART_COLORS.red },
  { state: 'location_only', color: CHART_NEUTRAL },
]

export function livePinState(user: LivePinInput): LivePinState {
  if (user.guide_on !== true) return 'location_only'
  return user.entitlement_state === 'free' ? 'guide_on_no_balance' : 'guide_on'
}

export function livePinColor(state: LivePinState): string {
  return LIVE_PIN_STATES.find(s => s.state === state)!.color
}

type Translate = (key: string, values?: Record<string, string | number>) => string

/**
 * "nickname · state", plus "· N min" when the state is `metered`. The person is named by
 * `appUserLabel`, BR-USUARIO-042: nickname, else the truncated `user_id`.
 *
 * `t` is `useTranslations('Pages.Dashboard')`.
 */
export function livePinTitle(user: LivePinInput, t: Translate): string {
  const parts = [appUserLabel(user), t(`live_pin.${livePinState(user)}`)]
  if (user.entitlement_state === 'metered' && Number.isFinite(user.balance_minutes)) {
    parts.push(t('live_pin.balance', { minutes: Math.max(0, Math.round(user.balance_minutes as number)) }))
  }
  return parts.join(' · ')
}
