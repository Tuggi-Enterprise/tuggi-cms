'use client'

/**
 * Review tab — final approval checklist (score badge, POI summary, validation
 * status for description/audio/trigger-points). Read-only; pulls shared content
 * state from POIModalContext.
 */

import { useTranslations } from 'next-intl'
import { CheckCircle, Star, FileText, AlertTriangle, Volume2, Target, Info } from 'lucide-react'
import { cn } from '@/lib/utils'
import { getScoreColor, getScoreBackgroundColor, getScoreDescription } from '@/lib/score/compute'
import { usePOIModalContext } from '../POIModalContext'

export function ReviewTab() {
  const t = useTranslations('Modals.POIDetails')
  const tCommon = useTranslations('Common')
  const {
    getPoi,
    verificationResult,
    currentDescription,
    translatedDescriptions,
  } = usePOIModalContext()

  return (
              <div className="px-6 py-4 max-h-[60vh] overflow-y-auto">
                <div className="space-y-4">
                  {/* Header */}
                  <div className="text-center">
                    <h4 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center justify-center gap-2">
                      <CheckCircle className="h-5 w-5 text-tuggi-blue" />
                      {t('labels.review_for_approval')}
                    </h4>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                      {t('labels.verify_info_hint')}
                    </p>

                    {/* Score Badge - Always visible */}
                    <div className="mt-4 mb-2">
                      <div className={cn(
                        "inline-flex items-center px-4 py-2 rounded-lg text-base font-medium shadow-sm border",
                        verificationResult ? getScoreBackgroundColor(verificationResult.score / 100) : "bg-gray-100 dark:bg-gray-800",
                        verificationResult ? getScoreColor(verificationResult.score / 100) : "text-gray-800 dark:text-gray-200",
                        verificationResult ? "border-current" : "border-gray-300 dark:border-gray-700"
                      )}>
                        <div className="flex flex-col items-center">
                          <div className="flex items-center">
                             <span className="font-bold text-lg">
                               {verificationResult ? `${verificationResult.score}/100` : t('labels.not_verified')}
                             </span>
                            {verificationResult?.approved && <CheckCircle className="h-5 w-5 ml-2 text-green-600" />}
                          </div>
                           <span className="text-sm mt-1">
                             {verificationResult ? getScoreDescription(verificationResult.score / 100) : t('labels.not_verified')}
                           </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* POI Summary */}
                  <div className="bg-white dark:bg-gray-900 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
                     <h5 className="text-base font-medium text-gray-900 dark:text-white mb-3">
                       {t('labels.poi_summary')}
                     </h5>

                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div>
                         <p className="text-xs font-medium text-gray-700 dark:text-gray-300">{t('labels.name')}</p>
                         <p className="text-gray-900 dark:text-white truncate">{getPoi()?.name || 'N/A'}</p>
                      </div>
                      <div>
                         <p className="text-xs font-medium text-gray-700 dark:text-gray-300">{tCommon('labels.types')}</p>
                        <div className="flex flex-wrap gap-1">
                          {getPoi()?.google_types && getPoi()!.google_types!.length > 0 ? (
                            getPoi()!.google_types!.slice(0, 3).map((type: string, index: number) => (
                              <span
                                key={index}
                                className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-300"
                              >
                                {type.replace(/_/g, ' ')}
                               </span>
                             ))
                           ) : (
                             <span className="text-gray-500 dark:text-gray-400 text-xs">{t('labels.no_types')}</span>
                           )}
                          {getPoi()?.google_types && getPoi()!.google_types!.length > 3 && (
                            <span className="text-xs text-gray-500 dark:text-gray-400">+{getPoi()!.google_types!.length - 3} more</span>
                          )}
                        </div>
                      </div>
                      <div>
                         <p className="text-xs font-medium text-gray-700 dark:text-gray-300">{tCommon('labels.location')}</p>
                         <p className="text-gray-900 dark:text-white truncate">{getPoi()?.city || 'N/A'}, {getPoi()?.state || getPoi()?.country || 'N/A'}</p>
                      </div>
                      <div>
                         <p className="text-xs font-medium text-gray-700 dark:text-gray-300">{t('labels.rating')}</p>
                        <div className="flex items-center gap-1">
                          <Star className="h-3 w-3 text-yellow-400" />
                          <span className="text-gray-900 dark:text-white">{getPoi()?.rating?.toFixed(1) || 'N/A'}</span>
                        </div>
                      </div>
                    </div>

                    {currentDescription.trim() && (
                      <div className="mt-3">
                        <div className="flex justify-between items-center mb-1">
                           <p className="text-xs font-medium text-gray-700 dark:text-gray-300">{t('labels.description')}</p>
                          {verificationResult && (
                            <span className={cn(
                              "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium",
                              verificationResult.score >= 80 ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" :
                                verificationResult.score >= 60 ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200" :
                                  "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200"
                            )}>
                              Score: {verificationResult.score}/100
                              {verificationResult.approved && <CheckCircle className="h-3 w-3 ml-1 text-green-600" />}
                            </span>
                          )}
                        </div>
                        <div className="bg-gray-50 dark:bg-gray-800 rounded p-2 max-h-20 overflow-y-auto">
                          <p className="text-xs text-gray-900 dark:text-white">{currentDescription}</p>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Validation Summary */}
                  <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
                     <h5 className="text-base font-medium text-gray-900 dark:text-white mb-3">
                       {t('labels.validation_status')}
                     </h5>

                    <div className="space-y-2">
                      {/* Description Check */}
                      <div className="flex items-center justify-between p-2 rounded border border-gray-200 dark:border-gray-700">
                         <div className="flex items-center gap-2">
                           <FileText className="h-4 w-4 text-gray-500" />
                           <span className="text-sm font-medium text-gray-900 dark:text-white">{t('labels.description')}</span>
                         </div>
                        <div className="flex items-center gap-2">
                          {/* Status badge */}
                          {currentDescription.trim() ? (
                            <>
                              <div className={cn(
                                "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium",
                                (verificationResult?.score || 0) >= 80 ? "bg-green-100 text-green-800" :
                                  (verificationResult?.score || 0) >= 60 ? "bg-yellow-100 text-yellow-800" :
                                    (verificationResult?.score || 0) > 0 ? "bg-orange-100 text-orange-800" :
                                      "bg-blue-100 text-blue-800"
                              )}>
                                 {verificationResult ?
                                   verificationResult.approved ? t('labels.verified') :
                                     `Score: ${verificationResult.score}/100`
                                   : tCommon('status.complete')}
                               </div>

                              {/* Icon */}
                              {verificationResult?.approved ? (
                                <CheckCircle className="h-4 w-4 text-green-500" />
                              ) : (verificationResult?.score || 0) >= 60 ? (
                                <CheckCircle className="h-4 w-4 text-yellow-500" />
                              ) : (
                                <CheckCircle className="h-4 w-4 text-green-500" />
                              )}
                            </>
                          ) : (
                            <>
                               <AlertTriangle className="h-4 w-4 text-red-500" />
                               <span className="text-xs text-red-600 dark:text-red-400">{tCommon('status.required')}</span>
                             </>
                          )}
                        </div>
                      </div>

                      {/* Audio Check */}
                      <div className="flex items-center justify-between p-2 rounded border border-gray-200 dark:border-gray-700">
                         <div className="flex items-center gap-2">
                           <Volume2 className="h-4 w-4 text-gray-500" />
                           <span className="text-sm font-medium text-gray-900 dark:text-white">{t('labels.audio')}</span>
                         </div>
                        <div className="flex items-center gap-1">
                          {translatedDescriptions.length > 0 ? (
                            <>
                               <CheckCircle className="h-4 w-4 text-green-500" />
                               <span className="text-xs text-green-600 dark:text-green-400">
                                 {t('labels.audios_available', { count: translatedDescriptions.length })}
                               </span>
                             </>
                          ) : (
                            <>
                               <AlertTriangle className="h-4 w-4 text-red-500" />
                               <span className="text-xs text-red-600 dark:text-red-400">{t('labels.min_audio_required')}</span>
                             </>
                          )}
                        </div>
                      </div>

                      {/* Trigger Points Check */}
                      <div className="flex items-center justify-between p-2 rounded border border-gray-200 dark:border-gray-700">
                         <div className="flex items-center gap-2">
                           <Target className="h-4 w-4 text-gray-500" />
                           <span className="text-sm font-medium text-gray-900 dark:text-white">{t('labels.trigger_points')}</span>
                         </div>
                        <div className="flex items-center gap-1">
                          <Info className="h-4 w-4 text-blue-500" />
                          <span className="text-xs text-blue-600 dark:text-blue-400">
                            {t('labels.optional')} ({t('labels.configured', { count: translatedDescriptions.length || 0 })})
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>



                  {/* Approval Status */}
                  <div className={cn(
                    "rounded-lg p-4 border",
                    currentDescription.trim() && translatedDescriptions.length > 0
                      ? "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800"
                      : "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800"
                  )}>
                    <div className="flex items-center gap-2">
                      {currentDescription.trim() && translatedDescriptions.length > 0 ? (
                        <>
                          <CheckCircle className="h-5 w-5 text-green-500" />
                          <div className="flex-1">
                            <div className="flex items-center justify-between">
                               <h6 className="text-sm font-medium text-green-900 dark:text-green-200">
                                 {t('labels.ready_for_approval')}
                               </h6>
                              {verificationResult && (
                                <span className="text-xs font-bold bg-green-100 text-green-800 px-2 py-0.5 rounded-full">
                                  {t('labels.review_score', { score: verificationResult.score })}
                                </span>
                              )}
                            </div>
                             <p className="text-xs text-green-700 dark:text-green-300">
                               {t('labels.requirements_met')}
                             </p>
                          </div>
                        </>
                      ) : (
                        <>
                          <AlertTriangle className="h-5 w-5 text-red-500" />
                          <div className="flex-1">
                            <div className="flex items-center justify-between">
                               <h6 className="text-sm font-medium text-red-900 dark:text-red-200">
                                 {t('labels.pending_requirements')}
                               </h6>
                              {verificationResult && (
                                <span className="text-xs font-bold bg-red-100 text-red-800 px-2 py-0.5 rounded-full">
                                  {t('labels.review_score', { score: verificationResult.score })}
                                </span>
                              )}
                            </div>
                             <p className="text-xs text-red-700 dark:text-red-300">
                               {t('labels.complete_criteria_hint')}
                             </p>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>
  )
}
