import { Metadata } from 'next'
import { Header } from '@/components/ui/Header'

export const metadata: Metadata = {
  title: 'POI Migration | Tuggi CMS',
  description: 'Migrate POIs from homolog to core with full pipeline processing'
}

export default function PoiMigrationLayout({
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

