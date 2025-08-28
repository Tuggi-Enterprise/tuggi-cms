#!/usr/bin/env tsx

/**
 * Script para testar a detecção melhorada de MultiPolygon
 */

const IBIRAPUERA_COORDS = { lat: -23.585960, lng: -46.658435 }
const IBIRAPUERA_NAME = 'Parque Ibirapuera'

async function testMultiPolygonDetection() {
  console.log('🧪 Testando detecção melhorada de MultiPolygon')
  console.log('=' * 60)
  console.log(`📍 Testando com: ${IBIRAPUERA_NAME}`)
  console.log(`🌍 Coordenadas: ${IBIRAPUERA_COORDS.lat}, ${IBIRAPUERA_COORDS.lng}`)
  console.log('')

  try {
    console.log('🚀 Chamando API melhorada...')
    
    const response = await fetch('http://localhost:3000/api/poi-boundaries/detect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        attraction_id: '66e082b7-744a-4c93-8fbb-f039d3f34e64',
        poi_lat: IBIRAPUERA_COORDS.lat,
        poi_lng: IBIRAPUERA_COORDS.lng,
        poi_name: IBIRAPUERA_NAME
      })
    })

    if (!response.ok) {
      throw new Error(`API Error: ${response.status} ${response.statusText}`)
    }

    const result = await response.json()
    
    console.log('📊 RESULTADOS:')
    console.log(`✅ Sucesso: ${result.success}`)
    
    if (result.success && result.boundary) {
      console.log(`📐 Área: ${result.boundary.area_m2.toLocaleString()}m²`)
      console.log(`📏 Perímetro: ${result.boundary.perimeter_m.toLocaleString()}m`)
      console.log(`🎯 Confiança: ${(result.boundary.confidence * 100).toFixed(1)}%`)
      console.log(`🗺️ Vértices: ${result.boundary.coordinates.length}`)
      console.log(`📍 Trigger Points: ${result.trigger_points?.length || 0}`)
      
      console.log('\n🎯 ANÁLISE:')
      
      if (result.boundary.coordinates.length > 100) {
        console.log('✅ Muitos vértices detectados - provavelmente capturou MultiPolygon!')
      } else {
        console.log('⚠️ Poucos vértices - pode ser apenas o polígono principal')
      }
      
      if (result.boundary.area_m2 > 1500000) { // > 1.5km²
        console.log('✅ Área grande - provavelmente incluiu todas as partes do parque!')
      } else {
        console.log('⚠️ Área menor que esperada - pode ter perdido algumas partes')
      }
      
    } else {
      console.log(`❌ Erro: ${result.error}`)
    }

  } catch (error) {
    console.error('❌ Erro no teste:', error)
  }
}

// Executar teste
testMultiPolygonDetection().catch(console.error)
