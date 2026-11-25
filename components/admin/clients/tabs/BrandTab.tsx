'use client'

/**
 * Marca tab of the client record (#1257, BR-B2B-070 items 2 and 9): the logo on the air, the one
 * waiting for a decision (the same card as the queue of /admin/partner-brand), the last refusal, the
 * place suggestions of this partner (#1261, BR-B2B-073 item 3.b, the same queue), the route partner
 * whose routes are this partner's (#1261, item 6), and the pilot. Without a pilot the partner does not have the product; extending it is
 * changing the end date here.
 *
 * Dates go out as ISO with the browser's offset, as in the campaign form: a curator in Brazil who
 * types 23:59 means 23:59 in Brazil.
 */

import { useCallback, useEffect, useState } from 'react'
import { BadgeCheck } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { parsePilot, type ClientBrand } from '@/lib/partner-brand/brand'
import { fromLocalInput, toLocalInput } from '@/lib/format/datetime-local'
import { Logo, PendingLogoCard } from '@/components/admin/partner-brand/PendingLogoCard'
import { usePartnerBrandErrorText } from '@/components/admin/partner-brand/usePartnerBrandErrorText'
import { PlaceSuggestionQueue } from '@/components/admin/partner-brand/PlaceSuggestionQueue'
import { RoutePartnerLink } from '@/components/admin/partner-brand/RoutePartnerLink'
import type { ClientEditorTabProps } from './ProfileTab'

const INPUT =
  'rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-tuggi-blue/40'

export function BrandTab({ clientId }: ClientEditorTabProps) {
  const t = useTranslations('PartnerBrand')
  const errorText = usePartnerBrandErrorText()
  const [brand, setBrand] = useState<ClientBrand | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [starts, setStarts] = useState('')
  const [ends, setEnds] = useState('')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  const load = useCallback(async () => {
    if (!clientId) return
    try {
      const res = await fetch(`/api/admin/clients/${clientId}/brand`)
      const data = await res.json()
      if (!res.ok) return setError(errorText(data.error))
      const next = data.brand as ClientBrand
      setBrand(next)
      setStarts(toLocalInput(next.pilot_starts_at))
      setEnds(toLocalInput(next.pilot_ends_at))
      setError(null)
    } catch {
      setError(errorText({ code: 'read_failed' }))
    }
  }, [clientId, errorText])

  useEffect(() => {
    void load()
  }, [load])

  const savePilot = async () => {
    const body = { pilot_starts_at: fromLocalInput(starts), pilot_ends_at: fromLocalInput(ends) }
    const parsed = parsePilot(body)
    if (!parsed.ok) return setMessage({ ok: false, text: errorText(parsed.error) })
    setSaving(true)
    setMessage(null)
    try {
      const res = await fetch(`/api/admin/clients/${clientId}/brand`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) return setMessage({ ok: false, text: errorText(data.error) })
      setMessage({ ok: true, text: parsed.value.pilot_starts_at ? t('pilot.saved') : t('pilot.cleared') })
      void load()
    } catch {
      setMessage({ ok: false, text: errorText({ code: 'write_failed' }) })
    } finally {
      setSaving(false)
    }
  }

  if (!clientId) return null

  const pending = brand?.logo_status === 'pending' && brand.logo_path ? brand : null

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <h2 className="flex items-center gap-2 text-lg font-bold text-gray-900">
        <BadgeCheck size={20} className="text-tuggi-orange" />
        {t('tab.title')}
      </h2>
      {error && (
        <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
      {brand === null && !error ? <p className="text-sm text-gray-500">{t('loading')}</p> : null}

      {brand && (
        <>
          <section aria-labelledby="brand-logo" className="space-y-3">
            <h3 id="brand-logo" className="text-sm font-bold uppercase tracking-wider text-gray-700">
              {t('tab.logo')}
            </h3>
            {pending ? (
              <ul className="m-0 p-0">
                <PendingLogoCard
                  clientId={brand.client_id}
                  logoPath={pending.logo_path as string}
                  logoUrl={pending.logo_url}
                  approvedLogoUrl={brand.approved_logo_url}
                  submittedAt={brand.logo_submitted_at}
                  onDecided={() => void load()}
                />
              </ul>
            ) : (
              <div className="flex flex-wrap items-start gap-4 rounded-lg border border-gray-200 bg-white p-4">
                <Logo src={brand.approved_logo_url} alt={t('logo.live')} empty={t('logo.noneLive')} />
                <div className="space-y-1 text-sm text-gray-700">
                  <p>{brand.approved_logo_path ? t('tab.approved') : t('tab.noLogo')}</p>
                  {brand.logo_status === 'rejected' && brand.logo_rejection_reason ? (
                    <p className="text-xs text-gray-600">{t('tab.lastRefusal', { reason: brand.logo_rejection_reason })}</p>
                  ) : null}
                </div>
              </div>
            )}
          </section>

          <section aria-labelledby="brand-suggestions" className="space-y-3">
            <h3 id="brand-suggestions" className="text-sm font-bold uppercase tracking-wider text-gray-700">
              {t('suggestions.queueTitle')}
            </h3>
            <PlaceSuggestionQueue clientId={brand.client_id} />
          </section>

          <section aria-labelledby="brand-routes" className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
            <h3 id="brand-routes" className="text-sm font-bold uppercase tracking-wider text-gray-700">
              {t('routePartner.title')}
            </h3>
            <RoutePartnerLink clientId={brand.client_id} />
          </section>

          <section aria-labelledby="brand-pilot" className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
            <h3 id="brand-pilot" className="text-sm font-bold uppercase tracking-wider text-gray-700">
              {t('pilot.title')}
            </h3>
            <p className="text-sm text-gray-600">{brand.pilot_starts_at ? t('pilot.intro') : t('pilot.none')}</p>
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label htmlFor="pilot-starts" className="block text-xs font-semibold text-gray-700">
                  {t('pilot.starts')}
                </label>
                <input id="pilot-starts" type="datetime-local" value={starts} onChange={(e) => setStarts(e.target.value)} className={INPUT} />
              </div>
              <div>
                <label htmlFor="pilot-ends" className="block text-xs font-semibold text-gray-700">
                  {t('pilot.ends')}
                </label>
                <input id="pilot-ends" type="datetime-local" value={ends} onChange={(e) => setEnds(e.target.value)} className={INPUT} />
              </div>
              <button
                type="button"
                disabled={saving}
                onClick={() => void savePilot()}
                className="rounded-md bg-tuggi-blue px-3 py-1.5 text-sm font-semibold text-white hover:bg-tuggi-blue/90 disabled:opacity-50">
                {t('save')}
              </button>
            </div>
            <p className="text-xs text-gray-600">{t('pilot.hint')}</p>
            {message && (
              <p role={message.ok ? 'status' : 'alert'} className={`text-sm ${message.ok ? 'text-green-800' : 'text-red-700'}`}>
                {message.text}
              </p>
            )}
          </section>
        </>
      )}
    </div>
  )
}
