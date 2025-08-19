'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSupabaseClient } from '@supabase/auth-helpers-react';
import { Loader2, AlertCircle, CheckCircle2, RefreshCw, Play, Volume2, Eye, Edit } from 'lucide-react';
import { cn } from '@/lib/utils';

interface POI {
  id: string;
  name: string;
  city: string;
  country: string;
  descriptions: Array<{
    id: string;
    language: string;
    description: string;
    verification_status: string;
    audio_url?: string;
  }>;
  verification_status?: string;
  score?: number;
}

export default function ImprovePage() {
  const router = useRouter();
  const supabase = useSupabaseClient();
  
  const [isLoading, setIsLoading] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  
  // Form state
  const [language, setLanguage] = useState('pt-br');
  const [country, setCountry] = useState('Brazil');
  const [status, setStatus] = useState('rejected');
  const [scoreRange, setScoreRange] = useState([0, 60]);
  const [limit, setLimit] = useState(50);
  const [autoGenerateAudio, setAutoGenerateAudio] = useState(true);
  
  // Data state
  const [pois, setPois] = useState<POI[]>([]);
  const [selectedPois, setSelectedPois] = useState<string[]>([]);
  const [processingQueue, setProcessingQueue] = useState<string[]>([]);
  const [processedCount, setProcessedCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);

  // Fetch POIs based on criteria
    const fetchPois = async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      let data: any[] = [];

      if (status === 'no_description') {
        // Use RPC function to find POIs without description
        console.log(`🔍 Using RPC function to find POIs without ${language} description in ${country}`);
        
        const { data: rpcData, error: rpcError } = await supabase
          .schema('core')
          .rpc('get_pois_without_description', {
            p_country: country,
            p_language: language,
            p_limit: limit
          });

        if (rpcError) {
          console.error('❌ RPC function error:', rpcError);
          throw rpcError;
        }

        console.log(`✅ Found ${rpcData?.length || 0} POIs without description`);
        data = rpcData || [];

      } else {
        // Use normal query for other statuses
        let query = supabase
          .schema('core')
          .from('attractions')
          .select(`
            id,
            name,
            city,
            country,
            descriptions:attraction_descriptions!left(
              id,
              language,
              description,
              verification_status,
              audio_url
            )
          `)
          .eq('country', country)
          .eq('descriptions.language', language)
          .limit(limit);

        if (status !== 'all') {
          query = query.eq('descriptions.verification_status', status);
        }

        const { data: queryData, error } = await query;
        if (error) throw error;
        data = queryData || [];
      }

      // Filter POIs based on status and score criteria
      const filteredPois = data.filter(poi => {
        if (status === 'no_description') {
          // For no_description, all POIs from RPC function don't have descriptions
          return true;
        } else {
          // For other statuses, check if they have a description
          const ptBrDescription = poi.descriptions?.find((desc: any) => 
            desc.language === language && desc.description && desc.description.trim()
          );
          
          if (!ptBrDescription) return false;
          
          // For now, we'll use the status as a proxy for score
          // In a real implementation, you'd join with description_scores table
          const score = status === 'rejected' ? 30 : status === 'pending' ? 60 : 80;
          return score >= scoreRange[0] && score <= scoreRange[1];
        }
      });

      setPois(filteredPois);
      setTotalCount(filteredPois.length);
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

  // Process selected POIs
  const processSelectedPois = async () => {
    if (selectedPois.length === 0) {
      setError('Please select at least one POI to process');
      return;
    }

    setIsProcessing(true);
    setError(null);
    setSuccess(null);
    setProcessedCount(0);
    setProcessingQueue([...selectedPois]);

    for (const poiId of selectedPois) {
      try {
        const poi = pois.find(p => p.id === poiId);
        if (!poi) continue;

        const ptBrDescription = poi.descriptions?.find((desc: any) => 
          desc.language === language && desc.description && desc.description.trim()
        );

        // Prepare request body based on whether POI has description or not
        let requestBody: any = {
          id: poi.id,
          name: poi.name,
          city: poi.city,
          country: poi.country,
          persist_verification: true,
          auto_generate_audio: autoGenerateAudio
        };

        if (ptBrDescription) {
          // POI has description - improve existing one
          requestBody.existing_description = ptBrDescription.description;
          requestBody.description_id = ptBrDescription.id;
          console.log(`🔄 Improving existing description for ${poi.name}`);
        } else {
          // POI has no description - generate new one
          console.log(`🆕 Generating new description for ${poi.name}`);
        }

        // Generate or improve description
        const response = await fetch('/api/descriptions/generate-optimized', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
          console.error(`Failed to process POI ${poi.name}:`, await response.text());
          continue;
        }

        const result = await response.json();
        
        // Audio generation is now handled automatically by the API when auto_generate_audio is true
        console.log('Audio generation status:', result.audio_generation);
        
        // Log detailed audio generation info
        if (result.audio_generation) {
          if (result.audio_generation.auto_generated) {
            console.log(`✅ Audio generated for ${result.audio_generation.languages.join(', ')}`);
          } else if (result.verification?.score) {
            console.log(`❌ Audio not generated - Score ${result.verification.score}% is below 75% threshold (>=75 required)`);
          }
        }

        setProcessedCount(prev => prev + 1);
        setProcessingQueue(prev => prev.filter(id => id !== poiId));
        
      } catch (err) {
        console.error(`Error processing POI ${poiId}:`, err);
      }
    }

    setIsProcessing(false);
    setSuccess(`Successfully processed ${processedCount} POIs`);
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

  return (
    <div className="container mx-auto py-6">
      <h1 className="text-3xl font-bold mb-6">Improve Descriptions & Generate Audio</h1>
      
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Parameters Card */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold mb-4">Search Parameters</h2>
          <p className="text-gray-600 mb-4">
            Configure the parameters to find POIs that need improvement or initial description generation
          </p>
          {status === 'no_description' && (
            <div className="bg-blue-50 border border-blue-200 text-blue-700 px-3 py-2 rounded mb-4">
              <p className="text-sm">
                <strong>No Description:</strong> Find POIs without descriptions in the selected language. 
                These will get new descriptions following our established guidelines.
              </p>
            </div>
          )}
          
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="language" className="block text-sm font-medium text-gray-700">
                Language
              </label>
              <select
                id="language"
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                disabled={isLoading}
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-tuggi-blue focus:border-tuggi-blue"
              >
                <option value="pt-br">Portuguese (Brazil)</option>
                <option value="en">English</option>
                <option value="es">Spanish</option>
              </select>
            </div>
            
            <div className="space-y-2">
              <label htmlFor="country" className="block text-sm font-medium text-gray-700">
                Country
              </label>
              <select
                id="country"
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                disabled={isLoading}
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-tuggi-blue focus:border-tuggi-blue"
              >
                <option value="Brazil">Brazil</option>
                <option value="Spain">Spain</option>
                <option value="United States">United States</option>
                <option value="Ireland">Ireland</option>
              </select>
            </div>
            
            <div className="space-y-2">
              <label htmlFor="status" className="block text-sm font-medium text-gray-700">
                Description Status
              </label>
              <select
                id="status"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                disabled={isLoading}
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-tuggi-blue focus:border-tuggi-blue"
              >
                <option value="no_description">No Description</option>
                <option value="rejected">Rejected</option>
                <option value="pending">Pending</option>
                <option value="approved">Approved</option>
                <option value="all">All Statuses</option>
              </select>
            </div>
            
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700">
                Score Range: {scoreRange[0]}% - {scoreRange[1]}%
              </label>
              <div className="flex items-center gap-4">
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={scoreRange[0]}
                  onChange={(e) => setScoreRange([parseInt(e.target.value), scoreRange[1]])}
                  className="w-full"
                  disabled={isLoading}
                />
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={scoreRange[1]}
                  onChange={(e) => setScoreRange([scoreRange[0], parseInt(e.target.value)])}
                  className="w-full"
                  disabled={isLoading}
                />
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
                max={1000}
                value={limit}
                onChange={(e) => setLimit(Number(e.target.value))}
                disabled={isLoading}
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-tuggi-blue focus:border-tuggi-blue"
              />
            </div>

            <div className="space-y-2">
              <label className="flex items-center">
                <input
                  type="checkbox"
                  checked={autoGenerateAudio}
                  onChange={(e) => setAutoGenerateAudio(e.target.checked)}
                  className="rounded border-gray-300 text-tuggi-blue focus:ring-tuggi-blue mr-2"
                />
                <span className="text-sm font-medium text-gray-700">
                  Auto-generate audio when approved (&gt;=75% score)
                </span>
              </label>
              <p className="text-xs text-gray-500 ml-6">
                Only generates audio for descriptions with score &gt;= 75% (PT, EN, ES)
              </p>
              <p className="text-xs text-blue-600 ml-6 mt-1">
                ✨ POIs will be automatically approved when all conditions are met
              </p>
            </div>
            
            <button
              type="submit"
              disabled={isLoading}
              className="w-full bg-tuggi-blue text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {isLoading ? (
                <>
                  <Loader2 className="inline-block mr-2 h-4 w-4 animate-spin" />
                  Searching...
                </>
              ) : (
                status === 'no_description' ? 'Find POIs Without Description' : 'Search POIs'
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
                        Processing...
                      </>
                    ) : (
                      status === 'no_description' 
                        ? `Generate Descriptions for ${selectedPois.length} Selected`
                        : `Process ${selectedPois.length} Selected`
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
              {autoGenerateAudio && (
                <p className="text-xs mt-1 text-green-600">
                  Audio will be generated automatically for descriptions with score &gt;= 75% (PT, EN, ES)
                </p>
              )}
            </div>
          )}

          {isProcessing && (
            <div className="bg-blue-50 border border-blue-200 text-blue-700 px-4 py-3 rounded mb-4">
              <div className="flex items-center">
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                <span className="font-medium">Processing</span>
              </div>
              <p className="text-sm mt-1">
                Processed {processedCount} of {totalCount} POIs
                {processingQueue.length > 0 && ` (${processingQueue.length} remaining)`}
              </p>
            </div>
          )}
          
          {pois.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-center text-gray-500">
              <p>No POIs found matching the criteria</p>
              <p className="text-sm">Try adjusting your search parameters</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {pois.map((poi) => {
                const ptBrDescription = poi.descriptions?.find((desc: any) => 
                  desc.language === language && desc.description && desc.description.trim()
                );
                const isSelected = selectedPois.includes(poi.id);
                const isProcessing = processingQueue.includes(poi.id);
                
                return (
                  <div
                    key={poi.id}
                    className={cn(
                      "flex items-center gap-3 p-3 border rounded-lg cursor-pointer transition-colors",
                      isSelected 
                        ? "border-tuggi-blue bg-blue-50" 
                        : "border-gray-200 hover:border-gray-300",
                      isProcessing && "opacity-50"
                    )}
                    onClick={() => !isProcessing && togglePoiSelection(poi.id)}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => !isProcessing && togglePoiSelection(poi.id)}
                      disabled={isProcessing}
                      className="rounded border-gray-300 text-tuggi-blue focus:ring-tuggi-blue"
                    />
                    
                    <div className="flex-1 min-w-0">
                      <h3 className="font-medium text-gray-900 truncate">{poi.name}</h3>
                      <p className="text-sm text-gray-500">{poi.city}, {poi.country}</p>
                      {ptBrDescription ? (
                        <p className="text-xs text-gray-400 mt-1 truncate">
                          {ptBrDescription.description.substring(0, 100)}...
                        </p>
                      ) : (
                        <p className="text-xs text-orange-500 mt-1 font-medium">
                          ⚠️ No description available
                        </p>
                      )}
                    </div>
                    
                    <div className="flex items-center gap-2">
                      {isProcessing && (
                        <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
                      )}
                      <span className={cn(
                        "px-2 py-1 text-xs rounded-full",
                        status === 'rejected' 
                          ? "bg-red-100 text-red-800" 
                          : "bg-yellow-100 text-yellow-800"
                      )}>
                        {status}
                      </span>
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