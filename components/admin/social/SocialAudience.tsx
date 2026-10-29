'use client'

/**
 * "Quem nos segue" (#1062, spec R2.5): the latest weekly `follower_demographics` snapshot of our
 * account in four lists of `RankRow`: the five largest cities and countries, the age ranges and the
 * genders Meta answers. The share is the database's (`social.latest_audience`); the period of the
 * page does not change it, and the note says the snapshot's date.
 */

import { Users } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { RankRow } from '@/components/dashboard/reports/acquisition/RankRow'
import { DIM } from '@/components/ui/dense-table'
import { CHART_COLORS } from '@/lib/constants/chart-colors'
import { UNKNOWN_VALUE } from '@/lib/format/unknown'
import { fmtDay, fmtInt, fmtRate } from '@/lib/social/format'
import type { AudienceItem, OverviewPayload } from '@/lib/social/repository'
import { addDays, mondayOf } from '@/lib/social/time'
import { SocialCard } from './shared'

const LISTS = ['city', 'country', 'age', 'gender'] as const

let regionNames: Intl.DisplayNames | null | undefined
/** A country code as its name in Portuguese ("BR" is "Brasil"); the code itself when unknown. */
function countryName(code: string): string {
  if (regionNames === undefined) {
    try {
      regionNames = new Intl.DisplayNames(['pt-BR'], { type: 'region' })
    } catch {
      regionNames = null
    }
  }
  try {
    return regionNames?.of(code) ?? code
  } catch {
    return code
  }
}

export function SocialAudience({ data }: { data: OverviewPayload }) {
  const t = useTranslations('Pages.Social.audience')
  const audience = data.audience

  const label = (list: (typeof LISTS)[number], raw: string): string => {
    if (list === 'country') return countryName(raw)
    if (list === 'gender') {
      const g = raw.toLowerCase()
      return g === 'f' || g === 'm' || g === 'u' ? t(`gender_${g}`) : raw
    }
    if (list === 'age') {
      const range = /^(\d+)-(\d+)$/.exec(raw)
      if (range) return t('age_range', { from: range[1], to: range[2] })
      const open = /^(\d+)\+$/.exec(raw)
      if (open) return t('age_open', { from: open[1] })
    }
    return raw
  }

  const list = (key: (typeof LISTS)[number], items: AudienceItem[]) => {
    const max = Math.max(0, ...items.map((i) => i.count))
    return (
      <div key={key}>
        <h3 className="text-[10px] font-black uppercase tracking-widest text-gray-500">{t(key)}</h3>
        <ul>
          {items.map((i) => (
            <li key={i.label}>
              <RankRow
                label={label(key, i.label)}
                value={i.count}
                display={i.share === null ? UNKNOWN_VALUE : fmtRate(i.share)}
                max={max}
                color={CHART_COLORS.blue}
                right={<span className={`text-[11px] tabular-nums ${DIM}`}>{fmtInt(i.count)}</span>}
              />
            </li>
          ))}
        </ul>
      </div>
    )
  }

  return (
    <SocialCard title={t('title')} icon={Users} note={audience ? t('note', { date: fmtDay(audience.day) }) : undefined}>
      {!audience ? (
        <p className="text-sm italic text-gray-500">
          {data.audience_reason === 'below_100'
            ? t('below_100')
            : t('not_collected', { date: fmtDay(addDays(mondayOf(data.today), 7)) })}
        </p>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">{LISTS.map((k) => list(k, audience[k]))}</div>
          <p className={`mt-2 text-[11px] ${DIM}`}>{t('footer')}</p>
        </>
      )}
    </SocialCard>
  )
}
