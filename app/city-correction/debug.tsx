'use client'

import { useState, useEffect } from 'react'
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs'

export default function CityCorrectionDebug() {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const supabase = createClientComponentClient()

  useEffect(() => {
    async function loadData() {
      try {
        setLoading(true)
        setError(null)

        console.log('🔍 Loading data...')

        // Load recent jobs
        const { data: recentJobs, error: recentJobsError } = await supabase
          .schema('core')
          .from('city_correction_progress')
          .select('*')
          .order('updated_at', { ascending: false })
          .limit(5)

        if (recentJobsError) {
          throw recentJobsError
        }

        console.log('✅ Recent jobs loaded:', recentJobs)

        // Load system stats
        const { count: candidatesCount } = await supabase
          .schema('core')
          .from('attractions')
          .select('id', { count: 'exact', head: true })
          .is('city_correction_audit', null)

        const { count: processedCount } = await supabase
          .schema('core')
          .from('attractions')
          .select('id', { count: 'exact', head: true })
          .not('city_correction_audit', 'is', null)

        console.log('✅ System stats loaded:', { candidatesCount, processedCount })

        setData({
          recentJobs,
          systemStats: {
            candidates_remaining: candidatesCount || 0,
            total_processed: processedCount || 0,
            manual_review_queue: 0
          }
        })

      } catch (err) {
        console.error('💥 Error loading data:', err)
        setError(err instanceof Error ? err.message : 'Unknown error')
      } finally {
        setLoading(false)
      }
    }

    loadData()
  }, [supabase])

  if (loading) {
    return <div className="p-8">Loading...</div>
  }

  if (error) {
    return <div className="p-8 text-red-600">Error: {error}</div>
  }

  return (
    <div className="p-8 space-y-4">
      <h1 className="text-2xl font-bold">City Correction Debug</h1>
      
      <div className="bg-gray-100 p-4 rounded">
        <h2 className="font-bold mb-2">System Stats:</h2>
        <pre>{JSON.stringify(data?.systemStats, null, 2)}</pre>
      </div>

      <div className="bg-gray-100 p-4 rounded">
        <h2 className="font-bold mb-2">Recent Jobs:</h2>
        <pre>{JSON.stringify(data?.recentJobs, null, 2)}</pre>
      </div>
    </div>
  )
}
