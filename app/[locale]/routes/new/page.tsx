import { RouteEditor } from '@/components/routes/RouteEditor'
import { useCmsUser } from '@/lib/hooks/useCmsUser'

export default function NewRoutePage() {
  const { isViewer } = useCmsUser()

  if (isViewer) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-red-500 font-bold">Você não tem permissão para criar rotas.</p>
      </div>
    )
  }

  return (
    <div className="h-[calc(100vh-3.5rem)] overflow-hidden">
      <RouteEditor />
    </div>
  )
}
