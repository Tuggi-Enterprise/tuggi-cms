/**
 * OSM Importer Layout
 * 
 * Layout wrapper for OSM Importer with proper metadata and navigation
 * 
 * @module app/osm-importer/layout
 */

import { Header } from '@/components/ui/Header'
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
    <div className="flex flex-col h-screen bg-tuggi-background dark:bg-gray-900">
      <Header />
      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  )
}
