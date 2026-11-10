'use client'

/**
 * The drawer that creates and edits a campaign of the app (#1192). Same frame as `CouponFormDrawer`.
 *
 * The payload is checked by `parseCampaignInput` before it leaves, the same function the route runs,
 * so the operator reads the sentence without a round trip; the database CHECKs stay the judge.
 * Limits and hints are the copy guide's (`docs/design/copy/campanhas-no-app.md`, parte 2), and its
 * three examples are the placeholders. Dates go out as ISO with the browser's offset: an operator in
 * Brazil who types 23:59 means 23:59 in Brazil, not in UTC.
 */

import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, AlertTriangle, CheckCircle, ImagePlus, Loader2, Trash2, X } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { CharCount } from '@/components/ui/CharCount'
import {
  CAMPAIGN_DESTINATIONS,
  CAMPAIGN_FORMATS,
  CAMPAIGN_IMAGE_SPEC,
  CAMPAIGN_LANGUAGES,
  CAMPAIGN_TEXT_FIELDS,
  CAMPAIGN_TEXT_MAX,
  buildActionPath,
  destinationKey,
  parseActionPath,
  parseCampaignInput,
  type AppCampaign,
  type CampaignActionType,
  type CampaignDestination,
  type CampaignError,
  type CampaignFormat,
  type CampaignLanguage,
  type CampaignText,
  type CampaignTextField,
} from '@/lib/campaigns/app-campaigns'
import { formatCouponGrant } from '@/lib/coupons/grant'
import type { Coupon } from '@/types/coupons'
import { AppCampaignPreview } from './AppCampaignPreview'
import { useCampaignErrorText } from './useCampaignErrorText'

interface AppCampaignFormDrawerProps {
  campaign: AppCampaign | null
  onClose: () => void
  onSaved: () => void
}

interface FormState {
  internal_name: string
  format: CampaignFormat
  priority: string
  countries: string
  content: Record<CampaignLanguage, CampaignText>
  image_url: string | null
  action_type: CampaignActionType
  destination: CampaignDestination | ''
  destination_id: string
  /** A stored path none of the offered destinations matches: kept as is until the operator picks one. */
  other_path: string | null
  coupon_id: string
  starts_at: string
  ends_at: string
  is_active: boolean
}

const EMPTY_TEXT: CampaignText = { title: '', body: '', cta_label: '' }
const COUPON_LIST_LIMIT = 100
const SAVED_CLOSE_MS = 900
/** How far from the asked proportion an image may be before the warning shows. */
const RATIO_TOLERANCE = 0.02

function emptyContent(): Record<CampaignLanguage, CampaignText> {
  return Object.fromEntries(CAMPAIGN_LANGUAGES.map((l) => [l, { ...EMPTY_TEXT }])) as Record<CampaignLanguage, CampaignText>
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** ISO → the `datetime-local` value, in the browser's zone. */
function toLocalInput(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** The `datetime-local` value → ISO with the zone; `null` when empty. */
function fromLocalInput(value: string): string | null {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? value : d.toISOString()
}

function stateFromCampaign(c: AppCampaign | null): FormState {
  if (!c) {
    return {
      internal_name: '',
      format: 'map_carousel',
      priority: '0',
      countries: '',
      content: emptyContent(),
      image_url: null,
      action_type: 'open_path',
      destination: '/plans',
      destination_id: '',
      other_path: null,
      coupon_id: '',
      starts_at: '',
      ends_at: '',
      is_active: false,
    }
  }
  const content = emptyContent()
  for (const lang of CAMPAIGN_LANGUAGES) {
    const text = c.content?.[lang]
    if (text) content[lang] = { ...EMPTY_TEXT, ...text }
  }
  const parsed = parseActionPath(c.action_path)
  return {
    internal_name: c.internal_name,
    format: c.format,
    priority: String(c.priority),
    countries: c.countries.join(', '),
    content,
    image_url: c.image_url,
    action_type: c.action_type,
    destination: parsed?.destination ?? '',
    destination_id: parsed?.id ?? '',
    other_path: c.action_type === 'open_path' && !parsed ? c.action_path : null,
    coupon_id: c.coupon_id ?? '',
    starts_at: toLocalInput(c.starts_at),
    ends_at: toLocalInput(c.ends_at),
    is_active: c.is_active,
  }
}

function payloadFromState(f: FormState): Record<string, unknown> {
  let actionPath: string | null = null
  if (f.action_type === 'open_path') {
    actionPath = f.destination ? buildActionPath(f.destination, f.destination_id) : f.other_path
  }
  return {
    internal_name: f.internal_name,
    format: f.format,
    priority: f.priority.trim() === '' ? 0 : Number(f.priority),
    countries: f.countries
      .split(/[\s,;]+/)
      .map((c) => c.trim())
      .filter(Boolean),
    content: f.content,
    image_url: f.image_url,
    action_type: f.action_type,
    action_path: actionPath,
    coupon_id: f.action_type === 'redeem_coupon' ? f.coupon_id || null : null,
    starts_at: fromLocalInput(f.starts_at),
    ends_at: fromLocalInput(f.ends_at),
    is_active: f.is_active,
  }
}

/** Which of the guide's three examples fits what is being written. */
function exampleKey(f: FormState): 'plans' | 'gift' | 'caravan' {
  if (f.action_type === 'redeem_coupon') return 'gift'
  if (f.destination === '/stamps') return 'caravan'
  return 'plans'
}

const INPUT =
  'w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-semibold text-gray-900 focus:outline-none focus:ring-2 focus:ring-tuggi-blue/30'
const LABEL = 'block text-sm font-semibold text-gray-700 mb-1'
const HELP = 'mt-1 text-xs text-gray-500'

export function AppCampaignFormDrawer({ campaign, onClose, onSaved }: AppCampaignFormDrawerProps) {
  const t = useTranslations('AppCampaigns')
  const errorText = useCampaignErrorText()
  const isEditing = Boolean(campaign)
  const [form, setForm] = useState<FormState>(() => stateFromCampaign(campaign))
  const [language, setLanguage] = useState<CampaignLanguage>('pt')
  const [coupons, setCoupons] = useState<Coupon[] | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [imageSize, setImageSize] = useState<{ width: number; height: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  // The coupons of the gift select, refetched on every open: a coupon created a minute ago must show.
  useEffect(() => {
    const controller = new AbortController()
    ;(async () => {
      try {
        const res = await fetch(`/api/admin/coupons?limit=${COUPON_LIST_LIMIT}`, { signal: controller.signal })
        const data = await res.json()
        if (!controller.signal.aborted) setCoupons(res.ok && Array.isArray(data.coupons) ? data.coupons : [])
      } catch (err) {
        if ((err as Error)?.name !== 'AbortError') setCoupons([])
      }
    })()
    return () => controller.abort()
  }, [])

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((prev) => ({ ...prev, [key]: value }))
  const setText = (lang: CampaignLanguage, field: CampaignTextField, value: string) =>
    setForm((prev) => ({ ...prev, content: { ...prev.content, [lang]: { ...prev.content[lang], [field]: value } } }))

  const spec = CAMPAIGN_IMAGE_SPEC[form.format]
  const ratioOff =
    imageSize !== null && Math.abs(imageSize.width / imageSize.height - spec.width / spec.height) > RATIO_TOLERANCE
  const example = t.raw(`examples.${exampleKey(form)}`) as Record<'pt' | 'en', CampaignText>
  const placeholderFor = (lang: CampaignLanguage) => (lang === 'pt' ? example.pt : example.en)
  const selectedCoupon = coupons?.find((c) => c.id === form.coupon_id) ?? null

  const previewText = useMemo(() => {
    const own = form.content[language]
    if (own.title.trim() && own.cta_label.trim()) return own
    const en = form.content.en
    return en.title.trim() && en.cta_label.trim() ? en : null
  }, [form.content, language])

  const upload = async (file: File) => {
    setError(null)
    setUploading(true)
    try {
      const body = new FormData()
      body.append('file', file)
      const res = await fetch('/api/admin/app-campaigns/image', { method: 'POST', body })
      const data = await res.json()
      if (!res.ok) {
        setError(errorText(data.error as CampaignError | undefined))
        return
      }
      setImageSize(null)
      set('image_url', data.url as string)
    } catch {
      setError(t('errors.network'))
    } finally {
      setUploading(false)
    }
  }

  const submit = async () => {
    setError(null)
    setSuccess(null)
    const payload = payloadFromState(form)
    const parsed = parseCampaignInput(payload)
    if (!parsed.ok) {
      setError(errorText(parsed.error))
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch(isEditing && campaign ? `/api/admin/app-campaigns/${campaign.id}` : '/api/admin/app-campaigns', {
        method: isEditing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(errorText(data.error as CampaignError | undefined))
        // A coupon_sync_failed still wrote the campaign: the list must show it.
        if (data.campaign) onSaved()
        return
      }
      setSuccess(isEditing ? t('form.saved') : t('form.created'))
      onSaved()
      setTimeout(onClose, SAVED_CLOSE_MS)
    } catch {
      setError(t('errors.network'))
    } finally {
      setSubmitting(false)
    }
  }

  const busy = submitting || uploading

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="absolute inset-0 bg-black/40" onClick={() => !busy && onClose()} />
      <div role="dialog" aria-modal="true" aria-labelledby="app-campaign-drawer-title" className="relative ml-auto h-full w-full max-w-3xl overflow-y-auto bg-white shadow-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-200 bg-white px-6 py-4">
          <h2 id="app-campaign-drawer-title" className="text-base font-bold leading-tight text-gray-900">
            {isEditing ? t('form.editTitle', { name: campaign?.internal_name ?? '' }) : t('form.createTitle')}
          </h2>
          <button
            onClick={() => !busy && onClose()}
            aria-label={t('form.cancel')}
            className="rounded-xl p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-5 px-6 py-5">
          {error && (
            <div role="alert" className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              <AlertCircle size={16} className="shrink-0" /> {error}
            </div>
          )}
          {success && (
            <div className="flex items-center gap-2 rounded-xl border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
              <CheckCircle size={16} /> {success}
            </div>
          )}

          {/* Name, format, priority */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="md:col-span-2">
              <label htmlFor="campaign-name" className={LABEL}>
                {t('form.internalName')} <span className="text-red-500">*</span>
              </label>
              <input id="campaign-name" type="text" value={form.internal_name} onChange={(e) => set('internal_name', e.target.value)} className={INPUT} />
              <p className={HELP}>{t('form.internalNameHelp')}</p>
            </div>
            <div>
              <label htmlFor="campaign-priority" className={LABEL}>
                {t('form.priority')}
              </label>
              <input id="campaign-priority" type="number" step={1} value={form.priority} onChange={(e) => set('priority', e.target.value)} className={INPUT} />
              <p className={HELP}>{t('form.priorityHelp')}</p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label htmlFor="campaign-format" className={LABEL}>
                {t('form.format')}
              </label>
              <select id="campaign-format" value={form.format} onChange={(e) => set('format', e.target.value as CampaignFormat)} className={INPUT}>
                {CAMPAIGN_FORMATS.map((f) => (
                  <option key={f} value={f}>
                    {t(`formats.${f}`)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="campaign-countries" className={LABEL}>
                {t('form.countries')}
              </label>
              <input
                id="campaign-countries"
                type="text"
                value={form.countries}
                onChange={(e) => set('countries', e.target.value.toUpperCase())}
                placeholder={t('form.countriesPlaceholder')}
                className={`${INPUT} uppercase tracking-wider`}
              />
              <p className={HELP}>{t('form.countriesHelp')}</p>
            </div>
          </div>

          {/* Texts per language, with the preview beside them */}
          <div className="grid grid-cols-1 gap-5 md:grid-cols-[1fr_260px]">
            <div>
              <p className={LABEL}>{t('form.texts')}</p>
              <p className="mb-2 text-xs text-gray-500">{t('form.textsHelp')}</p>
              <div role="tablist" className="mb-3 flex flex-wrap gap-1">
                {CAMPAIGN_LANGUAGES.map((lang) => {
                  const filled = Boolean(form.content[lang].title.trim())
                  return (
                    <button
                      key={lang}
                      role="tab"
                      aria-selected={language === lang}
                      onClick={() => setLanguage(lang)}
                      className={`rounded-lg border px-3 py-1 text-xs font-semibold uppercase ${
                        language === lang ? 'border-tuggi-blue bg-tuggi-blue text-white' : 'border-gray-200 text-gray-700 hover:bg-gray-50'
                      }`}
                      title={t(`languages.${lang}`)}>
                      {lang}
                      {filled && language !== lang ? ' ●' : ''}
                    </button>
                  )
                })}
              </div>
              <div className="space-y-3">
                {CAMPAIGN_TEXT_FIELDS.map((field) => {
                  const id = `campaign-${language}-${field}`
                  const value = form.content[language][field]
                  const hint = field === 'title' ? t('form.titleHint') : field === 'body' ? t('form.bodyHint') : t('form.ctaHint')
                  const common = {
                    id,
                    value,
                    placeholder: placeholderFor(language)[field],
                    className: INPUT,
                  }
                  return (
                    <div key={field}>
                      <div className="mb-1 flex items-baseline justify-between">
                        <label htmlFor={id} className="text-sm font-semibold text-gray-700">
                          {t(`fields.${field}`)}
                        </label>
                        <CharCount value={value} max={CAMPAIGN_TEXT_MAX[field]} />
                      </div>
                      {field === 'body' ? (
                        <textarea rows={2} {...common} onChange={(e) => setText(language, field, e.target.value)} />
                      ) : (
                        <input type="text" {...common} onChange={(e) => setText(language, field, e.target.value)} />
                      )}
                      <p className={HELP}>{hint}</p>
                    </div>
                  )
                })}
              </div>
              <p className="mt-3 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                {t('form.never')}
              </p>
            </div>
            <div>
              <p className={LABEL}>
                {t('form.preview')} · <span className="uppercase">{language}</span>
              </p>
              {previewText ? (
                <AppCampaignPreview format={form.format} text={previewText} imageUrl={form.image_url} />
              ) : (
                <p className="rounded-xl border border-dashed border-gray-300 p-4 text-xs text-gray-500">{t('form.previewEmpty')}</p>
              )}
            </div>
          </div>

          {/* Image */}
          <div>
            <p className={LABEL}>{t('form.image')}</p>
            <p className="mb-2 text-xs text-gray-500">{t('form.imageHelp', { ratio: spec.ratio, width: spec.width, height: spec.height })}</p>
            <div className="flex flex-wrap items-center gap-3">
              {form.image_url && (
                // The real size, read on load, feeds the proportion warning. It never blocks the save.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={form.image_url}
                  alt=""
                  onLoad={(e) => setImageSize({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight })}
                  className="h-16 w-auto rounded-lg border border-gray-200 object-cover"
                />
              )}
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50">
                {uploading ? <Loader2 size={14} className="animate-spin" /> : <ImagePlus size={14} />}
                {uploading ? t('form.imageUploading') : form.image_url ? t('form.imageReplace') : t('form.imageUpload')}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="sr-only"
                  disabled={uploading}
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    e.target.value = ''
                    if (file) upload(file)
                  }}
                />
              </label>
              {form.image_url && (
                <button
                  onClick={() => {
                    setImageSize(null)
                    set('image_url', null)
                  }}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50">
                  <Trash2 size={14} /> {t('form.imageRemove')}
                </button>
              )}
            </div>
            {ratioOff && imageSize && (
              <p className="mt-2 text-xs text-amber-700">
                {t('form.imageRatioWarning', { width: imageSize.width, height: imageSize.height, ratio: spec.ratio })}
              </p>
            )}
          </div>

          {/* Action */}
          <div>
            <p className={LABEL}>{t('form.action')}</p>
            <div className="mb-3 flex gap-4 text-sm text-gray-700">
              {(['open_path', 'redeem_coupon'] as const).map((type) => (
                <label key={type} className="inline-flex items-center gap-2">
                  <input
                    type="radio"
                    name="campaign-action"
                    checked={form.action_type === type}
                    onChange={() => set('action_type', type)}
                    className="text-tuggi-blue focus:ring-tuggi-blue"
                  />
                  {type === 'open_path' ? t('form.actionOpenPath') : t('form.actionRedeem')}
                </label>
              ))}
            </div>

            {form.action_type === 'open_path' ? (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <label htmlFor="campaign-destination" className={LABEL}>
                    {t('form.destination')}
                  </label>
                  <select
                    id="campaign-destination"
                    value={form.destination}
                    onChange={(e) => set('destination', e.target.value as CampaignDestination | '')}
                    className={INPUT}>
                    {form.other_path && <option value="">{t('destinations.other', { path: form.other_path })}</option>}
                    {CAMPAIGN_DESTINATIONS.map((d) => (
                      <option key={d.path} value={d.path}>
                        {t(`destinations.${destinationKey(d.path)}`)}
                      </option>
                    ))}
                  </select>
                </div>
                {CAMPAIGN_DESTINATIONS.find((d) => d.path === form.destination)?.id && (
                  <div>
                    <label htmlFor="campaign-destination-id" className={LABEL}>
                      {t('form.destinationId')} <span className="text-red-500">*</span>
                    </label>
                    <input
                      id="campaign-destination-id"
                      type="text"
                      value={form.destination_id}
                      onChange={(e) => set('destination_id', e.target.value.trim())}
                      className={`${INPUT} font-mono`}
                    />
                    <p className={HELP}>{t('form.destinationIdHelp')}</p>
                  </div>
                )}
              </div>
            ) : (
              <div>
                <label htmlFor="campaign-coupon" className={LABEL}>
                  {t('form.coupon')} <span className="text-red-500">*</span>
                </label>
                {coupons !== null && coupons.length === 0 ? (
                  <p className="text-sm text-gray-500">{t('form.couponsEmpty')}</p>
                ) : (
                  <select id="campaign-coupon" value={form.coupon_id} onChange={(e) => set('coupon_id', e.target.value)} className={INPUT}>
                    <option value="">{t('form.couponPlaceholder')}</option>
                    {(coupons ?? []).map((c) => (
                      <option key={c.id} value={c.id}>
                        {t('form.couponOption', {
                          code: c.code,
                          grant: formatCouponGrant(c, t('form.days')),
                          redeemed: c.redeemed_count,
                          max: c.max_redemptions ?? '∞',
                        })}
                        {c.is_active ? '' : ` · ${t('form.couponOff')}`}
                      </option>
                    ))}
                  </select>
                )}
                <p className="mt-2 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                  {t('form.couponHelp')}
                </p>
                {selectedCoupon && <p className={HELP}>{t('form.couponNumberHelp')}</p>}
              </div>
            )}
          </div>

          {/* Window and switch */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div>
              <label htmlFor="campaign-starts" className={LABEL}>
                {t('form.startsAt')}
              </label>
              <input id="campaign-starts" type="datetime-local" value={form.starts_at} onChange={(e) => set('starts_at', e.target.value)} className={INPUT} />
            </div>
            <div>
              <label htmlFor="campaign-ends" className={LABEL}>
                {t('form.endsAt')}
              </label>
              <input id="campaign-ends" type="datetime-local" value={form.ends_at} onChange={(e) => set('ends_at', e.target.value)} className={INPUT} />
            </div>
            <div>
              <p className={LABEL}>{t('form.isActive')}</p>
              <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={form.is_active}
                  onChange={(e) => set('is_active', e.target.checked)}
                  className="rounded border-gray-300 text-tuggi-blue focus:ring-tuggi-blue"
                />
                {t('form.isActiveHelp')}
              </label>
            </div>
          </div>
          <p className="-mt-3 text-xs text-gray-500">{t('form.windowHelp')}</p>
        </div>

        <div className="sticky bottom-0 flex justify-end gap-2 border-t border-gray-200 bg-white px-6 py-4">
          <button
            onClick={() => !busy && onClose()}
            disabled={busy}
            className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50">
            {t('form.cancel')}
          </button>
          <button
            onClick={submit}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-xl bg-tuggi-blue px-4 py-2 text-sm font-semibold text-white shadow-md shadow-tuggi-blue/10 hover:bg-tuggi-blue/90 disabled:opacity-60">
            {submitting && <Loader2 size={14} className="animate-spin" />}
            {isEditing ? t('form.save') : t('form.create')}
          </button>
        </div>
      </div>
    </div>
  )
}
