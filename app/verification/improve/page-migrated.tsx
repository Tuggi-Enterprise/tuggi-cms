'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, AlertCircle, CheckCircle2, RefreshCw, Play, Volume2, Eye, Edit } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLocationData } from '@/lib/hooks/use-location-data';
import { usePOIProcessing } from '@/lib/hooks/use-poi-processing';
import { poiService, POI } from '@/lib/core/poi-service';

interface DescriptionResult {
  poi_id: string;
  poi_name: string;
  success: boolean;
  message: string;
  description_generated?: boolean;
  audio_generated?: boolean;
  processing_time?: number;
  errors?: string[];
}

export default function ImprovePage() {
  const router = useRouter();
  
  // Use centralized hooks
  const locationData = useLocationData({ autoLoadCountries: true });
  const poiProcessing = usePOIProcessing();
  
  // Form state
  const [language, setLanguage] = useState('pt-br');
  const [country, setCountry] = useState('Brazil');
  const [state, setState] = useState('');
  const [city, setCity] = useState('');
  const [status, setStatus] = useState('rejected');
  const [scoreRange, setScoreRange] = useState([0, 60]);
  const [limit, setLimit] = useState(50);
  const [autoGenerateAudio, setAutoGenerateAudio] = useState(true);
  const [includeApproved, setIncludeApproved] = useState(false);
  
  // Data state
  const [pois, setPois] = useState<POI[]>([]);
  const [selectedPois, setSelectedPois] = useState<string[]>([]);
  const [descriptionResults, setDescriptionResults] = useState<DescriptionResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Auto-load countries and set default
  useEffect(() => {
    if (locationData.countries.length > 0 && !country) {
      setCountry(locationData.countries[0].name);
    }
  }, [locationData.countries, country]);

  // Load states when country changes
  useEffect(() => {
    if (country) {
      locationData.loadStates(country);
      setState(''); // Reset state when country changes
      setCity(''); // Reset city when country changes
    }
  }, [country, locationData]);

  // Load cities when country or state changes
  useEffect(() => {
    if (country) {
      locationData.loadCities(country, state);
      if (state) {
        setCity(''); // Reset city when state changes
      }
    }
  }, [country, state, locationData]);

  // Load POIs using centralized service
  const loadPOIs = async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      const result = await poiService.getForProcessing('descriptions', {
        country,
        state,
        city,
        limit,
        language
      });
      
      if (result.success) {
        setPois(result.data || []);
        setSelectedPois([]);
        setDescriptionResults([]);
        setSuccess(`Loaded ${result.data?.length || 0} POIs for description improvement`);
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

  // Process descriptions using centralized processing service
  const processDescriptions = async () => {
    if (selectedPois.length === 0) {
      setError('Please select at least one POI to process');
      return;
    }

    setError(null);
    setSuccess(null);
    setDescriptionResults([]);

    try {
      const result = await poiProcessing.processDescriptions(selectedPois, {
        batchSize: 1,
        delayBetweenCalls: 2000,
        language,
        autoGenerateAudio,
        onProgress: (progress) => {
          console.log(`Progress: ${progress.percentage}% (${progress.processed}/${progress.total})`);
        },
        onComplete: (result) => {
          const successCount = result.successful;
          const errorCount = result.failed;
          setSuccess(`Processing completed! ${successCount} successful, ${errorCount} failed`);
          
          // Transform results to match expected format
          const transformedResults: DescriptionResult[] = result.results.map(item => ({
            poi_id: item.poiId,
            poi_name: item.poiName,
            success: item.success,
            message: item.message,
            description_generated: item.data?.descriptionGenerated,
            audio_generated: item.data?.audioGenerated,
            processing_time: item.processingTime,
            errors: item.errors
          }));
          
          setDescriptionResults(transformedResults);
        },
        onError: (error) => {
          setError(error);
        }
      });

    } catch (error) {
      console.error('Error in description processing:', error);
      setError(error instanceof Error ? error.message : 'Unknown error');
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
              <h1 className="text-3xl font-bold text-gray-900">Description Improvement</h1>
              <p className="mt-2 text-gray-600">
                Improve POI descriptions using AI-powered generation
              </p>
            </div>
            <button
              onClick={() => router.back()}
              className="px-4 py-2 text-gray-600 hover:text-gray-900 transition-colors"
            >
              ← Back
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
                    <h3 className="text-sm font-medium text-red-800">Error</h3>
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
                    <h3 className="text-sm font-medium text-green-800">Success</h3>
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
            <Edit className="h-5 w-5 mr-2" />
            Filters
          </h2>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {/* Language */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Language
              </label>
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="pt-br">Portuguese (Brazil)</option>
                <option value="en">English</option>
                <option value="es">Spanish</option>
              </select>
            </div>

            {/* Country */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Country
              </label>
              <select
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                disabled={locationData.countriesLoading}
              >
                <option value="">Select country...</option>
                {locationData.countries.map((country) => (
                  <option key={country.name} value={country.name}>
                    {country.name} ({country.totalPOIs} POIs)
                  </option>
                ))}
              </select>
              {locationData.countriesLoading && (
                <div className="flex items-center mt-1 text-sm text-gray-500">
                  <Loader2 className="h-4 w-4 animate-spin mr-1" />
                  Loading countries...
                </div>
              )}
            </div>

            {/* State */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                State
              </label>
              <select
                value={state}
                onChange={(e) => setState(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                disabled={!country || locationData.statesLoading}
              >
                <option value="">All states</option>
                {locationData.states.map((state) => (
                  <option key={state.value} value={state.value}>
                    {state.label}
                  </option>
                ))}
              </select>
              {locationData.statesLoading && (
                <div className="flex items-center mt-1 text-sm text-gray-500">
                  <Loader2 className="h-4 w-4 animate-spin mr-1" />
                  Loading states...
                </div>
              )}
            </div>

            {/* City */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                City
              </label>
              <select
                value={city}
                onChange={(e) => setCity(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                disabled={!country || locationData.citiesLoading}
              >
                <option value="">All cities</option>
                {locationData.cities.map((city) => (
                  <option key={city.name} value={city.name}>
                    {city.name}
                  </option>
                ))}
              </select>
              {locationData.citiesLoading && (
                <div className="flex items-center mt-1 text-sm text-gray-500">
                  <Loader2 className="h-4 w-4 animate-spin mr-1" />
                  Loading cities...
                </div>
              )}
            </div>

            {/* Status */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Status
              </label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="rejected">Rejected</option>
                <option value="pending">Pending</option>
                <option value="approved">Approved</option>
                <option value="all">All</option>
              </select>
            </div>

            {/* Limit */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Limit
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
          </div>

          {/* Options */}
          <div className="mt-4 flex gap-4">
            <label className="flex items-center">
              <input
                type="checkbox"
                checked={autoGenerateAudio}
                onChange={(e) => setAutoGenerateAudio(e.target.checked)}
                className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
              />
              <span className="ml-2 text-sm text-gray-700">Auto-generate audio</span>
            </label>
            <label className="flex items-center">
              <input
                type="checkbox"
                checked={includeApproved}
                onChange={(e) => setIncludeApproved(e.target.checked)}
                className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
              />
              <span className="ml-2 text-sm text-gray-700">Include approved descriptions</span>
            </label>
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
                  Loading POIs...
                </>
              ) : (
                <>
                  <Eye className="h-4 w-4 mr-2 inline" />
                  Load POIs
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
                  POIs ({pois.length})
                </h2>
                <div className="flex gap-2">
                  <button
                    onClick={selectAllPOIs}
                    className="px-3 py-1 text-sm bg-blue-100 text-blue-700 rounded-md hover:bg-blue-200 transition-colors"
                  >
                    Select All
                  </button>
                  <button
                    onClick={clearSelection}
                    className="px-3 py-1 text-sm bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 transition-colors"
                  >
                    Clear Selection
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
                        <span>Descriptions: {poi.description_count || 0}</span>
                        <span>Audio: {poi.audio_count || 0}</span>
                        <span>Languages: {poi.available_languages?.join(', ') || 'None'}</span>
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
              <Volume2 className="h-5 w-5 mr-2" />
              Processing ({selectedPois.length} selected)
            </h2>
            
            <div className="flex gap-3">
              <button
                onClick={processDescriptions}
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
                    Processing...
                  </>
                ) : (
                  <>
                    <Play className="h-5 w-5 mr-2" />
                    Process Descriptions
                  </>
                )}
              </button>

              {poiProcessing.isProcessing && (
                <button
                  onClick={poiProcessing.cancelProcessing}
                  className="px-6 py-3 rounded-md font-medium bg-red-600 text-white hover:bg-red-700 transition-colors"
                >
                  Cancel Processing
                </button>
              )}
            </div>

            {/* Progress */}
            {poiProcessing.progress && (
              <div className="mt-4">
                <div className="flex items-center justify-between text-sm text-gray-600 mb-2">
                  <span>Progress: {poiProcessing.progress.processed}/{poiProcessing.progress.total}</span>
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
                    Estimated time remaining: {Math.round(poiProcessing.progress.estimatedTimeRemaining / 1000)}s
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {/* Results */}
        {descriptionResults.length > 0 && (
          <div className="bg-white rounded-lg shadow mt-6">
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900">Results</h2>
            </div>
            <div className="divide-y divide-gray-200">
              {descriptionResults.map((result, index) => (
                <div key={index} className="px-6 py-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-medium text-gray-900">{result.poi_name}</h3>
                      <p className="text-sm text-gray-500">{result.message}</p>
                      <div className="flex items-center gap-4 mt-1 text-xs text-gray-400">
                        {result.description_generated && (
                          <span className="text-green-600">Description Generated</span>
                        )}
                        {result.audio_generated && (
                          <span className="text-blue-600">Audio Generated</span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {result.success ? (
                        <CheckCircle2 className="h-5 w-5 text-green-500" />
                      ) : (
                        <AlertCircle className="h-5 w-5 text-red-500" />
                      )}
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
