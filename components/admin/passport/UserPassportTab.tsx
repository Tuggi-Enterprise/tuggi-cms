'use client'

/**
 * THE PASSPORT, as a tab of the tourist's record (#976). It used to be a page of its own,
 * `/admin/users/<id>`, outside the localized layout; that address is now a redirect to
 * `/users/app?user=<id>&tab=passport`.
 *
 * The data lives in `usePassport`, which the drawer calls and holds: the tab loads the first time
 * it is opened and keeps what it loaded while the operator walks the other tabs. The page fetched
 * `drive.profiles.*` to print a header (name and e-mail among it); the drawer already has the
 * identity, so that read is gone (BR-USUARIO-042).
 */

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Calendar, Loader2 } from 'lucide-react'
import { getSupabaseClient } from '@/lib/core/supabase-client'
import { PassportService, type PassportStats, type TripExploration } from '@/lib/core/passport-service'
import { UserPassportStats } from '@/components/admin/passport/UserPassportStats'
import { TripList, type PassportTrip } from '@/components/admin/passport/TripList'
import { TripExplorationMap } from '@/components/admin/passport/TripExplorationMap'

const DEFAULT_BUFFER_METERS = 1000

export interface PassportState {
  loaded: boolean
  stats: PassportStats | null
  trips: PassportTrip[]
  selectedTripId: string | null
  selectTrip: (tripId: string) => void
  bufferMeters: number
  setBufferMeters: (meters: number) => void
  exploration: TripExploration | null
  explorationLoading: boolean
}

/** Loads once `enabled` first turns true, and not again for the same `userId`. */
export function usePassport(userId: string, enabled: boolean): PassportState {
  const [loaded, setLoaded] = useState(false)
  const [stats, setStats] = useState<PassportStats | null>(null)
  const [trips, setTrips] = useState<PassportTrip[]>([])
  const [selectedTripId, setSelectedTripId] = useState<string | null>(null)
  const [bufferMeters, setBufferMeters] = useState(DEFAULT_BUFFER_METERS)
  // The answer carries the question it answers: loading is "the last answer is for another trip
  // or radius", derived rather than toggled inside the effect.
  const [answer, setAnswer] = useState<{ key: string; exploration: TripExploration | null } | null>(null)
  const requestKey = selectedTripId ? `${selectedTripId}:${bufferMeters}` : null

  useEffect(() => {
    if (!enabled || loaded) return
    let cancelled = false
    const supabase = getSupabaseClient()
    void Promise.all([
      PassportService.getUserStats(supabase, userId),
      PassportService.getUserTrips(supabase, userId),
    ]).then(([nextStats, nextTrips]) => {
      if (cancelled) return
      const list = (nextTrips ?? []) as PassportTrip[]
      setStats(nextStats)
      setTrips(list)
      // The first trip is selected on open, as the page did: an empty map asks a question the
      // list beside it already answers.
      setSelectedTripId(list[0]?.trip_session_id ?? null)
      setLoaded(true)
    })
    return () => {
      cancelled = true
    }
  }, [enabled, loaded, userId])

  useEffect(() => {
    if (!selectedTripId) return
    let cancelled = false
    const key = `${selectedTripId}:${bufferMeters}`
    void PassportService.getTripExploration(getSupabaseClient(), selectedTripId, bufferMeters).then((data) => {
      if (!cancelled) setAnswer({ key, exploration: data })
    })
    return () => {
      cancelled = true
    }
  }, [selectedTripId, bufferMeters])

  return {
    loaded,
    stats,
    trips,
    selectedTripId,
    selectTrip: setSelectedTripId,
    bufferMeters,
    setBufferMeters,
    exploration: answer?.exploration ?? null,
    explorationLoading: requestKey !== null && answer?.key !== requestKey,
  }
}

export function UserPassportTab({ passport }: { passport: PassportState }) {
  const t = useTranslations('Pages.AppUsers.passport')

  if (!passport.loaded) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-tuggi-blue" aria-hidden="true" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <UserPassportStats stats={passport.stats} />

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <section className="lg:col-span-4 flex flex-col min-h-0 lg:max-h-[800px] bg-white/40 dark:bg-gray-900/40 p-4 rounded-3xl border border-gray-100 dark:border-gray-800">
          <div className="flex items-center justify-between mb-4 px-2 shrink-0">
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-gray-400" aria-hidden="true" />
              <h3 className="font-bold text-gray-900 dark:text-white uppercase tracking-widest text-[10px]">
                {t('trip_history')}
              </h3>
            </div>
            <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">
              {passport.trips.length} {t('trips')}
            </span>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto">
            <TripList trips={passport.trips} selectedTripId={passport.selectedTripId} onSelectTrip={passport.selectTrip} />
          </div>
        </section>

        <div className="lg:col-span-8 flex flex-col min-h-[500px]">
          {passport.trips.length === 0 ? (
            // No trip, no map: the empty list's sentence again, never a blank map.
            <div className="flex-1 flex items-center justify-center rounded-3xl border border-dashed border-gray-200 dark:border-gray-800 p-8 text-center text-sm text-gray-500">
              {t('empty')}
            </div>
          ) : (
            <TripExplorationMap
              exploration={passport.exploration}
              bufferMeters={passport.bufferMeters}
              onBufferChange={passport.setBufferMeters}
              isLoading={passport.explorationLoading}
              hasSelection={Boolean(passport.selectedTripId)}
            />
          )}
        </div>
      </div>
    </div>
  )
}
