/**
 * OSM POIs Hook - Server-Side Pagination with React Query
 * 
 * Fetches POIs with server-side filtering and caching
 * 
 * @module lib/hooks/use-osm-pois
 */

'use client'

import { useQuery } from '@tanstack/react-query'
import { getSupabaseClient } from '@/lib/core/supabase-client'
import type { OSMFilters } from './use-osm-filters'

export interface OSMPOI {
  uuid_id: string
  name: string
  city: string
  state: string
  country: string
  lat: number
  lon: number
  primary_category: string
  category: string
  osm_id: number
  osm_type: string
  created_at: string
  updated_at: string
}

export interface OSMPOIsResponse {
  data: OSMPOI[]
  pagination: {
    total: number
    totalPages: number
    currentPage: number
    limit: number
  }
}

export interface OSMFilterOptions {
  states: string[]
  cities: string[]
  categories: string[]
  totalCount: number
}

// Fetch POIs with server-side pagination
async function fetchOSMPOIs(filters: OSMFilters, limit: number = 50): Promise<OSMPOIsResponse> {
  const supabase = getSupabaseClient()
  
  console.log('🔍 [HOOK] Fetching OSM POIs with filters:', filters)
  
  const { data, error } = await supabase
    .schema('homolog')
    .rpc('get_pois_paginated_v2', {
      p_page: filters.page,
      p_limit: limit,
      p_search: filters.search || null,
      p_state: filters.state || null,
      p_city: filters.city || null,
      p_category: filters.category || null
    })

  if (error) {
    console.error('❌ [HOOK] Error fetching POIs:', error)
    throw error
  }

  // Extract pagination info from first row
  const total = data?.[0]?.total_count || 0
  const totalPages = data?.[0]?.total_pages || 1
  const currentPage = data?.[0]?.current_page || 1

  console.log(`✅ [HOOK] Fetched ${data?.length || 0} POIs (total: ${total}, page ${currentPage}/${totalPages})`)

  return {
    data: data || [],
    pagination: {
      total: Number(total),
      totalPages: Number(totalPages),
      currentPage: Number(currentPage),
      limit
    }
  }
}

// Fetch filter options (states, cities, categories)
async function fetchFilterOptions(stateFilter?: string): Promise<OSMFilterOptions> {
  const supabase = getSupabaseClient()
  
  const { data, error } = await supabase
    .schema('homolog')
    .rpc('get_filter_options', {
      p_state: stateFilter || null
    })

  if (error) {
    console.error('❌ [HOOK] Error fetching filter options:', error)
    throw error
  }

  const result = data?.[0]
  
  return {
    states: result?.states || [],
    cities: result?.cities || [],
    categories: result?.categories || [],
    totalCount: Number(result?.total_count || 0)
  }
}

export function useOSMPOIs(filters: OSMFilters, limit: number = 50) {
  return useQuery({
    queryKey: ['osm-pois', filters.page, filters.search, filters.state, filters.city, filters.category, limit],
    queryFn: () => fetchOSMPOIs(filters, limit),
    staleTime: 5 * 60 * 1000, // 5 minutes
    placeholderData: (previousData) => previousData, // Keep previous data while fetching
  })
}

export function useOSMFilterOptions(stateFilter?: string) {
  return useQuery({
    queryKey: ['osm-filter-options', stateFilter],
    queryFn: () => fetchFilterOptions(stateFilter),
    staleTime: 10 * 60 * 1000, // 10 minutes - filter options don't change often
  })
}
