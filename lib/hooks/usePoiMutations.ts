'use client'

import { useMemo } from 'react'
import { useSupabaseClient } from '@supabase/auth-helpers-react'
import {
  savePoiChanges,
  approvePoi,
  setPoiActive,
  deletePoi,
  garbagePoi,
  isHomologPoi,
} from '@/lib/core/poi-mutations-service'

/**
 * POI write operations bound to the authenticated Supabase client.
 * UI side-effects (feedback, cache invalidation, optimistic updates) remain in
 * the caller — these are the data operations only.
 */
export function usePoiMutations() {
  const supabase = useSupabaseClient<any>()

  return useMemo(
    () => ({
      isHomologPoi,
      savePoiChanges: (poi: any, editedPoi: any, referenceLinks: string[]) =>
        savePoiChanges(supabase, poi, editedPoi, referenceLinks),
      approvePoi: (poi: any, userId?: string | null) => approvePoi(supabase, poi, userId),
      setPoiActive: (poiId: string, isActive: boolean) => setPoiActive(supabase, poiId, isActive),
      deletePoi: (poi: any) => deletePoi(supabase, poi),
      garbagePoi: (poi: any) => garbagePoi(supabase, poi),
    }),
    [supabase],
  )
}
