'use client';

import { useState, useEffect } from 'react';
import { CheckCircle, XCircle, Clock, AlertTriangle, RefreshCw, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface VerificationData {
  verification_status: 'pending' | 'approved' | 'needs_review' | 'rejected' | null;
  score: number | null;
  last_verified_at: string | null;
  is_original: boolean;
  language: string;
}

interface VerificationBadgeProps {
  descriptionId?: string;
  attractionId?: string;
  data?: VerificationData;
  verificationData?: VerificationData; // New prop for pre-loaded data
  size?: 'sm' | 'md' | 'lg';
  showScore?: boolean;
  showVerifyButton?: boolean;
  onVerificationComplete?: () => void;
}

export function VerificationBadge({ 
  descriptionId, 
  attractionId, 
  data, 
  verificationData: preloadedData,
  size = 'sm', 
  showScore = true,
  showVerifyButton = false,
  onVerificationComplete 
}: VerificationBadgeProps) {
  const [isClient, setIsClient] = useState(false);
  const [verificationData, setVerificationData] = useState<VerificationData | null>(
    data || preloadedData || null
  );
  const [isLoading, setIsLoading] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);

  // Only render on client side
  useEffect(() => {
    setIsClient(true);
  }, []);

  // Update verification data when preloaded data changes
  useEffect(() => {
    if (preloadedData) {
      setVerificationData(preloadedData);
      setIsLoading(false);
    }
  }, [preloadedData]);

  // Fetch verification data if not provided and no preloaded data
  useEffect(() => {
    if (isClient && !data && !preloadedData && (descriptionId || attractionId)) {
      fetchVerificationData();
    }
  }, [isClient, descriptionId, attractionId, data, preloadedData]);

  const fetchVerificationData = async () => {
    if (!descriptionId && !attractionId) return;

    setIsLoading(true);
    try {
      const response = await fetch('/api/verify/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          description_id: descriptionId,
          attraction_id: attractionId 
        })
      });

      if (response.ok) {
        const data = await response.json();
        setVerificationData(data);
      }
    } catch (error) {
      console.error('Error fetching verification data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerify = async () => {
    if (!descriptionId) return;

    setIsVerifying(true);
    try {
      const response = await fetch('/api/verify/individual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description_id: descriptionId })
      });

      if (response.ok) {
        const result = await response.json();
        await fetchVerificationData(); // Refresh data
        onVerificationComplete?.();
      } else {
        const error = await response.json();
        console.error('Verification failed:', error);
      }
    } catch (error) {
      console.error('Error verifying:', error);
    } finally {
      setIsVerifying(false);
    }
  };

  if (isLoading) {
    return (
      <div className={cn(
        'inline-flex items-center px-2 py-1 rounded-full',
        size === 'sm' && 'text-xs',
        size === 'md' && 'text-sm',
        size === 'lg' && 'text-base'
      )}>
        <Loader2 className="h-3 w-3 animate-spin text-gray-400" />
      </div>
    );
  }

  if (!verificationData) {
    return (
      <div className={cn(
        'inline-flex items-center px-2 py-1 rounded-full bg-gray-100 text-gray-500',
        size === 'sm' && 'text-xs',
        size === 'md' && 'text-sm',
        size === 'lg' && 'text-base'
      )}>
        <AlertTriangle className="h-3 w-3 mr-1" />
        No Data
      </div>
    );
  }

  // Only show for original Portuguese descriptions
  if (!verificationData.is_original || verificationData.language !== 'pt-br') {
    return null;
  }

  const getStatusConfig = (status: string | null, score: number | null) => {
    switch (status) {
      case 'approved':
        return {
          icon: CheckCircle,
          label: 'Approved',
          bgColor: 'bg-green-100 dark:bg-green-900/20',
          textColor: 'text-green-800 dark:text-green-300',
          borderColor: 'border-green-200 dark:border-green-800'
        };
      case 'needs_review':
        return {
          icon: AlertTriangle,
          label: 'Review',
          bgColor: 'bg-yellow-100 dark:bg-yellow-900/20',
          textColor: 'text-yellow-800 dark:text-yellow-300',
          borderColor: 'border-yellow-200 dark:border-yellow-800'
        };
      case 'rejected':
        return {
          icon: XCircle,
          label: 'Rejected',
          bgColor: 'bg-red-100 dark:bg-red-900/20',
          textColor: 'text-red-800 dark:text-red-300',
          borderColor: 'border-red-200 dark:border-red-800'
        };
      default:
        return {
          icon: Clock,
          label: 'Pending',
          bgColor: 'bg-gray-100 dark:bg-gray-700',
          textColor: 'text-gray-600 dark:text-gray-400',
          borderColor: 'border-gray-200 dark:border-gray-600'
        };
    }
  };

  // Don't render on server side
  if (!isClient) {
    return null;
  }

  const config = getStatusConfig(verificationData.verification_status, verificationData.score);
  const Icon = config.icon;

  return (
    <div 
      className="flex items-center gap-2"
      data-verification-badge="true"
      data-attraction-id={attractionId}
      data-description-id={descriptionId}
      data-score={verificationData?.score}
      data-status={verificationData?.verification_status}
    >
      <div className={cn(
        'inline-flex items-center px-2 py-1 rounded-full border',
        config.bgColor,
        config.textColor,
        config.borderColor,
        size === 'sm' && 'text-xs',
        size === 'md' && 'text-sm',
        size === 'lg' && 'text-base'
      )}>
        <Icon className={cn(
          'mr-1',
          size === 'sm' && 'h-3 w-3',
          size === 'md' && 'h-4 w-4',
          size === 'lg' && 'h-5 w-5'
        )} />
        {config.label}
        {showScore && verificationData.score !== null && (
          <span className="ml-1 font-medium">
            {verificationData.score}%
          </span>
        )}
      </div>

      {showVerifyButton && verificationData.verification_status !== 'approved' && (
        <button
          onClick={handleVerify}
          disabled={isVerifying}
          className={cn(
            'inline-flex items-center px-2 py-1 rounded border border-tuggi-blue text-tuggi-blue hover:bg-tuggi-blue hover:text-white transition-colors',
            size === 'sm' && 'text-xs',
            size === 'md' && 'text-sm',
            size === 'lg' && 'text-base',
            isVerifying && 'opacity-50 cursor-not-allowed'
          )}
        >
          {isVerifying ? (
            <Loader2 className="h-3 w-3 animate-spin mr-1" />
          ) : (
            <RefreshCw className="h-3 w-3 mr-1" />
          )}
          Verify
        </button>
      )}
    </div>
  );
}
