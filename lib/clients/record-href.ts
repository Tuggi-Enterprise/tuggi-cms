/**
 * THE ONE PLACE THAT WRITES THE ADDRESS OF `Abrir`.
 *
 * The defect this module exists to end, reported by the operator on 2026-09-09 as two separate
 * complaints that turned out to be one line of code: `Quadro/Tabela` reset when a client was
 * opened, and so did every filter. `detailPath` returned `/admin/clients?clientId=X&tab=partnership`
 * — a query built from NOTHING. It carried the record and dropped `view`, `search`, `country`,
 * `region`, `city`, `clientType`, `status`, `contract`, `plan`, `state` and `onlyLate`. Opening
 * a card from `Minas, sem contrato` in the table and closing it landed the operator on an
 * unfiltered board.
 *
 * The host already had `openRecord`, which preserved everything correctly. It just was not what
 * the link used — one screen with two ways to open the same record, and the wrong one was the
 * one under the cursor. That is the shape of the fix: not a second correct composer, but ONE,
 * used by the link and by `openRecord` alike.
 *
 * WHY A REAL `href` AND NOT AN `onClick`. `Abrir` is a `<Link>` and has to stay one — the
 * operator middle-clicks it to open a second partner in another tab while keeping the queue on
 * screen, and a handler that calls `router.push` breaks that without saying so. So this returns
 * a STRING the anchor can carry, rather than performing the navigation.
 *
 * Nothing here fetches and nothing here is React: it is proven by
 * `tests/api/client-record-href.test.ts` without a browser.
 */

import type { DetailTarget } from '@/lib/partnerships/pipeline'
import { RETURN_TO_PARAM } from '@/lib/navigation/return-to'

/**
 * The parameters the record OWNS, and which therefore never survive from the previous address.
 *
 * `mode` and `new` open the creation form; carrying either into a link that opens an existing
 * record would render the editor in two modes at once. `clientId` and `tab` are overwritten
 * rather than preserved, for the same reason.
 */
const RECORD_PARAMS = ['clientId', 'tab', 'mode', 'new'] as const

/**
 * Where `Abrir` on `/admin/clients` points, with every filter the operator has applied kept.
 *
 * `current` is the list's own query string. Everything in it travels except what the record
 * owns, which is what makes `?view=table&state=in_progress` still be true after closing the
 * drawer — the drawer opens OVER the list and the list is still the thing behind it.
 */
export function recordHref(
  locale: string,
  current: URLSearchParams,
  target: DetailTarget
): string {
  if (target.kind === 'proposal') return proposalHref(locale, current, target.submissionId)

  const params = new URLSearchParams(current.toString())
  for (const key of RECORD_PARAMS) params.delete(key)
  params.set('clientId', target.clientId)
  params.set('tab', target.tab)
  return `/${locale}/admin/clients?${params.toString()}`
}

/**
 * A proposal is a PAGE and not a drawer, so the list does not stay behind it — the way back has
 * to be declared, which is what `returnTo` is for (DS-LAYOUT-006, point 2). Before this, the
 * proposal link carried no `returnTo` at all and the only way back was the browser's button,
 * which is the same defect the drawer had, one screen further along.
 *
 * The path it returns to keeps the locale prefix off, because `parseReturnTo` accepts an in-app
 * path and the proposal screen pushes it as given.
 */
function proposalHref(locale: string, current: URLSearchParams, submissionId: string): string {
  // The list to come back to is the list, not the list with somebody's record open over it: a
  // `returnTo` carrying `clientId` would reopen the drawer the operator left through.
  const back = new URLSearchParams(current.toString())
  for (const key of RECORD_PARAMS) back.delete(key)
  const query = back.toString()
  const home = `/admin/clients${query ? `?${query}` : ''}`
  const params = new URLSearchParams({ [RETURN_TO_PARAM]: home })
  return `/${locale}/admin/partnerships/proposals/${submissionId}?${params.toString()}`
}
