'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { AlertCircle, CheckCircle2, WifiOff } from 'lucide-react'
import { useTranslations } from 'next-intl'
import {
  DOCUMENT_MAX_BYTES,
  DOCUMENT_MAX_MB,
  PARTNER_DOCUMENT_KINDS,
  PARTNER_FORM_STEP_COUNT,
  fieldsOfStep,
  partnerField,
  type PartnerDocumentKind,
  type PartnerField,
  type PartnerFieldId,
} from '@/lib/partner-form/fields'
import {
  storyNudge,
  validateAnswers,
  problemsOfStep,
  type FieldProblem,
  type PartnerAnswers,
} from '@/lib/partner-form/schema'
import { PARTNER_PRIVACY_POLICY_URL } from '@/lib/partner-form/link'
import { clearMirror, mirrorKey, readMirror, writeMirror } from '@/lib/partner-form/draft-mirror'
import { PartnerFormField, errorMessage } from './PartnerFormField'
import { DocumentUploader, formatBytes, type UploadedDocument } from './DocumentUploader'
import { BUTTON_PRIMARY, BUTTON_QUIET, BUTTON_SECONDARY, CARD, PAGE_SHELL } from './styles'

/**
 * The external partner form (#341) — five steps, one subject each.
 *
 * The order is deliberate: what makes the person leave the counter to find paper is LAST,
 * when everything else is already saved. And nothing in step 4 blocks the submission —
 * BR-B2B-022 makes the licence and the incorporation document a condition to SIGN THE
 * CONTRACT, not to send this form; the gate is applied at the team's conference, where
 * BR-B2B-026 item 4 puts it.
 *
 * There is no disabled submit button. Validation happens on the click and focus moves to
 * the error summary: a disabled button takes no focus and explains nothing.
 */

type LinkState = 'loading' | 'valid' | 'invalid' | 'expired' | 'used' | 'revoked'

interface LoadedInvite {
  recipientName: string | null
  recipientEmail: string
  tradeName: string | null
}

interface PartnerFormProps {
  token: string
}

const STORY_FIELDS: PartnerFieldId[] = ['story_founder', 'story_before', 'story_unique', 'story_event']

export function PartnerForm({ token }: PartnerFormProps) {
  const t = useTranslations('PartnerForm')

  const [linkState, setLinkState] = useState<LinkState>('loading')
  const [usedAt, setUsedAt] = useState<string | null>(null)
  const [invite, setInvite] = useState<LoadedInvite | null>(null)
  const [answers, setAnswers] = useState<PartnerAnswers>({})
  const [documents, setDocuments] = useState<UploadedDocument[]>([])
  const [step, setStep] = useState(1)
  const [problems, setProblems] = useState<FieldProblem[]>([])
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [resumedAt, setResumedAt] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitFailed, setSubmitFailed] = useState(false)
  const [submitted, setSubmitted] = useState<{ isPartial: boolean; missing: PartnerDocumentKind[] } | null>(null)

  const summaryRef = useRef<HTMLDivElement>(null)
  const storageKey = mirrorKey(token)

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/partner-form/${encodeURIComponent(token)}`)
      const payload = await response.json()

      if (!response.ok) {
        // A link that is used, expired or invalid will never be filled again, so the copy
        // of the answers on this device has no reason left to exist.
        clearMirror(storageKey)
        setUsedAt(payload?.usedAt ?? null)
        setLinkState(payload?.state === 'used' ? 'used' : payload?.state === 'expired' ? 'expired' : 'invalid')
        return
      }

      const mirrored = readMirror(storageKey)
      // The server's copy wins on conflict — it is the one the team will read. The local
      // mirror only fills what the server never received, which is exactly what an
      // offline stretch produces.
      setAnswers({ ...mirrored, ...(payload.answers ?? {}) })
      setDocuments(payload.documents ?? [])
      setInvite(payload.invite ?? null)
      setSavedAt(payload.savedAt ?? null)
      setResumedAt(payload.savedAt ?? null)
      setLinkState('valid')
    } catch {
      setLinkState('invalid')
    }
  }, [storageKey, token])

  useEffect(() => {
    void load()
  }, [load])

  // `useSyncExternalStore` and not an effect that calls setState: connectivity is an
  // external store, and reading it this way also gives the server snapshot (`true`) that
  // keeps the first paint free of an offline banner that would be wrong.
  const online = useSyncExternalStore(subscribeToConnectivity, () => navigator.onLine, () => true)

  const setAnswer = useCallback(
    (id: PartnerFieldId, value: string) => {
      setAnswers((current) => {
        const next = { ...current, [id]: value }
        writeMirror(storageKey, next)
        return next
      })
      setProblems((current) => current.filter((problem) => problem.field !== id))
    },
    [storageKey]
  )

  const missingDocuments = useMemo(
    () => PARTNER_DOCUMENT_KINDS.filter((kind) => !documents.some((document) => document.kind === kind)),
    [documents]
  )

  const allProblems = useMemo(
    () =>
      validateAnswers(answers, {
        hasBusinessLicenseFile: !missingDocuments.includes('business_license'),
      }),
    [answers, missingDocuments]
  )

  async function persistDraft(next: PartnerAnswers) {
    try {
      const response = await fetch(`/api/partner-form/${encodeURIComponent(token)}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ answers: next }),
      })
      if (response.ok) {
        const payload = await response.json()
        setSavedAt(payload.savedAt ?? new Date().toISOString())
      }
    } catch {
      // Autosave is never modal and never blocks. The offline banner already says what
      // is happening, and the local mirror already holds the answers.
    }
  }

  function goToStep(next: number) {
    setResumedAt(null)
    setStep(next)
    void persistDraft(answers)
    window.scrollTo({ top: 0 })
  }

  function handleContinue() {
    const stepProblems = problemsOfStep(allProblems, step as PartnerField['step'])
    if (stepProblems.length > 0) {
      setProblems(stepProblems)
      // The summary takes focus so a screen reader hears what is missing instead of the
      // page silently refusing to advance.
      window.requestAnimationFrame(() => summaryRef.current?.focus())
      return
    }
    setProblems([])
    goToStep(Math.min(step + 1, PARTNER_FORM_STEP_COUNT))
  }

  async function handleSubmit() {
    const remaining = allProblems
    if (remaining.length > 0) {
      setProblems(remaining)
      const firstStep = partnerField(remaining[0].field).step
      setStep(firstStep)
      window.requestAnimationFrame(() => summaryRef.current?.focus())
      return
    }

    setSubmitting(true)
    setSubmitFailed(false)
    try {
      const response = await fetch(`/api/partner-form/${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ answers }),
      })
      const payload = await response.json()

      if (response.status === 409 || payload?.state === 'used') {
        setLinkState('used')
        return
      }
      if (!response.ok) {
        setSubmitFailed(true)
        return
      }

      clearMirror(storageKey)
      setSubmitted({ isPartial: Boolean(payload.isPartial), missing: payload.missingDocuments ?? [] })
    } catch {
      setSubmitFailed(true)
    } finally {
      setSubmitting(false)
    }
  }

  async function uploadDocument(
    kind: PartnerDocumentKind,
    file: File,
    onProgress: (percent: number) => void
  ): Promise<{ ok: true; document: UploadedDocument } | { ok: false; message: string }> {
    // Refused here, before a byte leaves the phone. Not an optimisation: the platform cuts
    // any request body over 4.5 MB before the route runs and answers HTML, which arrives
    // below as an unparseable payload and would degrade into the generic "não terminou de
    // subir". The person needs to know the file is too big and what to do — and on 4G, not
    // after spending the upload. `DOCUMENT_MAX_BYTES` carries the ceiling and the source.
    if (file.size > DOCUMENT_MAX_BYTES) {
      return { ok: false, message: uploadErrorMessage('file_too_large', file) }
    }

    const body = new FormData()
    body.append('kind', kind)
    body.append('file', file)

    // XHR and not fetch: `fetch` has no upload progress event, and DS-COMPONENTE-016
    // item 5 requires the percentage as text.
    return new Promise((resolve) => {
      const request = new XMLHttpRequest()
      request.open('POST', `/api/partner-form/${encodeURIComponent(token)}/documents`)
      request.upload.addEventListener('progress', (event) => {
        if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100))
      })
      request.addEventListener('load', () => {
        let payload: any = null
        try {
          payload = JSON.parse(request.responseText)
        } catch {
          payload = null
        }

        if (request.status >= 200 && request.status < 300 && payload?.id) {
          const uploaded: UploadedDocument = {
            id: payload.id,
            kind,
            fileName: payload.fileName ?? file.name,
            byteSize: payload.byteSize ?? file.size,
          }
          setDocuments((current) => [...current, uploaded])
          resolve({ ok: true, document: uploaded })
          return
        }

        // A 413 without a JSON envelope is the platform's own refusal, and it means
        // exactly one thing.
        const code = payload?.error ?? (request.status === 413 ? 'file_too_large' : undefined)
        resolve({ ok: false, message: uploadErrorMessage(code, file) })
      })
      request.addEventListener('error', () => resolve({ ok: false, message: t('errors.upload_failed') }))
      request.send(body)
    })
  }

  function uploadErrorMessage(code: string | undefined, file: File): string {
    if (code === 'file_too_large') {
      return t('errors.file_too_large', {
        size: (file.size / (1024 * 1024)).toFixed(1),
        max: DOCUMENT_MAX_MB,
      })
    }
    if (code === 'file_type_refused') {
      const extension = file.name.includes('.') ? `.${file.name.split('.').pop()}` : file.type
      return t('errors.file_type_refused', { ext: extension })
    }
    return t('errors.upload_failed')
  }

  async function removeDocument(documentId: string): Promise<boolean> {
    try {
      const response = await fetch(
        `/api/partner-form/${encodeURIComponent(token)}/documents?id=${encodeURIComponent(documentId)}`,
        { method: 'DELETE' }
      )
      if (!response.ok) return false
      setDocuments((current) => current.filter((document) => document.id !== documentId))
      return true
    } catch {
      return false
    }
  }

  if (linkState === 'loading') return <Skeleton />
  if (linkState === 'invalid' || linkState === 'revoked') {
    return <ClosedLink title={t('states.invalidTitle')} body={t('states.invalidBody')} />
  }
  if (linkState === 'expired') {
    return <ClosedLink title={t('states.expiredTitle')} body={t('states.expiredBody')} />
  }
  if (linkState === 'used') {
    // The link is single use because it can leak: this screen carries the date and the
    // instruction, and never what was submitted.
    return (
      <ClosedLink
        title={t('states.usedTitle', { date: formatDate(usedAt) })}
        body={t('states.usedBody')}
      />
    )
  }

  if (submitted) {
    return (
      <main className={PAGE_SHELL}>
        <div className={CARD}>
          <h1 className="flex items-center gap-2 text-2xl font-semibold text-gray-900">
            <CheckCircle2 className="h-6 w-6 text-primary-800" aria-hidden="true" />
            {t('states.successTitle')}
          </h1>
          {submitted.isPartial ? (
            <>
              <p className="mt-4 text-base text-gray-900">
                {t('states.successPartialMissing', {
                  missing: submitted.missing.map((kind) => t(`documents.${kind}.label`)).join(', '),
                })}
              </p>
              <p className="mt-2 text-base text-gray-900">{t('states.successPartialBody')}</p>
              <p className="mt-2 text-base text-gray-900">
                {t('states.successPartialContact', { email: invite?.recipientEmail ?? '' })}
              </p>
            </>
          ) : (
            <p className="mt-4 text-base text-gray-900">
              {t('states.successCompleteBody', { email: invite?.recipientEmail ?? '' })}
            </p>
          )}
        </div>
      </main>
    )
  }

  const stepProblems = problems

  return (
    <main className={PAGE_SHELL}>
      {!online ? (
        <div className="mb-4 flex items-start gap-2 rounded-md border border-input bg-gray-50 p-3">
          <WifiOff className="mt-0.5 h-5 w-5 shrink-0 text-gray-700" aria-hidden="true" />
          <p className="text-base text-gray-900">
            <strong>{t('states.offlineTitle')}</strong> {t('states.offlineBody')}
          </p>
        </div>
      ) : null}

      <header className="mb-6">
        <p className="text-sm font-medium text-gray-700">
          {/* Text as well as bar: state is never conveyed by length alone (DS-A11Y-003). */}
          {t('progress', { current: step, total: PARTNER_FORM_STEP_COUNT })}
        </p>
        <div
          role="progressbar"
          aria-valuenow={step}
          aria-valuemin={1}
          aria-valuemax={PARTNER_FORM_STEP_COUNT}
          aria-label={t('progress', { current: step, total: PARTNER_FORM_STEP_COUNT })}
          className="mt-2 h-2 w-full rounded bg-gray-200"
        >
          <span
            className="block h-2 rounded bg-primary-800"
            style={{ width: `${(step / PARTNER_FORM_STEP_COUNT) * 100}%` }}
          />
        </div>
        {savedAt ? (
          <p role="status" className="mt-2 text-sm text-gray-700">
            {t('saved')}
          </p>
        ) : null}
      </header>

      {resumedAt && step === 1 ? (
        <div className="mb-6 rounded-md border border-input bg-gray-50 p-3">
          <p className="text-base text-gray-900">
            {t('states.draftResumed', { date: formatDate(resumedAt) })}
          </p>
          <button
            type="button"
            className={`${BUTTON_QUIET} mt-2`}
            onClick={() => {
              if (!window.confirm(t('actions.restartConfirm'))) return
              setAnswers({})
              clearMirror(storageKey)
              setResumedAt(null)
              void persistDraft({})
            }}
          >
            {t('actions.restart')}
          </button>
        </div>
      ) : null}

      <div
        ref={summaryRef}
        tabIndex={-1}
        role={stepProblems.length > 0 ? 'alert' : undefined}
        className={stepProblems.length > 0 ? 'mb-6 rounded-md border border-destructive p-3' : 'sr-only'}
      >
        {stepProblems.length > 0 ? (
          <>
            <p className="flex items-center gap-2 text-base font-semibold text-destructive">
              <AlertCircle className="h-5 w-5" aria-hidden="true" />
              {t('errors.summary', { count: stepProblems.length })}
            </p>
            <ul className="mt-2 list-disc pl-5">
              {stepProblems.map((problem) => (
                <li key={problem.field}>
                  <a href={`#partner-field-${problem.field}`} className="text-base text-destructive underline">
                    {errorMessage(t, partnerField(problem.field), problem, answers[problem.field] ?? '')}
                  </a>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </div>

      <div className={CARD}>
        {step <= 4 ? (
          <>
            <h1 className="text-2xl font-semibold text-gray-900">{t(`step${step}.title`)}</h1>
            <p className="mt-2 text-base text-gray-700">{t(`step${step}.subtitle`)}</p>
          </>
        ) : null}

        {step === 1 ? renderFields(1) : null}

        {step === 2 ? (
          <>
            {renderFields(2)}
            <div className="mt-2 rounded-md border border-input bg-gray-50 p-3">
              <p className="text-sm text-gray-900">{t('privacy.notice')}</p>
              <p className="mt-2 text-sm">
                {/* The destination does not exist yet: BR-USUARIO-028 ties the field to
                    the published policy, and that policy is #344. Until it has a URL the
                    label renders as text — the slot is ready and the form is not
                    publishable without it. */}
                {PARTNER_PRIVACY_POLICY_URL ? (
                  <a
                    className="font-semibold text-primary-800 underline"
                    href={PARTNER_PRIVACY_POLICY_URL}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {t('privacy.link')}
                  </a>
                ) : (
                  <span className="font-semibold text-gray-900">{t('privacy.link')}</span>
                )}
              </p>
            </div>
          </>
        ) : null}

        {step === 3 ? (
          <>
            <p className="mt-4 text-base text-gray-900">{t('step3.intro')}</p>
            <p className="mt-4 rounded-md border border-input bg-gray-50 p-3 text-base text-gray-900">
              {t('step3.notHere')}
            </p>
            <details className="mt-4">
              <summary className={`${BUTTON_QUIET} cursor-pointer list-none`}>
                {t('actions.seeExample')}
              </summary>
              <div className="mt-3 space-y-3 text-base text-gray-900">
                <p>
                  <strong>{t('step3.exampleBadTitle')}</strong> <em>{t('step3.exampleBad')}</em>
                </p>
                <p className="text-gray-700">{t('step3.exampleBadWhy')}</p>
                <p>
                  <strong>{t('step3.exampleGoodTitle')}</strong> <em>{t('step3.exampleGood')}</em>
                </p>
                <p className="text-gray-700">{t('step3.exampleGoodWhy')}</p>
                <p>
                  <strong>{t('step3.exampleInnTitle')}</strong> <em>{t('step3.exampleInn')}</em>
                </p>
              </div>
            </details>
            <div className="mt-6">{renderFields(3)}</div>
            <p className="text-base text-gray-900">
              <strong>{t('step3.substituteTestTitle')}</strong> {t('step3.substituteTest')}
            </p>
            <p className="mt-4 text-base text-gray-700">{t('step3.curation')}</p>
          </>
        ) : null}

        {step === 4 ? (
          <div className="mt-6">
            {PARTNER_DOCUMENT_KINDS.map((kind) => (
              <React.Fragment key={kind}>
                <DocumentUploader
                  kind={kind}
                  documents={documents.filter((document) => document.kind === kind)}
                  onUpload={uploadDocument}
                  onRemove={removeDocument}
                />
                {kind === 'business_license' && documents.some((d) => d.kind === 'business_license')
                  ? renderFields(4)
                  : null}
              </React.Fragment>
            ))}
            <p className="text-base text-gray-700">{t('step4.skipHelp')}</p>
            <button type="button" className={`${BUTTON_SECONDARY} mt-3`} onClick={() => goToStep(5)}>
              {t('step4.skip')}
            </button>
          </div>
        ) : null}

        {step === 5 ? (
          <>
            <h1 className="text-2xl font-semibold text-gray-900">{t('step5.title')}</h1>
            <p className="mt-2 text-base text-gray-700">{t('step5.subtitle')}</p>
            {[1, 2, 3].map((reviewStep) => (
              <section key={reviewStep} className="mt-6 border-t border-input pt-4">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-lg font-semibold text-gray-900">{t(`step${reviewStep}.title`)}</h2>
                  <button type="button" className={BUTTON_QUIET} onClick={() => goToStep(reviewStep)}>
                    {t('actions.edit')}
                  </button>
                </div>
                <dl className="mt-2">
                  {fieldsOfStep(reviewStep as PartnerField['step']).map((field) => (
                    <div key={field.id} className="py-1">
                      <dt className="text-sm text-gray-700">{t(`fields.${field.id}.label`)}</dt>
                      <dd className="text-base text-gray-900">
                        {answers[field.id] || <span className="text-gray-700">{t('step5.empty')}</span>}
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
            ))}
            <section className="mt-6 border-t border-input pt-4">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-lg font-semibold text-gray-900">{t('step4.title')}</h2>
                <button type="button" className={BUTTON_QUIET} onClick={() => goToStep(4)}>
                  {t('actions.edit')}
                </button>
              </div>
              <ul className="mt-2">
                {documents.map((document) => (
                  <li key={document.id} className="text-base text-gray-900">
                    {t(`documents.${document.kind}.label`)}: {document.fileName} (
                    {formatBytes(document.byteSize)})
                  </li>
                ))}
                {missingDocuments.map((kind) => (
                  <li key={kind} className="text-base text-gray-700">
                    {t(`documents.${kind}.label`)}: {t('step5.empty')}
                  </li>
                ))}
              </ul>
            </section>

            {submitFailed ? (
              <div role="alert" className="mt-6 rounded-md border border-destructive p-3">
                <p className="text-base font-semibold text-destructive">{t('states.submitErrorTitle')}</p>
                <p className="text-base text-gray-900">{t('states.submitErrorBody')}</p>
              </div>
            ) : null}
          </>
        ) : null}
      </div>

      <div className="mt-6 space-y-3">
        {step > 1 ? (
          // `Voltar` sits above and never beside: two targets side by side at 360 px get
          // mistapped.
          <button type="button" className={BUTTON_SECONDARY} onClick={() => goToStep(step - 1)}>
            {t('actions.back')}
          </button>
        ) : null}

        {step < PARTNER_FORM_STEP_COUNT ? (
          <button type="button" className={BUTTON_PRIMARY} onClick={handleContinue}>
            {t('actions.continue')}
          </button>
        ) : (
          <>
            <button
              type="button"
              className={BUTTON_PRIMARY}
              onClick={handleSubmit}
              aria-busy={submitting}
            >
              {submitting ? t('actions.submitting') : t('actions.submit')}
            </button>
            <p className="text-sm text-gray-700">{t('step5.afterSubmit')}</p>
          </>
        )}
      </div>
    </main>
  )

  function renderFields(currentStep: PartnerField['step']) {
    return fieldsOfStep(currentStep).map((field) => (
      <PartnerFormField
        key={field.id}
        field={field}
        value={answers[field.id] ?? ''}
        problem={stepProblems.find((problem) => problem.field === field.id)}
        onChange={(value) => setAnswer(field.id, value)}
        nudge={renderNudge(field)}
      />
    ))
  }

  function renderNudge(field: PartnerField) {
    if (!STORY_FIELDS.includes(field.id)) return null
    const nudge = storyNudge(answers[field.id] ?? '', { required: field.required })
    if (!nudge) return null
    return (
      // `role="status"`, never `role="alert"`: these never block the submission and never
      // say "rejected" (DS-COPY-015).
      <p role="status" className="mt-2 text-sm text-gray-700">
        {nudge === 'short' ? t('step3.nudgeShort') : t('step3.nudgeOffer')}
      </p>
    )
  }
}

function subscribeToConnectivity(onChange: () => void): () => void {
  window.addEventListener('online', onChange)
  window.addEventListener('offline', onChange)
  return () => {
    window.removeEventListener('online', onChange)
    window.removeEventListener('offline', onChange)
  }
}

function Skeleton() {
  return (
    <main className={PAGE_SHELL} aria-busy="true">
      <div className="h-2 w-full rounded bg-gray-200" />
      <div className={`${CARD} mt-6 space-y-4`}>
        <div className="h-7 w-2/3 rounded bg-gray-200" />
        <div className="h-4 w-full rounded bg-gray-100" />
        <div className="h-12 w-full rounded bg-gray-100" />
        <div className="h-12 w-full rounded bg-gray-100" />
      </div>
    </main>
  )
}

function ClosedLink({ title, body }: { title: string; body: string }) {
  return (
    <main className={PAGE_SHELL}>
      <div className={CARD}>
        <h1 className="text-2xl font-semibold text-gray-900">{title}</h1>
        <p className="mt-3 text-base text-gray-900">{body}</p>
      </div>
    </main>
  )
}

function formatDate(value: string | null): string {
  if (!value) return ''
  try {
    return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'long' }).format(new Date(value))
  } catch {
    return ''
  }
}
