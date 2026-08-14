/**
 * Which licence a period grant may be written on — one predicate, two call sites.
 *
 * The tier does not decide access any more (BR-MONETIZACAO-046: the state does), but the
 * **published** app still resolves the right by tier name:
 *
 * ```
 * hasActiveSubscription = tierName !== 'free' && notExpired
 * ```
 *
 * (`tuggi-drive-v2/src/services/UserTierService.ts`, quoted in `docs/contracts/entitlement.md`.)
 * Until the #286 build dominates the park, that IS the parque. So a period granted on the
 * `free` tier writes a future `subscription_end_date`, makes `drive.get_entitlement` answer
 * `unlimited`, prints **Ilimitado** in this panel, records a row in the immutable ledger —
 * and delivers **no access at all** to the tourist. The operator sees success and nothing
 * happens, which is the worst shape a refusal can take.
 *
 * `drive.apply_non_renewing_pass` already refuses `p_tier_id IS NULL` with this exact
 * reasoning ("conceder passe sem tier deixaria o perfil com data paga e nível free"); the
 * screen was handing the operator a way to reach the same state through the front door.
 *
 * The predicate lives here so the `<select>` and the handler cannot disagree: filtering
 * only the list would be the "control that lies" in reverse — a refusal the server does
 * not make. The server is the one that decides (gate F2 of the #310 review).
 */

/** Licence name that grants no access in the published app. Not a catalogue: a predicate. */
const TIER_WITHOUT_ACCESS = 'free'

/**
 * Can a period (`until`) grant be written on this licence?
 *
 * Unnamed, unknown or inactive licences answer `false`: the handler fails closed, because
 * "we could not tell which tier this is" and "this tier delivers nothing" have the same
 * outcome for the tourist.
 */
export function tierGrantsAccess(name: string | null | undefined): boolean {
  const normalized = (name ?? '').trim().toLocaleLowerCase()
  return normalized.length > 0 && normalized !== TIER_WITHOUT_ACCESS
}
