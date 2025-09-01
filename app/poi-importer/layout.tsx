import { Header } from '@/components/ui/Header'

export default function POIImporterLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col min-h-screen bg-gray-50">
      <Header />
      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  )
} 