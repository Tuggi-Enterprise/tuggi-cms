'use client'

import { Clock, Navigation, MapPin, ChevronRight, Activity } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Trip {
  trip_session_id: string
  trip_start: string
  trip_end: string
  duration_minutes: number
  point_count: number
  avg_speed: number
  start_latitude?: number
  start_longitude?: number
}

interface TripListProps {
  trips: Trip[]
  selectedTripId?: string | null
  onSelectTrip: (tripId: string) => void
  isLoading?: boolean
}

export function TripList({ trips, selectedTripId, onSelectTrip, isLoading }: TripListProps) {
  if (isLoading) {
    return (
      <div className="flex flex-col gap-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-32 bg-gray-100 dark:bg-gray-800 animate-pulse rounded-3xl" />
        ))}
      </div>
    )
  }

  if (trips.length === 0) {
    return (
      <div className="bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl rounded-3xl p-12 border border-gray-200 dark:border-gray-800 text-center shadow-2xl">
        <MapPin className="h-12 w-12 text-gray-300 mx-auto mb-4" />
        <p className="text-gray-500 font-medium tracking-tight">No trips recorded for this user yet.</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4 pb-8 overflow-y-auto max-h-[1000px] pr-2 custom-scrollbar">
      {trips.map((trip) => {
        const isSelected = selectedTripId === trip.trip_session_id
        return (
          <button
            key={trip.trip_session_id}
            onClick={() => onSelectTrip(trip.trip_session_id)}
            className={cn(
              "text-left bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl rounded-3xl p-6 border transition-all duration-300 group shadow-xl hover:shadow-2xl shadow-black/5 relative overflow-hidden",
              isSelected 
                ? "border-tuggi-blue ring-2 ring-tuggi-blue ring-offset-2 dark:ring-offset-gray-950 scale-[1.02]" 
                : "border-gray-200 dark:border-gray-800 hover:border-tuggi-blue/50"
            )}
          >
            {isSelected && (
              <div className="absolute top-0 right-0 p-3">
                <div className="h-2 w-2 rounded-full bg-tuggi-blue animate-pulse" />
              </div>
            )}
            
            <div className="flex justify-between items-start mb-4">
              <div>
                <h4 className="text-lg font-bold text-gray-900 dark:text-white leading-tight mb-1 tracking-tight">
                  {new Date(trip.trip_start).toLocaleDateString('pt-BR', { dateStyle: 'full' })}
                </h4>
                <p className="text-xs text-gray-500 font-semibold uppercase tracking-widest leading-none">
                  Início: {new Date(trip.trip_start).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} • Fim: {new Date(trip.trip_end).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
              <ChevronRight className={cn(
                "h-5 w-5 transition-all duration-300",
                isSelected ? "text-tuggi-blue translate-x-1" : "text-gray-300 group-hover:text-tuggi-blue/50"
              )} />
            </div>

            <div className="grid grid-cols-3 gap-2 mt-4 pt-4 border-t border-gray-100 dark:border-gray-800">
              <div className="flex flex-col">
                <div className="flex items-center gap-1.5 mb-1">
                  <Clock className="h-3 w-3 text-gray-400" />
                  <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest leading-none">Duration</span>
                </div>
                <span className="text-sm font-bold text-gray-900 dark:text-white leading-none tracking-tight">
                  {Math.round(trip.duration_minutes)} min
                </span>
              </div>

              <div className="flex flex-col">
                <div className="flex items-center gap-1.5 mb-1">
                  <Activity className="h-3 w-3 text-gray-400" />
                  <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest leading-none">Avg Speed</span>
                </div>
                <span className="text-sm font-bold text-gray-900 dark:text-white leading-none tracking-tight">
                  {(trip.avg_speed || 0).toFixed(1)} km/h
                </span>
              </div>

              <div className="flex flex-col">
                <div className="flex items-center gap-1.5 mb-1">
                  <MapPin className="h-3 w-3 text-gray-400" />
                  <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest leading-none">Points</span>
                </div>
                <span className="text-sm font-bold text-gray-900 dark:text-white leading-none tracking-tight">
                  {trip.point_count}
                </span>
              </div>
            </div>
          </button>
        )
      })}
    </div>
  )
}
