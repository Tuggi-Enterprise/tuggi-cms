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
  FileSignature,
} from 'lucide-react'
import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'
import { taxConfigFor } from '@/components/admin/clients/shared/countries'
import { ApprovalHeaderControls } from '@/components/admin/clients/shared/ApprovalHeaderControls'
import { ProfileTab } from '@/components/admin/clients/tabs/ProfileTab'
import { FiscalPaymentsTab } from '@/components/admin/clients/tabs/FiscalPaymentsTab'
import { TeamTab } from '@/components/admin/clients/tabs/TeamTab'
import { AppUsersTab, type AppUserLite } from '@/components/admin/clients/tabs/AppUsersTab'
import { PoisTab } from '@/components/admin/clients/tabs/PoisTab'
import { CouponsTab } from '@/components/admin/clients/tabs/CouponsTab'
import { ContractTab } from '@/components/admin/clients/tabs/ContractTab'
import { DEFAULT_CLIENT_TYPE, type Client } from '@/types/clients'

export type ClientEditorTab = 'profile' | 'fiscal' | 'contract' | 'team' | 'appusers' | 'pois' | 'coupons'

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
  { id: 'profile', labelKey: 'profile', icon: Building2 },
  { id: 'fiscal', labelKey: 'fiscal', icon: Scale },
  // Summary only: the contract has its own route (#342). A long document with an audit
  // trail does not fit in a modal, but its STATE has to be where the team already looks.
  { id: 'contract', labelKey: 'contract', icon: FileSignature },
  { id: 'team', labelKey: 'team', icon: Users },
  { id: 'appusers', labelKey: 'appusers', icon: Smartphone },
  { id: 'pois', labelKey: 'pois', icon: MapPin },
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
      setEdited({ client_type: DEFAULT_CLIENT_TYPE, status: 'pending', commission_rate: 0.2 })
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
        className="w-[85vw] bg-white dark:bg-gray-900 h-full flex flex-col shadow-2xl animate-in slide-in-from-right duration-300"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="h-16 flex items-center justify-between px-6 border-b border-gray-100 dark:border-gray-800 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
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
          <div className="flex items-center gap-3 shrink-0">
            {isEditing && clientId && (
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
            )}
            <button
              onClick={onClose}
              className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-xl transition-all text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Main */}
        <div className="flex-1 flex overflow-hidden relative">
          {loading && (
            <div className="absolute inset-0 z-30 bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm flex items-center justify-center">
              <div className="flex flex-col items-center gap-3">
                <div className="w-10 h-10 border-4 border-tuggi-blue/20 border-t-tuggi-blue rounded-full animate-spin" />
                <p className="text-sm text-gray-500 font-medium animate-pulse">{t('loading')}</p>
              </div>
            </div>
          )}

          {/* Sidebar */}
          <aside className="w-72 bg-white dark:bg-gray-900 border-r border-gray-100/50 dark:border-gray-800 p-6 flex flex-col gap-2 z-20 shrink-0">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest px-3 mb-2">
              {tTabs('configuration')}
            </p>

            {TABS.map((tab) => {
              const disabled = tab.placeholder || (!isEditing && (tab.id === 'team' || tab.id === 'pois' || tab.id === 'coupons'))
              return (
                <button
                  key={tab.id}
                  onClick={() => !disabled && setActiveTab(tab.id)}
                  disabled={disabled}
                  className={cn(
                    'flex items-center gap-3 px-4 py-3 rounded-2xl font-bold text-sm transition-all duration-300 text-left w-full',
                    activeTab === tab.id
                      ? 'bg-tuggi-blue text-white'
                      : disabled
                        ? 'text-gray-300 cursor-not-allowed'
                        : 'text-gray-500 dark:text-gray-400 hover:text-tuggi-blue hover:bg-tuggi-blue/5',
                  )}
                  title={disabled ? tTabs('comingSoon') : undefined}
                >
                  <tab.icon className={cn('h-5 w-5 shrink-0', activeTab === tab.id && 'animate-pulse')} />
                  <span className="flex-1">{tTabs(tab.labelKey)}</span>
                  {tab.placeholder && (
                    <span className="text-[9px] font-bold uppercase tracking-widest text-gray-300">{tTabs('soonBadge')}</span>
                  )}
                </button>
              )
            })}

            <div className="my-2 border-t border-gray-100 dark:border-gray-800" />

            <div className="mt-auto space-y-3">
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
                className="w-full py-3.5 bg-tuggi-blue text-white font-bold rounded-2xl hover:bg-tuggi-blue/90 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-xl shadow-tuggi-blue/20 active:scale-[0.98] flex items-center justify-center gap-2 text-sm"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                {t('save')}
              </button>
            </div>
          </aside>

          {/* Right content area */}
          <main className="flex-1 overflow-y-auto p-8">
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
            {activeTab === 'pois' && (
              <PoisTab client={client} edited={edited} updateField={updateField} canEdit clientId={clientId} />
            )}
            {activeTab === 'coupons' && (
              <CouponsTab client={client} edited={edited} updateField={updateField} canEdit clientId={clientId} />
            )}
          </main>
        </div>
      </div>
    </div>
  )
}
