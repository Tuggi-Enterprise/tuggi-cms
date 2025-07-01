'use client'

import { useState, useEffect } from 'react'
import { 
  Search, Save, Upload, MapPin, Star, Clock, Globe, ExternalLink, 
  CheckCircle2, Loader2, ChevronDown, ChevronUp, Info, Users,
  Building2, Camera, Phone, Globe2, MapIcon, X, Settings
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { GoogleMapComponent, extractPolygonCoordinates, calculatePolygonCenter } from '@/components/ui/GoogleMapComponent'
import { CategorySelectionPanel } from '@/components/poi-importer/CategorySelectionPanel'
import { SettingsPanel } from '@/components/poi-importer/SettingsPanel'
import { usePolygonManagement } from '@/lib/hooks/use-polygon-management'
import { usePOISearch } from '@/lib/hooks/use-poi-search'
import { useMapState } from '@/lib/hooks/use-map-state'

export default function POIImporterPageRefactored() {
  const [isClient, setIsClient] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [selectedCountry, setSelectedCountry] = useState('')

  // Custom hooks for state management
  const polygonState = usePolygonManagement()
  const poiSearch = usePOISearch(selectedCountry)
  const mapState = useMapState()

  useEffect(() => {
    setIsClient(true)
    // Auto-fit map on initial load
    polygonState.fetchSavedPolygons(true).then((bounds) => {
      if (bounds) {
        mapState.updateMapView(bounds.center, bounds.zoom)
      }
    })
  }, [])

  // Handle search when category and polygon are ready
  const handleCategorySearch = () => {
    if (polygonState.currentPolygonCoords.length > 0) {
      poiSearch.clearSearchResults()
      poiSearch.searchPlacesInPolygon(
        poiSearch.selectedCategory, 
        polygonState.currentPolygonCoords
      )
    }
  }

  // Handle polygon complete
  const handlePolygonComplete = async (polygon: google.maps.Polygon) => {
    await polygonState.handlePolygonComplete(polygon)
    // Clear previous search results when new polygon is drawn
    poiSearch.clearSearchResults()
  }

  // Handle save polygon
  const handleSavePolygon = async () => {
    try {
      await polygonState.saveCurrentPolygon(selectedCountry)
    } catch (error) {
      console.error('Error saving polygon:', error)
    }
  }

  // Handle load saved polygon
  const handleLoadPolygon = (polygonId: string) => {
    const bounds = polygonState.loadPolygon(polygonId)
    if (bounds) {
      mapState.updateMapView(bounds.center, bounds.zoom)
    }
    // Clear search results when loading a different polygon
    poiSearch.clearSearchResults()
  }

  // Handle city search
  const handleCitySearch = async () => {
    try {
      const result = await mapState.searchCity()
      if (result) {
        // Clear existing polygon and search when searching new city
        polygonState.clearCurrentPolygon()
        poiSearch.clearSearchResults()
      }
    } catch (error) {
      console.error('Error searching city:', error)
    }
  }

  if (!isClient) {
    return <div className="flex items-center justify-center h-screen">Loading...</div>
  }

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      {/* Top Section: Map + Sidebar (60% height) */}
      <div className="flex flex-1" style={{ height: '60%' }}>
        {/* Sidebar */}
        <div className={cn(
          "bg-white border-r border-gray-200 flex flex-col transition-all duration-300",
          sidebarCollapsed ? "w-12" : "w-80"
        )}>
          {/* Header */}
          <div className="p-4 border-b border-gray-200 flex items-center justify-between">
            {!sidebarCollapsed && (
              <div>
                <h1 className="text-lg font-semibold text-gray-900">POI Importer</h1>
                <p className="text-sm text-gray-600">Find and import attractions</p>
              </div>
            )}
            <button
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              className="p-2 hover:bg-gray-100 rounded-md"
            >
              {sidebarCollapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
            </button>
          </div>

          {!sidebarCollapsed && (
            <div className="flex-1 overflow-y-auto">
              {/* Step 1: City Search & Draw Area */}
              <div className="p-4 border-b border-gray-200">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-6 h-6 bg-blue-500 text-white rounded-full flex items-center justify-center text-xs font-bold">1</div>
                  <h2 className="text-sm font-semibold text-gray-900">Find City & Draw Area</h2>
                </div>

                {/* City Search */}
                <div className="space-y-3">
                  <div>
                    <label className="text-xs font-medium text-blue-800 mb-2 block">Search City</label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder="Enter city name..."
                        value={mapState.cityQuery}
                        onChange={(e) => mapState.setCityQuery(e.target.value)}
                        onKeyPress={(e) => e.key === 'Enter' && handleCitySearch()}
                        className="flex-1 px-3 py-2 border border-blue-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                      />
                      <button
                        onClick={handleCitySearch}
                        disabled={mapState.isSearchingCity || !mapState.cityQuery.trim()}
                        className="px-3 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {mapState.isSearchingCity ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Search className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Drawing Controls */}
                  <div>
                    <label className="text-xs font-medium text-blue-800 mb-2 block">Draw Search Area</label>
                    <button
                      onClick={() => mapState.setIsDrawingMode(!mapState.isDrawingMode)}
                      className={cn(
                        "w-full px-3 py-2 rounded-md text-sm font-medium transition-colors",
                        mapState.isDrawingMode 
                          ? "bg-red-500 text-white hover:bg-red-600" 
                          : "bg-blue-500 text-white hover:bg-blue-600"
                      )}
                    >
                      {mapState.isDrawingMode ? 'Cancel Drawing' : 'Start Drawing Area'}
                    </button>
                  </div>

                  {/* Polygon Stats */}
                  {polygonState.currentPolygonCoords.length > 0 && (
                    <div className="p-2 bg-green-50 border border-green-200 rounded-md">
                      <p className="text-xs text-green-700">
                        ✓ Area defined: {polygonState.polygonStats.vertices} points
                      </p>
                    </div>
                  )}

                  {/* Load Saved Areas */}
                  {polygonState.savedPolygons.length > 0 && (
                    <div className="mt-3">
                      <label className="text-xs font-medium text-blue-800 mb-2 block">Load Saved Area</label>
                      <select
                        value={polygonState.selectedSavedPolygon}
                        onChange={(e) => e.target.value && handleLoadPolygon(e.target.value)}
                        className="w-full px-3 py-2 border border-blue-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                      >
                        <option value="">Choose saved area...</option>
                        {polygonState.savedPolygons.map((polygon) => (
                          <option key={polygon.id} value={polygon.id}>
                            {polygon.name}{polygon.country_name ? ` (${polygon.country_name})` : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              </div>

              {/* Step 2: Category Selection */}
              <CategorySelectionPanel
                selectedCategory={poiSearch.selectedCategory}
                onCategorySelect={poiSearch.setSelectedCategory}
                isSearching={poiSearch.isSearching}
                disabled={polygonState.currentPolygonCoords.length === 0}
                onSearch={handleCategorySearch}
              />

              {/* Step 3: Analysis Status */}
              {poiSearch.searchResults.length > 0 && (
                <div className="p-4 border-b border-gray-200">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-6 h-6 bg-green-500 text-white rounded-full flex items-center justify-center text-xs font-bold">3</div>
                    <h2 className="text-sm font-semibold text-gray-900">Analysis Progress</h2>
                  </div>
                  
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-gray-600">Found:</span>
                      <span className="font-medium text-gray-900">{poiSearch.searchStats.total} places</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-gray-600">Selected:</span>
                      <span className="font-medium text-green-600">{poiSearch.searchStats.selected} for Tuggi</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-gray-600">Already imported:</span>
                      <span className="font-medium text-gray-500">{poiSearch.searchStats.alreadyExists} places</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Save Area Section */}
              {polygonState.currentPolygonCoords.length > 0 && (
                <div className="p-4 border-b border-gray-200">
                  <h3 className="text-sm font-medium text-gray-700 mb-3">Save This Area</h3>
                  <div className="space-y-2">
                    <div>
                      <label className="text-xs text-gray-600 mb-1 block">Area Name (auto-generated)</label>
                      <input
                        type="text"
                        placeholder="Auto-generating name..."
                        value={polygonState.polygonName}
                        onChange={(e) => polygonState.setPolygonName(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                      />
                      <p className="text-xs text-gray-500 mt-1">
                        ✨ Name auto-generated from your city search. You can edit it before saving.
                      </p>
                    </div>
                    
                    <button
                      onClick={handleSavePolygon}
                      disabled={polygonState.isSavingPolygon}
                      className="w-full px-3 py-2 bg-green-500 text-white rounded-md text-sm font-medium hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {polygonState.isSavingPolygon ? (
                        <Loader2 className="h-4 w-4 animate-spin mx-auto" />
                      ) : (
                        "Save Area for Future Use"
                      )}
                    </button>
                  </div>
                </div>
              )}

              {/* Mapped Areas Summary */}
              {polygonState.savedPolygons.length > 0 && (
                <div className="p-4 border-b border-gray-200">
                  <div className="p-3 bg-green-50 border border-green-200 rounded-md">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 bg-green-500 rounded-full"></div>
                      <span className="text-sm font-medium text-green-700">
                        {polygonState.savedPolygons.length} Saved Area{polygonState.savedPolygons.length > 1 ? 's' : ''} Visible
                      </span>
                    </div>
                    <p className="text-xs text-green-600 mt-1">
                      Showing coverage to avoid rework in same places
                    </p>
                  </div>
                </div>
              )}

              {/* Settings */}
              <SettingsPanel
                selectedCountry={selectedCountry}
                onCountryChange={setSelectedCountry}
              />

              {/* Status Messages */}
              {(poiSearch.searchStatus || poiSearch.importStatus) && (
                <div className="p-4">
                  <div className={cn(
                    "p-3 rounded-md",
                    poiSearch.isSearching ? "bg-blue-50 border border-blue-200" :
                    poiSearch.searchStatus.includes('Error') ? "bg-red-50 border border-red-200" :
                    poiSearch.searchStatus.includes('Found') ? "bg-green-50 border border-green-200" :
                    "bg-blue-50 border border-blue-200"
                  )}>
                    <div className="flex items-start gap-2">
                      {poiSearch.isSearching && <Loader2 className="h-4 w-4 animate-spin text-blue-500 mt-0.5 flex-shrink-0" />}
                      <p className={cn(
                        "text-sm",
                        poiSearch.isSearching ? "text-blue-700" :
                        poiSearch.searchStatus.includes('Error') ? "text-red-700" :
                        poiSearch.searchStatus.includes('Found') ? "text-green-700" :
                        "text-blue-700"
                      )}>
                        {poiSearch.importStatus || poiSearch.searchStatus}
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Main Map Area */}
        <div className="flex-1 relative">
          <GoogleMapComponent
            center={mapState.mapCenter}
            zoom={mapState.mapZoom}
            height="100%"
            enableDrawing={mapState.isDrawingMode}
            onPolygonComplete={handlePolygonComplete}
            markers={poiSearch.searchResults.map(place => ({
              id: place.place_id,
              position: place.geometry.location,
              title: place.name,
              description: `${place.formatted_address}${place.rating ? ` • ⭐ ${place.rating}` : ''}`,
              color: place.alreadyExists ? '#6B7280' : place.isSelected ? '#3B82F6' : '#F59E0B'
            }))}
            polygon={polygonState.currentPolygonCoords}
            savedPolygons={polygonState.savedPolygons}
            cityBoundary={mapState.cityBoundary}
            cityName={mapState.currentCityName}
            isLoading={poiSearch.isSearching}
            loadingMessage={poiSearch.isSearching ? poiSearch.searchStatus || 'Searching for places...' : ''}
          />
        </div>
      </div>

      {/* Bottom Analysis Panel (40% height) */}
      <div className="bg-white border-t border-gray-200 flex flex-col" style={{ height: '50%' }}>
        {/* Results Header */}
        <div className="p-4 border-b border-gray-200 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h2 className="text-lg font-semibold text-gray-900">Analysis Results</h2>
            {poiSearch.searchResults.length > 0 && (
              <div className="flex items-center gap-4 text-sm">
                <span className="text-gray-600">
                  {poiSearch.searchStats.total} found • {poiSearch.searchStats.selected} selected
                </span>
                {poiSearch.searchStats.alreadyExists > 0 && (
                  <span className="text-gray-500">
                    {poiSearch.searchStats.alreadyExists} already imported
                  </span>
                )}
              </div>
            )}
          </div>
          
          {poiSearch.getSelectedPlaces().length > 0 && (
            <button
              onClick={poiSearch.importSelectedPlaces}
              disabled={poiSearch.isImporting}
              className="px-4 py-2 bg-green-500 text-white rounded-md hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {poiSearch.isImporting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Upload className="h-4 w-4" />
              )}
              Import {poiSearch.getSelectedPlaces().length} Selected
            </button>
          )}
        </div>

        {/* Results Content */}
        <div className="flex-1 overflow-y-auto">
          {poiSearch.searchResults.length === 0 ? (
            <div className="flex items-center justify-center h-full text-gray-500">
              <div className="text-center">
                <Search className="h-12 w-12 mx-auto mb-4 text-gray-300" />
                <h3 className="text-lg font-medium text-gray-900 mb-2">No search results yet</h3>
                <p className="text-sm text-gray-600">
                  Draw an area on the map and select a category to start searching for places
                </p>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 p-4">
              {poiSearch.searchResults.map((place) => (
                <div
                  key={place.place_id}
                  className={cn(
                    "border rounded-lg p-4 cursor-pointer transition-all",
                    place.alreadyExists
                      ? "border-gray-300 bg-gray-50"
                      : place.isSelected
                      ? "border-blue-500 bg-blue-50"
                      : "border-gray-200 hover:border-gray-300 bg-white"
                  )}
                  onClick={() => !place.alreadyExists && poiSearch.togglePlaceSelection(place.place_id)}
                >
                  <div className="flex items-start justify-between mb-2">
                    <h4 className="font-medium text-sm text-gray-900 leading-tight">
                      {place.name}
                    </h4>
                    {place.alreadyExists ? (
                      <CheckCircle2 className="h-5 w-5 text-gray-400 flex-shrink-0" />
                    ) : place.isSelected ? (
                      <CheckCircle2 className="h-5 w-5 text-blue-500 flex-shrink-0" />
                    ) : (
                      <div className="w-5 h-5 border-2 border-gray-300 rounded flex-shrink-0" />
                    )}
                  </div>
                  
                  <p className="text-xs text-gray-600 mb-2 leading-tight">
                    {place.formatted_address}
                  </p>
                  
                  <div className="flex items-center gap-2 text-xs text-gray-500">
                    {place.rating && (
                      <div className="flex items-center gap-1">
                        <Star className="h-3 w-3 fill-yellow-400 text-yellow-400" />
                        <span>{place.rating}</span>
                        {place.user_ratings_total && (
                          <span>({place.user_ratings_total})</span>
                        )}
                      </div>
                    )}
                    {place.types && place.types.length > 0 && (
                      <span className="truncate">
                        {place.types[0].replace(/_/g, ' ')}
                      </span>
                    )}
                  </div>
                  
                  {place.alreadyExists && (
                    <div className="mt-2 text-xs text-gray-500">
                      ✓ Already in Tuggi database
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
} 