/**
 * OSM Filter Panel Component
 * 
 * Advanced filtering interface for OSM data with city and category filters
 * 
 * @module components/osm-importer/FilterPanel
 */

'use client'

import { useState } from 'react'
import { Search, X, Filter, MapPin, Tag, ChevronDown, ChevronRight } from 'lucide-react'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { OSMCategory } from '@/types/osm-importer'
import { cn } from '@/lib/utils'

interface FilterPanelProps {
  cities: string[]
  categories: OSMCategory[]
  selectedCities: string[]
  selectedCategories: string[]
  searchTerm: string
  onCityChange: (cities: string[]) => void
  onCategoryChange: (categories: string[]) => void
  onSearchChange: (term: string) => void
  onClearFilters: () => void
}

export function FilterPanel({
  cities,
  categories,
  selectedCities,
  selectedCategories,
  searchTerm,
  onCityChange,
  onCategoryChange,
  onSearchChange,
  onClearFilters
}: FilterPanelProps) {
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(['tourism', 'amenity']))
  const [showAllCities, setShowAllCities] = useState(false)

  // Group categories by key
  const groupedCategories = categories.reduce((acc, cat) => {
    if (!acc[cat.group]) acc[cat.group] = []
    acc[cat.group].push(cat)
    return acc
  }, {} as Record<string, OSMCategory[]>)

  const toggleGroup = (group: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev)
      if (next.has(group)) {
        next.delete(group)
      } else {
        next.add(group)
      }
      return next
    })
  }

  const handleCityToggle = (city: string) => {
    const newCities = selectedCities.includes(city)
      ? selectedCities.filter(c => c !== city)
      : [...selectedCities, city]
    onCityChange(newCities)
  }

  const handleCategoryToggle = (category: string) => {
    const newCategories = selectedCategories.includes(category)
      ? selectedCategories.filter(c => c !== category)
      : [...selectedCategories, category]
    onCategoryChange(newCategories)
  }

  const handleSelectAllCities = () => {
    onCityChange(cities)
  }

  const handleClearCities = () => {
    onCityChange([])
  }

  const handleSelectAllCategories = () => {
    onCategoryChange(categories.map(c => c.label))
  }

  const handleClearCategories = () => {
    onCategoryChange([])
  }

  const hasActiveFilters = selectedCities.length > 0 || selectedCategories.length > 0 || searchTerm.length > 0

  const displayedCities = showAllCities ? cities : cities.slice(0, 10)

  return (
    <div className="w-80 border-r border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-gray-200 dark:border-gray-800">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-sm text-gray-700 dark:text-gray-300 flex items-center gap-2">
            <Filter className="w-4 h-4" />
            Filters
          </h3>
          {hasActiveFilters && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onClearFilters}
              className="text-xs"
            >
              <X className="w-3 h-3 mr-1" />
              Clear All
            </Button>
          )}
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <Input
            placeholder="Search POIs..."
            value={searchTerm}
            onChange={(e) => onSearchChange(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {/* City Filter */}
        <div className="p-4 border-b border-gray-200 dark:border-gray-800">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-2">
              <MapPin className="w-4 h-4" />
              Cities ({cities.length})
            </h4>
            <div className="flex gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleSelectAllCities}
                className="text-xs h-6 px-2"
              >
                All
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleClearCities}
                className="text-xs h-6 px-2"
              >
                None
              </Button>
            </div>
          </div>

          <div className="max-h-48 overflow-y-auto space-y-2">
            {displayedCities.map(city => (
              <label key={city} className="flex items-center gap-2 cursor-pointer">
                <Checkbox
                  checked={selectedCities.includes(city)}
                  onCheckedChange={() => handleCityToggle(city)}
                />
                <span className="text-sm text-gray-700 dark:text-gray-300">{city}</span>
              </label>
            ))}
            
            {cities.length > 10 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowAllCities(!showAllCities)}
                className="w-full text-xs"
              >
                {showAllCities ? 'Show Less' : `Show All ${cities.length} Cities`}
              </Button>
            )}
          </div>
        </div>

        {/* Category Filter */}
        <div className="p-4">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-2">
              <Tag className="w-4 h-4" />
              Categories ({categories.length})
            </h4>
            <div className="flex gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleSelectAllCategories}
                className="text-xs h-6 px-2"
              >
                All
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleClearCategories}
                className="text-xs h-6 px-2"
              >
                None
              </Button>
            </div>
          </div>

          <div className="max-h-96 overflow-y-auto space-y-4">
            {Object.entries(groupedCategories).map(([group, cats]) => (
              <div key={group}>
                <button
                  onClick={() => toggleGroup(group)}
                  className="w-full flex items-center justify-between p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition"
                >
                  <span className="font-medium text-sm capitalize">{group}</span>
                  {expandedGroups.has(group) ? (
                    <ChevronDown className="w-4 h-4" />
                  ) : (
                    <ChevronRight className="w-4 h-4" />
                  )}
                </button>
                
                {expandedGroups.has(group) && (
                  <div className="ml-4 space-y-2">
                    {cats.map(cat => (
                      <label key={cat.label} className="flex items-center gap-2 cursor-pointer">
                        <Checkbox
                          checked={selectedCategories.includes(cat.label)}
                          onCheckedChange={() => handleCategoryToggle(cat.label)}
                        />
                        <span className="text-sm text-gray-700 dark:text-gray-300">
                          {cat.value}
                        </span>
                        <span className="text-xs text-gray-500">({cat.count})</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Footer with active filter count */}
      {hasActiveFilters && (
        <div className="p-4 border-t border-gray-200 dark:border-gray-800 bg-blue-50 dark:bg-blue-900/20">
          <div className="text-sm text-blue-700 dark:text-blue-300">
            <strong>Active Filters:</strong>
            <div className="mt-1 space-y-1">
              {selectedCities.length > 0 && (
                <div>• {selectedCities.length} cities selected</div>
              )}
              {selectedCategories.length > 0 && (
                <div>• {selectedCategories.length} categories selected</div>
              )}
              {searchTerm && (
                <div>• Search: &quot;{searchTerm}&quot;</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
