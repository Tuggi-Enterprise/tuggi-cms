'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';
import { VerificationDrawer } from '@/components/verification/VerificationDrawer';
import { BatchProgressBar } from '@/components/verification/BatchProgressBar';
import { getScoreDescription, getScoreColor, getScoreBackgroundColor } from '@/lib/score/compute';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

interface DescriptionWithScore {
  description_id: string;
  attraction_id: string;
  attraction_name: string;
  city: string;
  country: string;
  language: string;
  gender: string;
  is_original: boolean;
  description: string;
  audio_url: string | null;
  play_count: number;
  last_played_at: string | null;
  updated_at: string;
  verification_status: 'pending' | 'approved' | 'needs_review' | 'rejected';
  last_score_overall: number | null;
  last_score_version: string | null;
  last_verified_at: string | null;
}

export default function VerificationPage() {
  const [descriptions, setDescriptions] = useState<DescriptionWithScore[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDescription, setSelectedDescription] = useState<DescriptionWithScore | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [filters, setFilters] = useState({
    verification_status: 'all',
    score_range: 'all',
    is_original: 'all'
  });
  const [processing, setProcessing] = useState(false);
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);

  useEffect(() => {
    loadDescriptions();
  }, [filters]);

  const loadDescriptions = async () => {
    setLoading(true);
    try {
      let query = supabase
        .schema('core')
        .from('v_descriptions_with_last_score')
        .select('*')
        .eq('is_original', true) // Only original descriptions
        .order('last_verified_at', { ascending: false })
        .limit(1000); // Load up to 1000 items

      // Apply filters
      if (filters.verification_status !== 'all') {
        query = query.eq('verification_status', filters.verification_status);
      }
      if (filters.is_original !== 'all') {
        query = query.eq('is_original', filters.is_original === 'true');
      }

      const { data, error } = await query;

      if (error) {
        console.error('Error loading descriptions:', error);
        return;
      }

      let filteredData = data || [];

      // Apply score range filter
      if (filters.score_range !== 'all') {
        filteredData = filteredData.filter(desc => {
          const score = (desc.last_score_overall || 0) / 100; // Convert from 0-100 to 0-1
          switch (filters.score_range) {
            case 'excellent':
              return score >= 0.9;
            case 'good':
              return score >= 0.7 && score < 0.9;
            case 'acceptable':
              return score >= 0.5 && score < 0.7;
            case 'poor':
              return score < 0.5;
            default:
              return true;
          }
        });
      }

      setDescriptions(filteredData);
    } catch (error) {
      console.error('Error loading descriptions:', error);
    } finally {
      setLoading(false);
    }
  };



  const handleReprocess = async (descriptionIds: string[]) => {
    setProcessing(true);
    try {
      const response = await fetch('/api/verify/reprocess', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ description_ids: descriptionIds }),
      });

      const result = await response.json();

      if (response.ok) {
        alert(`Reprocessed ${result.successful} descriptions successfully${result.failed > 0 ? `, ${result.failed} failed` : ''}`);
        loadDescriptions();
      } else {
        alert(`Erro: ${result.error}`);
      }
    } catch (error) {
      console.error('Error reprocessing:', error);
      alert('Error reprocessing descriptions');
    } finally {
      setProcessing(false);
    }
  };

  const handleScheduleBatch = async (batchSize: number = 20) => {
    console.log(`🚀 Starting batch processing for ${batchSize} items...`);
    setProcessing(true);
    try {
      const response = await fetch('/api/verify/schedule', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ batch: batchSize }),
      });

      const result = await response.json();
      console.log('📡 Full API Response:', result);

      if (response.ok) {
        console.log('✅ API Response:', result);
        // Se retornou um job_id, mostrar barra de progresso
        if (result.job_id) {
          console.log(`🎯 Setting currentJobId: ${result.job_id}`);
          setCurrentJobId(result.job_id);
          console.log(`Batch job started: ${result.job_id}`);
        } else {
          console.log('❌ No job_id returned from API');
          alert(`Scheduled ${result.scheduled} verifications${result.failed > 0 ? `, ${result.failed} failed` : ''}\nFound: ${result.found_processable}\nEfficiency: ${result.query_efficiency}`);
        }
        loadDescriptions();
      } else {
        console.error('❌ API Error:', result);
        alert(`Error: ${result.error}`);
      }
    } catch (error) {
      console.error('Error scheduling verification:', error);
      alert('Error scheduling verification');
    } finally {
      setProcessing(false);
    }
  };

  const handleJobComplete = () => {
    setCurrentJobId(null);
    loadDescriptions();
  };

  const openVerificationDrawer = (description: DescriptionWithScore) => {
    setSelectedDescription(description);
    setIsDrawerOpen(true);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'approved':
        return 'text-green-600 bg-green-100';
      case 'needs_review':
        return 'text-yellow-600 bg-yellow-100';
      case 'rejected':
        return 'text-red-600 bg-red-100';
      default:
        return 'text-gray-600 bg-gray-100';
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'approved':
        return 'Approved';
      case 'needs_review':
        return 'Needs Review';
      case 'rejected':
        return 'Rejected';
      default:
        return 'Pending';
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Description Verification</h1>
          <p className="mt-2 text-gray-600">
            Manage factual verification of original descriptions
          </p>
        </div>

        {/* Controls */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <div className="flex flex-wrap gap-4 items-center justify-between">
            <div className="flex flex-wrap gap-4">
              {/* Status Filter */}
              <select
                value={filters.verification_status}
                onChange={(e) => setFilters(prev => ({ ...prev, verification_status: e.target.value }))}
                className="border border-gray-300 rounded-md px-3 py-2 text-sm"
              >
                <option value="all">All Status</option>
                <option value="pending">Pending</option>
                <option value="approved">Approved</option>
                <option value="needs_review">Needs Review</option>
                <option value="rejected">Rejected</option>
              </select>

              {/* Score Filter */}
              <select
                value={filters.score_range}
                onChange={(e) => setFilters(prev => ({ ...prev, score_range: e.target.value }))}
                className="border border-gray-300 rounded-md px-3 py-2 text-sm"
              >
                <option value="all">All Scores</option>
                <option value="excellent">Excellent (≥90%)</option>
                <option value="good">Good (70-89%)</option>
                <option value="acceptable">Acceptable (50-69%)</option>
                <option value="poor">Poor (&lt;50%)</option>
              </select>

              {/* Original Filter */}
              <select
                value={filters.is_original}
                onChange={(e) => setFilters(prev => ({ ...prev, is_original: e.target.value }))}
                className="border border-gray-300 rounded-md px-3 py-2 text-sm"
              >
                <option value="all">All Descriptions</option>
                <option value="true">Original Only</option>
                <option value="false">Translated Only</option>
              </select>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => handleScheduleBatch(10)}
                disabled={processing}
                className="bg-green-600 text-white px-3 py-2 rounded-md text-sm font-medium hover:bg-green-700 disabled:opacity-50"
              >
                {processing ? 'Processing...' : 'Schedule 10'}
              </button>
              <button
                onClick={() => handleScheduleBatch(50)}
                disabled={processing}
                className="bg-blue-600 text-white px-3 py-2 rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
              >
                {processing ? 'Processing...' : 'Schedule 50'}
              </button>
              <button
                onClick={() => handleScheduleBatch(100)}
                disabled={processing}
                className="bg-purple-600 text-white px-3 py-2 rounded-md text-sm font-medium hover:bg-purple-700 disabled:opacity-50"
              >
                {processing ? 'Processing...' : 'Schedule 100'}
              </button>
              <button
                onClick={() => handleScheduleBatch(1000)}
                disabled={processing}
                className="bg-orange-600 text-white px-3 py-2 rounded-md text-sm font-medium hover:bg-orange-700 disabled:opacity-50"
              >
                {processing ? 'Processing...' : 'Schedule 1000'}
              </button>
            </div>
          </div>
        </div>

        {/* Progress Bar */}
        {currentJobId && (
          <BatchProgressBar 
            jobId={currentJobId} 
            onJobComplete={handleJobComplete}
          />
        )}

        {/* Statistics */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-white rounded-lg shadow p-4">
            <h3 className="text-sm font-medium text-gray-500">Total</h3>
            <p className="text-2xl font-bold text-gray-900">{descriptions.length}</p>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <h3 className="text-sm font-medium text-gray-500">Approved</h3>
            <p className="text-2xl font-bold text-green-600">
              {descriptions.filter(d => d.verification_status === 'approved').length}
            </p>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <h3 className="text-sm font-medium text-gray-500">Needs Review</h3>
            <p className="text-2xl font-bold text-yellow-600">
              {descriptions.filter(d => d.verification_status === 'needs_review').length}
            </p>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <h3 className="text-sm font-medium text-gray-500">Rejected</h3>
            <p className="text-2xl font-bold text-red-600">
              {descriptions.filter(d => d.verification_status === 'rejected').length}
            </p>
          </div>
        </div>

        {/* Descriptions List */}
        <div className="bg-white rounded-lg shadow overflow-hidden">
          {loading ? (
            <div className="p-8 text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
              <p className="mt-2 text-gray-600">Loading descriptions...</p>
            </div>
          ) : descriptions.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-gray-600">No descriptions found</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Attraction
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Description
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Score
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Claims
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Last Verification
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {descriptions.map((description) => (
                    <tr key={description.description_id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div>
                          <div className="text-sm font-medium text-gray-900">
                            {description.attraction_name}
                          </div>
                          <div className="text-sm text-gray-500">
                            {description.city}, {description.country}
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-sm text-gray-900 max-w-xs truncate">
                          {description.description}
                        </div>
                        <div className="text-xs text-gray-500 mt-1">
                          {description.is_original ? 'Original' : 'Translated'} • {description.language}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getStatusColor(description.verification_status)}`}>
                          {getStatusText(description.verification_status)}
                        </span>
                      </td>
                                             <td className="px-6 py-4 whitespace-nowrap">
                         {description.last_score_overall !== null ? (
                           <div>
                             <span className={`text-sm font-medium ${getScoreColor(description.last_score_overall / 100)}`}>
                               {description.last_score_overall}%
                             </span>
                             <div className="text-xs text-gray-500">
                               {getScoreDescription(description.last_score_overall / 100)}
                             </div>
                           </div>
                         ) : (
                           <span className="text-sm text-gray-500">N/A</span>
                         )}
                       </td>
                                             <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                         <span className="text-gray-500">N/A</span>
                       </td>
                                             <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                         {description.last_verified_at ? (
                           new Date(description.last_verified_at).toLocaleDateString('pt-BR')
                         ) : (
                           'Nunca'
                         )}
                       </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                        <button
                          onClick={() => openVerificationDrawer(description)}
                          className="text-blue-600 hover:text-blue-900 mr-2"
                        >
                          Verify
                        </button>
                                                 <button
                           onClick={() => handleReprocess([description.description_id])}
                          disabled={processing}
                          className="text-gray-600 hover:text-gray-900 disabled:opacity-50"
                        >
                          Reprocess
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Verification Drawer */}
      {selectedDescription && (
        <VerificationDrawer
          description={selectedDescription}
          isOpen={isDrawerOpen}
          onClose={() => {
            setIsDrawerOpen(false);
            setSelectedDescription(null);
          }}
          onReprocess={() => handleReprocess([selectedDescription.description_id])}
        />
      )}
    </div>
  );
}
