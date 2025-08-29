'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useSupabaseClient } from '@supabase/auth-helpers-react';
import { Loader2, AlertCircle, CheckCircle2, RefreshCw, Play, Database, Globe, MapPin } from 'lucide-react';
import { cn } from '@/lib/utils';

interface POI {
  id: string;
  name: string;
  city: string;
  country: string;
  google_place_id?: string;
  osm_category?: string;
  osm_data_quality_score?: number;
  heritage_status?: string;
  unesco_status?: string;
  pov_quality_score?: number;
  verification_status?: string;
}

interface EnrichmentResult {
  poi_id: string;
  success: boolean;
  message: string;
  data_quality_score?: number;
  fields_updated?: string[];
  errors?: string[];
}

export default function EnrichOSMPage() {
  const router = useRouter();
  const supabase = useSupabaseClient();
  
  const [isLoading, setIsLoading] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  
  // Form state
  const [country, setCountry] = useState('');
  const [city, setCity] = useState('');
  const [enrichmentType, setEnrichmentType] = useState('unprocessed_only');
  const [limit, setLimit] = useState(100);
  const [delayBetweenCalls, setDelayBetweenCalls] = useState(2000); // 2 seconds
  
  // New states for dynamic filters
  const [availableCountries, setAvailableCountries] = useState<Array<{country: string, cityCount: number, totalPOIs: number}>>([]);
  const [availableCities, setAvailableCities] = useState<string[]>([]);
  const [isLoadingCountries, setIsLoadingCountries] = useState(false);
  const [isLoadingCities, setIsLoadingCities] = useState(false);
  
  // Data state
  const [pois, setPois] = useState<POI[]>([]);
  const [selectedPois, setSelectedPois] = useState<string[]>([]);
  const [processingQueue, setProcessingQueue] = useState<string[]>([]);
  const [processedCount, setProcessedCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [enrichmentResults, setEnrichmentResults] = useState<EnrichmentResult[]>([]);

  // Load available countries from database
  const loadCountries = useCallback(async () => {
    setIsLoadingCountries(true);
    try {
      const response = await fetch('/api/locations/countries-cities');
      const result = await response.json();
      
      if (result.success) {
        setAvailableCountries(result.countries);
        // Set first country as default if none selected
        if (!country && result.countries.length > 0) {
          setCountry(result.countries[0].country);
        }
      } else {
        console.error('Failed to load countries:', result.error);
      }
    } catch (error) {
      console.error('Error loading countries:', error);
    } finally {
      setIsLoadingCountries(false);
    }
  }, [country]);

  // Load available cities for selected country
  const loadCities = async (selectedCountry: string) => {
    if (!selectedCountry) {
      setAvailableCities([]);
      return;
    }

    setIsLoadingCities(true);
    try {
      const response = await fetch(`/api/locations/countries-cities?country=${encodeURIComponent(selectedCountry)}`);
      const result = await response.json();
      
      if (result.success) {
        setAvailableCities(result.cities);
      } else {
        console.error('Failed to load cities:', result.error);
        setAvailableCities([]);
      }
    } catch (error) {
      console.error('Error loading cities:', error);
      setAvailableCities([]);
    } finally {
      setIsLoadingCities(false);
    }
  };

  // Fetch POIs based on criteria with pagination support
  const fetchPois = async () => {
    if (!country) {
      setError('Please select a country');
      return;
    }

    setIsLoading(true);
    setError(null);
    
    try {
      // Fetch data with pagination to handle >1000 records
      let allPois: POI[] = [];
      let hasMore = true;
      let page = 0;
      const pageSize = 1000;
      let totalFetched = 0;

      while (hasMore && totalFetched < limit) {
        let query = supabase
          .schema('core')
          .from('attractions')
          .select(`
            id,
            name,
            city,
            country,
            google_place_id,
            osm_category,
            osm_data_quality_score,
            heritage_status,
            unesco_status,
            pov_quality_score,
            verification_status
          `)
          .eq('country', country)
          .eq('approved', true)
          .range(page * pageSize, Math.min((page + 1) * pageSize - 1, limit - 1));

        if (city) {
          query = query.eq('city', city);
        }

        // Filter by enrichment type - EXCLUDE already processed POIs
        if (enrichmentType === 'no_osm_data') {
          query = query.is('osm_category', null);
        } else if (enrichmentType === 'low_quality') {
          query = query.lt('osm_data_quality_score', 70)
                     .not('osm_category', 'is', null)
                     .neq('osm_category', 'not_found');
        } else if (enrichmentType === 'no_heritage') {
          query = query.is('heritage_status', null)
                     .not('osm_category', 'is', null)
                     .neq('osm_category', 'not_found');
        } else if (enrichmentType === 'no_pov_scores') {
          query = query.is('pov_quality_score', null)
                     .not('osm_category', 'is', null)
                     .neq('osm_category', 'not_found');
        } else if (enrichmentType === 'all') {
          query = query.neq('osm_category', 'not_found');
        } else if (enrichmentType === 'unprocessed_only') {
          query = query.is('osm_category', null);
        } else if (enrichmentType === 'not_found') {
          query = query.eq('osm_category', 'not_found');
        }

        const { data, error } = await query;
        if (error) throw error;

        if (data && data.length > 0) {
          allPois = [...allPois, ...data];
          totalFetched += data.length;
          page++;
          
          // If we got less than pageSize, we've reached the end
          if (data.length < pageSize) {
            hasMore = false;
          }
        } else {
          hasMore = false;
        }

        // Safety check to prevent infinite loops
        if (page > 20) {
          hasMore = false;
        }
      }

      // Limit to requested amount
      const limitedPois = allPois.slice(0, limit);
      
      setPois(limitedPois);
      setTotalCount(limitedPois.length);
      
      if (allPois.length >= limit) {
        console.log(`📊 Found ${allPois.length} POIs, showing first ${limit}`);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await fetchPois();
  };

  // Handle country change
  const handleCountryChange = (newCountry: string) => {
    setCountry(newCountry);
    setCity(''); // Reset city when country changes
    loadCities(newCountry);
  };

  // Load countries on component mount
  useEffect(() => {
    loadCountries();
  }, [loadCountries]);

  // Load cities when country changes
  useEffect(() => {
    if (country) {
      loadCities(country);
    }
  }, [country]);

  // Process selected POIs with OSM enrichment
  const processSelectedPois = async () => {
    if (selectedPois.length === 0) {
      setError('Please select at least one POI to enrich');
      return;
    }

    setIsProcessing(true);
    setError(null);
    setSuccess(null);
    setProcessedCount(0);
    setProcessingQueue([...selectedPois]);
    setEnrichmentResults([]);

    for (const poiId of selectedPois) {
      try {
        const poi = pois.find(p => p.id === poiId);
        if (!poi) continue;

        console.log(`🔄 Enriching POI: ${poi.name} (${poi.city}, ${poi.country})`);

        // Call OSM enrichment API
        const response = await fetch('/api/pois/enrich-osm', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            poi_id: poi.id,
            name: poi.name,
            city: poi.city,
            country: poi.country,
            google_place_id: poi.google_place_id
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error(`Failed to enrich POI ${poi.name}:`, errorText);
          
          setEnrichmentResults(prev => [...prev, {
            poi_id: poi.id,
            success: false,
            message: `API Error: ${response.status}`,
            errors: [errorText]
          }]);
          
          setProcessedCount(prev => prev + 1);
          setProcessingQueue(prev => prev.filter(id => id !== poiId));
          continue;
        }

        const result = await response.json();
        
        setEnrichmentResults(prev => [...prev, {
          poi_id: poi.id,
          success: result.success,
          message: result.message,
          data_quality_score: result.data_quality_score,
          fields_updated: result.fields_updated
        }]);

        setProcessedCount(prev => prev + 1);
        setProcessingQueue(prev => prev.filter(id => id !== poiId));
        
        // Add delay between calls to avoid rate limiting
        if (delayBetweenCalls > 0) {
          await new Promise(resolve => setTimeout(resolve, delayBetweenCalls));
        }
        
      } catch (err) {
        console.error(`Error enriching POI ${poiId}:`, err);
        
        setEnrichmentResults(prev => [...prev, {
          poi_id: poiId,
          success: false,
          message: 'Network Error',
          errors: [err instanceof Error ? err.message : 'Unknown error']
        }]);
        
        setProcessedCount(prev => prev + 1);
        setProcessingQueue(prev => prev.filter(id => id !== poiId));
      }
    }

    setIsProcessing(false);
    const successCount = enrichmentResults.filter(r => r.success).length;
    setSuccess(`Successfully enriched ${successCount} out of ${processedCount} POIs`);
    setSelectedPois([]);
  };

  // Toggle POI selection
  const togglePoiSelection = (poiId: string) => {
    setSelectedPois(prev => 
      prev.includes(poiId) 
        ? prev.filter(id => id !== poiId)
        : [...prev, poiId]
    );
  };

  // Select all POIs
  const selectAllPois = () => {
    setSelectedPois(pois.map(poi => poi.id));
  };

  // Clear selection
  const clearSelection = () => {
    setSelectedPois([]);
  };

  // Get enrichment status for a POI
  const getEnrichmentStatus = (poi: POI) => {
    if (poi.osm_category === 'not_found') {
      return { 
        status: 'not_found', 
        label: 'Not Found', 
        color: 'bg-gray-100 text-gray-800',
        description: 'Não encontrada no OSM'
      };
    }
    
    if (!poi.osm_category) {
      return { 
        status: 'no_data', 
        label: 'No OSM Data', 
        color: 'bg-red-100 text-red-800',
        description: 'Nunca processado'
      };
    }
    
    if ((poi.osm_data_quality_score || 0) < 70) {
      return { 
        status: 'low_quality', 
        label: 'Low Quality', 
        color: 'bg-yellow-100 text-yellow-800',
        description: 'Processado mas qualidade baixa'
      };
    }
    
    if (!poi.heritage_status) {
      return { 
        status: 'partial', 
        label: 'Partial Data', 
        color: 'bg-blue-100 text-blue-800',
        description: 'Processado mas sem heritage'
      };
    }
    
    return { 
      status: 'complete', 
      label: 'Complete', 
      color: 'bg-green-100 text-green-800',
      description: 'Completamente processado'
    };
  };

  return (
    <div className="container mx-auto py-6">
      <h1 className="text-3xl font-bold mb-6">Enrich POIs with OSM Data</h1>
      
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Parameters Card */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold mb-4">Search Parameters</h2>
          <p className="text-gray-600 mb-4">
            Configure parameters to find POIs that need OSM data enrichment
          </p>
          
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="country" className="block text-sm font-medium text-gray-700">
                Country
              </label>
              <select
                id="country"
                value={country}
                onChange={(e) => handleCountryChange(e.target.value)}
                disabled={isLoading || isLoadingCountries}
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-tuggi-blue focus:border-tuggi-blue disabled:opacity-50"
              >
                <option value="">
                  {isLoadingCountries ? 'Loading countries...' : 'Select a country'}
                </option>
                {availableCountries.map((countryData) => (
                  <option key={countryData.country} value={countryData.country}>
                    {countryData.country} ({countryData.totalPOIs} POIs, {countryData.cityCount} cities)
                  </option>
                ))}
              </select>
              {availableCountries.length > 0 && (
                <div className="text-xs text-gray-500">
                  📊 {availableCountries.length} countries available with {availableCountries.reduce((sum, c) => sum + c.totalPOIs, 0)} total POIs
                </div>
              )}
            </div>
            
            <div className="space-y-2">
              <label htmlFor="city" className="block text-sm font-medium text-gray-700">
                City (Optional)
              </label>
              <select
                id="city"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                disabled={isLoading || isLoadingCities || !country}
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-tuggi-blue focus:border-tuggi-blue disabled:opacity-50"
              >
                <option value="">
                  {!country ? 'Select a country first' : 
                   isLoadingCities ? 'Loading cities...' : 
                   'All cities'}
                </option>
                {availableCities.map((cityName) => (
                  <option key={cityName} value={cityName}>
                    {cityName}
                  </option>
                ))}
              </select>
              {country && availableCities.length > 0 && (
                <div className="text-xs text-gray-500">
                  🏙️ {availableCities.length} cities available in {country}
                </div>
              )}
            </div>
            
            <div className="space-y-2">
              <label htmlFor="enrichmentType" className="block text-sm font-medium text-gray-700">
                Enrichment Type
              </label>
              <select
                id="enrichmentType"
                value={enrichmentType}
                onChange={(e) => setEnrichmentType(e.target.value)}
                disabled={isLoading}
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-tuggi-blue focus:border-tuggi-blue"
              >
                <option value="unprocessed_only">Unprocessed POIs Only</option>
                <option value="no_osm_data">No OSM Data</option>
                <option value="low_quality">Low Quality OSM Data (&lt;70%)</option>
                <option value="no_heritage">No Heritage Status</option>
                <option value="no_pov_scores">No POV Quality Scores</option>
                <option value="not_found">Not Found in OSM</option>
                <option value="all">All POIs (Including Processed)</option>
              </select>
              
              {/* Descrição do filtro selecionado */}
              <div className="text-xs text-gray-500 mt-1">
                {enrichmentType === 'unprocessed_only' && (
                  <span>🔍 Busca apenas POIs que nunca foram processados (sem dados OSM)</span>
                )}
                {enrichmentType === 'no_osm_data' && (
                  <span>🔍 Busca POIs sem dados OSM (mesmo que já tenham sido processados)</span>
                )}
                {enrichmentType === 'low_quality' && (
                  <span>🔍 Busca POIs já processados mas com qualidade OSM &lt; 70%</span>
                )}
                {enrichmentType === 'no_heritage' && (
                  <span>🔍 Busca POIs já processados mas sem status patrimonial</span>
                )}
                {enrichmentType === 'no_pov_scores' && (
                  <span>🔍 Busca POIs já processados mas sem scores de POV</span>
                )}
                {enrichmentType === 'not_found' && (
                  <span>🔍 Busca POIs marcadas como não encontradas no OSM</span>
                )}
                {enrichmentType === 'all' && (
                  <span>🔍 Busca todos os POIs (incluindo já processados)</span>
                )}
              </div>
            </div>
            
            <div className="space-y-2">
              <label htmlFor="limit" className="block text-sm font-medium text-gray-700">
                Limit (max items)
              </label>
              <input
                id="limit"
                type="number"
                min={1}
                max={10000}
                value={limit}
                onChange={(e) => setLimit(Number(e.target.value))}
                disabled={isLoading}
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-tuggi-blue focus:border-tuggi-blue"
              />
              <div className="text-xs text-gray-500">
                ⚡ System automatically handles pagination for large datasets (&gt;1000 records)
              </div>
            </div>

            <div className="space-y-2">
              <label htmlFor="delay" className="block text-sm font-medium text-gray-700">
                Delay Between Calls (ms)
              </label>
              <input
                id="delay"
                type="number"
                min={0}
                max={10000}
                step={500}
                value={delayBetweenCalls}
                onChange={(e) => setDelayBetweenCalls(Number(e.target.value))}
                disabled={isLoading}
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-tuggi-blue focus:border-tuggi-blue"
              />
              <p className="text-xs text-gray-500">
                Recommended: 2000ms to avoid API rate limits
              </p>
            </div>
            
            <button
              type="submit"
              disabled={isLoading || !country}
              className="w-full bg-tuggi-blue text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? (
                <>
                  <Loader2 className="inline-block mr-2 h-4 w-4 animate-spin" />
                  Searching...
                </>
              ) : !country ? (
                <>
                  <Database className="inline-block mr-2 h-4 w-4" />
                  Select Country First
                </>
              ) : (
                <>
                  <Database className="inline-block mr-2 h-4 w-4" />
                  Search POIs
                </>
              )}
            </button>
          </form>
        </div>
        
        {/* POIs List */}
        <div className="lg:col-span-2 bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold">
              POIs Found ({pois.length})
            </h2>
            {pois.length > 0 && (
              <div className="flex items-center gap-2">
                <button
                  onClick={selectAllPois}
                  className="px-3 py-1 text-sm bg-blue-100 text-blue-800 rounded hover:bg-blue-200"
                >
                  Select All
                </button>
                <button
                  onClick={clearSelection}
                  className="px-3 py-1 text-sm bg-gray-100 text-gray-800 rounded hover:bg-gray-200"
                >
                  Clear
                </button>
                {selectedPois.length > 0 && (
                  <button
                    onClick={processSelectedPois}
                    disabled={isProcessing}
                    className="px-4 py-1 text-sm bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
                  >
                    {isProcessing ? (
                      <>
                        <Loader2 className="inline-block mr-1 h-3 w-3 animate-spin" />
                        Enriching...
                      </>
                    ) : (
                      `Enrich ${selectedPois.length} Selected`
                    )}
                  </button>
                )}
              </div>
            )}
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
              <div className="flex items-center">
                <AlertCircle className="h-4 w-4 mr-2" />
                <span className="font-medium">Error</span>
              </div>
              <p className="text-sm mt-1">{error}</p>
            </div>
          )}

          {success && (
            <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded mb-4">
              <div className="flex items-center">
                <CheckCircle2 className="h-4 w-4 mr-2" />
                <span className="font-medium">Success</span>
              </div>
              <p className="text-sm mt-1">{success}</p>
            </div>
          )}

          {isProcessing && (
            <div className="bg-blue-50 border border-blue-200 text-blue-700 px-4 py-3 rounded mb-4">
              <div className="flex items-center">
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                <span className="font-medium">Enriching POIs</span>
              </div>
              <p className="text-sm mt-1">
                Processed {processedCount} of {totalCount} POIs
                {processingQueue.length > 0 && ` (${processingQueue.length} remaining)`}
              </p>
              <div className="w-full bg-blue-200 rounded-full h-2 mt-2">
                <div 
                  className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${(processedCount / totalCount) * 100}%` }}
                ></div>
              </div>
            </div>
          )}
          
          {pois.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-center text-gray-500">
              <Database className="h-8 w-8 mb-2" />
              <p>No POIs found matching the criteria</p>
              <p className="text-sm">Try adjusting your search parameters</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {pois.map((poi) => {
                const enrichmentStatus = getEnrichmentStatus(poi);
                const isSelected = selectedPois.includes(poi.id);
                const isProcessing = processingQueue.includes(poi.id);
                const result = enrichmentResults.find(r => r.poi_id === poi.id);
                
                const isNotAllowed = enrichmentStatus.status === 'not_found';
                
                return (
                  <div
                    key={poi.id}
                    className={cn(
                      "flex items-center gap-3 p-3 border rounded-lg transition-colors",
                      isSelected 
                        ? "border-tuggi-blue bg-blue-50" 
                        : "border-gray-200 hover:border-gray-300",
                      isProcessing && "opacity-50",
                      isNotAllowed && "opacity-60 cursor-not-allowed"
                    )}
                    onClick={() => !isProcessing && !isNotAllowed && togglePoiSelection(poi.id)}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => !isProcessing && !isNotAllowed && togglePoiSelection(poi.id)}
                      disabled={isProcessing || isNotAllowed}
                      className="rounded border-gray-300 text-tuggi-blue focus:ring-tuggi-blue"
                    />
                    
                    <div className="flex-1 min-w-0">
                      <h3 className="font-medium text-gray-900 truncate">{poi.name}</h3>
                      <p className="text-sm text-gray-500 flex items-center gap-1">
                        <MapPin className="h-3 w-3" />
                        {poi.city}, {poi.country}
                      </p>
                      
                      <div className="flex items-center gap-2 mt-1">
                        {poi.osm_category && (
                          <span className="text-xs bg-gray-100 text-gray-700 px-2 py-1 rounded">
                            OSM: {poi.osm_category}
                          </span>
                        )}
                        {poi.osm_data_quality_score && (
                          <span className="text-xs bg-gray-100 text-gray-700 px-2 py-1 rounded">
                            Quality: {poi.osm_data_quality_score}%
                          </span>
                        )}
                        {poi.heritage_status && (
                          <span className="text-xs bg-purple-100 text-purple-700 px-2 py-1 rounded">
                            {poi.heritage_status}
                          </span>
                        )}
                      </div>
                      
                      {result && (
                        <div className="mt-2">
                          {result.success ? (
                            <p className="text-xs text-green-600">
                              ✅ {result.message}
                              {result.data_quality_score && ` (Quality: ${result.data_quality_score}%)`}
                            </p>
                          ) : (
                            <p className="text-xs text-red-600">
                              ❌ {result.message}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                    
                                         <div className="flex items-center gap-2">
                       {isProcessing && (
                         <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
                       )}
                       <div className="text-right">
                         <span className={cn(
                           "px-2 py-1 text-xs rounded-full",
                           enrichmentStatus.color
                         )}>
                           {enrichmentStatus.label}
                         </span>
                         <div className="text-xs text-gray-500 mt-1">
                           {enrichmentStatus.description}
                         </div>
                       </div>
                     </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
