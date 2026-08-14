'use client'

/**
 * One route, two tabs — `Propostas` and `Convites`.
 *
 * They are the same queue at two moments and the operator switches between them constantly;
 * two menu entries would send them back to the menu on every switch (DS-LAYOUT-003). Each tab
 * carries the count of what is waiting for an act, so the number is readable without opening
 * the tab: proposals still to review, and links still live.
 *
 * Both lists are loaded together, once, because the counts have to be right on arrival and
 * both fit in one round trip.
 */

import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { InvitesTab } from './InvitesTab'
import { ProposalsTab } from './ProposalsTab'
import type { InviteRow, ProposalRow } from './types'

type Tab = 'proposals' | 'invites'

async function fetchJson(url: string): Promise<Record<string, unknown> | null> {
  try {
    const response = await fetch(url)
    if (!response.ok) return null
    return (await response.json()) as Record<string, unknown>
  } catch {
    return null
  }
}

export function PartnerProposalsPageContent({ locale }: { locale: string }) {
  const t = useTranslations('PartnerProposals')
  const [tab, setTab] = useState<Tab>('proposals')

  const [invites, setInvites] = useState<InviteRow[]>([])
  const [proposals, setProposals] = useState<ProposalRow[]>([])
  const [loading, setLoading] = useState(true)
  const [invitesFailed, setInvitesFailed] = useState(false)
  const [proposalsFailed, setProposalsFailed] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setInvitesFailed(false)
    setProposalsFailed(false)

    // One failure must not blank the other tab: each list answers for itself, and the tab
    // that loaded stays usable while the other offers `Tentar de novo`.
    const inviteResult = await fetchJson('/api/admin/partner-invites')
    const proposalResult = await fetchJson('/api/admin/partner-proposals')

    if (inviteResult && Array.isArray(inviteResult.invites)) {
      setInvites(inviteResult.invites as InviteRow[])
    } else {
      setInvitesFailed(true)
    }

    if (proposalResult && Array.isArray(proposalResult.proposals)) {
      setProposals(proposalResult.proposals as ProposalRow[])
    } else {
      setProposalsFailed(true)
    }

    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // What is waiting for an act, and nothing else: a promoted proposal and a spent link are
  // history, not queue.
  const proposalsWaiting = proposals.filter((proposal) => proposal.status === 'submitted').length
  const invitesLive = invites.filter(
    (invite) => invite.situation === 'sent' || invite.situation === 'started'
  ).length

  return (
    <div className="mx-auto w-full max-w-7xl px-6 py-6">
      <header className="mb-5">
        <h1 className="text-2xl font-semibold text-gray-900">{t('title')}</h1>
        <p className="mt-1 text-sm text-gray-700">{t('subtitle')}</p>
      </header>

      <div role="tablist" aria-label={t('title')} className="mb-5 flex gap-1 border-b border-gray-300">
        {(['proposals', 'invites'] as Tab[]).map((value) => (
          <button
            key={value}
            role="tab"
            id={`partner-tab-${value}`}
            type="button"
            aria-selected={tab === value}
            aria-controls={`partner-panel-${value}`}
            onClick={() => setTab(value)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${
              tab === value
                ? 'border-primary text-primary-800'
                : 'border-transparent text-gray-700 hover:text-gray-900'
            }`}
          >
            {t('tabs.withCount', {
              label: t(`tabs.${value}`),
              count: value === 'proposals' ? proposalsWaiting : invitesLive,
            })}
          </button>
        ))}
      </div>

      <div
        role="tabpanel"
        id={`partner-panel-${tab}`}
        aria-labelledby={`partner-tab-${tab}`}
      >
        {tab === 'proposals' ? (
          <ProposalsTab
            locale={locale}
            proposals={proposals}
            loading={loading}
            failed={proposalsFailed}
            onReload={load}
          />
        ) : (
          <InvitesTab
            locale={locale}
            invites={invites}
            loading={loading}
            failed={invitesFailed}
            onReload={load}
          />
        )}
      </div>
    </div>
  )
}
