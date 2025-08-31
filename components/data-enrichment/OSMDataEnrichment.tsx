'use client';

import { useState, useEffect } from 'react';
import { Loader2, Database, CheckCircle2, AlertCircle, MapPin, Globe, Layers } from 'lucide-react';

interface OSMEnrichmentData {
  poi_id: string;
  success: boolean;
  message: string;
  data_quality_score?: number;
  fields_updated?: string[];
  errors?: string[];
}

interface OSMDataEnrichmentProps {
  attractionId: string;
  attractionName: string;
  attractionCity?: string;
  attractionCountry?: string;
  onEnrichmentComplete?: (result: OSMEnrichmentData) => void;
  showPreview?: boolean;
  autoEnrich?: boolean;
}

export function OSMDataEnrichment({
  attractionId,
  attractionName,
  attractionCity,
  attractionCountry,
  onEnrichmentComplete,
  showPreview = true,
  autoEnrich = false
}: OSMDataEnrichmentProps) {
  const [isEnriching, setIsEnriching] = useState(false);
  const [enrichmentResult, setEnrichmentResult] = useState<OSMEnrichmentData | null>(null);
  const [previewData, setPreviewData] = useState<any>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);

  // Auto-enrich on mount if requested
  useEffect(() => {
    if (autoEnrich && !enrichmentResult && !isEnriching) {
      handleEnrich();
    }
  }, [autoEnrich]);

  // Load preview data on mount if requested
  useEffect(() => {
    if (showPreview && !previewData && !isLoadingPreview) {
      loadPreviewData();
    }
  }, [showPreview]);

  const loadPreviewData = async () => {
    if (!attractionId) return;
    
    setIsLoadingPreview(true);
    try {
      // Call our boundary detection API to get OSM data preview
      const response = await fetch('/api/poi-boundaries/detect', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          attraction_id: attractionId 
        }),
      });

      const result = await response.json();
      if (result.success) {
        setPreviewData({
          boundary_source: result.source,
          boundary_area: result.boundary?.area_m2,
          trigger_points_count: result.trigger_points?.length || 0,
          poi_confidence: result.poi_confidence_score?.overall_score
        });
      }
    } catch (error) {
      console.error('Error loading preview data:', error);
    } finally {
      setIsLoadingPreview(false);
    }
  };

  const handleEnrich = async () => {
    if (!attractionId) return;

    setIsEnriching(true);
    setEnrichmentResult(null);

    try {
      console.log(`🔄 Enriching attraction: ${attractionName}`);

      // Use the existing comprehensive OSM enrichment API
      const response = await fetch('/api/pois/enrich-osm', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          poi_id: attractionId,
          name: attractionName,
          city: attractionCity || '',
          country: attractionCountry || ''
        }),
      });

      const result = await response.json();
      
      const enrichmentData: OSMEnrichmentData = {
        poi_id: attractionId,
        success: result.success,
        message: result.message,
        data_quality_score: result.data_quality_score,
        fields_updated: result.fields_updated,
        errors: result.errors
      };

      setEnrichmentResult(enrichmentData);
      
      if (onEnrichmentComplete) {
        onEnrichmentComplete(enrichmentData);
      }

    } catch (error) {
      console.error('Error enriching attraction:', error);
      
      const errorResult: OSMEnrichmentData = {
        poi_id: attractionId,
        success: false,
        message: 'Network error occurred',
        errors: [error instanceof Error ? error.message : 'Unknown error']
      };
      
      setEnrichmentResult(errorResult);
      
      if (onEnrichmentComplete) {
        onEnrichmentComplete(errorResult);
      }
    } finally {
      setIsEnriching(false);
    }
  };

  const getQualityColor = (score?: number) => {
    if (!score) return 'text-gray-500';
    if (score >= 80) return 'text-green-600';
    if (score >= 60) return 'text-yellow-600';
    return 'text-red-600';
  };

  const getQualityLabel = (score?: number) => {
    if (!score) return 'Unknown';
    if (score >= 80) return 'Excellent';
    if (score >= 60) return 'Good';
    if (score >= 40) return 'Fair';
    return 'Poor';
  };

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Database className="h-5 w-5 text-blue-600" />
          <h3 className="font-medium text-gray-900">OSM Data Enrichment</h3>
        </div>
        
        <button
          onClick={handleEnrich}
          disabled={isEnriching}
          className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
        >
          {isEnriching ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin" />
              Enriching...
            </>
          ) : (
            <>
              <Globe className="h-3 w-3" />
              Enrich Data
            </>
          )}
        </button>
      </div>

      {/* POI Info */}
      <div className="text-sm text-gray-600">
        <div className="flex items-center gap-1">
          <MapPin className="h-3 w-3" />
          <span className="font-medium">{attractionName}</span>
          {attractionCity && attractionCountry && (
            <span> • {attractionCity}, {attractionCountry}</span>
          )}
        </div>
      </div>

      {/* Preview Data */}
      {showPreview && (
        <div className="border-t pt-3">
          <h4 className="text-sm font-medium text-gray-700 mb-2 flex items-center gap-1">
            <Layers className="h-3 w-3" />
            Current Data Preview
          </h4>
          
          {isLoadingPreview ? (
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <Loader2 className="h-3 w-3 animate-spin" />
              Loading preview...
            </div>
          ) : previewData ? (
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <span className="text-gray-500">Boundary Source:</span>
                <div className="font-medium capitalize">
                  {previewData.boundary_source?.replace(/_/g, ' ') || 'Not available'}
                </div>
              </div>
              <div>
                <span className="text-gray-500">Boundary Area:</span>
                <div className="font-medium">
                  {previewData.boundary_area ? 
                    `${previewData.boundary_area.toLocaleString()}m²` : 
                    'Not available'
                  }
                </div>
              </div>
              <div>
                <span className="text-gray-500">Trigger Points:</span>
                <div className="font-medium">
                  {previewData.trigger_points_count || 0} points
                </div>
              </div>
              <div>
                <span className="text-gray-500">POI Confidence:</span>
                <div className={`font-medium ${getQualityColor(previewData.poi_confidence * 100)}`}>
                  {previewData.poi_confidence ? 
                    `${Math.round(previewData.poi_confidence * 100)}%` : 
                    'Not available'
                  }
                </div>
              </div>
            </div>
          ) : (
            <div className="text-sm text-gray-500">
              No preview data available
            </div>
          )}
        </div>
      )}

      {/* Enrichment Result */}
      {enrichmentResult && (
        <div className="border-t pt-3">
          <div className={`flex items-start gap-2 p-3 rounded-md ${
            enrichmentResult.success 
              ? 'bg-green-50 border border-green-200' 
              : 'bg-red-50 border border-red-200'
          }`}>
            {enrichmentResult.success ? (
              <CheckCircle2 className="h-4 w-4 text-green-600 mt-0.5 flex-shrink-0" />
            ) : (
              <AlertCircle className="h-4 w-4 text-red-600 mt-0.5 flex-shrink-0" />
            )}
            
            <div className="flex-1 min-w-0">
              <p className={`text-sm font-medium ${
                enrichmentResult.success ? 'text-green-800' : 'text-red-800'
              }`}>
                {enrichmentResult.success ? 'Enrichment Successful' : 'Enrichment Failed'}
              </p>
              
              <p className={`text-sm mt-1 ${
                enrichmentResult.success ? 'text-green-700' : 'text-red-700'
              }`}>
                {enrichmentResult.message}
              </p>
              
              {enrichmentResult.success && enrichmentResult.data_quality_score && (
                <div className="mt-2 flex items-center gap-4 text-xs">
                  <div>
                    <span className="text-gray-600">Quality Score: </span>
                    <span className={`font-medium ${getQualityColor(enrichmentResult.data_quality_score)}`}>
                      {enrichmentResult.data_quality_score}% ({getQualityLabel(enrichmentResult.data_quality_score)})
                    </span>
                  </div>
                  
                  {enrichmentResult.fields_updated && enrichmentResult.fields_updated.length > 0 && (
                    <div>
                      <span className="text-gray-600">Fields Updated: </span>
                      <span className="font-medium text-green-700">
                        {enrichmentResult.fields_updated.length}
                      </span>
                    </div>
                  )}
                </div>
              )}
              
              {enrichmentResult.fields_updated && enrichmentResult.fields_updated.length > 0 && (
                <details className="mt-2">
                  <summary className="text-xs text-gray-600 cursor-pointer hover:text-gray-800">
                    View updated fields ({enrichmentResult.fields_updated.length})
                  </summary>
                  <div className="mt-1 text-xs text-gray-600">
                    <div className="flex flex-wrap gap-1">
                      {enrichmentResult.fields_updated.map((field, index) => (
                        <span
                          key={index}
                          className="px-2 py-0.5 bg-gray-100 rounded text-xs"
                        >
                          {field}
                        </span>
                      ))}
                    </div>
                  </div>
                </details>
              )}
              
              {enrichmentResult.errors && enrichmentResult.errors.length > 0 && (
                <div className="mt-2">
                  <p className="text-xs text-red-600 font-medium">Errors:</p>
                  <ul className="text-xs text-red-600 mt-1 space-y-1">
                    {enrichmentResult.errors.map((error, index) => (
                      <li key={index}>• {error}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default OSMDataEnrichment;
