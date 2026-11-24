'use client'

/**
 * "Virar POI" for one annotation (#1106, BR-ROTA-009). The text starts as the author's and the
 * curator only corrects it (item 2); the POIs around the annotation are listed first, so a duplicate
 * is seen before it is created (item 1). The POI is born not approved and follows the usual review.
 */

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { NEARBY_POI_RADIUS_M, type NearbyPoi, type RevisionStop } from '@/lib/routes/route-revisions'

export interface PromoteValues {
  name: string
  description: string
  city: string
  country: string
  state: string
  photoKey: string | null
}

export interface PromoteFormProps {
  stop: RevisionStop
  nearby: NearbyPoi[]
  photoUrls: Record<string, string>
  busy: boolean
  onSubmit: (values: PromoteValues) => void
  onCancel: () => void
}

const inputClass =
  'block w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-tuggi-blue focus:outline-none focus:ring-2 focus:ring-tuggi-blue/40'

export function PromoteForm({ stop, nearby, photoUrls, busy, onSubmit, onCancel }: PromoteFormProps) {
  const t = useTranslations('Pages.RouteReview.promote')
  const [values, setValues] = useState<PromoteValues>({
    name: stop.title ?? '',
    description: stop.description ?? stop.title ?? '',
    city: nearby[0]?.city ?? '',
    country: nearby[0]?.country ?? '',
    state: '',
    photoKey: null,
  })
  const set = (patch: Partial<PromoteValues>) => setValues((v) => ({ ...v, ...patch }))
  const complete = [values.name, values.description, values.city, values.country].every((v) => v.trim())

  return (
    <form
      className="mt-2 space-y-3 rounded-md border border-gray-200 bg-gray-50 p-3"
      onSubmit={(e) => {
        e.preventDefault()
        if (complete) onSubmit(values)
      }}
    >
      <p className="text-xs text-gray-600">{t('hint')}</p>

      <div>
        <p className="text-xs font-semibold text-gray-700">{t('nearby_title', { radius: NEARBY_POI_RADIUS_M })}</p>
        {nearby.length === 0 ? (
          <p className="text-xs text-gray-500">{t('nearby_none', { radius: NEARBY_POI_RADIUS_M })}</p>
        ) : (
          <ul className="mt-1 divide-y divide-gray-100 rounded border border-gray-200 bg-white text-xs">
            {nearby.map((p) => (
              <li key={p.id} className="flex justify-between gap-2 px-2 py-1">
                <span className="font-medium text-gray-900">{p.name}</span>
                <span className="tabular-nums text-gray-500">{t('distance', { meters: p.distance_m })}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className="col-span-2 text-xs font-semibold text-gray-700">
          {t('name')}
          <input className={inputClass} value={values.name} onChange={(e) => set({ name: e.target.value })} required />
        </label>
        <label className="col-span-2 text-xs font-semibold text-gray-700">
          {t('description')}
          <textarea className={inputClass} rows={4} value={values.description} onChange={(e) => set({ description: e.target.value })} required />
        </label>
        <label className="text-xs font-semibold text-gray-700">
          {t('city')}
          <input className={inputClass} value={values.city} onChange={(e) => set({ city: e.target.value })} required />
        </label>
        <label className="text-xs font-semibold text-gray-700">
          {t('country')}
          <input className={inputClass} value={values.country} onChange={(e) => set({ country: e.target.value })} required />
        </label>
        <label className="text-xs font-semibold text-gray-700">
          {t('state')}
          <input className={inputClass} value={values.state} onChange={(e) => set({ state: e.target.value })} />
        </label>
      </div>

      {stop.photo_keys.length > 0 && (
        <fieldset>
          <legend className="text-xs font-semibold text-gray-700">{t('photo')}</legend>
          <div className="mt-1 flex flex-wrap gap-2">
            <label className="flex items-center gap-1 text-xs">
              <input type="radio" name={`photo-${stop.ref}`} checked={values.photoKey === null} onChange={() => set({ photoKey: null })} />
              {t('no_photo')}
            </label>
            {stop.photo_keys.map((key, i) => (
              <label key={key} className="flex items-center gap-1 text-xs">
                <input type="radio" name={`photo-${stop.ref}`} checked={values.photoKey === key} onChange={() => set({ photoKey: key })} />
                {photoUrls[key] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={photoUrls[key]} alt={t('photo_alt', { n: i + 1 })} className="h-12 w-12 rounded object-cover" />
                ) : (
                  t('photo_alt', { n: i + 1 })
                )}
              </label>
            ))}
          </div>
        </fieldset>
      )}

      <div className="flex gap-2">
        <Button type="submit" variant="cta" size="sm" disabled={busy || !complete}>
          {busy ? t('submitting') : t('submit')}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={onCancel} disabled={busy}>
          {t('cancel')}
        </Button>
      </div>
    </form>
  )
}
