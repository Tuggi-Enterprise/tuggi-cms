import { getSupabase } from '../lib/core/supabase-client'
import * as dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'

dotenv.config()

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

// ============================================
// CONFIGURAÇÃO - Modifique apenas aqui
// ============================================
// Campo a ser buscado: 'category', 'primary_category' ou 'name'
const SEARCH_FIELD: 'category' | 'primary_category' | 'name' = 'name'

// Valor a ser buscado:
//   - 'unknown': busca por valores "unknown"
//   - 'yes': busca por valores "yes"
//   - 'other': busca por valor customizado (defina em SEARCH_VALUE_CUSTOM)
const SEARCH_VALUE: 'unknown' | 'yes' | 'other' = 'other'

// Valor customizado (use apenas se SEARCH_VALUE = 'other')
// Exemplo: 'Unnamed POI', 'null', 'building', etc.
const SEARCH_VALUE_CUSTOM: string | null = 'Unnamed POI'
// ============================================

interface Stats {
  totalPOIs: number
  processedPOIs: number
  updated: number
  notFound: number
  deleted: number // POIs deletados (estradas não turísticas)
  errors: number
  startTime: number
}

interface POI {
  uuid_id: string
  name: string
  lat: number
  lon: number
  city: string | null
  state: string | null
  country: string | null
  osm_id: number | null
  osm_type: string | null
}

interface CategoryData {
  category: string
  primary_category: string
  primary_category_type: string | null
  categories: string[] | null
}

interface NameAndCategoryData {
  name: string | null
  category: string | null
  primary_category: string | null
  primary_category_type: string | null
  categories: string[] | null
  nominatimResult?: any // Guardar resultado do Nominatim para validação
}

class CategoryRepairScript {
  private supabase = createClient(supabaseUrl, supabaseServiceKey)
  private stats: Stats = {
    totalPOIs: 0,
    processedPOIs: 0,
    updated: 0,
    notFound: 0,
    deleted: 0,
    errors: 0,
    startTime: Date.now()
  }
  private isRunning = false
  private lastNominatimRequest = 0
  private nominatimDelay = 1000 // 1 segundo entre requisições para respeitar rate limits
  
  // Configuração do script
  private get searchField(): 'category' | 'primary_category' | 'name' {
    return SEARCH_FIELD
  }
  
  private get searchValue(): string {
    if (SEARCH_VALUE === 'other') {
      if (!SEARCH_VALUE_CUSTOM) {
        throw new Error('SEARCH_VALUE_CUSTOM deve ser definido quando SEARCH_VALUE = "other"')
      }
      return SEARCH_VALUE_CUSTOM
    }
    return SEARCH_VALUE
  }

  async start() {
    console.log('🔧 Script de Reparação')
    console.log('==========================================')
    if (this.searchField === 'name') {
      console.log(`📋 Busca POIs com ${this.searchField}="${this.searchValue}" e tenta encontrar nome real via OSM/Nominatim`)
    } else {
      console.log(`📋 Busca POIs com ${this.searchField}="${this.searchValue}" e tenta encontrar categoria real via OSM/Nominatim`)
    }
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
          this.showFinalStats()
          break
        }

        await this.processPOI(poi)
      } catch (error) {
        this.stats.errors++
        console.error(`❌ Erro ao processar:`, error)
      }
    }
  }

  private async initializeStats() {
    const { count, error } = await this.supabase
      .schema('homolog')
      .from('pois')
      .select('*', { count: 'exact', head: true })
      .eq(this.searchField, this.searchValue)

    if (error) {
      console.error('❌ Erro ao contar POIs:', error)
      throw error
    }

    this.stats.totalPOIs = count || 0
    console.log(`📊 Total de POIs com ${this.searchField}="${this.searchValue}": ${this.stats.totalPOIs}\n`)
  }

  private processedUUIDs = new Set<string>()

  private async getNextPOI(): Promise<POI | null> {
    const { data, error } = await this.supabase
      .schema('homolog')
      .from('pois')
      .select('uuid_id, name, lat, lon, city, state, country, osm_id, osm_type')
      .eq(this.searchField, this.searchValue)
      .not('lat', 'is', null)
      .not('lon', 'is', null)
      .not('name', 'is', null)
      .limit(100) // Buscar vários para filtrar os já processados
      .order('created_at', { ascending: true })

    if (error) {
      if (error.code === 'PGRST116') {
        // No rows returned
        return null
      }
      console.error('❌ Erro ao buscar POI:', error)
      return null
    }

    if (!data || data.length === 0) {
      return null
    }

    // Encontrar o primeiro POI que ainda não foi processado
    for (const poi of data) {
      if (!this.processedUUIDs.has(poi.uuid_id)) {
        // Verificar se ainda tem o valor buscado (pode ter sido atualizado por outro processo)
        if (this.searchField === 'name' && poi.name !== this.searchValue) {
          this.processedUUIDs.add(poi.uuid_id)
          continue
        }
        if (this.searchField === 'category' && poi.category !== this.searchValue) {
          this.processedUUIDs.add(poi.uuid_id)
          continue
        }
        if (this.searchField === 'primary_category' && poi.primary_category !== this.searchValue) {
          this.processedUUIDs.add(poi.uuid_id)
          continue
        }
        
        this.processedUUIDs.add(poi.uuid_id)
        return poi as POI
      }
    }

    // Se todos foram processados, buscar mais
    return null
  }

  private async processPOI(poi: POI) {
    this.stats.processedPOIs++
    console.log(`\n[${this.stats.processedPOIs}/${this.stats.totalPOIs}] Processando: ${poi.name}`)
    console.log(`📍 Coordenadas: ${poi.lat}, ${poi.lon}`)
    console.log(`🏙️  Localização: ${poi.city || 'N/A'}, ${poi.state || 'N/A'}, ${poi.country || 'N/A'}`)
    if (poi.osm_id && poi.osm_type) {
      console.log(`🔖 OSM ID: ${poi.osm_type[0].toUpperCase()}${poi.osm_id}`)
    }

    try {
      // Se está buscando por nome, tentar encontrar novo nome E categoria
      if (this.searchField === 'name') {
        const nameAndCategory = await this.findNameAndCategoryForPOI(poi)
        
        if (!nameAndCategory || !nameAndCategory.name) {
          this.stats.notFound++
          console.log(`⚠️  Nome não encontrado no OSM/Nominatim`)
          return
        }

        // Validar se o nome não é uma rua/estrada
        if (nameAndCategory.name && this.isStreetName(nameAndCategory.name)) {
          // Se tem OSM ID e é uma estrada, deletar do banco
          if (poi.osm_id && poi.osm_type) {
            await this.deletePOI(poi.uuid_id, `Nome "${nameAndCategory.name}" é uma rua/estrada`)
            this.stats.deleted++
            return
          }
          this.stats.notFound++
          console.log(`⚠️  Nome "${nameAndCategory.name}" parece ser uma rua/estrada - pulando`)
          return
        }

        // Validar se a categoria é compatível com POI turístico
        // Usar o resultado do Nominatim que já foi buscado
        const isValid = this.isValidPOICategory(
          nameAndCategory.category,
          nameAndCategory.primary_category_type,
          nameAndCategory.nominatimResult
        )
        
        if (!isValid) {
          // Se tem OSM ID e não é POI turístico válido, deletar do banco
          if (poi.osm_id && poi.osm_type) {
            await this.deletePOI(poi.uuid_id, `Categoria "${nameAndCategory.category}" (${nameAndCategory.primary_category_type}) não é compatível com POI turístico`)
            this.stats.deleted++
            return
          }
          this.stats.notFound++
          console.log(`⚠️  Categoria "${nameAndCategory.category}" (${nameAndCategory.primary_category_type}) não é compatível com POI turístico - pulando`)
          return
        }

        // Preparar dados para atualização
        const updateData: any = {
          name: nameAndCategory.name
        }

        // Se encontrou categoria válida, atualizar também
        if (nameAndCategory.category && nameAndCategory.category !== 'unknown') {
          updateData.category = nameAndCategory.category
          updateData.primary_category = nameAndCategory.primary_category || nameAndCategory.category
          updateData.primary_category_type = nameAndCategory.primary_category_type
          updateData.categories = nameAndCategory.categories
        }

        // Verificar novamente se o POI ainda tem o valor buscado (evitar race conditions)
        const { data: currentPOI } = await this.supabase
          .schema('homolog')
          .from('pois')
          .select(this.searchField)
          .eq('uuid_id', poi.uuid_id)
          .single()

        if (!currentPOI || currentPOI[this.searchField] !== this.searchValue) {
          console.log(`⚠️  POI já foi atualizado por outro processo - pulando`)
          return
        }

        // Atualizar nome e categoria
        const { error: updateError } = await this.supabase
          .schema('homolog')
          .from('pois')
          .update(updateData)
          .eq('uuid_id', poi.uuid_id)
          .eq(this.searchField, this.searchValue) // Garantir que ainda tem o valor buscado

        if (updateError) {
          console.error(`❌ Erro ao atualizar nome/categoria:`, updateError)
          this.stats.errors++
          return
        }

        this.stats.updated++
        console.log(`✅ Nome atualizado: "${nameAndCategory.name}"`)
        if (nameAndCategory.category) {
          console.log(`   Categoria: "${nameAndCategory.category}" (${nameAndCategory.primary_category_type})`)
        }
        return
      }

      // Caso contrário, buscar categorias (comportamento original)
      const categoryData = poi.osm_id && poi.osm_type
        ? await this.searchCategoryByOSMId(poi)
        : await this.searchCategoryInNominatim(poi)

      if (!categoryData) {
        this.stats.notFound++
        console.log(`⚠️  Categoria não encontrada no OSM/Nominatim`)
        return
      }

      // Atualizar todos os campos de categoria
      const { error: updateError } = await this.supabase
        .schema('homolog')
        .from('pois')
        .update({
          category: categoryData.category,
          primary_category: categoryData.primary_category,
          primary_category_type: categoryData.primary_category_type,
          categories: categoryData.categories
        })
        .eq('uuid_id', poi.uuid_id)

      if (updateError) {
        console.error(`❌ Erro ao atualizar categorias:`, updateError)
        this.stats.errors++
        return
      }

      this.stats.updated++
      if (this.searchField === 'name') {
        // Já foi logado no processPOI
      } else {
        console.log(`✅ Categorias atualizadas:`)
        console.log(`   - category: "${categoryData.category}"`)
        console.log(`   - primary_category: "${categoryData.primary_category}"`)
        console.log(`   - primary_category_type: "${categoryData.primary_category_type}"`)
        console.log(`   - categories: ${JSON.stringify(categoryData.categories)}`)
      }
    } catch (error) {
      this.stats.errors++
      console.error(`❌ Erro ao processar POI:`, error)
    }
  }

  private async findNameAndCategoryForPOI(poi: POI): Promise<NameAndCategoryData | null> {
    // Se tiver OSM ID, usar lookup direto (mais rápido e preciso)
    if (poi.osm_id && poi.osm_type) {
      const result = await this.findNameAndCategoryByOSMId(poi)
      if (result && result.name) return result
    }
    
    // Fallback: buscar por coordenadas (reverse geocoding)
    return await this.findNameAndCategoryByCoordinates(poi)
  }


  private async findNameAndCategoryByOSMId(poi: POI): Promise<NameAndCategoryData | null> {
    // Respeitar rate limits do Nominatim
    const now = Date.now()
    const timeSinceLastRequest = now - this.lastNominatimRequest
    if (timeSinceLastRequest < this.nominatimDelay) {
      await new Promise(resolve => setTimeout(resolve, this.nominatimDelay - timeSinceLastRequest))
    }

    try {
      // Construir OSM ID no formato Nominatim (N12345, W67890, R12345)
      const osmTypePrefix = poi.osm_type?.charAt(0).toUpperCase() || 'N'
      const osmLookupId = `${osmTypePrefix}${poi.osm_id}`

      console.log(`🔍 Buscando nome e categoria por OSM ID: ${osmLookupId}`)

      const lookupUrl = `https://nominatim.openstreetmap.org/lookup?` +
        `osm_ids=${osmLookupId}&` +
        `format=json&extratags=1&addressdetails=1`

      const response = await fetch(lookupUrl, {
        headers: {
          'User-Agent': 'TuggiCMS/1.0 (name-repair) - Contact: leandro@tuggi.com.br'
        }
      })

      this.lastNominatimRequest = Date.now()

      if (!response.ok) {
        console.error(`❌ Nominatim lookup API error: ${response.status}`)
        return null
      }

      const results = await response.json()

      if (!results || results.length === 0) {
        console.log(`⚠️  Nenhum resultado encontrado no Nominatim lookup`)
        return null
      }

      // Usar o primeiro resultado (deve ser único para OSM ID)
      const result = results[0]
      const name = this.extractNameFromNominatim(result)
      const categoryData = this.extractCategoryDataFromNominatim(result)

      if (name && name !== 'Unnamed POI') {
        return {
          name,
          category: categoryData?.category || null,
          primary_category: categoryData?.primary_category || null,
          primary_category_type: categoryData?.primary_category_type || null,
          categories: categoryData?.categories || null,
          nominatimResult: result // Guardar para validação
        }
      }

      return null
    } catch (error) {
      console.error(`❌ Erro ao buscar nome/categoria por OSM ID:`, error)
      return null
    }
  }

  private async findNameAndCategoryByCoordinates(poi: POI): Promise<NameAndCategoryData | null> {
    try {
      console.log(`🔍 Tentando encontrar nome e categoria por coordenadas...`)

      const reverseUrl = `https://nominatim.openstreetmap.org/reverse?` +
        `lat=${poi.lat}&lon=${poi.lon}&` +
        `format=json&extratags=1&addressdetails=1`

      const response = await fetch(reverseUrl, {
        headers: {
          'User-Agent': 'TuggiCMS/1.0 (name-repair) - Contact: leandro@tuggi.com.br'
        }
      })

      if (!response.ok) {
        return null
      }

      const result = await response.json()

      if (result && result.error) {
        return null
      }

      const name = this.extractNameFromNominatim(result)
      const categoryData = this.extractCategoryDataFromNominatim(result)

      if (name && name !== 'Unnamed POI') {
        return {
          name,
          category: categoryData?.category || null,
          primary_category: categoryData?.primary_category || null,
          primary_category_type: categoryData?.primary_category_type || null,
          categories: categoryData?.categories || null,
          nominatimResult: result // Guardar para validação
        }
      }

      return null
    } catch (error) {
      console.error(`❌ Erro ao buscar nome/categoria por coordenadas:`, error)
      return null
    }
  }

  private extractNameFromNominatim(result: any): string | null {
    // Verificar se é realmente uma highway/road - se for, não devemos usar o nome
    const extratags = result.extratags || {}
    const isHighway = extratags.highway || result.class === 'highway' || 
                      (result.type && ['highway', 'road'].includes(result.type.toLowerCase()))
    
    if (isHighway) {
      // Se for highway mas tiver tourism/historic, pode ser um monumento/atração na rua
      // Mas se o nome começa com indicadores de rua, rejeitar
      const hasPOITag = extratags.tourism || extratags.historic || extratags.amenity || 
                        extratags.leisure || extratags.natural || extratags.shop
      
      if (!hasPOITag) {
        // É uma rua/estrada sem tags de POI - rejeitar
        return null
      }
    }

    // Prioridade: name específico, depois display_name, depois outros
    let name: string | null = null
    
    if (result.name && result.name.trim() && result.name !== 'Unnamed POI') {
      name = result.name.trim()
    } else if (result.display_name) {
      const parts = result.display_name.split(',')
      const firstPart = parts[0]?.trim()
      if (firstPart && firstPart !== 'Unnamed POI' && firstPart.length > 3) {
        name = firstPart
      }
    } else if (extratags.name && extratags.name.trim() && extratags.name !== 'Unnamed POI') {
      name = extratags.name.trim()
    } else if (result.namedetails?.name && result.namedetails.name.trim() && result.namedetails.name !== 'Unnamed POI') {
      name = result.namedetails.name.trim()
    }

    if (!name) {
      return null
    }

    // Validar se o nome não é claramente uma rua/estrada
    if (this.isStreetName(name)) {
      return null
    }

    return name
  }

  private isStreetName(name: string): boolean {
    const nameLower = name.toLowerCase().trim()
    
    // Palavras que indicam que é uma rua/estrada
    const streetIndicators = [
      'rua ', 'avenida ', 'av. ', 'alameda ', 'praça ', 'travessa ', 'estrada ',
      'rodovia ', 'br-', 'estrada ', 'via ', 'rua:', 'avenida:', 'av:',
      'rua.', 'avenida.', 'rodovia.', 'estrada.', 'praça.', 'alameda.',
      'rua', 'avenida', 'rodovia', 'estrada', 'praça', 'alameda'
    ]
    
    // Verificar se começa com indicador de rua
    for (const indicator of streetIndicators) {
      if (nameLower.startsWith(indicator) || nameLower.includes(' ' + indicator)) {
        // Mas permitir se for seguido de nome de pessoa ou lugar específico conhecido como POI
        // Por enquanto, rejeitar se começar com indicador de rua
        if (nameLower.startsWith(indicator)) {
          return true
        }
      }
    }

    // Verificar padrões de ruas (ex: "Rua X", "Av. Y")
    const streetPattern = /^(rua|avenida|av\.?|alameda|praça|travessa|estrada|rodovia|via)\s+/i
    if (streetPattern.test(name)) {
      return true
    }

    // Verificar se é apenas um número ou código de rodovia (ex: "BR-101", "1001")
    if (/^(br-|sp-|mg-|rj-|estrada|rodovia)/i.test(name) || /^\d+$/.test(name)) {
      return true
    }

    return false
  }

  private async deletePOI(uuid_id: string, reason: string): Promise<void> {
    try {
      console.log(`🗑️  Deletando POI: ${reason}`)
      
      const { error } = await this.supabase
        .schema('homolog')
        .from('pois')
        .delete()
        .eq('uuid_id', uuid_id)

      if (error) {
        console.error(`❌ Erro ao deletar POI:`, error)
        this.stats.errors++
      } else {
        console.log(`✅ POI deletado com sucesso`)
      }
    } catch (error) {
      console.error(`❌ Erro ao deletar POI:`, error)
      this.stats.errors++
    }
  }

  private isValidPOICategory(category: string | null, categoryType: string | null, result?: any): boolean {
    if (!category || !categoryType) {
      return false
    }

    // Verificar extratags para garantir que não é uma highway
    const extratags = result?.extratags || {}
    if (extratags.highway) {
      // Se tem tag highway, só aceitar se tiver tags explícitas de POI turístico
      const hasPOITag = extratags.tourism || extratags.historic || extratags.amenity || 
                        extratags.leisure || extratags.natural || extratags.shop ||
                        extratags.artwork_type || extratags.monument
      
      if (!hasPOITag) {
        return false
      }
    }

    // Categorias que NÃO são compatíveis com POIs turísticos
    const invalidTypes = ['highway', 'waterway', 'railway', 'boundary']
    
    if (invalidTypes.includes(categoryType)) {
      return false
    }

    // Se for 'place' mas não tiver outras tags de POI, rejeitar
    if (categoryType === 'place' && !extratags.tourism && !extratags.historic && !extratags.amenity) {
      return false
    }

    // Categorias válidas para POIs turísticos
    const validTypes = ['tourism', 'amenity', 'historic', 'leisure', 'natural', 'shop']
    
    if (validTypes.includes(categoryType)) {
      return true
    }

    // Building só se tiver tags específicas de POI
    if (categoryType === 'building') {
      return !!(extratags.tourism || extratags.historic || extratags.amenity || extratags.leisure)
    }

    // Outros tipos específicos que podem ser válidos
    if (categoryType === 'man_made' && ['tower', 'works', 'monument'].includes(category)) {
      return true
    }

    if (categoryType === 'landuse' && ['basin', 'apiary'].includes(category)) {
      return true
    }

    if (categoryType === 'office' || categoryType === 'aeroway') {
      return true
    }

    // Por padrão, rejeitar se não for uma categoria conhecida
    return false
  }

  private async searchCategoryByOSMId(poi: POI): Promise<CategoryData | null> {
    // Respeitar rate limits do Nominatim
    const now = Date.now()
    const timeSinceLastRequest = now - this.lastNominatimRequest
    if (timeSinceLastRequest < this.nominatimDelay) {
      await new Promise(resolve => setTimeout(resolve, this.nominatimDelay - timeSinceLastRequest))
    }

    try {
      // Construir OSM ID no formato Nominatim (N12345, W67890, R12345)
      const osmTypePrefix = poi.osm_type?.charAt(0).toUpperCase() || 'N'
      const osmLookupId = `${osmTypePrefix}${poi.osm_id}`

      console.log(`🔍 Buscando por OSM ID: ${osmLookupId}`)

      const lookupUrl = `https://nominatim.openstreetmap.org/lookup?` +
        `osm_ids=${osmLookupId}&` +
        `format=json&extratags=1&addressdetails=1`

      const response = await fetch(lookupUrl, {
        headers: {
          'User-Agent': 'TuggiCMS/1.0 (category-repair) - Contact: leandro@tuggi.com.br'
        }
      })

      this.lastNominatimRequest = Date.now()

      if (!response.ok) {
        console.error(`❌ Nominatim lookup API error: ${response.status}`)
        // Fallback para busca por nome
        return await this.searchCategoryInNominatim(poi)
      }

      const results = await response.json()

      if (!results || results.length === 0) {
        console.log(`⚠️  Nenhum resultado encontrado no Nominatim lookup`)
        // Fallback para busca por nome
        return await this.searchCategoryInNominatim(poi)
      }

      // Usar o primeiro resultado (deve ser único para OSM ID)
      const result = results[0]
      const categoryData = this.extractCategoryDataFromNominatim(result)

      if (categoryData && categoryData.category !== 'unknown') {
        console.log(`✅ Categorias encontradas via OSM ID: "${categoryData.category}" (${categoryData.primary_category_type})`)
        return categoryData
      }

      // Se não encontrou categoria válida, tentar busca por nome
      console.log(`⚠️  Categoria não encontrada via OSM ID, tentando busca por nome...`)
      return await this.searchCategoryInNominatim(poi)
    } catch (error) {
      console.error(`❌ Erro ao buscar por OSM ID:`, error)
      // Fallback para busca por nome
      return await this.searchCategoryInNominatim(poi)
    }
  }

  private async searchCategoryInNominatim(poi: POI): Promise<CategoryData | null> {
    // Respeitar rate limits do Nominatim
    const now = Date.now()
    const timeSinceLastRequest = now - this.lastNominatimRequest
    if (timeSinceLastRequest < this.nominatimDelay) {
      await new Promise(resolve => setTimeout(resolve, this.nominatimDelay - timeSinceLastRequest))
    }

    try {
      // Estratégia 1: Buscar por nome + localização
      const searchQuery = poi.city && poi.state
        ? `${poi.name}, ${poi.city}, ${poi.state}, ${poi.country || 'Brazil'}`
        : poi.name

      const nominatimUrl = `https://nominatim.openstreetmap.org/search?` +
        `q=${encodeURIComponent(searchQuery)}&` +
        `lat=${poi.lat}&lon=${poi.lon}&` +
        `bounded=1&viewbox=${poi.lon - 0.01},${poi.lat + 0.01},${poi.lon + 0.01},${poi.lat - 0.01}&` +
        `format=json&limit=5&addressdetails=1&extratags=1`

      console.log(`🔍 Buscando no Nominatim: "${searchQuery}"`)

      const response = await fetch(nominatimUrl, {
        headers: {
          'User-Agent': 'TuggiCMS/1.0 (category-repair) - Contact: leandro@tuggi.com.br'
        }
      })

      this.lastNominatimRequest = Date.now()

      if (!response.ok) {
        console.error(`❌ Nominatim API error: ${response.status}`)
        return null
      }

      const results = await response.json()

      if (!results || results.length === 0) {
        console.log(`⚠️  Nenhum resultado encontrado no Nominatim`)
        
        // Estratégia 2: Tentar reverse geocoding como fallback
        return await this.tryReverseGeocoding(poi)
      }

      // Processar resultados e encontrar o melhor match
      for (const result of results) {
        // Validar que o resultado é próximo geograficamente
        const distance = this.calculateDistance(
          poi.lat,
          poi.lon,
          parseFloat(result.lat),
          parseFloat(result.lon)
        )

        // Se estiver muito longe (mais de 1km), pular
        if (distance > 1000) {
          continue
        }

        // Validar similaridade do nome (simples)
        const resultName = (result.display_name || result.name || '').toLowerCase()
        const poiName = poi.name.toLowerCase()
        if (!this.hasReasonableNameSimilarity(poiName, resultName)) {
          continue
        }

        // Extrair dados de categoria do resultado
        const categoryData = this.extractCategoryDataFromNominatim(result)
        if (categoryData && categoryData.category !== 'unknown') {
          console.log(`✅ Categorias encontradas: "${categoryData.category}" (${categoryData.primary_category_type})`)
          return categoryData
        }
      }

      // Se não encontrou nos resultados, tentar reverse geocoding
      return await this.tryReverseGeocoding(poi)
    } catch (error) {
      console.error(`❌ Erro ao buscar no Nominatim:`, error)
      return null
    }
  }

  private async tryReverseGeocoding(poi: POI): Promise<CategoryData | null> {
    try {
      console.log(`🔍 Tentando reverse geocoding...`)

      const reverseUrl = `https://nominatim.openstreetmap.org/reverse?` +
        `lat=${poi.lat}&lon=${poi.lon}&` +
        `format=json&extratags=1&addressdetails=1`

      const response = await fetch(reverseUrl, {
        headers: {
          'User-Agent': 'TuggiCMS/1.0 (category-repair) - Contact: leandro@tuggi.com.br'
        }
      })

      if (!response.ok) {
        return null
      }

      const result = await response.json()

      if (result && result.error) {
        return null
      }

      // Validar nome similar
      const resultName = (result.display_name || result.name || '').toLowerCase()
      const poiName = poi.name.toLowerCase()
      if (!this.hasReasonableNameSimilarity(poiName, resultName)) {
        return null
      }

      const categoryData = this.extractCategoryDataFromNominatim(result)
      if (categoryData && categoryData.category !== 'unknown') {
        console.log(`✅ Categorias encontradas via reverse: "${categoryData.category}"`)
        return categoryData
      }

      return null
    } catch (error) {
      console.error(`❌ Erro no reverse geocoding:`, error)
      return null
    }
  }

  private extractCategoryDataFromNominatim(result: any): CategoryData | null {
    // Prioridade: usar extratags primeiro, depois class/type
    const extratags = result.extratags || {}
    const priorityTags = ['tourism', 'amenity', 'historic', 'natural', 'leisure', 'railway', 'public_transport', 'shop', 'highway', 'building']

    let primaryCategory: string | null = null
    let primaryCategoryType: string | null = null
    const allCategories: string[] = []

    // Primeiro: buscar tags específicas (não *=yes)
    for (const tag of priorityTags) {
      if (extratags[tag] && extratags[tag] !== 'yes') {
        primaryCategory = extratags[tag]
        primaryCategoryType = tag
        allCategories.push(`${tag}=${extratags[tag]}`)
        break
      }
    }

    // Segundo: se não encontrou, buscar tags com valor "yes" mas usar o tipo da tag
    if (!primaryCategory) {
      for (const tag of priorityTags) {
        if (extratags[tag] === 'yes') {
          // Se o tipo da tag é válido, usar ele como categoria
          if (tag !== 'building' && tag !== 'highway') { // building e highway são muito genéricos
            primaryCategory = tag
            primaryCategoryType = tag
            allCategories.push(`${tag}=yes`)
            break
          }
        }
      }
    }

    // Terceiro: se ainda não encontrou, usar class/type do Nominatim
    if (!primaryCategory && result.class && result.type) {
      // Se type não for genérico, usar type
      if (result.type !== 'yes' && result.type !== 'no') {
        primaryCategory = result.type
        primaryCategoryType = result.class
        allCategories.push(`${result.class}=${result.type}`)
      } else if (result.class !== 'place' && result.class !== 'boundary') {
        // Caso contrário, usar class se não for muito genérico
        if (result.class !== 'building' && result.class !== 'highway') {
          primaryCategory = result.class
          primaryCategoryType = result.class
          allCategories.push(`${result.class}=yes`)
        }
      }
    }

    // Quarto: buscar outras tags relevantes para o array categories
    for (const tag of priorityTags) {
      if (extratags[tag] && extratags[tag] !== 'yes') {
        const categoryStr = `${tag}=${extratags[tag]}`
        if (!allCategories.includes(categoryStr)) {
          allCategories.push(categoryStr)
        }
      } else if (extratags[tag] === 'yes' && !primaryCategory) {
        // Se ainda não temos categoria e encontramos *=yes, adicionar ao array
        const categoryStr = `${tag}=yes`
        if (!allCategories.includes(categoryStr)) {
          allCategories.push(categoryStr)
        }
      }
    }

    // Se encontrou apenas 'yes' ou 'no', ainda tentar usar primaryCategoryType como fallback
    // mas só se não for genérico
    if (!primaryCategory || primaryCategory === 'yes' || primaryCategory === 'no') {
      // Se temos um primaryCategoryType válido e não genérico, usar ele
      if (primaryCategoryType && 
          primaryCategoryType !== 'place' && 
          primaryCategoryType !== 'boundary' &&
          primaryCategoryType !== 'yes' &&
          primaryCategoryType !== 'no') {
        return {
          category: primaryCategoryType,
          primary_category: primaryCategoryType,
          primary_category_type: primaryCategoryType,
          categories: allCategories.length > 0 ? allCategories : [`${primaryCategoryType}=yes`]
        }
      }
      return null
    }

    // Construir objeto CategoryData
    return {
      category: primaryCategory,
      primary_category: primaryCategory,
      primary_category_type: primaryCategoryType,
      categories: allCategories.length > 0 ? allCategories : null
    }
  }

  private hasReasonableNameSimilarity(poiName: string, resultName: string): boolean {
    // Verificar se pelo menos uma palavra significativa do nome do POI aparece no resultado
    const poiWords = poiName.split(/\s+/).filter(w => w.length > 3)
    const resultWords = resultName.split(/\s+/).filter(w => w.length > 3)

    if (poiWords.length === 0) return true // Se não tem palavras significativas, aceitar

    const matches = poiWords.filter(word => 
      resultWords.some(rWord => rWord.includes(word) || word.includes(rWord))
    )

    // Se pelo menos 50% das palavras significativas aparecem, considerar similar
    return matches.length >= Math.ceil(poiWords.length * 0.5)
  }

  private calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371e3 // Raio da Terra em metros
    const φ1 = lat1 * Math.PI / 180
    const φ2 = lat2 * Math.PI / 180
    const Δφ = (lat2 - lat1) * Math.PI / 180
    const Δλ = (lon2 - lon1) * Math.PI / 180

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
      Math.cos(φ1) * Math.cos(φ2) *
      Math.sin(Δλ / 2) * Math.sin(Δλ / 2)
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))

    return R * c // Distância em metros
  }

  private showFinalStats() {
    const elapsed = ((Date.now() - this.stats.startTime) / 1000).toFixed(1)
    console.log('\n' + '='.repeat(50))
    console.log('📊 Estatísticas Finais')
    console.log('='.repeat(50))
    console.log(`Total de POIs com ${this.searchField}="${this.searchValue}": ${this.stats.totalPOIs}`)
    console.log(`POIs processados: ${this.stats.processedPOIs}`)
    if (this.searchField === 'name') {
      console.log(`✅ Nomes atualizados: ${this.stats.updated}`)
    } else {
      console.log(`✅ Categorias atualizadas: ${this.stats.updated}`)
    }
    console.log(`⚠️  Não encontrados: ${this.stats.notFound}`)
    console.log(`🗑️  POIs deletados (estradas não turísticas): ${this.stats.deleted}`)
    console.log(`❌ Erros: ${this.stats.errors}`)
    console.log(`⏱️  Tempo decorrido: ${elapsed}s`)
    console.log('='.repeat(50))
  }
}

// Executar script
const script = new CategoryRepairScript()
script.start().catch(error => {
  console.error('❌ Erro fatal:', error)
  process.exit(1)
})

