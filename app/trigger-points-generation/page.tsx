'use client';

import { useState, useEffect } from 'react';
import { useUser, useSupabaseClient } from '@supabase/auth-helpers-react';
import { BatchProgressBar } from '@/components/trigger-points/BatchProgressBar';
import { OSMDataEnrichment } from '@/components/data-enrichment';

interface POIForTriggerGeneration {
  attraction_id: string;
  name: string;
  city: string;
  country: string;
  latitude: number;
  longitude: number;
  google_types: string[];
  trigger_points_count: number;
  new_tps_count: number;
  old_tps_count: number;
  has_new_tps: boolean;
  has_old_tps: boolean;
  last_tp_generation: string | null;
  tp_generation_status: 'none' | 'processing' | 'completed' | 'failed';
  tp_confidence_score: number | null;
  boundary_source?: string;
}

interface GenerationStats {
  total: number;
  withTPs: number;
  withoutTPs: number;
  processing: number;
  failed: number;
}

export default function TriggerPointsGenerationPage() {
  const user = useUser();
  const supabase = useSupabaseClient();
  const [pois, setPois] = useState<POIForTriggerGeneration[]>([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [filters, setFilters] = useState({
    country: 'all',
    city: 'all',
    tp_status: 'all',
    confidence_range: 'all'
  });
  const [stats, setStats] = useState<GenerationStats>({
    total: 0,
    withTPs: 0,
    withoutTPs: 0,
    processing: 0,
    failed: 0
  });
  const [countries, setCountries] = useState<string[]>([]);
  const [cities, setCities] = useState<string[]>([]);
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  const [batchProgress, setBatchProgress] = useState({ current: 0, total: 0, errors: 0 });
  const [expandedEnrichment, setExpandedEnrichment] = useState<string | null>(null);

  useEffect(() => {
    if (user) {
      loadCountriesAndCities();
      loadPOIs();
    }
  }, [filters, user]);

  // Show loading or login message if not authenticated
  if (!user) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900 mb-4">Authentication Required</h1>
          <p className="text-gray-600">Please log in to access the Trigger Points Generation system.</p>
        </div>
      </div>
    );
  }

  const loadCountriesAndCities = async () => {
    try {
      // Load unique countries
      const { data: countryData } = await supabase
        .schema('core')
        .from('attractions')
        .select('country')
        .not('country', 'is', null);
      
      const uniqueCountries = [...new Set(countryData?.map(item => item.country) || [])];
      setCountries(uniqueCountries);

      // Load unique cities for selected country
      let cityQuery = supabase
        .schema('core')
        .from('attractions')
        .select('city')
        .not('city', 'is', null);

      if (filters.country !== 'all') {
        cityQuery = cityQuery.eq('country', filters.country);
      }

      const { data: cityData } = await cityQuery;
      const uniqueCities = [...new Set(cityData?.map(item => item.city) || [])];
      setCities(uniqueCities);
    } catch (error) {
      console.error('Error loading countries/cities:', error);
    }
  };

  const loadPOIs = async () => {
    setLoading(true);
    try {
      let query = supabase
        .schema('core')
        .from('attractions')
        .select(`
          id,
          name,
          city,
          country,
          attraction_coordinate!inner(latitude, longitude),
          google_types
        `)
        .not('attraction_coordinate', 'is', null)
        .order('name');

      // Apply filters
      if (filters.country !== 'all') {
        query = query.eq('country', filters.country);
      }
      if (filters.city !== 'all') {
        query = query.eq('city', filters.city);
      }

      const { data, error } = await query;

      if (error) {
        console.error('Error loading POIs:', error);
        return;
      }

      // Get trigger points count for each POI
      const poisWithTPs = await Promise.all((data || []).map(async (poi) => {
        const { data: tpData, error: tpError } = await supabase
          .schema('core')
          .from('attraction_trigger_points')
          .select('id, confidence_score, auto_status, created_at')
          .eq('attraction_id', poi.id);

        // Debug logging for first few POIs
        if (data.indexOf(poi) < 3) {
          console.log(`🔍 ${poi.name}: ${tpData?.length || 0} trigger points`, { 
            tpError, 
            hasNewTPs: tpData?.some(tp => tp.auto_status === 'approved') || false,
            hasOldTPs: tpData?.some(tp => !tp.auto_status) || false
          });
        }

        const coordinate = poi.attraction_coordinate[0];
        
        // Categorize TPs
        const newTPs = tpData?.filter(tp => tp.auto_status === 'approved') || [];
        const oldTPs = tpData?.filter(tp => !tp.auto_status) || [];
        const hasNewTPs = newTPs.length > 0;
        const hasOldTPs = oldTPs.length > 0;
        
        return {
          attraction_id: poi.id,
          name: poi.name,
          city: poi.city,
          country: poi.country,
          latitude: coordinate.latitude,
          longitude: coordinate.longitude,
          google_types: poi.google_types || [],
          trigger_points_count: tpData?.length || 0,
          new_tps_count: newTPs.length,
          old_tps_count: oldTPs.length,
          has_new_tps: hasNewTPs,
          has_old_tps: hasOldTPs,
          last_tp_generation: tpData?.[0]?.created_at || null,
          tp_generation_status: (tpData?.length || 0) > 0 ? 'completed' : 'none',
          tp_confidence_score: hasNewTPs ? 
            Math.round((newTPs.reduce((sum, tp) => sum + (tp.confidence_score || 0), 0) / newTPs.length) * 100) / 100 : null
        } as POIForTriggerGeneration;
      }));

      // Apply TP status filter
      let filteredPOIs = poisWithTPs;
      if (filters.tp_status !== 'all') {
        filteredPOIs = poisWithTPs.filter(poi => {
          switch (filters.tp_status) {
            case 'with_tps':
              return poi.trigger_points_count > 0;
            case 'without_tps':
              return poi.trigger_points_count === 0;
            case 'with_new_tps':
              return poi.has_new_tps;
            case 'with_old_tps':
              return poi.has_old_tps && !poi.has_new_tps;
            case 'high_confidence':
              return poi.tp_confidence_score && poi.tp_confidence_score >= 0.8;
            case 'needs_review':
              return poi.tp_confidence_score && poi.tp_confidence_score >= 0.5 && poi.tp_confidence_score < 0.75;
            default:
              return true;
          }
        });
      }

      setPois(filteredPOIs);
      
      // Calculate stats with debugging
      const withTPs = filteredPOIs.filter(p => p.trigger_points_count > 0).length;
      const withoutTPs = filteredPOIs.filter(p => p.trigger_points_count === 0).length;
      const withNewTPs = filteredPOIs.filter(p => p.has_new_tps).length;
      const withOldTPs = filteredPOIs.filter(p => p.has_old_tps && !p.has_new_tps).length;
      
      console.log(`📊 Statistics:`, {
        total: filteredPOIs.length,
        withTPs,
        withoutTPs,
        withNewTPs,
        withOldTPs,
        sampleWithNewTPs: filteredPOIs.filter(p => p.has_new_tps).slice(0, 3).map(p => ({ name: p.name, new: p.new_tps_count, old: p.old_tps_count })),
        sampleWithOldTPs: filteredPOIs.filter(p => p.has_old_tps && !p.has_new_tps).slice(0, 3).map(p => ({ name: p.name, count: p.trigger_points_count }))
      });
      
      setStats({
        total: filteredPOIs.length,
        withTPs,
        withoutTPs,
        processing: 0, // TODO: Implement processing status
        failed: 0 // TODO: Implement failed status
      });

    } catch (error) {
      console.error('Error loading POIs:', error);
    } finally {
      setLoading(false);
    }
  };

  // Enhanced test function using refined logic (from test-poi-boundaries)
  const handleTestPOI = async (attractionId: string, poiName: string) => {
    const poi = pois.find(p => p.attraction_id === attractionId);
    if (!poi) return;
    
    try {
      console.log(`🧪 Testing POI with refined rules: ${poiName} (${attractionId})`);
      
      const startTime = Date.now();
      const response = await fetch('/api/poi-boundaries/detect', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          attraction_id: attractionId,
          poi_lat: poi.latitude,
          poi_lng: poi.longitude,
          poi_name: poi.name
        }),
      });

      const result = await response.json();
      const processingTime = Date.now() - startTime;
      
      if (result.success) {
        // Enhanced logging with all refined features
        const message = `🧪 TEST RESULTS for "${poiName}" (${processingTime}ms):\n\n` +
          `✅ Boundary Source: ${result.boundary?.source || 'N/A'}\n` +
          `📐 Boundary Area: ${result.boundary?.area_m2?.toLocaleString()}m²\n` +
          `🎯 Total Trigger Points: ${result.trigger_points?.length || 0}\n` +
          `💾 Auto-Saved TPs: ${result.trigger_points_saved || 0}\n` +
          `⚠️ Duplicates Skipped: ${result.duplicates_skipped || 0}\n` +
          `🔧 OSM Data Enriched: ${result.enrichment_saved ? '✅' : '❌'}\n` +
          `${result.note ? `📝 Note: ${result.note}\n` : ''}` +
          `\n🔍 Trigger Points Breakdown:\n` +
          `   - Primary: ${result.trigger_points?.filter((tp: any) => tp.type === 'primary').length || 0}\n` +
          `   - Secondary: ${result.trigger_points?.filter((tp: any) => tp.type === 'secondary').length || 0}\n` +
          `   - Fallback: ${result.trigger_points?.filter((tp: any) => tp.type === 'fallback').length || 0}\n` +
          `\n📈 Auto-Approval Status:\n` +
          `   - Approved: ${result.trigger_points?.filter((tp: any) => tp.auto_status === 'approved').length || 0}\n` +
          `   - Review: ${result.trigger_points?.filter((tp: any) => tp.auto_status === 'review').length || 0}\n` +
          `   - Rejected: ${result.trigger_points?.filter((tp: any) => tp.auto_status === 'rejected').length || 0}`;
        
        alert(message);
        
        // Log detailed results to console for debugging
        console.log(`🧪 Detailed results for ${poiName}:`, result);
        
        // Refresh POI list to show updated data
        loadPOIs();
      } else {
        alert(`❌ Test failed for "${poiName}": ${result.error}`);
      }
      
    } catch (error) {
      console.error('Error testing POI:', error);
      alert(`❌ Error testing POI: ${error}`);
    }
  };

  const handleGenerateBatch = async (batchSize: number, specificAttractionId?: string) => {
    setProcessing(true);
    setBatchProgress({ current: 0, total: 0, errors: 0 });
    
    try {
      const requestBody: any = {
        batch_size: batchSize
      };

      if (specificAttractionId) {
        requestBody.attraction_ids = [specificAttractionId];
      } else {
        if (filters.country !== 'all') requestBody.country = filters.country;
        if (filters.city !== 'all') requestBody.city = filters.city;
      }

      console.log(`🚀 Starting batch generation with:`, requestBody);

      const response = await fetch('/api/trigger-points/generate-batch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      const result = await response.json();

      if (result.success) {
        // Enhanced batch results with refined metrics
        const message = `✅ Batch Generation Completed with Refined Rules!\n\n` +
          `📊 POIs Processed: ${result.processed}\n` +
          `✅ Successful: ${result.successful}\n` +
          `❌ Failed: ${result.failed}\n\n` +
          `🎯 Trigger Points Generated:\n` +
          `   - Approved: ${result.summary.approved_tps}\n` +
          `   - Review: ${result.summary.review_tps}\n` +
          `   - Rejected: ${result.summary.rejected_tps}\n\n` +
          `🔧 Enhanced Features Applied:\n` +
          `   ✅ OSM Boundary Detection\n` +
          `   ✅ Unified Overpass API (1 request vs 3)\n` +
          `   ✅ Boundary-Aware Bearing Calculation\n` +
          `   ✅ Duplicate Validation (per POI)\n` +
          `   ✅ Auto-Save with Confidence Thresholds\n` +
          `   ✅ City-Relative Elevation Calculation\n` +
          `   ✅ Improved Search Variations\n` +
          `   ✅ OSM Data Enrichment\n` +
          `   ✅ Rate Limiting & Timeout Optimization (60s)`;
        
        alert(message);
        
        if (result.errors && result.errors.length > 0) {
          console.log('❌ Errors occurred during batch processing:');
          result.errors.forEach((err: any) => {
            console.log(`   - ${err.attraction_name}: ${err.error}`);
          });
        }
        
        console.log('🚀 Batch processing completed with refined rules from /test-poi-boundaries');
        loadPOIs(); // Refresh the list to show updated data
      } else {
        alert(`❌ Batch generation failed: ${result.error}`);
      }
      
    } catch (error) {
      console.error('Error in batch generation:', error);
      alert('Error in batch generation');
    } finally {
      setProcessing(false);
      setBatchProgress({ current: 0, total: 0, errors: 0 });
    }
  };



  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed':
        return 'text-green-600 bg-green-100';
      case 'processing':
        return 'text-blue-600 bg-blue-100';
      case 'failed':
        return 'text-red-600 bg-red-100';
      default:
        return 'text-gray-600 bg-gray-100';
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'completed':
        return 'Completed';
      case 'processing':
        return 'Processing';
      case 'failed':
        return 'Failed';
      default:
        return 'No TPs';
    }
  };

  const getConfidenceColor = (score: number | null) => {
    if (!score) return 'text-gray-500';
    if (score >= 0.75) return 'text-green-600';
    if (score >= 0.50) return 'text-yellow-600';
    return 'text-red-600';
  };

  const getConfidenceText = (score: number | null) => {
    if (!score) return 'N/A';
    if (score >= 0.75) return 'Approved';
    if (score >= 0.50) return 'Review';
    return 'Rejected';
  };

  const getBoundarySourceColor = (source?: string) => {
    switch (source) {
      case 'osm_nominatim':
        return 'bg-green-100 text-green-800'; // Best - found by name
      case 'fallback_street_analysis':
        return 'bg-blue-100 text-blue-800'; // Good - street-based fallback
      case 'osm_coordinates':
        return 'bg-yellow-100 text-yellow-800'; // Caution - reverse geocoding
      case 'osm_overpass':
        return 'bg-purple-100 text-purple-800'; // Alternative - overpass API
      default:
        return 'bg-gray-100 text-gray-800'; // Unknown
    }
  };

  const getBoundarySourceText = (source?: string) => {
    switch (source) {
      case 'osm_nominatim':
        return 'Name Match';
      case 'fallback_street_analysis':
        return 'Street Analysis';
      case 'osm_coordinates':
        return 'Coordinates';
      case 'osm_overpass':
        return 'Overpass';
      default:
        return source || 'Unknown';
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Trigger Points Generation</h1>
          <p className="mt-2 text-gray-600">
            Generate trigger points for POIs using refined boundary detection rules
          </p>
          <div className="mt-4 bg-blue-50 border border-blue-200 rounded-lg p-4">
            <h3 className="text-sm font-medium text-blue-800 mb-2">🔧 Enhanced Detection Rules Active</h3>
            <ul className="text-sm text-blue-700 space-y-1">
              <li>✅ <strong>Smart Name Search:</strong> 8 intelligent variations per POI type (museums, parks, buildings)</li>
              <li>✅ <strong>Fallback Hierarchy:</strong> Street analysis → Reverse geocoding → Estimated boundary</li>
              <li>✅ <strong>No Assumptions:</strong> Uses real data without size/type guessing</li>
              <li>✅ <strong>Validated Boundaries:</strong> Ensures boundaries match POI locations</li>
              <li>🧪 <strong>Test Button:</strong> Preview results before generating to database</li>
            </ul>
          </div>
        </div> */}

        {/* Controls */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <div className="flex flex-wrap gap-4 items-center justify-between">
            <div className="flex flex-wrap gap-4">
              {/* Country Filter */}
              <select
                value={filters.country}
                onChange={(e) => {
                  setFilters(prev => ({ ...prev, country: e.target.value, city: 'all' }));
                }}
                className="border border-gray-300 rounded-md px-3 py-2 text-sm"
              >
                <option value="all">All Countries</option>
                {countries.map(country => (
                  <option key={country} value={country}>{country}</option>
                ))}
              </select>

              {/* City Filter */}
              <select
                value={filters.city}
                onChange={(e) => setFilters(prev => ({ ...prev, city: e.target.value }))}
                className="border border-gray-300 rounded-md px-3 py-2 text-sm"
                disabled={filters.country === 'all'}
              >
                <option value="all">All Cities</option>
                {cities.map(city => (
                  <option key={city} value={city}>{city}</option>
                ))}
              </select>

              {/* TP Status Filter */}
              <select
                value={filters.tp_status}
                onChange={(e) => setFilters(prev => ({ ...prev, tp_status: e.target.value }))}
                className="border border-gray-300 rounded-md px-3 py-2 text-sm"
              >
                <option value="all">All Status</option>
                <option value="without_tps">Without TPs</option>
                <option value="with_tps">With TPs (Any)</option>
                <option value="with_new_tps">With New TPs (Approved)</option>
                <option value="with_old_tps">With Old TPs Only</option>
                <option value="high_confidence">High Confidence (≥80%)</option>
                <option value="needs_review">Needs Review (50-74%)</option>
              </select>

              {/* Confidence Filter */}
              <select
                value={filters.confidence_range}
                onChange={(e) => setFilters(prev => ({ ...prev, confidence_range: e.target.value }))}
                className="border border-gray-300 rounded-md px-3 py-2 text-sm"
              >
                <option value="all">All Confidence</option>
                <option value="approved">Approved (≥75%)</option>
                <option value="review">Review (50-74%)</option>
                <option value="rejected">Rejected (&lt;50%)</option>
              </select>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => {
                  console.log('🔄 Force refreshing data...');
                  loadPOIs();
                }}
                disabled={processing}
                className="bg-gray-600 text-white px-3 py-2 rounded-md text-sm font-medium hover:bg-gray-700 disabled:opacity-50"
              >
                🔄 Refresh
              </button>
              <button
                onClick={() => handleGenerateBatch(10)}
                disabled={processing}
                className="bg-green-600 text-white px-3 py-2 rounded-md text-sm font-medium hover:bg-green-700 disabled:opacity-50"
              >
                {processing ? 'Processing...' : 'Generate 10'}
              </button>
              <button
                onClick={() => handleGenerateBatch(50)}
                disabled={processing}
                className="bg-blue-600 text-white px-3 py-2 rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
              >
                {processing ? 'Processing...' : 'Generate 50'}
              </button>
              <button
                onClick={() => handleGenerateBatch(100)}
                disabled={processing}
                className="bg-purple-600 text-white px-3 py-2 rounded-md text-sm font-medium hover:bg-purple-700 disabled:opacity-50"
              >
                {processing ? 'Processing...' : 'Generate 100'}
              </button>
              <button
                onClick={() => handleGenerateBatch(1000)}
                disabled={processing}
                className="bg-orange-600 text-white px-3 py-2 rounded-md text-sm font-medium hover:bg-orange-700 disabled:opacity-50"
              >
                {processing ? 'Processing...' : 'Generate 1000'}
              </button>
            </div>
          </div>
        </div>

        {/* Progress Bar */}
        <BatchProgressBar 
          progress={batchProgress}
          isActive={processing}
        />

        {/* Statistics */}
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-6">
          <div className="bg-white rounded-lg shadow p-4">
            <h3 className="text-sm font-medium text-gray-500">Total POIs</h3>
            <p className="text-2xl font-bold text-gray-900">{stats.total}</p>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <h3 className="text-sm font-medium text-gray-500">With TPs</h3>
            <p className="text-2xl font-bold text-green-600">{stats.withTPs}</p>
            <p className="text-xs text-gray-500 mt-1">
              {stats.total > 0 ? ((stats.withTPs / stats.total) * 100).toFixed(0) : 0}% coverage
            </p>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <h3 className="text-sm font-medium text-gray-500">Without TPs</h3>
            <p className="text-2xl font-bold text-orange-600">{stats.withoutTPs}</p>
            <p className="text-xs text-gray-500 mt-1">Ready for generation</p>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <h3 className="text-sm font-medium text-gray-500">High Quality</h3>
            <p className="text-2xl font-bold text-emerald-600">
              {pois.filter(p => p.tp_confidence_score && p.tp_confidence_score >= 0.75).length}
            </p>
            <p className="text-xs text-gray-500 mt-1">≥75% confidence</p>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <h3 className="text-sm font-medium text-gray-500">Need Review</h3>
            <p className="text-2xl font-bold text-amber-600">
              {pois.filter(p => p.tp_confidence_score && p.tp_confidence_score >= 0.5 && p.tp_confidence_score < 0.75).length}
            </p>
            <p className="text-xs text-gray-500 mt-1">50-74% confidence</p>
          </div>
        </div>

        {/* POIs List */}
        <div className="bg-white rounded-lg shadow overflow-hidden">
          {loading ? (
            <div className="p-8 text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
              <p className="mt-2 text-gray-600">Loading POIs...</p>
            </div>
          ) : pois.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-gray-600">No POIs found</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      POI
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Location
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      TP Count
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Confidence
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Boundary Source
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Last Generation
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {pois.map((poi) => [
                    <tr key={poi.attraction_id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div>
                          <div className="text-sm font-medium text-gray-900">
                            {poi.name}
                          </div>
                          <div className="text-sm text-gray-500">
                            {poi.google_types.slice(0, 2).join(', ')}
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-900">
                          {poi.city}, {poi.country}
                        </div>
                        <div className="text-xs text-gray-500">
                          {poi.latitude.toFixed(4)}, {poi.longitude.toFixed(4)}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        <div className="flex flex-col">
                          <span className="font-medium">{poi.trigger_points_count}</span>
                          {poi.has_new_tps && (
                            <span className="text-xs text-green-600">
                              {poi.new_tps_count} new
                            </span>
                          )}
                          {poi.has_old_tps && (
                            <span className="text-xs text-gray-500">
                              {poi.old_tps_count} old
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getStatusColor(poi.tp_generation_status)}`}>
                          {getStatusText(poi.tp_generation_status)}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {poi.tp_confidence_score !== null ? (
                          <div>
                            <span className={`text-sm font-medium ${getConfidenceColor(poi.tp_confidence_score)}`}>
                              {(poi.tp_confidence_score * 100).toFixed(0)}%
                            </span>
                            <div className="text-xs text-gray-500">
                              {getConfidenceText(poi.tp_confidence_score)}
                            </div>
                          </div>
                        ) : (
                          <span className="text-sm text-gray-500">N/A</span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {poi.boundary_source ? (
                          <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getBoundarySourceColor(poi.boundary_source)}`}>
                            {getBoundarySourceText(poi.boundary_source)}
                          </span>
                        ) : (
                          <span className="text-sm text-gray-400">-</span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {poi.last_tp_generation ? (
                          new Date(poi.last_tp_generation).toLocaleDateString('pt-BR')
                        ) : (
                          'Never'
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleTestPOI(poi.attraction_id, poi.name)}
                            disabled={processing}
                            className="text-green-600 hover:text-green-900 disabled:opacity-50 text-xs"
                          >
                            Test
                          </button>
                          <button
                            onClick={() => setExpandedEnrichment(expandedEnrichment === poi.attraction_id ? null : poi.attraction_id)}
                            disabled={processing}
                            className="text-purple-600 hover:text-purple-900 disabled:opacity-50 text-xs"
                          >
                            Enrich
                          </button>
                          <button
                            onClick={() => handleGenerateBatch(1, poi.attraction_id)}
                            disabled={processing}
                            className="text-blue-600 hover:text-blue-900 disabled:opacity-50"
                          >
                            Generate
                          </button>
                        </div>
                      </td>
                    </tr>,
                    
                    // Enrichment Component Expansion
                    expandedEnrichment === poi.attraction_id && (
                      <tr key={`${poi.attraction_id}-enrichment`}>
                        <td colSpan={8} className="px-6 py-4 bg-gray-50 border-t border-gray-200">
                          <OSMDataEnrichment
                            attractionId={poi.attraction_id}
                            attractionName={poi.name}
                            attractionCity={poi.city}
                            attractionCountry={poi.country}
                            showPreview={true}
                            autoEnrich={false}
                            onEnrichmentComplete={(result) => {
                              console.log('Enrichment completed:', result);
                              // Refresh the POI list to show updated data
                              loadPOIs();
                              // Optionally close the expanded section after success
                              if (result.success) {
                                setTimeout(() => {
                                  setExpandedEnrichment(null);
                                }, 2000);
                              }
                            }}
                          />
                        </td>
                      </tr>
                    )
                  ].filter(Boolean))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
