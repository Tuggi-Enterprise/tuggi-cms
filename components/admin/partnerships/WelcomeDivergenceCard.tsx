'use client'

/**
 * THE PARTNER THAT HAS A POI AND WHOSE SCREEN SAYS IT HAS NONE.
 *
 * `partner.clients.welcome_poi_id` and `core.attractions.partner_client_id` were two independent
 * ways of saying "this partner's POI", and nothing forced them to agree. Measured on 2026-08-23:
 * of the 10 clients carrying a welcome POI, 10 pointed at a POI that was NOT the client's place.
 *
 *   Garota Beer   welcome → `Garota Beer` (publicado, com pin)   partner_client_id → nada
 *
 * Band 4 then reads `Este cliente ainda não tem local vinculado` over a partner that has one on
 * air, and the operator's next move is `Criar um local novo` — which is how the duplicate is
 * born. This card is the honest answer to that state: it names the POI the client already points
 * at and offers the one act that ends the divergence.
 *
 * IT IS NOT A SECOND SOURCE OF THE LINK. It writes nothing itself: it posts to
 * `../places/link`, the same route the search uses, so the same gate applies —`verdictFor`
 * refuses an `event`, a POI with no coordinate and somebody else's place, and the route adopts
 * the welcome POI in the same act. After it succeeds the two pointers are one, and this card
 * has nothing left to say.
 *
 * IT IS A BACKLOG, NOT A STATE. Nobody can create this divergence any more — linking adopts the
 * welcome POI, and the welcome POI is chosen among the client's places. When the last of the
 * clients is consolidated, this component stops rendering; it goes when the last one goes.
 */

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { placeToolHref } from '@/lib/partnerships/place-tool'
import type { WelcomeDivergence } from '@/lib/services/partnership-service'

export function WelcomeDivergenceCard({
  clientId,
  locale,
  divergence,
  onLinked,
}: {
  clientId: string
  /**
   * The operator's locale, HANDED DOWN and never read here.
   *
   * This card renders inside a subtree whose provider is pinned to `locale="pt"` — the pipeline
   * vocabulary is Portuguese by decision — so `useLocale()` in this file would answer `pt` for
   * everybody and send an operator working in `en` across a locale switch nobody asked for. The
   * callers read it outside that provider, which is where the answer is true.
   */
  locale: string
  divergence: WelcomeDivergence
  onLinked: () => Promise<void>
}) {
  const t = useTranslations('Partnerships.welcomeDivergence')
  const [linking, setLinking] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)

  async function link() {
    setLinking(true)
    setRefusal(null)
    try {
      const response = await fetch(`/api/admin/partnerships/clients/${clientId}/places/link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attractionId: divergence.attractionId }),
      })
      if (!response.ok) {
        // The route answers WITH the reason, and the reason is what the operator acts on: an
        // `event` is not fixed by clicking again, a missing pin is fixed in the POI editor.
        const payload = (await response.json().catch(() => null)) as { error?: string } | null
        setRefusal(payload?.error ?? 'link_failed')
      }
    } catch {
      setRefusal('link_failed')
    }
    await onLinked()
    setLinking(false)
  }

  const where = [divergence.city, divergence.country].filter(Boolean).join(', ')

  return (
    <div className="rounded-md border border-amber-300 bg-amber-50/60 p-4 dark:border-amber-700 dark:bg-amber-950/30">
      <p className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
        <AlertTriangle className="h-4 w-4 text-amber-600" aria-hidden="true" />
        {t('title')}
      </p>
      <p className="mt-1 text-sm text-gray-800 dark:text-gray-300">{t('body')}</p>

      <p className="mt-3 break-words text-sm font-medium text-gray-900 dark:text-white">
        {divergence.name}
        {where && <span className="font-normal text-gray-700 dark:text-gray-400"> · {where}</span>}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" disabled={linking} onClick={() => void link()}>
          {linking ? t('linking') : t('action')}
        </Button>
        <a
          /* Same rule as everywhere else: the kind decides the editor. This one also carried no
             locale, so an operator on `/en/` was sent to `/pois/...` unprefixed. */
          href={placeToolHref({
            locale,
            attractionId: divergence.attractionId,
            entityKind: divergence.entityKind,
          })}
          className="inline-flex min-h-[24px] items-center text-sm font-medium text-primary-800 underline underline-offset-4"
        >
          {t('open')}
        </a>
      </div>

      {refusal && (
        <p role="alert" className="mt-3 text-sm text-gray-900 dark:text-white">
          {t(`refused.${refusal}`)}
        </p>
      )}
    </div>
  )
}
