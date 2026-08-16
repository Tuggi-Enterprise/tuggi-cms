'use client'

/**
 * What is missing for one place, grouped by the outcome it blocks — DS-COMPONENTE-020.
 *
 * It computes NOTHING. `buildPlaceReadiness` decided, on the server, and the queue counts from
 * the same answer: a badge in the list and a band in the detail that disagree cost more than
 * the absence of both (point 4 of the decision).
 *
 * Three blocks and never a flat list, because the middle one is the whole reason the screen
 * exists: a place with no trigger point APPEARS and is mute, and a single list of "3 pendências"
 * is exactly what hid that from 3 of the 6 clients measured in #356.
 *
 * Every line carries text; the icon repeats what the words say and is `aria-hidden`
 * (DS-A11Y-003). Nothing here is `max-height` + `overflow-hidden` — a block of text that
 * disappears with no error is a defect this team has already paid for.
 */

import { useTranslations } from 'next-intl'
import { AlertTriangle, Check, VolumeX, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  PENDENCY_CLASS,
  PENDENCY_CLASSES,
  type PendencyClass,
  type PendencyId,
  type PlaceReadiness,
} from '@/lib/partnerships/place-readiness'

interface PendencyListProps {
  readiness: PlaceReadiness
  /** `Abrir o local` — the place editor is a modal, so it comes back on its own. */
  onOpenPlace: () => void
  /** Where each of the other three go, already on the object (DS-LAYOUT-006, point 1). */
  toolHref: (pendency: PendencyId) => string
}

export function PendencyList({ readiness, onOpenPlace, toolHref }: PendencyListProps) {
  const t = useTranslations('Partnerships')

  if (readiness.ready) {
    return (
      <p className="flex items-start gap-2 text-sm">
        <Check className="mt-0.5 h-4 w-4 shrink-0 text-green-800" aria-hidden="true" />
        <span>
          <span className="font-semibold text-gray-900">{t('pendencies.readyTitle')} </span>
          <span className="text-gray-800">{t('pendencies.readyBody')}</span>
        </span>
      </p>
    )
  }

  return (
    <div className="space-y-4">
      {PENDENCY_CLASSES.map((klass) => {
        const items = readiness.pending.filter((id) => PENDENCY_CLASS[id] === klass)
        // Zero pendencies in a class is no block at all, never an empty heading.
        if (items.length === 0) return null

        return (
          <section key={klass} aria-label={t(`pendencies.classes.${klass}`)}>
            <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-900">
              <ClassIcon klass={klass} />
              {t(`pendencies.classes.${klass}`)}
            </h4>
            <ul className="mt-2 space-y-3">
              {items.map((id) => (
                <li key={id} className="rounded-md border border-gray-200 p-3">
                  <p className="text-sm font-semibold text-gray-900">
                    {t(`pendencies.items.${id}.title`)}
                  </p>
                  <p className="mt-1 text-sm text-gray-800">{t(`pendencies.items.${id}.body`)}</p>
                  <div className="mt-2">
                    {id === 'coordinate' || id === 'hidden_from_map' || id === 'inactive' ? (
                      <Button type="button" variant="outline" size="sm" onClick={onOpenPlace}>
                        {t(`pendencies.items.${id}.action`)}
                      </Button>
                    ) : (
                      // Same tab, deliberately: a second one hands the operator the job of
                      // reconciling two copies of the same state (DS-LAYOUT-006, point 4).
                      // A static guard in `tests/api/partnerships-pipeline.test.ts` reads
                      // this file, so the opposite cannot be written back in by accident.
                      <a
                        href={toolHref(id)}
                        className="inline-flex min-h-[24px] items-center text-sm font-medium text-primary-800 underline underline-offset-4"
                      >
                        {t(`pendencies.items.${id}.action`)}
                      </a>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )
      })}
    </div>
  )
}

/** Decorative in every case: the class name is written next to it. */
function ClassIcon({ klass }: { klass: PendencyClass }) {
  if (klass === 'blocks_app')
    return <X className="h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
  if (klass === 'silences_app')
    return <VolumeX className="h-4 w-4 shrink-0 text-secondary-700" aria-hidden="true" />
  return <AlertTriangle className="h-4 w-4 shrink-0 text-primary-800" aria-hidden="true" />
}
