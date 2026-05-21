'use client'

import React, { useState, useEffect, useCallback, useRef } from 'react'
import {
  Globe, CheckCircle2, RefreshCw, AlertCircle,
  Edit2, Play, Pause, RotateCcw, ChevronDown, ChevronUp,
  Loader2, Wand2, Save, Volume2, X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  ROUTE_LANGUAGES,
  TRANSLATABLE_LANGS,
  DEFAULT_SELECTED_LANGS,
  type RouteLang,
} from '@/lib/constants/route-languages'

// ─── Tipos ─────────────────────────────────────────────────────────────────────

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
  onClose?: () => void
  inline?: boolean
}

// SSOT: language lists come from lib/constants/route-languages.ts
// Local aliases for legibility within this file
const TRANSLATABLE_LANGUAGES = TRANSLATABLE_LANGS
const ALL_LANGUAGES: Array<RouteLang & { isOriginal?: boolean }> = ROUTE_LANGUAGES.map(l => ({
  ...l,
  isOriginal: l.isBase,
}))

// ─── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({
  status, manuallyEdited, hasAudio,
}: { status: Translation['status'] | 'original'; manuallyEdited?: boolean; hasAudio?: boolean }) {
  if (status === 'original')
    return (
      <span className="flex items-center gap-0.5 text-[9px] font-bold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded-full">
        Original
        {hasAudio && <Volume2 className="h-2 w-2 ml-0.5 text-blue-500" />}
      </span>
    )
  if (manuallyEdited && status === 'ready')
    return <span className="flex items-center gap-0.5 text-[9px] font-bold text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-full"><Edit2 className="h-2 w-2" />Editado</span>
  if (status === 'ready')
    return <span className="flex items-center gap-0.5 text-[9px] font-bold text-green-600 bg-green-50 px-1.5 py-0.5 rounded-full"><CheckCircle2 className="h-2 w-2" />Pronto</span>
  if (status === 'generating')
    return <span className="flex items-center gap-0.5 text-[9px] font-bold text-gray-500 bg-gray-50 px-1.5 py-0.5 rounded-full"><Loader2 className="h-2 w-2 animate-spin" />Gerando</span>
  if (status === 'failed')
    return <span className="flex items-center gap-0.5 text-[9px] font-bold text-red-600 bg-red-50 px-1.5 py-0.5 rounded-full"><AlertCircle className="h-2 w-2" />Falhou</span>
  return <span className="text-[9px] font-bold text-gray-400 bg-gray-50 px-1.5 py-0.5 rounded-full">— Pendente</span>
}

// ─── Componente principal ──────────────────────────────────────────────────────

export function RouteTranslationsPanel({ routeId, routeName, onClose, inline = false }: Props) {
  const [original,      setOriginal]      = useState<OriginalData | null>(null)
  const [translations,  setTranslations]  = useState<Translation[]>([])
  const [isLoading,     setIsLoading]     = useState(true)
  const [expandedLang,  setExpandedLang]  = useState<string | null>(null)
  const [generatingLangs, setGeneratingLangs] = useState<Set<string>>(new Set())
  const [isBatchGenerating, setIsBatchGenerating] = useState(false)
  const [batchProgress, setBatchProgress] = useState({ current: 0, total: 0 })
  const [editState,     setEditState]     = useState<Record<string, { name: string; description: string }>>({})
  const [savingLangs,   setSavingLangs]   = useState<Set<string>>(new Set())
  const [playingAudio,  setPlayingAudio]  = useState<string | null>(null)
  const audioRef   = useRef<HTMLAudioElement | null>(null)
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // ── Language selection (POI pattern) ─────────────────────────────────────────
  // Default: select the 4 most common translation targets (SSOT from route-languages.ts)
  const [selectedLangs, setSelectedLangs] = useState<string[]>(DEFAULT_SELECTED_LANGS)

  const toggleLang = (code: string) =>
    setSelectedLangs(prev =>
      prev.includes(code) ? prev.filter(c => c !== code) : [...prev, code]
    )

  // ── Fetch ─────────────────────────────────────────────────────────────────────

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

  useEffect(() => { fetchTranslations() }, [fetchTranslations])

  // Polling when any language is generating
  useEffect(() => {
    const hasGenerating = translations.some(t => t.status === 'generating') || generatingLangs.size > 0
    if (hasGenerating) {
      pollingRef.current = setInterval(fetchTranslations, 3000)
    } else {
      if (pollingRef.current) clearInterval(pollingRef.current)
    }
    return () => { if (pollingRef.current) clearInterval(pollingRef.current) }
  }, [translations, generatingLangs, fetchTranslations])

  // ── Helpers ────────────────────────────────────────────────────────────────────

  const getTranslation = (code: string) =>
    translations.find(t => t.language === code && t.gender === 'male') ?? null

  const readyCount = translations.filter(t => t.status === 'ready').length

  // ── Generate single ────────────────────────────────────────────────────────────

  const generateTranslation = async (langCode: string, force = false) => {
    const existing = getTranslation(langCode)
    const langName = TRANSLATABLE_LANGUAGES.find(l => l.code === langCode)?.name ?? langCode
    if (existing?.manually_edited && !force) {
      if (!confirm(`"${langName}" foi editado manualmente. Isso irá substituir o texto. Continuar?`)) return
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

  // ── Generate selected (main batch action) ────────────────────────────────────

  const generateSelected = async () => {
    if (selectedLangs.length === 0) return
    setIsBatchGenerating(true)
    setBatchProgress({ current: 0, total: selectedLangs.length })
    let done = 0
    for (const code of selectedLangs) {
      await generateTranslation(code)
      done++
      setBatchProgress({ current: done, total: selectedLangs.length })
    }
    setIsBatchGenerating(false)
    setBatchProgress({ current: 0, total: 0 })
  }

  // ── Manual edit ───────────────────────────────────────────────────────────────

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

  const openEditor = (langCode: string) => {
    const t = getTranslation(langCode)
    setEditState(prev => ({
      ...prev,
      [langCode]: { name: t?.name ?? '', description: t?.description ?? '' },
    }))
    setExpandedLang(prev => prev === langCode ? null : langCode)
  }

  // ── Audio ──────────────────────────────────────────────────────────────────────

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

  // ─── Render ───────────────────────────────────────────────────────────────────

  const containerClass = inline
    ? 'flex flex-col h-full overflow-hidden'
    : 'fixed right-0 top-0 h-full w-[480px] max-w-full bg-white dark:bg-gray-900 shadow-2xl z-50 flex flex-col animate-in slide-in-from-right duration-300'

  return (
    <>
      {!inline && (
        <div className="fixed inset-0 bg-black/40 z-40 transition-opacity" onClick={onClose} />
      )}

      <div className={containerClass}>

        {/* Header slide-over */}
        {!inline && (
          <div className="flex items-center justify-between p-5 border-b border-gray-100 dark:border-gray-800 shrink-0">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-indigo-50 dark:bg-indigo-900/30 rounded-xl">
                <Globe className="h-5 w-5 text-indigo-500" />
              </div>
              <div>
                <h2 className="text-sm font-bold text-gray-900 dark:text-white">Traduções</h2>
                <p className="text-[10px] text-gray-400 truncate max-w-[280px]">{routeName}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold text-green-600 bg-green-50 px-2 py-1 rounded-full">
                {readyCount}/{TRANSLATABLE_LANGUAGES.length} prontos
              </span>
              <button onClick={onClose} className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
                <X className="h-4 w-4 text-gray-500" />
              </button>
            </div>
          </div>
        )}

        {/* Inline header */}
        {inline && (
          <div className="flex items-center justify-between px-4 pt-4 pb-2 shrink-0">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Traduções</p>
            <span className="text-[10px] font-bold text-green-600 bg-green-50 px-2 py-1 rounded-full">
              {readyCount}/{TRANSLATABLE_LANGUAGES.length}
            </span>
          </div>
        )}

        <div className="flex-1 overflow-y-auto custom-scrollbar">

          {/* ── SECTION 1: Language selection grid (POI pattern) ─────────────── */}
          <div className="px-4 pb-3">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3">
              Selecionar idiomas
            </p>

            {/* Grid of flag cards */}
            <div className="grid grid-cols-4 gap-1.5">
              {TRANSLATABLE_LANGUAGES.map(lang => {
                const isSelected = selectedLangs.includes(lang.code)
                const tStatus = getTranslation(lang.code)?.status
                return (
                  <label
                    key={lang.code}
                    className={cn(
                      'relative flex flex-col items-center justify-center h-16 rounded-xl border cursor-pointer transition-all duration-200 text-center group select-none',
                      isSelected
                        ? 'bg-tuggi-blue/8 border-tuggi-blue ring-1 ring-tuggi-blue/20 shadow-sm'
                        : 'bg-white dark:bg-gray-800/50 border-gray-100 dark:border-gray-800 hover:border-tuggi-blue/30'
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleLang(lang.code)}
                      className="sr-only"
                    />
                    {/* Status dot */}
                    {tStatus && (
                      <div className={cn(
                        'absolute top-1.5 right-1.5 w-2 h-2 rounded-full',
                        tStatus === 'ready'      ? 'bg-green-400'  :
                        tStatus === 'generating' ? 'bg-amber-400 animate-pulse' :
                        tStatus === 'failed'     ? 'bg-red-400'    : 'bg-gray-300'
                      )} />
                    )}
                    <span className="text-xl mb-0.5 transition-transform group-hover:scale-110 duration-200">
                      {lang.flag}
                    </span>
                    <span className={cn(
                      'text-[9px] font-black uppercase tracking-tight leading-none',
                      isSelected ? 'text-tuggi-blue' : 'text-gray-600 dark:text-gray-400'
                    )}>
                      {lang.sub ?? lang.name}
                    </span>
                  </label>
                )
              })}
            </div>

            {/* Selected count + select all/none */}
            <div className="flex items-center justify-between mt-2">
              <p className="text-[10px] text-gray-400">
                {selectedLangs.length} idioma{selectedLangs.length !== 1 ? 's' : ''} selecionado{selectedLangs.length !== 1 ? 's' : ''}
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setSelectedLangs(TRANSLATABLE_LANGUAGES.map(l => l.code))}
                  className="text-[10px] text-tuggi-blue hover:underline font-semibold"
                >
                  Todos
                </button>
                <button
                  onClick={() => setSelectedLangs([])}
                  className="text-[10px] text-gray-400 hover:text-gray-600 hover:underline font-semibold"
                >
                  Nenhum
                </button>
              </div>
            </div>

            {/* Generate button */}
            <button
              onClick={generateSelected}
              disabled={selectedLangs.length === 0 || isBatchGenerating}
              className="mt-3 w-full py-2.5 bg-tuggi-blue hover:bg-tuggi-blue/90 text-white font-bold rounded-2xl transition-all flex items-center justify-center gap-2 text-xs disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-tuggi-blue/20 active:scale-[0.98]"
            >
              {isBatchGenerating ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  {batchProgress.total > 0
                    ? `Gerando ${batchProgress.current}/${batchProgress.total}…`
                    : 'Gerando…'
                  }
                </>
              ) : (
                <>
                  <Wand2 className="h-3.5 w-3.5" />
                  Gerar {selectedLangs.length > 0 ? `${selectedLangs.length} ` : ''}idioma{selectedLangs.length !== 1 ? 's' : ''} selecionado{selectedLangs.length !== 1 ? 's' : ''}
                </>
              )}
            </button>

            {/* Progress bar */}
            {isBatchGenerating && batchProgress.total > 0 && (
              <div className="mt-2 h-1.5 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-tuggi-blue transition-all duration-500 rounded-full"
                  style={{ width: `${(batchProgress.current / batchProgress.total) * 100}%` }}
                />
              </div>
            )}
          </div>

          {/* ── SECTION 2: Status list ──────────────────────────────────────── */}
          <div className="px-4 pb-4">
            <div className="border-t border-gray-100 dark:border-gray-800 pt-3 space-y-1">
              {isLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
                </div>
              ) : (
                ALL_LANGUAGES.map(lang => {
                  const tr         = getTranslation(lang.code)
                  const isExpanded = expandedLang === lang.code
                  const isGen      = generatingLangs.has(lang.code) || tr?.status === 'generating'
                  const isSav      = savingLangs.has(lang.code)
                  const edit       = editState[lang.code]

                  return (
                    <div
                      key={lang.code}
                      className={cn(
                        'rounded-xl border transition-all overflow-hidden',
                        isExpanded
                          ? 'border-indigo-200 dark:border-indigo-800 bg-indigo-50/30 dark:bg-indigo-900/10'
                          : 'border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-800/30'
                      )}
                    >
                      {/* Row */}
                      <div className="flex items-center gap-2 px-3 py-2">
                        <span className="text-base shrink-0">{lang.flag}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <p className="text-xs font-semibold text-gray-800 dark:text-gray-200 truncate">{lang.name}</p>
                            <StatusBadge
                              status={lang.isOriginal ? 'original' : (tr?.status ?? null)}
                              manuallyEdited={tr?.manually_edited}
                              hasAudio={lang.isOriginal ? Boolean(tr?.audio_url) : undefined}
                            />
                          </div>
                          {lang.isOriginal
                            ? <p className="text-[9px] text-gray-400 truncate">{original?.name}</p>
                            : tr?.name
                              ? <p className="text-[9px] text-gray-400 truncate">{tr.name}</p>
                              : null
                          }
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-0.5 shrink-0">

                          {/* Play audio — available for ALL languages including original */}
                          {tr?.audio_url && (
                            <button
                              onClick={() => toggleAudio(lang.code, tr.audio_url!)}
                              className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                              title="Ouvir áudio"
                            >
                              {playingAudio === lang.code
                                ? <Pause className="h-3 w-3 text-indigo-500" />
                                : <Volume2 className="h-3 w-3 text-gray-400" />
                              }
                            </button>
                          )}

                          {/* Original language: show generate-audio button when no audio yet */}
                          {lang.isOriginal && !tr?.audio_url && (
                            <button
                              onClick={() => generateTranslation(lang.code)}
                              disabled={isGen || isBatchGenerating}
                              className="px-2 py-1 rounded-lg text-[9px] font-bold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 transition-all flex items-center gap-1 disabled:opacity-40"
                              title="Gerar áudio da descrição original"
                            >
                              {isGen
                                ? <><Loader2 className="h-2.5 w-2.5 animate-spin" /> Gerando</>
                                : <><Volume2 className="h-2.5 w-2.5" /> Gerar áudio</>
                              }
                            </button>
                          )}

                          {/* Edit — always visible for translated languages (write directly or edit existing) */}
                          {!lang.isOriginal && (
                            <button
                              onClick={() => openEditor(lang.code)}
                              className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                              title="Escrever / editar"
                            >
                              <Edit2 className={cn('h-3 w-3', tr?.status === 'ready' ? 'text-gray-400' : 'text-gray-300')} />
                            </button>
                          )}
                          {!lang.isOriginal && (tr?.status === 'failed' || tr?.status === 'ready') && (
                            <button
                              onClick={() => generateTranslation(lang.code, tr?.status === 'ready')}
                              disabled={isGen || isBatchGenerating}
                              className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors disabled:opacity-40"
                              title={tr?.status === 'ready' ? 'Regerar' : 'Tentar novamente'}
                            >
                              {isGen
                                ? <Loader2 className="h-3 w-3 animate-spin text-gray-400" />
                                : <RotateCcw className="h-3 w-3 text-gray-400" />
                              }
                            </button>
                          )}
                          {/* Chevron to open/close editor — always for non-original */}
                          {!lang.isOriginal && (
                            <button
                              onClick={() => openEditor(lang.code)}
                              className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                            >
                              {isExpanded
                                ? <ChevronUp className="h-3 w-3 text-gray-400" />
                                : <ChevronDown className="h-3 w-3 text-gray-400" />
                              }
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Editor expanded */}
                      {isExpanded && edit && (
                        <div className="px-3 pb-3 space-y-2 border-t border-indigo-100 dark:border-indigo-800/30 pt-2">
                          {/* Context hint: new vs editing */}
                          {!tr && (
                            <p className="text-[9px] text-indigo-600 bg-indigo-50 px-2 py-1 rounded-lg flex items-center gap-1">
                              <Edit2 className="h-2.5 w-2.5 shrink-0" />
                              Escreve directamente em {TRANSLATABLE_LANGUAGES.find(l => l.code === lang.code)?.name ?? lang.code} sem precisar de gerar pela IA.
                            </p>
                          )}
                          {tr?.manually_edited && (
                            <p className="text-[9px] text-amber-600 flex items-center gap-1">
                              <Edit2 className="h-2.5 w-2.5" />
                              Editado em {new Date(tr.manually_edited_at!).toLocaleDateString('pt-BR')}
                            </p>
                          )}
                          <div>
                            <label className="block text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-1">Nome</label>
                            <input
                              type="text"
                              value={edit.name}
                              onChange={e => setEditState(prev => ({ ...prev, [lang.code]: { ...prev[lang.code], name: e.target.value } }))}
                              className="w-full px-2.5 py-1.5 text-xs bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl focus:ring-1 focus:ring-indigo-400 outline-none"
                            />
                          </div>
                          <div>
                            <label className="block text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-1">Descrição</label>
                            <textarea
                              value={edit.description}
                              onChange={e => setEditState(prev => ({ ...prev, [lang.code]: { ...prev[lang.code], description: e.target.value } }))}
                              rows={3}
                              className="w-full px-2.5 py-1.5 text-xs bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl focus:ring-1 focus:ring-indigo-400 outline-none resize-none"
                            />
                          </div>
                          {tr?.audio_url && (
                            <div className="flex items-center gap-2 p-2 bg-gray-50 dark:bg-gray-800 rounded-lg">
                              <Volume2 className="h-3 w-3 text-gray-400 shrink-0" />
                              <p className="text-[9px] text-gray-500 flex-1">Áudio disponível</p>
                              <button
                                onClick={() => toggleAudio(lang.code, tr.audio_url!)}
                                className="text-[9px] font-bold text-indigo-600 hover:underline"
                              >
                                {playingAudio === lang.code ? '⏸ Pausar' : '▶ Ouvir'}
                              </button>
                            </div>
                          )}
                          <div className="flex gap-1.5 pt-0.5">
                            <button
                              onClick={() => setExpandedLang(null)}
                              className="flex-1 py-1.5 text-[10px] font-bold text-gray-500 border border-gray-200 dark:border-gray-700 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800 transition-all"
                            >
                              Cancelar
                            </button>
                            <button
                              onClick={() => generateTranslation(lang.code, true)}
                              disabled={isGen}
                              className="px-2.5 py-1.5 text-[10px] font-bold text-gray-600 border border-gray-200 dark:border-gray-700 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800 transition-all flex items-center gap-1 disabled:opacity-50"
                            >
                              <Wand2 className="h-2.5 w-2.5" /> IA
                            </button>
                            <button
                              onClick={() => saveManualEdit(lang.code)}
                              disabled={isSav}
                              className="flex-1 py-1.5 text-[10px] font-bold text-white bg-indigo-500 hover:bg-indigo-600 rounded-xl transition-all flex items-center justify-center gap-1 disabled:opacity-50"
                            >
                              {isSav ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Save className="h-2.5 w-2.5" />}
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
          </div>

        </div>
      </div>
    </>
  )
}
