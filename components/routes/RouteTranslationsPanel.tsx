'use client'

import React, { useState, useEffect, useCallback, useRef } from 'react'
import {
  X, Globe, CheckCircle2, RefreshCw, AlertCircle,
  Edit2, Play, Pause, RotateCcw, ChevronDown, ChevronUp,
  Loader2, Wand2, Save, Volume2,
} from 'lucide-react'
import { cn } from '@/lib/utils'

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface Translation {
  id?: string
  language: string
  gender: string
  name: string | null
  description: string | null
  audio_url: string | null
  status: 'pending' | 'generating' | 'ready' | 'failed' | null
  manually_edited: boolean
  manually_edited_at: string | null
  updated_at: string | null
}

interface OriginalData {
  name: string
  description: string | null
}

interface Props {
  routeId: string
  routeName: string
  onClose: () => void
}

// ─── Idiomas suportados ───────────────────────────────────────────────────────

const LANGUAGES = [
  { code: 'pt-br', name: 'Português (BR)', flag: '🇧🇷', isOriginal: true },
  { code: 'en-us', name: 'Inglês (EUA)',   flag: '🇺🇸' },
  { code: 'en-gb', name: 'Inglês (UK)',    flag: '🇬🇧' },
  { code: 'fr-fr', name: 'Francês',        flag: '🇫🇷' },
  { code: 'de-de', name: 'Alemão',         flag: '🇩🇪' },
  { code: 'es-es', name: 'Espanhol',       flag: '🇪🇸' },
  { code: 'it-it', name: 'Italiano',       flag: '🇮🇹' },
  { code: 'ja-jp', name: 'Japonês',        flag: '🇯🇵' },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

function StatusBadge({ status, manuallyEdited }: { status: Translation['status'] | 'original'; manuallyEdited?: boolean }) {
  if (status === 'original') {
    return <span className="flex items-center gap-1 text-[10px] font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">● Original</span>
  }
  if (manuallyEdited && status === 'ready') {
    return <span className="flex items-center gap-1 text-[10px] font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full"><Edit2 className="h-2.5 w-2.5" /> Editado</span>
  }
  if (status === 'ready') {
    return <span className="flex items-center gap-1 text-[10px] font-bold text-green-600 bg-green-50 px-2 py-0.5 rounded-full"><CheckCircle2 className="h-2.5 w-2.5" /> Pronto</span>
  }
  if (status === 'generating') {
    return <span className="flex items-center gap-1 text-[10px] font-bold text-gray-500 bg-gray-50 px-2 py-0.5 rounded-full"><Loader2 className="h-2.5 w-2.5 animate-spin" /> Gerando</span>
  }
  if (status === 'failed') {
    return <span className="flex items-center gap-1 text-[10px] font-bold text-red-600 bg-red-50 px-2 py-0.5 rounded-full"><AlertCircle className="h-2.5 w-2.5" /> Falhou</span>
  }
  return <span className="text-[10px] font-bold text-gray-400">— Não gerado</span>
}

// ─── Componente principal ─────────────────────────────────────────────────────

export function RouteTranslationsPanel({ routeId, routeName, onClose }: Props) {
  const [original, setOriginal] = useState<OriginalData | null>(null)
  const [translations, setTranslations] = useState<Translation[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [expandedLang, setExpandedLang] = useState<string | null>(null)
  const [generatingLangs, setGeneratingLangs] = useState<Set<string>>(new Set())
  const [isBatchGenerating, setIsBatchGenerating] = useState(false)
  const [editState, setEditState] = useState<Record<string, { name: string; description: string }>>({})
  const [savingLangs, setSavingLangs] = useState<Set<string>>(new Set())
  const [playingAudio, setPlayingAudio] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // ── Fetch ────────────────────────────────────────────────────────────────────

  const fetchTranslations = useCallback(async () => {
    try {
      const res = await fetch(`/api/routes/${routeId}/translations`)
      if (!res.ok) return
      const data = await res.json()
      setOriginal(data.original)
      setTranslations(data.translations ?? [])
    } finally {
      setIsLoading(false)
    }
  }, [routeId])

  useEffect(() => {
    fetchTranslations()
  }, [fetchTranslations])

  // Polling: re-fetch a cada 3s se há algum idioma gerando
  useEffect(() => {
    const hasGenerating = translations.some(t => t.status === 'generating') || generatingLangs.size > 0
    if (hasGenerating) {
      pollingRef.current = setInterval(fetchTranslations, 3000)
    } else {
      if (pollingRef.current) clearInterval(pollingRef.current)
    }
    return () => { if (pollingRef.current) clearInterval(pollingRef.current) }
  }, [translations, generatingLangs, fetchTranslations])

  // ── Helpers de lookup ─────────────────────────────────────────────────────

  const getTranslation = (langCode: string) =>
    translations.find(t => t.language === langCode && t.gender === 'male') ?? null

  const readyCount = translations.filter(t => t.status === 'ready').length

  // ── Gerar tradução (EF) ───────────────────────────────────────────────────

  const generateTranslation = async (langCode: string, force = false) => {
    const existing = getTranslation(langCode)
    if (existing?.manually_edited && !force) {
      if (!confirm(`"${LANGUAGES.find(l => l.code === langCode)?.name}" foi editado manualmente. Isso irá substituir o texto. Continuar?`)) return
    }

    setGeneratingLangs(prev => new Set(prev).add(langCode))
    try {
      await fetch(`/api/routes/${routeId}/translations/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language: langCode, gender: 'male', generateAudio: true }),
      })
      await fetchTranslations()
    } catch (e) {
      console.error('Generate failed:', e)
    } finally {
      setGeneratingLangs(prev => { const s = new Set(prev); s.delete(langCode); return s })
    }
  }

  // ── Gerar todos os pendentes ──────────────────────────────────────────────

  const generateAllPending = async () => {
    const pending = LANGUAGES.filter(lang => {
      if (lang.isOriginal) return false
      const t = getTranslation(lang.code)
      return !t || t.status === 'failed' || t.status === null
    })
    if (pending.length === 0) return

    setIsBatchGenerating(true)
    for (const lang of pending) {
      await generateTranslation(lang.code)
    }
    setIsBatchGenerating(false)
  }

  // ── Salvar edição manual ──────────────────────────────────────────────────

  const saveManualEdit = async (langCode: string) => {
    const state = editState[langCode]
    if (!state) return

    setSavingLangs(prev => new Set(prev).add(langCode))
    try {
      await fetch(`/api/routes/${routeId}/translations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language: langCode, gender: 'male', name: state.name, description: state.description }),
      })
      await fetchTranslations()
      setExpandedLang(null)
    } finally {
      setSavingLangs(prev => { const s = new Set(prev); s.delete(langCode); return s })
    }
  }

  // ── Abrir editor ─────────────────────────────────────────────────────────

  const openEditor = (langCode: string) => {
    const t = getTranslation(langCode)
    setEditState(prev => ({
      ...prev,
      [langCode]: {
        name:        t?.name        ?? '',
        description: t?.description ?? '',
      }
    }))
    setExpandedLang(prev => prev === langCode ? null : langCode)
  }

  // ── Áudio ────────────────────────────────────────────────────────────────

  const toggleAudio = (langCode: string, audioUrl: string) => {
    if (playingAudio === langCode) {
      audioRef.current?.pause()
      setPlayingAudio(null)
    } else {
      if (audioRef.current) audioRef.current.pause()
      audioRef.current = new Audio(audioUrl)
      audioRef.current.onended = () => setPlayingAudio(null)
      audioRef.current.play()
      setPlayingAudio(langCode)
    }
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  const pendingCount = LANGUAGES.filter(lang => {
    if (lang.isOriginal) return false
    const t = getTranslation(lang.code)
    return !t || t.status === 'failed'
  }).length

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 z-40 transition-opacity"
        onClick={onClose}
      />

      {/* Slide-over panel */}
      <div className="fixed right-0 top-0 h-full w-[480px] max-w-full bg-white dark:bg-gray-900 shadow-2xl z-50 flex flex-col animate-in slide-in-from-right duration-300">

        {/* Header */}
        <div className="flex items-start justify-between p-6 border-b border-gray-100 dark:border-gray-800">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-50 dark:bg-indigo-900/30 rounded-xl">
              <Globe className="h-5 w-5 text-indigo-500" />
            </div>
            <div>
              <h2 className="text-base font-bold text-gray-900 dark:text-white">Traduções</h2>
              <p className="text-[11px] text-gray-400 truncate max-w-[280px]">{routeName}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold text-green-600 bg-green-50 px-2 py-1 rounded-full">
              {readyCount}/{LANGUAGES.length - 1} prontos
            </span>
            <button onClick={onClose} className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
              <X className="h-4 w-4 text-gray-500" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2 custom-scrollbar">
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
            </div>
          ) : (
            LANGUAGES.map(lang => {
              const t = getTranslation(lang.code)
              const isExpanded = expandedLang === lang.code
              const isGenerating = generatingLangs.has(lang.code) || t?.status === 'generating'
              const isSaving = savingLangs.has(lang.code)
              const edit = editState[lang.code]

              return (
                <div
                  key={lang.code}
                  className={cn(
                    "rounded-2xl border transition-all overflow-hidden",
                    isExpanded
                      ? "border-indigo-200 dark:border-indigo-800 bg-indigo-50/30 dark:bg-indigo-900/10"
                      : "border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-800/50"
                  )}
                >
                  {/* Row header */}
                  <div className="flex items-center gap-3 p-3">
                    <span className="text-xl shrink-0">{lang.flag}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-xs font-semibold text-gray-800 dark:text-gray-200">{lang.name}</p>
                        <StatusBadge
                          status={lang.isOriginal ? 'original' : (t?.status ?? null)}
                          manuallyEdited={t?.manually_edited}
                        />
                      </div>
                      {/* Name preview */}
                      {lang.isOriginal ? (
                        <p className="text-[10px] text-gray-400 truncate mt-0.5">{original?.name}</p>
                      ) : t?.name ? (
                        <p className="text-[10px] text-gray-400 truncate mt-0.5">{t.name}</p>
                      ) : null}
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1 shrink-0">
                      {/* Play audio */}
                      {t?.audio_url && !lang.isOriginal && (
                        <button
                          onClick={() => toggleAudio(lang.code, t.audio_url!)}
                          className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                          title="Ouvir áudio"
                        >
                          {playingAudio === lang.code
                            ? <Pause className="h-3.5 w-3.5 text-indigo-500" />
                            : <Volume2 className="h-3.5 w-3.5 text-gray-400" />
                          }
                        </button>
                      )}

                      {/* Edit button */}
                      {(t?.status === 'ready' || lang.isOriginal) && (
                        <button
                          onClick={() => !lang.isOriginal && openEditor(lang.code)}
                          disabled={lang.isOriginal}
                          className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors disabled:opacity-40 disabled:cursor-default"
                          title="Editar tradução"
                        >
                          <Edit2 className="h-3.5 w-3.5 text-gray-400" />
                        </button>
                      )}

                      {/* Generate / Retry */}
                      {!lang.isOriginal && (
                        <button
                          onClick={() => generateTranslation(lang.code, t?.status === 'ready')}
                          disabled={isGenerating || isBatchGenerating}
                          className={cn(
                            "px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all flex items-center gap-1",
                            t?.status === 'ready'
                              ? "text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700"
                              : t?.status === 'failed'
                              ? "text-red-600 bg-red-50 hover:bg-red-100"
                              : "text-indigo-600 bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-900/30"
                          )}
                        >
                          {isGenerating
                            ? <><Loader2 className="h-3 w-3 animate-spin" /> Gerando</>
                            : t?.status === 'ready'
                            ? <><RotateCcw className="h-3 w-3" /> Regerar</>
                            : t?.status === 'failed'
                            ? <><AlertCircle className="h-3 w-3" /> Tentar</>
                            : <><Wand2 className="h-3 w-3" /> Gerar</>
                          }
                        </button>
                      )}

                      {/* Expand / collapse */}
                      {t?.status === 'ready' && !lang.isOriginal && (
                        <button
                          onClick={() => openEditor(lang.code)}
                          className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                        >
                          {isExpanded
                            ? <ChevronUp className="h-3.5 w-3.5 text-gray-400" />
                            : <ChevronDown className="h-3.5 w-3.5 text-gray-400" />
                          }
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Expanded editor */}
                  {isExpanded && edit && (
                    <div className="px-4 pb-4 space-y-3 border-t border-indigo-100 dark:border-indigo-800/30 pt-3">
                      {t?.manually_edited && (
                        <p className="text-[10px] text-amber-600 flex items-center gap-1">
                          <Edit2 className="h-3 w-3" />
                          Editado manualmente em {new Date(t.manually_edited_at!).toLocaleDateString('pt-BR')}
                        </p>
                      )}

                      <div>
                        <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Nome</label>
                        <input
                          type="text"
                          value={edit.name}
                          onChange={e => setEditState(prev => ({ ...prev, [lang.code]: { ...prev[lang.code], name: e.target.value } }))}
                          className="w-full px-3 py-2 text-xs bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl focus:ring-1 focus:ring-indigo-400 outline-none"
                        />
                      </div>

                      <div>
                        <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Descrição</label>
                        <textarea
                          value={edit.description}
                          onChange={e => setEditState(prev => ({ ...prev, [lang.code]: { ...prev[lang.code], description: e.target.value } }))}
                          rows={4}
                          className="w-full px-3 py-2 text-xs bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl focus:ring-1 focus:ring-indigo-400 outline-none resize-none"
                        />
                      </div>

                      {t?.audio_url && (
                        <div className="flex items-center gap-2 p-2 bg-gray-50 dark:bg-gray-800 rounded-xl">
                          <Volume2 className="h-3.5 w-3.5 text-gray-400 shrink-0" />
                          <p className="text-[10px] text-gray-500 flex-1 truncate">Áudio disponível</p>
                          <button
                            onClick={() => toggleAudio(lang.code, t.audio_url!)}
                            className="text-[10px] font-bold text-indigo-600 hover:underline"
                          >
                            {playingAudio === lang.code ? '⏸ Pausar' : '▶ Ouvir'}
                          </button>
                        </div>
                      )}

                      <div className="flex gap-2 pt-1">
                        <button
                          onClick={() => setExpandedLang(null)}
                          className="flex-1 py-2 text-xs font-bold text-gray-500 border border-gray-200 dark:border-gray-700 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800 transition-all"
                        >
                          Cancelar
                        </button>
                        <button
                          onClick={() => generateTranslation(lang.code, true)}
                          disabled={isGenerating}
                          className="px-3 py-2 text-xs font-bold text-gray-600 border border-gray-200 dark:border-gray-700 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800 transition-all flex items-center gap-1 disabled:opacity-50"
                        >
                          <Wand2 className="h-3 w-3" /> IA
                        </button>
                        <button
                          onClick={() => saveManualEdit(lang.code)}
                          disabled={isSaving}
                          className="flex-1 py-2 text-xs font-bold text-white bg-indigo-500 hover:bg-indigo-600 rounded-xl transition-all flex items-center justify-center gap-1 disabled:opacity-50"
                        >
                          {isSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                          Salvar
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>

        {/* Footer — Gerar todos */}
        {pendingCount > 0 && (
          <div className="p-4 border-t border-gray-100 dark:border-gray-800">
            <button
              onClick={generateAllPending}
              disabled={isBatchGenerating}
              className="w-full py-3 bg-indigo-500 hover:bg-indigo-600 text-white font-bold rounded-2xl transition-all flex items-center justify-center gap-2 text-sm disabled:opacity-50"
            >
              {isBatchGenerating
                ? <><Loader2 className="h-4 w-4 animate-spin" /> Gerando em sequência...</>
                : <><Wand2 className="h-4 w-4" /> Gerar {pendingCount} idioma{pendingCount > 1 ? 's' : ''} pendente{pendingCount > 1 ? 's' : ''}</>
              }
            </button>
          </div>
        )}
      </div>
    </>
  )
}
