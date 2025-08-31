'use client';

import { useState, useEffect } from 'react';

interface BatchProgress {
  current: number;
  total: number;
  errors: number;
  currentPOI?: string;
}

interface BatchProgressBarProps {
  progress: BatchProgress;
  isActive: boolean;
}

export function BatchProgressBar({ progress, isActive }: BatchProgressBarProps) {
  const [timeElapsed, setTimeElapsed] = useState(0);
  const [estimatedTimeRemaining, setEstimatedTimeRemaining] = useState(0);

  useEffect(() => {
    if (!isActive) {
      setTimeElapsed(0);
      setEstimatedTimeRemaining(0);
      return;
    }

    const startTime = Date.now();
    const interval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      setTimeElapsed(elapsed);

      // Estimate remaining time based on current progress
      if (progress.current > 0 && progress.total > 0) {
        const avgTimePerPOI = elapsed / progress.current;
        const remaining = (progress.total - progress.current) * avgTimePerPOI;
        setEstimatedTimeRemaining(Math.floor(remaining));
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [isActive, progress.current, progress.total]);

  if (!isActive) return null;

  const percentage = progress.total > 0 ? (progress.current / progress.total) * 100 : 0;
  const successRate = progress.current > 0 ? ((progress.current - progress.errors) / progress.current) * 100 : 100;

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="bg-white rounded-lg shadow p-6 mb-6">
      <div className="mb-4">
        <div className="flex justify-between items-center mb-2">
          <h3 className="text-lg font-medium text-gray-900">
            Generating Trigger Points...
          </h3>
          <div className="text-sm text-gray-500">
            {progress.current}/{progress.total} POIs
          </div>
        </div>
        
        {progress.currentPOI && (
          <div className="text-sm text-gray-600 mb-3">
            Currently processing: <span className="font-medium">{progress.currentPOI}</span>
          </div>
        )}

        <div className="w-full bg-gray-200 rounded-full h-3 mb-3">
          <div 
            className="bg-blue-600 h-3 rounded-full transition-all duration-300"
            style={{ width: `${percentage}%` }}
          ></div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div className="text-center">
            <div className="font-semibold text-gray-900">{percentage.toFixed(1)}%</div>
            <div className="text-gray-500">Complete</div>
          </div>
          <div className="text-center">
            <div className="font-semibold text-green-600">{successRate.toFixed(1)}%</div>
            <div className="text-gray-500">Success Rate</div>
          </div>
          <div className="text-center">
            <div className="font-semibold text-gray-900">{formatTime(timeElapsed)}</div>
            <div className="text-gray-500">Elapsed</div>
          </div>
          <div className="text-center">
            <div className="font-semibold text-gray-900">
              {estimatedTimeRemaining > 0 ? formatTime(estimatedTimeRemaining) : '--:--'}
            </div>
            <div className="text-gray-500">Remaining</div>
          </div>
        </div>

        {progress.errors > 0 && (
          <div className="mt-3 p-3 bg-red-50 rounded-md">
            <div className="text-sm text-red-700">
              ⚠️ {progress.errors} error{progress.errors > 1 ? 's' : ''} occurred during processing
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
