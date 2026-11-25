'use client'

/**
 * The queue of the partners' place suggestions (#1261, BR-B2B-073 item 3.b). Two doors to the same
 * queue, as the logos: /admin/partner-brand (every partner, under the logos) and the Marca tab of the
 * client record (`clientId`, that partner only). The host owns the heading; this owns loading,
 * empty, the cards and the sentence of each answer (`onNotice`, or its own `role="status"`).
 */

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { partnerBrandHref } from '@/lib/partner-brand/brand'
import type { PlaceSuggestion } from '@/lib/partner-brand/suggestions'
import { PendingPlaceSuggestionCard, type SuggestionOutcome } from './PendingPlaceSuggestionCard'
import { usePartnerBrandErrorText } from './usePartnerBrandErrorText'

export interface QueueNotice {
  ok: boolean
  text: string
}

interface PlaceSuggestionQueueProps {
  /** One partner only (the record); every partner when absent. */
  clientId?: string
  /** The page's status line; without it the queue shows its own. */
  onNotice?: (notice: QueueNotice) => void
}

const BOX = 'rounded-lg border border-gray-200 bg-white px-4 py-8 text-center text-sm text-gray-500'

export function PlaceSuggestionQueue({ clientId, onNotice }: PlaceSuggestionQueueProps) {
  const t = useTranslations('PartnerBrand')
  const errorText = usePartnerBrandErrorText()
  const [items, setItems] = useState<PlaceSuggestion[] | null>(null)
  const [readError, setReadError] = useState<string | null>(null)
  const [ownNotice, setOwnNotice] = useState<QueueNotice | null>(null)

  const load = useCallback(async () => {
    try {
      const query = clientId ? `?${new URLSearchParams({ client_id: clientId }).toString()}` : ''
      const res = await fetch(`/api/admin/partner-brand/suggestions${query}`)
      const data = await res.json().catch(() => ({}))
      if (!res.ok) return setReadError(errorText(data.error))
      setReadError(null)
      setItems(data.suggestions ?? [])
    } catch {
      setReadError(errorText({ code: 'read_failed' }))
    }
  }, [clientId, errorText])

  useEffect(() => {
    void load()
  }, [load])

  const done = (id: string) => (outcome: SuggestionOutcome, message: string) => {
    const notice = { ok: outcome !== 'stale', text: message }
    if (onNotice) onNotice(notice)
    else setOwnNotice(notice)
    if (outcome === 'stale') void load()
    else setItems((prev) => (prev ?? []).filter((s) => s.id !== id))
  }

  return (
    <div className="space-y-3">
      {!onNotice && ownNotice && (
        <p
          role={ownNotice.ok ? 'status' : 'alert'}
          className={`rounded-md border px-3 py-2 text-sm ${ownNotice.ok ? 'border-green-200 bg-green-50 text-green-800' : 'border-red-200 bg-red-50 text-red-700'}`}>
          {ownNotice.text}
        </p>
      )}
      {readError ? (
        <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {readError}
        </p>
      ) : items === null ? (
        <p className={BOX}>{t('loading')}</p>
      ) : items.length === 0 ? (
        <p className={BOX}>{t('suggestions.queueEmpty')}</p>
      ) : (
        <ul className="m-0 flex flex-col gap-4 p-0">
          {items.map((s) => (
            <PendingPlaceSuggestionCard
              key={s.id}
              suggestion={s}
              title={
                clientId ? undefined : (
                  <Link href={partnerBrandHref(s.client_id)} className="underline-offset-2 hover:underline">
                    {s.partner_name ?? (s.partner_handle ? `@${s.partner_handle}` : t('logo.noName'))}
                  </Link>
                )
              }
              onDone={done(s.id)}
            />
          ))}
        </ul>
      )}
    </div>
  )
}
