import { Headphones, Eye } from 'lucide-react'

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
  <div className="flex items-center p-4 bg-white dark:bg-gray-800/50 rounded-xl border border-gray-100 dark:border-gray-700 hover:border-tuggi-blue/30 transition-all group shadow-sm mb-3">
    <div className="flex-shrink-0 mr-4">
      <div className={`flex items-center justify-center w-10 h-10 rounded-full ${visit.audio_played ? 'bg-green-100 dark:bg-green-900/30' : 'bg-gray-100 dark:bg-gray-700'}`}>
        {visit.audio_played ? (
          <Headphones className="h-5 w-5 text-green-500" />
        ) : (
          <Eye className="h-5 w-5 text-gray-400" />
        )}
      </div>
    </div>
    <div className="flex-1 min-w-0">
      <p className="font-bold text-gray-900 dark:text-white truncate">{visit.poi_name}</p>
      <p className="text-xs text-gray-500">{visit.poi_city}, {visit.poi_country}</p>
    </div>
    <div className="text-right ml-4">
      <p className="text-xs text-gray-400 font-medium">@{visit.user_nickname}</p>
      <p className="text-[10px] text-gray-500">
        {new Date(visit.visit_timestamp).toLocaleString(locale, { 
          day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'
        })}
      </p>
    </div>
  </div>
)
