import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '../../../lib/core/supabase-client'

const supabase = getSupabase('service')

export async function GET(request: NextRequest) {
  try {
    console.log('🔍 API: /api/duplicate-pois GET called')
    
    const url = new URL(request.url)
    const action = url.searchParams.get('action')
    
    if (action === 'stats') {
      // Buscar estatísticas
      console.log('📊 Fetching duplicate POIs statistics...')
      const { data: stats, error: statsError } = await supabase
        .schema('core')
        .rpc('get_duplicate_pois_stats')
      
      if (statsError) {
        console.error('❌ Error fetching stats:', statsError)
        return NextResponse.json({ error: 'Failed to fetch statistics', details: statsError }, { status: 500 })
      }
      
      console.log('✅ Stats fetched successfully:', stats?.length || 0, 'states')
      return NextResponse.json({ stats })
      
    } else if (action === 'analyze') {
      // Análise detalhada de um grupo específico
      const poiName = url.searchParams.get('poi_name')
      const cityName = url.searchParams.get('city_name')
      const stateName = url.searchParams.get('state_name')
      
      if (!poiName || !cityName || !stateName) {
        return NextResponse.json({ error: 'Missing required parameters: poi_name, city_name, state_name' }, { status: 400 })
      }
      
      console.log('🔍 Analyzing duplicate group:', { poiName, cityName, stateName })
      const { data: analysis, error: analysisError } = await supabase
        .schema('core')
        .rpc('analyze_duplicate_group', {
          input_poi_name: poiName,
          input_city_name: cityName,
          input_state_name: stateName
        })
      
      if (analysisError) {
        console.error('❌ Error analyzing group:', analysisError)
        return NextResponse.json({ error: 'Failed to analyze group', details: analysisError }, { status: 500 })
      }
      
      console.log('✅ Group analysis completed:', analysis?.length || 0, 'POIs')
      return NextResponse.json({ analysis })
      
    } else {
      // Buscar duplicatas (ação padrão) - usando abordagem paginada por estado
      console.log('🔍 Fetching duplicate POIs with pagination...')
      
      const states = ['SP', 'RJ', 'MG']
      const allDuplicates: any[] = []
      const pageSize = 1000
      
      for (const state of states) {
        console.log(`🔍 Processing state: ${state}`)
        
        // Primeiro, obter contagem total para o estado
        const { data: countData, error: countError } = await supabase
          .schema('core')
          .rpc('get_pois_count_by_state', { target_state: state })
        
        if (countError) {
          console.warn(`⚠️ Error counting POIs for ${state}:`, countError)
          continue
        }
        
        const totalPois = countData?.[0]?.total_pois || 0
        const totalPages = Math.ceil(totalPois / pageSize)
        
        console.log(`📊 State ${state}: ${totalPois} POIs, ${totalPages} pages`)
        
        // Processar cada página
        for (let page = 0; page < totalPages; page++) {
          const offset = page * pageSize
          console.log(`📄 Processing ${state} - page ${page + 1}/${totalPages} (offset: ${offset})`)
          
          const { data: pageDuplicates, error: pageError } = await supabase
            .schema('core')
            .rpc('check_duplicate_pois_paginated', {
              target_state: state,
              page_limit: pageSize,
              page_offset: offset
            })
          
          if (pageError) {
            console.error(`❌ Error fetching duplicates for ${state} page ${page}:`, pageError)
            continue
          }
          
          if (pageDuplicates && pageDuplicates.length > 0) {
            allDuplicates.push(...pageDuplicates)
            console.log(`✅ Found ${pageDuplicates.length} duplicate groups in ${state} page ${page + 1}`)
          }
        }
      }
      
      // Remover duplicatas que podem aparecer entre páginas (mesmo grupo em páginas diferentes)
      const uniqueDuplicates = allDuplicates.reduce((acc: any[], current: any) => {
        const existing = acc.find(dup => 
          dup.nome_normalizado === current.nome_normalizado &&
          dup.cidade === current.cidade &&
          dup.estado === current.estado
        )
        
        if (!existing) {
          acc.push(current)
        } else {
          // Se encontrar o mesmo grupo, mesclar os POIs
          const allIds = [...existing.ids_dos_pois, ...current.ids_dos_pois]
          const uniqueIds = [...new Set(allIds)]
          
          if (uniqueIds.length > existing.ids_dos_pois.length) {
            // Atualizar com todos os POIs únicos
            existing.total_pois = uniqueIds.length
            existing.ids_dos_pois = uniqueIds
            // Recalcular outros arrays baseados nos IDs únicos
            console.log(`🔄 Merged duplicate group: ${current.nome_normalizado} (${existing.total_pois} total POIs)`)
          }
        }
        
        return acc
      }, [])
      
      console.log('✅ All duplicates fetched successfully:', uniqueDuplicates.length, 'unique groups')
      return NextResponse.json({ duplicates: uniqueDuplicates })
    }
    
  } catch (error) {
    console.error('💥 Unexpected error in duplicate-pois API:', error)
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
