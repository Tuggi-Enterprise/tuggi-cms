import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'

// Load environment variables
dotenv.config()

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

interface POILocation {
  id: string
  name: string
  latitude: number
  longitude: number
  city: string
  state?: string
  country: string
}

class DirectCityCorrectionService {
  private supabase = createClient(supabaseUrl, supabaseServiceKey)
  private isRunning = false
  private totalProcessed = 0
  private totalCorrections = 0
  private totalManualReviews = 0
  private totalErrors = 0
  private totalAlreadyProcessed = 0
  private currentOffset = 0
  private startTime = Date.now()

  // Rate limiters
  private lastNominatimRequest = 0
  private lastGeonamesRequest = 0
  private nominatimDelay = 500 // 0.5 second (faster)
  private geonamesDelay = 1000 // 1 second

  async start() {
    console.log('🚀 Iniciando City Correction Direct Service...\n')
    
    this.isRunning = true
    
    // Handle Ctrl+C to stop gracefully
    process.on('SIGINT', () => {
      console.log('\n\n⏹️  Parando o runner...')
      this.showFinalStats()
      this.isRunning = false
      process.exit(0)
    })

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
        
        // Show detailed progress every 100 POIs
        if (this.totalProcessed % 100 === 0) {
          this.showDetailedProgress()
        }
        
        // Small delay between POIs
        await this.sleep(200)
        
      } catch (error) {
        console.error('❌ Erro no ciclo:', error)
        this.totalErrors++
        await this.sleep(3000)
      }
    }
    
    this.showFinalStats()
  }

  private async processSinglePOI(): Promise<boolean> {
    try {
      // Get next POI to process
      const pois = await this.getPOIsForCorrection(1)
      
      if (pois.length === 0) {
        return false
      }

      const poi = pois[0]
      console.log(`[${(this.totalProcessed + 1).toString().padStart(4, ' ')}] 🔍 ${poi.name} (${poi.city})`)

      // Check if already processed (but we'll reprocess anyway)
      const alreadyProcessed = await this.checkIfAlreadyProcessed(poi.id)
      if (alreadyProcessed) {
        this.totalAlreadyProcessed++
        console.log(`      🔄 Reprocessando (já tinha audit)`)
      }

      // Process the POI directly
      const result = await this.verifyCityDirect(poi)
      
      // Save result to database
      await this.saveResult(poi, result)
      
      this.totalProcessed++
      
      if (result.needs_correction) {
        this.totalCorrections++
        console.log(`      ✅ Corrigido: ${poi.city} → ${result.suggested_city}`)
      } else if (result.needs_manual_review) {
        this.totalManualReviews++
        console.log(`      📋 Rev.Manual: ${poi.city} → ${result.suggested_city}`)
      } else {
        console.log(`      ✓ OK`)
      }

      return true
      
    } catch (error) {
      console.error('❌ Erro processando POI:', error)
      this.totalErrors++
      return true // Continue with next POI
    }
  }

  private async getPOIsForCorrection(limit: number = 1): Promise<POILocation[]> {
    const { data, error } = await this.supabase
      .schema('core')
      .from('attractions')
      .select(`
        id, 
        name, 
        city, 
        state, 
        country,
        attraction_coordinate!inner(latitude, longitude)
      `)
      // Remove the audit filter - process ALL POIs
      .limit(limit)
    
    if (error) {
      throw new Error(`Error fetching POIs: ${error.message}`)
    }
    
    // Transform to flat structure
    return (data || []).map((poi: any) => ({
      id: poi.id,
      name: poi.name,
      city: poi.city,
      state: poi.state,
      country: poi.country,
      latitude: poi.attraction_coordinate[0]?.latitude,
      longitude: poi.attraction_coordinate[0]?.longitude
    })).filter((poi: any) => poi.latitude && poi.longitude)
  }

  private async checkIfAlreadyProcessed(poiId: string): Promise<boolean> {
    try {
      const { data, error } = await this.supabase
        .schema('core')
        .from('attractions')
        .select('city_correction_audit')
        .eq('id', poiId)
        .single()
      
      if (error) return false
      return !!data?.city_correction_audit
    } catch {
      return false
    }
  }

  private async verifyCityDirect(poi: POILocation) {
    // Rate limiting
    await this.waitForNominatim()
    
    // Get city from Nominatim
    const nominatimCity = await this.getNominatimCity(poi.latitude, poi.longitude)
    
    // Simple validation
    if (nominatimCity && nominatimCity.toLowerCase() !== poi.city.toLowerCase()) {
      return {
        needs_correction: true,
        needs_manual_review: false,
        suggested_city: nominatimCity,
        confidence: 85,
        source: 'nominatim'
      }
    }
    
    return {
      needs_correction: false,
      needs_manual_review: false,
      suggested_city: null,
      confidence: 0,
      source: 'no_change'
    }
  }

  private async waitForNominatim() {
    const now = Date.now()
    const timeSinceLastRequest = now - this.lastNominatimRequest
    
    if (timeSinceLastRequest < this.nominatimDelay) {
      const waitTime = this.nominatimDelay - timeSinceLastRequest
      await this.sleep(waitTime)
    }
    
    this.lastNominatimRequest = Date.now()
  }

  private async getNominatimCity(lat: number, lng: number): Promise<string | null> {
    try {
      const url = `https://nominatim.openstreetmap.org/reverse?` +
        `lat=${lat}&lon=${lng}&format=json&addressdetails=1&zoom=10`
      
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'TuggiCMS/1.0 (city-correction-direct)'
        }
      })
      
      if (!response.ok) {
        return null
      }
      
      const data = await response.json()
      
      if (!data.address) {
        return null
      }
      
      const address = data.address
      const city = address.city || 
                  address.town || 
                  address.municipality || 
                  address.village || 
                  address.hamlet ||
                  address.county
      
      return city || null
      
    } catch (error) {
      console.error('❌ Nominatim error:', error)
      return null
    }
  }

  private async saveResult(poi: POILocation, result: any) {
    const audit = {
      processed: true,
      processed_at: new Date().toISOString(),
      needs_correction: result.needs_correction,
      needs_manual_review: result.needs_manual_review,
      suggested_city: result.suggested_city,
      confidence: result.confidence,
      source: result.source,
      processing_method: 'direct_script'
    }

    // Prepare update object
    const updateData: any = {
      city_correction_audit: audit
    }

    // If needs correction with high confidence, update the city field
    if (result.needs_correction && result.confidence >= 85 && result.suggested_city) {
      updateData.city = result.suggested_city
      console.log(`      🔄 Atualizando cidade: ${poi.city} → ${result.suggested_city}`)
    }

    const { error } = await this.supabase
      .schema('core')
      .from('attractions')
      .update(updateData)
      .eq('id', poi.id)

    if (error) {
      console.error(`❌ Erro salvando resultado para ${poi.name}:`, error)
      throw error
    }
  }

  private async showCurrentStats() {
    try {
      const { count: totalPOIs } = await this.supabase
        .schema('core')
        .from('attractions')
        .select('id', { count: 'exact', head: true })
        .not('attraction_coordinate', 'is', null)

      // Count POIs processed in this session (use a different approach)
      // For now, just show session progress vs total
      const processedPOIs = this.totalProcessed

      const total = totalPOIs || 0
      const processed = processedPOIs || 0
      const remaining = total - processed
      const percentage = total > 0 ? ((processed / total) * 100).toFixed(2) : '0.00'
      
      const elapsed = (Date.now() - this.startTime) / 1000 / 60 // minutes
      const rate = elapsed > 0 ? (this.totalProcessed / elapsed).toFixed(1) : '0.0'
      
      console.log('\n📊 ESTATÍSTICAS:')
      console.log(`   Processados: ${processed.toLocaleString()} / ${total.toLocaleString()} (${percentage}%)`)
      console.log(`   Restantes: ${remaining.toLocaleString()}`)
      console.log(`   Esta sessão: ${this.totalProcessed} POIs (${rate} POIs/min)`)
      console.log(`   Reprocessados: ${this.totalAlreadyProcessed} | Novos: ${this.totalProcessed - this.totalAlreadyProcessed}`)
      console.log(`   Correções: ${this.totalCorrections} | Rev.Manual: ${this.totalManualReviews} | Erros: ${this.totalErrors}`)
      console.log('')
      
    } catch (error) {
      console.log('⚠️  Não foi possível obter estatísticas atuais')
    }
  }

  private showDetailedProgress() {
    const elapsed = (Date.now() - this.startTime) / 1000 / 60
    const rate = elapsed > 0 ? (this.totalProcessed / elapsed).toFixed(1) : '0.0'
    const eta = rate > 0 ? ((21800 - this.totalProcessed) / (parseFloat(rate) * 60)).toFixed(1) : '∞'
    
    console.log('\n🎯 PROGRESSO DETALHADO:')
    console.log(`   ✅ Processados: ${this.totalProcessed.toLocaleString()}`)
    console.log(`   🔄 Reprocessados: ${this.totalAlreadyProcessed.toLocaleString()}`)
    console.log(`   🆕 Novos: ${(this.totalProcessed - this.totalAlreadyProcessed).toLocaleString()}`)
    console.log(`   🔧 Correções: ${this.totalCorrections.toLocaleString()}`)
    console.log(`   📋 Rev.Manual: ${this.totalManualReviews.toLocaleString()}`)
    console.log(`   ❌ Erros: ${this.totalErrors.toLocaleString()}`)
    console.log(`   ⏱️  Taxa: ${rate} POIs/min`)
    console.log(`   🕐 ETA: ${eta} horas restantes`)
    console.log('')
  }

  private showFinalStats() {
    const elapsed = (Date.now() - this.startTime) / 1000 / 60
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

// Start the direct service
console.log('City Correction Direct Service - REPROCESSAMENTO COMPLETO')
console.log('=========================================================')
console.log('🔄 Processando TODOS os POIs (incluindo já processados)')
console.log('🎯 Aplicando correções com confiança ≥ 85%')
console.log('📊 Processamento direto sem Edge Function')
console.log('⏹️  Pressione Ctrl+C para parar\n')

const service = new DirectCityCorrectionService()
service.start().catch(console.error)
