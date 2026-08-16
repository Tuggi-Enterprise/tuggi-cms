'use client'

/**
 * One route, one list.
 *
 * It used to be two tabs — `Propostas` and `Convites` — because a link had a life of its own:
 * minted, sent, opened, expired, revoked. There is no link any more (operator, 2026-08-16):
 * the same address goes to everybody, so the only thing with a state is the proposal, and a
 * tab strip with one tab is a control that teaches the operator nothing.
 */

import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { ProposalsTab } from './ProposalsTab'
import type { ProposalRow } from './types'

export function PartnerProposalsPageContent({ locale }: { locale: string }) {
  const t = useTranslations('PartnerProposals')

  const [proposals, setProposals] = useState<ProposalRow[]>([])
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setFailed(false)
    try {
      const response = await fetch('/api/admin/partner-proposals')
      const payload = response.ok ? await response.json() : null
      if (payload && Array.isArray(payload.proposals)) {
        setProposals(payload.proposals as ProposalRow[])
      } else {
        setFailed(true)
      }
    } catch {
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // What is waiting for an act, and nothing else: a promoted proposal is history, not queue.
  const waiting = proposals.filter((proposal) => proposal.status === 'submitted').length

  return (
    <div className="mx-auto w-full max-w-7xl px-6 py-6">
      <header className="mb-5">
        <h1 className="text-2xl font-semibold text-gray-900">
          {t('tabs.withCount', { label: t('title'), count: waiting })}
        </h1>
        <p className="mt-1 text-sm text-gray-700">{t('subtitle')}</p>
      </header>

      <ProposalsTab
        locale={locale}
        proposals={proposals}
        loading={loading}
        failed={failed}
        onReload={load}
      />
    </div>
  )
}
