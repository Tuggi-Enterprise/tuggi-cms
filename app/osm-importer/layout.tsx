/**
 * OSM Importer Layout
 * 
 * Layout wrapper for OSM Importer with proper metadata and navigation
 * 
 * @module app/osm-importer/layout
 */

import { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'OSM Data Manager | Tuggi CMS',
  description: 'Manage and import OpenStreetMap data with advanced filtering and visualization tools',
  keywords: ['OSM', 'OpenStreetMap', 'GeoJSON', 'POI', 'Import', 'Data Management'],
}

export default function OSMImporterLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {children}
    </div>
  )
}
