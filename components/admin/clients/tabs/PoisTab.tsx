'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { MapPin, ExternalLink, X, Check, AlertCircle, Loader2 } from 'lucide-react'
import Link from 'next/link'
import { useSupabaseClient } from '@supabase/auth-helpers-react'
import { SectionHeader } from '@/components/admin/clients/shared/SectionHeader'
import type { ClientEditorTabProps } from './ProfileTab'

interface PoiPreview {
  id: string
  name: string
  city?: string | null
  country?: string | null
  approved?: boolean | null
}

/**
 * POIs tab — single-purpose: pick the client's "POI de referência" — the
 * welcome_poi_id used by the partner page on tuggi.app (plays the POI's
 * description + audio when a user lands on /d/<slug>).
 *
 * KISS first pass: paste a POI UUID, hit "Validar", we look it up and
 * show name/city/country + the approval state. Persistence is delegated
 * to the modal's Save button (SSOT) — this tab only mutates `edited.
 * welcome_poi_id` via updateField, exactly like every other tab.
 */
export function PoisTab({ client, edited, updateField, canEdit, clientId }: ClientEditorTabProps) {
  const supabase = useSupabaseClient()
  const currentId = (edited.welcome_poi_id ?? client?.welcome_poi_id) || ''
  const [preview, setPreview] = useState<PoiPreview | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [draftId, setDraftId] = useState('')

  // AbortController-style guard so that a quick succession of validate
  // clicks doesn't paint a stale preview when an older request resolves
  // after a newer one.
  const requestIdRef = useRef(0)

  const fetchPreview = useCallback(async (poiId: string) => {
    if (!poiId) { setPreview(null); return }
    const reqId = ++requestIdRef.current
    setLoading(true)
    setError(null)
    try {
      const { data, error: fetchError } = await supabase
        .schema('core')
        .from('attractions')
        .select('id, name, city, country, approved')
        .eq('id', poiId)
        .single()
      // Discard the result if a newer request has started since.
      if (reqId !== requestIdRef.current) return
      if (fetchError) {
        setPreview(null)
        setError('POI não encontrado (UUID inválido ou inexistente)')
        return
      }
      setPreview(data as PoiPreview)
    } catch {
      if (reqId !== requestIdRef.current) return
      setError('Erro de rede ao buscar POI')
    } finally {
      if (reqId === requestIdRef.current) setLoading(false)
    }
  }, [supabase])

  // Sync preview whenever the saved id changes (load or after parent save).
  useEffect(() => { void fetchPreview(currentId) }, [currentId, fetchPreview])

  const handleValidate = async () => {
    const id = draftId.trim()
    if (!id) return
    await fetchPreview(id)
  }

  // Just stage the change — the parent modal's Save button persists it.
  const handleAttach = () => {
    if (!preview) return
    updateField('welcome_poi_id', preview.id)
    setDraftId('')
  }

  const handleDetach = () => {
    updateField('welcome_poi_id', undefined as never)
    setPreview(null)
  }

  return (
    <div className="space-y-8 max-w-5xl mx-auto">
      <div className="bg-white dark:bg-gray-900 rounded-3xl border border-gray-200 dark:border-gray-800 p-8 shadow-sm">
        <SectionHeader icon={<MapPin className="w-4 h-4 text-tuggi-blue" />} title="POI de referência (Welcome POI)" />
        <p className="text-xs text-gray-500 mb-6 leading-relaxed">
          POI tocado quando o usuário acessa a página do parceiro (tuggi.app/d/&lt;slug&gt;) — a descrição e o áudio
          deste POI servem como conteúdo de boas-vindas. Cole o UUID, valide e atribua. As mudanças entram em vigor após o Salvar do modal.
        </p>

        {error && (
          <div className="mb-4 flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            <AlertCircle className="w-3.5 h-3.5" /> {error}
          </div>
        )}

        {/* Current welcome POI card */}
        {preview && currentId && (
          <div className="mb-6 flex items-center justify-between p-4 bg-tuggi-blue/5 border border-tuggi-blue/10 rounded-2xl">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-tuggi-blue/10 rounded-xl">
                <MapPin className="w-5 h-5 text-tuggi-blue" />
              </div>
              <div>
                <div className="font-bold text-gray-900 dark:text-white text-sm flex items-center gap-2">
                  {preview.name}
                  <Link href={`/pois?search=${preview.id}`} className="p-1 text-gray-400 hover:text-tuggi-blue transition-colors">
                    <ExternalLink className="w-3.5 h-3.5" />
                  </Link>
                  {preview.approved != null && (
                    <span className={`text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded ${preview.approved ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}`}>
                      {preview.approved ? 'Aprovado' : 'Pendente'}
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-gray-400 font-medium">{preview.city ?? ''}{preview.city && preview.country ? ', ' : ''}{preview.country ?? ''}</div>
              </div>
            </div>
            {canEdit && (
              <button
                onClick={handleDetach}
                className="p-2 text-gray-300 hover:text-red-500 transition-colors"
                title="Remover Welcome POI"
              >
                <X className="w-5 h-5" />
              </button>
            )}
          </div>
        )}

        {/* Picker */}
        {canEdit && clientId && (
          <div className="space-y-3">
            <div className="p-1.5 bg-gray-50 dark:bg-gray-800/50 rounded-2xl border border-gray-100 dark:border-gray-800 flex gap-2">
              <input
                type="text"
                placeholder="Cole o UUID do POI..."
                value={draftId}
                onChange={(e) => setDraftId(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void handleValidate() }}
                className="flex-1 bg-transparent border-none outline-none px-4 text-xs font-mono text-gray-900 dark:text-white placeholder:text-gray-400"
              />
              <button
                onClick={handleValidate}
                disabled={loading || !draftId.trim()}
                className="px-4 py-2 bg-gray-200 text-gray-700 rounded-xl text-[10px] font-bold uppercase tracking-widest hover:bg-gray-300 transition-all disabled:opacity-50 flex items-center gap-1.5"
              >
                {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                Validar
              </button>
              <button
                onClick={handleAttach}
                disabled={!preview || draftId.trim() === ''}
                className="px-4 py-2 bg-tuggi-blue text-white rounded-xl text-[10px] font-bold uppercase tracking-widest hover:bg-tuggi-blue/90 shadow-md shadow-tuggi-blue/10 transition-all disabled:opacity-50"
                title={!preview ? 'Valide um POI primeiro' : undefined}
              >
                Atribuir
              </button>
            </div>
            <p className="text-[10px] text-gray-400">
              Dica: copie o ID de um POI na página <Link href="/pois" className="text-tuggi-blue hover:underline">/pois</Link>.
              Autocomplete por nome chega numa próxima iteração.
            </p>
          </div>
        )}

        {!clientId && (
          <p className="text-sm text-gray-500 text-center py-8">Salve o cliente primeiro para atribuir um Welcome POI.</p>
        )}
      </div>
    </div>
  )
}
