'use client';

import { useState, useEffect } from 'react';
import { Loader2, Database, CheckCircle2, AlertCircle, Play, Pause, BarChart3 } from 'lucide-react';
import { OSMDataEnrichment } from './OSMDataEnrichment';

interface POI {
  id: string;
  name: string;
  city: string;
  country: string;
  osm_category?: string;
  osm_data_quality_score?: number;
  heritage_status?: string;
}

interface EnrichmentResult {
  poi_id: string;
  success: boolean;
  message: string;
  data_quality_score?: number;
  fields_updated?: string[];
  errors?: string[];
}

interface BatchOSMEnrichmentProps {
  pois: POI[];
  onComplete?: (results: EnrichmentResult[]) => void;
  delayBetweenCalls?: number;
  maxConcurrent?: number;
  showIndividualResults?: boolean;
}

export function BatchOSMEnrichment({
  pois,
  onComplete,
  delayBetweenCalls = 2000,
  maxConcurrent = 1,
  showIndividualResults = true
}: BatchOSMEnrichmentProps) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [processedCount, setProcessedCount] = useState(0);
  const [successCount, setSuccessCount] = useState(0);
  const [failureCount, setFailureCount] = useState(0);
  const [results, setResults] = useState<EnrichmentResult[]>([]);
  const [processingQueue, setProcessingQueue] = useState<string[]>([]);

  const totalCount = pois.length;
  const progressPercentage = totalCount > 0 ? (processedCount / totalCount) * 100 : 0;

  const handleStart = async () => {
    setIsProcessing(true);
    setIsPaused(false);
    setCurrentIndex(0);
    setProcessedCount(0);
    setSuccessCount(0);
    setFailureCount(0);
    setResults([]);
    setProcessingQueue(pois.map(poi => poi.id));

    await processBatch();
  };

  const handlePause = () => {
    setIsPaused(true);
  };

  const handleResume = () => {
    setIsPaused(false);
    processBatch();
  };

  const handleStop = () => {
    setIsProcessing(false);
    setIsPaused(false);
    setProcessingQueue([]);
    
    if (onComplete) {
      onComplete(results);
    }
  };

  const processBatch = async () => {
    for (let i = currentIndex; i < pois.length; i++) {
      if (isPaused || !isProcessing) break;

      const poi = pois[i];
      setCurrentIndex(i);
      setProcessingQueue(prev => prev.filter(id => id !== poi.id));

      try {
        console.log(`🔄 Processing ${i + 1}/${totalCount}: ${poi.name}`);

        const response = await fetch('/api/pois/enrich-osm', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            poi_id: poi.id,
            name: poi.name,
            city: poi.city,
            country: poi.country
          }),
        });

        const result = await response.json();
        
        const enrichmentResult: EnrichmentResult = {
          poi_id: poi.id,
          success: result.success,
          message: result.message,
          data_quality_score: result.data_quality_score,
          fields_updated: result.fields_updated,
          errors: result.errors
        };

        setResults(prev => [...prev, enrichmentResult]);
        setProcessedCount(prev => prev + 1);
        
        if (result.success) {
          setSuccessCount(prev => prev + 1);
        } else {
          setFailureCount(prev => prev + 1);
        }

        // Add delay between requests to avoid rate limiting
        if (delayBetweenCalls > 0 && i < pois.length - 1) {
          await new Promise(resolve => setTimeout(resolve, delayBetweenCalls));
        }

      } catch (error) {
        console.error(`Error processing POI ${poi.name}:`, error);
        
        const errorResult: EnrichmentResult = {
          poi_id: poi.id,
          success: false,
          message: 'Network error',
          errors: [error instanceof Error ? error.message : 'Unknown error']
        };

        setResults(prev => [...prev, errorResult]);
        setProcessedCount(prev => prev + 1);
        setFailureCount(prev => prev + 1);
      }
    }

    // Complete processing
    setIsProcessing(false);
    setIsPaused(false);
    setProcessingQueue([]);
    
    if (onComplete) {
      onComplete(results);
    }
  };

  const getStatusColor = (poi: POI) => {
    const result = results.find(r => r.poi_id === poi.id);
    if (!result) {
      if (processingQueue.includes(poi.id)) return 'border-blue-200 bg-blue-50';
      if (processedCount === 0) return 'border-gray-200';
      return 'border-gray-200';
    }
    
    return result.success ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50';
  };

  const getEnrichmentStatus = (poi: POI) => {
    if (poi.osm_category === 'not_found') {
      return { label: 'Not Found', color: 'bg-gray-100 text-gray-800' };
    }
    
    if (!poi.osm_category) {
      return { label: 'No OSM Data', color: 'bg-red-100 text-red-800' };
    }
    
    if ((poi.osm_data_quality_score || 0) < 70) {
      return { label: 'Low Quality', color: 'bg-yellow-100 text-yellow-800' };
    }
    
    return { label: 'Complete', color: 'bg-green-100 text-green-800' };
  };

  return (
    <div className="bg-white rounded-lg shadow p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Database className="h-6 w-6 text-blue-600" />
          <div>
            <h2 className="text-xl font-semibold text-gray-900">Batch OSM Enrichment</h2>
            <p className="text-sm text-gray-600">
              Enrich {totalCount} POIs with OpenStreetMap data
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {!isProcessing ? (
            <button
              onClick={handleStart}
              disabled={totalCount === 0}
              className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50 flex items-center gap-2"
            >
              <Play className="h-4 w-4" />
              Start Batch
            </button>
          ) : (
            <>
              {!isPaused ? (
                <button
                  onClick={handlePause}
                  className="px-4 py-2 bg-yellow-600 text-white rounded hover:bg-yellow-700 flex items-center gap-2"
                >
                  <Pause className="h-4 w-4" />
                  Pause
                </button>
              ) : (
                <button
                  onClick={handleResume}
                  className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 flex items-center gap-2"
                >
                  <Play className="h-4 w-4" />
                  Resume
                </button>
              )}
              
              <button
                onClick={handleStop}
                className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
              >
                Stop
              </button>
            </>
          )}
        </div>
      </div>

      {/* Progress */}
      {isProcessing && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
              <span className="font-medium text-blue-800">
                {isPaused ? 'Paused' : 'Processing...'}
              </span>
            </div>
            <span className="text-sm text-blue-700">
              {processedCount} / {totalCount} ({progressPercentage.toFixed(1)}%)
            </span>
          </div>
          
          <div className="w-full bg-blue-200 rounded-full h-2 mb-3">
            <div 
              className="bg-blue-600 h-2 rounded-full transition-all duration-300"
              style={{ width: `${progressPercentage}%` }}
            />
          </div>
          
          <div className="flex items-center justify-between text-sm text-blue-700">
            <span>✅ Success: {successCount}</span>
            <span>❌ Failed: {failureCount}</span>
            <span>⏳ Remaining: {processingQueue.length}</span>
          </div>
        </div>
      )}

      {/* Statistics */}
      {processedCount > 0 && (
        <div className="grid grid-cols-4 gap-4">
          <div className="bg-gray-50 rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-gray-900">{processedCount}</div>
            <div className="text-xs text-gray-600">Processed</div>
          </div>
          <div className="bg-green-50 rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-green-600">{successCount}</div>
            <div className="text-xs text-gray-600">Successful</div>
          </div>
          <div className="bg-red-50 rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-red-600">{failureCount}</div>
            <div className="text-xs text-gray-600">Failed</div>
          </div>
          <div className="bg-blue-50 rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-blue-600">
              {successCount > 0 ? Math.round((successCount / processedCount) * 100) : 0}%
            </div>
            <div className="text-xs text-gray-600">Success Rate</div>
          </div>
        </div>
      )}

      {/* POI List */}
      <div className="space-y-2 max-h-96 overflow-y-auto">
        <h3 className="font-medium text-gray-900 flex items-center gap-2">
          <BarChart3 className="h-4 w-4" />
          POIs Queue ({totalCount})
        </h3>
        
        {pois.map((poi, index) => {
          const status = getEnrichmentStatus(poi);
          const result = results.find(r => r.poi_id === poi.id);
          const isProcessing = processingQueue.includes(poi.id) && currentIndex === index;
          
          return (
            <div
              key={poi.id}
              className={`flex items-center justify-between p-3 border rounded-lg transition-colors ${getStatusColor(poi)}`}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-gray-900 truncate">
                    {poi.name}
                  </span>
                  {isProcessing && (
                    <Loader2 className="h-3 w-3 animate-spin text-blue-500" />
                  )}
                </div>
                
                <p className="text-sm text-gray-500">
                  {poi.city}, {poi.country}
                </p>
                
                {result && (
                  <div className="mt-1">
                    {result.success ? (
                      <p className="text-xs text-green-600">
                        ✅ {result.message}
                        {result.data_quality_score && ` (${result.data_quality_score}%)`}
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
                <span className={`px-2 py-1 text-xs rounded-full ${status.color}`}>
                  {status.label}
                </span>
                
                {result?.success && (
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                )}
                
                {result?.success === false && (
                  <AlertCircle className="h-4 w-4 text-red-500" />
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Individual Enrichment Components */}
      {showIndividualResults && processedCount > 0 && (
        <div className="space-y-3">
          <h3 className="font-medium text-gray-900">Individual Results</h3>
          <div className="grid gap-3">
            {pois.slice(0, Math.min(processedCount, 5)).map((poi) => (
              <OSMDataEnrichment
                key={poi.id}
                attractionId={poi.id}
                attractionName={poi.name}
                attractionCity={poi.city}
                attractionCountry={poi.country}
                showPreview={false}
                autoEnrich={false}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default BatchOSMEnrichment;
