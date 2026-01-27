/**
 * OSM Importer Main Page - Optimized
 * 
 * Uses server-side pagination and URL-synced filters
 * 
 * @module app/osm-importer/page
 */

'use client'

import { Suspense, useState, useEffect } from 'react'
import { Loader2 } from 'lucide-react'
import { OSMImporterOptimized } from '@/components/osm-importer/OSMImporterOptimized'
import { useTranslations } from 'next-intl'

function OSMImporterContent() {
  const t = useTranslations('Pages.OSMImporter')
  const [hasData, setHasData] = useState<boolean | null>(null)
  const [isChecking, setIsChecking] = useState(true)

  // Check if there's data in the database
  useEffect(() => {
    const checkForData = async () => {
      try {
        console.log('🔍 [PAGE] Checking for data...')
        
        const response = await fetch('/api/supabase/stats')
        const result = await response.json()
        
        if (result.success && result.data) {
          const totalCount = result.data.total_pois || 0
          console.log(`📊 [PAGE] Found ${totalCount} POIs`)
          setHasData(totalCount > 0)
        } else {
          // Fallback check
          const countResponse = await fetch('/api/supabase/pois?page=1&limit=1')
          const countResult = await countResponse.json()
          const hasAnyData = countResult.data?.length > 0
          setHasData(hasAnyData)
        }
      } catch (error) {
        console.error('❌ [PAGE] Error checking for data:', error)
        setHasData(false)
      } finally {
        setIsChecking(false)
      }
    }

    checkForData()
  }, [])

  // Loading state
  if (isChecking) {
    return (
      <div className="h-full flex items-center justify-center bg-tuggi-background dark:bg-gray-900">
        <div className="text-center">
          <Loader2 className="w-12 h-12 animate-spin text-blue-600 mx-auto mb-4" />
          <p className="text-gray-600 dark:text-gray-400">{t('status.checking')}</p>
        </div>
      </div>
    )
  }

  return <OSMImporterOptimized initialHasData={hasData ?? false} />
}

export default function OSMImporterPage() {
  return (
    <Suspense fallback={
      <div className="h-full flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    }>
      <OSMImporterContent />
    </Suspense>
  )
}