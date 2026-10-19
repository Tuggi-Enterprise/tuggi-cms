'use client'

import { useLocale, useTranslations } from 'next-intl'
import { Clock, MapPin, ChevronRight, Activity, Plane } from 'lucide-react'
import { cn } from '@/lib/utils'

/** One row of `drive.get_user_trips_with_stats`. */
export interface PassportTrip {
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
  trips: PassportTrip[]
  selectedTripId?: string | null
  onSelectTrip: (tripId: string) => void
}

export function TripList({ trips, selectedTripId, onSelectTrip }: TripListProps) {
  const t = useTranslations('Pages.AppUsers.passport')
  const locale = useLocale()

  // Grouped by day, in the operator's language (it was pinned to pt-BR).
  const groupedTrips = trips.reduce((groups: Record<string, PassportTrip[]>, trip) => {
    const date = new Date(trip.trip_start).toLocaleDateString(locale, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    })
    if (!groups[date]) groups[date] = []
    groups[date].push(trip)
    return groups
  }, {})

  if (trips.length === 0) {
    return (
      <div className="rounded-2xl p-12 text-center">
        <Plane className="h-12 w-12 text-gray-200 mx-auto mb-4" aria-hidden="true" />
        <p className="text-gray-500 text-sm">{t('empty')}</p>
      </div>
    )
  }

  const time = (iso: string) => new Date(iso).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })

  return (
    <div className="space-y-6 pr-1 pb-4">
      {Object.entries(groupedTrips).map(([date, dayTrips]) => (
        <div key={date} className="space-y-3">
          <div className="flex items-center gap-3 px-2">
            <div className="h-px flex-1 bg-gray-100 dark:bg-gray-800" />
            <h4 className="text-[10px] font-black text-gray-500 uppercase tracking-[0.2em] whitespace-nowrap">{date}</h4>
            <div className="h-px flex-1 bg-gray-100 dark:bg-gray-800" />
          </div>

          <div className="grid gap-3">
            {dayTrips.map((trip) => {
              const selected = selectedTripId === trip.trip_session_id
              return (
                <button
                  key={trip.trip_session_id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => onSelectTrip(trip.trip_session_id)}
                  className={cn(
                    'w-full text-left p-4 rounded-2xl transition-colors border group relative',
                    selected
                      ? 'bg-white dark:bg-gray-900 shadow-md border-tuggi-blue/30'
                      : 'bg-white/40 dark:bg-gray-900/40 hover:bg-white border-transparent hover:border-gray-200'
                  )}
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex flex-col">
                      <span className="text-[9px] font-black text-gray-500 uppercase tracking-widest mb-1">
                        #{trip.trip_session_id.slice(0, 4)}
                      </span>
                      <div className="flex items-center gap-2 text-xs font-bold text-gray-900 dark:text-white">
                        <span>{time(trip.trip_start)}</span>
                        <ChevronRight className="w-3 h-3 text-gray-300" aria-hidden="true" />
                        <span>{time(trip.trip_end)}</span>
                      </div>
                    </div>
                    <ChevronRight
                      className={cn('w-4 h-4 text-gray-300', selected && 'text-tuggi-blue')}
                      aria-hidden="true"
                    />
                  </div>

                  <div className="flex items-center justify-between pt-3 border-t border-gray-100 dark:border-gray-800">
                    <div className="flex flex-col">
                      <span className="text-[9px] font-bold text-gray-500 uppercase mb-0.5">{t('trip_time')}</span>
                      <span className="flex items-center gap-1 text-xs font-bold text-gray-900 dark:text-white">
                        <Clock className="h-2.5 w-2.5 text-tuggi-blue" aria-hidden="true" />
                        {Math.round(trip.duration_minutes)} min
                      </span>
                    </div>
                    <div className="flex flex-col items-center">
                      <span className="text-[9px] font-bold text-gray-500 uppercase mb-0.5">{t('trip_speed')}</span>
                      <span className="flex items-center gap-1 text-xs font-bold text-gray-900 dark:text-white">
                        <Activity className="h-2.5 w-2.5 text-green-600" aria-hidden="true" />
                        {(trip.avg_speed || 0).toFixed(1)} km/h
                      </span>
                    </div>
                    <div className="flex flex-col items-end">
                      <span className="text-[9px] font-bold text-gray-500 uppercase mb-0.5">{t('trip_visited')}</span>
                      <span className="flex items-center gap-1 text-xs font-bold text-orange-600">
                        <MapPin className="h-2.5 w-2.5" aria-hidden="true" />
                        {trip.heard_count || 0}
                      </span>
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
