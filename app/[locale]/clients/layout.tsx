import { Header } from '@/components/ui/Header'

/**
 * Layout das páginas de cliente/coordenador (/clients/*). Mesmo padrão de
 * dashboard/layout.tsx e admin/layout.tsx: Header global + <main> rolável.
 * Antes /clients não tinha layout, então a página do coordenador aparecia sem header.
 */
export default function ClientsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col h-screen bg-tuggi-background dark:bg-gray-900">
      <Header />
      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  )
}
