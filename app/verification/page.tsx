'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';
import { VerificationDrawer } from '@/components/verification/VerificationDrawer';
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
        .order('last_processed_at', { ascending: false });

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
          const score = desc.last_overall_score || 0;
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

  const handleScheduleVerification = async () => {
    setProcessing(true);
    try {
      const response = await fetch('/api/verify/schedule', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ batch: 20 }),
      });

      const result = await response.json();

      if (response.ok) {
        alert(`Scheduled ${result.scheduled} descriptions for verification`);
        loadDescriptions();
      } else {
        alert(`Error: ${result.error}`);
      }
    } catch (error) {
      console.error('Error scheduling verification:', error);
      alert('Error scheduling verification');
    } finally {
      setProcessing(false);
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
        alert(`Reprocessed ${result.processed} descriptions`);
        loadDescriptions();
      } else {
        alert(`Error: ${result.error}`);
      }
    } catch (error) {
      console.error('Error reprocessing:', error);
      alert('Error reprocessing descriptions');
    } finally {
      setProcessing(false);
    }
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
        return 'Aprovado';
      case 'needs_review':
        return 'Revisão Necessária';
      case 'rejected':
        return 'Rejeitado';
      default:
        return 'Pendente';
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Verificação de Descrições</h1>
          <p className="mt-2 text-gray-600">
            Gerencie a verificação factual das descrições originais
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
                <option value="all">Todos os Status</option>
                <option value="pending">Pendente</option>
                <option value="verified">Verificado</option>
                <option value="needs_review">Revisão Necessária</option>
                <option value="rejected">Rejeitado</option>
              </select>

              {/* Score Filter */}
              <select
                value={filters.score_range}
                onChange={(e) => setFilters(prev => ({ ...prev, score_range: e.target.value }))}
                className="border border-gray-300 rounded-md px-3 py-2 text-sm"
              >
                <option value="all">Todos os Scores</option>
                <option value="excellent">Excelente (≥0.9)</option>
                <option value="good">Bom (0.7-0.9)</option>
                <option value="acceptable">Aceitável (0.5-0.7)</option>
                <option value="poor">Ruim (&lt;0.5)</option>
              </select>

              {/* Original Filter */}
              <select
                value={filters.is_original}
                onChange={(e) => setFilters(prev => ({ ...prev, is_original: e.target.value }))}
                className="border border-gray-300 rounded-md px-3 py-2 text-sm"
              >
                <option value="all">Todas as Descrições</option>
                <option value="true">Apenas Originais</option>
                <option value="false">Apenas Traduzidas</option>
              </select>
            </div>

            <div className="flex gap-2">
              <button
                onClick={handleScheduleVerification}
                disabled={processing}
                className="bg-blue-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
              >
                {processing ? 'Processando...' : 'Agendar Verificação'}
              </button>
            </div>
          </div>
        </div>

        {/* Statistics */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-white rounded-lg shadow p-4">
            <h3 className="text-sm font-medium text-gray-500">Total</h3>
            <p className="text-2xl font-bold text-gray-900">{descriptions.length}</p>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <h3 className="text-sm font-medium text-gray-500">Verificadas</h3>
            <p className="text-2xl font-bold text-green-600">
              {descriptions.filter(d => d.verification_status === 'approved').length}
            </p>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <h3 className="text-sm font-medium text-gray-500">Revisão Necessária</h3>
            <p className="text-2xl font-bold text-yellow-600">
              {descriptions.filter(d => d.verification_status === 'needs_review').length}
            </p>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <h3 className="text-sm font-medium text-gray-500">Rejeitadas</h3>
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
              <p className="mt-2 text-gray-600">Carregando descrições...</p>
            </div>
          ) : descriptions.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-gray-600">Nenhuma descrição encontrada</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Atração
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Descrição
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
                      Última Verificação
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Ações
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {descriptions.map((description) => (
                    <tr key={description.id} className="hover:bg-gray-50">
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
                          {description.is_original ? 'Original' : 'Traduzida'} • {description.language}
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
                          Verificar
                        </button>
                                                 <button
                           onClick={() => handleReprocess([description.description_id])}
                          disabled={processing}
                          className="text-gray-600 hover:text-gray-900 disabled:opacity-50"
                        >
                          Reprocessar
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
