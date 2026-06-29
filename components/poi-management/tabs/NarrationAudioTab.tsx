'use client'

/**
 * Narration-audio tab — multi-language TTS generation and management.
 * Extracted from POIDetailsModal; reads shared content/audio state and handlers
 * from POIModalContext. Audio generation handlers remain in the parent (edge
 * function orchestration) and are exposed via context.
 */

import { useTranslations } from 'next-intl'
import { Loader2, Volume2, RotateCcw, Download, Trash2, User, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatDate } from '@/lib/utils'
import { usePOIModalContext } from '../POIModalContext'

export function NarrationAudioTab() {
  const t = useTranslations('Modals.POIDetails')
  const tCommon = useTranslations('Common')
  const {
    getPoi,
    isLoading,
    currentDescription,
    descriptions,
    currentAudioUrl,
    selectedGender,
    setSelectedGender,
    selectedLanguages,
    setSelectedLanguages,
    isGeneratingAudio,
    isGenerating,
    isSavingDescription,
    isTranslating,
    translatedDescriptions,
    audioProgress,
    audioResults,
    showResults,
    setShowResults,
    regenerateAllAudios,
    regenerateTranslation,
    deleteTranslation,
    fetchAdditionalData,
  } = usePOIModalContext()
  const poi = getPoi()

  return (
              <div className="px-6 py-4 max-h-[80vh] overflow-y-auto">
                {isLoading ? (
                  <div className="animate-pulse space-y-4">
                    <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-3/4"></div>
                    <div className="h-32 bg-gray-200 dark:bg-gray-700 rounded"></div>
                    <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded w-1/2"></div>
                  </div>
                ) : (
                  <div className="space-y-6">
                    <div className="flex items-center justify-between">
                      <div>
                         <h4 className="text-lg font-medium text-gray-900 dark:text-white">
                           {t('labels.narration_audios')}
                         </h4>
                        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                          Generate audio narration from attraction descriptions using OpenAI TTS
                        </p>
                      </div>
                      <div className="flex items-center space-x-2">
                        <button
                          onClick={() => {
                            fetchAdditionalData()
                          }}
                          className="inline-flex items-center px-3 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-tuggi-blue"
                        >
                           <RotateCcw className="h-4 w-4 mr-2" />
                           {t('actions.refresh')}
                         </button>
                        <button
                          onClick={() => {
                            // Always regenerate all audios (PT, EN, ES)
                            regenerateAllAudios()
                          }}
                          disabled={isGeneratingAudio || isTranslating || (!currentDescription.trim() && !currentAudioUrl)}
                          className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-tuggi-blue hover:bg-tuggi-blue/90 focus:outline-none focus:ring-2 focus:ring-tuggi-blue disabled:opacity-50"
                        >
                          {(isGeneratingAudio || isTranslating) ? (
                             <>
                               <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                               {tCommon('actions.generating')}
                             </>
                          ) : (
                             <>
                               <Volume2 className="h-4 w-4 mr-2" />
                               {currentAudioUrl ? t('actions.regenerate_all') : t('actions.generate_all')}
                             </>
                          )}
                        </button>
                        {currentAudioUrl && (
                           <span className="text-xs text-tuggi-orange">
                             ⚠️ {t('messages.replace_audio_warning')}
                           </span>
                        )}
                      </div>
                    </div>

                    {/* Language & Gender Selectors */}
                    <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700 space-y-4">
                      {/* Gender Selector */}
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                           {t('labels.voice_gender')}
                         </label>
                        <div className="flex p-1 bg-gray-100/50 dark:bg-gray-900/50 rounded-xl w-fit border border-gray-200 dark:border-gray-800">
                          {[
                            { value: 'male', label: t('labels.male') },
                            { value: 'female', label: t('labels.female') }
                          ].map((gender) => (
                            <button
                              key={gender.value}
                              onClick={() => setSelectedGender(gender.value as 'male' | 'female')}
                              className={cn(
                                "flex items-center gap-2 px-6 py-1.5 rounded-lg text-sm font-bold transition-all duration-300",
                                selectedGender === gender.value
                                  ? "bg-white dark:bg-gray-800 text-tuggi-blue shadow-sm ring-1 ring-black/5"
                                  : "text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                              )}
                            >
                              <User className={cn("h-3.5 w-3.5", selectedGender === gender.value ? "text-tuggi-blue" : "text-gray-400")} />
                              {gender.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Language Multi-Select */}
                      <div>
                         <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                           {t('labels.languages_to_generate')}
                         </label>
                        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
                          {[
                            { code: 'pt-br', name: 'Português', sub: 'Brasil', flag: '🇧🇷' },
                            { code: 'pt-pt', name: 'Português', sub: 'Portugal', flag: '🇵🇹' },
                            { code: 'en-us', name: 'English', sub: 'US', flag: '🇺🇸' },
                            { code: 'en-gb', name: 'English', sub: 'UK', flag: '🇬🇧' },
                            { code: 'es-es', name: 'Spanish', sub: 'Spain', flag: '🇪🇸' },
                            { code: 'de-de', name: 'German', flag: '🇩🇪' },
                            { code: 'fr-fr', name: 'French', flag: '🇫🇷' },
                            { code: 'it-it', name: 'Italian', flag: '🇮🇹' },
                            { code: 'ja-jp', name: 'Japanese', flag: '🇯🇵' },
                            { code: 'cmn-cn', name: 'Mandarin', flag: '🇨🇳' },
                            { code: 'ko-kr', name: 'Korean', flag: '🇰🇷' },
                            { code: 'ru-ru', name: 'Russian', flag: '🇷🇺' },
                          ].map((lang) => (
                            <label
                              key={lang.code}
                              className={cn(
                                "relative flex flex-col items-center justify-center h-20 rounded-xl border cursor-pointer transition-all duration-300 text-center group",
                                selectedLanguages.includes(lang.code)
                                  ? "bg-tuggi-blue/10 border-tuggi-blue ring-1 ring-tuggi-blue/10 shadow-sm"
                                  : "bg-white dark:bg-gray-900 border-gray-100 dark:border-gray-800 hover:border-tuggi-blue/30"
                              )}
                            >
                              <input
                                type="checkbox"
                                checked={selectedLanguages.includes(lang.code)}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setSelectedLanguages([...selectedLanguages, lang.code])
                                  } else {
                                    setSelectedLanguages(selectedLanguages.filter(l => l !== lang.code))
                                  }
                                }}
                                className="sr-only"
                              />
                              
                              <span className="text-2xl mb-1 transition-transform group-hover:scale-110 duration-300">{lang.flag}</span>
                              
                              <div className="flex flex-col leading-none px-1">
                                <span className={cn(
                                  "text-[10px] font-black uppercase tracking-tight",
                                  selectedLanguages.includes(lang.code) ? "text-tuggi-blue" : "text-gray-900 dark:text-white"
                                )}>
                                  {lang.name}
                                </span>
                                {lang.sub && (
                                  <span className={cn(
                                    "text-[8px] font-bold uppercase tracking-tighter mt-1",
                                    selectedLanguages.includes(lang.code) ? "text-tuggi-blue/70" : "text-gray-400"
                                  )}>
                                    {lang.sub}
                                  </span>
                                )}
                              </div>
                            </label>
                          ))}
                        </div>
                         <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                           {t('labels.selected')}: {selectedLanguages.length} {tCommon('units.languages')}
                         </p>
                      </div>
                    </div>

                    {/* Audio Progress Bar */}
                    {(isGeneratingAudio || isTranslating) && audioProgress.total > 0 && (
                      <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg border border-blue-200 dark:border-blue-800">
                        <div className="flex items-center justify-between mb-2">
                           <h6 className="text-sm font-medium text-blue-900 dark:text-blue-300">
                             {t('labels.audio_generation_progress')}
                           </h6>
                           <span className="text-sm text-blue-700 dark:text-blue-400">
                             {t('messages.audio_task_status', { current: audioProgress.current, total: audioProgress.total })}
                           </span>
                        </div>
                        <div className="w-full bg-blue-200 dark:bg-blue-800 rounded-full h-2 mb-2">
                          <div
                            className="bg-blue-600 dark:bg-blue-400 h-2 rounded-full transition-all duration-300 ease-out"
                            style={{ width: `${(audioProgress.current / audioProgress.total) * 100}%` }}
                          ></div>
                        </div>
                        <p className="text-sm text-blue-700 dark:text-blue-400">
                          {audioProgress.currentTask}
                        </p>
                      </div>
                    )}

                    {/* Audio Results */}
                    {showResults && audioResults.length > 0 && (
                      <div className="bg-gray-50 dark:bg-gray-800 p-4 rounded-lg border border-gray-200 dark:border-gray-700">
                        <div className="flex items-center justify-between mb-3">
                           <h6 className="text-sm font-medium text-gray-900 dark:text-white">
                             🎯 {t('labels.generation_results')}
                           </h6>
                          <button
                            onClick={() => setShowResults(false)}
                            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                        <div className="space-y-2">
                          {audioResults.map((result, index) => (
                            <div
                              key={index}
                              className={`p-2 rounded text-sm ${result.includes('✅')
                                ? 'bg-green-100 dark:bg-green-900/20 text-green-800 dark:text-green-300'
                                : 'bg-red-100 dark:bg-red-900/20 text-red-800 dark:text-red-300'
                                }`}
                            >
                              {result}
                            </div>
                          ))}
                        </div>
                        <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-600">
                          <div className="flex items-center justify-between text-sm">
                             <span className="text-gray-600 dark:text-gray-400">
                               {t('labels.success')}: {audioResults.filter(r => r.includes('✅')).length}/{audioResults.length}
                             </span>
                            <button
                              onClick={() => fetchAdditionalData()}
                              className="inline-flex items-center px-2 py-1 text-xs bg-tuggi-blue text-white rounded hover:bg-tuggi-blue/90"
                            >
                               <RotateCcw className="h-3 w-3 mr-1" />
                               {t('actions.refresh')}
                             </button>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Available Audios Section */}
                    {translatedDescriptions.length > 0 && (
                      <div className="bg-gray-50 dark:bg-gray-800 p-6 rounded-lg border border-gray-200 dark:border-gray-700">
                        <div className="flex items-center justify-between mb-4">
                           <h5 className="text-lg font-medium text-gray-900 dark:text-white">
                             🎵 {t('labels.available_audios')}
                           </h5>

                        </div>
                        <div className="overflow-x-auto">
                          <table className="w-full table-auto">
                            <thead>
                              <tr className="border-b border-gray-200 dark:border-gray-600">
                                 <th className="text-left py-2 px-3 text-sm font-medium text-gray-700 dark:text-gray-300">{t('labels.language')}</th>
                                 <th className="text-left py-2 px-3 text-sm font-medium text-gray-700 dark:text-gray-300">{t('labels.gender')}</th>
                                 <th className="text-left py-2 px-3 text-sm font-medium text-gray-700 dark:text-gray-300">{t('labels.description')}</th>
                                 <th className="text-left py-2 px-3 text-sm font-medium text-gray-700 dark:text-gray-300">{t('labels.audio')}</th>
                                 <th className="text-left py-2 px-3 text-sm font-medium text-gray-700 dark:text-gray-300">{t('labels.stats')}</th>
                                 <th className="text-left py-2 px-3 text-sm font-medium text-gray-700 dark:text-gray-300">{t('labels.actions')}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {translatedDescriptions.map((desc, index) => (
                                <tr key={desc.id} className={index % 2 === 0 ? 'bg-white dark:bg-gray-900' : 'bg-gray-50 dark:bg-gray-800'}>
                                  <td className="py-3 px-3 text-sm">
                                    <div className="flex items-center space-x-2">
                                      <span className="inline-flex items-center px-2 py-1 rounded-full text-xs bg-blue-100 dark:bg-blue-900/20 text-blue-800 dark:text-blue-300">
                                        {t(`languages.${desc.language?.toLowerCase()}`) || desc.language?.toUpperCase()}
                                      </span>
                                      {(() => {
                                        // Check if audio might be outdated
                                        const ptDesc = descriptions.find(d => d.language === 'pt-br' || d.language === 'pt')
                                        const isOutdated = ptDesc && desc.updated_at && ptDesc.updated_at &&
                                          new Date(ptDesc.updated_at) > new Date(desc.updated_at)

                                        if (isOutdated) {
                                          return (
                                            <span className="inline-flex items-center px-1 py-0.5 rounded text-xs bg-yellow-100 dark:bg-yellow-900/20 text-yellow-800 dark:text-yellow-300" title="Audio may be outdated - Portuguese description was updated after this audio">
                                              ⚠️
                                            </span>
                                          )
                                        }
                                        return null
                                      })()}
                                    </div>
                                  </td>
                                  <td className="py-3 px-3 text-sm">
                                    <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs ${desc.gender === 'male'
                                      ? 'bg-indigo-100 dark:bg-indigo-900/20 text-indigo-800 dark:text-indigo-300'
                                      : 'bg-pink-100 dark:bg-pink-900/20 text-pink-800 dark:text-pink-300'
                                      }`}>
                                       {desc.gender === 'male' ? `♂️ ${t('labels.male')}` : `♀️ ${t('labels.female')}`}
                                    </span>
                                  </td>
                                  <td className="py-3 px-3 text-sm">
                                    <div className="max-w-xs overflow-hidden">
                                      <p className="text-gray-900 dark:text-white truncate" title={desc.description}>
                                        {desc.description?.substring(0, 50) || 'No description'}...
                                      </p>
                                    </div>
                                  </td>
                                  <td className="py-3 px-3 text-sm">
                                    {desc.audio_url ? (
                                      <button
                                        onClick={() => {
                                          const audio = new Audio(desc.audio_url)
                                          audio.play()
                                        }}
                                        className="inline-flex items-center px-2 py-1 text-xs bg-green-100 dark:bg-green-900/20 text-green-800 dark:text-green-300 rounded hover:bg-green-200 dark:hover:bg-green-800/30"
                                      >
                                         <Volume2 className="h-3 w-3 mr-1" />
                                         {t('actions.play')}
                                       </button>
                                    ) : (
                                       <span className="text-xs text-gray-500 dark:text-gray-400">{tCommon('messages.no_audio')}</span>
                                    )}
                                  </td>
                                  <td className="py-3 px-3 text-sm">
                                    <div className="text-xs text-gray-500 dark:text-gray-400">
                                       <p>{t('labels.plays')}: {desc.play_count || 0}</p>
                                      {desc.last_played_at && (
                                         <p>{t('labels.last_played')}: {formatDate(desc.last_played_at)}</p>
                                      )}
                                    </div>
                                  </td>
                                  <td className="py-3 px-3 text-sm">
                                    <div className="flex items-center space-x-2">
                                      {desc.audio_url && (
                                        <button
                                          onClick={() => window.open(desc.audio_url, '_blank')}
                                          className="inline-flex items-center px-2 py-1 text-xs bg-green-100 dark:bg-green-900/20 text-green-800 dark:text-green-300 rounded hover:bg-green-200 dark:hover:bg-green-800/30"
                                        >
                                           <Download className="h-3 w-3 mr-1" />
                                           {t('actions.download')}
                                         </button>
                                      )}
                                      <button
                                        onClick={() => regenerateTranslation(desc.language, desc.gender)}
                                        disabled={isTranslating || isSavingDescription || isGeneratingAudio || isGenerating}
                                        className="inline-flex items-center px-2 py-1 text-xs bg-blue-100 dark:bg-blue-900/20 text-blue-800 dark:text-blue-300 rounded hover:bg-blue-200 dark:hover:bg-blue-800/30 disabled:opacity-50"
                                      >
                                         <RotateCcw className="h-3 w-3 mr-1" />
                                         {t('actions.regenerate')}
                                       </button>
                                      <button
                                        onClick={() => deleteTranslation(desc.id, desc.language, desc.gender)}
                                        disabled={isTranslating || isSavingDescription || isGeneratingAudio || isGenerating}
                                        className="inline-flex items-center px-2 py-1 text-xs bg-red-100 dark:bg-red-900/20 text-red-800 dark:text-red-300 rounded hover:bg-red-200 dark:hover:bg-red-800/30 disabled:opacity-50"
                                      >
                                         <Trash2 className="h-3 w-3 mr-1" />
                                         {tCommon('actions.delete')}
                                       </button>
                                    </div>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    {/* Current Audio Section - Fallback for when no translations exist */}
                    {translatedDescriptions.length === 0 && (
                      <div className="bg-gray-50 dark:bg-gray-700 p-6 rounded-lg text-center">
                        <Volume2 className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                         <h5 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
                           {t('labels.no_audio_available')}
                         </h5>
                         <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                           {t('labels.no_audio_description')}
                         </p>
                        {!currentDescription.trim() && (
                           <p className="text-sm text-tuggi-orange">
                             ⚠️ {t('labels.save_description_first')}
                           </p>
                        )}
                      </div>
                    )}

                    {/* Audio Management Info */}
                    {/* {(currentAudioUrl || translatedDescriptions.length > 0) && (
                  <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg border border-blue-200 dark:border-blue-800">
                    <div className="flex items-start space-x-3">
                      <div className="flex-shrink-0">
                        <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-300">
                          <Volume2 className="h-4 w-4" />
                        </span>
                      </div>
                      <div className="flex-1">
                        <h3 className="font-bold text-sm text-amber-700 dark:text-amber-500 mb-2">{t('audio_tips.title')}</h3>
                        <ul className="text-xs text-amber-600 dark:text-amber-400 space-y-2">
                          <li>• <strong>{t('audio_tips.automatic_detection')}</strong></li>
                          <li>• <strong>{t('audio_tips.individual_regeneration')}</strong></li>
                          <li>• <strong>{t('audio_tips.complete_regeneration')}</strong></li>
                          <li>• <strong>{t('audio_tips.visual_indicators')}</strong></li>
                        </ul>
                      </div>
                    </div>
                  </div>
                )} */}


                    {/* Debug Info */}
                    {/* <div className="bg-yellow-50 dark:bg-yellow-900/20 p-4 rounded-lg border border-yellow-200 dark:border-yellow-800">
                  <h5 className="text-sm font-medium text-yellow-800 dark:text-yellow-200 mb-2">
                    🔍 Debug Information
                  </h5>
                  <div className="text-xs text-yellow-700 dark:text-yellow-300 space-y-1">
                    <p><strong>{t('debug.description_length', { count: currentDescription.length })}</strong></p>
                    <p><strong>{t('debug.descriptions_found', { count: descriptions.length })}</strong></p>
                    <p><strong>{t('debug.available_languages', { languages: descriptions.map(d => d.language).join(', ') || tCommon('labels.none') })}</strong></p>
                    <p><strong>{t('debug.has_audio_url', { hasAudio: currentAudioUrl ? tCommon('labels.yes') : tCommon('labels.no') })}</strong></p>
                    {descriptions.length > 0 && (
                      <p><strong>{t('debug.first_description_preview', { preview: descriptions[0]?.description?.substring(0, 50) || tCommon('labels.empty') })}</strong></p>
                    )}
                  </div>
                </div> */}
                  </div>
                )}
              </div>
  )
}
