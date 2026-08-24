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
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  X, Save, Loader2, Building2, Scale, Users, MapPin, Gift, AlertTriangle, Plus, Edit, Smartphone,
  FileSignature, Handshake,
} from 'lucide-react'
import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'
import { taxConfigFor } from '@/components/admin/clients/shared/countries'
import { ApprovalHeaderControls } from '@/components/admin/clients/shared/ApprovalHeaderControls'
import { ProfileTab } from '@/components/admin/clients/tabs/ProfileTab'
import { FiscalPaymentsTab } from '@/components/admin/clients/tabs/FiscalPaymentsTab'
import { TeamTab } from '@/components/admin/clients/tabs/TeamTab'
import { AppUsersTab, type AppUserLite } from '@/components/admin/clients/tabs/AppUsersTab'
import { PlacesTab } from '@/components/admin/clients/tabs/PlacesTab'
import { PartnershipTab } from '@/components/admin/clients/tabs/PartnershipTab'
import { CouponsTab } from '@/components/admin/clients/tabs/CouponsTab'
import { ContractTab } from '@/components/admin/clients/tabs/ContractTab'
import { DEFAULT_CLIENT_TYPE, DEFAULT_COMMISSION_RATE, type Client } from '@/types/clients'

/**
 * `places` was called `pois` while the tab was only the welcome-POI picker. It now lists the
 * places linked to the client by `partner_client_id`, and the old name described the widget
 * rather than the subject — `AdminClientsPageContent` still accepts `?tab=pois` so the links
 * already out there keep landing here.
 */
export type ClientEditorTab =
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
}

interface TabDef { id: ClientEditorTab; labelKey: string; icon: typeof Building2; placeholder?: boolean }
const TABS: TabDef[] = [
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
  clientId,
  isOpen,
  mode,
  initialTab = 'profile',
  onClose,
  onSaved,
}: ClientEditorModalProps) {
  const t = useTranslations('Clients.editor')
  const tTabs = useTranslations('Clients.editor.tabs')
  const isEditing = mode === 'edit' && Boolean(clientId)
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

  const headerName = useMemo(() => {
    if (mode === 'new') return t('header.newClient')
    return edited.company_name || client?.company_name || edited.name || client?.name || t('header.noName')
  }, [mode, edited, client, t])

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
      <div
        /*
         * FULL WIDTH ON A PHONE, and 85vw only where 15% of the screen is a usable amount of
         * list to leave behind. On a 390px viewport the old `w-[85vw]` left a 58px sliver of
         * board nobody can read or tap, and spent it out of the record — which is the surface
         * the operator came to work in. The way back is the header's close button, not a gutter.
         */
        className="w-full lg:w-[85vw] bg-white dark:bg-gray-900 h-full flex flex-col shadow-2xl animate-in slide-in-from-right duration-300"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        {/*
          THREE CHILDREN AND `order`, WHERE THERE WERE TWO GROUPS AND A COLLAPSE.

          The name sat in a `min-w-0` group with no `flex-1`, beside a `shrink-0` group holding
          the status badge, `Aprovar` and `Recusar`. On a monitor that reads as intended; on a
          390px screen those three take the whole 64px bar, the name shrinks to LITERALLY ZERO
          pixels, and the operator is looking at a record with no idea whose it is. Measured at
          `width: 0` by `client-board.mobile.spec.tsx`, which is how it was found.

          So the bar wraps, and the approval controls are what wraps: `order-3 w-full` puts them
          on their own line under the name on a phone, `lg:order-2 lg:w-auto` puts them back
          inline on a monitor. One mount of `ApprovalHeaderControls`, two placements — a second
          copy would carry a second `openAction` state and two dialogs for one decision.
        */}
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-3 lg:h-16 lg:flex-nowrap lg:px-6 lg:py-0 border-b border-gray-100 dark:border-gray-800 shrink-0">
          <div className="order-1 flex flex-1 items-center gap-3 min-w-0">
            <div className="p-2 bg-tuggi-blue/10 rounded-xl shrink-0">
              {isEditing ? <Edit className="h-5 w-5 text-tuggi-blue" /> : <Plus className="h-5 w-5 text-tuggi-blue" />}
            </div>
            <div className="min-w-0">
              <h2 className="font-bold text-gray-900 dark:text-white truncate text-base leading-tight">
                {headerName}
              </h2>
              {isEditing && client && (
                <p className="text-[10px] text-gray-400 font-medium truncate">
                  {client.email}
                  {client.client_type ? ` · ${client.client_type}` : ''}
                  {client.country ? ` · ${client.country}` : ''}
                </p>
              )}
            </div>
          </div>

          {isEditing && clientId && (
            <div className="order-3 w-full shrink-0 lg:order-2 lg:w-auto">
              <ApprovalHeaderControls
                clientId={clientId}
                status={currentStatus}
                clientEmail={edited.email ?? client?.email}
                clientName={edited.name ?? client?.name}
                canEdit
                onChanged={(next) => {
                  setClient((prev) => prev ? { ...prev, ...next } : prev)
                  setEdited((prev) => ({ ...prev, ...next }))
                }}
              />
            </div>
          )}

          <button
            onClick={onClose}
            aria-label={t('close')}
            className="order-2 shrink-0 min-h-[44px] min-w-[44px] flex items-center justify-center p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-xl transition-all text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 lg:order-3 lg:min-h-0 lg:min-w-0"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Main */}
        <div className="flex-1 flex flex-col lg:flex-row overflow-hidden relative">
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
            being born long after the first stopped. `renderTab` is the single rule; the two
            containers below differ in direction and in nothing else.
          */}
          {(() => {
            // A registration being born has no pipeline, no team, no places and no coupons
            // to show — all four are keyed by an id that does not exist until the save.
            const isDisabled = (tab: (typeof TABS)[number]) =>
              tab.placeholder || (!isEditing && (tab.id === 'partnership' || tab.id === 'team' || tab.id === 'places' || tab.id === 'coupons'))

            const tabButtons = (compact: boolean) =>
              TABS.map((tab) => {
                const disabled = isDisabled(tab)
                return (
                  <button
                    key={tab.id}
                    onClick={() => !disabled && setActiveTab(tab.id)}
                    disabled={disabled}
                    aria-current={activeTab === tab.id ? 'page' : undefined}
                    className={cn(
                      'flex items-center gap-3 rounded-2xl font-bold text-sm transition-all duration-300 text-left',
                      // A phone taps these with a thumb: 44px tall, side by side, and the label
                      // never wraps mid-strip.
                      compact
                        ? 'min-h-[44px] shrink-0 whitespace-nowrap px-4 py-2'
                        : 'w-full px-4 py-3',
                      activeTab === tab.id
                        ? 'bg-tuggi-blue text-white'
                        : disabled
                          ? 'text-gray-300 cursor-not-allowed'
                          : 'text-gray-500 dark:text-gray-400 hover:text-tuggi-blue hover:bg-tuggi-blue/5',
                    )}
                    title={disabled ? tTabs('comingSoon') : undefined}
                  >
                    <tab.icon className={cn('h-5 w-5 shrink-0', activeTab === tab.id && 'animate-pulse')} />
                    <span className={compact ? undefined : 'flex-1'}>{tTabs(tab.labelKey)}</span>
                    {tab.placeholder && !compact && (
                      <span className="text-[9px] font-bold uppercase tracking-widest text-gray-300">{tTabs('soonBadge')}</span>
                    )}
                  </button>
                )
              })

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
                {/* Sidebar — the monitor's shape, where 288px beside the content costs nothing. */}
                <aside className="hidden lg:flex w-72 bg-white dark:bg-gray-900 border-r border-gray-100/50 dark:border-gray-800 p-6 flex-col gap-2 z-20 shrink-0">
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest px-3 mb-2">
                    {tTabs('configuration')}
                  </p>

                  {tabButtons(false)}

                  <div className="my-2 border-t border-gray-100 dark:border-gray-800" />

                  <div className="mt-auto space-y-3">{saveBlock}</div>
                </aside>

                {/* The phone's shape: the same tabs as a strip that scrolls sideways, above the
                    panel they open. On a 390px screen the 288px sidebar left ~43px for the
                    record itself — which is to say, it left none. */}
                <nav
                  aria-label={tTabs('configuration')}
                  className="lg:hidden flex gap-2 overflow-x-auto border-b border-gray-100 dark:border-gray-800 px-4 py-2 shrink-0"
                >
                  {tabButtons(true)}
                </nav>

                {/* Right content area */}
                <main className="flex-1 overflow-y-auto p-4 lg:p-8">
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
              <PlacesTab client={client} edited={edited} updateField={updateField} canEdit clientId={clientId} />
            )}
            {activeTab === 'coupons' && (
              <CouponsTab client={client} edited={edited} updateField={updateField} canEdit clientId={clientId} />
            )}
                </main>

                {/*
                  SAVE LIVES AT THE BOTTOM OF THE SCREEN ON A PHONE, not at the bottom of a
                  sidebar that no longer exists. It is pinned rather than scrolled to: this
                  record is a form somebody fills in at an event with one hand, and a save
                  button reachable only after scrolling past `Locais` is a save button that
                  gets forgotten. `pb-[env(safe-area-inset-bottom)]` keeps it clear of the
                  iPhone home indicator.
                */}
                <div className="lg:hidden shrink-0 space-y-3 border-t border-gray-100 bg-white p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] dark:border-gray-800 dark:bg-gray-900">
                  {saveBlock}
                </div>
              </>
            )
          })()}
        </div>
      </div>
    </div>
  )
}
