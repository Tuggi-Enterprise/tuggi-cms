'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Loader2, MapPin, Users, AlertTriangle, CheckCircle, XCircle, Download, RefreshCw, Trash2 } from 'lucide-react'
import { useSupabaseClient } from '@supabase/auth-helpers-react'

interface DuplicatePOI {
  nome_normalizado: string
  cidade: string
  estado: string
  total_pois: number
  menor_distancia_metros: number
  ids_dos_pois: string[]
  nomes_dos_pois: string[]
  latitudes: number[]
  longitudes: number[]
  datas_criacao: string[]
  status_aprovacao: boolean[]
  avaliacoes: number[]
  google_place_ids: string[]
  nivel_proximidade: string
  sugestao_acao: string
}

interface StateStats {
  estado: string
  total_grupos_duplicatas: number
  total_pois_envolvidos: number
  distancia_media_metros: number
  menor_distancia_encontrada: number
  maior_distancia_encontrada: number
}

export default function DuplicatePOIsPage() {
  const [duplicates, setDuplicates] = useState<DuplicatePOI[]>([])
  const [stats, setStats] = useState<StateStats[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedState, setSelectedState] = useState<string>('all')
  const [selectedProximity, setSelectedProximity] = useState<string>('all')
  const [viewMode, setViewMode] = useState<'overview' | 'duplicates'>('overview')

  const supabase = useSupabaseClient()

  const fetchDuplicates = async () => {
    setLoading(true)
    setError(null)

    try {
      // Buscar duplicatas via API
      const duplicatesResponse = await fetch('/api/duplicate-pois')
      if (!duplicatesResponse.ok) {
        const errorData = await duplicatesResponse.json()
        throw new Error(`Erro ao buscar duplicatas: ${errorData.error}`)
      }
      const duplicatesData = await duplicatesResponse.json()

      // Buscar estatísticas via API
      const statsResponse = await fetch('/api/duplicate-pois?action=stats')
      if (!statsResponse.ok) {
        console.warn('Erro ao buscar estatísticas')
      } else {
        const statsData = await statsResponse.json()
        setStats(statsData.stats || [])
      }

      setDuplicates(duplicatesData.duplicates || [])

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro desconhecido')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchDuplicates()
  }, [])

  const filteredDuplicates = duplicates.filter(duplicate => {
    const stateMatch = selectedState === 'all' || duplicate.estado === selectedState
    const proximityMatch = selectedProximity === 'all' || duplicate.nivel_proximidade === selectedProximity
    return stateMatch && proximityMatch
  })

  const getProximityColor = (level: string) => {
    switch (level) {
      case 'MUITO_PRÓXIMO': return 'destructive'
      case 'PRÓXIMO': return 'destructive'
      case 'RAZOAVELMENTE_PRÓXIMO': return 'secondary'
      default: return 'outline'
    }
  }

  const getActionColor = (action: string) => {
    switch (action) {
      case 'POSSÍVEL_DUPLICATA_EXATA': return 'destructive'
      case 'POSSÍVEL_DUPLICATA': return 'destructive'
      case 'MÚLTIPLAS_DUPLICATAS': return 'secondary'
      default: return 'outline'
    }
  }

  const handleDeletePOI = async (poiId: string, poiName: string) => {
    if (!confirm(`Tem certeza que deseja excluir o POI "${poiName}"? Esta ação não pode ser desfeita.`)) {
      return
    }

    try {
      const { error } = await supabase
        .schema('core')
        .from('attractions')
        .delete()
        .eq('id', poiId)

      if (error) throw error

      // Recarregar os dados após exclusão
      await fetchDuplicates()
      
      console.log(`POI "${poiName}" excluído com sucesso`)
    } catch (error) {
      console.error('Erro ao excluir POI:', error)
      alert('Erro ao excluir POI. Tente novamente.')
    }
  }

  const exportToCSV = () => {
    const headers = [
      'Nome Normalizado',
      'Cidade',
      'Estado',
      'Total POIs',
      'Menor Distância (m)',
      'Nível Proximidade',
      'Sugestão Ação',
      'IDs dos POIs',
      'Nomes dos POIs',
      'Latitudes',
      'Longitudes',
      'Datas Criação',
      'Status Aprovação',
      'Avaliações',
      'Google Place IDs'
    ]

    const csvContent = [
      headers.join(','),
      ...filteredDuplicates.map(duplicate => [
        `"${duplicate.nome_normalizado}"`,
        `"${duplicate.cidade}"`,
        `"${duplicate.estado}"`,
        duplicate.total_pois,
        duplicate.menor_distancia_metros.toFixed(2),
        `"${duplicate.nivel_proximidade}"`,
        `"${duplicate.sugestao_acao}"`,
        `"${duplicate.ids_dos_pois.join(';')}"`,
        `"${duplicate.nomes_dos_pois.join(';')}"`,
        `"${duplicate.latitudes.join(';')}"`,
        `"${duplicate.longitudes.join(';')}"`,
        `"${duplicate.datas_criacao.join(';')}"`,
        `"${duplicate.status_aprovacao.join(';')}"`,
        `"${duplicate.avaliacoes.join(';')}"`,
        `"${duplicate.google_place_ids.join(';')}"`
      ].join(','))
    ].join('\n')

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    const url = URL.createObjectURL(blob)
    link.setAttribute('href', url)
    link.setAttribute('download', `duplicate-pois-${new Date().toISOString().split('T')[0]}.csv`)
    link.style.visibility = 'hidden'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  if (loading) {
    return (
      <div className="container mx-auto p-6">
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin" />
          <span className="ml-2">Carregando duplicatas...</span>
        </div>
      </div>
    )
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">POIs Duplicados</h1>
          <p className="text-muted-foreground">
            Verificação de POIs com mesmo nome, mesma cidade e localização próxima
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={fetchDuplicates} variant="outline" size="sm">
            <RefreshCw className="h-4 w-4 mr-2" />
            Atualizar
          </Button>
          <Button onClick={exportToCSV} variant="outline" size="sm">
            <Download className="h-4 w-4 mr-2" />
            Exportar CSV
          </Button>
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* View Toggle */}
      <div className="flex border border-gray-300 dark:border-gray-600 rounded-lg overflow-hidden w-fit">
        <button
          onClick={() => setViewMode('overview')}
          className={cn(
            'px-4 py-2 text-sm transition-colors',
            viewMode === 'overview'
              ? 'bg-blue-600 text-white'
              : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
          )}
        >
          Visão Geral
        </button>
        <button
          onClick={() => setViewMode('duplicates')}
          className={cn(
            'px-4 py-2 text-sm transition-colors',
            viewMode === 'duplicates'
              ? 'bg-blue-600 text-white'
              : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
          )}
        >
          Duplicatas
        </button>
      </div>

      {viewMode === 'overview' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {stats.map((stat) => (
              <Card key={stat.estado}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg flex items-center">
                    <MapPin className="h-5 w-5 mr-2" />
                    {stat.estado}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <span className="text-sm text-muted-foreground">Grupos:</span>
                      <span className="font-medium">{stat.total_grupos_duplicatas}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm text-muted-foreground">POIs:</span>
                      <span className="font-medium">{stat.total_pois_envolvidos}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm text-muted-foreground">Dist. Média:</span>
                      <span className="font-medium">{stat.distancia_media_metros.toFixed(1)}m</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm text-muted-foreground">Menor Dist.:</span>
                      <span className="font-medium">{stat.menor_distancia_encontrada.toFixed(1)}m</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Resumo Geral</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="text-center">
                  <div className="text-2xl font-bold">{duplicates.length}</div>
                  <div className="text-sm text-muted-foreground">Grupos de Duplicatas</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold">
                    {duplicates.reduce((sum, group) => sum + group.total_pois, 0)}
                  </div>
                  <div className="text-sm text-muted-foreground">POIs Envolvidos</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold">
                    {duplicates.filter(d => d.nivel_proximidade === 'MUITO_PRÓXIMO').length}
                  </div>
                  <div className="text-sm text-muted-foreground">Muito Próximos</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold">
                    {duplicates.filter(d => d.sugestao_acao === 'POSSÍVEL_DUPLICATA_EXATA').length}
                  </div>
                  <div className="text-sm text-muted-foreground">Duplicatas Exatas</div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {viewMode === 'duplicates' && (
        <div className="space-y-4">
          <div className="flex gap-4">
            <select
              value={selectedState}
              onChange={(e) => setSelectedState(e.target.value)}
              className="px-3 py-2 border rounded-md"
            >
              <option value="all">Todos os Estados</option>
              <option value="SP">São Paulo</option>
              <option value="RJ">Rio de Janeiro</option>
              <option value="MG">Minas Gerais</option>
            </select>

            <select
              value={selectedProximity}
              onChange={(e) => setSelectedProximity(e.target.value)}
              className="px-3 py-2 border rounded-md"
            >
              <option value="all">Todos os Níveis</option>
              <option value="MUITO_PRÓXIMO">Muito Próximo</option>
              <option value="PRÓXIMO">Próximo</option>
              <option value="RAZOAVELMENTE_PRÓXIMO">Razoavelmente Próximo</option>
            </select>
          </div>

          <div className="space-y-4">
            {filteredDuplicates.map((duplicate, index) => (
              <Card key={index}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-lg">{duplicate.nomes_dos_pois[0]}</CardTitle>
                      <CardDescription>
                        {duplicate.cidade}, {duplicate.estado} • {duplicate.total_pois} POIs
                      </CardDescription>
                    </div>
                    <div className="flex gap-2">
                      <Badge variant={getProximityColor(duplicate.nivel_proximidade)}>
                        {duplicate.nivel_proximidade}
                      </Badge>
                      <Badge variant={getActionColor(duplicate.sugestao_acao)}>
                        {duplicate.sugestao_acao}
                      </Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <h4 className="font-medium mb-2">Informações do Grupo</h4>
                      <div className="space-y-1 text-sm">
                        <div><strong>Distância:</strong> {duplicate.menor_distancia_metros.toFixed(1)}m</div>
                        <div><strong>Nome Normalizado:</strong> {duplicate.nome_normalizado}</div>
                        <div><strong>POIs:</strong> {duplicate.total_pois}</div>
                      </div>
                    </div>
                    <div>
                      <h4 className="font-medium mb-2">POIs no Grupo</h4>
                      <div className="space-y-2">
                        {duplicate.ids_dos_pois.map((id, idx) => (
                          <div key={id} className="flex items-center justify-between p-2 bg-muted rounded">
                            <div className="flex-1">
                              <div className="font-medium text-sm">{duplicate.nomes_dos_pois[idx]}</div>
                              <div className="text-xs text-muted-foreground">
                                {new Date(duplicate.datas_criacao[idx]).toLocaleDateString('pt-BR')}
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <div className="flex items-center gap-1">
                                {duplicate.status_aprovacao[idx] ? (
                                  <CheckCircle className="h-4 w-4 text-green-500" />
                                ) : (
                                  <XCircle className="h-4 w-4 text-red-500" />
                                )}
                                {duplicate.avaliacoes[idx] && (
                                  <span className="text-xs">⭐ {duplicate.avaliacoes[idx]}</span>
                                )}
                              </div>
                              <button
                                onClick={() => handleDeletePOI(id, duplicate.nomes_dos_pois[idx])}
                                className="p-1 text-gray-400 hover:text-red-500 transition-colors"
                                title="Excluir POI"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}

            {filteredDuplicates.length === 0 && (
              <Card>
                <CardContent className="text-center py-8">
                  <Users className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <h3 className="text-lg font-medium">Nenhuma duplicata encontrada</h3>
                  <p className="text-muted-foreground">
                    Não há POIs duplicados com os filtros selecionados.
                  </p>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
