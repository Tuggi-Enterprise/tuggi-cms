import { getSupabase } from '../lib/core/supabase-client'
import * as dotenv from 'dotenv'

// Load environment variables
dotenv.config()

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

class CityCorrectionConsole {
  private supabase = createClient(supabaseUrl, supabaseServiceKey)
  private isRunning = false
  private totalProcessed = 0
  private totalCorrections = 0
  private totalManualReviews = 0
  private totalErrors = 0
  private startTime = Date.now()

  async start() {
    console.log('🚀 Iniciando City Correction Console Runner...\n')
    
    this.isRunning = true
    
    // Handle Ctrl+C to stop gracefully
    process.on('SIGINT', () => {
      console.log('\n\n⏹️  Parando o runner...')
      this.showFinalStats()
      this.isRunning = false
      process.exit(0)
    })

    // Get initial stats
    await this.showCurrentStats()

    while (this.isRunning) {
      try {
        const success = await this.processSinglePOI()
        
        if (!success) {
          console.log('✅ Nenhum POI restante para processar!')
          break
        }
        
        // Show progress every 10 POIs
        if (this.totalProcessed % 10 === 0) {
          await this.showCurrentStats()
        }
        
        // Small delay between calls
        await this.sleep(1000) // 1 second between calls
        
      } catch (error) {
        console.error('❌ Erro no ciclo:', error)
        this.totalErrors++
        
        // Wait longer on error
        await this.sleep(5000)
      }
    }
    
    this.showFinalStats()
  }

  private async processSinglePOI(): Promise<boolean> {
    try {
      const response = await fetch(`${supabaseUrl}/functions/v1/city-correction`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${supabaseAnonKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          action: 'process_single'
        })
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${await response.text()}`)
      }

      const result = await response.json()
      
      if (!result.success) {
        throw new Error(result.error || 'Edge Function returned error')
      }

      const data = result.data
      
      // Update counters
      this.totalProcessed += data.total_processed || 0
      this.totalCorrections += data.corrections_applied || 0
      this.totalManualReviews += data.manual_review_needed || 0
      this.totalErrors += data.errors || 0

      // Show result with POI details
      if (data.total_processed > 0) {
        const status = data.corrections_applied > 0 ? '✅ Corrigido' : 
                      data.manual_review_needed > 0 ? '📋 Rev.Manual' : 
                      '✓ OK'
        
        // Try to extract POI info from sample corrections or show generic info
        let poiInfo = 'POI processado'
        if (data.sample_corrections && data.sample_corrections.length > 0) {
          const correction = data.sample_corrections[0]
          poiInfo = `${correction.poi_name} | ${correction.old_city} → ${correction.new_city} (${correction.confidence}%)`
        } else if (data.current_poi_name) {
          poiInfo = `${data.current_poi_name} (${data.current_poi_city || 'cidade desconhecida'})`
        }
        
        console.log(`[${this.totalProcessed.toString().padStart(4, ' ')}] ${status} | ${poiInfo}`)
        
        // Show summary every 10
        if (this.totalProcessed % 10 === 0) {
          console.log(`      📊 Total: ${this.totalProcessed} | Correções: ${this.totalCorrections} | Rev.Manual: ${this.totalManualReviews} | Erros: ${this.totalErrors}`)
        }
      }

      return data.total_processed > 0
      
    } catch (error) {
      console.error('❌ Erro na Edge Function:', error)
      throw error
    }
  }

  private async showCurrentStats() {
    try {
      // Get current stats from API
      const response = await fetch('/api/pois/count', {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        }
      })

      if (response.ok) {
        const stats = await response.json()
        const data = stats.data
        
        const processed = data.processed_pois || 0
        const total = data.pois_with_coordinates || 0
        const remaining = total - processed
        const percentage = total > 0 ? ((processed / total) * 100).toFixed(2) : '0.00'
        
        const elapsed = (Date.now() - this.startTime) / 1000 / 60 // minutes
        const rate = elapsed > 0 ? (this.totalProcessed / elapsed).toFixed(1) : '0.0'
        
        console.log('\n📊 ESTATÍSTICAS:')
        console.log(`   Processados: ${processed.toLocaleString()} / ${total.toLocaleString()} (${percentage}%)`)
        console.log(`   Restantes: ${remaining.toLocaleString()}`)
        console.log(`   Esta sessão: ${this.totalProcessed} POIs (${rate} POIs/min)`)
        console.log(`   Correções: ${this.totalCorrections} | Rev.Manual: ${this.totalManualReviews} | Erros: ${this.totalErrors}`)
        
        if (remaining > 0 && this.totalProcessed > 0) {
          const eta = (remaining / (this.totalProcessed / elapsed)) // minutes remaining
          console.log(`   ETA: ${Math.round(eta)} minutos`)
        }
        
        console.log('')
        
      }
    } catch (error) {
      console.log('⚠️  Não foi possível obter estatísticas atuais')
    }
  }

  private showFinalStats() {
    const elapsed = (Date.now() - this.startTime) / 1000 / 60 // minutes
    const rate = elapsed > 0 ? (this.totalProcessed / elapsed).toFixed(1) : '0.0'
    
    console.log('\n🏁 RESUMO FINAL:')
    console.log(`   POIs processados: ${this.totalProcessed}`)
    console.log(`   Correções aplicadas: ${this.totalCorrections}`)
    console.log(`   Revisões manuais: ${this.totalManualReviews}`)
    console.log(`   Erros: ${this.totalErrors}`)
    console.log(`   Tempo total: ${elapsed.toFixed(1)} minutos`)
    console.log(`   Taxa: ${rate} POIs/minuto`)
    console.log('\n✅ Runner finalizado!')
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}

// Start the console runner
console.log('City Correction Console Runner')
console.log('==============================')
console.log('Pressione Ctrl+C para parar\n')

const runner = new CityCorrectionConsole()
runner.start().catch(console.error)
