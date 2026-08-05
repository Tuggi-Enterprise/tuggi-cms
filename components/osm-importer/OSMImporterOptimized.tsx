/**
 * OSM Importer Page - Optimized Version
 * 
 * Uses server-side pagination, URL-synced filters, and React Query caching
 * 
 * @module components/osm-importer/OSMImporterOptimized
 */

'use client'

import { useState, Suspense } from 'react'
import dynamic from 'next/dynamic'
import { Upload, Trash2, Download, RefreshCw, CheckSquare, Square, X, Loader2, XCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTranslations } from 'next-intl'
import { useCmsUser } from '@/lib/hooks/useCmsUser'

// Hooks
import { useOSMFilters } from '@/lib/hooks/use-osm-filters'
import { useOSMPOIs, useOSMFilterOptions, OSMPOI } from '@/lib/hooks/use-osm-pois'
import { useOSMSelection } from '@/lib/hooks/use-osm-selection'

// Shared Components
import { Pagination } from '@/components/shared/Pagination'
import { FiltersSidebar } from '@/components/shared/FiltersSidebar'
import { ViewModeToggle } from '@/components/shared/ViewModeToggle'

// Local Components
import { POITable } from './POITable'
import { FileUpload } from './FileUpload'
import type { POI } from '@/components/poi-management/POIDetailsModal'

// Both are opt-in: the map only renders in map mode, the modal only after a POI is picked.
// Statically imported they were the bulk of this route's initial JS (map + 2.5k-line modal).
const OptimizedOSMMap = dynamic(
  () => import('./OptimizedOSMMap').then(m => m.OptimizedOSMMap),
  {
    ssr: false,
    loading: () => (
      <div className="h-full w-full min-h-[400px] flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-tuggi-blue" />
      </div>
    )
  }
)

const POIDetailsModal = dynamic(
  () => import('@/components/poi-management/POIDetailsModal').then(m => m.POIDetailsModal),
  { ssr: false }
)

interface OSMImporterOptimizedProps {
  initialHasData?: boolean
}

// Transform OSMPOI to POI format for modal
function transformToModalPOI(poi: OSMPOI, t: any, tCommon: any): POI {
  return {
    id: poi.uuid_id,
    name: poi.name || t('table.unnamed'),
    city: poi.city || tCommon('labels.unknown'),
    state: poi.state || null,
    country: poi.country || tCommon('labels.brazil'),
    category: poi.primary_category || poi.category || tCommon('labels.unknown'),
    approved: false,
    created_at: poi.created_at,
    updated_at: poi.updated_at,
    coordinates: poi.lat && poi.lon ? {
      latitude: Number(poi.lat),
      longitude: Number(poi.lon)
    } : undefined,
    // Default values for required fields
    approved_by: null,
    approved_at: null,
    rating: null,
    image_url: null,
    user_ratings_total: null,
    formatted_address: null,
    vicinity: null,
    website: null,
    formatted_phone_number: null,
    business_status: null,
    price_level: null,
    opening_hours: null,
    google_types: null,
    photos_references: null,
    google_place_id: null,
    user_id: null,
    has_description: false,
    has_audio: false,
    description_count: 0,
    audio_count: 0,
    available_languages: [],
    trigger_points_count: 0,
    active_trigger_points_count: 0,
    reference_links: [],
    descriptions: [],
    verification_score: null
  } as POI
}

// Transform OSMPOI to SimpleOSMPOI for POITable
function transformToSimplePOI(poi: OSMPOI): any {
  return {
    id: poi.uuid_id,
    uuid_id: poi.uuid_id,
    name: poi.name,
    city: poi.city,
    state: poi.state,
    country: poi.country,
    primary_category: poi.primary_category,
    category: poi.category,
    lat: poi.lat,
    lon: poi.lon
  }
}

export function OSMImporterOptimized({ initialHasData = false }: OSMImporterOptimizedProps) {
  const t = useTranslations('Pages.OSMImporter')
  const tCommon = useTranslations('Common')

  // URL-synced filters
  const { filters, updateFilters, clearFilters, setPage, setView, hasActiveFilters } = useOSMFilters()
  
  // Server-side paginated data
  const { data: poisResponse, isLoading, isFetching, refetch } = useOSMPOIs(filters, 50)
  
  // Filter options (states, cities, categories)
  const { data: filterOptions } = useOSMFilterOptions(filters.state)
  
  // Selection state
  const pois = poisResponse?.data || []
  const { 
    selectedIds, 
    selectedCount, 
    allSelected, 
    toggleSelection, 
    toggleAll, 
    clearSelection 
  } = useOSMSelection(pois)

  // Modal state
  const [selectedPOI, setSelectedPOI] = useState<POI | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
  
  // Upload modal state
  const [showUploadModal, setShowUploadModal] = useState(false)
  
  // Delete state
  const [isDeleting, setIsDeleting] = useState(false)

  // Pagination info
  const pagination = poisResponse?.pagination || { total: 0, totalPages: 1, currentPage: 1, limit: 50 }
  const hasData = pagination.total > 0 || initialHasData
  const { canEdit, isViewer } = useCmsUser()

  // Handle POI click
  const handlePOIClick = (poi: any) => {
    const osmPOI = pois.find(p => p.uuid_id === (poi.id || poi.uuid_id))
    if (osmPOI) {
      setSelectedPOI(transformToModalPOI(osmPOI, t, tCommon))
      setIsModalOpen(true)
    }
  }

  // Handle blacklist selected
  const handleBlacklistSelected = async () => {
    if (selectedCount === 0) return
    
    const confirmed = window.confirm(
      `Tem certeza que deseja mover ${selectedCount} POIs para o Lixo? Eles serão excluídos e não poderão ser re-importados.`
    )
    if (!confirmed) return
    
    setIsDeleting(true)
    try {
      const response = await fetch('/api/supabase/pois/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(selectedIds) })
      })
      
      const result = await response.json()
      
      if (result.success) {
        clearSelection()
        refetch()
        alert(`${result.deleted} POIs movidos para o lixo com sucesso`)
      } else {
        alert(t('error', { message: result.error }))
      }
    } catch (error) {
      alert(t('error', { message: error instanceof Error ? error.message : 'Unknown error' }))
    } finally {
      setIsDeleting(false)
    }
  }

  // Handle file upload
  const handleFileUpload = async (file: File) => {
    // TODO: Implement file upload logic
    setShowUploadModal(false)
    refetch()
  }

  // Loading state for initial load
  if (isLoading && !hasData) {
    return (
      <div className="h-full flex items-center justify-center bg-tuggi-background dark:bg-gray-900">
        <div className="text-center">
          <Loader2 className="w-12 h-12 animate-spin text-blue-600 mx-auto mb-4" />
          <p className="text-gray-600 dark:text-gray-400">{t('status.loading')}</p>
        </div>
      </div>
    )
  }

  // Empty state
  if (!hasData && !isLoading) {
    return (
      <div className="h-full flex flex-col bg-tuggi-background dark:bg-gray-900">
        <Header onUpload={() => setShowUploadModal(true)} hasData={false} />
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="w-full max-w-2xl">
            <div className="text-center mb-8">
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
                {t('empty.title')}
              </h2>
              <p className="text-gray-600 dark:text-gray-400">
                {t('empty.subtitle')}
              </p>
            </div>
            <FileUpload
              onFileSelect={handleFileUpload}
              isLoading={false}
              error={null}
              currentFile={null}
            />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col bg-tuggi-background dark:bg-gray-900">
      {/* Header */}
      <Header 
        onUpload={() => setShowUploadModal(true)} 
        onRefresh={() => refetch()}
        hasData={true}
        totalCount={pagination.total}
      />

      {/* Toolbar */}
      <div className="bg-white dark:bg-gray-950 border-b border-gray-200 dark:border-gray-800 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            {/* View Mode Toggle */}
            <ViewModeToggle 
              viewMode={filters.view} 
              onViewChange={(mode) => setView(mode)} 
            />

            {/* Selection Controls */}
            <div className="flex items-center space-x-2 border-l pl-4 border-gray-200 dark:border-gray-700">
              <button
                onClick={toggleAll}
                className="flex items-center space-x-2 px-3 py-2 text-sm text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
              >
                {allSelected ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
                <span>{allSelected ? t('actions.deselect_all') : t('actions.select_all')}</span>
              </button>
              
              {selectedCount > 0 && (
                <button
                  onClick={clearSelection}
                  className="px-3 py-2 text-sm text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
                >
                  {t('actions.clear_selection', { count: selectedCount })}
                </button>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center space-x-4">
            {isFetching && (
              <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
            )}
            
            {canEdit && (
              <>
                <button
                  onClick={handleBlacklistSelected}
                  disabled={!canEdit || isViewer || selectedCount === 0 || isDeleting}
                  className={cn(
                    "px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center",
                    selectedCount === 0 || isDeleting || !canEdit || isViewer
                      ? "bg-gray-200 text-gray-400 cursor-not-allowed"
                      : "bg-gray-900 text-white dark:bg-white dark:text-gray-900 hover:opacity-80"
                  )}
                  title="Mover para Lixo (Blacklist)"
                >
                  <XCircle className="w-4 h-4 mr-2" />
                  {isDeleting ? t('status.deleting') : 'Mover para Lixo'}
                </button>
                
                <button
                  disabled={!canEdit || isViewer || selectedCount === 0}
                  className={cn(
                    "px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center",
                    selectedCount === 0 || !canEdit || isViewer
                      ? "bg-gray-200 text-gray-400 cursor-not-allowed"
                      : "bg-green-600 text-white hover:bg-green-700"
                  )}
                >
                  <Download className="w-4 h-4 mr-2" />
                  {t('actions.import')}
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Filters Sidebar - Only in table mode */}
        {filters.view === 'table' && (
          <FiltersSidebar
            searchTerm={filters.search}
            onSearchChange={(search) => updateFilters({ search })}
            stateFilter={filters.state}
            onStateChange={(state) => updateFilters({ state, city: '' })}
            availableStates={filterOptions?.states || []}
            cityFilter={filters.city}
            onCityChange={(city) => updateFilters({ city })}
            availableCities={filterOptions?.cities || []}
            categoryFilter={filters.category}
            onCategoryChange={(category) => updateFilters({ category })}
            availableCategories={filterOptions?.categories || []}
            onClearFilters={clearFilters}
            hasActiveFilters={hasActiveFilters}
            totalCount={filterOptions?.totalCount}
            filteredCount={pagination.total}
            currentPage={pagination.currentPage}
            totalPages={pagination.totalPages}
          />
        )}

        {/* Content Area */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {filters.view === 'table' ? (
            <>
              {/* Table */}
              <div className="flex-1 overflow-auto">
                <div className="bg-white dark:bg-gray-800 min-h-full">
                  <POITable
                    features={pois.map(transformToSimplePOI)}
                    selectedFeatures={selectedIds}
                    onToggleSelection={toggleSelection}
                    onPOIClick={handlePOIClick}
                  />
                </div>
              </div>

              {/* Pagination */}
              <div className="bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 px-4 py-3">
                <Pagination
                  currentPage={pagination.currentPage}
                  totalPages={pagination.totalPages}
                  totalItems={pagination.total}
                  itemsPerPage={pagination.limit}
                  onPageChange={setPage}
                />
              </div>
            </>
          ) : (
            <OptimizedOSMMap
              searchTerm={filters.search}
              countryFilter={tCommon('labels.brazil')}
              stateFilter={filters.state}
              cityFilter={filters.city}
              categoryFilter={filters.category}
              onPOIClick={handlePOIClick}
              selectedFeatureIds={selectedIds}
              height="100%"
            />
          )}
        </div>
      </div>

      {/* Upload Modal */}
      {showUploadModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-900 rounded-lg p-6 max-w-2xl w-full mx-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                {t('actions.add_data')}
              </h3>
              <button
                onClick={() => setShowUploadModal(false)}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
            <FileUpload
              onFileSelect={handleFileUpload}
              isLoading={false}
              error={null}
              currentFile={null}
            />
          </div>
        </div>
      )}

      {/* POI Details Modal */}
      {selectedPOI && isModalOpen && (
        <POIDetailsModal
          poi={selectedPOI}
          isOpen={isModalOpen}
          onClose={() => {
            setIsModalOpen(false)
            setSelectedPOI(null)
          }}
          onUpdate={() => refetch()}
          onPOIUpdated={() => refetch()}
          onPOIDeleted={() => {
            refetch()
            setIsModalOpen(false)
            setSelectedPOI(null)
          }}
        />
      )}
    </div>
  )
}

// Header Component
function Header({ 
  onUpload, 
  onRefresh, 
  hasData,
  totalCount 
}: { 
  onUpload: () => void
  onRefresh?: () => void
  hasData: boolean
  totalCount?: number
}) {
  const t = useTranslations('Pages.OSMImporter')
  return (
    <div className="bg-white dark:bg-gray-950 border-b border-gray-200 dark:border-gray-800 px-6 py-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            {t('title')}
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {t('subtitle')}
            {totalCount !== undefined && ` • ${totalCount.toLocaleString()} POIs`}
          </p>
        </div>
        
        {hasData && (
          <div className="flex items-center space-x-2">
            {onRefresh && (
              <button
                onClick={onRefresh}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 border border-gray-300 rounded-lg hover:bg-gray-50 flex items-center"
              >
                <RefreshCw className="w-4 h-4 mr-2" />
                {t('actions.refresh')}
              </button>
            )}
            <button
              onClick={onUpload}
              className="px-4 py-2 text-sm text-green-600 hover:text-green-700 border border-green-300 rounded-lg hover:bg-green-50 flex items-center"
            >
              <Upload className="w-4 h-4 mr-2" />
              {t('actions.add_data')}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
