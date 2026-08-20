'use client'

import { Headphones, Eye, Clock, Radar, Hand } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Link } from '@/navigation'
import { visitSourceKind } from '@/lib/shared/visit-source'
import { languageFlag } from '@/lib/shared/language-flag'

export interface RecentVisit {
  visit_id: string
  poi_id: string
  poi_name: string
  poi_city: string
  poi_country: string
  poi_category: string
  user_nickname: string
  visit_timestamp: string
  audio_played: boolean
  platform: string
  audio_language: string
  /** Ausente no radar em tempo real: `core.dashboard_realtime_activity` ainda não devolve a coluna. */
  visit_source?: string
}

export const RecentVisitCard = ({ visit, locale }: { visit: RecentVisit, locale: string }) => {
  const t = useTranslations('Pages.Dashboard.labels')
  const kind = visitSourceKind(visit.visit_source)
  const flag = languageFlag(visit.audio_language)

  return (
  <Link
    href={`/pois?poiId=${visit.poi_id}`}
    className="group relative flex items-center p-3 mb-2 bg-gray-50/50 dark:bg-gray-800/30 border border-transparent hover:border-gray-100 dark:hover:border-gray-700 hover:shadow-sm rounded-xl transition-all duration-300 cursor-pointer"
  >
    {/* STATUS INDICATOR */}
    <div className="flex-shrink-0 mr-3 relative">
      <div className={`flex items-center justify-center w-9 h-9 rounded-lg shadow-sm border ${visit.audio_played ? 'bg-green-100 dark:bg-green-900/40 border-green-200 dark:border-green-800' : 'bg-gray-100 dark:bg-gray-800 border-gray-200 dark:border-gray-700'}`}>
        {visit.audio_played ? (
          <Headphones className="h-4 w-4 text-green-600 dark:text-green-400" />
        ) : (
          <Eye className="h-4 w-4 text-gray-500 dark:text-gray-400" />
        )}
      </div>
      {visit.audio_played && (
        <div className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-green-500 rounded-full border-2 border-white dark:border-gray-900 animate-pulse" />
      )}
    </div>

    {/* CONTENT */}
    <div className="flex-1 min-w-0 pr-2">
      <div className="flex flex-col gap-0.5">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[11px] font-black text-gray-900 dark:text-white truncate group-hover:text-tuggi-blue transition-colors max-w-[200px]">
            {visit.poi_name}
          </span>
          <div className="flex items-center gap-1">
            {/* Tipo de engajamento: o Trigger Point disparou sozinho, ou o usuário
                abriu o POI e apertou play. Sem a coluna, nada é afirmado. */}
            {kind !== 'unknown' && (
              <span
                className={`inline-flex items-center gap-0.5 text-[7px] font-black uppercase px-1 py-0.5 rounded border tracking-tighter ${
                  kind === 'trigger_point'
                    ? 'bg-orange-100 dark:bg-orange-900/40 text-orange-600 dark:text-orange-300 border-orange-200/50'
                    : 'bg-purple-100 dark:bg-purple-900/40 text-purple-600 dark:text-purple-300 border-purple-200/50'
                }`}
              >
                {kind === 'trigger_point' ? <Radar size={7} /> : <Hand size={7} />}
                {t(kind === 'trigger_point' ? 'engagement_trigger_point' : 'engagement_manual_play')}
              </span>
            )}
            {visit.audio_language && visit.audio_language !== 'unknown' && (
              <span className="inline-flex items-center gap-0.5 text-[7px] font-black uppercase px-1 py-0.5 rounded bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-300 border border-blue-200/50 tracking-tighter">
                {/* A bandeira é iconografia: acompanha a sigla, nunca a substitui —
                    o Windows não desenha indicador regional. */}
                {flag && <span className="text-[9px] leading-none">{flag}</span>}
                {visit.audio_language}
              </span>
            )}
            {visit.platform && (
              <span className="text-[7px] font-black uppercase px-1 py-0.5 rounded bg-gray-200/50 dark:bg-gray-700/50 text-gray-500 tracking-tighter">
                {visit.platform}
              </span>
            )}
          </div>
        </div>
        <p className="text-[9px] font-bold text-gray-400 uppercase truncate tracking-widest">
          {visit.poi_city}
          {/* Cidade repete entre países — "Valença" é BA e Portugal na mesma base. */}
          {visit.poi_country && <span className="text-gray-300 dark:text-gray-600"> &middot; {visit.poi_country}</span>}
        </p>
      </div>
    </div>

    {/* METADATA */}
    <div className="text-right shrink-0 ml-2 border-l border-gray-100 dark:border-gray-800 pl-3">
      <p className="text-[11px] font-black text-tuggi-blue mb-0.5 tracking-tight">@{visit.user_nickname}</p>
      <div className="flex items-center justify-end gap-1 text-gray-400">
        <Clock size={10} />
        <span className="text-[11px] font-bold font-mono">
          {new Date(visit.visit_timestamp).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
    </div>
  </Link>
  )
}
