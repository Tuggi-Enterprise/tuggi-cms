import { getSupabase } from '../lib/core/supabase-client'
import * as dotenv from 'dotenv'

dotenv.config()

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

interface Stats {
  totalPOIs: number
  processedPOIs: number
  corrections: number
  errors: number
  startTime: number
}

class SimpleCityCorrection {
  private supabase = createClient(supabaseUrl, supabaseServiceKey)
  private stats: Stats = {
    totalPOIs: 0,
    processedPOIs: 0,
    corrections: 0,
    errors: 0,
    startTime: Date.now()
  }
  private isRunning = false
  private lastNominatimRequest = 0
  private nominatimDelay = 500

  async start() {
    console.log('🚀 City Correction - Processamento Simples')
    console.log('==========================================')
    console.log('📊 Status de progresso simples e eficiente')
    console.log('⏹️  Pressione Ctrl+C para parar\n')
    
    this.isRunning = true
    
    // Handle Ctrl+C
    process.on('SIGINT', () => {
      console.log('\n\n⏹️  Parando...')
      this.showFinalStats()
      process.exit(0)
    })

    await this.initializeStats()
    
    while (this.isRunning) {
      try {
        const poi = await this.getNextPOI()
        
        if (!poi) {
          console.log('\n✅ Todos os POIs foram processados!')
          break
        }
        
        await this.processPOI(poi)
        this.stats.processedPOIs++
        
        // Show progress every 10 POIs
        if (this.stats.processedPOIs % 10 === 0) {
          this.showProgress()
        }
        
        // Detailed progress every 100 POIs
        if (this.stats.processedPOIs % 100 === 0) {
          this.showDetailedProgress()
        }
        
        await this.sleep(200)
        
      } catch (error) {
        console.error('❌ Erro:', error)
        this.stats.errors++
        await this.sleep(3000)
      }
    }
    
    this.showFinalStats()
  }

  private async initializeStats() {
    console.log('📊 Carregando estatísticas...')
    
    // Count total POIs with coordinates (with pagination to get ALL)
    console.log('   Contando POIs com coordenadas...')
    let allAttractionIds: string[] = []
    let offset = 0
    const batchSize = 1000
    
    while (true) {
      const { data: batch } = await this.supabase
        .schema('core')
        .from('attraction_coordinate')
        .select('attraction_id')
        .range(offset, offset + batchSize - 1)
      
      if (!batch || batch.length === 0) break
      
      allAttractionIds.push(...batch.map(c => c.attraction_id))
      offset += batchSize
      
      console.log(`   Processados: ${allAttractionIds.length.toLocaleString()} registros...`)
      
      if (batch.length < batchSize) break // Last batch
    }
    
    const uniqueIds = new Set(allAttractionIds)
    this.stats.totalPOIs = uniqueIds.size
    
    // Count already processed
    const { count: alreadyProcessed } = await this.supabase
      .schema('core')
      .from('attractions')
      .select('id', { count: 'exact', head: true })
      .not('city_correction_audit', 'is', null)
    
    this.stats.processedPOIs = alreadyProcessed || 0
    
    console.log(`✅ Total POIs: ${this.stats.totalPOIs.toLocaleString()}`)
    console.log(`✅ Já processados: ${this.stats.processedPOIs.toLocaleString()}`)
    console.log(`✅ Restantes: ${(this.stats.totalPOIs - this.stats.processedPOIs).toLocaleString()}`)
    console.log('')
  }

  private async getNextPOI() {
    // Get next unprocessed POI with coordinates
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
      .is('city_correction_audit', null)
      .limit(1)
      .single()
    
    if (error || !data) {
      return null
    }
    
    return {
      id: data.id,
      name: data.name,
      city: data.city,
      state: data.state,
      country: data.country,
      latitude: data.attraction_coordinate[0]?.latitude,
      longitude: data.attraction_coordinate[0]?.longitude
    }
  }

  private async processPOI(poi: any) {
    console.log(`[${this.stats.processedPOIs + 1}] 🔍 ${poi.name} (${poi.city})`)
    
    // Rate limiting
    await this.waitForNominatim()
    
    // Get city from Nominatim
    const nominatimCity = await this.getNominatimCity(poi.latitude, poi.longitude)
    
    let result = {
      needs_correction: false,
      suggested_city: null as string | null,
      confidence: 0,
      source: 'no_change'
    }
    
    if (nominatimCity && nominatimCity.toLowerCase() !== poi.city.toLowerCase()) {
      result = {
        needs_correction: true,
        suggested_city: nominatimCity,
        confidence: 85,
        source: 'nominatim'
      }
    }
    
    // Save result
    await this.saveResult(poi, result)
    
    if (result.needs_correction) {
      this.stats.corrections++
      console.log(`      ✅ Corrigido: ${poi.city} → ${result.suggested_city}`)
    } else {
      console.log('      ✓ OK')
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
          'User-Agent': 'TuggiCMS/1.0 (city-correction-simple)'
        }
      })
      
      if (!response.ok) return null
      
      const data = await response.json()
      if (!data.address) return null
      
      const address = data.address
      return address.city || address.town || address.municipality || 
             address.village || address.hamlet || address.county || null
      
    } catch (error) {
      console.error('❌ Nominatim error:', error)
      return null
    }
  }

  private async saveResult(poi: any, result: any) {
    const audit = {
      processed: true,
      processed_at: new Date().toISOString(),
      needs_correction: result.needs_correction,
      needs_manual_review: false,
      suggested_city: result.suggested_city,
      confidence: result.confidence,
      source: result.source,
      processing_method: 'simple_script'
    }

    const updateData: any = { city_correction_audit: audit }

    // Apply correction if high confidence
    if (result.needs_correction && result.confidence >= 85 && result.suggested_city) {
      updateData.city = result.suggested_city
    }

    const { error } = await this.supabase
      .schema('core')
      .from('attractions')
      .update(updateData)
      .eq('id', poi.id)

    if (error) throw error
  }

  private showProgress() {
    const percentage = ((this.stats.processedPOIs / this.stats.totalPOIs) * 100).toFixed(1)
    const elapsed = (Date.now() - this.stats.startTime) / 1000 / 60
    const rate = elapsed > 0 ? (this.stats.processedPOIs / elapsed).toFixed(1) : '0.0'
    
    console.log(`\n📊 Progresso: ${this.stats.processedPOIs.toLocaleString()}/${this.stats.totalPOIs.toLocaleString()} (${percentage}%) - ${rate} POIs/min`)
  }

  private showDetailedProgress() {
    const percentage = ((this.stats.processedPOIs / this.stats.totalPOIs) * 100).toFixed(1)
    const elapsed = (Date.now() - this.stats.startTime) / 1000 / 60
    const rate = elapsed > 0 ? (this.stats.processedPOIs / elapsed).toFixed(1) : '0.0'
    const remaining = this.stats.totalPOIs - this.stats.processedPOIs
    const eta = rate !== '0.0' ? (remaining / parseFloat(rate) / 60).toFixed(1) : '∞'
    
    console.log('\n🎯 PROGRESSO DETALHADO:')
    console.log(`   📊 Progresso: ${this.stats.processedPOIs.toLocaleString()}/${this.stats.totalPOIs.toLocaleString()} (${percentage}%)`)
    console.log(`   ✅ Correções: ${this.stats.corrections.toLocaleString()}`)
    console.log(`   ❌ Erros: ${this.stats.errors.toLocaleString()}`)
    console.log(`   ⏱️  Taxa: ${rate} POIs/min`)
    console.log(`   🕐 ETA: ${eta} horas restantes`)
    console.log('')
  }

  private showFinalStats() {
    const elapsed = (Date.now() - this.stats.startTime) / 1000 / 60
    const rate = elapsed > 0 ? (this.stats.processedPOIs / elapsed).toFixed(1) : '0.0'
    
    console.log('\n🏁 RESUMO FINAL:')
    console.log(`   POIs processados: ${this.stats.processedPOIs.toLocaleString()}`)
    console.log(`   Correções aplicadas: ${this.stats.corrections.toLocaleString()}`)
    console.log(`   Erros: ${this.stats.errors.toLocaleString()}`)
    console.log(`   Tempo total: ${elapsed.toFixed(1)} minutos`)
    console.log(`   Taxa média: ${rate} POIs/minuto`)
    console.log('\n✅ Processamento finalizado!')
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}

const service = new SimpleCityCorrection()
service.start().catch(console.error)
