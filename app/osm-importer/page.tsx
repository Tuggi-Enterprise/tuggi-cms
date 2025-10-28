/**
 * OSM Importer Main Page - KISS SIMPLIFIED
 * 
 * Simple and functional OSM data management interface
 * 
 * @module app/osm-importer/page
 */

'use client'

import { Suspense } from 'react'
import { OSMImporterSimple } from '@/components/osm-importer/OSMImporterSimple'

function OSMImporterContent() {
  return <OSMImporterSimple />
}

export default function OSMImporterPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <OSMImporterContent />
    </Suspense>
  )
}