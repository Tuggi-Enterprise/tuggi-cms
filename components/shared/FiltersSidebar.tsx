/**
 * Filters Sidebar - Shared Component
 * 
 * Reusable filter sidebar for POI lists
 * 
 * @module components/shared/FiltersSidebar
 */

'use client'

import { Search, Filter, X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface FilterOption {
  value: string
  label: string
}

interface FiltersSidebarProps {
  // Search
  searchTerm: string
  onSearchChange: (value: string) => void
  searchPlaceholder?: string
  
  // Filters
  stateFilter: string
  onStateChange: (value: string) => void
  availableStates: string[]
  
  cityFilter: string
  onCityChange: (value: string) => void
  availableCities: string[]
  
  categoryFilter?: string
  onCategoryChange?: (value: string) => void
  availableCategories?: string[]
  
  // Actions
  onClearFilters: () => void
  hasActiveFilters: boolean
  
  // Stats
  totalCount?: number
  filteredCount?: number
  currentPage?: number
  totalPages?: number
  
  // UI
  className?: string
}

export function FiltersSidebar({
  searchTerm,
  onSearchChange,
  searchPlaceholder = 'Search POIs...',
  stateFilter,
  onStateChange,
  availableStates,
  cityFilter,
  onCityChange,
  availableCities,
  categoryFilter,
  onCategoryChange,
  availableCategories,
  onClearFilters,
  hasActiveFilters,
  totalCount,
  filteredCount,
  currentPage,
  totalPages,
  className
}: FiltersSidebarProps) {
  return (
    <div className={cn(
      "w-80 bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 p-6 overflow-y-auto flex-shrink-0",
      className
    )}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center">
          <Filter className="h-5 w-5 mr-2 text-blue-600" />
          Filters
        </h2>
        {hasActiveFilters && (
          <button
            onClick={onClearFilters}
            className="flex items-center px-3 py-1 text-sm bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
          >
            <X className="h-3 w-3 mr-1" />
            Clear
          </button>
        )}
      </div>

      {/* Search */}
      <div className="mb-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type="text"
            placeholder={searchPlaceholder}
            value={searchTerm}
            onChange={(e) => onSearchChange(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
      </div>

      {/* Filter Dropdowns */}
      <div className="space-y-4">
        {/* State Filter */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            State
          </label>
          <select
            value={stateFilter}
            onChange={(e) => onStateChange(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            <option value="">All States</option>
            {availableStates.map((state) => (
              <option key={state} value={state}>{state}</option>
            ))}
          </select>
        </div>

        {/* City Filter */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            City
          </label>
          <select
            value={cityFilter}
            onChange={(e) => onCityChange(e.target.value)}
            disabled={!stateFilter}
            className={cn(
              "w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent",
              !stateFilter && "opacity-50 cursor-not-allowed"
            )}
          >
            <option value="">All Cities</option>
            {availableCities.map((city) => (
              <option key={city} value={city}>{city}</option>
            ))}
          </select>
          {!stateFilter && (
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Select a state first
            </p>
          )}
        </div>

        {/* Category Filter */}
        {onCategoryChange && availableCategories && (
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Category
            </label>
            <select
              value={categoryFilter || ''}
              onChange={(e) => onCategoryChange(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="">All Categories</option>
              {availableCategories.map((category) => (
                <option key={category} value={category}>{category}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Stats Summary */}
      <div className="mt-6 p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
        <div className="text-sm text-gray-600 dark:text-gray-400 space-y-1">
          {totalCount !== undefined && (
            <div className="flex justify-between">
              <span>Total:</span>
              <span className="font-medium">{totalCount.toLocaleString()}</span>
            </div>
          )}
          {filteredCount !== undefined && filteredCount !== totalCount && (
            <div className="flex justify-between">
              <span>Filtered:</span>
              <span className="font-medium">{filteredCount.toLocaleString()}</span>
            </div>
          )}
          {currentPage !== undefined && totalPages !== undefined && totalPages > 1 && (
            <div className="flex justify-between">
              <span>Page:</span>
              <span className="font-medium">{currentPage} of {totalPages}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
