import { Headphones, Eye, Clock } from 'lucide-react'

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
}

export const RecentVisitCard = ({ visit, locale }: { visit: RecentVisit, locale: string }) => (
  <div 
    className="group relative flex items-center p-3 mb-2 bg-gray-50/50 dark:bg-gray-800/30 border border-transparent hover:border-gray-100 dark:hover:border-gray-700 rounded-xl transition-all duration-300"
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
    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-2 mb-0.5">
        <span className="text-[11px] font-black text-gray-900 dark:text-white truncate max-w-[140px] group-hover:text-tuggi-blue transition-colors">
          {visit.poi_name}
        </span>
        {visit.platform && (
          <span className="text-[7px] font-black uppercase px-1.5 py-0.5 rounded-sm bg-gray-200/50 dark:bg-gray-700/50 text-gray-500 tracking-tighter">
            {visit.platform}
          </span>
        )}
      </div>
      <p className="text-[9px] font-bold text-gray-400 uppercase truncate tracking-tight">{visit.poi_city}</p>
    </div>

    {/* METADATA */}
    <div className="text-right shrink-0 ml-2">
      <p className="text-[9px] font-black text-tuggi-blue mb-0.5">@{visit.user_nickname}</p>
      <div className="flex items-center justify-end gap-1 text-gray-400">
        <Clock size={8} />
        <span className="text-[9px] font-bold font-mono">
          {new Date(visit.visit_timestamp).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
    </div>
  </div>
)
