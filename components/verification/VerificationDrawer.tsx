'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';
import { getScoreDescription, getScoreColor } from '@/lib/score/compute';

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

interface Claim {
  id: string;
  claim_type: string;
  slot: string;
  value: string;
  status: 'supported' | 'contradicted' | 'not_found' | 'needs_review';
  weight: number;
  created_at: string;
}

interface ClaimEvidence {
  id: string;
  source: string;
  page: string | null;
  url: string | null;
  quote: string;
  verdict: string;
  created_at: string;
}

interface VerificationDrawerProps {
  description: DescriptionWithScore;
  isOpen: boolean;
  onClose: () => void;
  onReprocess: () => void;
}

export function VerificationDrawer({ description, isOpen, onClose, onReprocess }: VerificationDrawerProps) {
  const [claims, setClaims] = useState<Claim[]>([]);
  const [selectedClaim, setSelectedClaim] = useState<Claim | null>(null);
  const [claimEvidence, setClaimEvidence] = useState<ClaimEvidence[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  useEffect(() => {
    if (isOpen && description.description_id) {
      loadClaims();
    }
  }, [isOpen, description.description_id]);

  const loadClaims = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .schema('core')
        .from('description_claims')
        .select('*')
        .eq('description_id', description.description_id)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error loading claims:', error);
        return;
      }

      setClaims(data || []);
    } catch (error) {
      console.error('Error loading claims:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadClaimEvidence = async (claimId: string) => {
    try {
      const { data, error } = await supabase
        .schema('core')
        .from('description_claim_evidence')
        .select('*')
        .eq('claim_id', claimId)
        .order('relevance_score', { ascending: false });

      if (error) {
        console.error('Error loading claim evidence:', error);
        return;
      }

      setClaimEvidence(data || []);
    } catch (error) {
      console.error('Error loading claim evidence:', error);
    }
  };

  const handleClaimClick = (claim: Claim) => {
    setSelectedClaim(claim);
    loadClaimEvidence(claim.id);
  };

  const handleApprove = async () => {
    setActionLoading(true);
    try {
      const { error } = await supabase
        .schema('core')
        .from('attraction_descriptions')
        .update({ 
          verification_status: 'approved',
          last_verified_at: new Date().toISOString()
        })
        .eq('id', description.description_id);

      if (error) {
        console.error('Error approving description:', error);
        alert('Error approving description');
      } else {
        alert('Description approved successfully');
        onClose();
      }
    } catch (error) {
      console.error('Error approving description:', error);
      alert('Error approving description');
    } finally {
      setActionLoading(false);
    }
  };

  const handleMarkForReview = async () => {
    setActionLoading(true);
    try {
      const { error } = await supabase
        .schema('core')
        .from('attraction_descriptions')
        .update({ 
          verification_status: 'needs_review',
          last_verified_at: new Date().toISOString()
        })
        .eq('id', description.description_id);

      if (error) {
        console.error('Error marking for review:', error);
        alert('Error marking for review');
      } else {
        alert('Description marked for review');
        onClose();
      }
    } catch (error) {
      console.error('Error marking for review:', error);
      alert('Error marking for review');
    } finally {
      setActionLoading(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'supported':
        return 'text-green-600 bg-green-100';
      case 'contradicted':
        return 'text-red-600 bg-red-100';
      case 'not_found':
        return 'text-gray-600 bg-gray-100';
      case 'needs_review':
        return 'text-yellow-600 bg-yellow-100';
      default:
        return 'text-gray-600 bg-gray-100';
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'supported':
        return 'Suportado';
      case 'contradicted':
        return 'Contradito';
      case 'not_found':
        return 'Não Encontrado';
      case 'needs_review':
        return 'Revisão Necessária';
      default:
        return 'Desconhecido';
    }
  };

  const getClaimTypeText = (type: string) => {
    switch (type) {
      case 'year':
        return 'Ano';
      case 'person':
        return 'Pessoa';
      case 'event':
        return 'Evento';
      case 'restoration':
        return 'Restauração';
      case 'location':
        return 'Localização';
      default:
        return 'Outro';
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-hidden">
      <div className="absolute inset-0 bg-gray-500 bg-opacity-75 transition-opacity" onClick={onClose}></div>
      
      <div className="fixed inset-y-0 right-0 pl-10 max-w-full flex">
        <div className="relative w-screen max-w-4xl">
          <div className="h-full flex flex-col bg-white shadow-xl">
            {/* Header */}
            <div className="px-6 py-4 border-b border-gray-200">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-medium text-gray-900">Verificação de Descrição</h2>
                <button
                  onClick={onClose}
                  className="text-gray-400 hover:text-gray-500"
                >
                  <span className="sr-only">Fechar</span>
                  <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto">
              <div className="px-6 py-4">
                {/* Description Info */}
                <div className="mb-6">
                  <h3 className="text-md font-medium text-gray-900 mb-2">Atração</h3>
                  <p className="text-sm text-gray-600 mb-4">
                    {description.attraction_name} • {description.city}, {description.country}
                  </p>
                  
                  <h3 className="text-md font-medium text-gray-900 mb-2">Descrição</h3>
                  <div className="bg-gray-50 rounded-md p-3 mb-4">
                    <p className="text-sm text-gray-800">{description.description}</p>
                  </div>
                </div>

                {/* Scores */}
                <div className="mb-6">
                  <h3 className="text-md font-medium text-gray-900 mb-3">Scores de Verificação</h3>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                         <div className="bg-gray-50 rounded-md p-3">
                       <div className="text-xs text-gray-500">Score Geral</div>
                       <div className={`text-lg font-semibold ${getScoreColor(description.last_score_overall ? description.last_score_overall / 100 : 0)}`}>
                         {description.last_score_overall ? `${description.last_score_overall}%` : 'N/A'}
                       </div>
                       <div className="text-xs text-gray-500">
                         {description.last_score_overall ? getScoreDescription(description.last_score_overall / 100) : ''}
                       </div>
                     </div>
                    
                                         <div className="bg-gray-50 rounded-md p-3">
                       <div className="text-xs text-gray-500">Factualidade</div>
                       <div className="text-lg font-semibold text-gray-600">N/A</div>
                     </div>
                     
                     <div className="bg-gray-50 rounded-md p-3">
                       <div className="text-xs text-gray-500">Coerência</div>
                       <div className="text-lg font-semibold text-gray-600">N/A</div>
                     </div>
                     
                     <div className="bg-gray-50 rounded-md p-3">
                       <div className="text-xs text-gray-500">Clareza TTS</div>
                       <div className="text-lg font-semibold text-gray-600">N/A</div>
                     </div>
                  </div>
                </div>

                {/* Claims */}
                <div className="mb-6">
                  <h3 className="text-md font-medium text-gray-900 mb-3">Claims Verificados</h3>
                  
                  {loading ? (
                    <div className="text-center py-4">
                      <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600 mx-auto"></div>
                      <p className="mt-2 text-sm text-gray-600">Carregando claims...</p>
                    </div>
                  ) : claims.length === 0 ? (
                    <p className="text-sm text-gray-600">Nenhum claim encontrado</p>
                  ) : (
                    <div className="space-y-3">
                      {claims.map((claim) => (
                        <div
                          key={claim.id}
                          className={`border rounded-md p-3 cursor-pointer transition-colors ${
                            selectedClaim?.id === claim.id ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'
                          }`}
                          onClick={() => handleClaimClick(claim)}
                        >
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                                                             <p className="text-sm font-medium text-gray-900 mb-1">{claim.value}</p>
                                                           <div className="flex items-center gap-2 text-xs text-gray-500">
                               <span>{getClaimTypeText(claim.claim_type)}</span>
                               <span>•</span>
                               <span>Confiança: {(claim.weight * 100).toFixed(0)}%</span>
                             </div>
                            </div>
                            <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getStatusColor(claim.status)}`}>
                              {getStatusText(claim.status)}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Claim Evidence */}
                {selectedClaim && (
                  <div className="mb-6">
                                         <h3 className="text-md font-medium text-gray-900 mb-3">
                       Evidências para: "{selectedClaim.value}"
                     </h3>
                    
                    {claimEvidence.length === 0 ? (
                      <p className="text-sm text-gray-600">Nenhuma evidência encontrada</p>
                    ) : (
                      <div className="space-y-3">
                        {claimEvidence.map((evidence) => (
                          <div key={evidence.id} className="border border-gray-200 rounded-md p-3">
                            <div className="flex items-start justify-between mb-2">
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-medium text-gray-500 uppercase">{evidence.source}</span>
                                <span className="text-xs text-gray-400">•</span>
                                                                 <span className="text-xs text-gray-500">
                                   Veredito: {evidence.verdict}
                                 </span>
                              </div>
                            </div>
                            
                                                         {evidence.page && (
                               <p className="text-sm font-medium text-gray-900 mb-1">{evidence.page}</p>
                             )}
                            
                            <p className="text-sm text-gray-700 mb-2">{evidence.quote}</p>
                            
                            {evidence.url && (
                              <a
                                href={evidence.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs text-blue-600 hover:text-blue-800"
                              >
                                Ver fonte →
                              </a>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-gray-200">
              <div className="flex items-center justify-between">
                <div className="flex gap-2">
                  <button
                    onClick={onReprocess}
                    disabled={actionLoading}
                    className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 border border-gray-300 rounded-md hover:bg-gray-200 disabled:opacity-50"
                  >
                    {actionLoading ? 'Processando...' : 'Reprocessar'}
                  </button>
                </div>
                
                <div className="flex gap-2">
                  <button
                    onClick={handleMarkForReview}
                    disabled={actionLoading}
                    className="px-4 py-2 text-sm font-medium text-yellow-700 bg-yellow-100 border border-yellow-300 rounded-md hover:bg-yellow-200 disabled:opacity-50"
                  >
                    {actionLoading ? 'Processando...' : 'Marcar para Revisão'}
                  </button>
                  
                  <button
                    onClick={handleApprove}
                    disabled={actionLoading}
                    className="px-4 py-2 text-sm font-medium text-white bg-green-600 border border-transparent rounded-md hover:bg-green-700 disabled:opacity-50"
                  >
                    {actionLoading ? 'Processando...' : 'Aprovar'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
