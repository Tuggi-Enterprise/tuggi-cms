'use client'

import { Clock, MapPin, ChevronRight, Activity, Plane } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Trip {
  trip_session_id: string
  trip_start: string
  trip_end: string
  duration_minutes: number
  point_count: number
  heard_count: number
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
  // Group trips by date
  const groupedTrips = trips.reduce((groups: Record<string, Trip[]>, trip) => {
    const date = new Date(trip.trip_start).toLocaleDateString('pt-BR', { 
      weekday: 'long', 
      day: 'numeric', 
      month: 'long', 
      year: 'numeric' 
    })
    if (!groups[date]) groups[date] = []
    groups[date].push(trip)
    return groups
  }, {})

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-32 bg-gray-100 dark:bg-gray-800 animate-pulse rounded-[28px]" />
        ))}
      </div>
    )
  }

  if (trips.length === 0) {
    return (
      <div className="bg-white/40 dark:bg-gray-900/40 rounded-[28px] p-12 border border-gray-100 dark:border-gray-800 text-center">
        <Plane className="h-12 w-12 text-gray-200 mx-auto mb-4" />
        <p className="text-gray-400 font-bold text-xs uppercase tracking-widest">No trips recorded</p>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto pr-2 space-y-8 custom-scrollbar h-full pb-10">
      {Object.entries(groupedTrips).map(([date, dayTrips]) => (
        <div key={date} className="space-y-3">
          {/* Date Header */}
          <div className="flex items-center gap-3 px-2">
            <div className="h-px flex-1 bg-gradient-to-r from-transparent via-gray-100 to-transparent"></div>
            <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] whitespace-nowrap">
              {date}
            </h4>
            <div className="h-px flex-1 bg-gradient-to-r from-transparent via-gray-200 to-transparent"></div>
          </div>

          <div className="grid gap-3">
            {dayTrips.map((trip) => (
              <button
                key={trip.trip_session_id}
                onClick={() => onSelectTrip(trip.trip_session_id)}
                className={cn(
                  "w-full text-left p-5 rounded-[24px] transition-all duration-500 border group relative",
                  selectedTripId === trip.trip_session_id
                    ? "bg-white shadow-xl shadow-tuggi-blue/10 border-tuggi-blue/30 scale-[1.02] z-10"
                    : "bg-white/40 hover:bg-white/80 border-transparent hover:border-gray-200"
                )}
              >
                {/* Highlight Dot for selection */}
                {selectedTripId === trip.trip_session_id && (
                  <div className="absolute top-5 right-5 w-2 h-2 bg-tuggi-blue rounded-full animate-pulse shadow-[0_0_12px_rgba(0,168,232,0.6)]" />
                )}

                <div className="flex items-center justify-between mb-4">
                  <div className="flex flex-col">
                    <span className="text-[9px] font-black text-tuggi-blue/50 uppercase tracking-widest mb-1 italic">
                      Trip ID #{trip.trip_session_id.slice(0, 4)}
                    </span>
                    <div className="flex items-center gap-2 text-xs font-bold text-gray-400">
                      <span className="text-gray-900">{new Date(trip.trip_start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      <ChevronRight className="w-3 h-3 text-gray-300" />
                      <span className="text-gray-900">{new Date(trip.trip_end).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                  </div>
                  <ChevronRight className={cn(
                    "w-4 h-4 text-gray-200 transition-transform duration-500",
                    selectedTripId === trip.trip_session_id ? "translate-x-1 text-tuggi-blue" : "group-hover:translate-x-1"
                  )} />
                </div>

                {/* Performance Stats */}
                <div className="flex items-center justify-between mt-auto pt-3 border-t border-gray-50 dark:border-gray-800">
                  <div className="flex flex-col">
                    <span className="text-[9px] font-bold text-gray-400 uppercase tracking-tighter mb-0.5">Tempo</span>
                    <div className="flex items-center gap-1">
                      <Clock className="h-2.5 w-2.5 text-tuggi-blue" />
                      <span className="text-xs font-bold text-gray-900 dark:text-white">
                        {Math.round(trip.duration_minutes)}m
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-col items-center">
                    <span className="text-[9px] font-bold text-gray-400 uppercase tracking-tighter mb-0.5">Velocidade</span>
                    <div className="flex items-center gap-1">
                      <Activity className="h-2.5 w-2.5 text-green-600" />
                      <span className="text-xs font-bold text-gray-900 dark:text-white">
                        {(trip.avg_speed || 0).toFixed(1)}<span className="text-[10px] font-medium text-gray-400 ml-0.5">km/h</span>
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-col items-end">
                    <span className="text-[9px] font-bold text-gray-400 uppercase tracking-tighter mb-0.5">Visitados</span>
                    <div className="flex items-center gap-1">
                      <MapPin className="h-2.5 w-2.5 text-orange-600" />
                      <span className="text-xs font-bold text-orange-600">
                        {trip.heard_count || 0}
                      </span>
                    </div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
