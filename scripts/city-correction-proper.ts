import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'

dotenv.config()

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

interface POI {
  id: string
  name: string
  city: string
  state?: string
  country: string
  latitude: number
  longitude: number
  already_processed: boolean
}

interface ProcessingStats {
  totalPOIs: number
  processedPOIs: number
  pendingPOIs: number
  currentBatch: number
  totalBatches: number
  corrections: number
  manualReviews: number
  errors: number
  skipped: number
  startTime: number
}

class CityCorrectionsService {
  private supabase = createClient(supabaseUrl, supabaseServiceKey)
  private stats: ProcessingStats = {
    totalPOIs: 0,
    processedPOIs: 0,
    pendingPOIs: 0,
    currentBatch: 0,
    totalBatches: 0,
    corrections: 0,
    manualReviews: 0,
    errors: 0,
    skipped: 0,
    startTime: Date.now()
  }
  
  private batchSize = 100  // Voltar para 100 (cursor-based é mais eficiente)
  private isRunning = false
  private lastProcessedId = ''  // Cursor para pagination
  
  // Rate limiters
  private lastNominatimRequest = 0
  private nominatimDelay = 500 // 0.5 seconds

  async start() {
    console.log('🚀 City Correction Service - CURSOR-BASED PAGINATION')
    console.log('==================================================')
    console.log('🔄 Processando TODOS os POIs (cursor-based, sem offset)')
    console.log('🎯 Aplicando correções com confiança ≥ 85%')
    console.log('📊 Batches de 100 POIs - Rate limit 0.5s')
    console.log('⚡ Correção: cursor-based pagination (sem timeouts)')
    console.log('⏹️  Pressione Ctrl+C para parar\n')
    
    this.isRunning = true
    
    // Handle Ctrl+C to stop gracefully
    process.on('SIGINT', () => {
      console.log('\n\n⏹️  Parando o processamento...')
      this.showFinalStats()
      this.isRunning = false
      process.exit(0)
    })

    await this.initializeStats()
    
    while (this.isRunning && this.stats.currentBatch < this.stats.totalBatches) {
      try {
        await this.processBatch()
        
        // Show progress every batch
        this.showProgress()
        
        // Detailed progress every 5 batches
        if (this.stats.currentBatch % 5 === 0) {
          this.showDetailedProgress()
        }
        
        // Small delay between batches
        await this.sleep(500)
        
      } catch (error) {
        console.error(`❌ Erro no batch ${this.stats.currentBatch}:`, error)
        this.stats.errors++
        await this.sleep(3000)
      }
    }
    
    this.showFinalStats()
  }

  private async initializeStats() {
    console.log('📊 Inicializando estatísticas...')
    
    // Get ALL POIs with coordinates (bypass 1000 limit)
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
      
      console.log(`   Processados: ${allAttractionIds.length.toLocaleString()} registros de coordenadas...`)
      
      if (batch.length < batchSize) break // Last batch
    }
    
    const uniqueIds = new Set(allAttractionIds)
    this.stats.totalPOIs = uniqueIds.size
    
    // Count already processed
    const { count: processedCount } = await this.supabase
      .schema('core')
      .from('attractions')
      .select('id', { count: 'exact', head: true })
      .not('city_correction_audit', 'is', null)
    
    this.stats.processedPOIs = processedCount || 0
    this.stats.pendingPOIs = this.stats.totalPOIs - this.stats.processedPOIs
    this.stats.totalBatches = Math.ceil(this.stats.totalPOIs / this.batchSize)
    
    console.log(`✅ Total POIs com coordenadas: ${this.stats.totalPOIs.toLocaleString()}`)
    console.log(`✅ Já processados: ${this.stats.processedPOIs.toLocaleString()}`)
    console.log(`✅ Pendentes: ${this.stats.pendingPOIs.toLocaleString()}`)
    console.log(`✅ Total de batches: ${this.stats.totalBatches.toLocaleString()}`)
    console.log('')
  }

  private async processBatch() {
    this.stats.currentBatch++
    
    // Use cursor-based pagination (much faster than offset)
    let query = this.supabase
      .schema('core')
      .from('attractions')
      .select(`
        id,
        name,
        city,
        state,
        country,
        city_correction_audit,
        attraction_coordinate!inner(latitude, longitude)
      `)
      .order('id') // Deterministic ordering
      .limit(this.batchSize)
    
    // If not first batch, use cursor
    if (this.lastProcessedId) {
      query = query.gt('id', this.lastProcessedId)
    }
    
    const { data: poisData, error } = await query
    
    if (error) {
      throw new Error(`Error fetching POIs: ${error.message}`)
    }
    
    if (!poisData || poisData.length === 0) {
      console.log('✅ Nenhum POI restante para processar!')
      this.isRunning = false
      return
    }
    
    // Transform data
    const pois: POI[] = poisData.map((poi: any) => ({
      id: poi.id,
      name: poi.name,
      city: poi.city,
      state: poi.state,
      country: poi.country,
      latitude: poi.attraction_coordinate[0]?.latitude,
      longitude: poi.attraction_coordinate[0]?.longitude,
      already_processed: !!poi.city_correction_audit
    })).filter(poi => poi.latitude && poi.longitude)
    
    // Process each POI in the batch
    for (const poi of pois) {
      if (!this.isRunning) break
      
      try {
        await this.processSinglePOI(poi)
        // Update cursor to last processed ID
        this.lastProcessedId = poi.id
      } catch (error) {
        console.error(`❌ Erro processando ${poi.name}:`, error)
        this.stats.errors++
      }
    }
  }

  private currentPoiCount = 0

  private async processSinglePOI(poi: POI) {
    this.currentPoiCount++
    console.log(`[${this.currentPoiCount.toString().padStart(5, ' ')}] 🔍 ${poi.name} (${poi.city})`)
    
    if (poi.already_processed) {
      console.log('      🔄 Reprocessando (já tinha audit)')
    }
    
    // Rate limiting
    await this.waitForNominatim()
    
    // Get city from Nominatim
    const nominatimCity = await this.getNominatimCity(poi.latitude, poi.longitude)
    
    let result = {
      needs_correction: false,
      needs_manual_review: false,
      suggested_city: null as string | null,
      confidence: 0,
      source: 'no_change'
    }
    
    // Simple validation
    if (nominatimCity && nominatimCity.toLowerCase() !== poi.city.toLowerCase()) {
      result = {
        needs_correction: true,
        needs_manual_review: false,
        suggested_city: nominatimCity,
        confidence: 85,
        source: 'nominatim'
      }
    }
    
    // Save result
    await this.saveResult(poi, result)
    
    // Update stats
    if (result.needs_correction) {
      this.stats.corrections++
      console.log(`      ✅ Corrigido: ${poi.city} → ${result.suggested_city}`)
    } else if (result.needs_manual_review) {
      this.stats.manualReviews++
      console.log(`      📋 Rev.Manual: ${poi.city} → ${result.suggested_city}`)
    } else {
      console.log('      ✓ OK')
    }
    
    if (poi.already_processed) {
      this.stats.skipped++
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
          'User-Agent': 'TuggiCMS/1.0 (city-correction-proper)'
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

  private async saveResult(poi: POI, result: any) {
    const audit = {
      processed: true,
      processed_at: new Date().toISOString(),
      needs_correction: result.needs_correction,
      needs_manual_review: result.needs_manual_review,
      suggested_city: result.suggested_city,
      confidence: result.confidence,
      source: result.source,
      processing_method: 'proper_script'
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
      throw error
    }
  }

  private showProgress() {
    const processed = this.currentPoiCount
    const percentage = ((processed / this.stats.totalPOIs) * 100).toFixed(2)
    const elapsed = (Date.now() - this.stats.startTime) / 1000 / 60
    const rate = elapsed > 0 ? (processed / elapsed).toFixed(1) : '0.0'
    
    console.log(`\n📊 Batch ${this.stats.currentBatch} (${percentage}%) - ${rate} POIs/min - Cursor: ${this.lastProcessedId.slice(-8)}`)
  }

  private showDetailedProgress() {
    const processed = ((this.stats.currentBatch - 1) * this.batchSize)
    const percentage = ((processed / this.stats.totalPOIs) * 100).toFixed(2)
    const elapsed = (Date.now() - this.stats.startTime) / 1000 / 60
    const rate = elapsed > 0 ? (processed / elapsed).toFixed(1) : '0.0'
    const eta = rate !== '0.0' ? ((this.stats.totalPOIs - processed) / parseFloat(rate) / 60).toFixed(1) : '∞'
    
    console.log('\n🎯 PROGRESSO DETALHADO:')
    console.log(`   ✅ Processados: ${processed.toLocaleString()} / ${this.stats.totalPOIs.toLocaleString()} (${percentage}%)`)
    console.log(`   🔧 Correções: ${this.stats.corrections.toLocaleString()}`)
    console.log(`   📋 Rev.Manual: ${this.stats.manualReviews.toLocaleString()}`)
    console.log(`   🔄 Reprocessados: ${this.stats.skipped.toLocaleString()}`)
    console.log(`   ❌ Erros: ${this.stats.errors.toLocaleString()}`)
    console.log(`   ⏱️  Taxa: ${rate} POIs/min`)
    console.log(`   🕐 ETA: ${eta} horas restantes`)
    console.log('')
  }

  private showFinalStats() {
    const elapsed = (Date.now() - this.stats.startTime) / 1000 / 60
    const processed = ((this.stats.currentBatch - 1) * this.batchSize)
    const rate = elapsed > 0 ? (processed / elapsed).toFixed(1) : '0.0'
    
    console.log('\n🏁 RESUMO FINAL:')
    console.log(`   POIs processados: ${processed.toLocaleString()}`)
    console.log(`   Correções aplicadas: ${this.stats.corrections.toLocaleString()}`)
    console.log(`   Revisões manuais: ${this.stats.manualReviews.toLocaleString()}`)
    console.log(`   Reprocessados: ${this.stats.skipped.toLocaleString()}`)
    console.log(`   Erros: ${this.stats.errors.toLocaleString()}`)
    console.log(`   Tempo total: ${elapsed.toFixed(1)} minutos`)
    console.log(`   Taxa média: ${rate} POIs/minuto`)
    console.log('\n✅ Processamento finalizado!')
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}

const service = new CityCorrectionsService()
service.start().catch(console.error)
