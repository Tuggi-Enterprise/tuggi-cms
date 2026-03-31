'use client'

import { Trophy, Map, Navigation, Award } from 'lucide-react'
import { PassportStats } from '@/lib/core/passport-service'

interface UserPassportStatsProps {
  stats: PassportStats | null
}

export function UserPassportStats({ stats }: UserPassportStatsProps) {
  if (!stats) return null

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8 mt-6 animate-in fade-in slide-in-from-top-4 duration-500">
      {/* Total POIs */}
      <div className="bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl rounded-3xl p-6 border border-gray-200 dark:border-gray-800 shadow-2xl shadow-black/5 hover:scale-[1.02] transition-transform duration-300">
        <div className="flex items-center gap-4 mb-4">
          <div className="p-3 bg-orange-100 dark:bg-orange-900/30 rounded-2xl">
            <Trophy className="h-6 w-6 text-orange-600" />
          </div>
          <div>
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest leading-none mb-1">Lifetime Passed</p>
            <h3 className="text-2xl font-bold text-gray-900 dark:text-white leading-none">{stats.total_passed_lifetime}</h3>
          </div>
        </div>
        <p className="text-xs text-gray-500 font-medium italic">"Carimbos no Passaporte"</p>
      </div>

      {/* Total Trips */}
      <div className="bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl rounded-3xl p-6 border border-gray-200 dark:border-gray-800 shadow-2xl shadow-black/5 hover:scale-[1.02] transition-transform duration-300 delay-75">
        <div className="flex items-center gap-4 mb-4">
          <div className="p-3 bg-tuggi-blue/10 rounded-2xl">
            <Map className="h-6 w-6 text-tuggi-blue" />
          </div>
          <div>
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest leading-none mb-1">Total Trips</p>
            <h3 className="text-2xl font-bold text-gray-900 dark:text-white leading-none">{stats.total_trips}</h3>
          </div>
        </div>
        <p className="text-xs text-gray-500 font-medium italic">Journeys completed</p>
      </div>

      {/* Distance */}
      <div className="bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl rounded-3xl p-6 border border-gray-200 dark:border-gray-800 shadow-2xl shadow-black/5 hover:scale-[1.02] transition-transform duration-300 delay-150">
        <div className="flex items-center gap-4 mb-4">
          <div className="p-3 bg-green-100 dark:bg-green-900/30 rounded-2xl">
            <Navigation className="h-6 w-6 text-green-600" />
          </div>
          <div>
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest leading-none mb-1">Distance</p>
            <h3 className="text-2xl font-bold text-gray-900 dark:text-white leading-none">{stats.total_distance_km.toFixed(1)} km</h3>
          </div>
        </div>
        <p className="text-xs text-gray-500 font-medium italic">Exploring the world</p>
      </div>

      {/* Top Category */}
      <div className="bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl rounded-3xl p-6 border border-gray-200 dark:border-gray-800 shadow-2xl shadow-black/5 hover:scale-[1.02] transition-transform duration-300 delay-200">
        <div className="flex items-center gap-4 mb-4">
          <div className="p-3 bg-purple-100 dark:bg-purple-900/30 rounded-2xl">
            <Award className="h-6 w-6 text-purple-600" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest leading-none mb-1">Top Category</p>
            <h3 className="text-lg font-bold text-gray-900 dark:text-white leading-tight truncate">
              {stats.top_categories[0]?.category || 'Explorer'}
            </h3>
          </div>
        </div>
        <p className="text-xs text-gray-500 font-medium italic">Favorite interest</p>
      </div>
    </div>
  )
}
