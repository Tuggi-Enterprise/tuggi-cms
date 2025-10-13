import { Header } from '@/components/ui/Header'

export default function TestTriggerPointsLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <Header />
      <main className="pt-16">
        {children}
      </main>
    </div>
  )
}

