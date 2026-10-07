/**
 * The trail's publication lines — one per place that is in the app, named, because a client with
 * N places would otherwise read N identical rows.
 *
 * A PLACE IN THE APP WITH NO PUBLICATION RECORD STILL GETS ITS LINE (#909). Places of older
 * partners were published before `PUBLISH_PARTNER_PLACE` existed in `core.audit_logs`, so
 * `publishedBy` is null while `readiness.published` is true. Dropping them made the place vanish
 * from the trail while band 5 said `Está no app.` The line says the fact and nothing else: no
 * date and no person, and no other date stands in for the missing one (the link to the client is
 * not the publication).
 *
 * Dated lines come first, in the order of the places; the undated ones follow.
 *
 * `t` is the `Partnerships` translator, handed in so this stays a pure module the tests import.
 */

import type { useTranslations } from 'next-intl'
import { formatDate } from '@/components/admin/partner-proposals/format'
import type { PartnershipPlace } from '@/lib/services/partnership-service'

type Translator = ReturnType<typeof useTranslations>
type TrailPlace = Pick<PartnershipPlace, 'publishedBy'> & {
  readiness: Pick<PartnershipPlace['readiness'], 'published'> & {
    place: Pick<PartnershipPlace['readiness']['place'], 'name'>
  }
}

export function trailPublishedLines(places: readonly TrailPlace[], t: Translator): string[] {
  const dated: string[] = []
  const undated: string[] = []
  for (const place of places) {
    const name = place.readiness.place.name
    if (place.publishedBy) {
      dated.push(
        place.publishedBy.by
          ? t('publish.trailPublished', {
              name,
              date: formatDate(place.publishedBy.at),
              person: place.publishedBy.by,
            })
          : t('publish.trailPublishedAnonymous', { name, date: formatDate(place.publishedBy.at) })
      )
    } else if (place.readiness.published) {
      undated.push(t('publish.trailPublishedUndated', { name }))
    }
  }
  return [...dated, ...undated]
}
