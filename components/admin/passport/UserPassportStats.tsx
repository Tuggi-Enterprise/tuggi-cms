'use client'

import { useTranslations } from 'next-intl'
import { Trophy, Navigation, Award } from 'lucide-react'
import type { PassportStats } from '@/lib/core/passport-service'
import { UNKNOWN_VALUE } from '@/lib/format/unknown'
import { favoriteCategoryLabel } from '@/lib/format/passport'
import { StatCard, StatCardRow } from '@/components/ui/StatCard'

interface UserPassportStatsProps {
  stats: PassportStats | null
}

/**
 * The lifetime numbers of the Passaporte, as the same compact `StatCard` the rest of the record
 * uses (#977). Only the stamps card keeps a hint: the decorative subtitles the others had said
 * nothing the number beside them did not (copy, #976). There is no Trips card: the Trip history
 * header already prints the count, one line below.
 */
export function UserPassportStats({ stats }: UserPassportStatsProps) {
  const t = useTranslations('Pages.AppUsers.passport')
  if (!stats) return null

  return (
    <StatCardRow columns={3} className="gap-3">
      <StatCard
        size="compact"
        glow={false}
        icon={Trophy}
        label={t('stamps')}
        value={String(stats.total_passed_lifetime)}
        subtitle={t('stamps_hint')}
      />
      <StatCard
        size="compact"
        glow={false}
        icon={Navigation}
        label={t('distance')}
        value={`${stats.total_distance_km.toFixed(1)} km`}
      />
      <StatCard
        size="compact"
        glow={false}
        icon={Award}
        label={t('top_category')}
        value={favoriteCategoryLabel(stats.top_categories) ?? UNKNOWN_VALUE}
      />
    </StatCardRow>
  )
}
