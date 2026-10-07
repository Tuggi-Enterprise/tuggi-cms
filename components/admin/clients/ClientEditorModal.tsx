'use client'

/**
 * ClientEditorModal
 *
 * Drawer lateral direito (85vw) com sidebar de abas verticais — padrão
 * idêntico ao POIDetailsModal e RouteEditorModal. PR 2 entrega 2 abas
 * (Perfil + Fiscal & Pagamentos); Equipe, POIs e Cupons entram nas
 * próximas PRs como placeholders. Aprovação não é aba — vive no header
 * (badge + botões Aprovar/Rejeitar), igual ao "HOMOLOGADO/EM ANÁLISE"
 * do POIDetailsModal.
 *
 * URLs:
 *   ?mode=new                 → criar
 *   ?clientId={id}            → editar
 *   ?clientId={id}&tab=...    → deep-link para uma aba específica
 *   ?validation={id}          → validation of a portal submission, in its client's record (#890);
 *                               with no client yet (same CNPJ or linked), a pre-registration where
 *                               only the Validação tab is enabled
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import {
  Save, Loader2, Building2, Scale, Users, MapPin, Gift, AlertTriangle, Plus, Edit, Smartphone,
  FileSignature, Handshake, ClipboardCheck,
} from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { useDialogShell } from '@/lib/hooks/use-dialog-shell'
import { taxConfigFor } from '@/components/admin/clients/shared/countries'
import { ApprovalHeaderControls } from '@/components/admin/clients/shared/ApprovalHeaderControls'
import { RecordShell } from '@/components/admin/clients/shared/RecordShell'
import { RecordTabs } from '@/components/admin/clients/shared/RecordTabs'
import { ProfileTab } from '@/components/admin/clients/tabs/ProfileTab'
import { FiscalPaymentsTab } from '@/components/admin/clients/tabs/FiscalPaymentsTab'
import { TeamTab } from '@/components/admin/clients/tabs/TeamTab'
import { AppUsersTab, type AppUserLite } from '@/components/admin/clients/tabs/AppUsersTab'
import { PlacesTab } from '@/components/admin/clients/tabs/PlacesTab'
import { PartnershipTab } from '@/components/admin/clients/tabs/PartnershipTab'
import { CouponsTab } from '@/components/admin/clients/tabs/CouponsTab'
import { ContractTab } from '@/components/admin/clients/tabs/ContractTab'
import { ValidationTab, useValidationRecord } from '@/components/admin/clients/tabs/ValidationTab'
import { DecisionSummary, ValidationDecision } from '@/components/admin/partner-proposals/ValidationDecision'
import { formatDateTime } from '@/components/admin/partner-proposals/format'
import { useClientContract } from '@/components/admin/clients/shared/use-client-contract'
import type { ClientPortalRecord } from '@/lib/services/portal-submission-review-service'
import { DEFAULT_CLIENT_TYPE, DEFAULT_COMMISSION_RATE, type Client } from '@/types/clients'
import { RecordCacheProvider, type RecordRead } from '@/lib/hooks/use-record-cache'

/**
 * `places` was called `pois` while the tab was only the welcome-POI picker. It now lists the
 * places linked to the client by `partner_client_id`, and the old name described the widget
 * rather than the subject — `AdminClientsPageContent` still accepts `?tab=pois` so the links
 * already out there keep landing here.
 */
export type ClientEditorTab =
  | 'validation'
  | 'partnership'
  | 'profile'
  | 'fiscal'
  | 'contract'
  | 'team'
  | 'appusers'
  | 'places'
  | 'coupons'

interface ClientEditorModalProps {
  clientId?: string
  isOpen: boolean
  mode: 'edit' | 'new'
  initialTab?: ClientEditorTab
  onClose: () => void
  /** Called after a successful create — receives the saved id so the host can update the URL. */
  onSaved?: (clientId: string) => void
  /** `?validation=` — the portal submission the record opens on (#890). */
  validationId?: string
  /** `/admin/clients?…&validation=<id>` with the board's filters (`recordHref`). */
  validationHref?: (submissionId: string) => string
  /** The board behind the drawer, with locale. */
  boardHref?: string
}

/**
 * The client's portal submissions, read through the record cache `ContractTab` and `FiscalPaymentsTab`
 * already share — mounted inside the provider and rendering nothing, so the modal learns which
 * submission the Validação tab shows without a second read of `/contract`.
 */
function PortalSubmissionsReader({
  clientId,
  onRead,
}: {
  clientId?: string
  onRead: (records: ClientPortalRecord[]) => void
}) {
  const { summary } = useClientContract(clientId)
  useEffect(() => {
    onRead(summary?.portal ?? [])
  }, [summary, onRead])
  return null
}

interface TabDef { id: ClientEditorTab; labelKey: string; icon: typeof Building2 }
const TABS: TabDef[] = [
  // Only when there is a portal submission (#890): the operator's queue work, before the pipeline.
  { id: 'validation', labelKey: 'validation', icon: ClipboardCheck },
  // First because it is the work: the five states of the pipeline, in the record that owns
  // them. It is the same `PartnershipDetail` the standalone page renders, so the two cannot
  // disagree about a state.
  { id: 'partnership', labelKey: 'partnership', icon: Handshake },
  { id: 'profile', labelKey: 'profile', icon: Building2 },
  { id: 'fiscal', labelKey: 'fiscal', icon: Scale },
  // Summary only: the contract has its own route (#342). A long document with an audit
  // trail does not fit in a modal, but its STATE has to be where the team already looks.
  { id: 'contract', labelKey: 'contract', icon: FileSignature },
  { id: 'team', labelKey: 'team', icon: Users },
  { id: 'appusers', labelKey: 'appusers', icon: Smartphone },
  { id: 'places', labelKey: 'places', icon: MapPin },
  { id: 'coupons', labelKey: 'coupons', icon: Gift },
]

export function ClientEditorModal({
  clientId: clientIdProp,
  isOpen,
  mode,
  initialTab = 'profile',
  onClose,
  onSaved,
  validationId,
  validationHref = (id) => `?validation=${id}`,
  boardHref = '/admin/clients',
}: ClientEditorModalProps) {
  const t = useTranslations('Clients.editor')
  const titleId = useId()
  /** Focus lands on `Fechar` and not on a field — a phone would raise the keyboard over the record. */
  const closeRef = useDialogShell(isOpen, onClose) as React.RefObject<HTMLButtonElement | null>
  const tTabs = useTranslations('Clients.editor.tabs')
  const tValidation = useTranslations('PartnerValidation')
  const tForm = useTranslations('PartnerForm')
  const locale = useLocale()

  /*
   * THE VALIDATION DECIDES WHOSE RECORD THIS IS when it opened by `?validation=`: the client the
   * place is linked to, else the one with the same CNPJ (`recordClientId`). Neither → the
   * pre-registration. Opened by `?clientId=`, the tab shows the URL's submission or the newest.
   */
  const [portalRecords, setPortalRecords] = useState<ClientPortalRecord[]>([])
  const newestSubmission = useMemo(
    () =>
      [...portalRecords].sort((a, b) => String(b.submittedAt ?? '').localeCompare(String(a.submittedAt ?? '')))[0]
        ?.submissionId ?? null,
    [portalRecords]
  )
  // A closed drawer or another record must not keep the last client's submissions alive.
  useEffect(() => setPortalRecords([]), [clientIdProp, validationId, isOpen])
  const validation = useValidationRecord(validationId ?? newestSubmission)
  const clientId = clientIdProp ?? validation.review?.recordClientId ?? undefined
  const preRegistration = Boolean(validationId) && !clientId
  const isEditing = (mode === 'edit' || Boolean(validationId)) && Boolean(clientId)
  const [activeTab, setActiveTab] = useState<ClientEditorTab>(initialTab)
  const [client, setClient] = useState<Client | null>(null)
  const [edited, setEdited] = useState<Partial<Client>>({})
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  // App users staged for linking while creating a new client (no id yet).
  const [stagedAppUsers, setStagedAppUsers] = useState<AppUserLite[]>([])

  // AbortController so that switching clients mid-fetch doesn't paint
  // the old client's data into the new client's modal.
  const fetchAbortRef = useRef<AbortController | null>(null)

  /**
   * The reads the tabs share, one cache per open record (#875). A save or an approval can change
   * what the partnership and the contract answer, so both drop it; the next tab to mount re-reads.
   */
  const recordCache = useMemo(
    () => new Map<string, Promise<RecordRead>>(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [clientId, isOpen]
  )

  // Sync the active tab with the URL `?tab=` whenever it changes. The
  // previous effect read initialTab once on open and never again, so a
  // deep-link change while the modal was already open did nothing.
  useEffect(() => {
    if (isOpen) setActiveTab(initialTab)
  }, [isOpen, initialTab])

  // Reset on open / when the target client changes.
  useEffect(() => {
    if (!isOpen) return
    setError(null)
    setSuccess(null)
    setStagedAppUsers([])
    if (isEditing && clientId) {
      void fetchClient(clientId)
    } else {
      setClient(null)
      // The default comes from the one place that declares it; the operator may clear or
      // change it before saving, and a stored `0` stays a different decision from absent.
      setEdited({
        client_type: DEFAULT_CLIENT_TYPE,
        status: 'pending',
        commission_rate: DEFAULT_COMMISSION_RATE,
      })
    }
    return () => {
      // Cancel any in-flight fetch when the effect re-runs or unmounts —
      // prevents stale data writes after clientId changes.
      fetchAbortRef.current?.abort()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, clientId, mode])

  const fetchClient = useCallback(async (id: string) => {
    fetchAbortRef.current?.abort()
    const controller = new AbortController()
    fetchAbortRef.current = controller

    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/clients/${id}`, { signal: controller.signal })
      // If aborted between request start and parse, bail silently.
      if (controller.signal.aborted) return
      const data = await res.json()
      if (controller.signal.aborted) return
      if (!res.ok) {
        setError(data.error ?? t('errors.loadFailed'))
        return
      }
      setClient(data.client)
      setEdited(data.client)
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') return
      setError(t('errors.networkLoad'))
    } finally {
      if (!controller.signal.aborted) setLoading(false)
    }
  }, [])

  const updateField = useCallback(<K extends keyof Client>(field: K, value: Client[K]) => {
    setEdited((prev) => ({ ...prev, [field]: value }))
  }, [])

  const review = validation.review
  const reviewAnswers = review?.answers
  const headerName = useMemo(() => {
    if (preRegistration) return reviewAnswers?.trade_name || tValidation('noTradeName')
    if (mode === 'new' && !validationId) return t('header.newClient')
    // O FANTASIA PRIMEIRO, e a razão social como reserva. O operador procura `Cozi +`, que é o
    // que está na fachada e no material; `Cozimais Restaurante e Café` é o nome do contrato e
    // não identifica o cliente para quem abriu o registro. Mesma inversão que trocava os
    // rótulos dos dois campos na aba Perfil (2026-08-26).
    return edited.name || client?.name || edited.company_name || client?.company_name || t('header.noName')
  }, [mode, edited, client, t, preRegistration, reviewAnswers, tValidation, validationId])

  // Missing-fields validation (only the bare minimum to allow save).
  const missing: string[] = []
  if (!String(edited.name ?? client?.name ?? '').trim()) missing.push(t('missing.name'))
  if (!String(edited.email ?? client?.email ?? '').trim()) missing.push(t('missing.email'))
  const canSave = missing.length === 0 && !saving && !loading

  const handleSave = async () => {
    if (!canSave) return
    setSaving(true)
    setError(null)
    setSuccess(null)

    // Auto-set tax_id_type from country (preserve legacy behaviour).
    const payload: Partial<Client> = { ...edited }
    if (payload.country) {
      payload.tax_id_type = taxConfigFor(payload.country).type
    }

    try {
      if (isEditing && clientId) {
        const res = await fetch(`/api/admin/clients/${clientId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        const data = await res.json()
        if (!res.ok) {
          setError(data.error ?? t('errors.saveFailed'))
          return
        }
        // Null-safe merge — `client` is normally set by fetchClient, but
        // could be null if the initial fetch errored and the admin
        // retried via Save anyway. Either way, the server is the source
        // of truth for the post-save state.
        const merged = client ? { ...client, ...data.client } : (data.client as Client)
        setClient(merged)
        setEdited(merged)
        recordCache.clear()
        setSuccess(t('messages.saved'))
        setTimeout(() => setSuccess(null), 2500)
      } else {
        const res = await fetch('/api/admin/clients', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        const data = await res.json()
        if (!res.ok) {
          setError(data.error ?? t('errors.createFailed'))
          return
        }
        const newId = data.client.id as string
        // Link any app users staged while the client didn't exist yet.
        if (stagedAppUsers.length > 0) {
          await Promise.allSettled(
            stagedAppUsers.map((u) =>
              fetch(`/api/admin/users/${u.user_id}/client`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ client_id: newId }),
              })
            )
          )
          setStagedAppUsers([])
        }
        setClient(data.client)
        setEdited(data.client)
        setSuccess(t('messages.created'))
        setTimeout(() => setSuccess(null), 2500)
        onSaved?.(newId)
      }
    } catch {
      setError(t('errors.networkSave'))
    } finally {
      setSaving(false)
    }
  }

  if (!isOpen) return null

  const currentStatus = (edited.status ?? client?.status ?? 'pending') as Client['status']

  return (
    <div
      className="fixed inset-0 z-[100] flex justify-end bg-black/50 backdrop-blur-sm transition-opacity duration-300"
      onClick={onClose}
    >
      <RecordShell
        /*
         * IT IS A DIALOG, AND IT SAYS SO. The record opens over the list and covers it, and until
         * 2026-09-09 it carried no `role`, no `aria-modal`, no `Escape` and returned focus
         * nowhere — while `DirectoryFilterSheet`, on the same screen, did three of the four.
         * `aria-modal` is what makes the list behind inert for a screen reader; the rest is
         * `useDialogShell`.
         *
         * NAMED BY THE HEADER'S OWN `h2`, which already prints the partner's trade name. A
         * separate `aria-label` would be a second copy of the name, free to drift from the one
         * on screen.
         */
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        /*
         * FULL WIDTH ON A PHONE, and 85vw only where 15% of the screen is a usable amount of
         * list to leave behind. On a 390px viewport the old `w-[85vw]` left a 58px sliver of
         * board nobody can read or tap, and spent it out of the record — which is the surface
         * the operator came to work in. The way back is the header's close button, not a gutter.
         */
        className="w-full lg:w-[85vw] shadow-2xl animate-in slide-in-from-right duration-300"
        onClick={(e) => e.stopPropagation()}
        icon={isEditing ? <Edit className="h-5 w-5 text-tuggi-blue" /> : <Plus className="h-5 w-5 text-tuggi-blue" />}
        title={headerName}
        titleId={titleId}
        subtitle={
          preRegistration && reviewAnswers && review
            ? tValidation('headerLine', {
                category:
                  reviewAnswers.category && tForm.has(`categories.${reviewAnswers.category}`)
                    ? tForm(`categories.${reviewAnswers.category}`)
                    : (reviewAnswers.category ?? '—'),
                city: reviewAnswers.city ?? '—',
                state: reviewAnswers.state ?? '—',
                date: formatDateTime(review.submittedAt),
              })
            : isEditing && client
              ? `${client.email}${client.client_type ? ` · ${client.client_type}` : ''}${client.country ? ` · ${client.country}` : ''}`
              : null
        }
        /*
          ONE MOUNT OF `ApprovalHeaderControls`, two placements (inline on a monitor, its own
          line on a phone) — `RecordShell` owns the wrap. A second copy would carry a second
          `openAction` state and two dialogs for one decision.
        */
        controls={
          /*
           * ONE "APROVAR" PER HEADER (#890): while the submission is undecided its acts own the
           * header — approving it approves the client too (`approveRelationship`). Decided, the
           * header is the client's again; with no client, the submission's pill stays.
           */
          review && (validation.undecided || !clientId) ? (
            <ValidationDecision
              review={review}
              tradeName={reviewAnswers?.trade_name || tValidation('noTradeName')}
              locale={locale}
              done={validation.items.filter((item) => validation.ticks.has(item)).length}
              total={validation.items.length}
              readOnly={validation.readOnly}
              decided={validation.decided}
              onDecided={(decision) => {
                recordCache.clear()
                validation.onDecided(decision)
              }}
              onConflict={() => void validation.refetch()}
              shortcuts={activeTab === 'validation'}
            />
          ) : isEditing && clientId ? (
            <ApprovalHeaderControls
              clientId={clientId}
              status={currentStatus}
              clientEmail={edited.email ?? client?.email}
              clientName={edited.name ?? client?.name}
              canEdit
              onChanged={(next) => {
                recordCache.clear()
                setClient((prev) => prev ? { ...prev, ...next } : prev)
                setEdited((prev) => ({ ...prev, ...next }))
              }}
            />
          ) : null
        }
        closeLabel={t('close')}
        onClose={onClose}
        closeRef={closeRef}
      >
          {loading && (
            <div className="absolute inset-0 z-30 bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm flex items-center justify-center">
              <div className="flex flex-col items-center gap-3">
                <div className="w-10 h-10 border-4 border-tuggi-blue/20 border-t-tuggi-blue rounded-full animate-spin" />
                <p className="text-sm text-gray-500 font-medium animate-pulse">{t('loading')}</p>
              </div>
            </div>
          )}

          {/*
            THE TABS ARE ONE LIST RENDERED TWICE, and never two lists.
            Nine tabs whose enabling rule depends on `isEditing` is exactly the kind of thing
            that drifts when copied: a second copy would keep showing `Locais` on a registration
            being born long after the first stopped. `isDisabled` is the single rule, and
            `RecordTabs` draws the sidebar and the phone strip from the one list.
          */}
          {(() => {
            // A registration being born has no pipeline, no team, no places and no coupons
            // to show — all four are keyed by an id that does not exist until the save.
            // The pre-registration has no client yet: everything but the validation waits for it.
            const isDisabled = (tab: (typeof TABS)[number]) =>
              preRegistration
                ? tab.id !== 'validation'
                : !isEditing && (tab.id === 'partnership' || tab.id === 'team' || tab.id === 'places' || tab.id === 'coupons')
            const hasValidation = Boolean(validation.submissionId)
            const onValidation = activeTab === 'validation' && hasValidation
            const decisionSummary = (describesApprove: boolean) =>
              review ? (
                <DecisionSummary
                  review={review}
                  items={validation.items}
                  ticks={validation.ticks}
                  onToggle={validation.toggle}
                  readOnly={validation.readOnly}
                  decided={validation.decided}
                  describesApprove={describesApprove}
                />
              ) : null

            const saveBlock = (
              <>
                {error && (
                  <div className="p-3 bg-red-50 dark:bg-red-900/20 rounded-xl border border-red-200 dark:border-red-800/30 flex items-center gap-2">
                    <AlertTriangle className="w-3.5 h-3.5 text-red-600 shrink-0" />
                    <p className="text-[10px] text-red-700 dark:text-red-400 font-semibold">{error}</p>
                  </div>
                )}

                {success && (
                  <div className="p-3 bg-green-50 dark:bg-green-900/20 rounded-xl border border-green-200 dark:border-green-800/30">
                    <p className="text-[10px] text-green-700 dark:text-green-400 font-semibold">{success}</p>
                  </div>
                )}

                {missing.length > 0 && (
                  <div className="p-3 bg-amber-50 dark:bg-amber-900/20 rounded-xl border border-amber-200 dark:border-amber-800/30">
                    <p className="text-[10px] text-amber-700 dark:text-amber-400 font-semibold mb-1">{t('missingTitle')}</p>
                    <ul className="space-y-0.5">
                      {missing.map((f) => (
                        <li key={f} className="text-[10px] text-amber-600 dark:text-amber-500 flex items-center gap-1">
                          <span className="w-1 h-1 bg-amber-400 rounded-full shrink-0" /> {f}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <button
                  onClick={handleSave}
                  disabled={!canSave}
                  className="w-full min-h-[44px] py-3.5 bg-tuggi-blue text-white font-bold rounded-2xl hover:bg-tuggi-blue/90 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-xl shadow-tuggi-blue/20 active:scale-[0.98] flex items-center justify-center gap-2 text-sm"
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  {t('save')}
                </button>
              </>
            )

            return (
              <>
                <RecordTabs
                  tabs={TABS.filter((tab) => tab.id !== 'validation' || hasValidation).map((tab) => ({
                    id: tab.id,
                    label: tTabs(tab.labelKey),
                    icon: tab.icon,
                    disabled: isDisabled(tab),
                    badge:
                      tab.id === 'validation' && review?.status === 'in_review' ? (
                        <span className="h-2 w-2 shrink-0 rounded-full bg-primary-800" aria-hidden="true" />
                      ) : undefined,
                  }))}
                  active={activeTab}
                  onSelect={setActiveTab}
                  heading={tTabs('configuration')}
                  disabledTitle={preRegistration ? tTabs('afterApproval') : tTabs('comingSoon')}
                  footer={
                    <>
                      {onValidation ? decisionSummary(true) : null}
                      {preRegistration ? null : saveBlock}
                    </>
                  }
                />

                {/* Right content area */}
                <main className="flex-1 overflow-y-auto p-4 lg:p-8">
                <RecordCacheProvider cache={recordCache}>
            {clientId ? <PortalSubmissionsReader clientId={clientId} onRead={setPortalRecords} /> : null}
            {onValidation && (
              <ValidationTab
                key={validation.submissionId ?? 'none'} // a new submission remounts: the revealed CPF never carries over (security review #890)
                record={validation}
                locale={locale}
                client={clientId ? client : null}
                validationHref={validationHref}
                boardHref={boardHref}
                otherSubmissions={portalRecords.filter((r) => r.submissionId !== validation.submissionId)}
                onOpenTab={setActiveTab}
                phoneSummary={decisionSummary(false)}
              />
            )}
            {activeTab === 'partnership' && (
              <PartnershipTab
                client={client}
                edited={edited}
                updateField={updateField}
                canEdit
                clientId={clientId}
                onOpenTab={setActiveTab}
              />
            )}
            {activeTab === 'profile' && (
              <ProfileTab client={client} edited={edited} updateField={updateField} canEdit clientId={clientId} />
            )}
            {activeTab === 'fiscal' && (
              <FiscalPaymentsTab client={client} edited={edited} updateField={updateField} canEdit clientId={clientId} />
            )}
            {activeTab === 'contract' && (
              <ContractTab client={client} edited={edited} updateField={updateField} canEdit clientId={clientId} />
            )}
            {activeTab === 'team' && (
              <TeamTab client={client} edited={edited} updateField={updateField} canEdit clientId={clientId} />
            )}
            {activeTab === 'appusers' && (
              <AppUsersTab
                client={client}
                edited={edited}
                updateField={updateField}
                canEdit
                clientId={clientId}
                stagedUsers={stagedAppUsers}
                onStageChange={setStagedAppUsers}
              />
            )}
            {activeTab === 'places' && (
              <PlacesTab
                client={client}
                edited={edited}
                updateField={updateField}
                canEdit
                clientId={clientId}
                onOpenPipeline={() => setActiveTab('partnership')}
              />
            )}
            {activeTab === 'coupons' && (
              <CouponsTab client={client} edited={edited} updateField={updateField} canEdit clientId={clientId} />
            )}
                </RecordCacheProvider>
                </main>

                {/*
                  SAVE LIVES AT THE BOTTOM OF THE SCREEN ON A PHONE, not at the bottom of a
                  sidebar that no longer exists. It is pinned rather than scrolled to: this
                  record is a form somebody fills in at an event with one hand, and a save
                  button reachable only after scrolling past `Locais` is a save button that
                  gets forgotten. `pb-[env(safe-area-inset-bottom)]` keeps it clear of the
                  iPhone home indicator.
                */}
                {preRegistration ? null : (
                  <div className="lg:hidden shrink-0 space-y-3 border-t border-gray-100 bg-white p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] dark:border-gray-800 dark:bg-gray-900">
                    {saveBlock}
                  </div>
                )}
              </>
            )
          })()}
      </RecordShell>
    </div>
  )
}
