import { getSupabase } from '../lib/core/supabase-client'
import * as dotenv from 'dotenv'

// Load environment variables
dotenv.config()

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

interface ProgressData {
  status: string
  target_goal?: number
  total_processed_so_far?: number
  remaining_pois?: number
  processed?: number
  corrections_applied?: number
  manual_review_needed?: number
  errors?: number
  retry_count?: number
}

class CityCorrectionRunner {
  private supabase = createClient(supabaseUrl, supabaseServiceKey)
  private isRunning = false
  private totalPOIs = 0
  private processedPOIs = 0
  private consecutiveFailures = 0
  private maxRetries = 3
  private retryDelay = 30000 // 30 seconds

  async start() {
    console.log('🚀 Iniciando City Correction Runner...\n')
    
    // Get initial stats
    await this.loadInitialStats()
    
    this.isRunning = true
    
    // Handle Ctrl+C to stop gracefully
    process.on('SIGINT', () => {
      console.log('\n\n⏹️  Parando o runner...')
      this.isRunning = false
    })

    while (this.isRunning) {
      try {
        await this.runCorrectionCycle()
        
        // Reset failure counter on success
        this.consecutiveFailures = 0
        
        // Wait 2 seconds between cycles (reduced since single POI is faster)
        if (this.isRunning) {
          console.log('⏳ Aguardando 2 segundos para próximo ciclo...\n')
          await this.sleep(2000)
        }
      } catch (error) {
        this.consecutiveFailures++
        console.error(`❌ Erro no ciclo (tentativa ${this.consecutiveFailures}/${this.maxRetries}):`, error)
        
        if (this.consecutiveFailures >= this.maxRetries) {
          console.error('💥 Máximo de tentativas atingido. Parando o runner.')
          this.isRunning = false
          break
        }
        
        // Exponential backoff: 30s, 60s, 120s
        const delay = this.retryDelay * Math.pow(2, this.consecutiveFailures - 1)
        console.log(`🔄 Tentando novamente em ${delay/1000} segundos...\n`)
        await this.sleep(delay)
      }
    }
    
    console.log('\n✅ Runner finalizado!')
  }

  private async loadInitialStats() {
    console.log('📊 Carregando estatísticas iniciais...')
    
    // Get total POIs
    const { count: totalCount } = await this.supabase
      .schema('core')
      .from('attractions')
      .select('id', { count: 'exact', head: true })

    // Get processed POIs (those with city_correction_audit)
    const { count: processedCount } = await this.supabase
      .schema('core')
      .from('attractions')
      .select('id', { count: 'exact', head: true })
      .not('city_correction_audit', 'is', null)

    // Get POIs with coordinates that can be processed
    const { count: poisWithCoords } = await this.supabase
      .schema('core')
      .from('attractions')
      .select('id, attraction_coordinate!inner(id)', { count: 'exact', head: true })
      .is('city_correction_audit', null)

    this.totalPOIs = poisWithCoords || 0
    this.processedPOIs = processedCount || 0

    console.log(`   Total POIs para correção: ${this.totalPOIs.toLocaleString()}`)
    console.log(`   POIs já processados: ${this.processedPOIs.toLocaleString()}`)
    console.log(`   POIs restantes: ${(this.totalPOIs - this.processedPOIs).toLocaleString()}`)
    console.log(`   Progresso: ${this.getProgressPercentage()}%\n`)
  }

  private async runCorrectionCycle() {
    console.log('🔄 Executando ciclo de correção...')
    
    // Check current job status
    const currentJob = await this.getCurrentJob()
    
    if (currentJob && currentJob.progress_data.status === 'processing') {
      console.log('⏸️  Job já está processando, aguardando...')
      return
    }

    // Call the Edge Function
    const startTime = Date.now()
    console.log('📡 Chamando Edge Function...')
    
    try {
      const response = await fetch(`${supabaseUrl}/functions/v1/city-correction`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${supabaseAnonKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          action: 'process_single',  // Changed to process single POI
          limit: 1  // Process 1 POI at a time like unified-image-processing
        })
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${await response.text()}`)
      }

      const result = await response.json()
      const duration = Date.now() - startTime

      // Update local stats
      this.processedPOIs += result.data?.total_processed || 0

      // Display results
      console.log('✅ Edge Function executada com sucesso!')
      console.log(`   Tempo: ${(duration / 1000).toFixed(1)}s`)
      console.log(`   POIs processados: ${result.data?.total_processed || 0}`)
      console.log(`   Correções aplicadas: ${result.data?.corrections_applied || 0}`)
      console.log(`   Revisão manual: ${result.data?.manual_review_needed || 0}`)
      console.log(`   Erros: ${result.data?.errors || 0}`)
      
      // Show overall progress
      const progress = this.getProgressPercentage()
      const remaining = this.totalPOIs - this.processedPOIs
      
      console.log('\n📊 PROGRESSO GERAL:')
      console.log(`   ${this.generateProgressBar(progress)} ${progress}%`)
      console.log(`   Processados: ${this.processedPOIs.toLocaleString()} / ${this.totalPOIs.toLocaleString()}`)
      console.log(`   Restantes: ${remaining.toLocaleString()}`)
      
      // Estimate completion
      if (result.data?.total_processed > 0) {
        const cyclesRemaining = Math.ceil(remaining / result.data.total_processed)
        const estimatedMinutes = (cyclesRemaining * 60) / 60 // 1 minute per cycle average
        console.log(`   Estimativa: ${cyclesRemaining} ciclos (~${Math.round(estimatedMinutes)} minutos)`)
      }

      // Check if completed
      if (remaining <= 0) {
        console.log('\n🎉 CORREÇÃO CONCLUÍDA! Todos os POIs foram processados!')
        this.isRunning = false
        return
      }

    } catch (error) {
      console.error('❌ Erro na Edge Function:', error)
      throw error
    }
  }

  private async getCurrentJob() {
    const { data } = await this.supabase
      .schema('core')
      .from('city_correction_progress')
      .select('*')
      .eq('progress_key', 'default')
      .single()

    return data
  }

  private getProgressPercentage(): number {
    if (this.totalPOIs === 0) return 0
    return Math.round((this.processedPOIs / this.totalPOIs) * 100 * 100) / 100
  }

  private generateProgressBar(percentage: number): string {
    const barLength = 30
    const filledLength = Math.round((percentage / 100) * barLength)
    const bar = '█'.repeat(filledLength) + '░'.repeat(barLength - filledLength)
    return `[${bar}]`
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}

// Start the runner
const runner = new CityCorrectionRunner()
runner.start().catch(console.error)
