'use client'

import { Headphones, Eye, Clock } from 'lucide-react'
import { Link } from '@/navigation'

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
}

export const RecentVisitCard = ({ visit, locale }: { visit: RecentVisit, locale: string }) => (
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
            {visit.audio_language && visit.audio_language !== 'unknown' && (
              <span className="text-[7px] font-black uppercase px-1 py-0.5 rounded bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-300 border border-blue-200/50 tracking-tighter">
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
        <p className="text-[9px] font-bold text-gray-400 uppercase truncate tracking-widest">{visit.poi_city}</p>
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
