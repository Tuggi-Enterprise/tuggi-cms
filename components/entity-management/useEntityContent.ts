'use client'

/**
 * useEntityContent — implementa as features de CONTEÚDO (descrição, áudio, tradução
 * do nome, tradução da descrição, áudio por idioma) para Eventos e Locais, reusando
 * o MESMO substrato dos POIs: core.attraction_descriptions (keyed por attraction_id)
 * + as edge functions generate-description / generate-translated-audio (kind-agnostic).
 *
 * Espelha os handlers de POIDetailsModal, mas enxuto para o entity-management. É
 * consumido por useEntityModalContext e renderizado pelas abas DescriptionTab /
 * NarrationAudioTab (que leem tudo de POIModalContext).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getSupabaseClient } from '@/lib/core/supabase-client'
import { useAuthenticatedFunctionCall } from '@/lib/hooks/useAuthenticatedFunctionCall'
import { upsertPoiName, deleteDescription } from '@/lib/core/poi-descriptions-service'

interface Options {
  entityId: string
  name: string
  showFeedback: (message: string, type: 'success' | 'error') => void
  requestConfirm: (message: string) => Promise<boolean>
  invalidate: () => void
}

export interface EntityContent {
  isLoading: boolean
  descriptions: any[]
  translatedDescriptions: any[]
  currentDescription: string
  setCurrentDescription: (v: string) => void
  originalDescription: string
  currentName: string
  setCurrentName: (v: string) => void
  originalName: string
  currentAudioUrl: string | null
  generationLanguage: string
  setGenerationLanguage: (v: string) => void
  selectedGender: 'male' | 'female'
  setSelectedGender: (v: 'male' | 'female') => void
  selectedLanguages: string[]
  setSelectedLanguages: (v: string[]) => void
  audioDuration: number
  setAudioDuration: (v: number) => void
  referenceLinks: string[]
  setReferenceLinks: (v: string[]) => void
  verificationResult: any
  audioProgress: { current: number; total: number; currentTask: string }
  audioResults: string[]
  showResults: boolean
  setShowResults: (v: boolean) => void
  isGenerating: boolean
  isGeneratingAudio: boolean
  isSavingDescription: boolean
  isSavingName: boolean
  isTranslatingName: boolean
  isTranslating: boolean
  isSavingReferenceLinks: boolean
  fetchAdditionalData: (forceId?: string, forceUpdate?: boolean) => Promise<void>
  generateDescription: () => Promise<void>
  resetDescription: () => void
  saveDescriptionAndNextStep: () => Promise<void>
  saveReferenceLinks: () => Promise<void>
  translateName: () => Promise<void>
  savePoiName: () => Promise<void>
  regenerateAllAudios: () => Promise<void>
  regenerateTranslation: (language: string, gender: string) => Promise<void>
  deleteTranslation: (id: string, language: string, gender: string) => Promise<void>
}

const langMatches = (rowLang: string | null, target: string) => {
  const r = (rowLang || '').toLowerCase(), t = target.toLowerCase()
  return r === t || r === t.split('-')[0]
}

export function useEntityContent(opts: Options): EntityContent {
  const { entityId, name, showFeedback, requestConfirm, invalidate } = opts
  const supabase = getSupabaseClient()
  const { callFunction } = useAuthenticatedFunctionCall()

  const [isLoading, setIsLoading] = useState(false)
  const [descriptions, setDescriptions] = useState<any[]>([])
  const [translatedDescriptions, setTranslatedDescriptions] = useState<any[]>([])
  const [currentDescription, setCurrentDescription] = useState('')
  const [originalDescription, setOriginalDescription] = useState('')
  const [currentName, setCurrentName] = useState('')
  const [currentAudioUrl, setCurrentAudioUrl] = useState<string | null>(null)
  const [generationLanguage, setGenerationLanguage] = useState('pt-br')
  const [selectedGender, setSelectedGender] = useState<'male' | 'female'>('male')
  const [selectedLanguages, setSelectedLanguages] = useState<string[]>(['pt-br', 'en-us', 'es-es'])
  const [audioDuration, setAudioDuration] = useState(30)
  const [referenceLinks, setReferenceLinks] = useState<string[]>([])
  const [verificationResult, setVerificationResult] = useState<any>(null)
  const [audioProgress, setAudioProgress] = useState({ current: 0, total: 0, currentTask: '' })
  const [audioResults, setAudioResults] = useState<string[]>([])
  const [showResults, setShowResults] = useState(false)

  const [isGenerating, setIsGenerating] = useState(false)
  const [isGeneratingAudio, setIsGeneratingAudio] = useState(false)
  const [isSavingDescription, setIsSavingDescription] = useState(false)
  const [isSavingName, setIsSavingName] = useState(false)
  const [isTranslatingName, setIsTranslatingName] = useState(false)
  const [isTranslating, setIsTranslating] = useState(false)
  const [isSavingReferenceLinks, setIsSavingReferenceLinks] = useState(false)

  const lastGenAt = useRef(0)
  const descRef = useRef('')
  descRef.current = currentDescription

  const applyLanguageRow = useCallback((rows: any[], lang: string, force: boolean) => {
    const row = rows.find((d) => langMatches(d.language, lang)) || null
    setCurrentName(row?.name || '')
    const isRecent = Date.now() - lastGenAt.current < 8000
    if (force || (!descRef.current.trim() && !isRecent)) {
      setCurrentDescription(row?.description || '')
      setOriginalDescription(row?.description || '')
    }
    setCurrentAudioUrl(row?.audio_url || null)
  }, [])

  const fetchAdditionalData = useCallback(async (_forceId?: string, forceUpdate = false) => {
    const id = _forceId || entityId
    if (!id) return
    setIsLoading(true)
    try {
      const { data } = await supabase
        .schema('core')
        .from('attraction_descriptions')
        .select('*')
        .eq('attraction_id', id)
        .order('updated_at', { ascending: false })
      const rows = data || []
      setDescriptions(rows)
      setTranslatedDescriptions(rows.filter((d: any) => d.audio_url))
      applyLanguageRow(rows, generationLanguage, forceUpdate)
    } catch (e: any) {
      showFeedback(e?.message || 'Falha ao carregar conteúdo', 'error')
    } finally {
      setIsLoading(false)
    }
  }, [entityId, supabase, generationLanguage, applyLanguageRow, showFeedback])

  // Carrega ao montar / trocar entidade.
  useEffect(() => { if (entityId) fetchAdditionalData(entityId, true) }, [entityId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Ao trocar de idioma, reaproveita as descrições já carregadas.
  useEffect(() => { applyLanguageRow(descriptions, generationLanguage, true) }, [generationLanguage]) // eslint-disable-line react-hooks/exhaustive-deps

  const generateDescription = useCallback(async () => {
    if (!entityId) return
    setIsGenerating(true)
    try {
      const ctx = referenceLinks.filter((l) => l.trim()).length
        ? `Links de referência fornecidos:\n${referenceLinks.filter((l) => l.trim()).join('\n')}\n\n`
        : undefined
      const { data: result, error } = await callFunction('generate-description', {
        poi_id: entityId, language: generationLanguage, generate_audio: false,
        audio_duration: audioDuration, raw_context: ctx, force: true,
      })
      if (error) throw error
      if (!result?.success) throw new Error(result?.error || 'Falha ao gerar descrição')
      lastGenAt.current = Date.now()
      const d = result.data || {}
      if (d.description) { setCurrentDescription(d.description); setOriginalDescription(d.description) }
      setVerificationResult({
        score: d.last_score_overall || 0,
        approved: d.verification_status === 'approved',
        verifiable_facts: d.metadata?.verified_facts || [],
        detected_dates: d.metadata?.historical_dates || [],
        keywords: d.metadata?.search_keywords || d.metadata?.keywords || [],
      })
      showFeedback('Descrição gerada com sucesso.', 'success')
      invalidate()
    } catch (e: any) {
      showFeedback(`Falha ao gerar descrição: ${e?.message || e}`, 'error')
    } finally {
      setIsGenerating(false)
    }
  }, [entityId, generationLanguage, audioDuration, referenceLinks, callFunction, showFeedback, invalidate])

  const resetDescription = useCallback(() => setCurrentDescription(originalDescription), [originalDescription])

  const saveDescriptionAndNextStep = useCallback(async () => {
    if (!entityId) return
    setIsSavingDescription(true)
    try {
      // Upsert multi-linha-seguro: a descrição é gender-independent, então atualiza
      // TODAS as linhas de (attraction_id, language) — pode haver male+female após
      // geração de áudio (maybeSingle quebraria com >1 linha).
      const { data: rows, error: fErr } = await supabase.schema('core').from('attraction_descriptions')
        .select('id').eq('attraction_id', entityId).eq('language', generationLanguage)
      if (fErr) throw fErr
      if (rows && rows.length) {
        const { error } = await supabase.schema('core').from('attraction_descriptions')
          .update({ description: currentDescription, updated_at: new Date().toISOString() })
          .eq('attraction_id', entityId).eq('language', generationLanguage)
        if (error) throw error
      } else {
        const { error } = await supabase.schema('core').from('attraction_descriptions')
          .insert({ attraction_id: entityId, language: generationLanguage, description: currentDescription, play_count: 0 })
        if (error) throw error
      }
      setOriginalDescription(currentDescription)
      showFeedback('Descrição salva.', 'success')
      invalidate()
      await fetchAdditionalData(entityId, false)
    } catch (e: any) {
      showFeedback(`Falha ao salvar descrição: ${e?.message || e}`, 'error')
    } finally {
      setIsSavingDescription(false)
    }
  }, [entityId, generationLanguage, currentDescription, supabase, showFeedback, invalidate, fetchAdditionalData])

  const saveReferenceLinks = useCallback(async () => {
    if (!entityId) return
    setIsSavingReferenceLinks(true)
    try {
      const { error } = await supabase.schema('core').from('attractions')
        .update({ reference_links: referenceLinks.filter((l) => l.trim()) }).eq('id', entityId)
      if (error) throw error
      showFeedback('Links salvos.', 'success')
    } catch (e: any) {
      showFeedback(`Falha ao salvar links: ${e?.message || e}`, 'error')
    } finally {
      setIsSavingReferenceLinks(false)
    }
  }, [entityId, referenceLinks, supabase, showFeedback])

  const translateName = useCallback(async () => {
    if (!entityId) return
    setIsTranslatingName(true)
    try {
      const { data: result, error } = await callFunction('generate-translated-audio', {
        attractionId: entityId, targetLanguage: generationLanguage, voiceGender: selectedGender, nameOnly: true,
      })
      if (error) throw error
      if (!result?.success) throw new Error(result?.error || 'Falha ao traduzir nome')
      setCurrentName(result.data?.name || '')
      showFeedback('Nome traduzido.', 'success')
      setTimeout(() => fetchAdditionalData(entityId, false), 800)
    } catch (e: any) {
      showFeedback(`Falha ao traduzir nome: ${e?.message || e}`, 'error')
    } finally {
      setIsTranslatingName(false)
    }
  }, [entityId, generationLanguage, selectedGender, callFunction, showFeedback, fetchAdditionalData])

  const savePoiName = useCallback(async () => {
    if (!entityId) return
    setIsSavingName(true)
    try {
      await upsertPoiName(supabase, entityId, generationLanguage, currentName.trim())
      showFeedback('Nome salvo.', 'success')
      setTimeout(() => fetchAdditionalData(entityId, false), 400)
    } catch (e: any) {
      showFeedback(`Falha ao salvar nome: ${e?.message || e}`, 'error')
    } finally {
      setIsSavingName(false)
    }
  }, [entityId, generationLanguage, currentName, supabase, showFeedback, fetchAdditionalData])

  const regenerateAllAudios = useCallback(async () => {
    if (!entityId || !selectedLanguages.length) return
    setIsGeneratingAudio(true); setIsTranslating(true)
    const results: string[] = []
    try {
      for (let i = 0; i < selectedLanguages.length; i++) {
        const lang = selectedLanguages[i]
        setAudioProgress({ current: i + 1, total: selectedLanguages.length, currentTask: `Gerando ${lang} (${selectedGender})...` })
        const { data: result, error } = await callFunction('generate-translated-audio', {
          attractionId: entityId, targetLanguage: lang, voiceGender: selectedGender,
        })
        if (error || !result?.success) results.push(`❌ ${lang} (${selectedGender}): ${error?.message || result?.error || 'falhou'}`)
        else results.push(`✅ ${lang} (${selectedGender}): gerado`)
      }
      setAudioProgress({ current: selectedLanguages.length, total: selectedLanguages.length, currentTask: 'Concluído!' })
      setAudioResults(results); setShowResults(true)
      setTimeout(() => fetchAdditionalData(entityId, false), 1000)
    } catch (e: any) {
      setAudioResults([`❌ Erro geral: ${e?.message || e}`]); setShowResults(true)
    } finally {
      setIsGeneratingAudio(false); setIsTranslating(false)
      setTimeout(() => setAudioProgress({ current: 0, total: 0, currentTask: '' }), 3000)
    }
  }, [entityId, selectedLanguages, selectedGender, callFunction, fetchAdditionalData])

  const regenerateTranslation = useCallback(async (language: string, gender: string) => {
    if (!currentDescription.trim()) { showFeedback('Salve uma descrição base primeiro.', 'error'); return }
    if (!(await requestConfirm(`Regenerar áudio para ${language} (${gender})? Isso substitui o áudio existente.`))) return
    setIsTranslating(true)
    try {
      const { data: result, error } = await callFunction('generate-description', {
        poi_id: entityId, language, gender, force: true, generate_audio: true,
      })
      if (error) throw error
      if (!result?.success) throw new Error(result?.error || 'Falha ao regenerar áudio')
      showFeedback(`Áudio regenerado para ${language} (${gender}).`, 'success')
      setTimeout(() => fetchAdditionalData(entityId, false), 1500)
    } catch (e: any) {
      showFeedback(`Falha ao regenerar: ${e?.message || e}`, 'error')
    } finally {
      setIsTranslating(false)
    }
  }, [entityId, currentDescription, callFunction, requestConfirm, showFeedback, fetchAdditionalData])

  const deleteTranslation = useCallback(async (id: string, language: string, gender: string) => {
    if (!(await requestConfirm(`Remover a tradução ${language} (${gender})? Ação irreversível.`))) return
    try {
      await deleteDescription(supabase, id)
      showFeedback('Tradução removida.', 'success')
      await fetchAdditionalData(entityId, false)
    } catch (e: any) {
      showFeedback(`Falha ao remover: ${e?.message || e}`, 'error')
    }
  }, [entityId, supabase, requestConfirm, showFeedback, fetchAdditionalData])

  return useMemo<EntityContent>(() => ({
    isLoading, descriptions, translatedDescriptions,
    currentDescription, setCurrentDescription, originalDescription,
    currentName, setCurrentName, originalName: name, currentAudioUrl,
    generationLanguage, setGenerationLanguage, selectedGender, setSelectedGender,
    selectedLanguages, setSelectedLanguages, audioDuration, setAudioDuration,
    referenceLinks, setReferenceLinks, verificationResult,
    audioProgress, audioResults, showResults, setShowResults,
    isGenerating, isGeneratingAudio, isSavingDescription, isSavingName,
    isTranslatingName, isTranslating, isSavingReferenceLinks,
    fetchAdditionalData, generateDescription, resetDescription, saveDescriptionAndNextStep,
    saveReferenceLinks, translateName, savePoiName, regenerateAllAudios,
    regenerateTranslation, deleteTranslation,
  }), [
    isLoading, descriptions, translatedDescriptions, currentDescription, originalDescription,
    currentName, name, currentAudioUrl, generationLanguage, selectedGender, selectedLanguages,
    audioDuration, referenceLinks, verificationResult, audioProgress, audioResults, showResults,
    isGenerating, isGeneratingAudio, isSavingDescription, isSavingName, isTranslatingName,
    isTranslating, isSavingReferenceLinks,
    fetchAdditionalData, generateDescription, resetDescription, saveDescriptionAndNextStep,
    saveReferenceLinks, translateName, savePoiName, regenerateAllAudios, regenerateTranslation, deleteTranslation,
  ])
}
