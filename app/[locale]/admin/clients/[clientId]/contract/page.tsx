import { ContractManager } from '@/components/admin/contract/ContractManager'

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
}: {
  params: Promise<{ locale: string; clientId: string }>
}) {
  const { clientId } = await params
  return <ContractManager clientId={clientId} />
}
