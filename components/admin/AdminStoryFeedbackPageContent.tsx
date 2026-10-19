'use client'

/**
 * Client-side content of /admin/story-feedback, card #950, BR-CONTEUDO-009 item 5, spec
 * `docs/design/spec-voto-na-historia-2026-10.md` §7. Shell, filters in the URL, table, pagination and
 * states follow `AdminCancellationsPageContent`.
 *
 * One row per POI and language with at least one down on the current text. A click on the row opens
 * the newest comments below it. Nothing on this screen identifies the tourist (item 7): the route
 * answers no author, and nothing here asks for one.
 */

import { Fragment, Suspense, useEffect, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { AlertCircle, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, ThumbsDown } from 'lucide-react'
import Link from 'next/link'
import { useLocale, useTranslations } from 'next-intl'
import { Container } from '@/components/ui/Container'
import { useCmsUser } from '@/lib/hooks/useCmsUser'
import { formatDate } from '@/lib/contract/snapshot'
import { placeToolHref } from '@/lib/partnerships/place-tool'
import {
  STORY_LANGUAGES,
  STORY_REASON_FILTERS,
  isStoryLanguage,
  isStoryReasonFilter,
  isStorySort,
  type StoryFeedbackItem,
  type StorySort,
} from '@/lib/story-feedback'

const PAGE_SIZE = 50

export interface StoryFeedbackViewProps {
  rows: StoryFeedbackItem[]
  loading: boolean
  error: boolean
  filtered: boolean
  sort: StorySort
  /** `/<locale>/admin/story-feedback?…`, where the POI screen sends the curator back. */
  returnTo: string
  onSort: (sort: StorySort) => void
  onClearFilters: () => void
  onRetry: () => void
}

/** The table, without data fetching or routing. */
export function StoryFeedbackView({ rows, loading, error, filtered, sort, returnTo, onSort, onClearFilters, onRetry }: StoryFeedbackViewProps) {
  const t = useTranslations('Pages.StoryFeedback')
  const locale = useLocale()
  const [open, setOpen] = useState<string | null>(null)
  const columns = 8

  const sortable = (key: StorySort, label: string) => (
    <th className="px-4 py-3 text-right" aria-sort={sort === key ? 'descending' : 'none'}>
      <button type="button" onClick={() => onSort(key)} className={`uppercase tracking-wider hover:text-gray-800 ${sort === key ? 'font-bold text-gray-800' : ''}`}>
        {label}
      </button>
    </th>
  )

  return (
    <>
      {error && (
        <div role="alert" className="mb-4 flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <AlertCircle size={16} /> {t('error')}
          <button type="button" onClick={onRetry} className="ml-2 font-semibold text-tuggi-blue hover:underline">
            {t('retry')}
          </button>
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50 text-xs uppercase tracking-wider text-gray-500">
            <tr>
              <th className="px-4 py-3 text-left">{t('headers.poi')}</th>
              <th className="px-4 py-3 text-left">{t('headers.lang')}</th>
              {sortable('wrong', t('headers.wrong'))}
              {sortable('dislike', t('headers.dislike'))}
              {sortable('downNoReason', t('headers.downNoReason'))}
              {sortable('up', t('headers.up'))}
              {sortable('lastVote', t('headers.lastVote'))}
              <th className="px-4 py-3">
                <span className="sr-only">{t('comments')}</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr>
                <td colSpan={columns} className="px-4 py-10 text-center text-gray-400">
                  {t('loading')}
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={columns} className="px-4 py-10 text-center text-gray-400">
                  {filtered ? t('emptyFiltered') : t('empty')}
                  {filtered && (
                    <button type="button" onClick={onClearFilters} className="ml-2 font-semibold text-tuggi-blue hover:underline">
                      {t('clearFilters')}
                    </button>
                  )}
                </td>
              </tr>
            ) : (
              rows.map((r) => {
                const key = `${r.poiId}:${r.language}`
                const expanded = open === key
                // The RPC carries no entity_kind: `null` opens the POI editor, on the description tab.
                const href = placeToolHref({
                  locale,
                  attractionId: r.poiId,
                  entityKind: null,
                  returnTo,
                  returnLabel: t('backHere'),
                  pendency: 'audio_description',
                })
                return (
                  <Fragment key={key}>
                    <tr className="cursor-pointer hover:bg-gray-50/50" onClick={() => setOpen(expanded ? null : key)}>
                      <td className="px-4 py-3 font-semibold text-gray-900">
                        <Link href={href} onClick={(e) => e.stopPropagation()} className="hover:text-tuggi-blue hover:underline">
                          {r.poiName ?? '—'}
                        </Link>
                      </td>
                      <td className="px-4 py-3 uppercase text-gray-700">{r.language}</td>
                      <td className="px-4 py-3 text-right font-semibold text-gray-900">{r.wrong}</td>
                      <td className="px-4 py-3 text-right text-gray-700">{r.disliked}</td>
                      <td className="px-4 py-3 text-right text-gray-700">{r.downNoReason}</td>
                      <td className="px-4 py-3 text-right text-gray-700">{r.up}</td>
                      <td className="px-4 py-3 text-right text-xs text-gray-500">{r.lastVoteAt ? formatDate(r.lastVoteAt) : '—'}</td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          aria-expanded={expanded}
                          aria-label={t('comments')}
                          onClick={(e) => {
                            e.stopPropagation()
                            setOpen(expanded ? null : key)
                          }}
                          className="rounded p-1 text-gray-500 hover:bg-gray-100"
                        >
                          {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                        </button>
                      </td>
                    </tr>
                    {expanded && (
                      <tr className="bg-gray-50/60">
                        <td colSpan={columns} className="px-6 py-3">
                          {r.comments.length === 0 ? (
                            <p className="text-sm text-gray-400">{t('noComment')}</p>
                          ) : (
                            <ul className="space-y-2">
                              {r.comments.map((c, i) => (
                                <li key={`${c.at}-${i}`} className="text-sm text-gray-700">
                                  <span className="mr-2 text-xs text-gray-500">{formatDate(c.at)}</span>
                                  <span className="mr-2 text-xs font-semibold text-gray-600">
                                    {t(`reasons.${c.reason ?? 'none'}`)}
                                    {c.gender ? ` · ${t('headers.voice')}: ${c.gender === 'male' || c.gender === 'female' ? t(`voices.${c.gender}`) : c.gender}` : ''}
                                  </span>
                                  <span className="whitespace-pre-wrap">{c.comment}</span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </>
  )
}

function AdminStoryFeedbackContent() {
  const t = useTranslations('Pages.StoryFeedback')
  const locale = useLocale()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  // Same gate as the route: admin only.
  const { isAdmin, isLoading: authChecking } = useCmsUser()
  const isAuthorized = !authChecking && isAdmin

  const rawLang = searchParams.get('lang')
  const rawReason = searchParams.get('reason')
  const rawSort = searchParams.get('sort')
  const lang = isStoryLanguage(rawLang) ? rawLang : ''
  const reason = isStoryReasonFilter(rawReason) ? rawReason : ''
  const sort: StorySort = isStorySort(rawSort) ? rawSort : 'wrong'
  const filtered = Boolean(lang || reason)

  const [rows, setRows] = useState<StoryFeedbackItem[]>([])
  const [page, setPage] = useState(1)
  const [pagination, setPagination] = useState({ page: 1, limit: PAGE_SIZE, total: 0, pages: 1 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!authChecking && !isAdmin) router.push('/unauthorized')
  }, [authChecking, isAdmin, router])

  const query = (next: { lang?: string; reason?: string; sort?: string }) => {
    const params = new URLSearchParams()
    const l = next.lang ?? lang
    const r = next.reason ?? reason
    const s = next.sort ?? sort
    if (l) params.set('lang', l)
    if (r) params.set('reason', r)
    if (s !== 'wrong') params.set('sort', s)
    return params.toString()
  }
  const setFilter = (next: { lang?: string; reason?: string; sort?: string }) => {
    const qs = query(next)
    router.push(qs ? `${pathname}?${qs}` : pathname)
  }

  const fetchPage = async (target: number) => {
    try {
      setLoading(true)
      const params = new URLSearchParams({ page: String(target), limit: String(PAGE_SIZE), sort })
      if (lang) params.set('lang', lang)
      if (reason) params.set('reason', reason)
      const res = await fetch(`/api/admin/story-feedback?${params}`)
      const data = await res.json()
      if (!res.ok) {
        setRows([])
        // Before the migration the function does not exist: the screen is just empty.
        setError(data.code !== 'not_available')
        return
      }
      setError(false)
      setRows(data.stories || [])
      setPagination(data.pagination)
      setPage(target)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!isAuthorized) return
    fetchPage(1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthorized, lang, reason, sort])

  if (authChecking) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-tuggi-blue mx-auto" />
      </div>
    )
  }
  if (!isAuthorized) return null

  const clearFilters = () => router.push(sort === 'wrong' ? pathname : `${pathname}?sort=${sort}`)
  const qs = query({})
  const returnTo = `/${locale}/admin/story-feedback${qs ? `?${qs}` : ''}`

  return (
    <div className="cms-width min-h-screen bg-gray-50/50">
      <Container className="py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <ThumbsDown size={22} className="text-tuggi-orange" />
            {t('title')}
          </h1>
          <p className="text-sm text-gray-500">{t('subtitle')}</p>
        </div>

        <div className="mb-6 flex flex-wrap items-center gap-3 rounded-lg border border-gray-200 bg-white p-3">
          <select
            aria-label={t('headers.lang')}
            value={lang}
            onChange={(e) => setFilter({ lang: e.target.value })}
            className="rounded-md border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-tuggi-blue/40"
          >
            <option value="">{t('filters.langAll')}</option>
            {STORY_LANGUAGES.map((l) => (
              <option key={l} value={l}>
                {l.toUpperCase()}
              </option>
            ))}
          </select>
          <select
            aria-label={t('filters.reason')}
            value={reason}
            onChange={(e) => setFilter({ reason: e.target.value })}
            className="rounded-md border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-tuggi-blue/40"
          >
            <option value="">{t('filters.reasonAll')}</option>
            {STORY_REASON_FILTERS.map((r) => (
              <option key={r} value={r}>
                {t(`filters.${r}`)}
              </option>
            ))}
          </select>
          {filtered && (
            <button type="button" onClick={clearFilters} className="text-sm font-semibold text-tuggi-blue hover:underline">
              {t('clearFilters')}
            </button>
          )}
        </div>

        <StoryFeedbackView
          rows={rows}
          loading={loading}
          error={error}
          filtered={filtered}
          sort={sort}
          returnTo={returnTo}
          onSort={(s) => setFilter({ sort: s })}
          onClearFilters={clearFilters}
          onRetry={() => void fetchPage(page)}
        />

        {pagination.pages > 1 && (
          <div className="mt-4 flex items-center justify-between text-sm text-gray-600">
            <span>{t('pagination', { current: pagination.page, total: pagination.pages, count: pagination.total })}</span>
            <div className="flex gap-2">
              <button
                disabled={page <= 1 || loading}
                onClick={() => fetchPage(page - 1)}
                className="inline-flex items-center gap-1 rounded-md border border-gray-200 px-2 py-1 disabled:opacity-40"
              >
                <ChevronLeft size={14} /> {t('prev')}
              </button>
              <button
                disabled={page >= pagination.pages || loading}
                onClick={() => fetchPage(page + 1)}
                className="inline-flex items-center gap-1 rounded-md border border-gray-200 px-2 py-1 disabled:opacity-40"
              >
                {t('next')} <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}
      </Container>
    </div>
  )
}

export function AdminStoryFeedbackPageContent() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-screen">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-tuggi-blue mx-auto" />
        </div>
      }
    >
      <AdminStoryFeedbackContent />
    </Suspense>
  )
}
