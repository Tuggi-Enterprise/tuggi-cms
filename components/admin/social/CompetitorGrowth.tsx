'use client'

/**
 * "Como a conta cresceu" in the Competitors view (#1064, spec M2): the overview's card, with a select
 * of the account in the card's note. The first competitor is chosen at the start, because ours is on
 * the other tab; ours stays an option, and then the chart is the overview's. The choice lives in the
 * component, not in the URL. Without a tracked competitor the card does not show.
 */

import { useState } from 'react'
import { TrendingUp } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Select } from '@/components/ui/select'
import { SocialGrowth } from './SocialGrowth'
import { CardError, CardLoading, LOADING_HEIGHT, SocialCard, socialQueries } from './shared'

export function CompetitorGrowth() {
  const t = useTranslations('Pages.Social.growth')
  const accounts = useQuery(socialQueries.accounts())
  const list = accounts.data?.accounts ?? []
  const own = list.find((a) => a.is_own) ?? null
  const rivals = list.filter((a) => !a.is_own).sort((x, y) => (y.followers ?? -1) - (x.followers ?? -1))
  const [chosen, setChosen] = useState<string | null>(null)
  const id = chosen && list.some((a) => a.id === chosen) ? chosen : (rivals[0]?.id ?? null)
  const query = useQuery({ ...socialQueries.growth(id ?? ''), enabled: !!id, placeholderData: keepPreviousData })

  if (accounts.data && rivals.length === 0) return null

  const picker = id ? (
    <label className="w-56">
      <span className="sr-only">{t('account_label')}</span>
      <Select value={id} onValueChange={(v) => setChosen(v)}>
        {own && <option value={own.id}>{t('account_own', { username: own.username })}</option>}
        {rivals.map((a) => (
          <option key={a.id} value={a.id}>
            @{a.username}
          </option>
        ))}
      </Select>
    </label>
  ) : undefined

  if (query.data) return <SocialGrowth growth={query.data} picker={picker} />
  return (
    <SocialCard title={t('title')} icon={TrendingUp} note={picker}>
      {query.isError ? <CardError onRetry={() => void query.refetch()} /> : <CardLoading height={LOADING_HEIGHT.growth} />}
    </SocialCard>
  )
}
