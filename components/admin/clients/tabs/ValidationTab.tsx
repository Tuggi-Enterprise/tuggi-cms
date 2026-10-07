'use client'

/**
 * The Portal Locais validation as a tab of the client record (#890, spec of `design` in the card):
 * validation and client registration are one thing, and the base is the client. What was the
 * `ValidationReview` drawer (#812, #870) is here as one scroll, in the conference order
 * (`conferenceItems`, BR-B2B-048 item 4): state band · differences to the record · company ·
 * place · story · offers · photos · acceptance and plan · history.
 *
 * What the record already shows is not repeated: with a client, the `PROMOTION_MAP` columns live
 * in Perfil and Fiscal & Pagamentos, and only where the portal DIFFERS does it appear here
 * (`buildPromotionPlan`, the same engine as the proposal's promotion panel). Without a client
 * (the pre-registration, before approving) there is no other place to read them, so they stay.
 *
 * The acts (`ValidationDecision`) sit in the record header and the conference (`DecisionSummary`)
 * in the sidebar footer; `useValidationRecord` is the one state the three share. Approving still
 * calls `approvePortalSubmission` through the same route — this card moved surface, not rule.
 *
 * The operator's ticks do NOT persist: they are an attention ruler, not a record. The CPF arrives
 * masked and is fetched whole only on "Mostrar CPF"; it goes back to the mask when the tab
 * unmounts, because it only ever lived in this component's state.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  Building2,
  Check,
  CreditCard,
  Eye,
  EyeOff,
  FileSignature,
  GitCompare,
  Gift,
  History,
  Image as ImageIcon,
  MapPin,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { FIELD_GRID, RecordSection } from '@/components/admin/clients/shared/RecordSection'
import { FIELD_LABEL, ReadField } from '@/components/admin/clients/shared/EditField'
import { PortalAcceptances, PortalSubscriptions } from '@/components/admin/clients/shared/PortalRecord'
import { GoogleMapComponent } from '@/components/ui/GoogleMapComponent'
import { CARD } from '@/components/admin/partner-proposals/surface'
import { formatDateTime, formatShortDate } from '@/components/admin/partner-proposals/format'
import type { DecisionResult } from '@/components/admin/partner-proposals/ValidationDecision'
import { buildPromotionPlan } from '@/lib/partner-form/promotion'
import { placeToolHref } from '@/lib/partnerships/place-tool'
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
import type {
  ClientPortalRecord,
  PortalHistoryEntry,
  PortalSubmissionReview,
} from '@/lib/services/portal-submission-review-service'
import type { Client } from '@/types/clients'
import type { ClientEditorTab } from '@/components/admin/clients/ClientEditorModal'

type Load =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'error' }
  | { state: 'not_found' }
  | { state: 'ready'; review: PortalSubmissionReview }

/** A submission the operator still decides — the header shows its acts, not the client's. */
const SUBMISSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const UNDECIDED = ['in_review', 'changes_requested', 'awaiting_payment']

export interface ValidationRecord {
  submissionId: string | null
  load: Load
  review: PortalSubmissionReview | null
  items: readonly ConferenceItem[]
  ticks: ReadonlySet<ConferenceItem>
  toggle: (item: ConferenceItem, on: boolean) => void
  result: DecisionResult | null
  /** `approved`, `live` or `rejected`. */
  decided: boolean
  /** Only `in_review` takes a decision. */
  readOnly: boolean
  /** The submission still owns the header (`ValidationDecision` in place of `ApprovalHeaderControls`). */
  undecided: boolean
  refetch: () => Promise<void>
  onDecided: (decision: DecisionResult) => void
  /** Focus after a decision: "Ir para Locais" after approving, else "Próximo da fila". */
  primaryRef: React.MutableRefObject<HTMLElement | null>
}

/** The validation state the header, the sidebar and the tab share. `null` = no submission. */
export function useValidationRecord(submissionId: string | null): ValidationRecord {
  const [load, setLoad] = useState<Load>({ state: 'idle' })
  const [ticks, setTicks] = useState<Set<ConferenceItem>>(new Set())
  const [result, setResult] = useState<DecisionResult | null>(null)
  const primaryRef = useRef<HTMLElement | null>(null)

  const refetch = useCallback(async () => {
    if (!submissionId) return setLoad({ state: 'idle' })
    // The id comes raw from `?validation=`: anything but a UUID must not reach another admin route (security review #890).
    if (!SUBMISSION_ID.test(submissionId)) return setLoad({ state: 'not_found' })
    setLoad((current) => (current.state === 'ready' && current.review.id === submissionId ? current : { state: 'loading' }))
    try {
      const response = await fetch(`/api/admin/partnerships/validation/${submissionId}`, { cache: 'no-store' })
      if (response.status === 404 || response.status === 400) return setLoad({ state: 'not_found' })
      if (!response.ok) return setLoad({ state: 'error' })
      setLoad({ state: 'ready', review: (await response.json()) as PortalSubmissionReview })
    } catch {
      setLoad({ state: 'error' })
    }
  }, [submissionId])

  // "Próximo da fila" swaps the id: a fresh conference, not the last one's ticks.
  useEffect(() => {
    setTicks(new Set())
    setResult(null)
    setLoad({ state: submissionId ? 'loading' : 'idle' })
    void refetch()
  }, [submissionId, refetch])

  const review = load.state === 'ready' ? load.review : null
  const answers = review?.answers ?? {}
  const plan = review?.acceptance?.planChoice ?? answers.plan_choice
  const offerCount = offersOf(answers).length
  const photoCount = review?.photos.length ?? 0
  const items = useMemo(
    () => conferenceItems({ planChoice: plan, hasOffers: offerCount > 0, photoCount }),
    [plan, offerCount, photoCount]
  )

  const toggle = useCallback(
    (item: ConferenceItem, on: boolean) =>
      setTicks((current) => {
        const next = new Set(current)
        if (on) next.add(item)
        else next.delete(item)
        return next
      }),
    []
  )

  const onDecided = useCallback(
    (decision: DecisionResult) => {
      setResult(decision)
      setTicks(new Set())
      void refetch().then(() => requestAnimationFrame(() => primaryRef.current?.focus()))
    },
    [refetch]
  )

  const status = review?.status ?? ''
  return {
    submissionId,
    load,
    review,
    items,
    ticks,
    toggle,
    result,
    decided: ['approved', 'live', 'rejected'].includes(status),
    readOnly: status !== 'in_review',
    undecided: UNDECIDED.includes(status),
    refetch,
    onDecided,
    primaryRef,
  }
}

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

const ACT =
  'inline-flex min-h-[44px] items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold transition-all lg:min-h-0'
const NEUTRAL = 'border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200'
const PRIMARY = 'bg-primary-800 text-white hover:brightness-90'

interface ValidationTabProps {
  record: ValidationRecord
  locale: string
  /** The record's client as saved — `null` in the pre-registration. */
  client: Client | null
  /** `/admin/clients?…&validation=<id>`, filters kept (`recordHref`). */
  validationHref: (submissionId: string) => string
  /** The board behind the drawer — "Voltar" of a submission that does not exist. */
  boardHref: string
  /** The client's other portal submissions (`getClientPortalRecords`), current one excluded. */
  otherSubmissions: ClientPortalRecord[]
  onOpenTab: (tab: ClientEditorTab) => void
  /** `DecisionSummary` for the phone, which has no sidebar. */
  phoneSummary: React.ReactNode
}

export function ValidationTab({
  record,
  locale,
  client,
  validationHref,
  boardHref,
  otherSubmissions,
  onOpenTab,
  phoneSummary,
}: ValidationTabProps) {
  const t = useTranslations('PartnerValidation')
  const tForm = useTranslations('PartnerForm')
  const tPortal = useTranslations('Clients.portal')
  const tPromotion = useTranslations('PartnerProposals.promotion')
  const [cpf, setCpf] = useState<string | null>(null)
  const [cpfError, setCpfError] = useState(false)
  const { load, review, result, primaryRef } = record

  const back = (
    <Link href={boardHref} className="text-sm font-medium text-primary-800 underline dark:text-tuggi-blue">
      {t('back')}
    </Link>
  )

  if (load.state === 'loading' || load.state === 'idle') {
    return (
      <div className="mx-auto max-w-5xl space-y-8" aria-busy="true">
        <span className="sr-only">{t('loading')}</span>
        <div className={`${CARD} h-40 animate-pulse`} />
        <div className={`${CARD} h-80 animate-pulse`} />
        <div className={`${CARD} h-[200px] animate-pulse`} />
      </div>
    )
  }
  if (load.state === 'error') {
    return (
      <div role="alert" className={`${CARD} mx-auto max-w-5xl space-y-3 p-6`}>
        <p className="font-semibold">{t('readError')}</p>
        <Button variant="outline" onClick={() => void record.refetch()}>
          {t('retry')}
        </Button>
      </div>
    )
  }
  if (load.state === 'not_found' || !review) {
    return (
      <div className={`${CARD} mx-auto max-w-5xl space-y-3 p-6`}>
        <p className="font-semibold">{t('notFound')}</p>
        {back}
      </div>
    )
  }

  const answers = review.answers
  const tradeName = answers.trade_name || t('noTradeName')
  const status = review.status
  const decided = record.decided
  const hasClient = client !== null
  const plan = review.acceptance?.planChoice ?? answers.plan_choice
  const paid = isPaidPlan(plan)
  const offers = offersOf(answers)
  const photos = review.photos
  const facadePhoto = photos.find((p) => p.role === 'facade') ?? null

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
      <span className="inline-flex items-center rounded-full border border-primary-100 bg-primary-50 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-primary-800">
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
  // `review.clientId`, not `hasClient`: after approving a pre-registration the client loads later, and the focus must still land on "Ir para Locais" (design review #890).
  const approvedNow = result?.kind === 'approved' && Boolean(review.clientId)
  const nextHref = review.nextInReviewId ? validationHref(review.nextInReviewId) : null

  async function revealCpf() {
    if (cpf) return setCpf(null)
    setCpfError(false)
    try {
      const response = await fetch(`/api/admin/partnerships/validation/${review!.id}?reveal=cpf`, { cache: 'no-store' })
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
  const hours = parseJson<Record<string, { open: string; close: string }[]>>(answers.opening_hours, {})
  const amenities = parseJson<string[]>(answers.amenities, [])
  const languages = parseJson<string[]>(answers.languages, [])
  const script = answers.story_script ?? ''
  const words = countWords(script)
  const storyOffer = storyOfferExcerpt(script, offers)
  const categoryLabel = answers.category && tForm.has(`categories.${answers.category}`) ? tForm(`categories.${answers.category}`) : null
  const category = categoryLabel ?? answers.category ?? '—'
  const taxDigits = (answers.tax_id ?? '').replace(/[^0-9A-Za-z]/g, '')

  /*
   * THE DIFFERENCES ARE THE ONLY COPY of a `PROMOTION_MAP` field when there is a client. The
   * portal keeps its e-mail on the acceptance, not in `representative_email`; without it here a
   * different e-mail would vanish from the record instead of showing as a difference.
   */
  const promotion = client
    ? buildPromotionPlan(
        {
          ...answers,
          // display only: `joinAddress` drops the number, and the curator checks the address against the pin (design review #890)
          address: [answers.address, answers.address_number].filter(Boolean).join(', ') || undefined,
          representative_email: answers.representative_email || acceptance?.email || undefined,
        },
        client as unknown as Record<string, unknown>,
        { categoryLabel }
      )
    : null

  /** The client record's `ContractTab` reads the same pair through `ClientPortalRecord`. */
  const portalRecord: ClientPortalRecord = {
    submissionId: review.id,
    status: review.status,
    attractionId: review.attractionId ?? '',
    submittedAt: review.submittedAt,
    acceptance,
    payment: review.payment,
  }

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      {otherSubmissions.length > 0 ? (
        <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs font-semibold text-gray-600 dark:text-gray-300">
          <span>{t('otherSubmissions')}</span>
          {otherSubmissions.map((other) => (
            <Link key={other.submissionId} className="text-primary-800 underline dark:text-tuggi-blue" href={validationHref(other.submissionId)}>
              {t(`status.${other.status}` as 'status.in_review')} · {formatShortDate(other.submittedAt)}
            </Link>
          ))}
        </p>
      ) : null}

      {/* 1 · state */}
      {doneText ? (
        <div role="status" className="space-y-3 rounded-2xl border border-green-200 bg-green-50 p-4 text-sm font-semibold text-green-800 dark:border-green-800/30 dark:bg-green-900/20 dark:text-green-400">
          <p className="flex items-start gap-2">
            <Check className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {doneText}
          </p>
          {approvedNow || nextHref ? (
            <div className="flex flex-wrap gap-2">
              {approvedNow ? (
                <button
                  type="button"
                  ref={(node) => {
                    primaryRef.current = node
                  }}
                  className={cn(ACT, PRIMARY)}
                  onClick={() => onOpenTab('places')}
                >
                  <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
                  {t('done.openPlaces')}
                </button>
              ) : null}
              {nextHref ? (
                <Link
                  ref={
                    approvedNow
                      ? undefined
                      : (node) => {
                          primaryRef.current = node
                        }
                  }
                  className={cn(ACT, approvedNow ? NEUTRAL : PRIMARY)}
                  href={nextHref}
                >
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                  {t('decision.next')}
                </Link>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {band ? (
        <div
          className={cn(
            'rounded-2xl border p-4 text-sm font-semibold',
            status === 'approved' || status === 'live'
              ? 'border-green-200 bg-green-50 text-green-800 dark:border-green-800/30 dark:bg-green-900/20 dark:text-green-400'
              : status === 'rejected'
                ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-800/30 dark:bg-red-900/20 dark:text-red-400'
                : 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800/30 dark:bg-amber-900/20 dark:text-amber-300'
          )}
        >
          <p>{band}</p>
          {status === 'changes_requested' && lastMessage('operator') ? (
            <p className="mt-2 whitespace-pre-wrap font-normal">{lastMessage('operator')?.body}</p>
          ) : null}
        </div>
      ) : resubmitted ? (
        <div className="space-y-2 rounded-2xl border border-primary-100 bg-primary-50 p-4 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100">
          <p className="font-semibold">{t('bands.resubmitted', { date: formatShortDate(lastTransitionTo('in_review')?.at) })}</p>
          {lastMessage('operator') ? (
            <p className="whitespace-pre-wrap">
              <span className="font-semibold">
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
              <span className="font-semibold">{t('bands.placeAnswer', { date: formatDateTime(lastMessage('partner')?.at) })}: </span>
              {lastMessage('partner')?.body}
            </p>
          ) : null}
        </div>
      ) : null}

      {/* 2 · differences to the record — only when the record is a client's */}
      {promotion ? (
        <RecordSection icon={<GitCompare className="h-4 w-4 text-tuggi-blue" />} title={t('diff.title')}>
          {promotion.entries.length === 0 ? (
            <Line tone="ok">{t('diff.none')}</Line>
          ) : (
            <div className="space-y-3">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-[10px] font-bold uppercase tracking-widest text-gray-500">
                    <tr>
                      <th scope="col" className="px-2 py-2">{t('diff.field')}</th>
                      <th scope="col" className="px-2 py-2">{t('diff.current')}</th>
                      <th scope="col" className="px-2 py-2">{t('diff.portal')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                    {promotion.entries.map((entry) => (
                      <tr key={entry.column}>
                        <th scope="row" className="px-2 py-2 font-semibold text-gray-700 dark:text-gray-300">
                          {tPromotion(`fields.${entry.column}`)}
                        </th>
                        <td className="break-words px-2 py-2 text-gray-600 dark:text-gray-400">{entry.current || '—'}</td>
                        <td className="break-words px-2 py-2 font-semibold text-gray-900 dark:text-white">{entry.proposed}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {promotion.unchanged.length > 0 ? (
                <p className="text-xs font-semibold text-gray-600 dark:text-gray-300">
                  {t('diff.unchanged', { count: promotion.unchanged.length })}
                </p>
              ) : null}
              <p className="text-xs text-gray-500">{t('diff.hint')}</p>
            </div>
          )}
        </RecordSection>
      ) : null}

      {/* 3 · company */}
      <RecordSection icon={<Building2 className="h-4 w-4 text-tuggi-blue" />} title={t('company.title')} aside={changed('company')}>
        <div className="mb-6 space-y-2">
          {review.sameTaxId.length === 0 ? (
            <Line tone="ok">{t('company.noDuplicate')}</Line>
          ) : (
            review.sameTaxId.map((other) => (
              <Line key={other.id} tone="warn">
                {t('company.duplicate', {
                  name: other.tradeName ?? t('noTradeName'),
                  state: t(`status.${other.status}` as 'status.in_review'),
                })}{' '}
                <Link className="underline" href={validationHref(other.id)}>
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
        <div className={FIELD_GRID}>
          {hasClient ? null : (
            <>
              <ReadField label={t('company.tradeName')}>{answers.trade_name}</ReadField>
              <ReadField label={t('company.legalName')}>{answers.legal_name}</ReadField>
              <ReadField label={t('company.taxId')}>{answers.tax_id}</ReadField>
              <ReadField label={t('company.category')}>{category}</ReadField>
            </>
          )}
          <ReadField label={t('company.priceRange')}>
            {answers.price_range ? '$'.repeat(Number(answers.price_range) || 0) : null}
          </ReadField>
          {hasClient ? null : (
            <>
              <ReadField label={t('company.representative')}>
                {[answers.representative_name, answers.representative_role].filter(Boolean).join(' · ')}
              </ReadField>
              <ReadField label={t('company.phone')}>
                {answers.representative_phone ? (
                  <a className="text-tuggi-blue hover:underline" href={`tel:+${answers.representative_phone.replace(/\D/g, '')}`}>
                    {answers.representative_phone}
                  </a>
                ) : null}
              </ReadField>
              <ReadField label={t('company.email')}>{acceptance?.email}</ReadField>
            </>
          )}
          <ReadField label={t('company.cpf')} fullWidth>
            <span className="flex flex-wrap items-center gap-3">
              <span className="font-mono">
                {cpf ? formatCpf(cpf) : (acceptance?.signerCpfMasked ?? answers.representative_cpf ?? '—')}
              </span>
              {acceptance ? (
                <button
                  type="button"
                  aria-pressed={cpf !== null}
                  onClick={() => void revealCpf()}
                  className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-bold text-primary-800 hover:bg-tuggi-blue/5 dark:text-tuggi-blue"
                >
                  {cpf ? <EyeOff className="h-3.5 w-3.5" aria-hidden="true" /> : <Eye className="h-3.5 w-3.5" aria-hidden="true" />}
                  {cpf ? t('company.hideCpf') : t('company.showCpf')}
                </button>
              ) : null}
              {cpfError ? <span role="alert" className="text-xs text-destructive">{t('company.cpfError')}</span> : null}
            </span>
          </ReadField>
        </div>
        {acceptance?.cpfDiffers ? (
          <div className="mt-4">
            <Line tone="warn">{t('company.cpfDiffers')}</Line>
          </div>
        ) : null}
      </RecordSection>

      {/* 4 · place — the one way out to the place editor */}
      <RecordSection
        icon={<MapPin className="h-4 w-4 text-indigo-500" />}
        title={t('place.title')}
        color="indigo-500"
        aside={
          <span className="flex items-center gap-2">
            {review.attractionId ? (
              <Link
                className="text-xs font-bold text-primary-800 underline dark:text-tuggi-blue"
                href={placeToolHref({ locale, attractionId: review.attractionId, entityKind: 'place' })}
              >
                {t('decision.openPlace')}
              </Link>
            ) : null}
            {changed('place', 'facade')}
          </span>
        }
      >
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="space-y-1">
            <p className={FIELD_LABEL}>{t('place.map')}</p>
            <div className="h-60 overflow-hidden rounded-2xl bg-gray-50 dark:bg-gray-800">
              {hasPin ? (
                <GoogleMapComponent
                  center={{ lat, lng }}
                  zoom={18}
                  // Conference, not edition: the component draws a polygon by default.
                  enableDrawing={false}
                  showDrawingButton={false}
                  height="240px"
                  markers={[{ id: 'pin', position: { lat, lng }, title: tradeName }]}
                />
              ) : (
                <p className="p-4 text-sm">{t('place.noPin')}</p>
              )}
            </div>
          </div>
          <div className="space-y-1">
            <p className={FIELD_LABEL}>{t('place.facade')}</p>
            {facadePhoto ? (
              <a href={facadePhoto.url} target="_blank" rel="noreferrer" className="block h-60 overflow-hidden rounded-2xl bg-gray-50 dark:bg-gray-800">
                {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL of a private bucket */}
                <img src={facadePhoto.url} alt={t('place.facadeAlt', { name: tradeName })} className="h-full w-full object-cover" />
              </a>
            ) : (
              <div className="flex h-60 items-center justify-center rounded-2xl bg-gray-50 p-4 text-center text-sm dark:bg-gray-800">
                {t('place.noFacade')}
              </div>
            )}
          </div>
        </div>

        <div className={`mt-6 ${FIELD_GRID}`}>
          <ReadField label={t('place.address')} fullWidth>
            {hasClient
              ? null
              : [
                  [answers.address, answers.address_number].filter(Boolean).join(', '),
                  answers.district,
                  [answers.city, answers.state].filter(Boolean).join('/'),
                  answers.postal_code ? t('place.postalCode', { value: answers.postal_code }) : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
            {mapsUrl ? (
              <>
                {hasClient ? null : ' · '}
                <a className="text-tuggi-blue hover:underline" href={mapsUrl} target="_blank" rel="noreferrer">
                  {t('place.openMaps')}
                </a>
              </>
            ) : null}
            <span className="mt-1 block text-xs font-medium text-gray-500">{t('place.hint')}</span>
          </ReadField>
          <ReadField label={t('place.hours')}>
            {Object.keys(hours).length === 0
              ? t('place.notInformed')
              : DAYS.map((day) => (
                  <span key={day} className="block">
                    {t(`days.${day}`)}:{' '}
                    {hours[day]?.length ? hours[day].map((range) => `${range.open}–${range.close}`).join(', ') : t('place.closed')}
                  </span>
                ))}
          </ReadField>
          <div className="space-y-6">
            <ReadField label={t('place.whatsapp')}>{answers.whatsapp}</ReadField>
            {hasClient ? null : (
              <>
                <ReadField label={t('place.instagram')}>{answers.instagram}</ReadField>
                <ReadField label={t('place.website')}>{answers.website}</ReadField>
              </>
            )}
          </div>
          <ReadField label={t('place.amenities')}>
            {amenities.map((id) => (t.has(`amenityLabels.${id}`) ? t(`amenityLabels.${id}`) : id)).join(', ')}
          </ReadField>
          <ReadField label={t('place.languages')}>
            {languages.map((id) => (t.has(`languageLabels.${id}`) ? t(`languageLabels.${id}`) : id)).join(', ')}
          </ReadField>
        </div>
      </RecordSection>

      {/* 5 · story */}
      {paid ? (
        <RecordSection icon={<BookOpen className="h-4 w-4 text-purple-500" />} title={t('story.title')} color="purple-500" aside={changed('story')}>
          <p className="mb-6 text-xs leading-relaxed text-gray-500">{t('story.told')}</p>
          <div className={FIELD_GRID}>
            <ReadField label={t('story.founder')}>{answers.story_founder}</ReadField>
            <ReadField label={t('story.unique')}>{answers.story_unique}</ReadField>
            <ReadField label={t('story.event')}>{answers.story_event}</ReadField>
            <ReadField label={t('story.signature')}>{answers.signature_item}</ReadField>
            <ReadField label={t('story.script')} fullWidth>
              {script ? (
                <span className="block whitespace-pre-wrap rounded-xl bg-gray-50 p-4 text-base font-medium leading-relaxed dark:bg-gray-800">
                  {script}
                </span>
              ) : (
                t('story.noScript')
              )}
            </ReadField>
          </div>
          <div className="mt-3 space-y-1">
            <p className={`text-xs font-semibold ${words > STORY_WORD_LIMIT ? 'text-destructive' : 'text-gray-600 dark:text-gray-300'}`}>
              {t('story.words', { count: words, limit: STORY_WORD_LIMIT })}
              {words > STORY_WORD_LIMIT ? ` ${t('story.tooLong', { limit: STORY_WORD_LIMIT })}` : null}
            </p>
            {storyOffer ? <Line tone="warn">{t('story.offer', { excerpt: storyOffer })}</Line> : null}
          </div>
        </RecordSection>
      ) : (
        <RecordSection icon={<BookOpen className="h-4 w-4 text-purple-500" />} title={t('story.title')} color="purple-500">
          <p className="text-sm text-gray-600 dark:text-gray-300">{t('story.freePlan')}</p>
        </RecordSection>
      )}

      {/* 6 · offers */}
      {offers.length > 0 ? (
        <RecordSection icon={<Gift className="h-4 w-4 text-pink-500" />} title={t('offers.title')} color="pink-500" aside={changed('offers')}>
          <p className="mb-6 text-xs leading-relaxed text-gray-500">{t('offers.rule')}</p>
          <div className={FIELD_GRID}>
            {(
              [
                ['free', answers.offer_free],
                ['subscriber', answers.offer_subscriber],
              ] as const
            ).map(([kind, text]) =>
              text ? (
                <ReadField key={kind} label={t(`offers.${kind}`)}>
                  {text}
                  {offerLooksLikeTuggiOrMoney(text) ? (
                    <span className="mt-1 block font-normal">
                      <Line tone="warn">{t('offers.warning')}</Line>
                    </span>
                  ) : null}
                </ReadField>
              ) : null
            )}
          </div>
        </RecordSection>
      ) : null}

      {/* 7 · photos — capped by plan and cutoff on the server (#809, contract §8.5) */}
      <RecordSection
        icon={<ImageIcon className="h-4 w-4 text-amber-500" />}
        title={t('photos.title', { count: photos.length })}
        color="amber-500"
        aside={
          <span className="flex items-center gap-2 text-xs font-semibold text-gray-500">
            {t(paid ? 'photos.limitPaid' : 'photos.limitFree')}
            {changed('photos')}
          </span>
        }
      >
        {photos.length > 0 ? (
          <ul className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {photos.map((photo, index) => (
              <li key={photo.path} className="relative aspect-[4/3] overflow-hidden rounded-2xl bg-gray-50 dark:bg-gray-800">
                <a href={photo.url} target="_blank" rel="noreferrer" className="block h-full w-full">
                  {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL of a private bucket */}
                  <img
                    src={photo.url}
                    alt={t('photos.alt', { index: index + 1, count: photos.length, name: tradeName })}
                    className="h-full w-full object-cover"
                  />
                </a>
                {photo.role === 'facade' ? (
                  <span className="absolute left-2 top-2 rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-gray-900">
                    {t('place.facade')}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-gray-600 dark:text-gray-300">{t('photos.none')}</p>
        )}
      </RecordSection>

      {/* 8 · acceptance and plan — here until the link, in Contrato and Fiscal after it */}
      {review.clientId ? (
        <RecordSection icon={<FileSignature className="h-4 w-4 text-indigo-500" />} title={t('acceptance.title')} color="indigo-500">
          <p className="mb-4 text-sm text-gray-700 dark:text-gray-300">{t('acceptance.linked')}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={cn(ACT, NEUTRAL)} onClick={() => onOpenTab('contract')}>
              {t('acceptance.openContract')}
            </button>
            <button type="button" className={cn(ACT, NEUTRAL)} onClick={() => onOpenTab('fiscal')}>
              {t('acceptance.openFiscal')}
            </button>
          </div>
        </RecordSection>
      ) : (
        <>
          <RecordSection icon={<FileSignature className="h-4 w-4 text-indigo-500" />} title={t('acceptance.title')} color="indigo-500">
            {acceptance ? <PortalAcceptances records={[portalRecord]} /> : <Line tone="warn">{t('acceptance.missing')}</Line>}
          </RecordSection>
          {acceptance ? (
            <RecordSection icon={<CreditCard className="h-4 w-4 text-green-500" />} title={tPortal('subscription.title')} color="green-500">
              <PortalSubscriptions records={[portalRecord]} />
            </RecordSection>
          ) : null}
        </>
      )}

      {/* 9 · history */}
      <RecordSection icon={<History className="h-4 w-4 text-tuggi-blue" />} title={t('history.title')}>
        {review.history.length === 0 ? (
          <p className="text-sm text-gray-600 dark:text-gray-300">{t('history.empty')}</p>
        ) : (
          <ol className="space-y-3 text-sm font-semibold text-gray-900 dark:text-white">
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
                      <p className="mt-1 whitespace-pre-wrap pl-4 font-normal text-gray-700 dark:text-gray-300">{body}</p>
                    </details>
                  ) : (
                    <p>{head}</p>
                  )}
                </li>
              )
            })}
          </ol>
        )}
      </RecordSection>

      {/* The phone has no sidebar: the conference goes under the tab. */}
      <div className="lg:hidden">{phoneSummary}</div>
    </div>
  )
}
