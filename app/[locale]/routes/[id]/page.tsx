'use client'

import React, { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { RouteEditor } from '@/components/routes/RouteEditor'
import { useTranslations } from 'next-intl'
import { AlertCircle, RefreshCw } from 'lucide-react'
import { useCmsUser } from '@/lib/hooks/useCmsUser'

export default function EditRoutePage() {
  const { id } = useParams()
  const t = useTranslations('CustomRoutes.editor')
  const [route, setRoute] = useState<any>(null)
  const { isViewer } = useCmsUser()
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function fetchRoute() {
      try {
        setIsLoading(true)
        const response = await fetch(`/api/routes/${id}`)
        if (response.ok) {
          const data = await response.json()
          setRoute(data.route)
        } else {
          setError(t('fetch_error'))
        }
      } catch (err) {
        console.error('Error fetching route:', err)
        setError(t('fetch_error'))
      } finally {
        setIsLoading(false)
      }
    }

    if (id) fetchRoute()
  }, [id, t])

  if (isLoading) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-4">
        <div className="w-12 h-12 border-4 border-tuggi-blue/10 border-t-tuggi-blue rounded-full animate-spin" />
        <p className="text-gray-400 font-bold animate-pulse">Carregando dados da rota...</p>
      </div>
    )
  }

  if (isViewer) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-red-500 font-bold">Você não tem permissão para editar rotas.</p>
      </div>
    )
  }

  if (error || !route) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-red-500 gap-2">
        <AlertCircle className="h-10 w-10" />
        <p className="font-bold">{error || 'Rota não encontrada'}</p>
      </div>
    )
  }

  return (
    <div className="h-[calc(100vh-3.5rem)] overflow-hidden">
      <RouteEditor initialData={route} isEditing={true} />
    </div>
  )
}
