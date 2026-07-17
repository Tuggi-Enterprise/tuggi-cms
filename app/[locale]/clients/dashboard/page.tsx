'use client'

import { useEffect, useState } from 'react'
import { MapPin, Users } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from '@/navigation'
import { useCmsUser } from '@/lib/hooks/useCmsUser'

export default function ClientDashboardPage() {
  const [data, setData] = useState<any | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()
  const { isCoordinator, isLoading: userLoading } = useCmsUser()

  // Coordenador não gerencia POIs (decisão de produto) → mandar para "Minha rede".
  // Evita cair neste painel de POIs, que além de irrelevante para ele mostra o
  // catálogo da plataforma enquanto o escopo de POI não é corrigido.
  useEffect(() => {
    if (!userLoading && isCoordinator) router.replace('/clients/coordinator')
  }, [userLoading, isCoordinator, router])

  useEffect(() => {
    if (userLoading || isCoordinator) return
    async function load() {
      setLoading(true)
      try {
        const res = await fetch('/api/clients/dashboard')
        if (!res.ok) {
          const j = await res.json().catch(() => ({}))
          throw new Error(j?.error || 'Failed to load')
        }
        const json = await res.json()
        setData(json.data)
      } catch (err: any) {
        console.error('Client dashboard load error:', err)
        setError(err.message || 'Failed to load dashboard')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [userLoading, isCoordinator])

  if (userLoading || isCoordinator) return <div className="p-6">Redirecionando…</div>
  if (loading) return <div className="p-6">Loading...</div>
  if (error) return <div className="p-6 text-red-600">Error: {error}</div>
  if (!data) return <div className="p-6">No data</div>

  const { poiStats, cityDistribution, cmsUser } = data

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Meu Painel</h1>
          <p className="text-sm text-gray-500">Visão resumida dos seus POIs</p>
        </div>
        <div>
          <Link href="/clients/my-pois" className="px-3 py-2 bg-blue-600 text-white rounded">Meus POIs</Link>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="tuggi-card p-4">
          <div className="flex items-center">
            <div className="p-2 rounded bg-blue-50 mr-3"><MapPin className="h-5 w-5 text-blue-600"/></div>
            <div>
              <div className="text-sm text-gray-500">Total POIs</div>
              <div className="text-2xl font-bold">{poiStats.total?.toLocaleString() ?? 0}</div>
            </div>
          </div>
        </div>

        <div className="tuggi-card p-4">
          <div className="flex items-center">
            <div className="p-2 rounded bg-green-50 mr-3"><span className="text-green-600">✓</span></div>
            <div>
              <div className="text-sm text-gray-500">Aprovados</div>
              <div className="text-2xl font-bold">{poiStats.approved ?? '-'}</div>
            </div>
          </div>
        </div>

        <div className="tuggi-card p-4">
          <div className="flex items-center">
            <div className="p-2 rounded bg-indigo-50 mr-3"><Users className="h-5 w-5 text-indigo-600"/></div>
            <div>
              <div className="text-sm text-gray-500">Usuario</div>
              <div className="text-2xl font-bold">{cmsUser?.full_name || cmsUser?.email}</div>
            </div>
          </div>
        </div>
      </div>

      <div className="tuggi-card p-4">
        <h3 className="font-semibold mb-2">Distribuição por cidade</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {cityDistribution.length === 0 ? (
            <div className="text-sm text-gray-500">Nenhuma cidade encontrada</div>
          ) : (
            cityDistribution.map((c: any) => (
              <div key={c.city} className="flex justify-between border-b py-2">
                <div>{c.city}</div>
                <div className="font-medium">{c.poi_count}</div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
