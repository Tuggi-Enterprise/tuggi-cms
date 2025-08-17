'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

interface BatchJobProgress {
  job_id: string;
  user_email: string;
  batch_size: number;
  total_items: number;
  processed_items: number;
  failed_items: number;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  started_at: string;
  completed_at: string | null;
  progress_percentage: number;
  estimated_seconds_remaining: number | null;
  items_per_minute: number;
}

interface BatchProgressBarProps {
  jobId: string | null;
  onJobComplete?: () => void;
}

export function BatchProgressBar({ jobId, onJobComplete }: BatchProgressBarProps) {
  console.log('🎨 BatchProgressBar rendered with jobId:', jobId);
  const [progress, setProgress] = useState<BatchJobProgress | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!jobId) return;

    // Função para buscar progresso
    const fetchProgress = async () => {
      console.log(`🔍 Fetching progress for jobId: ${jobId}`);
      try {
        const response = await fetch(`/api/verify/progress/${jobId}`);
        console.log(`📡 Progress API response status: ${response.status}`);
        
        if (!response.ok) {
          console.error('Error fetching progress:', response.statusText);
          return;
        }

        const data = await response.json();
        console.log('📊 Progress data received:', data);
        setProgress(data);

        // Se o job foi completado, chamar callback
        if (data.status === 'completed' && onJobComplete) {
          console.log('✅ Job completed, calling onJobComplete');
          onJobComplete();
        }
      } catch (error) {
        console.error('Error fetching progress:', error);
      }
    };

    // Buscar progresso inicial
    fetchProgress();

    // Polling a cada 2 segundos se o job ainda está rodando
    const interval = setInterval(() => {
      if (progress?.status === 'running') {
        fetchProgress();
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [jobId, progress?.status, onJobComplete]);

  if (!jobId) {
    console.log('❌ BatchProgressBar: No jobId provided');
    return null;
  }
  
  if (!progress) {
    console.log('⏳ BatchProgressBar: Loading progress for jobId:', jobId);
    return (
      <div className="bg-white rounded-lg shadow p-4 mb-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-medium text-gray-900">
            Batch Processing Progress
          </h3>
          <span className="inline-flex px-2 py-1 text-xs font-semibold rounded-full bg-gray-600 text-white">
            Loading...
          </span>
        </div>
        <div className="text-sm text-gray-600">Loading progress for job: {jobId}</div>
      </div>
    );
  }

  const formatTime = (seconds: number | null) => {
    if (!seconds) return 'Calculating...';
    
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    
    if (hours > 0) {
      return `${hours}h ${minutes}m ${secs}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${secs}s`;
    } else {
      return `${secs}s`;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'running':
        return 'bg-blue-600';
      case 'completed':
        return 'bg-green-600';
      case 'failed':
        return 'bg-red-600';
      case 'cancelled':
        return 'bg-gray-600';
      default:
        return 'bg-gray-600';
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'running':
        return 'Processing...';
      case 'completed':
        return 'Completed';
      case 'failed':
        return 'Failed';
      case 'cancelled':
        return 'Cancelled';
      default:
        return status;
    }
  };

  return (
    <div className="bg-white rounded-lg shadow p-4 mb-6">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-lg font-medium text-gray-900">
          Batch Processing Progress
        </h3>
        <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getStatusColor(progress.status)} text-white`}>
          {getStatusText(progress.status)}
        </span>
      </div>

      {/* Progress Bar */}
      <div className="mb-4">
        <div className="flex justify-between text-sm text-gray-600 mb-1">
          <span>Progress</span>
          <span>{progress.progress_percentage.toFixed(1)}%</span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2">
          <div 
            className={`h-2 rounded-full transition-all duration-300 ${getStatusColor(progress.status)}`}
            style={{ width: `${progress.progress_percentage}%` }}
          ></div>
        </div>
      </div>

      {/* Statistics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
        <div>
          <div className="text-gray-500">Processed</div>
          <div className="font-semibold text-green-600">{progress.processed_items}</div>
        </div>
        <div>
          <div className="text-gray-500">Failed</div>
          <div className="font-semibold text-red-600">{progress.failed_items}</div>
        </div>
        <div>
          <div className="text-gray-500">Total</div>
          <div className="font-semibold">{progress.total_items}</div>
        </div>
        <div>
          <div className="text-gray-500">Rate</div>
          <div className="font-semibold">{progress.items_per_minute.toFixed(1)}/min</div>
        </div>
      </div>

      {/* Time Estimates */}
      {progress.status === 'running' && (
        <div className="mt-3 pt-3 border-t border-gray-200">
          <div className="flex justify-between text-sm text-gray-600">
            <span>Started</span>
            <span>{new Date(progress.started_at).toLocaleTimeString()}</span>
          </div>
          {progress.estimated_seconds_remaining && (
            <div className="flex justify-between text-sm text-gray-600">
              <span>Estimated time remaining</span>
              <span>{formatTime(progress.estimated_seconds_remaining)}</span>
            </div>
          )}
        </div>
      )}

      {/* Completion Info */}
      {progress.status === 'completed' && progress.completed_at && (
        <div className="mt-3 pt-3 border-t border-gray-200">
          <div className="flex justify-between text-sm text-gray-600">
            <span>Completed at</span>
            <span>{new Date(progress.completed_at).toLocaleTimeString()}</span>
          </div>
          <div className="flex justify-between text-sm text-gray-600">
            <span>Duration</span>
            <span>{formatTime(
              (new Date(progress.completed_at).getTime() - new Date(progress.started_at).getTime()) / 1000
            )}</span>
          </div>
        </div>
      )}
    </div>
  );
}
