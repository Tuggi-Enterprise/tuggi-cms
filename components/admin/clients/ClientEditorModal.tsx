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

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  X, Save, Loader2, Building2, Scale, Users, MapPin, Gift, AlertTriangle, Plus, Edit,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { taxConfigFor } from '@/components/admin/clients/shared/countries'
import { ApprovalHeaderControls } from '@/components/admin/clients/shared/ApprovalHeaderControls'
import { ProfileTab } from '@/components/admin/clients/tabs/ProfileTab'
import { FiscalPaymentsTab } from '@/components/admin/clients/tabs/FiscalPaymentsTab'
import type { Client } from '@/types/clients'

export type ClientEditorTab = 'profile' | 'fiscal' | 'team' | 'pois' | 'coupons'

interface ClientEditorModalProps {
  clientId?: string
  isOpen: boolean
  mode: 'edit' | 'new'
  initialTab?: ClientEditorTab
  onClose: () => void
  /** Called after a successful create — receives the saved id so the host can update the URL. */
  onSaved?: (clientId: string) => void
}

const TABS: { id: ClientEditorTab; label: string; icon: typeof Building2; placeholder?: boolean }[] = [
  { id: 'profile', label: 'Perfil', icon: Building2 },
  { id: 'fiscal', label: 'Fiscal & Pagamentos', icon: Scale },
  { id: 'team', label: 'Equipe', icon: Users, placeholder: true },
  { id: 'pois', label: 'POIs', icon: MapPin, placeholder: true },
  { id: 'coupons', label: 'Cupons', icon: Gift, placeholder: true },
]

export function ClientEditorModal({
  clientId,
  isOpen,
  mode,
  initialTab = 'profile',
  onClose,
  onSaved,
}: ClientEditorModalProps) {
  const isEditing = mode === 'edit' && Boolean(clientId)
  const [activeTab, setActiveTab] = useState<ClientEditorTab>(initialTab)
  const [client, setClient] = useState<Client | null>(null)
  const [edited, setEdited] = useState<Partial<Client>>({})
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  // Reset on open
  useEffect(() => {
    if (!isOpen) return
    setActiveTab(initialTab)
    setError(null)
    setSuccess(null)
    if (isEditing && clientId) {
      void fetchClient(clientId)
    } else {
      setClient(null)
      setEdited({ client_type: 'business', status: 'pending', commission_rate: 0.2 })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, clientId, mode])

  const fetchClient = useCallback(async (id: string) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/clients/${id}`)
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Falha ao carregar cliente')
        return
      }
      setClient(data.client)
      setEdited(data.client)
    } catch {
      setError('Erro de rede ao carregar cliente')
    } finally {
      setLoading(false)
    }
  }, [])

  const updateField = useCallback(<K extends keyof Client>(field: K, value: Client[K]) => {
    setEdited((prev) => ({ ...prev, [field]: value }))
  }, [])

  const headerName = useMemo(() => {
    if (mode === 'new') return 'Novo cliente'
    return edited.company_name || client?.company_name || edited.name || client?.name || 'Sem nome'
  }, [mode, edited, client])

  // Missing-fields validation (only the bare minimum to allow save).
  const missing: string[] = []
  if (!String(edited.name ?? client?.name ?? '').trim()) missing.push('Nome / razão social')
  if (!String(edited.email ?? client?.email ?? '').trim()) missing.push('Email')
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
          setError(data.error ?? 'Falha ao salvar')
          return
        }
        setClient({ ...(client as Client), ...data.client })
        setEdited({ ...(client as Client), ...data.client })
        setSuccess('Salvo com sucesso')
        setTimeout(() => setSuccess(null), 2500)
      } else {
        const res = await fetch('/api/admin/clients', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        const data = await res.json()
        if (!res.ok) {
          setError(data.error ?? 'Falha ao criar cliente')
          return
        }
        setClient(data.client)
        setEdited(data.client)
        setSuccess('Cliente criado')
        setTimeout(() => setSuccess(null), 2500)
        onSaved?.(data.client.id as string)
      }
    } catch {
      setError('Erro de rede ao salvar')
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
                <p className="text-sm text-gray-500 font-medium animate-pulse">Carregando…</p>
              </div>
            </div>
          )}

          {/* Sidebar */}
          <aside className="w-72 bg-white dark:bg-gray-900 border-r border-gray-100/50 dark:border-gray-800 p-6 flex flex-col gap-2 z-20 shrink-0">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest px-3 mb-2">
              Configuração
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
                  title={disabled ? 'Em breve (próxima PR)' : undefined}
                >
                  <tab.icon className={cn('h-5 w-5 shrink-0', activeTab === tab.id && 'animate-pulse')} />
                  <span className="flex-1">{tab.label}</span>
                  {tab.placeholder && (
                    <span className="text-[9px] font-bold uppercase tracking-widest text-gray-300">soon</span>
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
                  <p className="text-[10px] text-amber-700 dark:text-amber-400 font-semibold mb-1">Faltam para salvar</p>
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
                Salvar
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
            {(activeTab === 'team' || activeTab === 'pois' || activeTab === 'coupons') && (
              <div className="max-w-2xl mx-auto py-20 text-center">
                <p className="text-sm text-gray-400 font-semibold uppercase tracking-widest mb-2">Em breve</p>
                <h3 className="text-2xl font-bold text-gray-700 mb-3">
                  {TABS.find((t) => t.id === activeTab)?.label}
                </h3>
                <p className="text-sm text-gray-500">
                  Esta aba entra na próxima PR da refatoração. Por enquanto continue usando a página antiga
                  para gerenciar {activeTab === 'team' ? 'usuários vinculados' : activeTab === 'pois' ? 'POIs vinculados' : 'cupons'}.
                </p>
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  )
}
