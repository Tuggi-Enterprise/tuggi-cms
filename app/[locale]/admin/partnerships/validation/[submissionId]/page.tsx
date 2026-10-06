import { redirect } from 'next/navigation'
import { RETURN_TO_PARAM, parseReturnTo } from '@/lib/navigation/return-to'
import { recordHref } from '@/lib/clients/record-href'

/**
 * Validation of one Portal Locais submission (#812, BR-B2B-049, BR-B2B-048, BR-B2B-053) — spec
 * `docs/design/spec-validacao-portal-locais-2026-10.md`.
 *
 * NOT A SCREEN ANY MORE (#870, operator 2026-10-06): the validation opens in the side drawer over
 * the client board, `/admin/clients?validation=<id>` (`ValidationModal`). This address stays alive
 * as a redirect so the links already out there — e-mails, bookmarks — land on that drawer, with
 * the filters of `?returnTo=` when the board they came from was the client board.
 */
export default async function PortalValidationPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; submissionId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { locale, submissionId } = await params
  const raw = (await searchParams)[RETURN_TO_PARAM]
  const returnTo = parseReturnTo(Array.isArray(raw) ? raw[0] : raw)
  const [path, query = ''] = (returnTo ?? '').split('?')
  const board = new URLSearchParams(path === '/admin/clients' ? query : '')

  redirect(recordHref(locale, board, { kind: 'validation', submissionId }))
}
