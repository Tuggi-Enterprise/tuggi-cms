'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { AlertCircle, CheckCircle2, Clock, MapPin, RefreshCw, Play, Pause, BarChart3 } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'

interface ProcessingProgress {
  total_pois: number
  processed: number
  corrections_applied: number
  manual_review_needed: number
  errors: number
  current_poi?: string
  status: 'starting' | 'processing' | 'completed' | 'failed'
  started_at: string
  estimated_completion?: string
}

interface JobProgress {
  progress_key: string
  progress_data: ProcessingProgress
  created_at: string
  updated_at: string
}

interface SystemStats {
  candidates_remaining: number
  manual_review_queue: number
  total_processed: number
  corrections_applied: number
}

export default function CityCorrectionPage() {
  const [isLoading, setIsLoading] = useState(false)
  const [currentJob, setCurrentJob] = useState<JobProgress | null>(null)
  const [recentJobs, setRecentJobs] = useState<JobProgress[]>([])
  const [systemStats, setSystemStats] = useState<SystemStats | null>(null)
  const [error, setError] = useState<string | null>(null)
  
  // Form options
  const [options, setOptions] = useState({
    confidence_threshold: 85,
    enable_cross_validation: true,
    batch_size: 50,
    dry_run: true,
    country_filter: '',
    state_filter: '',
    limit: 100
  })

  const supabase = createClientComponentClient()

  const fetchJobProgress = useCallback(async (jobKey: string) => {
    try {
      const { data, error } = await supabase
        .schema('core')
        .from('city_correction_progress')
        .select('*')
        .eq('progress_key', jobKey)
        .single()

      if (error) throw error

      setCurrentJob(data)
    } catch (err) {
      console.error('Error fetching job progress:', err)
    }
  }, [supabase])

  const loadSystemStats = useCallback(async () => {
    try {
      // Get candidates count
      const { count: candidatesCount } = await supabase
        .schema('core')
        .from('attractions')
        .select('id', { count: 'exact', head: true })
        .is('city_correction_audit', null)

      // Get manual review count
      const { count: manualReviewCount } = await supabase
        .schema('core')
        .from('attractions')
        .select('id', { count: 'exact', head: true })
        .eq('city_correction_audit->needs_manual_review', true)

      // Get processed count
      const { count: processedCount } = await supabase
        .schema('core')
        .from('attractions')
        .select('id', { count: 'exact', head: true })
        .not('city_correction_audit', 'is', null)

      setSystemStats({
        candidates_remaining: candidatesCount || 0,
        manual_review_queue: manualReviewCount || 0,
        total_processed: processedCount || 0,
        corrections_applied: 0 // TODO: Calculate from audit data
      })
    } catch (err) {
      console.error('Error loading system stats:', err)
    }
  }, [supabase])

  const loadRecentJobs = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .schema('core')
        .from('city_correction_progress')
        .select('*')
        .order('updated_at', { ascending: false })
        .limit(5)

      if (error) throw error

      setRecentJobs(data || [])
    } catch (err) {
      console.error('Error loading recent jobs:', err)
    }
  }, [supabase])

  // Polling for progress updates
  useEffect(() => {
    if (currentJob && currentJob.progress_data.status === 'processing') {
      const interval = setInterval(() => {
        fetchJobProgress(currentJob.progress_key)
      }, 5000) // Poll every 5 seconds

      return () => clearInterval(interval)
    }
  }, [currentJob, fetchJobProgress])

  // Load initial data
  useEffect(() => {
    loadSystemStats()
    loadRecentJobs()
  }, [loadSystemStats, loadRecentJobs])

  const startCityCorrection = async () => {
    setIsLoading(true)
    setError(null)
    
    try {
      // Generate unique job key
      const jobKey = `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
      
      console.log('🚀 Starting city correction job:', jobKey)

      // Call Edge Function directly
      const { data, error } = await supabase.functions.invoke('city-correction', {
        body: {
          action: 'process_batch',
          options: {
            confidence_threshold: options.confidence_threshold,
            enable_cross_validation: options.enable_cross_validation,
            batch_size: options.batch_size,
            dry_run: options.dry_run,
            country_filter: options.country_filter || undefined,
            state_filter: options.state_filter || undefined,
            limit: options.limit
          },
          progress_key: jobKey
        }
      })

      if (error) {
        throw new Error(`Edge Function error: ${error.message}`)
      }

      console.log('✅ City correction job started:', data)
      
      // Start polling for progress
      setCurrentJob({
        progress_key: jobKey,
        progress_data: {
          total_pois: 0,
          processed: 0,
          corrections_applied: 0,
          manual_review_needed: 0,
          errors: 0,
          status: 'starting',
          started_at: new Date().toISOString()
        },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })

      // Fetch initial progress
      setTimeout(() => fetchJobProgress(jobKey), 2000)

    } catch (err) {
      console.error('💥 Error starting city correction:', err)
      setError(err instanceof Error ? err.message : 'Unknown error occurred')
    } finally {
      setIsLoading(false)
    }
  }

  const formatDuration = (startTime: string): string => {
    const elapsed = Date.now() - new Date(startTime).getTime()
    const seconds = Math.floor(elapsed / 1000)
    const minutes = Math.floor(seconds / 60)
    const hours = Math.floor(minutes / 60)

    if (hours > 0) return `${hours}h ${minutes % 60}m`
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`
    return `${seconds}s`
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'starting': return 'bg-blue-500'
      case 'processing': return 'bg-yellow-500'
      case 'completed': return 'bg-green-500'
      case 'failed': return 'bg-red-500'
      default: return 'bg-gray-500'
    }
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'starting': return <Clock className="h-4 w-4" />
      case 'processing': return <RefreshCw className="h-4 w-4 animate-spin" />
      case 'completed': return <CheckCircle2 className="h-4 w-4" />
      case 'failed': return <AlertCircle className="h-4 w-4" />
      default: return <Clock className="h-4 w-4" />
    }
  }

  return (
    <div className="container mx-auto py-8 space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Correção de Cidades dos POIs</h1>
          <p className="text-muted-foreground mt-2">
            Sistema automático para corrigir cidades incorretas usando geocoding reverso gratuito
          </p>
        </div>
        <Button 
          onClick={loadSystemStats}
          variant="outline"
          size="sm"
        >
          <RefreshCw className="h-4 w-4 mr-2" />
          Atualizar
        </Button>
      </div>

      {/* System Statistics */}
      {systemStats && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Candidatos</CardTitle>
              <MapPin className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{systemStats.candidates_remaining.toLocaleString()}</div>
              <p className="text-xs text-muted-foreground">POIs para processar</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Processados</CardTitle>
              <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{systemStats.total_processed.toLocaleString()}</div>
              <p className="text-xs text-muted-foreground">POIs já verificados</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Revisão Manual</CardTitle>
              <AlertCircle className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{systemStats.manual_review_queue.toLocaleString()}</div>
              <p className="text-xs text-muted-foreground">Aguardando revisão</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Taxa de Processamento</CardTitle>
              <BarChart3 className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">~1000/dia</div>
              <p className="text-xs text-muted-foreground">POIs por dia (rate limit)</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Current Job Progress */}
      {currentJob && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  {getStatusIcon(currentJob.progress_data.status)}
                  Job em Andamento
                  <Badge className={getStatusColor(currentJob.progress_data.status)}>
                    {currentJob.progress_data.status}
                  </Badge>
                </CardTitle>
                <CardDescription>
                  Job Key: {currentJob.progress_key}
                </CardDescription>
              </div>
              <div className="text-right text-sm text-muted-foreground">
                Iniciado: {formatDuration(currentJob.progress_data.started_at)} atrás
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {currentJob.progress_data.total_pois > 0 && (
              <>
                <div>
                  <div className="flex justify-between text-sm mb-2">
                    <span>Progresso</span>
                    <span>
                      {currentJob.progress_data.processed} / {currentJob.progress_data.total_pois}
                      {currentJob.progress_data.total_pois > 0 && (
                        <span className="ml-2">
                          ({Math.round((currentJob.progress_data.processed / currentJob.progress_data.total_pois) * 100)}%)
                        </span>
                      )}
                    </span>
                  </div>
                  <Progress 
                    value={currentJob.progress_data.total_pois > 0 
                      ? (currentJob.progress_data.processed / currentJob.progress_data.total_pois) * 100 
                      : 0
                    } 
                    className="w-full" 
                  />
                </div>

                <div className="grid grid-cols-3 gap-4 text-center">
                  <div>
                    <div className="text-2xl font-bold text-green-600">
                      {currentJob.progress_data.corrections_applied}
                    </div>
                    <div className="text-xs text-muted-foreground">Correções</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-yellow-600">
                      {currentJob.progress_data.manual_review_needed}
                    </div>
                    <div className="text-xs text-muted-foreground">Revisão Manual</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-red-600">
                      {currentJob.progress_data.errors}
                    </div>
                    <div className="text-xs text-muted-foreground">Erros</div>
                  </div>
                </div>

                {currentJob.progress_data.current_poi && (
                  <div className="text-sm text-muted-foreground">
                    <strong>Processando:</strong> {currentJob.progress_data.current_poi}
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Configuration Form */}
      <Card>
        <CardHeader>
          <CardTitle>Configurar Processamento</CardTitle>
          <CardDescription>
            Configure as opções para processamento em lote das correções de cidade
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="confidence">Limite de Confiança (%)</Label>
              <Input
                id="confidence"
                type="number"
                min="60"
                max="100"
                value={options.confidence_threshold}
                onChange={(e) => setOptions(prev => ({ 
                  ...prev, 
                  confidence_threshold: parseInt(e.target.value) || 85 
                }))}
              />
              <p className="text-xs text-muted-foreground">
                Mínimo de confiança para aplicar correção automaticamente (85 recomendado)
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="limit">Limite de POIs</Label>
              <Input
                id="limit"
                type="number"
                min="1"
                max="10000"
                value={options.limit}
                onChange={(e) => setOptions(prev => ({ 
                  ...prev, 
                  limit: parseInt(e.target.value) || 100 
                }))}
              />
              <p className="text-xs text-muted-foreground">
                Máximo de POIs para processar neste job
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="country">Filtro por País</Label>
              <Input
                id="country"
                placeholder="ex: Brazil, Spain (opcional)"
                value={options.country_filter}
                onChange={(e) => setOptions(prev => ({ 
                  ...prev, 
                  country_filter: e.target.value 
                }))}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="state">Filtro por Estado</Label>
              <Input
                id="state"
                placeholder="ex: São Paulo (opcional)"
                value={options.state_filter}
                onChange={(e) => setOptions(prev => ({ 
                  ...prev, 
                  state_filter: e.target.value 
                }))}
              />
            </div>
          </div>

          <Separator />

          <div className="space-y-4">
            <div className="flex items-center space-x-2">
              <Checkbox
                id="cross-validation"
                checked={options.enable_cross_validation}
                onCheckedChange={(checked) => setOptions(prev => ({ 
                  ...prev, 
                  enable_cross_validation: !!checked 
                }))}
              />
              <Label htmlFor="cross-validation">
                Habilitar validação cruzada (Nominatim + GeoNames)
              </Label>
            </div>

            <div className="flex items-center space-x-2">
              <Checkbox
                id="dry-run"
                checked={options.dry_run}
                onCheckedChange={(checked) => setOptions(prev => ({ 
                  ...prev, 
                  dry_run: !!checked 
                }))}
              />
              <Label htmlFor="dry-run">
                Modo de teste (não aplicar correções reais)
              </Label>
            </div>
          </div>

          {error && (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <Button 
            onClick={startCityCorrection} 
            disabled={isLoading || (currentJob?.progress_data.status === 'processing')}
            className="w-full"
          >
            {isLoading ? (
              <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Play className="h-4 w-4 mr-2" />
            )}
            {options.dry_run ? 'Executar Teste' : 'Iniciar Correção'}
          </Button>
        </CardContent>
      </Card>

      {/* Recent Jobs */}
      {recentJobs.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Jobs Recentes</CardTitle>
            <CardDescription>Histórico dos últimos processamentos</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {recentJobs.map((job) => (
                <div key={job.progress_key} className="flex items-center justify-between p-3 border rounded-lg">
                  <div className="flex items-center gap-3">
                    {getStatusIcon(job.progress_data.status)}
                    <div>
                      <div className="font-medium">{job.progress_key}</div>
                      <div className="text-sm text-muted-foreground">
                        {job.progress_data.total_pois > 0 && (
                          <>
                            {job.progress_data.processed}/{job.progress_data.total_pois} POIs
                            {job.progress_data.corrections_applied > 0 && (
                              <span className="ml-2 text-green-600">
                                • {job.progress_data.corrections_applied} correções
                              </span>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <Badge className={getStatusColor(job.progress_data.status)}>
                      {job.progress_data.status}
                    </Badge>
                    <div className="text-xs text-muted-foreground mt-1">
                      {formatDuration(job.progress_data.started_at)} atrás
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
