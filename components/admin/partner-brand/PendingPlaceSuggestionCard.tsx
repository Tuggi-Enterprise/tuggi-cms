'use client'

/**
 * One place a partner suggested, waiting for the curator (#1261, BR-B2B-073 item 3.b;
 * `docs/design/spec-tuggi-do-parceiro-onda-2-2026-11.md` §2.1, image c01).
 *
 * Left, what the partner sent: the name, the note and the pin. Right, the POIs that already exist
 * around the pin, with the query and radius of "Virar POI" (`NEARBY_POI_RADIUS_M`), each with
 * "Ligar a este"; and the POI id, for one that exists far from the pin. Below, the other two
 * answers: create the POI (the `PromoteForm`, born not approved, usual review) or refuse with the
 * reason the partner reads (the `RejectForm`, up to 1,000 characters). Only one form shows at a
 * time; switching keeps what was typed (both stay mounted, one hidden).
 *
 * No surface promises a time to answer (item 3.d). `409 suggestion_not_pending` (TGB86): someone
 * answered or the partner cancelled meanwhile; the host reloads the queue.
 */

import { useState, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { MapPin } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PromoteForm, type PromoteValues } from '@/components/admin/route-review/PromoteForm'
import { RejectForm } from '@/components/admin/route-review/RejectForm'
import { isUuid, type PartnerBrandError } from '@/lib/partner-brand/brand'
import type { PlaceSuggestion } from '@/lib/partner-brand/suggestions'
import { NEARBY_POI_RADIUS_M } from '@/lib/routes/route-revisions'
import { usePartnerBrandErrorText } from './usePartnerBrandErrorText'

export type SuggestionOutcome = 'linked' | 'created' | 'refused' | 'stale'

interface PendingPlaceSuggestionCardProps {
  suggestion: PlaceSuggestion
  /** The partner name with the link to the record, in the queue; the record already says whose. */
  title?: ReactNode
  /** After an answer, or after the server said the suggestion is not pending any more. */
  onDone: (outcome: SuggestionOutcome, message: string) => void
}

type Body =
  | { decision: 'link'; attraction_id: string }
  | { decision: 'created'; poi: Omit<PromoteValues, 'photoKey'> }
  | { decision: 'refuse'; reason: string }

export function PendingPlaceSuggestionCard({ suggestion, title, onDone }: PendingPlaceSuggestionCardProps) {
  const t = useTranslations('PartnerBrand.suggestions')
  const errorText = usePartnerBrandErrorText()
  const [open, setOpen] = useState<'create' | 'refuse' | null>(null)
  const [poiId, setPoiId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const s = suggestion

  const answer = async (body: Body) => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/partner-brand/suggestions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ suggestion_id: s.id, ...body }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        const e = data.error as PartnerBrandError | undefined
        const text = [errorText(e), data.attraction_id ? t('createdNotLinked') : null].filter(Boolean).join(' ')
        if (e?.code === 'suggestion_not_pending') return onDone('stale', text)
        return setError(text)
      }
      const outcome = body.decision === 'link' ? 'linked' : body.decision === 'created' ? 'created' : 'refused'
      onDone(outcome, t(`done_${outcome}`))
    } catch {
      setError(errorText({ code: 'write_failed' }))
    } finally {
      setBusy(false)
    }
  }

  const toggle = (which: 'create' | 'refuse') => setOpen((current) => (current === which ? null : which))
  const mapHref = `https://www.google.com/maps/search/?api=1&query=${s.latitude},${s.longitude}`

  return (
    <li data-suggestion={s.id} className="list-none rounded-lg border border-gray-200 bg-white p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        {title ? <h3 className="text-base font-semibold text-gray-900">{title}</h3> : <span />}
        <span className="text-xs text-gray-500">{t('submittedAt', { date: new Date(s.created_at).toLocaleString() })}</span>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <section className="space-y-2">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-600">{t('sent')}</h4>
          <dl className="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-1 text-sm">
            <dt className="text-gray-600">{t('place')}</dt>
            <dd className="font-semibold text-gray-900">{s.name}</dd>
            <dt className="text-gray-600">{t('note')}</dt>
            <dd className="whitespace-pre-line text-gray-800">{s.note ?? <span className="text-gray-500">{t('noNote')}</span>}</dd>
            <dt className="text-gray-600">{t('pin')}</dt>
            <dd className="text-gray-800">
              <span className="tabular-nums">
                {s.latitude.toFixed(5)}, {s.longitude.toFixed(5)}
              </span>{' '}
              <a href={mapHref} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-tuggi-blue underline underline-offset-2">
                <MapPin size={12} aria-hidden /> {t('openMap')}
              </a>
            </dd>
          </dl>
          <p className="text-xs text-gray-500">{t('counts', { picks: s.picks_count, pending: s.pending_count })}</p>
        </section>

        <section className="space-y-2">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-600">{t('nearbyTitle', { radius: NEARBY_POI_RADIUS_M })}</h4>
          {s.nearby.length === 0 ? (
            <p className="rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-600">{t('nearbyNone', { radius: NEARBY_POI_RADIUS_M })}</p>
          ) : (
            <ul className="m-0 divide-y divide-gray-100 rounded-md border border-gray-200 p-0">
              {s.nearby.map((p) => (
                <li key={p.id} className="flex list-none items-center justify-between gap-3 px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-gray-900">{p.name}</p>
                    <p className="text-xs text-gray-600">
                      {[p.category, t('distance', { meters: p.distance_m }), p.approved ? null : t('notApproved')].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    aria-label={t('linkTo', { name: p.name })}
                    onClick={() => void answer({ decision: 'link', attraction_id: p.id })}>
                    {t('link')}
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              if (isUuid(poiId.trim())) void answer({ decision: 'link', attraction_id: poiId.trim() })
            }}>
            <label className="flex min-w-0 flex-1 flex-col text-xs font-semibold text-gray-700">
              {t('linkById')}
              <input
                value={poiId}
                onChange={(e) => setPoiId(e.target.value)}
                placeholder="00000000-0000-0000-0000-000000000000"
                className="mt-1 rounded-md border border-gray-300 px-2 py-1.5 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-tuggi-blue/40"
              />
            </label>
            <Button type="submit" variant="outline" size="sm" disabled={busy || !isUuid(poiId.trim())}>
              {t('linkByIdSubmit')}
            </Button>
            <p className="w-full text-xs text-gray-500">{t('linkByIdHint')}</p>
          </form>
        </section>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3">
        <Button type="button" variant={open === 'create' ? 'secondary' : 'outline'} size="sm" aria-expanded={open === 'create'} onClick={() => toggle('create')}>
          {t('create')}
        </Button>
        <Button type="button" variant={open === 'refuse' ? 'destructive' : 'outline'} size="sm" aria-expanded={open === 'refuse'} onClick={() => toggle('refuse')}>
          {t('refuse')}
        </Button>
        {error && (
          <span role="alert" className="text-sm text-red-700">
            {error}
          </span>
        )}
      </div>

      <div hidden={open !== 'create'}>
        <PromoteForm
          formId={`suggestion-${s.id}`}
          initial={{ name: s.name, description: s.note ?? s.name, city: s.nearby[0]?.city ?? '', country: s.nearby[0]?.country ?? '' }}
          hint={t('createHint')}
          busy={busy}
          onCancel={() => setOpen(null)}
          onSubmit={(values) =>
            void answer({
              decision: 'created',
              poi: { name: values.name, description: values.description, city: values.city, country: values.country, state: values.state },
            })
          }
        />
      </div>
      <div hidden={open !== 'refuse'} className="mt-2 rounded-md border border-gray-200 bg-gray-50 p-3">
        <RejectForm
          fieldId={`suggestion-reason-${s.id}`}
          busy={busy}
          labels={{ label: t('refuseLabel'), placeholder: t('refusePlaceholder'), submit: t('refuseSubmit'), reason_required: t('reasonRequired') }}
          onReject={(reason) => void answer({ decision: 'refuse', reason })}
        />
      </div>
    </li>
  )
}
