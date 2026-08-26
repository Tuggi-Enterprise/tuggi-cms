'use client'

/**
 * Description tab — content studio (editor, AI generation, reference links,
 * verification insights, description history). Extracted from POIDetailsModal;
 * reads shared content state/handlers from POIModalContext. Description data
 * access lives in lib/core/poi-descriptions-service / poi-verification-service.
 */

import { useTranslations } from 'next-intl'
import { FileText, CheckCircle, RotateCcw, Loader2, Sparkles, ArrowRight, Globe, Plus, Save, Languages } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatDate } from '@/lib/utils'
import { getScoreColor, getScoreBackgroundColor } from '@/lib/score/compute'
import { usePOIModalContext } from '../POIModalContext'
import { PartnerDescriptionGate } from '@/components/entity-management/PartnerDescriptionGate'
import { useDescriptionPolicy } from '@/lib/hooks/use-description-policy'

export function DescriptionTab() {
  const t = useTranslations('Modals.POIDetails')
  const tCommon = useTranslations('Common')
  const {
    getPoi,
    isLoading,
    editedPoi,
    descriptions,
    currentDescription,
    setCurrentDescription,
    originalDescription,
    currentName,
    setCurrentName,
    originalName,
    isSavingName,
    isTranslatingName,
    translateName,
    savePoiName,
    generationLanguage,
    setGenerationLanguage,
    verificationResult,
    referenceLinks,
    setReferenceLinks,
    isGeneratingAudio,
    audioDuration,
    setAudioDuration,
    isGenerating,
    isSavingDescription,
    isSavingReferenceLinks,
    generateDescription,
    resetDescription,
    saveDescriptionAndNextStep,
    saveReferenceLinks,
    canEdit,
    showFeedback,
  } = usePOIModalContext()
  const poi = getPoi()

  /**
   * WHETHER THIS RECORD MAY HAVE A DESCRIPTION AT ALL — BR-B2B-016, item 1.
   *
   * A curated POI answers `curation` and every branch below is the studio exactly as it always
   * was; a free-tier partner answers `name_only`, and the studio does not render, because leaving
   * an editor open on a place whose only content is its name trains the operator to work around
   * the one difference the paid tier has. Same react-query key as the band, so this is a cache hit
   * and not a second request.
   */
  const { data: descriptionPolicy } = useDescriptionPolicy(poi?.id ?? null)
  const nameOnly = descriptionPolicy?.decision.policy === 'name_only'

  return (
              <div className="px-6 py-6 max-h-[80vh] overflow-y-auto bg-gray-50/30 dark:bg-gray-900/10">
                {isLoading ? (
                  <div className="animate-pulse space-y-6">
                    <div className="h-10 bg-gray-200 dark:bg-gray-700 rounded-xl w-1/3"></div>
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                      <div className="lg:col-span-2 h-64 bg-gray-200 dark:bg-gray-700 rounded-2xl"></div>
                      <div className="h-64 bg-gray-200 dark:bg-gray-700 rounded-2xl"></div>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col gap-6">
                    {poi?.id && (
                      <PartnerDescriptionGate
                        attractionId={poi.id}
                        language={generationLanguage}
                        canEdit={canEdit}
                        onGenerated={setCurrentDescription}
                        onFeedback={showFeedback}
                      />
                    )}

                    {/* STUDIO HEADER: Language Tabs */}
                    <div className={nameOnly ? 'hidden' : 'flex flex-col md:flex-row md:items-center justify-between gap-4'}>
                      <div className="flex items-center gap-3">
                        {/* Language Tabs */}
                        <div className="flex bg-white dark:bg-gray-800 p-1 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm">
                          {[
                            { code: 'pt-br', label: 'Portuguese (BR)' },
                            { code: 'en-us', label: 'English (US)' },
                            { code: 'es-es', label: 'Spanish (ES)' },
                            { code: 'fr-fr', label: 'French (FR)' },
                            { code: 'de-de', label: 'German (DE)' },
                            { code: 'it-it', label: 'Italian (IT)' },
                            { code: 'ja-jp', label: 'Japanese (JP)' },
                            { code: 'ko-kr', label: 'Korean (KR)' },
                            { code: 'cmn-cn', label: 'Mandarin (CN)' },
                            { code: 'ru-ru', label: 'Russian (RU)' },
                          ].map((lang) => (
                            <button
                              key={lang.code}
                              onClick={() => setGenerationLanguage(lang.code)}
                              className={cn(
                                "px-4 py-2 rounded-lg text-xs font-black uppercase tracking-tighter transition-all duration-300",
                                generationLanguage === lang.code
                                  ? "bg-tuggi-blue text-white shadow-md shadow-tuggi-blue/20"
                                  : "text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                              )}
                            >
                              {lang.code.split('-')[0]}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="hidden md:flex items-center gap-2 px-4 py-2 bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm">
                        <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                        <span className="text-[10px] font-black text-gray-500 uppercase tracking-widest">Studio Engine Active</span>
                      </div>
                    </div>

                    <div className={nameOnly ? 'hidden' : 'grid grid-cols-1 lg:grid-cols-3 gap-6 items-start'}>
                      {/* MAIN COLUMN: Editor */}
                      <div className="lg:col-span-2 space-y-6">
                        {/* Translated Name Card — POI name in the selected language (SSOT: attraction_descriptions.name) */}
                        <div className="bg-white dark:bg-gray-800 rounded-3xl border border-gray-100 dark:border-gray-700 shadow-sm overflow-hidden">
                          <div className="px-6 py-4 border-b border-gray-50 dark:border-gray-700 flex items-center justify-between bg-gray-50/50 dark:bg-gray-900/20">
                            <div className="flex items-center gap-3">
                              <div className="bg-tuggi-orange/10 p-2 rounded-xl">
                                <Languages className="h-4 w-4 text-tuggi-orange" />
                              </div>
                              <div>
                                <h4 className="text-sm font-black text-gray-900 dark:text-white uppercase tracking-tight">
                                  {generationLanguage.split('-')[0].toUpperCase()} Name
                                </h4>
                                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                                  Original: <span className="text-gray-500 normal-case">{originalName || '—'}</span>
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <button
                                onClick={translateName}
                                disabled={isTranslatingName || isSavingName}
                                className="inline-flex items-center px-3 py-2 bg-tuggi-orange/10 hover:bg-tuggi-orange/20 text-tuggi-orange text-[10px] font-black rounded-xl transition-all disabled:opacity-50 uppercase tracking-widest"
                                title="Translate name with AI (exonym or transliteration)"
                              >
                                {isTranslatingName ? <Loader2 className="h-3 w-3 mr-2 animate-spin" /> : <Sparkles className="h-3 w-3 mr-2" />}
                                Translate
                              </button>
                              <button
                                onClick={savePoiName}
                                disabled={isSavingName || isTranslatingName || !currentName.trim()}
                                className="inline-flex items-center px-3 py-2 bg-tuggi-blue hover:bg-tuggi-blue/90 text-white text-[10px] font-black rounded-xl transition-all disabled:opacity-50 uppercase tracking-widest"
                              >
                                {isSavingName ? <Loader2 className="h-3 w-3 mr-2 animate-spin" /> : <Save className="h-3 w-3 mr-2" />}
                                {tCommon('actions.save')}
                              </button>
                            </div>
                          </div>
                          <div className="p-4">
                            <input
                              type="text"
                              value={currentName}
                              onChange={(e) => setCurrentName(e.target.value)}
                              className="w-full px-4 py-3 bg-gray-50 dark:bg-gray-900/50 border-transparent rounded-xl focus:bg-white focus:ring-1 focus:ring-tuggi-orange transition-all text-sm font-bold text-gray-800 dark:text-gray-100 placeholder:italic placeholder:font-medium placeholder:text-gray-300"
                              placeholder={`Translated name in ${generationLanguage.split('-')[0].toUpperCase()} (e.g. exonym or transliteration)`}
                            />
                          </div>
                        </div>

                        <div className="bg-white dark:bg-gray-800 rounded-3xl border border-gray-100 dark:border-gray-700 shadow-xl shadow-gray-200/20 overflow-hidden">
                          {/* Editor Header */}
                          <div className="px-6 py-4 border-b border-gray-50 dark:border-gray-700 flex items-center justify-between bg-gray-50/50 dark:bg-gray-900/20">
                            <div className="flex items-center gap-3">
                              <div className="bg-tuggi-blue/10 p-2 rounded-xl">
                                <FileText className="h-4 w-4 text-tuggi-blue" />
                              </div>
                              <div>
                                <h4 className="text-sm font-black text-gray-900 dark:text-white uppercase tracking-tight">
                                  {generationLanguage.split('-')[0].toUpperCase()} Content Editor
                                </h4>
                                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Manual or AI refinement</p>
                              </div>
                            </div>
                            
                            {verificationResult && (
                              <div className={cn(
                                "flex items-center gap-2 px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-tighter",
                                getScoreBackgroundColor(verificationResult.score / 100),
                                getScoreColor(verificationResult.score / 100)
                              )}>
                                <span className="opacity-60">Score:</span>
                                <span>{verificationResult.score}</span>
                                {verificationResult.approved && <CheckCircle className="h-3 w-3" />}
                              </div>
                            )}
                          </div>

                          {/* Textarea Area */}
                          <div className="p-1">
                            <textarea
                              value={currentDescription}
                              onChange={(e) => setCurrentDescription(e.target.value)}
                              rows={12}
                              className="w-full px-6 py-6 bg-transparent border-none focus:ring-0 text-gray-700 dark:text-gray-200 text-sm leading-relaxed resize-none font-medium placeholder:italic placeholder:text-gray-300"
                              placeholder="Write a compelling description or use the AI tools below..."
                            />
                          </div>

                          {/* Editor Footer: AI Toolbar */}
                          <div className="px-6 py-4 bg-gray-50/80 dark:bg-gray-900/40 border-t border-gray-100 dark:border-gray-700 flex items-center justify-between">
                            <div className="flex items-center gap-4">
                              <div className="flex items-center gap-2">
                                <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Duration</span>
                                <select
                                  value={audioDuration}
                                  onChange={(e) => setAudioDuration(Number(e.target.value))}
                                  className="bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-600 rounded-lg text-[10px] font-black px-2 py-1 focus:ring-1 focus:ring-tuggi-blue"
                                >
                                  <option value={10}>10s</option>
                                  <option value={20}>20s</option>
                                  <option value={30}>30s</option>
                                  <option value={45}>45s</option>
                                  <option value={60}>60s</option>
                                </select>
                              </div>
                              <div className="h-4 w-px bg-gray-200 dark:bg-gray-700" />
                              <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                                {currentDescription.length} characters
                              </div>
                            </div>

                            <div className="flex items-center gap-2">
                              {currentDescription !== originalDescription && (
                                <button
                                  onClick={resetDescription}
                                  className="p-2 text-gray-400 hover:text-red-500 transition-all"
                                  title="Reset Changes"
                                >
                                  <RotateCcw className="h-4 w-4" />
                                </button>
                              )}
                              <button
                                onClick={generateDescription}
                                disabled={isGenerating || isSavingDescription || isGeneratingAudio}
                                className="inline-flex items-center px-4 py-2 bg-tuggi-blue hover:bg-tuggi-blue/90 text-white text-[10px] font-black rounded-xl transition-all shadow-md shadow-tuggi-blue/10 disabled:opacity-50 uppercase tracking-widest"
                              >
                                {isGenerating ? <Loader2 className="h-3 w-3 mr-2 animate-spin" /> : <Sparkles className="h-3 w-3 mr-2" />}
                                {t('actions.regenerate')}
                              </button>
                            </div>
                          </div>
                        </div>

                        {/* Save Action Bar */}
                        <div className="flex items-center justify-end gap-3 pt-2">
                          {currentDescription !== originalDescription && (
                            <span className="text-[10px] font-bold text-tuggi-orange uppercase animate-pulse">Unsaved Changes</span>
                          )}
                          <button
                            onClick={saveDescriptionAndNextStep}
                            disabled={isSavingDescription || isGeneratingAudio || isGenerating || currentDescription === originalDescription}
                            className="inline-flex items-center px-8 py-3 bg-tuggi-blue hover:bg-tuggi-blue/90 text-white text-sm font-black rounded-2xl transition-all shadow-xl shadow-tuggi-blue/20 disabled:opacity-50 uppercase tracking-widest group"
                          >
                            {isSavingDescription ? tCommon('actions.saving') : t('actions.save_and_next')}
                            <ArrowRight className="h-4 w-4 ml-2 transition-transform group-hover:translate-x-1" />
                          </button>
                        </div>
                      </div>

                      {/* SIDEBAR COLUMN: Research & Context */}
                      <div className="space-y-6">
                        {/* Reference Links Card */}
                        <div className="bg-white dark:bg-gray-800 rounded-3xl border border-gray-100 dark:border-gray-700 shadow-sm p-6">
                          <div className="flex items-center justify-between mb-6">
                            <div className="flex items-center gap-2">
                              <div className="bg-blue-50 dark:bg-blue-900/20 p-1.5 rounded-lg">
                                <Globe className="h-4 w-4 text-blue-500" />
                              </div>
                              <h5 className="text-[10px] font-black text-gray-400 uppercase tracking-widest">
                                {t('labels.reference_links')}
                              </h5>
                            </div>
                            <button
                              type="button"
                              onClick={() => setReferenceLinks([...referenceLinks, ''])}
                              className="bg-gray-50 dark:bg-gray-900 p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
                            >
                              <Plus className="h-3.5 w-3.5 text-tuggi-blue" />
                            </button>
                          </div>

                          <div className="space-y-3">
                            {referenceLinks.length === 0 && (
                              <p className="text-[10px] text-gray-400 italic text-center py-4">No sources added yet</p>
                            )}
                            {referenceLinks.map((link, idx) => (
                              <div key={idx} className="group relative">
                                <input
                                  type="url"
                                  className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-900/50 border-transparent rounded-xl focus:bg-white focus:ring-1 focus:ring-tuggi-blue transition-all text-[10px] font-medium"
                                  value={link}
                                  onChange={e => {
                                    const newLinks = [...referenceLinks];
                                    newLinks[idx] = e.target.value;
                                    setReferenceLinks(newLinks);
                                  }}
                                  placeholder="Wikipedia, Site, etc."
                                />
                                <button
                                  type="button"
                                  className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 p-1 text-gray-300 hover:text-red-500 transition-all"
                                  onClick={() => setReferenceLinks(referenceLinks.filter((_, i) => i !== idx))}
                                >
                                  <RotateCcw className="h-3 w-3 rotate-45" />
                                </button>
                              </div>
                            ))}
                            
                            {referenceLinks.length > 0 && (
                              <button
                                type="button"
                                onClick={saveReferenceLinks}
                                disabled={isSavingReferenceLinks || !!poi?._homologData}
                                className="w-full mt-2 inline-flex items-center justify-center px-4 py-2 bg-gray-50 dark:bg-gray-900 text-gray-500 hover:text-tuggi-blue text-[10px] font-black rounded-xl transition-all uppercase tracking-widest disabled:opacity-50"
                              >
                                <Save className="h-3 w-3 mr-2" />
                                {isSavingReferenceLinks ? tCommon('actions.saving') : t('actions.save_links')}
                              </button>
                            )}
                          </div>
                        </div>

                        {/* POI Context Card (AI Fuel) */}
                        <div className="bg-gray-50/50 dark:bg-gray-900/50 rounded-3xl border border-dashed border-gray-200 dark:border-gray-700 p-6">
                           <div className="flex items-center gap-2 mb-4">
                              <div className="bg-orange-50 dark:bg-orange-900/20 p-1.5 rounded-lg">
                                <Sparkles className="h-4 w-4 text-orange-500" />
                              </div>
                              <h5 className="text-[10px] font-black text-gray-400 uppercase tracking-widest">
                                AI Content Insights
                              </h5>
                            </div>
                            <div className="space-y-5">
                              {/* Search Keywords */}
                              <div>
                                <span className="block text-[8px] font-black text-gray-400 uppercase mb-2 tracking-widest">Research Keywords</span>
                                <div className="flex flex-wrap gap-1.5">
                                  {(verificationResult?.keywords && verificationResult.keywords.length > 0) ? (
                                    verificationResult.keywords.map((kw: string, i: number) => (
                                      <span key={i} className="px-2 py-1 bg-white dark:bg-gray-800 rounded-lg text-[10px] font-bold text-tuggi-blue border border-tuggi-blue/10 shadow-sm">
                                        {kw}
                                      </span>
                                    ))
                                  ) : (
                                    <span className="text-[10px] text-gray-400 italic">Generate to see research context</span>
                                  )}
                                </div>
                              </div>

                              {/* Verified Facts */}
                              {verificationResult?.verifiable_facts && verificationResult.verifiable_facts.length > 0 && (
                                <div>
                                  <span className="block text-[8px] font-black text-gray-400 uppercase mb-2 tracking-widest">Verified Facts</span>
                                  <ul className="space-y-1">
                                    {verificationResult.verifiable_facts.slice(0, 3).map((fact: string, i: number) => (
                                      <li key={i} className="text-[10px] text-gray-600 dark:text-gray-400 leading-tight flex items-start gap-1.5">
                                        <div className="w-1 h-1 rounded-full bg-green-400 mt-1.5 shrink-0" />
                                        {fact}
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              )}

                              {/* Historical Dates */}
                              {verificationResult?.detected_dates && verificationResult.detected_dates.length > 0 && (
                                <div>
                                  <span className="block text-[8px] font-black text-gray-400 uppercase mb-2 tracking-widest">Detected Dates</span>
                                  <div className="flex flex-wrap gap-1.5">
                                    {verificationResult.detected_dates.map((date: string, i: number) => (
                                      <span key={i} className="px-2 py-1 bg-amber-50 dark:bg-amber-900/20 rounded-lg text-[10px] font-bold text-amber-600 border border-amber-100 dark:border-amber-900/30">
                                        {date}
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {/* Physical Context (Fallback if no AI data yet) */}
                              {!verificationResult && (
                                <div>
                                  <span className="block text-[8px] font-black text-gray-400 uppercase mb-1">Primary Category</span>
                                  <p className="text-xs font-bold text-gray-700 dark:text-gray-200 capitalize">{editedPoi?.category?.replace(/_/g, ' ') || 'N/A'}</p>
                                </div>
                              )}
                            </div>
                        </div>
                      </div>
                    </div>

                    {/* HISTORY: Other Languages */}
                    {descriptions.length > 0 && (
                      <div className="mt-6 pt-6 border-t border-gray-100 dark:border-gray-800">
                        <div className="flex items-center gap-2 mb-4">
                          <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Existing Descriptions</h4>
                          <span className="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-700 rounded text-[9px] font-bold text-gray-500">
                            {descriptions.length}
                          </span>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                          {descriptions.map((desc) => (
                            <div key={desc.id} className="bg-white dark:bg-gray-800 p-4 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm group hover:border-tuggi-blue/30 transition-all">
                              <div className="flex items-center justify-between mb-2">
                                <span className="text-[10px] font-black text-tuggi-blue uppercase tracking-tighter bg-tuggi-blue/5 px-2 py-0.5 rounded-md">
                                  {desc.language}
                                </span>
                                <span className="text-[8px] text-gray-400 font-bold">{formatDate(desc.created_at)}</span>
                              </div>
                              <p className="text-xs text-gray-600 dark:text-gray-400 line-clamp-3 italic leading-relaxed">"{desc.description}"</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
  )
}
