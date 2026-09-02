'use client'

import { Suspense } from 'react'
import { Loader2 } from 'lucide-react'
import { Header } from '@/components/ui/Header'
import { POIImporter } from '@/components/poi-importer/POIImporter'

export default function POIImporterPage() {
  return (
    <div className="cms-width flex flex-col min-h-screen bg-gray-50 dark:bg-gray-900">
      <Header />
      <main className="flex-1 overflow-hidden">
        <Suspense fallback={
          <div className="h-full flex items-center justify-center">
            <Loader2 className="w-8 h-8 animate-spin text-tuggi-blue" />
          </div>
        }>
          <POIImporter />
        </Suspense>
      </main>
    </div>
  )
}
