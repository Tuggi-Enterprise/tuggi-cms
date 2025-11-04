/**
 * OSM Importer Main Page - KISS SIMPLIFIED
 * 
 * Simple and functional OSM data management interface
 * 
 * @module app/osm-importer/page
 */

'use client'

import { Suspense, useState, useEffect } from 'react'
import { OSMImporterSimple } from '@/components/osm-importer/OSMImporterSimple'

function OSMImporterContent() {
  const [hasData, setHasData] = useState<boolean | null>(null)
  const [isChecking, setIsChecking] = useState(true)

  // Check if there's data in the database before loading the component
  useEffect(() => {
    const checkForData = async () => {
      try {
        console.log('🔍 [PAGE] Checking if there is data in the database...')
        
        // Use the stats endpoint which uses the pois_stats view or direct count
        // This is more reliable than the RPC function which doesn't return total_count
        const response = await fetch('/api/supabase/stats')
        const result = await response.json()
        
        if (result.success && result.data) {
          const totalCount = result.data.total_pois || 0
          console.log(`📊 [PAGE] Database check result: ${totalCount} POIs found`)
          setHasData(totalCount > 0)
        } else {
          // Fallback: try direct count query
          console.log('⚠️ [PAGE] Stats API failed, trying direct count...')
          const countResponse = await fetch('/api/supabase/pois?page=1&limit=1')
          const countResult = await countResponse.json()
          
          // If RPC returns data but total_count is 0, check if we got any rows
          // This handles the case where the RPC function doesn't return total_count
          const hasAnyData = countResult.data && countResult.data.length > 0
          const totalCount = countResult.pagination?.total || (hasAnyData ? 1 : 0)
          
          console.log(`📊 [PAGE] Fallback check result: ${totalCount} POIs (hasAnyData: ${hasAnyData})`)
          setHasData(totalCount > 0 || hasAnyData)
        }
      } catch (error) {
        console.error('❌ [PAGE] Error checking for data:', error)
        // On error, assume no data to show import component
        setHasData(false)
      } finally {
        setIsChecking(false)
      }
    }

    checkForData()
  }, [])

  // Show loading state while checking
  if (isChecking) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600 dark:text-gray-400">Checking database...</p>
        </div>
      </div>
    )
  }

  // Render the main component (it will handle data loading if hasData is true)
  // hasData will never be null here because we only render after isChecking is false
  return <OSMImporterSimple initialHasData={hasData ?? false} />
}

export default function OSMImporterPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <OSMImporterContent />
    </Suspense>
  )
}