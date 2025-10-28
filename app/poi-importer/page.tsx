'use client'

import { Suspense } from 'react'
import { OSMImporterSimple } from '@/components/osm-importer/OSMImporterSimple'

function POIImporterContent() {
  console.log('🏗️ [POI-IMPORTER-PAGE] Rendering page with OSMImporterSimple')
  return <OSMImporterSimple />
}

export default function POIImporterPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <POIImporterContent />
    </Suspense>
  )
}