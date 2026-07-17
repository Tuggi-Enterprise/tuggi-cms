'use client'

/**
 * CoordinatorChildModal — cadastrar/editar uma empresa-filha.
 *
 * Reusa o ProfileTab do fluxo admin (componente puro, autocontido, JÁ inclui o QR) mas
 * fala com /api/coordinator/children em vez de /api/admin/clients. Deliberadamente NÃO
 * traz as demais abas do ClientEditorModal:
 *   - Fiscal (commission)       → dinheiro, decisão da Tuggi
 *   - Team / App Users          → PII; o coordenador vê só agregados
 *   - POIs                      → coordenadores/empresas não acessam POIs
 *   - Aprovar/Rejeitar          → filha nasce approved
 *
 * O pai é resolvido no SERVIDOR (resolveParentForNewChild) a partir da sessão — este modal
 * nunca envia parent_client_id, então não há como pendurar filha em guarda-chuva alheio.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { X, Save, Loader2, Plus, Edit, AlertTriangle } from 'lucide-react'
import { ProfileTab } from '@/components/admin/clients/tabs/ProfileTab'
import type { Client } from '@/types/clients'

interface Props {
  /** undefined = criar; id = editar. */
  childId?: string
  isOpen: boolean
  onClose: () => void
  onSaved: () => void
}

export function CoordinatorChildModal({ childId, isOpen, onClose, onSaved }: Props) {
  const isEditing = Boolean(childId)
  const [client, setClient] = useState<Client | null>(null)
  const [edited, setEdited] = useState<Partial<Client>>({})
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const fetchChild = useCallback(async (id: string) => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/coordinator/children/${id}`, { signal: controller.signal })
      if (controller.signal.aborted) return
      const data = await res.json()
      if (controller.signal.aborted) return
      if (!res.ok) { setError(data.error ?? 'Falha ao carregar'); return }
      setClient(data.client)
      setEdited(data.client)
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') return
      setError('Erro de rede ao carregar')
    } finally {
      if (!controller.signal.aborted) setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!isOpen) return
    setError(null)
    setSuccess(null)
    if (isEditing && childId) {
      void fetchChild(childId)
    } else {
      setClient(null)
      setEdited({ client_type: 'business' })
    }
    return () => { abortRef.current?.abort() }
  }, [isOpen, childId, isEditing, fetchChild])

  const updateField = useCallback(<K extends keyof Client>(field: K, value: Client[K]) => {
    setEdited(prev => ({ ...prev, [field]: value }))
  }, [])

  const missing: string[] = []
  if (!String(edited.name ?? client?.name ?? '').trim()) missing.push('Nome')
  if (!String(edited.email ?? client?.email ?? '').trim()) missing.push('E-mail')
  const canSave = missing.length === 0 && !saving && !loading

  const handleSave = async () => {
    if (!canSave) return
    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      if (isEditing && childId) {
        const res = await fetch(`/api/coordinator/children/${childId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(edited),
        })
        const data = await res.json()
        if (!res.ok) { setError(data.error ?? 'Falha ao salvar'); return }
        const merged = client ? { ...client, ...data.client } : (data.client as Client)
        setClient(merged)
        setEdited(merged)
        setSuccess('Salvo')
        onSaved()
      } else {
        // Sem parent_client_id no body de propósito: o servidor força o pai pela sessão.
        const res = await fetch('/api/coordinator/children', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(edited),
        })
        const data = await res.json()
        if (!res.ok) { setError(data.error ?? 'Falha ao criar'); return }
        setClient(data.client)
        setEdited(data.client)
        setSuccess('Empresa criada — o QR já está ativo')
        onSaved()
      }
      setTimeout(() => setSuccess(null), 2500)
    } catch {
      setError('Erro de rede ao salvar')
    } finally {
      setSaving(false)
    }
  }

  if (!isOpen) return null

  // Depois de criar, passamos a ter um id → o ProfileTab passa a renderizar o QR.
  const effectiveId = childId ?? client?.id

  return (
    <div className="fixed inset-0 z-[100] flex justify-end bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div
        className="flex h-full w-[85vw] max-w-4xl flex-col bg-white shadow-2xl animate-in slide-in-from-right duration-300 dark:bg-gray-900"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex h-16 shrink-0 items-center justify-between border-b border-gray-100 px-6 dark:border-gray-800">
          <div className="flex min-w-0 items-center gap-3">
            <div className="shrink-0 rounded-xl bg-tuggi-blue/10 p-2">
              {isEditing ? <Edit className="h-5 w-5 text-tuggi-blue" /> : <Plus className="h-5 w-5 text-tuggi-blue" />}
            </div>
            <div className="min-w-0">
              <h2 className="truncate text-base font-bold leading-tight text-gray-900 dark:text-white">
                {isEditing
                  ? (edited.company_name || client?.company_name || edited.name || 'Empresa')
                  : 'Nova empresa'}
              </h2>
              <p className="text-[10px] font-medium text-gray-400">
                {isEditing ? 'Editar empresa do seu guarda-chuva' : 'Cadastrar empresa no seu guarda-chuva'}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-xl p-2 text-gray-400 transition-all hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="relative flex-1 overflow-y-auto p-8">
          {loading && (
            <div className="absolute inset-0 z-30 flex items-center justify-center bg-white/80 backdrop-blur-sm dark:bg-gray-900/80">
              <div className="h-10 w-10 animate-spin rounded-full border-4 border-tuggi-blue/20 border-t-tuggi-blue" />
            </div>
          )}
          <ProfileTab client={client} edited={edited} updateField={updateField} canEdit clientId={effectiveId} />
        </div>

        {/* Footer */}
        <div className="shrink-0 space-y-3 border-t border-gray-100 p-4 dark:border-gray-800">
          {error && (
            <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-3 dark:border-red-800/30 dark:bg-red-900/20">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-red-600" />
              <p className="text-[11px] font-semibold text-red-700 dark:text-red-400">{error}</p>
            </div>
          )}
          {success && (
            <div className="rounded-xl border border-green-200 bg-green-50 p-3 dark:border-green-800/30 dark:bg-green-900/20">
              <p className="text-[11px] font-semibold text-green-700 dark:text-green-400">{success}</p>
            </div>
          )}
          {missing.length > 0 && (
            <p className="text-[11px] font-semibold text-amber-600">Faltando: {missing.join(', ')}</p>
          )}
          <button
            onClick={handleSave}
            disabled={!canSave}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-tuggi-blue py-3.5 text-sm font-bold text-white shadow-xl shadow-tuggi-blue/20 transition-all hover:bg-tuggi-blue/90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {isEditing ? 'Salvar' : 'Cadastrar empresa'}
          </button>
        </div>
      </div>
    </div>
  )
}
