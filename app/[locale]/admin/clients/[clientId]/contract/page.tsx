import { ContractManager } from '@/components/admin/contract/ContractManager'
import {
  RETURN_LABEL_PARAM,
  RETURN_TO_PARAM,
  parseReturnLabel,
  parseReturnTo,
} from '@/lib/navigation/return-to'

/**
 * The contract page of one client (#342). Behind the CMS login, like every other route
 * under `/admin` — BR-B2B-026, item 1: the contract lives in the CMS and whoever makes it
 * is logged in.
 *
 * Its own route rather than a tab of `ClientEditorModal`, decided by the Tech Lead in #342:
 * a contract is a long document with an audit trail and a version history, and it does not
 * fit in a modal. The modal keeps a summary tab that links here, so the state still shows
 * up where the team already looks.
 *
 * The authorization that matters is the API's — `app/api/admin/clients/[clientId]/contract`
 * is `withAuth({ roles: ['admin'] })` and this page renders nothing it did not fetch from
 * there.
 */

export default async function ClientContractPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; clientId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { clientId } = await params
  const query = await searchParams

  // The way back, when somebody was sent here — DS-LAYOUT-006, point 2. The partnership
  // pipeline composes the sentence, this page only renders it; the rule of what may be
  // trusted is shared with every other screen that takes one.
  const first = (key: string) => {
    const value = query[key]
    return Array.isArray(value) ? value[0] ?? null : value ?? null
  }
  const returnTo = parseReturnTo(first(RETURN_TO_PARAM))
  const returnLabel = parseReturnLabel(first(RETURN_LABEL_PARAM), returnTo)

  return <ContractManager clientId={clientId} returnTo={returnTo} returnLabel={returnLabel} />
}
