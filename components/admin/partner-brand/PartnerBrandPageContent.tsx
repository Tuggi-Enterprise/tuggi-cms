'use client'

/**
 * /admin/partner-brand (#1257, epic #1248): the curator's side of the Tuggi do parceiro, wave 1.
 * Contract `docs/contracts/tuggi-do-parceiro.md` §5.
 *
 * - Logos to decide (BR-B2B-070 item 2): nothing of the partner reaches the tourist before a human
 *   approves it here.
 * - Place suggestions to answer (#1261, BR-B2B-073 item 3.b), under the logos: link to a POI,
 *   create it, or refuse with a reason (`PlaceSuggestionQueue`).
 * - The brand term in days (item 7) and the three switches (item 4 and the gift per platform). The
 *   writes go to the routes that already own them: `/api/admin/reward-settings` and
 *   `/api/admin/trip-reminder/switches`; this page only names the keys of this product.
 * - The price of each gift package (item 9), optional and empty for now.
 *
 * The pilot of each partner lives in the client record, tab Marca (`BrandTab`).
 * Page gate: `resolveAccess` (proxy, admin only). API gate: `withAuth({ roles: ['admin'] })`.
 */

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { AlertCircle, BadgeCheck } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Container } from '@/components/ui/Container'
import {
  BRAND_TERM_KEY,
  formatMoneyInput,
  parseMoneyInput,
  partnerBrandHref,
  switchId,
  type GiftPackage,
  type PartnerBrandError,
  type PartnerBrandSettings,
  type PartnerSwitch,
  type PendingLogo,
} from '@/lib/partner-brand/brand'
import { parseRewardValue, validateRewardValue } from '@/lib/rewards/settings'
import { PendingLogoCard } from './PendingLogoCard'
import { PlaceSuggestionQueue, type QueueNotice } from './PlaceSuggestionQueue'
import { usePartnerBrandErrorText } from './usePartnerBrandErrorText'

const SECTION = 'rounded-lg border border-gray-200 bg-white p-5'
const INPUT =
  'rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-tuggi-blue/40'
const BUTTON =
  'rounded-md bg-tuggi-blue px-3 py-1.5 text-sm font-semibold text-white hover:bg-tuggi-blue/90 disabled:opacity-50'

/** The refusal of a route this page borrows (reward settings, switches) in this page's words. */
function borrowedError(code: unknown): PartnerBrandError {
  if (code === 'forbidden') return { code: 'forbidden' }
  if (code === 'invalid_value' || code === 'invalid_body' || code === 'above_cap') return { code: 'invalid_value' }
  return { code: 'write_failed' }
}

export function PartnerBrandPageContent() {
  const t = useTranslations('PartnerBrand')
  const errorText = usePartnerBrandErrorText()
  const [logos, setLogos] = useState<PendingLogo[] | null>(null)
  const [settings, setSettings] = useState<PartnerBrandSettings | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<QueueNotice | null>(null)

  const loadLogos = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/partner-brand/logos')
      const data = await res.json()
      if (!res.ok) return setError(errorText(data.error))
      setLogos(data.logos ?? [])
    } catch {
      setError(errorText({ code: 'read_failed' }))
    }
  }, [errorText])

  const loadSettings = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/partner-brand/settings')
      const data = await res.json()
      if (!res.ok) return setError(errorText(data.error))
      setSettings(data as PartnerBrandSettings)
    } catch {
      setError(errorText({ code: 'read_failed' }))
    }
  }, [errorText])

  useEffect(() => {
    void loadLogos()
    void loadSettings()
  }, [loadLogos, loadSettings])

  const onDecided = (outcome: 'approved' | 'rejected' | 'stale') => {
    if (outcome !== 'stale') setNotice({ ok: true, text: t(`logo.done_${outcome}`) })
    void loadLogos()
  }

  return (
    <div className="cms-width min-h-screen bg-gray-50/50">
      <Container className="space-y-6 py-8">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900">
            <BadgeCheck size={22} className="text-tuggi-orange" />
            {t('title')}
          </h1>
          <p className="text-sm text-gray-600">{t('subtitle')}</p>
        </div>

        {error && (
          <div role="alert" className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            <AlertCircle size={16} /> {error}
          </div>
        )}
        {notice && (
          <p
            role={notice.ok ? 'status' : 'alert'}
            className={`rounded-md border px-3 py-2 text-sm ${notice.ok ? 'border-green-200 bg-green-50 text-green-800' : 'border-red-200 bg-red-50 text-red-700'}`}>
            {notice.text}
          </p>
        )}

        <section aria-labelledby="partner-logos" className="space-y-3">
          <h2 id="partner-logos" className="text-lg font-bold text-gray-900">
            {t('logo.queueTitle')}
          </h2>
          <p className="text-sm text-gray-600">{t('logo.queueIntro')}</p>
          {logos === null ? (
            <p className="rounded-lg border border-gray-200 bg-white px-4 py-8 text-center text-sm text-gray-500">{t('loading')}</p>
          ) : logos.length === 0 ? (
            <p className="rounded-lg border border-gray-200 bg-white px-4 py-8 text-center text-sm text-gray-500">{t('logo.queueEmpty')}</p>
          ) : (
            <ul className="m-0 flex flex-col gap-4 p-0">
              {logos.map((logo) => (
                <PendingLogoCard
                  key={`${logo.client_id}:${logo.logo_path}`}
                  clientId={logo.client_id}
                  logoPath={logo.logo_path}
                  logoUrl={logo.logo_url}
                  approvedLogoUrl={logo.approved_logo_url}
                  submittedAt={logo.logo_submitted_at}
                  title={
                    <Link
                      href={partnerBrandHref(logo.client_id)}
                      className="underline-offset-2 hover:underline">
                      {logo.client_name ?? t('logo.noName')}
                    </Link>
                  }
                  onDecided={onDecided}
                />
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="partner-suggestions" className="space-y-3">
          <h2 id="partner-suggestions" className="text-lg font-bold text-gray-900">
            {t('suggestions.queueTitle')}
          </h2>
          <p className="text-sm text-gray-600">{t('suggestions.queueIntro')}</p>
          <PlaceSuggestionQueue onNotice={setNotice} />
        </section>

        {settings && (
          <>
            <TermAndSwitches settings={settings} onChanged={loadSettings} />
            <Packages packages={settings.packages} onChanged={loadSettings} />
          </>
        )}
      </Container>
    </div>
  )
}

function TermAndSwitches({ settings, onChanged }: { settings: PartnerBrandSettings; onChanged: () => void }) {
  const t = useTranslations('PartnerBrand')
  const errorText = usePartnerBrandErrorText()
  const [term, setTerm] = useState(settings.term_days === null ? '' : String(settings.term_days))
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  const saveTerm = async () => {
    const value = parseRewardValue(term)
    if (validateRewardValue(value, 'days')) return setMessage({ ok: false, text: errorText({ code: 'invalid_value' }) })
    setBusy('term')
    setMessage(null)
    try {
      const res = await fetch('/api/admin/reward-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: BRAND_TERM_KEY, value }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) return setMessage({ ok: false, text: errorText(borrowedError(data.error?.code)) })
      setMessage({ ok: true, text: t('term.saved', { days: value }) })
      onChanged()
    } catch {
      setMessage({ ok: false, text: errorText({ code: 'write_failed' }) })
    } finally {
      setBusy(null)
    }
  }

  const toggle = async (row: PartnerSwitch) => {
    setBusy(row.key)
    setMessage(null)
    try {
      const res = await fetch('/api/admin/trip-reminder/switches', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: row.key, is_on: !row.is_on }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) return setMessage({ ok: false, text: errorText(borrowedError(data.error?.code)) })
      setMessage({ ok: true, text: t(row.is_on ? 'switches.saved_off' : 'switches.saved_on', { label: t(`switches.items.${switchId(row.key)}.label`) }) })
      onChanged()
    } catch {
      setMessage({ ok: false, text: errorText({ code: 'write_failed' }) })
    } finally {
      setBusy(null)
    }
  }

  return (
    <section aria-labelledby="partner-settings" className={SECTION}>
      <h2 id="partner-settings" className="text-lg font-bold text-gray-900">
        {t('settingsTitle')}
      </h2>
      {message && (
        <p role={message.ok ? 'status' : 'alert'} className={`mt-2 text-sm ${message.ok ? 'text-green-800' : 'text-red-700'}`}>
          {message.text}
        </p>
      )}

      <div className="mt-4">
        <label htmlFor="partner-term" className="block text-sm font-semibold text-gray-800">
          {t('term.label')}
        </label>
        <div className="mt-1 flex items-center gap-2">
          <input
            id="partner-term"
            inputMode="numeric"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void saveTerm()}
            className={`${INPUT} w-24`}
          />
          <span className="text-sm text-gray-600">{t('term.unit')}</span>
          <button type="button" disabled={busy !== null} onClick={() => void saveTerm()} className={BUTTON}>
            {t('save')}
          </button>
        </div>
        <p className="mt-1 text-xs text-gray-600">{settings.term_days === null ? t('term.missing') : t('term.hint')}</p>
      </div>

      <ul className="mt-5 flex flex-col gap-3 p-0">
        {settings.switches.map((row) => {
          const id = switchId(row.key)
          return (
            <li key={row.key} className="flex list-none items-start gap-3">
              <input
                id={`partner-switch-${id}`}
                type="checkbox"
                checked={row.is_on}
                disabled={busy !== null}
                onChange={() => void toggle(row)}
                className="mt-1 rounded border-gray-300 text-tuggi-blue focus:ring-tuggi-blue"
              />
              <label htmlFor={`partner-switch-${id}`} className="text-sm">
                <span className="font-semibold text-gray-900">{t(`switches.items.${id}.label`)}</span>
                <span className="ml-2 text-xs text-gray-600">{row.is_on ? t('switches.on') : t('switches.off')}</span>
                <span className="block text-xs text-gray-600">{t(`switches.items.${id}.hint`)}</span>
              </label>
            </li>
          )
        })}
        {settings.switches.length === 0 && <li className="list-none text-sm text-gray-600">{t('switches.missing')}</li>}
      </ul>
    </section>
  )
}

function Packages({ packages, onChanged }: { packages: GiftPackage[]; onChanged: () => void }) {
  const t = useTranslations('PartnerBrand')
  return (
    <section aria-labelledby="partner-packages" className={SECTION}>
      <h2 id="partner-packages" className="text-lg font-bold text-gray-900">
        {t('packages.title')}
      </h2>
      <p className="mt-1 text-sm text-gray-600">{t('packages.intro')}</p>
      <table className="mt-4 w-full max-w-2xl text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wider text-gray-600">
            <th className="py-2 pr-3 font-semibold">{t('packages.days')}</th>
            <th className="py-2 pr-3 font-semibold">{t('packages.price')}</th>
            <th className="py-2 pr-3 font-semibold">{t('packages.currency')}</th>
            <th className="py-2" />
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {packages.map((p) => (
            <PackageRow key={p.days} pkg={p} onChanged={onChanged} />
          ))}
        </tbody>
      </table>
    </section>
  )
}

function PackageRow({ pkg, onChanged }: { pkg: GiftPackage; onChanged: () => void }) {
  const t = useTranslations('PartnerBrand')
  const errorText = usePartnerBrandErrorText()
  const [price, setPrice] = useState(formatMoneyInput(pkg.price_cents))
  const [currency, setCurrency] = useState(pkg.price_currency ?? '')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  const save = async () => {
    const cents = parseMoneyInput(price)
    if (cents !== null && Number.isNaN(cents)) return setMessage({ ok: false, text: errorText({ code: 'invalid_price' }) })
    setBusy(true)
    setMessage(null)
    try {
      const res = await fetch('/api/admin/partner-brand/packages', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ days: pkg.days, price_cents: cents, price_currency: currency.trim() || null }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) return setMessage({ ok: false, text: errorText(data.error) })
      setMessage({ ok: true, text: t('packages.saved') })
      onChanged()
    } catch {
      setMessage({ ok: false, text: errorText({ code: 'write_failed' }) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <tr>
      <td className="py-2 pr-3 font-semibold text-gray-900">{t('packages.daysValue', { days: pkg.days })}</td>
      <td className="py-2 pr-3">
        <input
          aria-label={t('packages.priceOf', { days: pkg.days })}
          inputMode="decimal"
          value={price}
          placeholder={t('packages.pricePlaceholder')}
          onChange={(e) => setPrice(e.target.value)}
          className={`${INPUT} w-28`}
        />
      </td>
      <td className="py-2 pr-3">
        <input
          aria-label={t('packages.currencyOf', { days: pkg.days })}
          value={currency}
          maxLength={3}
          placeholder="BRL"
          onChange={(e) => setCurrency(e.target.value.toUpperCase())}
          className={`${INPUT} w-20 uppercase tracking-wider`}
        />
      </td>
      <td className="py-2">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" disabled={busy} onClick={() => void save()} className={BUTTON}>
            {t('save')}
          </button>
          {message && (
            <span role={message.ok ? 'status' : 'alert'} className={`text-xs ${message.ok ? 'text-green-800' : 'text-red-700'}`}>
              {message.text}
            </span>
          )}
        </div>
      </td>
    </tr>
  )
}
