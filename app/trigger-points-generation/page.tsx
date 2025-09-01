'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useSupabaseClient } from '@supabase/auth-helpers-react';
import { Loader2, AlertCircle, CheckCircle2, RefreshCw, Play, Target, MapPin, Filter, Database, Globe } from 'lucide-react';
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
  approved?: boolean;
  trigger_points_count?: number;
  has_boundary?: boolean;
  last_processed?: string;
}

interface TriggerPointGenerationResult {
  poi_id: string;
  poi_name: string;
  success: boolean;
  message: string;
  trigger_points_generated?: number;
  trigger_points_saved?: number;
  trigger_points_skipped?: number;
  boundary_source?: string;
  processing_time?: number;
  errors?: string[];
}

export default function TriggerPointsGenerationPage() {
  const router = useRouter();
  const supabase = useSupabaseClient();
  
  const [isLoading, setIsLoading] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  
  // Form state
  const [country, setCountry] = useState('');
  const [city, setCity] = useState('');
  const [processingType, setProcessingType] = useState('without_trigger_points');
  const [limit, setLimit] = useState(50);
  const [delayBetweenCalls, setDelayBetweenCalls] = useState(3000); // 3 seconds for trigger point generation
  
  // Filter states
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
  const [generationResults, setGenerationResults] = useState<TriggerPointGenerationResult[]>([]);

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
      }
    } catch (error) {
      console.error('Error loading cities:', error);
    } finally {
      setIsLoadingCities(false);
    }
  };

  // Load POIs based on filters
  const loadPOIs = async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      const params = new URLSearchParams({
        limit: limit.toString(),
        processing_type: processingType,
        ...(country && { country }),
        ...(city && { city })
      });

      const response = await fetch(`/api/trigger-points/list-for-generation?${params}`);
      const result = await response.json();
      
      if (result.success) {
        setPois(result.pois || []);
        setSelectedPois([]);
        setGenerationResults([]);
        setSuccess(`Loaded ${result.pois?.length || 0} POIs for trigger point generation`);
      } else {
        setError(result.error || 'Failed to load POIs');
      }
    } catch (error) {
      console.error('Error loading POIs:', error);
      setError('Failed to load POIs');
    } finally {
      setIsLoading(false);
    }
  };

  // Generate trigger points for selected POIs
  const generateTriggerPoints = async () => {
    if (selectedPois.length === 0) {
      setError('Please select at least one POI to process');
      return;
    }

    setIsProcessing(true);
    setError(null);
    setSuccess(null);
    setProcessingQueue([...selectedPois]);
    setProcessedCount(0);
    setTotalCount(selectedPois.length);
    setGenerationResults([]);

    let successCount = 0;
    let errorCount = 0;

    for (let i = 0; i < selectedPois.length; i++) {
      const poiId = selectedPois[i];
      const poi = pois.find(p => p.id === poiId);
      
      if (!poi) continue;

      try {
        console.log(`🎯 Processing POI ${i + 1}/${selectedPois.length}: ${poi.name}`);
        
        const response = await fetch('/api/trigger-points/generate-batch', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            attraction_ids: [poiId],
            batch_size: 1
          })
        });

        const result = await response.json();
        
        const triggerPointsSaved = result.results?.[0]?.trigger_points_saved || 0;
        const triggerPointsSkipped = result.results?.[0]?.trigger_points_skipped || 0;
        const triggerPointsGenerated = result.results?.[0]?.trigger_points_generated || 0;
        
        // Create a more descriptive message
        let message = result.results?.[0]?.message || result.message || 'Unknown result';
        if (result.success && triggerPointsSaved === 0 && triggerPointsSkipped > 0) {
          message = `Processed successfully - ${triggerPointsSkipped} trigger points already exist (duplicates)`;
        } else if (result.success && triggerPointsSaved > 0) {
          message = `Successfully generated ${triggerPointsSaved} new trigger points`;
          if (triggerPointsSkipped > 0) {
            message += ` (${triggerPointsSkipped} duplicates skipped)`;
          }
        }

        const processingResult: TriggerPointGenerationResult = {
          poi_id: poiId,
          poi_name: poi.name,
          success: result.success, // Use overall success, not just result[0].success
          message: message,
          trigger_points_generated: triggerPointsGenerated,
          trigger_points_saved: triggerPointsSaved,
          trigger_points_skipped: triggerPointsSkipped,
          boundary_source: result.results?.[0]?.boundary_source,
          processing_time: result.results?.[0]?.processing_time,
          errors: result.results?.[0]?.errors || (result.success ? [] : [result.message])
        };

        setGenerationResults(prev => [...prev, processingResult]);

        if (processingResult.success) {
          successCount++;
        } else {
          errorCount++;
        }

      } catch (error) {
        console.error(`Error processing POI ${poi.name}:`, error);
        
        const errorResult: TriggerPointGenerationResult = {
          poi_id: poiId,
          poi_name: poi.name,
          success: false,
          message: 'Network or processing error',
          errors: [error instanceof Error ? error.message : 'Unknown error']
        };
        
        setGenerationResults(prev => [...prev, errorResult]);
        errorCount++;
      }

      setProcessedCount(i + 1);
      setProcessingQueue(prev => prev.slice(1));

      // Add delay between calls to avoid overwhelming the system
      if (i < selectedPois.length - 1) {
        await new Promise(resolve => setTimeout(resolve, delayBetweenCalls));
      }
    }

    setIsProcessing(false);
    
    if (errorCount === 0) {
      setSuccess(`✅ Successfully generated trigger points for all ${successCount} POIs!`);
    } else if (successCount > 0) {
      setSuccess(`⚠️ Completed with mixed results: ${successCount} successful, ${errorCount} failed`);
    } else {
      setError(`❌ All ${errorCount} POI processing attempts failed`);
    }

    // Reload POIs to show updated trigger point counts
    setTimeout(() => {
      loadPOIs();
    }, 2000);
  };

  // Handle POI selection
  const handleSelectPoi = (poiId: string) => {
    setSelectedPois(prev => 
      prev.includes(poiId) 
        ? prev.filter(id => id !== poiId)
        : [...prev, poiId]
    );
  };

  const handleSelectAll = () => {
    setSelectedPois(pois.map(poi => poi.id));
  };

  const handleDeselectAll = () => {
    setSelectedPois([]);
  };

  // Load countries on component mount
  useEffect(() => {
    loadCountries();
  }, [loadCountries]);

  // Load cities when country changes
  useEffect(() => {
    if (country) {
      loadCities(country);
      setCity(''); // Reset city when country changes
    }
  }, [country]);

  // Auto-load POIs when filters change
  useEffect(() => {
    if (country) {
      loadPOIs();
    }
  }, [country, city, processingType, limit]);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900 dark:text-white flex items-center">
                <Target className="h-8 w-8 mr-3 text-tuggi-orange" />
                Trigger Points Generation
              </h1>
              <p className="text-gray-600 dark:text-gray-400 mt-2">
                Generate trigger points for POIs using advanced boundary detection and street analysis
              </p>
            </div>
            <button
              onClick={() => router.push('/pois')}
              className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              Back to POIs
            </button>
          </div>
        </div>

        <div className="flex gap-6">
          {/* Left Column - 40% */}
          <div className="w-2/5">
            {/* Filters */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6 mb-6">
              <div className="flex items-center mb-4">
                <Filter className="h-5 w-5 mr-2 text-tuggi-blue" />
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Filters & Settings</h2>
              </div>
              
              <div className="space-y-4">
                {/* Country Filter */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Country
                  </label>
                  <select
                    value={country}
                    onChange={(e) => setCountry(e.target.value)}
                    disabled={isLoadingCountries}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-tuggi-blue focus:border-transparent"
                  >
                    <option value="">All Countries</option>
                    {availableCountries.map(({country: countryName, totalPOIs}) => (
                      <option key={countryName} value={countryName}>
                        {countryName} ({totalPOIs} POIs)
                      </option>
                    ))}
                  </select>
                </div>

                {/* City Filter */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    City
                  </label>
                  <select
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    disabled={isLoadingCities || !country}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-tuggi-blue focus:border-transparent"
                  >
                    <option value="">All Cities</option>
                    {availableCities.map(cityName => (
                      <option key={cityName} value={cityName}>
                        {cityName}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Processing Type */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Processing Type
                  </label>
                  <select
                    value={processingType}
                    onChange={(e) => setProcessingType(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-tuggi-blue focus:border-transparent"
                  >
                    <option value="without_trigger_points">POIs without trigger points</option>
                    <option value="with_few_trigger_points">POIs with few trigger points (&lt;3)</option>
                    <option value="all_approved">All approved POIs</option>
                    <option value="needs_update">Needs update (old processing)</option>
                  </select>
                </div>

                {/* Limit */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Limit
                  </label>
                  <select
                    value={limit}
                    onChange={(e) => setLimit(parseInt(e.target.value))}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-tuggi-blue focus:border-transparent"
                  >
                    <option value={25}>25 POIs</option>
                    <option value={50}>50 POIs</option>
                    <option value={100}>100 POIs</option>
                    <option value={200}>200 POIs</option>
                    <option value={500}>500 POIs</option>
                  </select>
                </div>

                {/* Processing Settings */}
                <div className="pt-4 border-t border-gray-200 dark:border-gray-700">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Delay Between Calls (ms)
                    </label>
                    <select
                      value={delayBetweenCalls}
                      onChange={(e) => setDelayBetweenCalls(parseInt(e.target.value))}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-tuggi-blue focus:border-transparent"
                    >
                      <option value={1000}>1 second (Fast)</option>
                      <option value={2000}>2 seconds</option>
                      <option value={3000}>3 seconds (Recommended)</option>
                      <option value={5000}>5 seconds (Safe)</option>
                      <option value={10000}>10 seconds (Very Safe)</option>
                    </select>
                  </div>
                  
                  <div className="mt-4">
                    <button
                      onClick={loadPOIs}
                      disabled={isLoading || !country}
                      className="w-full px-4 py-2 bg-tuggi-blue text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center"
                    >
                      {isLoading ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Loading...
                        </>
                      ) : (
                        <>
                          <RefreshCw className="h-4 w-4 mr-2" />
                          Reload POIs
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Processing Summary */}
            {generationResults.length > 0 && (
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
                <div className="p-4 border-b border-gray-200 dark:border-gray-700">
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                    Processing Summary
                  </h3>
                </div>
                <div className="p-4">
                  <div className="space-y-3">
                    <div className="bg-blue-50 dark:bg-blue-900/20 p-3 rounded-lg">
                      <div className="text-xl font-bold text-blue-600 dark:text-blue-400">
                        {generationResults.length}
                      </div>
                      <div className="text-sm text-blue-700 dark:text-blue-300">Total Processed</div>
                    </div>
                    <div className="bg-green-50 dark:bg-green-900/20 p-3 rounded-lg">
                      <div className="text-xl font-bold text-green-600 dark:text-green-400">
                        {generationResults.filter(r => r.success).length}
                      </div>
                      <div className="text-sm text-green-700 dark:text-green-300">Successful</div>
                    </div>
                    <div className="bg-red-50 dark:bg-red-900/20 p-3 rounded-lg">
                      <div className="text-xl font-bold text-red-600 dark:text-red-400">
                        {generationResults.filter(r => !r.success).length}
                      </div>
                      <div className="text-sm text-red-700 dark:text-red-300">Failed</div>
                    </div>
                    <div className="bg-tuggi-orange/10 p-3 rounded-lg">
                      <div className="text-xl font-bold text-tuggi-orange">
                        {generationResults.reduce((sum, r) => sum + (r.trigger_points_saved || 0), 0)}
                      </div>
                      <div className="text-sm text-orange-700 dark:text-orange-300">TPs Generated</div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Right Column - 60% */}
          <div className="w-3/5">
            {/* Results/Error Messages */}
            {error && (
              <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 mb-6">
                <div className="flex items-center">
                  <AlertCircle className="h-5 w-5 text-red-600 dark:text-red-400 mr-2" />
                  <p className="text-red-700 dark:text-red-300">{error}</p>
                </div>
              </div>
            )}

            {success && (
              <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4 mb-6">
                <div className="flex items-center">
                  <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400 mr-2" />
                  <p className="text-green-700 dark:text-green-300">{success}</p>
                </div>
              </div>
            )}

            {/* POI Selection */}
            {pois.length > 0 && (
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 mb-6">
                {/* Selection Header */}
                <div className="p-4 border-b border-gray-200 dark:border-gray-700">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center">
                        <Database className="h-5 w-5 mr-2 text-tuggi-orange" />
                        POI Selection ({pois.length} available)
                      </h3>
                      <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                        {selectedPois.length} selected for trigger point generation
                      </p>
                    </div>
                    
                    <div className="flex items-center space-x-2">
                      <button
                        onClick={handleSelectAll}
                        disabled={selectedPois.length === pois.length}
                        className="px-3 py-1.5 text-xs font-medium text-tuggi-blue border border-tuggi-blue rounded hover:bg-blue-50 dark:hover:bg-blue-900/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        Select All
                      </button>
                      <button
                        onClick={handleDeselectAll}
                        disabled={selectedPois.length === 0}
                        className="px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-400 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        Deselect All
                      </button>
                      <button
                        onClick={generateTriggerPoints}
                        disabled={selectedPois.length === 0 || isProcessing}
                        className="px-4 py-1.5 text-sm font-medium text-white bg-tuggi-orange rounded-lg hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center"
                      >
                        {isProcessing ? (
                          <>
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            Processing ({processedCount}/{totalCount})
                          </>
                        ) : (
                          <>
                            <Play className="h-4 w-4 mr-2" />
                            Generate Trigger Points
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </div>

                {/* POI List */}
                <div className="max-h-96 overflow-y-auto">
                  <div className="space-y-0">
                    {pois.map((poi) => {
                      const isSelected = selectedPois.includes(poi.id);
                      const isProcessing = processingQueue.includes(poi.id);
                      const result = generationResults.find(r => r.poi_id === poi.id);
                      
                      return (
                        <div
                          key={poi.id}
                          className={cn(
                            "p-4 border-b border-gray-100 dark:border-gray-700 last:border-b-0 transition-colors",
                            isSelected && "bg-blue-50 dark:bg-blue-900/10",
                            isProcessing && "bg-yellow-50 dark:bg-yellow-900/10"
                          )}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center">
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => handleSelectPoi(poi.id)}
                                disabled={isProcessing}
                                className="h-4 w-4 text-tuggi-blue rounded border-gray-300 focus:ring-tuggi-blue focus:ring-offset-0"
                              />
                              <div className="ml-3">
                                <div className="flex items-center">
                                  <h4 className="text-sm font-medium text-gray-900 dark:text-white">
                                    {poi.name}
                                  </h4>
                                  {isProcessing && (
                                    <Loader2 className="h-4 w-4 ml-2 text-yellow-600 animate-spin" />
                                  )}
                                  {result && (
                                    <div className="ml-2">
                                      {result.success ? (
                                        <CheckCircle2 className="h-4 w-4 text-green-600" />
                                      ) : (
                                        <AlertCircle className="h-4 w-4 text-red-600" />
                                      )}
                                    </div>
                                  )}
                                </div>
                                <div className="flex items-center text-xs text-gray-500 dark:text-gray-400 mt-1">
                                  <MapPin className="h-3 w-3 mr-1" />
                                  <span>{poi.city}, {poi.country}</span>
                                  {poi.trigger_points_count !== undefined && (
                                    <span className="ml-2 px-2 py-0.5 bg-gray-100 dark:bg-gray-700 rounded">
                                      {poi.trigger_points_count} TPs
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                            
                            <div className="text-right">
                              {result && (
                                <div className="text-xs">
                                  {result.success ? (
                                    <div className="text-green-600">
                                      <div>✅ {result.trigger_points_saved || 0} saved</div>
                                      {result.trigger_points_skipped && result.trigger_points_skipped > 0 && (
                                        <div className="text-yellow-600">⚠️ {result.trigger_points_skipped} skipped</div>
                                      )}
                                    </div>
                                  ) : (
                                    <div className="text-red-600">
                                      ❌ {result.message}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                          
                          {result && result.errors && result.errors.length > 0 && (
                            <div className="mt-2 text-xs text-red-600 bg-red-50 dark:bg-red-900/20 p-2 rounded">
                              {result.errors.join(', ')}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}