'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, AlertCircle, CheckCircle2, RefreshCw } from 'lucide-react';
import { BatchProgressBar } from '@/components/verification/BatchProgressBar';

export default function ImprovePage() {
  const router = useRouter();
  
  const [isLoading, setIsLoading] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  
  // Form state
  const [language, setLanguage] = useState('pt-br');
  const [country, setCountry] = useState('Brazil');
  const [status, setStatus] = useState('rejected');
  const [scoreRange, setScoreRange] = useState([0, 60]);
  const [limit, setLimit] = useState(50);

  // Poll for job status if we have a jobId
  useEffect(() => {
    if (!jobId) return;
    
    const interval = setInterval(async () => {
      try {
        const response = await fetch(`/api/verify/job-status?job_id=${jobId}`);
        if (!response.ok) {
          throw new Error('Failed to fetch job status');
        }
        
        const data = await response.json();
        setJobStatus(data);
        
        // Stop polling if job is completed or failed
        if (data.status === 'completed' || data.status === 'failed') {
          clearInterval(interval);
        }
      } catch (err) {
        console.error('Error fetching job status:', err);
      }
    }, 3000); // Poll every 3 seconds
    
    return () => clearInterval(interval);
  }, [jobId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);
    
    try {
      const response = await fetch('/api/descriptions/improve-batch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          language,
          country,
          status,
          minScore: scoreRange[0],
          maxScore: scoreRange[1],
          limit,
        }),
      });
      
      if (!response.ok) {
        const errorData = await response.text();
        throw new Error(errorData || 'Failed to start improvement process');
      }
      
      const data = await response.json();
      setJobId(data.jobId);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="container mx-auto py-6">
      <h1 className="text-3xl font-bold mb-6">Improve Descriptions</h1>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Parameters Card */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold mb-4">Improvement Parameters</h2>
          <p className="text-gray-600 mb-4">
            Configure the parameters for the description improvement process
          </p>
          
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
                <option value="rejected">Rejected</option>
                <option value="needs_review">Needs Review</option>
                <option value="pending">Pending</option>
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
            
            <button
              type="submit"
              disabled={isLoading}
              className="w-full bg-tuggi-blue text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {isLoading ? (
                <>
                  <Loader2 className="inline-block mr-2 h-4 w-4 animate-spin" />
                  Starting...
                </>
              ) : (
                'Start Improvement Process'
              )}
            </button>
          </form>
        </div>
        
        {/* Progress Card */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold mb-4">Progress</h2>
          <p className="text-gray-600 mb-4">
            Monitor the progress of the description improvement process
          </p>
          
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
              <div className="flex items-center">
                <AlertCircle className="h-4 w-4 mr-2" />
                <span className="font-medium">Error</span>
              </div>
              <p className="text-sm mt-1">{error}</p>
            </div>
          )}
          
          {jobId ? (
            <div className="space-y-4">
              <div className="text-sm space-y-1">
                <p><span className="font-medium">Job ID:</span> {jobId}</p>
                <p><span className="font-medium">Status:</span> {jobStatus?.status || 'Loading...'}</p>
                <p><span className="font-medium">Message:</span> {jobStatus?.progress_message || 'Loading...'}</p>
              </div>
              
              <BatchProgressBar jobId={jobId} />
              
              {jobStatus?.status === 'completed' && (
                <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded">
                  <div className="flex items-center">
                    <CheckCircle2 className="h-4 w-4 mr-2" />
                    <span className="font-medium">Completed</span>
                  </div>
                  <p className="text-sm mt-1">
                    Improved {jobStatus.successful_items} descriptions successfully.
                    {jobStatus.failed_items > 0 && ` Failed: ${jobStatus.failed_items}`}
                  </p>
                </div>
              )}
              
              {jobStatus?.status === 'failed' && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
                  <div className="flex items-center">
                    <AlertCircle className="h-4 w-4 mr-2" />
                    <span className="font-medium">Process Failed</span>
                  </div>
                  <p className="text-sm mt-1">{jobStatus.progress_message}</p>
                </div>
              )}
              
              <button 
                onClick={() => router.push('/verification')}
                className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Go to Verification Page
              </button>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-40 text-center text-gray-500">
              <p>Start the improvement process to see progress here</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}