import { Sidebar } from '@/components/ui/Sidebar'

export default function POIImporterLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen bg-gray-50 relative">
      <div className="fixed left-0 top-0 h-full z-10">
        <Sidebar />
      </div>
      <main className="ml-64 overflow-auto min-h-screen">
        {children}
      </main>
    </div>
  )
} 