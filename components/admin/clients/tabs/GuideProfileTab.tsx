'use client'

/**
 * "Perfil no app" — the tour guide's public profile in the client record (#936, spec §5;
 * BR-B2B-064 items 4, 5, 10 and 11). It takes the place of `Locais`: a guide has no place.
 *
 * Visibility on top, then the meeting point (#1179, spec §9: it locks "Aparece no app", so the
 * reason and the fix sit in the same view), then the data, then the bio. Every write goes through
 * `/api/admin/clients/{id}/guide-profile`; nothing here decides what the app lists — that is
 * `core.app_get_nearby_guides`, which reads `listed_in_app`, `hidden`, the consent and the point.
 *
 * The guide of the app request (#1184, BR-B2B-066 item 10) lands here with an EMPTY profile and
 * no submission: no "Publicar o perfil", every missing field reads as a dash, and the tick stays
 * locked until there is a photo and a bio to confer (BR-B2B-064 item 9.a: in the app path the
 * conference comes before the tick, not before the approval).
 *
 * Out of this tab, and said so: the queue of photo and bio changes sent by the guide (spec §5,
 * item 4). The portal RPC of #933 edits both directly, so there is nothing pending to approve.
 */

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useTranslations } from 'next-intl'
import { AlertTriangle, Copy, Eye, EyeOff, Loader2, MapPin, MessageCircle, Pencil, UserRound } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { DialogShell } from '@/components/admin/credit/DialogShell'
import { FIELD_GRID, RecordSection } from '@/components/admin/clients/shared/RecordSection'
import { ReadField } from '@/components/admin/clients/shared/EditField'
import { LocationPicker } from '@/components/entity-management/LocationPicker'
import { guideVisibilityOf, type GuideVisibility } from '@/lib/partnerships/pipeline'
import { cn } from '@/lib/utils'
import type { GuideProfile } from '@/lib/services/guide-profile-service'

/** The same numbers as `guide-profile-service.ts`; that module pulls the service client, so not imported. */
const BIO_MAX = 400
const ADDRESS_MAX = 300
const CITY_MAX = 80
/** The route's answer to listing without a meeting point (`GUIDE_MEETING_POINT_REQUIRED`). */
const MEETING_POINT_REQUIRED = 'meeting_point_required'
const REASONS = ['tourist_report', 'inactive', 'guide_request', 'other'] as const
type Reason = (typeof REASONS)[number]
const UNDO_MS = 10_000

type Load = { state: 'loading' } | { state: 'error' } | { state: 'ready'; profile: GuideProfile | null }
type PointDraft = { address: string; city: string; lat: number | null; lng: number | null }
const EMPTY_POINT: PointDraft = { address: '', city: '', lat: null, lng: null }

/** The badge of each state of `guideVisibilityOf` (spec §9.1): amber asks for an act, grey is a decision. */
const BADGE: Record<GuideVisibility, { key: string; className: string }> = {
  no_consent: { key: 'visibility.noConsent', className: 'border-amber-300 bg-amber-50 text-amber-900' },
  hidden: { key: 'visibility.hidden', className: 'border-gray-300 bg-gray-100 text-gray-800' },
  no_meeting_point: { key: 'visibility.noMeetingPoint', className: 'border-amber-300 bg-amber-50 text-amber-900' },
  unlisted: { key: 'visibility.unlisted', className: 'border-gray-300 bg-gray-100 text-gray-800' },
  listed: { key: 'visibility.listed', className: 'border-green-300 bg-green-50 text-green-800' },
}

const clock = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })

interface Props {
  clientId: string
  /** The portal submission behind the guide — what "Publicar o perfil" publishes. `null` for the app guide. */
  submissionId: string | null
  /** The record's name, for the dialog and the map while the guide has not sent its own (#1184). */
  fallbackName: string
  onPublished: () => void
}

export function GuideProfileTab({ clientId, submissionId, fallbackName, onPublished }: Props) {
  const t = useTranslations('Clients.guide')
  const [load, setLoad] = useState<Load>({ state: 'loading' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dialog, setDialog] = useState(false)
  const [reason, setReason] = useState<Reason | ''>('')
  const [other, setOther] = useState('')
  const [reasonInvalid, setReasonInvalid] = useState(false)
  const [undo, setUndo] = useState<{ hidden: boolean; reason: string | null } | null>(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [bioError, setBioError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [listedAt, setListedAt] = useState<{ listed: boolean; at: string } | null>(null)
  const [listRefused, setListRefused] = useState(false)
  const [pointEditing, setPointEditing] = useState(false)
  const [point, setPoint] = useState<PointDraft>(EMPTY_POINT)
  /** What the map centres on: address and city as they were when the curator left the field, not per keystroke. */
  const [pointQuery, setPointQuery] = useState('')
  const [pointSavedAt, setPointSavedAt] = useState<string | null>(null)
  const [pointError, setPointError] = useState<string | null>(null)
  const reasonRef = useRef<HTMLSelectElement | null>(null)
  const addressRef = useRef<HTMLInputElement | null>(null)
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const url = `/api/admin/clients/${clientId}/guide-profile`

  const refetch = useCallback(async () => {
    try {
      const response = await fetch(url, { cache: 'no-store' })
      if (!response.ok) return setLoad({ state: 'error' })
      setLoad({ state: 'ready', profile: ((await response.json()) as { profile: GuideProfile | null }).profile })
    } catch {
      setLoad({ state: 'error' })
    }
  }, [url])

  useEffect(() => {
    setLoad({ state: 'loading' })
    void refetch()
  }, [refetch])

  useEffect(() => () => {
    if (undoTimer.current) clearTimeout(undoTimer.current)
  }, [])

  async function send(
    method: 'POST' | 'PATCH',
    body: Record<string, unknown>
  ): Promise<{ ok: boolean; error?: string; updatedAt?: string }> {
    setBusy(true)
    try {
      const response = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const payload = (await response.json().catch(() => ({}))) as { error?: string; updatedAt?: string }
      return { ok: response.ok, error: payload.error, updatedAt: payload.updatedAt }
    } catch {
      return { ok: false }
    } finally {
      setBusy(false)
    }
  }

  function offerUndo(previous: { hidden: boolean; reason: string | null }) {
    if (undoTimer.current) clearTimeout(undoTimer.current)
    setUndo(previous)
    undoTimer.current = setTimeout(() => setUndo(null), UNDO_MS)
  }

  async function setHidden(hidden: boolean, storedReason: string | null, withUndo: boolean) {
    setError(null)
    const previous = load.state === 'ready' && load.profile ? { hidden: load.profile.hidden, reason: load.profile.hiddenReason } : null
    // A stored reason that is not one of the closed ids was typed under "Outro".
    const body = !hidden
      ? { hidden: false }
      : (REASONS as readonly string[]).includes(storedReason ?? '') && storedReason !== 'other'
        ? { hidden: true, reason: storedReason }
        : { hidden: true, reason: 'other', other: storedReason }
    const outcome = await send('POST', body)
    if (!outcome.ok) {
      setError(t('visibility.error'))
      return
    }
    setDialog(false)
    await refetch()
    if (withUndo && previous) offerUndo(previous)
    else setUndo(null)
  }

  async function confirmHide() {
    const text = other.trim()
    if (!reason || (reason === 'other' && !text)) {
      setReasonInvalid(true)
      reasonRef.current?.focus()
      return
    }
    await setHidden(true, reason === 'other' ? text : reason, true)
  }

  async function publish() {
    if (!submissionId) return
    setError(null)
    setBusy(true)
    try {
      const response = await fetch(`/api/admin/partnerships/validation/${submissionId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'publish_guide' }),
      })
      if (!response.ok) return setError(t('publish.error'))
      await refetch()
      onPublished()
    } catch {
      setError(t('publish.error'))
    } finally {
      setBusy(false)
    }
  }

  async function saveBio() {
    const text = draft.trim()
    if (text.length < 1 || text.length > BIO_MAX) {
      setBioError(t('bio.error', { reason: t('bio.length', { max: BIO_MAX }) }))
      return
    }
    setBioError(null)
    const outcome = await send('PATCH', { bio: text })
    if (!outcome.ok) {
      setBioError(t('bio.error', { reason: outcome.error === 'invalid_bio' ? t('bio.length', { max: BIO_MAX }) : t('bio.failed') }))
      return
    }
    if (outcome.updatedAt) setSavedAt(outcome.updatedAt)
    setEditing(false)
    await refetch()
  }

  /**
   * BR-B2B-064 item 11.a: "Aparece no app", straight to `cms_set_guide_listed`, no dialog: the
   * checkbox itself undoes. Refused for want of a point (another curator, a race): the same reason
   * as the lock, and the checkbox goes back to what the server holds.
   */
  async function setListed(listed: boolean) {
    setError(null)
    setListedAt(null)
    const outcome = await send('POST', { listed })
    if (!outcome.ok) {
      if (outcome.error === MEETING_POINT_REQUIRED) setListRefused(true)
      else setError(t('visibility.error'))
      await refetch()
      return
    }
    setListRefused(false)
    setListedAt({ listed, at: new Date().toISOString() })
    await refetch()
  }

  /** "Definir o ponto de encontro": to the section below, with the cursor in Endereço. */
  function goToMeetingPoint() {
    if (load.state === 'ready' && load.profile?.meetingPoint && !pointEditing) startPointEdit(load.profile)
    // after the render that opens the editor
    setTimeout(() => {
      addressRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      addressRef.current?.focus()
    }, 0)
  }

  function startPointEdit(current: GuideProfile) {
    const mp = current.meetingPoint
    setPoint(mp ? { address: mp.address, city: mp.city, lat: mp.lat, lng: mp.lng } : EMPTY_POINT)
    setPointQuery(mp ? `${mp.address}, ${mp.city}` : '')
    setPointError(null)
    setPointSavedAt(null)
    setPointEditing(true)
  }

  function cancelPointEdit() {
    setPointEditing(false)
    setPoint(EMPTY_POINT)
    setPointQuery('')
    setPointError(null)
  }

  /** BR-B2B-064 item 11.c: the pin comes only from a click or a drag on the map, never from the address. */
  async function savePoint() {
    const address = point.address.trim()
    const city = point.city.trim()
    if (!address || !city || point.lat === null || point.lng === null) {
      setPointError(t('meetingPoint.error', { reason: t('meetingPoint.incomplete') }))
      return
    }
    setPointError(null)
    const outcome = await send('PATCH', { meetingPoint: { address, city, lat: point.lat, lng: point.lng } })
    if (!outcome.ok) {
      const invalid = outcome.error === 'invalid_meeting_point'
      setPointError(t('meetingPoint.error', { reason: invalid ? t('meetingPoint.invalid') : t('meetingPoint.failed') }))
      return
    }
    if (outcome.updatedAt) setPointSavedAt(outcome.updatedAt)
    setListRefused(false)
    setPointEditing(false)
    await refetch()
  }

  if (load.state === 'loading') {
    return (
      <p className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        {t('loading')}
      </p>
    )
  }
  if (load.state === 'error') {
    return (
      <p role="alert" className="text-sm text-destructive">
        {t('loadError')}
      </p>
    )
  }

  const profile = load.profile
  const errorLine = error ? (
    <p role="alert" className="flex items-start gap-2 text-sm text-destructive">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      {error}
    </p>
  ) : null

  if (!profile) {
    return (
      <RecordSection icon={<UserRound className="h-4 w-4 text-tuggi-blue" />} title={t('title')}>
        <div className="space-y-3 text-sm">
          <p className="text-gray-700 dark:text-gray-300">{t('publish.missing')}</p>
          {submissionId ? (
            <Button variant="cta" disabled={busy} onClick={() => void publish()}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              {t('publish.action')}
            </Button>
          ) : null}
          {errorLine}
        </div>
      </RecordSection>
    )
  }

  const reasonLabel = (stored: string | null) =>
    stored && (REASONS as readonly string[]).includes(stored) && stored !== 'other' ? t(`reasons.${stored}` as 'reasons.inactive') : (stored ?? '')
  const whatsappHref = profile.whatsapp ? `https://wa.me/${profile.whatsapp}` : null
  const name = profile.displayName ?? fallbackName
  const badge = BADGE[
    guideVisibilityOf({
      hidden: profile.hidden,
      consent: profile.consent,
      listedInApp: profile.listedInApp,
      hasMeetingPoint: profile.meetingPoint !== null,
    })
  ]
  // Only the missing point locks the tick (spec §9.1): hidden or without consent, the badge says
  // why the guide is not listed, and the tick counts once the other condition is back.
  const listLocked = profile.meetingPoint === null
  // BR-B2B-064 item 9.a and BR-B2B-066 item 10.d (#1184): photo and bio are what the curator confers
  // before ticking, and the empty profile of the app guide has neither yet. Unticking stays free.
  const nothingToConfer = profile.photoUrl === null || profile.bio === null
  const tickLocked = listLocked || (nothingToConfer && !profile.listedInApp)
  const lockLines = [listLocked || listRefused ? 'guide-listed-locked' : null, nothingToConfer ? 'guide-listed-incomplete' : null]
    .filter(Boolean)
    .join(' ')
  const meetingPoint = profile.meetingPoint
  // A guide without a point (published before 2026-11-10) opens the section already editing.
  const pointOpen = pointEditing || meetingPoint === null
  const pointComplete = point.address.trim() !== '' && point.city.trim() !== '' && point.lat !== null && point.lng !== null
  const pointKeys = (event: KeyboardEvent) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      void savePoint()
    }
    if (event.key === 'Escape' && meetingPoint) {
      event.preventDefault()
      cancelPointEdit()
    }
  }

  return (
    <div className="space-y-6">
      {/* 1 · visibility */}
      <RecordSection icon={<Eye className="h-4 w-4 text-tuggi-blue" />} title={t('visibility.title')}>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="flex items-center gap-2">
            <Checkbox
              id="guide-listed-in-app"
              checked={profile.listedInApp}
              disabled={busy || tickLocked}
              aria-describedby={lockLines || undefined}
              onCheckedChange={(value) => void setListed(value === true)}
            />
            <Label htmlFor="guide-listed-in-app" className="font-semibold text-gray-900 dark:text-white">
              {t('visibility.listedInApp')}
            </Label>
          </span>
          <span className={cn('inline-flex items-center rounded-full border px-3 py-1 text-xs font-bold', badge.className)}>
            {t(badge.key as 'visibility.listed')}
          </span>
          {profile.consent && profile.hidden ? (
            <span className="text-gray-700 dark:text-gray-300">
              {/* No date: `guide_profiles` has no `hidden_at`, and `updated_at` moves with any edit. */}
              {t('visibility.hiddenReason', { reason: reasonLabel(profile.hiddenReason) })}
            </span>
          ) : null}
          {profile.consent && !profile.hidden ? (
            <Button variant="outline" disabled={busy} onClick={() => { setReason(''); setOther(''); setReasonInvalid(false); setError(null); setDialog(true) }}>
              <EyeOff className="mr-2 h-4 w-4" aria-hidden="true" />
              {t('visibility.hide')}
            </Button>
          ) : null}
          {profile.hidden || !profile.consent ? (
            <Button variant="outline" disabled={busy || !profile.consent} onClick={() => void setHidden(false, null, true)}>
              <Eye className="mr-2 h-4 w-4" aria-hidden="true" />
              {t('visibility.show')}
            </Button>
          ) : null}
        </div>
        {listLocked || listRefused ? (
          <p id="guide-listed-locked" className="mt-2 flex flex-wrap items-center gap-x-2 text-sm text-amber-900 dark:text-amber-300">
            {t('visibility.listedLocked')}
            <button type="button" className="font-bold text-primary-800 underline dark:text-tuggi-blue" onClick={goToMeetingPoint}>
              {t('visibility.setMeetingPoint')}
            </button>
          </p>
        ) : null}
        {nothingToConfer ? (
          <p id="guide-listed-incomplete" className="mt-2 text-sm text-amber-900 dark:text-amber-300">
            {t('visibility.incompleteLocked')}
          </p>
        ) : null}
        {!profile.consent ? <p className="mt-2 text-sm text-gray-700 dark:text-gray-300">{t('visibility.noConsentLine')}</p> : null}
        {listedAt ? (
          <p role="status" className="mt-3 text-sm text-gray-800 dark:text-gray-200">
            {t(listedAt.listed ? 'visibility.listedOn' : 'visibility.listedOff', { time: clock(listedAt.at) })}
          </p>
        ) : null}
        {undo ? (
          <p role="status" className="mt-3 flex items-center gap-3 text-sm text-gray-800 dark:text-gray-200">
            {profile.hidden ? t('visibility.hiddenDone') : t('visibility.shownDone')}
            <button
              type="button"
              className="font-bold text-primary-800 underline dark:text-tuggi-blue"
              disabled={busy}
              onClick={() => void setHidden(undo.hidden, undo.reason, false)}
            >
              {t('visibility.undo')}
            </button>
          </p>
        ) : null}
        <div className="mt-3">{errorLine}</div>
      </RecordSection>

      {/* 2 · the meeting point (#1179, BR-B2B-064 items 4, 6 and 11.c) */}
      <RecordSection icon={<MapPin className="h-4 w-4 text-tuggi-blue" />} title={t('meetingPoint.title')}>
        {pointOpen ? (
          <div className="space-y-3 text-sm" onKeyDown={pointKeys}>
            <p className="text-xs text-gray-700 dark:text-gray-300">{t('meetingPoint.hint')}</p>
            {meetingPoint === null ? <p className="text-gray-700 dark:text-gray-300">{t('meetingPoint.empty')}</p> : null}
            <div className={FIELD_GRID}>
              <div className="space-y-1">
                <Label htmlFor="guide-meeting-address" className="dark:text-gray-200">{t('meetingPoint.address')}</Label>
                <Input
                  id="guide-meeting-address"
                  ref={addressRef}
                  value={point.address}
                  maxLength={ADDRESS_MAX}
                  onChange={(event) => setPoint((p) => ({ ...p, address: event.target.value }))}
                  onBlur={() => setPointQuery([point.address.trim(), point.city.trim()].filter(Boolean).join(', '))}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="guide-meeting-city" className="dark:text-gray-200">{t('meetingPoint.city')}</Label>
                <Input
                  id="guide-meeting-city"
                  value={point.city}
                  maxLength={CITY_MAX}
                  onChange={(event) => setPoint((p) => ({ ...p, city: event.target.value }))}
                  onBlur={() => setPointQuery([point.address.trim(), point.city.trim()].filter(Boolean).join(', '))}
                />
              </div>
            </div>
            {/* The address only centres the map; the coordinate is the click or the drag (spec §9.2). */}
            <LocationPicker
              editable
              latitude={point.lat}
              longitude={point.lng}
              name={name}
              address={pointQuery}
              captions={{
                locating: t('meetingPoint.captions.locating'),
                centered: t('meetingPoint.captions.centered'),
                not_located: t('meetingPoint.captions.not_located'),
                no_address: t('meetingPoint.captions.no_address'),
              }}
              onChange={(lat, lng) => setPoint((p) => ({ ...p, lat, lng }))}
            />
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="cta" disabled={busy || !pointComplete} onClick={() => void savePoint()}>
                {t('meetingPoint.save')}
              </Button>
              {meetingPoint ? (
                <Button variant="outline" disabled={busy} onClick={cancelPointEdit}>
                  {t('meetingPoint.cancel')}
                </Button>
              ) : null}
            </div>
            {pointError ? <p role="alert" className="text-sm text-destructive">{pointError}</p> : null}
          </div>
        ) : (
          <div className="space-y-3 text-sm">
            <div className={FIELD_GRID}>
              <ReadField label={t('meetingPoint.address')}>{meetingPoint?.address}</ReadField>
              <ReadField label={t('meetingPoint.city')}>{meetingPoint?.city}</ReadField>
            </div>
            <LocationPicker editable={false} latitude={meetingPoint?.lat} longitude={meetingPoint?.lng} name={name} />
            <div className="flex items-center gap-3">
              <Button variant="outline" onClick={() => startPointEdit(profile)}>
                {t('meetingPoint.edit')}
              </Button>
              {pointSavedAt ? (
                <span role="status" className="text-xs text-gray-600 dark:text-gray-300">
                  {t('meetingPoint.saved', { time: clock(pointSavedAt) })}
                </span>
              ) : null}
            </div>
          </div>
        )}
      </RecordSection>

      {/* 3 · data, beside the 160 px photo */}
      <RecordSection icon={<UserRound className="h-4 w-4 text-tuggi-blue" />} title={t('data.title')}>
        <div className="flex flex-col gap-6 sm:flex-row">
          {profile.photoUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element -- public object of guide-photos, any size */
            <img src={profile.photoUrl} alt={t('data.photoAlt', { name })} width={160} height={160} className="h-40 w-40 shrink-0 rounded-full object-cover" />
          ) : (
            <span className="flex h-40 w-40 shrink-0 items-center justify-center rounded-full bg-gray-100 dark:bg-gray-800" aria-hidden="true">
              <UserRound className="h-12 w-12 text-gray-400" />
            </span>
          )}
          <div className={cn(FIELD_GRID, 'flex-1')}>
            <ReadField label={t('data.name')}>{profile.displayName}</ReadField>
            <ReadField label={t('data.languages')}>{profile.languages.join(', ').toUpperCase()}</ReadField>
            <ReadField label={t('data.specialties')}>
              {profile.specialties.map((id) => (t.has(`specialties.${id}`) ? t(`specialties.${id}` as 'specialties.city_tour') : id)).join(', ')}
            </ReadField>
            <ReadField label={t('data.whatsapp')}>
              {profile.whatsapp && whatsappHref ? (
                <span className="flex flex-wrap items-center gap-3">
                  <span className="font-mono">+{profile.whatsapp}</span>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 text-xs font-bold text-primary-800 dark:text-tuggi-blue"
                    onClick={() => void navigator.clipboard.writeText(`+${profile.whatsapp}`).then(() => setCopied(true))}
                  >
                    <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                    {copied ? t('data.copied') : t('data.copy')}
                  </button>
                  <a className="inline-flex items-center gap-1 text-xs font-bold text-primary-800 underline dark:text-tuggi-blue" href={whatsappHref} target="_blank" rel="noreferrer">
                    <MessageCircle className="h-3.5 w-3.5" aria-hidden="true" />
                    {t('data.testWhatsapp')}
                  </a>
                </span>
              ) : null}
            </ReadField>
            <ReadField label={t('data.consent')}>{profile.consent ? t('data.consentYes') : t('data.consentNo')}</ReadField>
          </div>
        </div>
      </RecordSection>

      {/* 4 · bio */}
      <RecordSection icon={<Pencil className="h-4 w-4 text-tuggi-blue" />} title={t('bio.title')}>
        {editing ? (
          <div className="space-y-2">
            <textarea
              className="min-h-[120px] w-full rounded-xl border border-gray-300 p-3 text-sm dark:border-gray-700 dark:bg-gray-900"
              value={draft}
              maxLength={BIO_MAX}
              aria-label={t('bio.title')}
              autoFocus
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault()
                  void saveBio()
                }
                if (event.key === 'Escape') {
                  event.preventDefault()
                  setEditing(false)
                  setBioError(null)
                }
              }}
            />
            <div className="flex flex-wrap items-center gap-3 text-xs text-gray-600 dark:text-gray-300">
              <span>{t('bio.counter', { count: draft.length, max: BIO_MAX })}</span>
              <Button variant="cta" disabled={busy} onClick={() => void saveBio()}>
                {t('bio.save')}
              </Button>
              <Button variant="outline" disabled={busy} onClick={() => { setEditing(false); setBioError(null) }}>
                {t('bio.cancel')}
              </Button>
            </div>
            {bioError ? <p role="alert" className="text-sm text-destructive">{bioError}</p> : null}
          </div>
        ) : (
          <div className="space-y-2 text-sm">
            <p className="whitespace-pre-wrap text-gray-900 dark:text-white">{profile.bio ?? '-'}</p>
            <div className="flex items-center gap-3">
              <Button variant="outline" onClick={() => { setDraft(profile.bio ?? ''); setEditing(true); setSavedAt(null) }}>
                {t('bio.edit')}
              </Button>
              {savedAt ? (
                <span role="status" className="text-xs text-gray-600 dark:text-gray-300">
                  {t('bio.saved', { time: clock(savedAt) })}
                </span>
              ) : null}
            </div>
          </div>
        )}
      </RecordSection>

      <DialogShell
        open={dialog}
        title={t('hideDialog.title', { name })}
        busy={busy}
        onClose={() => setDialog(false)}
        initialFocusRef={reasonRef}
        footer={
          <>
            <Button variant="outline" disabled={busy} onClick={() => setDialog(false)}>
              {t('hideDialog.cancel')}
            </Button>
            <Button variant="destructive" disabled={busy} onClick={() => void confirmHide()}>
              {t('hideDialog.confirm')}
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm text-gray-700 dark:text-gray-300">
          <p>{t('hideDialog.body')}</p>
          <label className="block font-semibold" htmlFor="guide-hide-reason">
            {t('hideDialog.reason')}
          </label>
          <select
            id="guide-hide-reason"
            ref={reasonRef}
            value={reason}
            aria-invalid={reasonInvalid}
            className="w-full rounded-xl border border-gray-300 p-2 dark:border-gray-700 dark:bg-gray-900"
            onChange={(event) => { setReason(event.target.value as Reason); setReasonInvalid(false) }}
          >
            <option value="">{t('hideDialog.choose')}</option>
            {REASONS.map((id) => (
              <option key={id} value={id}>
                {t(`reasons.${id}`)}
              </option>
            ))}
          </select>
          {reason === 'other' ? (
            <textarea
              aria-label={t('hideDialog.otherLabel')}
              className="min-h-[80px] w-full rounded-xl border border-gray-300 p-2 dark:border-gray-700 dark:bg-gray-900"
              maxLength={500}
              value={other}
              onChange={(event) => { setOther(event.target.value); setReasonInvalid(false) }}
            />
          ) : null}
          {reasonInvalid ? <p role="alert" className="text-destructive">{t('hideDialog.reasonRequired')}</p> : null}
          {errorLine}
        </div>
      </DialogShell>
    </div>
  )
}
