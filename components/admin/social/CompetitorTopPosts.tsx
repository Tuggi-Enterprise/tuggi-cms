'use client'

/**
 * "O que rendeu nos concorrentes" (#1062, spec R2.1): the ten posts of the tracked competitors with
 * the most interactions per follower in one week (Monday to Sunday, Brasília), from
 * `social.competitor_top_posts`. The ruler is the comparative table's (likes and comments over the
 * followers on the post day), because Meta gives no reach of a third party. The order is the
 * database's; the table does not sort. Hashtags are plain text, selectable, so the operator copies.
 *
 * Without a tracked competitor the card does not show: the form above already says what to do.
 */

import { useState } from 'react'
import { ExternalLink, Trophy } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useQuery } from '@tanstack/react-query'
import { Select } from '@/components/ui/select'
import { CELL, DIM, DenseTableScroller, HEAD_SOLO, HEAD_SOLO_NUM, ICON_CELL, NUM } from '@/components/ui/dense-table'
import { UNKNOWN_VALUE } from '@/lib/format/unknown'
import { fmtDay, fmtInt, fmtRate2 } from '@/lib/social/format'
import { safePermalink } from '@/lib/social/funnel'
import { formatKey, themeKey } from '@/lib/social/labels'
import { addDays, brasiliaDay } from '@/lib/social/time'
import { ICON_LINK } from './SocialPostsTable'
import { CardError, RawValue, SocialCard, socialQueries } from './shared'

/** Hashtags printed before the "+n" (spec R2.1). */
const HASHTAGS_SHOWN = 5

export function CompetitorTopPosts() {
  const t = useTranslations('Pages.Social.competitor_posts')
  const ts = useTranslations('Pages.Social')
  const [week, setWeek] = useState<string | null>(null)
  const query = useQuery(socialQueries.competitorPosts(week))
  const data = query.data

  if (data && data.tracked === 0) return null

  const weekLabel = (start: string) =>
    data && start === data.weeks[data.weeks.length - 1]
      ? t('week_current', { day: fmtDay(data.today) })
      : t('week_closed', { from: fmtDay(start), to: fmtDay(addDays(start, 6)) })

  const picker = data ? (
    <label className="w-56">
      <span className="sr-only">{t('week_label')}</span>
      <Select value={data.week_start} onValueChange={(v) => setWeek(v)}>
        {data.weeks.map((w) => (
          <option key={w} value={w}>
            {weekLabel(w)}
          </option>
        ))}
      </Select>
    </label>
  ) : undefined

  return (
    <SocialCard title={t('title')} icon={Trophy} note={picker}>
      {query.isError ? (
        <CardError onRetry={() => void query.refetch()} />
      ) : data && data.rows.length === 0 ? (
        <p className="text-sm italic text-gray-500">{t('empty', { date: fmtDay(data.week_start) })}</p>
      ) : (
        <>
          <DenseTableScroller label={t('table_label')} maxHeightClassName="max-h-[32rem]">
            <table className="w-max min-w-full border-collapse">
              <thead>
                <tr>
                  <th scope="col" className={`${HEAD_SOLO} w-[36px]`}>
                    <span className="sr-only">#</span>
                  </th>
                  <th scope="col" className={`${HEAD_SOLO} w-[150px]`}>
                    {t('col_account')}
                  </th>
                  <th scope="col" className={`${HEAD_SOLO} w-[90px]`}>
                    {t('col_date')}
                  </th>
                  <th scope="col" className={`${HEAD_SOLO} w-[90px]`}>
                    {t('col_format')}
                  </th>
                  <th scope="col" className={`${HEAD_SOLO} w-[100px]`}>
                    {t('col_theme')}
                  </th>
                  <th scope="col" className={`${HEAD_SOLO} w-[220px]`}>
                    {t('col_post')}
                  </th>
                  <th scope="col" className={`${HEAD_SOLO} w-[240px]`}>
                    {t('col_hashtags')}
                  </th>
                  <th scope="col" className={`${HEAD_SOLO_NUM} w-[100px] whitespace-normal`} title={t('rate_hint')}>
                    {t('col_rate')}
                  </th>
                  <th scope="col" className={`${HEAD_SOLO_NUM} w-[76px]`}>
                    {t('col_likes')}
                  </th>
                  <th scope="col" className={`${HEAD_SOLO_NUM} w-[76px]`} title={t('col_comments_full')}>
                    {t('col_comments')}
                  </th>
                  <th scope="col" className={`${HEAD_SOLO} w-[36px]`}>
                    <span className="sr-only">{t('col_open')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {!data
                  ? [0, 1, 2].map((i) => (
                      <tr key={i} className="animate-pulse">
                        <td colSpan={11} className={CELL}>
                          <span className="block h-4 rounded bg-gray-100 dark:bg-gray-800" />
                        </td>
                      </tr>
                    ))
                  : data.rows.map((r, i) => {
                      const theme = themeKey(r.theme)
                      const link = safePermalink(r.permalink)
                      const shown = r.hashtags.slice(0, HASHTAGS_SHOWN)
                      const more = r.hashtags.length - shown.length
                      return (
                        <tr key={`${r.username}:${r.posted_at}:${i}`} className="border-t border-gray-100 dark:border-gray-800">
                          <td className={`${NUM} ${DIM}`} aria-hidden="true">
                            {i + 1}
                          </td>
                          <td className={`${CELL} max-w-[150px] truncate`}>
                            <a
                              href={`https://www.instagram.com/${r.username}/`}
                              target="_blank"
                              rel="noopener"
                              className="hover:underline"
                              title={`@${r.username}`}
                            >
                              @{r.username}
                            </a>
                          </td>
                          <td className={`${CELL} whitespace-nowrap`}>
                            {r.posted_at ? fmtDay(brasiliaDay(new Date(r.posted_at))) : UNKNOWN_VALUE}
                          </td>
                          <td className={`${CELL} whitespace-nowrap`}>{ts(`format.${formatKey(r.media_type, r.media_product_type)}`)}</td>
                          <td className={`${CELL} whitespace-nowrap`}>
                            {theme === null ? (
                              <RawValue value={r.theme} />
                            ) : theme === 'pending' ? (
                              <span className={DIM}>{ts('theme.pending')}</span>
                            ) : (
                              ts(`theme.${theme}`)
                            )}
                          </td>
                          <td className={`${CELL} max-w-[220px]`}>
                            <span className="block truncate" title={r.caption_first_line ?? undefined}>
                              {r.caption_first_line ?? <span className={DIM}>{UNKNOWN_VALUE}</span>}
                            </span>
                          </td>
                          <td className={`${CELL} max-w-[240px] whitespace-normal text-xs`}>
                            {shown.map((h) => `#${h}`).join(' ')}
                            {more > 0 && (
                              <span className={`ml-1 ${DIM}`} title={r.hashtags.map((h) => `#${h}`).join(' ')}>
                                {t('more_hashtags', { count: more })}
                              </span>
                            )}
                          </td>
                          <td className={NUM}>{r.rate === null ? <span className={DIM}>{UNKNOWN_VALUE}</span> : fmtRate2(r.rate)}</td>
                          <td className={NUM}>{r.likes === null ? <span className={DIM}>{UNKNOWN_VALUE}</span> : fmtInt(r.likes)}</td>
                          <td className={NUM}>{r.comments === null ? <span className={DIM}>{UNKNOWN_VALUE}</span> : fmtInt(r.comments)}</td>
                          <td className={ICON_CELL}>
                            {link && (
                              <a
                                href={link}
                                target="_blank"
                                rel="noopener"
                                aria-label={t('open_aria', { username: r.username })}
                                className={ICON_LINK}
                              >
                                <ExternalLink className="h-4 w-4" aria-hidden="true" />
                              </a>
                            )}
                          </td>
                        </tr>
                      )
                    })}
              </tbody>
            </table>
          </DenseTableScroller>
          <p className={`mt-2 text-[11px] ${DIM}`}>{t('footer')}</p>
        </>
      )}
    </SocialCard>
  )
}
