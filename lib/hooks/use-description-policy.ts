/**
 * The description policy of one place, as the studio screens read it.
 *
 * It goes through `/api/admin/places/{id}/description-policy` and not through the browser's
 * Supabase client, because the answer depends on `partner.clients` and `partner.partner_contracts`
 * — a schema `authenticated` has no `USAGE` on. See the route.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { PlaceDescriptionPolicyView } from '@/lib/services/place-description-policy-service'

export type { PlaceDescriptionPolicyView }

function policyPath(attractionId: string) {
  return `/api/admin/places/${attractionId}/description-policy`
}

export function descriptionPolicyKey(attractionId: string | null) {
  return ['description-policy', attractionId] as const
}

/**
 * WHAT WENT WRONG TRAVELS WITH THE FAILURE, and the band prints it.
 *
 * The first version threw `description_policy_500` and nothing else, so a broken read made the
 * band render `null` — indistinguishable from "this place has no partner". That cost a round trip
 * on 2026-08-26: the operator saw an unchanged tab and had nothing to report. The commonest cause
 * is `PGRST202` — PostgREST serving a schema cache from before the function existed — and that is
 * a message worth reading rather than a blank panel.
 */
async function readPolicy(attractionId: string): Promise<PlaceDescriptionPolicyView> {
  const res = await fetch(policyPath(attractionId))
  const body = await res.json().catch(() => null)
  if (!res.ok) {
    const detail = (body as { error?: string } | null)?.error
    throw new Error(detail ? `${res.status} · ${detail}` : `HTTP ${res.status}`)
  }
  return body as PlaceDescriptionPolicyView
}

export function useDescriptionPolicy(attractionId: string | null, enabled: boolean = true) {
  return useQuery({
    queryKey: descriptionPolicyKey(attractionId),
    queryFn: () => readPolicy(attractionId as string),
    enabled: !!attractionId && enabled,
    // The tier can be signed in another tab, and the lock this answer draws is the one thing on
    // the screen that must not be stale — reopening the drawer re-asks.
    staleTime: 0,
  })
}

/**
 * Opening and closing the operator's exception. Both answer with the RE-READ policy, so the screen
 * never has to guess what it just produced (DS-LAYOUT-006, point 3).
 */
export function useDescriptionException(attractionId: string | null) {
  const queryClient = useQueryClient()

  const write = async (init: RequestInit): Promise<PlaceDescriptionPolicyView> => {
    const res = await fetch(policyPath(attractionId as string), init)
    const body = await res.json().catch(() => null)
    if (!res.ok) throw new Error((body as { error?: string })?.error || `exception_${res.status}`)
    return body as PlaceDescriptionPolicyView
  }

  const settle = (view: PlaceDescriptionPolicyView) => {
    queryClient.setQueryData(descriptionPolicyKey(attractionId), view)
  }

  return {
    open: useMutation({
      mutationFn: (reason: string) =>
        write({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason }),
        }),
      onSuccess: settle,
    }),
    close: useMutation({
      mutationFn: () => write({ method: 'DELETE' }),
      onSuccess: settle,
    }),
  }
}

/**
 * Applies the free tier's content — the name, in the description's place.
 *
 * The route decides whether there is anything to apply, so the caller may fire it after saving any
 * place at all. `not_applicable` is the ordinary answer and not a failure.
 */
export async function applyNameOnlyDescription(
  attractionId: string
): Promise<'written' | 'unchanged' | 'skipped' | 'blocked' | 'not_applicable'> {
  const res = await fetch(policyPath(attractionId), { method: 'PUT' })
  if (!res.ok) throw new Error(`apply_name_only_${res.status}`)
  const body = (await res.json()) as { outcome: string }
  return body.outcome as 'written' | 'unchanged' | 'skipped' | 'blocked' | 'not_applicable'
}
