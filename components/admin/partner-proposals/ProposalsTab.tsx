'use client'

/**
 * The review queue. Same table discipline as the invites tab, and one column that is the
 * reason the screen exists: `Para o contrato`.
 *
 * That column reads BR-B2B-022 through the same module the review band uses, so the badge in
 * the list and the band on the page cannot disagree. And it says what is MISSING, never
 * "reprovada": an absent document blocks the contract, not the proposal — the proposal is
 * still promotable, which is criterion 9.
 */

import { useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { formatShortDate } from './format'
import type { ProposalRow, ProposalStatus } from './types'

const STATUSES: ProposalStatus[] = ['draft', 'submitted', 'promoted', 'discarded']

interface ProposalsTabProps {
  locale: string
  proposals: ProposalRow[]
  loading: boolean
  failed: boolean
  onReload: () => void
}

export function ProposalsTab({ locale, proposals, loading, failed, onReload }: ProposalsTabProps) {
  const t = useTranslations('PartnerProposals')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<'all' | ProposalStatus>('all')

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return proposals.filter((proposal) => {
      if (status !== 'all' && proposal.status !== status) return false
      if (!needle) return true
      return (
        (proposal.tradeName ?? '').toLowerCase().indexOf(needle) >= 0 ||
        (proposal.taxId ?? '').toLowerCase().indexOf(needle) >= 0 ||
        (proposal.city ?? '').toLowerCase().indexOf(needle) >= 0
      )
    })
  }, [proposals, search, status])

  const filtering = search.trim() !== '' || status !== 'all'

  return (
    <div className="flex flex-col gap-6 lg:flex-row">
      <aside className="w-full shrink-0 space-y-4 lg:w-64">
        <div>
          <Label htmlFor="proposal-search">{t('proposals.searchLabel')}</Label>
          <Input
            id="proposal-search"
            value={search}
            placeholder={t('proposals.searchPlaceholder')}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>

        <div>
          <Label htmlFor="proposal-status">{t('proposals.statusLabel')}</Label>
          <select
            id="proposal-status"
            value={status}
            onChange={(event) => setStatus(event.target.value as 'all' | ProposalStatus)}
            className="mt-1 block w-full rounded-md border border-input bg-white px-3 py-2 text-sm text-gray-900"
          >
            <option value="all">{t('proposals.allStatuses')}</option>
            {STATUSES.map((value) => (
              <option key={value} value={value}>
                {t(`proposals.statuses.${value}`)}
              </option>
            ))}
          </select>
        </div>

        {filtering && (
          <Button
            variant="outline"
            className="w-full"
            onClick={() => {
              setSearch('')
              setStatus('all')
            }}
          >
            {t('invites.clearFilters')}
          </Button>
        )}
      </aside>

      <section className="min-w-0 flex-1">
        {failed ? (
          <div className="rounded-md border border-gray-200 p-6 text-center">
            <p className="font-medium text-gray-900">{t('proposals.errorTitle')}</p>
            <Button variant="outline" className="mt-3" onClick={onReload}>
              {t('proposals.retry')}
            </Button>
          </div>
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-gray-300 text-left text-xs uppercase tracking-wide text-gray-700">
                <th scope="col" className="px-2 py-2">{t('proposals.columns.establishment')}</th>
                <th scope="col" className="px-2 py-2">{t('proposals.columns.taxId')}</th>
                <th scope="col" className="px-2 py-2">{t('proposals.columns.city')}</th>
                <th scope="col" className="px-2 py-2">{t('proposals.columns.received')}</th>
                <th scope="col" className="px-2 py-2">{t('proposals.columns.contract')}</th>
                <th scope="col" className="px-2 py-2">{t('proposals.columns.documents')}</th>
                <th scope="col" className="px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {loading &&
                [0, 1, 2, 3, 4].map((row) => (
                  <tr key={`skeleton-${row}`} className="border-b border-gray-100">
                    <td className="px-2 py-3" colSpan={7}>
                      <span className="sr-only">{t('proposals.loading')}</span>
                      <span className="block h-4 w-full animate-pulse rounded bg-gray-100" aria-hidden="true" />
                    </td>
                  </tr>
                ))}

              {!loading &&
                filtered.map((proposal) => (
                  <tr key={proposal.id} className="border-b border-gray-100 align-top">
                    <td className="px-2 py-3 text-gray-900">
                      {proposal.tradeName || t('review.noTradeName')}
                      {proposal.isPartial && (
                        <span className="ml-1 rounded-full border border-gray-400 px-1.5 py-0.5 text-xs text-gray-800">
                          {t('proposals.partialBadge')}
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-3 text-gray-800">{proposal.taxId || '—'}</td>
                    <td className="px-2 py-3 text-gray-800">
                      {proposal.city ? `${proposal.city}${proposal.state ? `/${proposal.state}` : ''}` : '—'}
                    </td>
                    <td className="px-2 py-3 text-gray-800">{formatShortDate(proposal.submittedAt)}</td>
                    <td className="px-2 py-3">
                      {proposal.missingForContract.length === 0 ? (
                        <span className="font-medium text-green-800">{t('proposals.ready')}</span>
                      ) : (
                        <span className="font-medium text-secondary-700">
                          {t('proposals.missing', { count: proposal.missingForContract.length })}
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-3 text-gray-800">{proposal.documentCount}</td>
                    <td className="px-2 py-3">
                      <Link
                        href={`/${locale}/admin/partner-proposals/${proposal.id}`}
                        className="text-sm font-medium text-primary-800 underline underline-offset-4"
                      >
                        {t('proposals.open')}
                      </Link>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        )}

        {!loading && !failed && filtered.length === 0 && (
          <div className="rounded-md border border-gray-200 p-6 text-center">
            {filtering ? (
              <>
                <p className="font-medium text-gray-900">{t('proposals.emptyFilteredTitle')}</p>
                <Button
                  variant="outline"
                  className="mt-3"
                  onClick={() => {
                    setSearch('')
                    setStatus('all')
                  }}
                >
                  {t('invites.clearFilters')}
                </Button>
              </>
            ) : (
              <>
                <p className="font-medium text-gray-900">{t('proposals.emptyTitle')}</p>
                <p className="mx-auto mt-1 max-w-lg text-sm text-gray-800">{t('proposals.emptyBody')}</p>
              </>
            )}
          </div>
        )}
      </section>
    </div>
  )
}
