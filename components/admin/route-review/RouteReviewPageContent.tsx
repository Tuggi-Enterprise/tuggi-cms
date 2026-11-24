'use client'

/**
 * /admin/route-review (#1106, epic #1102): the approval queue of user route versions.
 *
 * BR-ROTA-006 item 3: every version is approved by a person, and the curator sees everything the
 * reader will get: name, description, the line with the uncovered stretches (BR-ROTA-008 item 7),
 * each annotation with text and photos, the Tuggi stories in the sequence and, on an edit, the
 * difference from the version on the air. Approving goes through `core.approve_route_revision`
 * only; refusing needs the reason the author reads. The photo filter only signals.
 *
 * Content follows `docs/design/spec-diario-de-bordo-2026-11.md` §9; the shell, table and states
 * follow `AdminStoryFeedbackPageContent`.
 */

import { useCallback, useEffect, useState } from 'react'
import { AlertCircle, CheckCircle, Inbox } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Container } from '@/components/ui/Container'
import { Button } from '@/components/ui/button'
import { formatDate } from '@/lib/contract/snapshot'
import { appUserLabel } from '@/lib/format/user-identity'
import { canPromote, type QueueItem } from '@/lib/routes/route-revisions'
import type { RevisionDetail } from '@/lib/services/route-revision-service'
import { RejectForm } from './RejectForm'
import { PromoteForm, type PromoteValues } from './PromoteForm'
import { RevisionMap } from './RevisionMap'

export interface PhotoVerdict {
  key: string
  status: 'clean' | 'flagged' | 'unchecked'
  categories: string[]
}

export type PhotoCheck = { state: 'loading' } | { state: 'failed' } | { state: 'done'; byKey: Record<string, PhotoVerdict> }

export interface RevisionReviewProps {
  item: QueueItem
  detail: RevisionDetail
  photoCheck: PhotoCheck
  busy: boolean
  notice: string | null
  onApprove: () => void
  onReject: (reason: string) => void
  onPromote: (annotationId: string, values: PromoteValues) => void
}

const CHANGE_CLASS: Record<string, string> = {
  added: 'bg-green-100 text-green-800',
  removed: 'bg-red-100 text-red-800',
  edited: 'bg-amber-100 text-amber-900',
  moved: 'bg-blue-100 text-blue-800',
  same: 'bg-gray-100 text-gray-700',
}

function PhotoBadge({ verdict, check }: { verdict?: PhotoVerdict; check: PhotoCheck }) {
  const t = useTranslations('Pages.RouteReview')
  if (check.state === 'loading') return <span className="text-[10px] text-gray-500">{t('photo_checking')}</span>
  if (check.state === 'failed' || !verdict || verdict.status === 'unchecked') {
    return <span className="text-[10px] text-gray-600">{t('photo_unchecked')}</span>
  }
  if (verdict.status === 'flagged') {
    return (
      <span className="rounded bg-red-100 px-1 text-[10px] font-bold text-red-800">
        {t('photo_flagged', { categories: verdict.categories.join(', ') || '?' })}
      </span>
    )
  }
  return <span className="text-[10px] text-green-800">{t('photo_clean')}</span>
}

/** One version under review, without fetching: what the curator reads and the two decisions. */
export function RevisionReview({ item, detail, photoCheck, busy, notice, onApprove, onReject, onPromote }: RevisionReviewProps) {
  const t = useTranslations('Pages.RouteReview')
  const [promoting, setPromoting] = useState<string | null>(null)
  const { revision, diff } = detail
  const changeOf = new Map(diff.stops.map((s) => [`${s.kind}:${s.ref}`, s.change]))
  const removed = diff.stops.filter((s) => s.change === 'removed')

  return (
    <div className="space-y-5">
      <header>
        <h2 className="text-lg font-bold text-gray-900">{revision.name}</h2>
        <p className="text-xs text-gray-600">
          {appUserLabel({ nickname: item.author_nickname, user_id: item.author_user_id })} ·{' '}
          {item.live_revision_no ? t('edit_of', { no: item.live_revision_no }) : t('first_submission')} ·{' '}
          {t('version', { no: revision.revision_no })} · {formatDate(revision.submitted_at)}
        </p>
        {revision.description ? (
          <p className="mt-2 whitespace-pre-line text-sm text-gray-800">{revision.description}</p>
        ) : (
          <p className="mt-2 text-sm italic text-gray-500">{t('no_description')}</p>
        )}
        {(revision.filter_flag_reason || item.report_count > 0) && (
          <p className="mt-2 flex flex-wrap gap-2 text-xs">
            {revision.filter_flag_reason && (
              <span className="rounded bg-red-100 px-2 py-0.5 font-bold text-red-800">{t('signal_text', { category: revision.filter_flag_reason })}</span>
            )}
            {item.report_count > 0 && <span className="rounded bg-amber-100 px-2 py-0.5 font-bold text-amber-900">{t('reports', { count: item.report_count })}</span>}
          </p>
        )}
        <p className="mt-1 text-xs text-gray-500">{t('filter_note')}</p>
      </header>

      <section aria-labelledby="rr-map">
        <h3 id="rr-map" className="mb-2 text-xs font-bold uppercase tracking-wider text-gray-500">{t('map_title')}</h3>
        <RevisionMap line={detail.line} segments={revision.uncovered_segments} stops={revision.stops} />
      </section>

      <section aria-labelledby="rr-diff">
        <h3 id="rr-diff" className="mb-2 text-xs font-bold uppercase tracking-wider text-gray-500">{t('diff_title')}</h3>
        {diff.first ? (
          <p className="text-sm text-gray-600">{t('diff_first')}</p>
        ) : (
          <div className="space-y-2">
            {diff.fields.length === 0 && <p className="text-sm text-gray-600">{t('diff_none')}</p>}
            {diff.fields.length > 0 && (
              <table className="w-full table-fixed text-sm">
                <thead className="text-left text-xs text-gray-500">
                  <tr><th className="w-28 py-1">{t('field')}</th><th className="py-1">{t('before')}</th><th className="py-1">{t('after')}</th></tr>
                </thead>
                <tbody className="divide-y divide-gray-100 align-top">
                  {diff.fields.map((f) => (
                    <tr key={f.field}>
                      <td className="py-1 font-semibold text-gray-700">{t(`fields.${f.field}`)}</td>
                      <td className="whitespace-pre-line py-1 text-red-800 line-through decoration-red-300">{f.before ?? t('empty_value')}</td>
                      <td className="whitespace-pre-line py-1 text-green-900">{f.after ?? t('empty_value')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {diff.lineChanged && <p className="text-sm font-semibold text-amber-900">{t('line_changed')}</p>}
          </div>
        )}
      </section>

      <section aria-labelledby="rr-stops">
        <h3 id="rr-stops" className="mb-2 text-xs font-bold uppercase tracking-wider text-gray-500">{t('stops_title')}</h3>
        <ol className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
          {revision.stops.map((s, i) => {
            const change = changeOf.get(`${s.kind}:${s.ref}`) ?? 'same'
            const promotedId = detail.promoted[s.ref]
            return (
              <li key={`${s.kind}:${s.ref}`} className="p-3">
                <div className="flex items-start gap-2">
                  <span className="w-6 shrink-0 text-right text-xs font-bold tabular-nums text-gray-500">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">{s.kind === 'annotation' ? t('annotation') : t('story')}</span>
                      <span className="font-semibold text-gray-900">{s.title ?? t('no_text')}</span>
                      {!diff.first && change !== 'same' && <span className={`rounded px-1.5 text-[10px] font-bold ${CHANGE_CLASS[change]}`}>{t(`changes.${change}`)}</span>}
                    </p>
                    {s.description && <p className="mt-1 whitespace-pre-line text-sm text-gray-700">{s.description}</p>}
                    {s.photo_keys.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {s.photo_keys.map((key, n) => (
                          <figure key={key} className="w-28">
                            {detail.photoUrls[key] ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={detail.photoUrls[key]} alt={t('photo_alt', { stop: i + 1, n: n + 1 })} className="h-28 w-28 rounded object-cover" />
                            ) : (
                              <div className="flex h-28 w-28 items-center justify-center rounded bg-gray-100 text-[10px] text-gray-500">{t('photo_unavailable')}</div>
                            )}
                            <figcaption><PhotoBadge verdict={photoCheck.state === 'done' ? photoCheck.byKey[key] : undefined} check={photoCheck} /></figcaption>
                          </figure>
                        ))}
                      </div>
                    )}
                    {s.kind === 'annotation' && (
                      <div className="mt-2">
                        {promotedId ? (
                          <span className="text-xs font-semibold text-green-800">{t('promote.already')}</span>
                        ) : !canPromote(s) ? (
                          <span className="text-xs text-gray-500">{t('promote.cannot')}</span>
                        ) : promoting === s.ref ? (
                          <PromoteForm
                            stop={s}
                            nearby={detail.nearby[s.ref] ?? []}
                            photoUrls={detail.photoUrls}
                            busy={busy}
                            onCancel={() => setPromoting(null)}
                            onSubmit={(values) => onPromote(s.ref, values)}
                          />
                        ) : (
                          <Button type="button" variant="outline" size="sm" onClick={() => setPromoting(s.ref)} disabled={busy}>
                            {t('promote.open')}
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </li>
            )
          })}
          {removed.map((s) => (
            <li key={`removed:${s.kind}:${s.ref}`} className="flex gap-2 p-3 text-sm text-gray-500">
              <span className="w-6" />
              <span className={`rounded px-1.5 text-[10px] font-bold ${CHANGE_CLASS.removed}`}>{t('changes.removed')}</span>
              <span className="line-through">{s.title ?? t('no_text')}</span>
            </li>
          ))}
        </ol>
      </section>

      {notice && (
        <p role="status" className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-800">{notice}</p>
      )}

      <section aria-labelledby="rr-decision" className="grid gap-4 border-t border-gray-200 pt-4 lg:grid-cols-2">
        <h3 id="rr-decision" className="sr-only">{t('decision')}</h3>
        <div>
          <Button type="button" variant="cta" onClick={onApprove} disabled={busy}>
            <CheckCircle size={16} className="mr-1" /> {busy ? t('approving') : t('approve')}
          </Button>
        </div>
        <RejectForm busy={busy} onReject={onReject} />
      </section>
    </div>
  )
}

type ErrorKey = 'already_decided' | 'route_removed' | 'revision_not_found' | 'not_available' | 'reason_required' | 'reason_too_long' | 'generic'
const KNOWN_ERRORS: ErrorKey[] = ['already_decided', 'route_removed', 'revision_not_found', 'not_available', 'reason_required', 'reason_too_long']
const errorKey = (code: unknown): ErrorKey => (KNOWN_ERRORS as unknown[]).includes(code) ? (code as ErrorKey) : 'generic'

export function RouteReviewPageContent() {
  const t = useTranslations('Pages.RouteReview')
  const [items, setItems] = useState<QueueItem[]>([])
  const [loading, setLoading] = useState(true)
  const [listError, setListError] = useState<ErrorKey | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [detail, setDetail] = useState<RevisionDetail | null>(null)
  const [detailError, setDetailError] = useState<ErrorKey | null>(null)
  const [photoCheck, setPhotoCheck] = useState<PhotoCheck>({ state: 'loading' })
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const loadQueue = useCallback(async () => {
    setLoading(true)
    setListError(null)
    try {
      const res = await fetch('/api/route-revisions')
      const body = await res.json().catch(() => ({}))
      if (!res.ok) setListError(errorKey(body.error))
      else setItems(body.items ?? [])
    } catch {
      setListError('generic')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void loadQueue() }, [loadQueue])

  const open = useCallback(async (revisionId: string) => {
    setSelected(revisionId)
    setDetail(null)
    setDetailError(null)
    setNotice(null)
    setPhotoCheck({ state: 'loading' })
    const res = await fetch(`/api/route-revisions/${revisionId}`).catch(() => null)
    const body = res ? await res.json().catch(() => ({})) : {}
    if (!res?.ok) {
      setDetailError(errorKey(body.error))
      return
    }
    setDetail(body as RevisionDetail)
    const check = await fetch(`/api/route-revisions/${revisionId}/photo-check`, { method: 'POST' }).catch(() => null)
    const verdicts = check?.ok ? await check.json().catch(() => null) : null
    if (!verdicts?.photos) setPhotoCheck({ state: 'failed' })
    else setPhotoCheck({ state: 'done', byKey: Object.fromEntries((verdicts.photos as PhotoVerdict[]).map((p) => [p.key, p])) })
  }, [])

  const decide = async (path: 'approve' | 'reject', body?: unknown) => {
    if (!selected) return
    setBusy(true)
    setNotice(null)
    try {
      const res = await fetch(`/api/route-revisions/${selected}/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      })
      const out = await res.json().catch(() => ({}))
      if (!res.ok) {
        setNotice(t(`errors.${errorKey(out.error)}`))
        return
      }
      if (path === 'reject') setNotice(t('rejected'))
      else if (out.translation === 'failed') setNotice(t('approved_translation_failed', { status: out.translation_status ?? 0 }))
      else setNotice(t('approved'))
      setItems((prev) => prev.filter((i) => i.revision_id !== selected))
      setSelected(null)
      setDetail(null)
    } finally {
      setBusy(false)
    }
  }

  const promote = async (annotationId: string, values: PromoteValues) => {
    if (!selected) return
    setBusy(true)
    setNotice(null)
    try {
      const res = await fetch(`/api/route-revisions/${selected}/promote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ annotationId, ...values, state: values.state || null }),
      })
      const out = await res.json().catch(() => ({}))
      if (!res.ok) {
        setNotice(t(`errors.${errorKey(out.error)}`))
        return
      }
      setNotice(out.photo === 'failed' ? t('promote.done_photo_failed') : t('promote.done'))
      setDetail((d) => (d ? { ...d, promoted: { ...d.promoted, [annotationId]: out.attraction_id } } : d))
    } finally {
      setBusy(false)
    }
  }

  const item = items.find((i) => i.revision_id === selected) ?? null

  return (
    <div className="py-6">
      <Container fullWidth>
        <div className="mb-4">
          <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900">
            <Inbox size={22} className="text-tuggi-orange" /> {t('title')}
          </h1>
          <p className="text-sm text-gray-500">{t('subtitle')}</p>
        </div>

        {notice && !selected && (
          <p role="status" className="mb-4 rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800">{notice}</p>
        )}

        <div className="grid gap-6 lg:grid-cols-[minmax(320px,2fr)_3fr]">
          <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50 text-xs uppercase tracking-wider text-gray-500">
                <tr>
                  <th className="px-3 py-2 text-left">{t('headers.route')}</th>
                  <th className="px-3 py-2 text-left">{t('headers.author')}</th>
                  <th className="px-3 py-2 text-left">{t('headers.version')}</th>
                  <th className="px-3 py-2 text-right">{t('headers.submitted')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {loading ? (
                  <tr><td colSpan={4} className="px-3 py-8 text-center text-gray-500">{t('loading')}</td></tr>
                ) : listError ? (
                  <tr>
                    <td colSpan={4} className="px-3 py-8 text-center">
                      <span role="alert" className="inline-flex items-center gap-2 text-red-700"><AlertCircle size={16} /> {t(`errors.${listError}`)}</span>
                      <button type="button" onClick={() => void loadQueue()} className="ml-2 font-semibold text-tuggi-blue hover:underline">{t('retry')}</button>
                    </td>
                  </tr>
                ) : items.length === 0 ? (
                  <tr><td colSpan={4} className="px-3 py-8 text-center text-gray-500">{t('empty')}</td></tr>
                ) : (
                  items.map((i) => (
                    <tr
                      key={i.revision_id}
                      onClick={() => void open(i.revision_id)}
                      aria-selected={selected === i.revision_id}
                      className={`cursor-pointer hover:bg-gray-50 ${selected === i.revision_id ? 'bg-blue-50' : ''}`}
                    >
                      <td className="px-3 py-2">
                        <button type="button" className="text-left font-semibold text-gray-900 hover:text-tuggi-blue" onClick={(e) => { e.stopPropagation(); void open(i.revision_id) }}>
                          {i.name}
                        </button>
                        {(i.filter_flag_reason || i.report_count > 0) && (
                          <span className="ml-2 rounded bg-red-100 px-1 text-[10px] font-bold text-red-800">{t('has_signal')}</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-gray-700">{appUserLabel({ nickname: i.author_nickname, user_id: i.author_user_id })}</td>
                      <td className="px-3 py-2 text-gray-700">{i.live_revision_no ? t('edit_of', { no: i.live_revision_no }) : t('first_submission')}</td>
                      <td className="px-3 py-2 text-right text-xs text-gray-500">{formatDate(i.submitted_at)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="rounded-lg border border-gray-200 bg-white p-4">
            {!selected ? (
              <p className="text-sm text-gray-500">{t('select_hint')}</p>
            ) : detailError ? (
              <p role="alert" className="text-sm text-red-700">{t(`errors.${detailError}`)}</p>
            ) : !detail || !item ? (
              <p className="text-sm text-gray-500">{t('loading')}</p>
            ) : (
              <RevisionReview
                item={item}
                detail={detail}
                photoCheck={photoCheck}
                busy={busy}
                notice={notice}
                onApprove={() => void decide('approve')}
                onReject={(reason) => void decide('reject', { reason })}
                onPromote={(id, values) => void promote(id, values)}
              />
            )}
          </div>
        </div>
      </Container>
    </div>
  )
}
