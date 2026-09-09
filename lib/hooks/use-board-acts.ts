'use client'

/**
 * What a card's act DOES — the one place that turns a `BoardAct` into a request or a route.
 *
 * THE SPLIT IS THE SAFETY RULE, and it is the same one `planTransition` encodes: `open_*` takes
 * the operator to the panel that asks, everything else is a single request the card fires. The
 * three acts behind a panel are the ones that cost money or cannot be taken back — the
 * promotion's per-column ticks, the contract's tier and payment method (BR-B2B-017), and the
 * publication that starts the monthly fee (BR-B2B-018). A drag is an ambiguous gesture and must
 * never be the last thing between a partner and a bill.
 *
 * NOTHING MOVES OPTIMISTICALLY. The column is derived from the database; the card lands in the
 * next one because `reload` re-read the list, not because this function said so. Moving a card
 * and snapping it back on failure is how a board earns distrust.
 *
 * Every route here already exists and is already the only writer of its fact — this hook adds
 * no endpoint and no write of its own.
 */

import { useCallback } from 'react'
import { RETURN_TO_PARAM } from '@/lib/navigation/return-to'
import type { BoardAct } from '@/lib/clients/board-transitions'
import type { ClientDirectoryRow } from '@/lib/services/partnership-service'

/**
 * What the card should say happened — and it HAS to say it.
 *
 * This type always existed and the board always threw it away: `onAct` was typed `=> void` and
 * the host called `void acts.run(...)`, so the nine sentences of `Clients.board.blocked` only
 * ever reached the screen through a refused DRAG. A refused CLICK painted nothing, which is how
 * two acts stayed broken in production without anybody reporting them (2026-09-09): the
 * communication of a refusal posted no `refusalId` and answered 400 every single time, and the
 * creation of a place answered `200` while creating nothing.
 */
export type ActOutcome =
  | { kind: 'done' }
  | { kind: 'navigated' }
  /**
   * The route refused, and `reason` is its own code — rendered from `Clients.board.blocked`.
   * `detail` is the rest of the answer, for the few sentences that name a fact from it
   * (`already_communicated` prints the stamp it found).
   */
  | { kind: 'refused'; reason: string; detail?: Record<string, unknown> }
  | { kind: 'failed' }

export interface BoardActRunner {
  run: (row: ClientDirectoryRow, act: BoardAct) => Promise<ActOutcome>
}

interface BoardActOptions {
  locale: string
  /** Where the operator comes back to — the board, with its filters. */
  returnTo: string
  navigate: (href: string) => void
  /** Opens the client record on a tab of the drawer, over the board. */
  openRecord: (clientId: string, tab: string) => void
  reload: () => void
}

export function useBoardActs({
  locale,
  returnTo,
  navigate,
  openRecord,
  reload,
}: BoardActOptions): BoardActRunner {
  const run = useCallback(
    async (row: ClientDirectoryRow, act: BoardAct): Promise<ActOutcome> => {
      const back = `${RETURN_TO_PARAM}=${encodeURIComponent(returnTo)}`

      switch (act) {
        // ── The panels ──────────────────────────────────────────────────────────────────
        case 'record_conference':
        case 'open_promotion':
        case 'open_discard': {
          if (!row.submissionId) return { kind: 'refused', reason: 'no_submission' }
          navigate(`/${locale}/admin/partnerships/proposals/${row.submissionId}?${back}`)
          return { kind: 'navigated' }
        }

        case 'open_contract': {
          if (!row.clientId) return { kind: 'refused', reason: 'no_client' }
          navigate(`/${locale}/admin/clients/${row.clientId}/contract?${back}`)
          return { kind: 'navigated' }
        }

        case 'open_publish': {
          // Band 4 of the partnership tab: the publication panel, with the fee variant that
          // decides the sentence of the confirmation (DS-COMPONENTE-021, point 2).
          if (!row.clientId) return { kind: 'refused', reason: 'no_client' }
          openRecord(row.clientId, 'partnership')
          return { kind: 'navigated' }
        }

        // ── The requests ────────────────────────────────────────────────────────────────
        case 'send_contract': {
          if (!row.clientId) return { kind: 'refused', reason: 'no_client' }
          return post(`/api/admin/clients/${row.clientId}/contract`, { action: 'send' }, reload)
        }

        case 'create_place': {
          if (!row.clientId) return { kind: 'refused', reason: 'no_client' }
          return post(`/api/admin/partnerships/clients/${row.clientId}/places`, {}, reload, readProvision)
        }

        case 'communicate_refusal': {
          // The place the refusal is on. `hasUncommunicatedRefusal` decided the row's state;
          // this finds WHICH one, from the same facts, so the two cannot pick different places.
          const owed = row.triage.places.find(
            (place) => place.refusal !== null && place.refusal.communicatedAt === null
          )
          if (!row.clientId || !owed?.refusal) return { kind: 'refused', reason: 'no_place' }
          // WHICH refusal, and the route demands it explicitly: it will not derive the current
          // one, so that a second round arriving meanwhile cannot be stamped by an operator who
          // was not looking at it. Posting `{}` here answered 400 `invalid_refusal_id` on every
          // click since the act shipped — invisible because nothing rendered the refusal.
          return post(
            `/api/admin/partnerships/clients/${row.clientId}/places/${owed.attractionId}/triage-refusal/communicate`,
            { refusalId: owed.refusal.id },
            reload
          )
        }

        default:
          return { kind: 'failed' }
      }
    },
    [locale, returnTo, navigate, openRecord, reload]
  )

  return { run }
}

/**
 * One request, and the refusal comes back as the route's OWN code.
 *
 * `checklist_incomplete`, `publish_not_offered`, `already_communicated` — each is a decision the
 * server already makes and already names, and re-deriving any of them on the client would be a
 * second implementation of the same rule that drifts the first time one changes.
 */
async function post(
  url: string,
  body: Record<string, unknown>,
  reload: () => void,
  /**
   * A SECOND READING OF A SUCCESSFUL ANSWER, for the routes where `200` is not the same as
   * `it happened`. Returns the refusal hiding inside the body, or `null` when the act really did
   * take place.
   */
  readSuccess?: (payload: Record<string, unknown> | null) => ActOutcome | null
): Promise<ActOutcome> {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    if (response.ok) {
      reload()
      if (!readSuccess) return { kind: 'done' }
      const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null
      return readSuccess(payload) ?? { kind: 'done' }
    }

    const payload = (await response.json().catch(() => null)) as { error?: string } | null
    // A refusal is still news about the row: re-read, so a card that was already past this act
    // stops offering it.
    reload()
    return payload?.error
      ? { kind: 'refused', reason: payload.error, detail: payload }
      : { kind: 'failed' }
  } catch {
    return { kind: 'failed' }
  }
}

/**
 * `POST .../places` ANSWERS `200` WHEN IT CREATES NOTHING.
 *
 * `provisionPartnerPlace` has three outcomes and only one of them is a place:
 * `created` is the act, `failed` becomes a 503, and `skipped` — `no_promoted_proposal`,
 * `nothing_to_prefill`, `already_provisioned` — is wrapped in `{ ok: true, place }` and reaches
 * the browser as a success. The card reported `Local criado` over a client that still has none.
 *
 * The general rule this is the first case of: THE SERVER SUCCEEDING IS NOT THE ACT HAPPENING.
 * What decides is the body, and here it is `place.status`.
 */
function readProvision(payload: Record<string, unknown> | null): ActOutcome | null {
  const place = payload?.place as { status?: string; reason?: string } | undefined
  if (place?.status === 'skipped' && place.reason) {
    return { kind: 'refused', reason: place.reason }
  }
  return null
}
