'use client'

/**
 * "Por campanha" (#1062, spec R2.3): the GA4 store clicks from Instagram by campaign token and store,
 * next to the Apple first-time downloads of the same token, in the funnel's period. Two rulers side by
 * side and never a ratio between them (DS-COMPONENTE-084 item 2): a click on the site and a tap on
 * "Obter" are not the same event. Every number comes from `social.campaign_totals`.
 *
 * The state of the Apple column is said once, in the head and the card's note, never cell by cell
 * (#1051): no key, key without a first report, or a report that covers only part of the period (the
 * head says since when, and the numbers are a floor). While GA4 does not split by store, the two click
 * columns print "sem dado", not zero.
 */

import { useMemo, useState } from 'react'
import { Megaphone } from 'lucide-react'
import { useTranslations } from 'next-intl'
import {
  CELL,
  DIM,
  DenseTableScroller,
  HEAD_SOLO,
  HEAD_SOLO_NUM,
  NUM,
  SortHead,
  type SortState,
} from '@/components/ui/dense-table'
import { UNKNOWN_VALUE } from '@/lib/format/unknown'
import { fmtDay, fmtInt } from '@/lib/social/format'
import type { CampaignRow, OverviewPayload } from '@/lib/social/repository'
import { SocialCard } from './shared'

type SortKey = 'clicks_app_store' | 'clicks_play_store' | 'downloads_ios'

/** Sorted copy, nulls last; with no sort the database's order (total clicks, descending). */
export function sortCampaigns(rows: CampaignRow[], sort: SortState<SortKey> | null): CampaignRow[] {
  if (!sort) return rows
  return [...rows].sort((a, b) => {
    const va = a[sort.key]
    const vb = b[sort.key]
    if (va === null && vb === null) return 0
    if (va === null) return 1
    if (vb === null) return -1
    return (va - vb) * sort.dir
  })
}

export function SocialCampaigns({ data }: { data: OverviewPayload }) {
  const t = useTranslations('Pages.Social.campaigns')
  const ts = useTranslations('Pages.Social.posts')
  const [sort, setSort] = useState<SortState<SortKey> | null>(null)
  const rows = useMemo(() => sortCampaigns(data.campaigns, sort), [data.campaigns, sort])
  const toggle = (key: SortKey) => setSort((s) => (s?.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: -1 }))

  const { configured, first_day } = data.apple
  const appleNote = !configured ? t('apple_missing') : first_day === null ? t('apple_pending') : null
  const partial = configured && first_day !== null && first_day > data.funnel.from
  const downloadsLabel = partial ? t('col_downloads_ios_since', { date: fmtDay(first_day as string) }) : t('col_downloads_ios')
  const storeHint = data.clicks_by_store ? undefined : t('store_unknown')

  const head = (key: SortKey, label: string, hint?: string) => (
    <SortHead
      column={key}
      label={label}
      className={`${HEAD_SOLO_NUM} w-[110px] whitespace-normal`}
      sort={sort}
      onToggle={toggle}
      title={hint ? `${ts('sort_aria', { column: label })}. ${hint}` : ts('sort_aria', { column: label })}
    />
  )
  const cell = (v: number | null, hint?: string) =>
    v === null ? (
      <span className={DIM} title={hint}>
        {t('na')}
      </span>
    ) : (
      fmtInt(v)
    )

  return (
    <SocialCard title={t('title')} icon={Megaphone} note={t('note')}>
      {appleNote && <p className={`mb-3 text-xs ${DIM}`}>{appleNote}</p>}
      {data.campaigns.length === 0 ? (
        <p className="text-sm italic text-gray-500">{t('empty')}</p>
      ) : (
        <DenseTableScroller label={t('table_label')} maxHeightClassName="max-h-[28rem]">
          <table className="w-max min-w-full border-collapse">
            <thead>
              <tr>
                <th scope="col" className={`${HEAD_SOLO} w-[200px]`}>
                  {t('col_campaign')}
                </th>
                {head('clicks_app_store', t('col_clicks_app_store'), storeHint)}
                {head('clicks_play_store', t('col_clicks_play_store'), storeHint)}
                {head('downloads_ios', downloadsLabel, appleNote ?? t('downloads_hint'))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.campaign} className="border-t border-gray-100 dark:border-gray-800">
                  <td className={`${CELL} max-w-[200px] truncate font-mono text-xs`} title={r.campaign}>
                    {r.campaign}
                  </td>
                  <td className={NUM}>{cell(data.clicks_by_store ? r.clicks_app_store : null, storeHint)}</td>
                  <td className={NUM}>{cell(data.clicks_by_store ? r.clicks_play_store : null, storeHint)}</td>
                  <td className={NUM}>
                    {r.downloads_ios === null ? <span className={DIM}>{UNKNOWN_VALUE}</span> : fmtInt(r.downloads_ios)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </DenseTableScroller>
      )}
      <p className={`mt-2 text-[11px] ${DIM}`}>{t('footer')}</p>
    </SocialCard>
  )
}
