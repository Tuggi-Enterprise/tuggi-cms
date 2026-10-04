'use client'

/**
 * The Portal Locais validation screen (#812, spec
 * `docs/design/spec-validacao-portal-locais-2026-10.md`): header, context band, the conference
 * blocks on the left (Empresa · Local · História · Ofertas · Fotos, in the order of BR-B2B-048
 * item 4 — what fails earliest comes first), Aceite and Histórico below them, and the decision
 * aside (`ValidationDecision`).
 *
 * The operator's ticks do NOT persist (spec §3): they are an attention ruler, not a record.
 * The CPF arrives masked and is fetched whole only on "Mostrar CPF"; it goes back to the mask
 * when the screen unmounts, because it only ever lived in this component's state.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { AlertTriangle, Check, Eye, EyeOff, ExternalLink, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { GoogleMapComponent } from '@/components/ui/GoogleMapComponent'
import {
  STORY_WORD_LIMIT,
  areasNamedIn,
  conferenceItems,
  countWords,
  formatCpf,
  isPaidPlan,
  offerLooksLikeTuggiOrMoney,
  offersOf,
  storyOfferExcerpt,
  type AdjustmentArea,
  type ConferenceItem,
} from '@/lib/partnerships/portal-review'
import type { PortalHistoryEntry, PortalSubmissionReview } from '@/lib/services/portal-submission-review-service'
import { formatDateTime, formatShortDate } from './format'
import { CARD } from './surface'
import { ValidationDecision, type DecisionResult } from './ValidationDecision'

type Load =
  | { state: 'loading' }
  | { state: 'error' }
  | { state: 'not_found' }
  | { state: 'ready'; review: PortalSubmissionReview }

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const

function parseJson<T>(value: string | undefined, fallback: T): T {
  if (!value) return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function Line({ tone, children }: { tone: 'ok' | 'warn' | 'bad'; children: React.ReactNode }) {
  const Icon = tone === 'ok' ? Check : tone === 'warn' ? AlertTriangle : X
  const color = tone === 'ok' ? 'text-green-800' : tone === 'warn' ? 'text-secondary-700' : 'text-destructive'
  return (
    <p className="flex items-start gap-2 text-sm text-gray-800 dark:text-gray-200">
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${color}`} aria-hidden="true" />
      <span className="break-words">{children}</span>
    </p>
  )
}

export function ValidationReview({ locale, submissionId }: { locale: string; submissionId: string }) {
  const t = useTranslations('PartnerValidation')
  const tForm = useTranslations('PartnerForm')
  const [load, setLoad] = useState<Load>({ state: 'loading' })
  const [ticks, setTicks] = useState<Set<ConferenceItem>>(new Set())
  const [cpf, setCpf] = useState<string | null>(null)
  const [cpfError, setCpfError] = useState(false)
  const [result, setResult] = useState<DecisionResult | null>(null)
  const [copied, setCopied] = useState(false)
  const nextRef = useRef<HTMLAnchorElement | null>(null)

  const fetchReview = useCallback(async () => {
    setLoad({ state: 'loading' })
    try {
      const response = await fetch(`/api/admin/partnerships/validation/${submissionId}`, { cache: 'no-store' })
      if (response.status === 404 || response.status === 400) return setLoad({ state: 'not_found' })
      if (!response.ok) return setLoad({ state: 'error' })
      setLoad({ state: 'ready', review: (await response.json()) as PortalSubmissionReview })
    } catch {
      setLoad({ state: 'error' })
    }
  }, [submissionId])

  useEffect(() => {
    void fetchReview()
  }, [fetchReview])

  const review = load.state === 'ready' ? load.review : null
  const answers = review?.answers ?? {}
  const plan = review?.acceptance?.planChoice ?? answers.plan_choice
  const paid = isPaidPlan(plan)
  const offers = offersOf(answers)
  const items = useMemo(
    () => conferenceItems({ planChoice: plan, hasOffers: offers.length > 0, photoCount: 0 }),
    [plan, offers.length]
  )

  const queueHref = `/${locale}/admin/clients`
  const back = (
    <Link href={queueHref} className="text-sm font-medium text-primary-800 underline dark:text-tuggi-blue">
      {t('back')}
    </Link>
  )

  if (load.state === 'loading') {
    return (
      <div className="space-y-5 p-6" aria-busy="true">
        <span className="sr-only">{t('loading')}</span>
        <div className={`${CARD} h-24 animate-pulse`} />
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="space-y-5">
            <div className={`${CARD} h-40 animate-pulse`} />
            <div className={`${CARD} h-80 animate-pulse`} />
            <div className={`${CARD} h-[200px] animate-pulse`} />
          </div>
          <div className={`${CARD} h-64 animate-pulse`} />
        </div>
      </div>
    )
  }
  if (load.state === 'error') {
    return (
      <div className="p-6">
        <div role="alert" className={`${CARD} space-y-3 p-6`}>
          <p className="font-semibold">{t('readError')}</p>
          <div className="flex items-center gap-4">
            <Button variant="outline" onClick={() => void fetchReview()}>
              {t('retry')}
            </Button>
            {back}
          </div>
        </div>
      </div>
    )
  }
  if (load.state === 'not_found' || !review) {
    return (
      <div className="p-6">
        <div className={`${CARD} space-y-3 p-6`}>
          <p className="font-semibold">{t('notFound')}</p>
          {back}
        </div>
      </div>
    )
  }

  const tradeName = answers.trade_name || t('noTradeName')
  const status = review.status
  const decided = ['approved', 'live', 'rejected'].includes(status)
  const readOnly = status !== 'in_review'
  const done = items.filter((item) => ticks.has(item)).length

  const lastTransitionTo = (to: string) =>
    [...review.history].reverse().find((h) => h.kind === 'transition' && h.to === to) as
      | Extract<PortalHistoryEntry, { kind: 'transition' }>
      | undefined
  const lastMessage = (authorKind: string) =>
    [...review.history].reverse().find((h) => h.kind === 'message' && h.authorKind === authorKind) as
      | Extract<PortalHistoryEntry, { kind: 'message' }>
      | undefined

  const resubmitted =
    status === 'in_review' &&
    review.history.some((h) => h.kind === 'transition' && h.from === 'changes_requested' && h.to === 'in_review')
  const areaLabels = Object.fromEntries(
    (['company', 'place', 'facade', 'story', 'offers', 'photos'] as AdjustmentArea[]).map((area) => [
      area,
      t(`dialogs.areas.${area}`),
    ])
  ) as Record<AdjustmentArea, string>
  const changedAreas = resubmitted ? areasNamedIn(lastMessage('operator')?.body, areaLabels) : []
  const changed = (...areas: AdjustmentArea[]) =>
    areas.some((area) => changedAreas.includes(area)) ? (
      <span className="ml-2 rounded-full bg-primary-50 px-2 py-0.5 text-xs font-medium text-primary-800">
        {t('changedBadge')}
      </span>
    ) : null

  const operatorName = (name: string | null) => name ?? t('bands.someone')

  const band = (() => {
    if (decided) {
      if (status === 'live') {
        return t('bands.live', { date: formatShortDate(lastTransitionTo('live')?.at ?? review.statusChangedAt) })
      }
      if (status === 'approved') {
        const tr = lastTransitionTo('approved')
        return t('bands.approved', { name: operatorName(tr?.actorName ?? null), date: formatShortDate(tr?.at) })
      }
      const tr = lastTransitionTo('rejected')
      if (tr && tr.actorKind !== 'operator') return t('bands.withdrawn', { date: formatShortDate(tr.at) })
      return t('bands.rejected', { name: operatorName(tr?.actorName ?? null), date: formatShortDate(tr?.at) })
    }
    if (status === 'awaiting_payment') return t('bands.awaitingPayment')
    if (status === 'changes_requested') {
      const tr = lastTransitionTo('changes_requested')
      return t('bands.changesRequested', { date: formatShortDate(tr?.at), name: operatorName(tr?.actorName ?? null) })
    }
    return null
  })()

  const onDecided = (decision: DecisionResult) => {
    setResult(decision)
    setTicks(new Set())
    void fetchReview().then(() => requestAnimationFrame(() => nextRef.current?.focus()))
  }

  const doneText = result
    ? result.kind === 'approved'
      ? result.paid
        ? t('done.approvedPaid')
        : t('done.approvedFree')
      : result.kind === 'changes'
        ? t('done.changes')
        : result.refundTotal
          ? t('done.rejectedRefund', { total: result.refundTotal })
          : t('done.rejected')
    : null

  const toggle = (item: ConferenceItem, on: boolean) =>
    setTicks((current) => {
      const next = new Set(current)
      if (on) next.add(item)
      else next.delete(item)
      return next
    })

  const blockHeader = (title: string, item: ConferenceItem | null, label: string | null, badge: React.ReactNode) => (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <h2 className="text-lg font-bold text-gray-900 dark:text-white">
        {title}
        {badge}
      </h2>
      {item && label ? (
        <label className="flex min-h-6 cursor-pointer items-center gap-2 text-sm font-medium">
          <Checkbox
            checked={ticks.has(item)}
            disabled={readOnly}
            onCheckedChange={(on) => toggle(item, on === true)}
          />
          {label}
        </label>
      ) : null}
    </div>
  )

  async function revealCpf() {
    if (cpf) return setCpf(null)
    setCpfError(false)
    try {
      const response = await fetch(`/api/admin/partnerships/validation/${submissionId}?reveal=cpf`, { cache: 'no-store' })
      if (!response.ok) throw new Error(String(response.status))
      setCpf(((await response.json()) as { cpf: string }).cpf)
    } catch {
      setCpfError(true)
    }
  }

  const acceptance = review.acceptance
  const lat = Number(answers.lat)
  const lng = Number(answers.lng)
  const hasPin = answers.lat !== undefined && answers.lng !== undefined && Number.isFinite(lat) && Number.isFinite(lng)
  const mapsUrl = hasPin ? `https://www.google.com/maps/search/?api=1&query=${lat},${lng}` : null
  const streetViewUrl = hasPin
    ? `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lng}`
    : null
  const hours = parseJson<Record<string, { open: string; close: string }[]>>(answers.opening_hours, {})
  const amenities = parseJson<string[]>(answers.amenities, [])
  const languages = parseJson<string[]>(answers.languages, [])
  const script = answers.story_script ?? ''
  const words = countWords(script)
  const storyOffer = storyOfferExcerpt(script, offers)
  const category = answers.category ? tForm.has(`categories.${answers.category}`) ? tForm(`categories.${answers.category}`) : answers.category : '—'
  const taxDigits = (answers.tax_id ?? '').replace(/[^0-9A-Za-z]/g, '')

  const dl = (rows: [string, React.ReactNode][]) => (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</dt>
          <dd className="break-words text-gray-900 dark:text-gray-100">{value || '—'}</dd>
        </div>
      ))}
    </dl>
  )

  return (
    <div className="space-y-5 p-6">
      <header className={`${CARD} sticky top-0 z-30 space-y-1 p-5`}>
        {back}
        <h1 className="break-words text-2xl font-bold text-gray-900 dark:text-white">{tradeName}</h1>
        <p className="text-sm text-gray-700 dark:text-gray-300">
          {t('headerLine', {
            category,
            city: answers.city ?? '—',
            state: answers.state ?? '—',
            date: formatDateTime(review.submittedAt),
          })}{' '}
          · <strong>{t(`status.${status}` as 'status.in_review')}</strong>
        </p>
      </header>

      {doneText ? (
        <div role="status" className={`${CARD} space-y-1 border-green-800 p-4 text-sm`}>
          <Line tone="ok">{doneText}</Line>
        </div>
      ) : null}

      {band ? (
        <div className={`${CARD} border-secondary-700 p-4 text-sm`}>
          <p>{band}</p>
          {status === 'changes_requested' && lastMessage('operator') ? (
            <p className="mt-2 whitespace-pre-wrap text-gray-700 dark:text-gray-300">{lastMessage('operator')?.body}</p>
          ) : null}
        </div>
      ) : resubmitted ? (
        <div className={`${CARD} space-y-2 border-primary-800 p-4 text-sm`}>
          <p className="font-medium">
            {t('bands.resubmitted', { date: formatShortDate(lastTransitionTo('in_review')?.at) })}
          </p>
          {lastMessage('operator') ? (
            <p className="whitespace-pre-wrap">
              <span className="font-medium">
                {t('bands.operatorRequest', {
                  author: operatorName(lastMessage('operator')?.actorName ?? null),
                  date: formatDateTime(lastMessage('operator')?.at),
                })}
                :{' '}
              </span>
              {lastMessage('operator')?.body}
            </p>
          ) : null}
          {lastMessage('partner') ? (
            <p className="whitespace-pre-wrap">
              <span className="font-medium">{t('bands.placeAnswer', { date: formatDateTime(lastMessage('partner')?.at) })}: </span>
              {lastMessage('partner')?.body}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-5">
          {/* 1 · Empresa */}
          <section className={`${CARD} p-6`}>
            {blockHeader(t('company.title'), 'company', t('company.check'), changed('company'))}
            <div className="mb-4 space-y-2">
              {review.sameTaxId.length === 0 ? (
                <Line tone="ok">{t('company.noDuplicate')}</Line>
              ) : (
                review.sameTaxId.map((other) => (
                  <Line key={other.id} tone="warn">
                    {t('company.duplicate', {
                      name: other.tradeName ?? t('noTradeName'),
                      state: t(`status.${other.status}` as 'status.in_review'),
                    })}{' '}
                    <Link className="underline" href={`/${locale}/admin/partnerships/validation/${other.id}`}>
                      {t('company.open')}
                    </Link>
                  </Line>
                ))
              )}
              <Line tone="warn">
                {t('company.receitaManual')}{' '}
                <a
                  className="underline"
                  href={`https://solucoes.receita.fazenda.gov.br/servicos/cnpjreva/cnpjreva_solicitacao.asp?cnpj=${taxDigits}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {t('company.openReceita')}
                </a>
              </Line>
            </div>
            {dl([
              [t('company.legalName'), answers.legal_name],
              [t('company.taxId'), answers.tax_id],
              [t('company.tradeName'), answers.trade_name],
              [t('company.category'), category],
              [t('company.priceRange'), answers.price_range ? '$'.repeat(Number(answers.price_range) || 0) : null],
              [
                t('company.representative'),
                [answers.representative_name, answers.representative_role].filter(Boolean).join(' · '),
              ],
              [
                t('company.phone'),
                answers.representative_phone ? (
                  <a className="underline" href={`tel:+${answers.representative_phone.replace(/\D/g, '')}`}>
                    {answers.representative_phone}
                  </a>
                ) : null,
              ],
              [t('company.email'), acceptance?.email],
            ])}
            <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
              <span className="text-xs font-medium uppercase tracking-wide text-gray-500">{t('company.cpf')}</span>
              <span className="font-mono">
                {cpf ? formatCpf(cpf) : (acceptance?.signerCpfMasked ?? answers.representative_cpf ?? '—')}
              </span>
              {acceptance ? (
                <Button variant="ghost" size="sm" aria-pressed={cpf !== null} onClick={() => void revealCpf()}>
                  {cpf ? <EyeOff className="mr-1 h-4 w-4" aria-hidden="true" /> : <Eye className="mr-1 h-4 w-4" aria-hidden="true" />}
                  {cpf ? t('company.hideCpf') : t('company.showCpf')}
                </Button>
              ) : null}
              {cpfError ? <span role="alert" className="text-destructive">{t('company.cpfError')}</span> : null}
            </div>
            {acceptance?.cpfDiffers ? (
              <div className="mt-2">
                <Line tone="warn">{t('company.cpfDiffers')}</Line>
              </div>
            ) : null}
          </section>

          {/* 2 · Local */}
          <section className={`${CARD} p-6`}>
            {blockHeader(t('place.title'), 'place', t('place.check'), changed('place', 'facade'))}
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <div>
                <p className="mb-1 text-xs font-medium text-gray-600">{t('place.map')}</p>
                <div className="h-60 overflow-hidden rounded-xl bg-gray-100 dark:bg-gray-800">
                  {hasPin ? (
                    <GoogleMapComponent
                      center={{ lat, lng }}
                      zoom={18}
                      height="240px"
                      markers={[{ id: 'pin', position: { lat, lng }, title: tradeName }]}
                    />
                  ) : (
                    <p className="p-4 text-sm">{t('place.noPin')}</p>
                  )}
                </div>
              </div>
              <div>
                <p className="mb-1 text-xs font-medium text-gray-600">{t('place.streetView')}</p>
                <div className="flex h-60 flex-col items-center justify-center gap-2 rounded-xl bg-gray-100 p-4 text-center text-sm dark:bg-gray-800">
                  {streetViewUrl ? (
                    <>
                      <p>{t('place.streetViewHint')}</p>
                      <a className="inline-flex items-center gap-1 underline" href={streetViewUrl} target="_blank" rel="noreferrer">
                        {t('place.openStreetView')}
                        <ExternalLink className="h-3 w-3" aria-hidden="true" />
                      </a>
                    </>
                  ) : (
                    <p>{t('place.noPin')}</p>
                  )}
                </div>
              </div>
              <div>
                <p className="mb-1 text-xs font-medium text-gray-600">{t('place.facade')}</p>
                <div className="flex h-60 items-center justify-center rounded-xl bg-gray-100 p-4 text-center text-sm dark:bg-gray-800">
                  {t('place.noFacade')}
                </div>
              </div>
            </div>
            <p className="mt-3 break-words text-sm text-gray-800 dark:text-gray-200">
              {[
                [answers.address, answers.address_number].filter(Boolean).join(', '),
                answers.district,
                [answers.city, answers.state].filter(Boolean).join('/'),
                answers.postal_code ? t('place.postalCode', { value: answers.postal_code }) : null,
              ]
                .filter(Boolean)
                .join(' · ')}
              {mapsUrl ? (
                <>
                  {' · '}
                  <a className="underline" href={mapsUrl} target="_blank" rel="noreferrer">
                    {t('place.openMaps')}
                  </a>
                </>
              ) : null}
            </p>
            <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">{t('place.hint')}</p>
            <div className="mt-4">
              {dl([
                [
                  t('place.hours'),
                  Object.keys(hours).length === 0
                    ? t('place.notInformed')
                    : DAYS.map((day) => (
                        <span key={day} className="block">
                          {t(`days.${day}`)}:{' '}
                          {hours[day]?.length
                            ? hours[day].map((range) => `${range.open}–${range.close}`).join(', ')
                            : t('place.closed')}
                        </span>
                      )),
                ],
                [t('place.whatsapp'), answers.whatsapp],
                [t('place.instagram'), answers.instagram],
                [t('place.website'), answers.website],
                [
                  t('place.amenities'),
                  amenities
                    .map((id) => (t.has(`amenityLabels.${id}`) ? t(`amenityLabels.${id}`) : id))
                    .join(', '),
                ],
                [
                  t('place.languages'),
                  languages
                    .map((id) => (t.has(`languageLabels.${id}`) ? t(`languageLabels.${id}`) : id))
                    .join(', '),
                ],
              ])}
            </div>
          </section>

          {/* 3 · História */}
          {paid ? (
            <section className={`${CARD} p-6`}>
              {blockHeader(t('story.title'), 'story', t('story.check'), changed('story'))}
              <div className="space-y-2 rounded-xl bg-gray-50 p-4 text-sm dark:bg-gray-800">
                <p className="font-medium">{t('story.told')}</p>
                {dl([
                  [t('story.founder'), answers.story_founder],
                  [t('story.unique'), answers.story_unique],
                  [t('story.event'), answers.story_event],
                  [t('story.signature'), answers.signature_item],
                ])}
              </div>
              <p className="mt-4 text-xs font-medium uppercase tracking-wide text-gray-500">{t('story.script')}</p>
              {script ? (
                <p className="mt-1 whitespace-pre-wrap text-base leading-relaxed text-gray-900 dark:text-gray-100">{script}</p>
              ) : (
                <p className="mt-1 text-sm">{t('story.noScript')}</p>
              )}
              <div className="mt-2 space-y-1">
                <p className={`text-sm ${words > STORY_WORD_LIMIT ? 'text-destructive' : 'text-gray-700 dark:text-gray-300'}`}>
                  {t('story.words', { count: words, limit: STORY_WORD_LIMIT })}
                  {words > STORY_WORD_LIMIT ? ` ${t('story.tooLong', { limit: STORY_WORD_LIMIT })}` : null}
                </p>
                {storyOffer ? <Line tone="warn">{t('story.offer', { excerpt: storyOffer })}</Line> : null}
              </div>
            </section>
          ) : (
            <p className="px-2 text-sm text-gray-600 dark:text-gray-400">{t('story.freePlan')}</p>
          )}

          {/* 4 · Ofertas */}
          {offers.length > 0 ? (
            <section className={`${CARD} p-6`}>
              {blockHeader(t('offers.title'), 'offers', t('offers.check'), changed('offers'))}
              <p className="-mt-2 mb-4 text-xs text-gray-600 dark:text-gray-400">{t('offers.rule')}</p>
              <div className="space-y-3 text-sm">
                {(
                  [
                    ['free', answers.offer_free],
                    ['subscriber', answers.offer_subscriber],
                  ] as const
                ).map(([kind, text]) =>
                  text ? (
                    <div key={kind}>
                      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{t(`offers.${kind}`)}</p>
                      <p className="break-words text-gray-900 dark:text-gray-100">{text}</p>
                      {offerLooksLikeTuggiOrMoney(text) ? <Line tone="warn">{t('offers.warning')}</Line> : null}
                    </div>
                  ) : null
                )}
              </div>
            </section>
          ) : null}

          {/* 5 · Fotos — the portal does not send photos yet (contract §8.1 has no key). */}
          <p className="px-2 text-sm text-gray-600 dark:text-gray-400">{t('photos.none')}</p>

          {/* Aceite */}
          <section className={`${CARD} p-6`}>
            <h2 className="mb-3 text-lg font-bold text-gray-900 dark:text-white">{t('acceptance.title')}</h2>
            {acceptance ? (
              <ul className="space-y-1 text-sm">
                <li>
                  {t('acceptance.terms', { version: acceptance.termsVersion, date: formatDateTime(acceptance.acceptedAt) })}
                </li>
                <li className="flex flex-wrap items-center gap-2">
                  <span className="font-mono">{t('acceptance.hash', { hash: acceptance.termsHash.slice(0, 12) })}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      void navigator.clipboard?.writeText(acceptance.termsHash).then(() => setCopied(true))
                    }}
                  >
                    {t('acceptance.copyHash')}
                  </Button>
                  {copied ? <span role="status">{t('acceptance.copied')}</span> : null}
                </li>
                <li>
                  {t('acceptance.login', {
                    method: acceptance.authMethod === 'otp' ? t('acceptance.methodOtp') : t('acceptance.methodLink'),
                  })}
                </li>
                {acceptance.legalStatusDeclared ? (
                  <li>
                    <Line tone="ok">{t('acceptance.declared')}</Line>
                  </li>
                ) : null}
                <li>
                  {(() => {
                    const marked = (['sticker', 'display', 'social'] as const).filter(
                      (key) => acceptance.activationCommitment[key]
                    )
                    return marked.length
                      ? t('acceptance.commitment', { items: marked.map((key) => t(`acceptance.${key}`)).join(', ') })
                      : t('acceptance.commitmentNone')
                  })()}
                </li>
                <li>
                  {t('acceptance.marketing', {
                    value: acceptance.marketingConsent ? t('acceptance.yes') : t('acceptance.no'),
                  })}
                </li>
              </ul>
            ) : (
              <Line tone="warn">{t('acceptance.missing')}</Line>
            )}
          </section>

          {/* Histórico */}
          <section className={`${CARD} p-6`}>
            <h2 className="mb-3 text-lg font-bold text-gray-900 dark:text-white">{t('history.title')}</h2>
            {review.history.length === 0 ? (
              <p className="text-sm">{t('history.empty')}</p>
            ) : (
              <ol className="space-y-2 text-sm">
                {review.history.map((entry, index) => {
                  const kind = entry.kind === 'transition' ? entry.actorKind : entry.authorKind
                  const actor =
                    kind === 'operator'
                      ? entry.actorName
                        ? t('history.operator', { name: entry.actorName })
                        : t('history.operatorUnnamed')
                      : kind === 'partner'
                        ? t('history.place')
                        : t('history.system')
                  const head =
                    entry.kind === 'transition'
                      ? t('history.transition', {
                          date: formatDateTime(entry.at),
                          from: t(`status.${entry.from}` as 'status.in_review'),
                          to: t(`status.${entry.to}` as 'status.in_review'),
                          actor,
                        })
                      : t('history.message', { date: formatDateTime(entry.at), actor })
                  const body = entry.kind === 'transition' ? entry.note : entry.body
                  return (
                    <li key={index}>
                      {body ? (
                        <details>
                          <summary className="cursor-pointer">{head}</summary>
                          <p className="mt-1 whitespace-pre-wrap pl-4 text-gray-700 dark:text-gray-300">{body}</p>
                        </details>
                      ) : (
                        <p>{head}</p>
                      )}
                    </li>
                  )
                })}
              </ol>
            )}
          </section>
        </div>

        <div>
          <ValidationDecision
            review={review}
            tradeName={tradeName}
            locale={locale}
            done={done}
            total={items.length}
            readOnly={readOnly}
            decided={decided}
            onDecided={onDecided}
            onConflict={() => void fetchReview()}
            nextRef={nextRef}
          />
        </div>
      </div>
    </div>
  )
}
