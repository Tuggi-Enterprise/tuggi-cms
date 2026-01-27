'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, AlertCircle, CheckCircle2, Play, Target, Filter, Database } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLocationData } from '@/lib/hooks/use-location-data';
import { usePOIProcessing } from '@/lib/hooks/use-poi-processing';
import { poiService, POI } from '@/lib/core/poi-service';

import { useTranslations } from 'next-intl';

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
  const t = useTranslations('Pages.TriggerPointsGeneration');
  const router = useRouter();
  
  // Use centralized hooks
  const locationData = useLocationData({ autoLoadCountries: true });
  const poiProcessing = usePOIProcessing();
  
  // Form state
  const [country, setCountry] = useState('');
  const [state, setState] = useState('');
  const [city, setCity] = useState('');
  const [processingType, setProcessingType] = useState('without_trigger_points');
  const [limit, setLimit] = useState(50);
  const [delayBetweenCalls, setDelayBetweenCalls] = useState(3000);
  
  // Data state
  const [pois, setPois] = useState<POI[]>([]);
  const [selectedPois, setSelectedPois] = useState<string[]>([]);
  const [generationResults, setGenerationResults] = useState<TriggerPointGenerationResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Auto-load countries and set default
  useEffect(() => {
    if (locationData.countries.length > 0 && !country) {
      setCountry(locationData.countries[0].name);
    }
  }, [locationData.countries, country]);

  // Track previous country to detect actual changes (not just initial load)
  const prevCountryRef = useRef<string>('');

  // Load states when country changes
  useEffect(() => {
    if (country) {
      // Only reset state and city if country actually changed (not on initial load)
      if (prevCountryRef.current && prevCountryRef.current !== country) {
        setState(''); // Reset state when country changes
        setCity(''); // Reset city when country changes
      }
      
      // Load states for the country
      locationData.loadStates(country);
      prevCountryRef.current = country;
    } else {
      // If country is cleared, also clear state and city
      setState('');
      setCity('');
      prevCountryRef.current = '';
    }
  }, [country]); // Only depend on country to prevent unnecessary re-runs

  // Load cities when country or state changes
  useEffect(() => {
    if (country) {
      // Load cities with current state filter
      locationData.loadCities(country, state || undefined);
    } else {
      setCity('');
    }
  }, [country, state]); // Removed locationData.loadCities from dependencies to prevent loops

  // Load POIs using centralized service
  const loadPOIs = async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      const result = await poiService.getForProcessing('trigger_points', {
        country,
        state,
        city,
        limit,
        processingType: processingType as any
      });
      
      if (result.success) {
        setPois(result.data || []);
        setSelectedPois([]);
        setGenerationResults([]);
        setSuccess(t('messages.loaded_pois', { count: result.data?.length || 0 }));
      } else {
        setError(result.error || t('messages.load_failed'));
      }
    } catch (error) {
      console.error('Error loading POIs:', error);
      setError(t('messages.load_failed'));
    } finally {
      setIsLoading(false);
    }
  };

  // Generate trigger points using centralized processing service
  const generateTriggerPoints = async () => {
    if (selectedPois.length === 0) {
      setError(t('messages.select_one'));
      return;
    }

    setError(null);
    setSuccess(null);
    setGenerationResults([]);

    try {
      const result = await poiProcessing.processTriggerPoints(selectedPois, {
        batchSize: 1,
        delayBetweenCalls,
        onProgress: (progress) => {
          console.log(`Progress: ${progress.percentage}% (${progress.processed}/${progress.total})`);
        },
        onComplete: (result) => {
          const successCount = result.successful;
          const errorCount = result.failed;
          setSuccess(t('messages.processing_completed', { success: successCount, failed: errorCount }));
          
          // Transform results to match expected format
          const transformedResults: TriggerPointGenerationResult[] = result.results.map(item => ({
            poi_id: item.poiId,
            poi_name: item.poiName,
            success: item.success,
            message: item.message,
            trigger_points_generated: item.data?.trigger_points_generated || 0,
            trigger_points_saved: item.data?.trigger_points_saved || 0,
            trigger_points_skipped: item.data?.trigger_points_skipped || 0,
            boundary_source: item.data?.boundary_source,
            processing_time: item.processingTime,
            errors: item.errors
          }));
          
          setGenerationResults(transformedResults);
        },
        onError: (error) => {
          setError(error);
        }
      });

      } catch (error) {
      console.error('Error in trigger points generation:', error);
      setError(error instanceof Error ? error.message : t('messages.unknown_error'));
    }
  };

  // Select all POIs
  const selectAllPOIs = () => {
    setSelectedPois(pois.map(poi => poi.id));
  };

  // Clear selection
  const clearSelection = () => {
    setSelectedPois([]);
  };

  // Toggle POI selection
  const togglePOISelection = (poiId: string) => {
    setSelectedPois(prev => 
      prev.includes(poiId) 
        ? prev.filter(id => id !== poiId)
        : [...prev, poiId]
    );
  };

  // Clear messages
  const clearMessages = () => {
    setError(null);
    setSuccess(null);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center justify-between">
          <div>
              <h1 className="text-3xl font-bold text-gray-900">{t('title')}</h1>
              <p className="mt-2 text-gray-600">
                {t('subtitle')}
            </p>
          </div>
            <button
              onClick={() => router.back()}
              className="px-4 py-2 text-gray-600 hover:text-gray-900 transition-colors"
            >
              ← {t('back')}
            </button>
          </div>
        </div>

        {/* Messages */}
        {(error || success) && (
          <div className="mb-6">
            {error && (
              <div className="bg-red-50 border border-red-200 rounded-md p-4">
                <div className="flex">
                  <AlertCircle className="h-5 w-5 text-red-400" />
                  <div className="ml-3">
                    <h3 className="text-sm font-medium text-red-800">{t('messages.error')}</h3>
                    <div className="mt-2 text-sm text-red-700">{error}</div>
                  </div>
                  <button
                    onClick={clearMessages}
                    className="ml-auto text-red-400 hover:text-red-600"
                  >
                    ×
                  </button>
                </div>
              </div>
            )}
            {success && (
              <div className="bg-green-50 border border-green-200 rounded-md p-4">
                <div className="flex">
                  <CheckCircle2 className="h-5 w-5 text-green-400" />
                  <div className="ml-3">
                    <h3 className="text-sm font-medium text-green-800">{t('messages.success')}</h3>
                    <div className="mt-2 text-sm text-green-700">{success}</div>
                  </div>
                  <button
                    onClick={clearMessages}
                    className="ml-auto text-green-400 hover:text-green-600"
                  >
                    ×
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Filters */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
            <Filter className="h-5 w-5 mr-2" />
            {t('filters.title')}
          </h2>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {/* Country */}
                <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t('filters.country')}
                  </label>
                  <select
                    value={country}
                    onChange={(e) => setCountry(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                disabled={locationData.countriesLoading}
              >
                <option value="">{t('filters.select_country')}</option>
                {locationData.countries.map((country) => (
                  <option key={country.name} value={country.name}>
                    {country.name} ({country.totalPOIs} POIs)
                      </option>
                    ))}
                  </select>
              {locationData.countriesLoading && (
                <div className="flex items-center mt-1 text-sm text-gray-500">
                  <Loader2 className="h-4 w-4 animate-spin mr-1" />
                  {t('filters.loading_countries')}
                </div>
              )}
                </div>

            {/* State */}
                <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t('filters.state')}
                  </label>
                  <select
                    value={state}
                    onChange={(e) => setState(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                disabled={!country || locationData.statesLoading}
              >
                <option value="">{t('filters.all_states')}</option>
                {locationData.states.map((state) => (
                  <option key={state.value} value={state.value}>
                    {state.label}
                      </option>
                    ))}
                  </select>
              {locationData.statesLoading && (
                <div className="flex items-center mt-1 text-sm text-gray-500">
                  <Loader2 className="h-4 w-4 animate-spin mr-1" />
                  {t('filters.loading_states')}
                </div>
              )}
                </div>

            {/* City */}
                <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t('filters.city')}
                  </label>
                  <select
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                disabled={!country || locationData.citiesLoading}
              >
                <option value="">{t('filters.all_cities')}</option>
                {locationData.cities.map((city) => (
                  <option key={city.name} value={city.name}>
                    {city.name}
                      </option>
                    ))}
                  </select>
              {locationData.citiesLoading && (
                <div className="flex items-center mt-1 text-sm text-gray-500">
                  <Loader2 className="h-4 w-4 animate-spin mr-1" />
                  {t('filters.loading_cities')}
                </div>
              )}
                </div>

                {/* Processing Type */}
                <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t('filters.processing_type')}
                  </label>
                  <select
                    value={processingType}
                    onChange={(e) => setProcessingType(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="without_trigger_points">{t('filters.types.without_trigger_points')}</option>
                <option value="with_trigger_points">{t('filters.types.with_trigger_points')}</option>
                <option value="all">{t('filters.types.all')}</option>
                  </select>
                </div>

                {/* Limit */}
                <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t('filters.limit')}
                  </label>
              <input
                type="number"
                    value={limit}
                onChange={(e) => setLimit(parseInt(e.target.value) || 50)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                min="1"
                max="1000"
              />
                </div>

            {/* Delay */}
                  <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                      {t('filters.delay')}
                    </label>
              <input
                type="number"
                      value={delayBetweenCalls}
                onChange={(e) => setDelayBetweenCalls(parseInt(e.target.value) || 3000)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                min="1000"
                max="10000"
                autoComplete="off"
                data-form-type="other"
              />
            </div>
                  </div>
                  
          <div className="mt-4 flex gap-3">
                    <button
                      onClick={loadPOIs}
                      disabled={isLoading || !country}
              className={cn(
                "px-4 py-2 rounded-md font-medium transition-colors",
                isLoading || !country
                  ? "bg-gray-300 text-gray-500 cursor-not-allowed"
                  : "bg-blue-600 text-white hover:bg-blue-700"
              )}
                    >
                      {isLoading ? (
                        <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2 inline" />
                  {t('actions.loading_pois')}
                        </>
                      ) : (
                        <>
                  <Database className="h-4 w-4 mr-2 inline" />
                  {t('actions.load_pois')}
                        </>
                      )}
                    </button>
                  </div>
        </div>

        {/* POIs List */}
        {pois.length > 0 && (
          <div className="bg-white rounded-lg shadow mb-6">
            <div className="px-6 py-4 border-b border-gray-200">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-gray-900">
                  {t('list.title', { count: pois.length })}
                </h2>
                <div className="flex gap-2">
                  <button
                    onClick={selectAllPOIs}
                    className="px-3 py-1 text-sm bg-blue-100 text-blue-700 rounded-md hover:bg-blue-200 transition-colors"
                  >
                    {t('actions.select_all')}
                  </button>
                  <button
                    onClick={clearSelection}
                    className="px-3 py-1 text-sm bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 transition-colors"
                  >
                    {t('actions.clear_selection')}
                  </button>
                </div>
              </div>
            </div>

            <div className="divide-y divide-gray-200">
              {pois.map((poi) => (
                <div
                  key={poi.id}
                  className={cn(
                    "px-6 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors",
                    selectedPois.includes(poi.id) && "bg-blue-50"
                  )}
                >
                  <div className="flex items-center">
                    <input
                      type="checkbox"
                      checked={selectedPois.includes(poi.id)}
                      onChange={() => togglePOISelection(poi.id)}
                      className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                    />
                    <div className="ml-3">
                      <h3 className="text-sm font-medium text-gray-900">{poi.name}</h3>
                      <p className="text-sm text-gray-500">
                        {poi.city}, {poi.state && `${poi.state}, `}{poi.country}
                      </p>
                      <div className="flex items-center gap-4 mt-1 text-xs text-gray-400">
                        <span>{t('list.trigger_points', { count: poi.trigger_points_count || 0 })}</span>
                        <span>{t('list.boundary', { status: poi.has_boundary ? t('list.yes') : t('list.no') })}</span>
                        {poi.last_processed && (
                          <span>{t('list.last_processed', { date: new Date(poi.last_processed).toLocaleDateString() })}</span>
                        )}
                      </div>
                  </div>
                </div>
              </div>
              ))}
                </div>
              </div>
            )}

        {/* Processing Controls */}
        {selectedPois.length > 0 && (
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
              <Target className="h-5 w-5 mr-2" />
              {t('processing.title', { count: selectedPois.length })}
            </h2>
            
            <div className="flex gap-3">
                      <button
                        onClick={generateTriggerPoints}
                disabled={poiProcessing.isProcessing}
                className={cn(
                  "px-6 py-3 rounded-md font-medium transition-colors flex items-center",
                  poiProcessing.isProcessing
                    ? "bg-gray-300 text-gray-500 cursor-not-allowed"
                    : "bg-green-600 text-white hover:bg-green-700"
                )}
              >
                {poiProcessing.isProcessing ? (
                  <>
                    <Loader2 className="h-5 w-5 animate-spin mr-2" />
                    {t('actions.processing')}
                          </>
                        ) : (
                          <>
                    <Play className="h-5 w-5 mr-2" />
                            {t('actions.generate')}
                          </>
                        )}
                      </button>

              {poiProcessing.isProcessing && (
                <button
                  onClick={poiProcessing.cancelProcessing}
                  className="px-6 py-3 rounded-md font-medium bg-red-600 text-white hover:bg-red-700 transition-colors"
                >
                  {t('actions.cancel')}
                </button>
              )}
                    </div>

            {/* Progress */}
            {poiProcessing.progress && (
              <div className="mt-4">
                <div className="flex items-center justify-between text-sm text-gray-600 mb-2">
                  <span>{t('processing.progress', { processed: poiProcessing.progress.processed, total: poiProcessing.progress.total })}</span>
                  <span>{poiProcessing.progress.percentage}%</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div
                    className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                    style={{ width: `${poiProcessing.progress.percentage}%` }}
                  />
                </div>
                {poiProcessing.progress.estimatedTimeRemaining && (
                  <p className="text-xs text-gray-500 mt-1">
                    {t('processing.estimated_time', { seconds: Math.round(poiProcessing.progress.estimatedTimeRemaining / 1000) })}
                  </p>
                                      )}
                                    </div>
                                  )}
                                </div>
        )}

        {/* Results */}
        {generationResults.length > 0 && (
          <div className="bg-white rounded-lg shadow mt-6">
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900">{t('results.title')}</h2>
                                </div>
            <div className="divide-y divide-gray-200">
              {generationResults.map((result, index) => (
                <div key={index} className="px-6 py-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-medium text-gray-900">{result.poi_name}</h3>
                      <p className="text-sm text-gray-500">{result.message}</p>
                      {result.boundary_source && (
                        <p className="text-xs text-gray-400">{t('results.boundary', { source: result.boundary_source })}</p>
                                      )}
                                    </div>
                    <div className="flex items-center gap-2">
                      {result.success ? (
                        <CheckCircle2 className="h-5 w-5 text-green-500" />
                      ) : (
                        <AlertCircle className="h-5 w-5 text-red-500" />
                      )}
                      <span className="text-sm text-gray-500">
                        {t('results.saved', { count: result.trigger_points_saved || 0 })}
                      </span>
                        </div>
                  </div>
                </div>
              ))}
                </div>
              </div>
            )}
        </div>
    </div>
  );
}


