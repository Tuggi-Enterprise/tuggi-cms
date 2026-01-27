import { Header } from '@/components/ui/Header'

export default function DashboardLayout({
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