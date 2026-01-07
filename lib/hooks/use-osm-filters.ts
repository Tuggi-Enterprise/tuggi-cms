/**
 * OSM Filters Hook - URL Synchronized
 * 
 * Manages filter state with automatic URL synchronization
 * Following DRY and Single Responsibility principles
 * 
 * @module lib/hooks/use-osm-filters
 */

'use client'

import { useCallback, useMemo } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

export interface OSMFilters {
  search: string
  state: string
  city: string
  category: string
  page: number
  view: 'table' | 'map'
}

const DEFAULT_FILTERS: OSMFilters = {
  search: '',
  state: '',
  city: '',
  category: '',
  page: 1,
  view: 'table'
}

export function useOSMFilters() {
  const router = useRouter()
  const searchParams = useSearchParams()

  // Parse filters from URL
  const filters = useMemo((): OSMFilters => ({
    search: searchParams.get('search') || DEFAULT_FILTERS.search,
    state: searchParams.get('state') || DEFAULT_FILTERS.state,
    city: searchParams.get('city') || DEFAULT_FILTERS.city,
    category: searchParams.get('category') || DEFAULT_FILTERS.category,
    page: parseInt(searchParams.get('page') || '1', 10) || DEFAULT_FILTERS.page,
    view: (searchParams.get('view') as 'table' | 'map') || DEFAULT_FILTERS.view
  }), [searchParams])

  // Update URL with new filters
  const updateFilters = useCallback((updates: Partial<OSMFilters>) => {
    const newFilters = { ...filters, ...updates }
    
    // Reset page to 1 when filters change (except page itself)
    if (!('page' in updates) && Object.keys(updates).some(k => k !== 'view')) {
      newFilters.page = 1
    }
    
    // Build URL params
    const params = new URLSearchParams()
    
    if (newFilters.search) params.set('search', newFilters.search)
    if (newFilters.state) params.set('state', newFilters.state)
    if (newFilters.city) params.set('city', newFilters.city)
    if (newFilters.category) params.set('category', newFilters.category)
    if (newFilters.page > 1) params.set('page', newFilters.page.toString())
    if (newFilters.view !== 'table') params.set('view', newFilters.view)
    
    const queryString = params.toString()
    router.replace(`/osm-importer${queryString ? `?${queryString}` : ''}`, { scroll: false })
  }, [filters, router])

  // Clear all filters
  const clearFilters = useCallback(() => {
    router.replace('/osm-importer', { scroll: false })
  }, [router])

  // Set page
  const setPage = useCallback((page: number) => {
    updateFilters({ page })
  }, [updateFilters])

  // Set view mode
  const setView = useCallback((view: 'table' | 'map') => {
    updateFilters({ view })
  }, [updateFilters])

  // Check if any filter is active
  const hasActiveFilters = useMemo(() => {
    return filters.search !== '' || 
           filters.state !== '' || 
           filters.city !== '' || 
           filters.category !== ''
  }, [filters])

  return {
    filters,
    updateFilters,
    clearFilters,
    setPage,
    setView,
    hasActiveFilters
  }
}
