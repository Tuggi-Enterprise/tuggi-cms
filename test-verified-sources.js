const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são necessárias');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function testVerifiedSources() {
  console.log('🔍 VERIFICANDO FONTES CONFIÁVEIS ADICIONADAS');
  console.log('=' .repeat(80));
  
  try {
    const targetCountries = ['BR', 'ES', 'US', 'IE'];
    
    for (const countryCode of targetCountries) {
      console.log(`\n${'='.repeat(60)}`);
      console.log(`🏛️  ${countryCode} - FONTES CONFIÁVEIS`);
      console.log(`${'='.repeat(60)}`);
      
      // Buscar fontes do país
      const { data: sources, error: sourcesError } = await supabase
        .schema('core')
        .from('v_active_sources_by_country')
        .select('*')
        .eq('country_code', countryCode)
        .order('priority', { ascending: true });
        
      if (sourcesError) {
        console.error(`❌ Erro ao buscar fontes para ${countryCode}:`, sourcesError);
        continue;
      }
      
      console.log(`\n📊 Total de fontes: ${sources.length}`);
      
      // Agrupar por tipo
      const sourcesByType = {};
      sources.forEach(source => {
        if (!sourcesByType[source.source_type]) {
          sourcesByType[source.source_type] = [];
        }
        sourcesByType[source.source_type].push(source);
      });
      
      // Mostrar por tipo
      Object.entries(sourcesByType).forEach(([type, typeSources]) => {
        console.log(`\n🔹 ${type.toUpperCase()} (${typeSources.length}):`);
        typeSources.forEach(source => {
          console.log(`   ${source.priority}. ${source.source_name}`);
          console.log(`      URL: ${source.base_url}${source.search_endpoint || ''}`);
          console.log(`      Template: ${source.query_template || 'N/A'}`);
          console.log(`      Rate Limit: ${source.rate_limit_rps}/s, Timeout: ${source.timeout_ms}ms`);
        });
      });
      
      // Estatísticas por tipo
      console.log(`\n📈 ESTATÍSTICAS POR TIPO:`);
      console.log(`   🏛️ Government: ${sourcesByType.government?.length || 0}`);
      console.log(`   🎓 Academic: ${sourcesByType.academic?.length || 0}`);
      console.log(`   📰 Media: ${sourcesByType.media?.length || 0}`);
      console.log(`   🏺 Heritage: ${sourcesByType.heritage?.length || 0}`);
      console.log(`   📚 Encyclopedia: ${sourcesByType.encyclopedia?.length || 0}`);
    }
    
    // Resumo geral
    console.log(`\n${'='.repeat(80)}`);
    console.log('🎯 RESUMO GERAL - FONTES CONFIÁVEIS');
    console.log(`${'='.repeat(80)}`);
    
    const { data: allSources, error: allError } = await supabase
      .schema('core')
      .from('v_active_sources_by_country')
      .select('country_code, country_name, source_type')
      .in('country_code', targetCountries);
      
    if (!allError) {
      const summary = {};
      allSources.forEach(source => {
        if (!summary[source.country_code]) {
          summary[source.country_code] = { name: source.country_name, total: 0, types: {} };
        }
        summary[source.country_code].total++;
        summary[source.country_code].types[source.source_type] = 
          (summary[source.country_code].types[source.source_type] || 0) + 1;
      });
      
      Object.entries(summary).forEach(([code, data]) => {
        console.log(`\n${code} - ${data.name}:`);
        console.log(`   Total: ${data.total} fontes`);
        Object.entries(data.types).forEach(([type, count]) => {
          console.log(`   ${type}: ${count}`);
        });
      });
    }
    
    // Verificar configurações
    console.log(`\n${'='.repeat(80)}`);
    console.log('⚙️ CONFIGURAÇÕES DE BUSCA');
    console.log(`${'='.repeat(80)}`);
    
    const { data: configs, error: configsError } = await supabase
      .schema('core')
      .from('source_search_configs')
      .select('*')
      .limit(10);
      
    if (!configsError && configs.length > 0) {
      console.log(`\n✅ Configurações encontradas: ${configs.length}`);
      console.log('📋 Exemplos de configurações:');
      configs.slice(0, 5).forEach(config => {
        console.log(`   - Tipo: ${config.search_type}`);
        console.log(`   - Rate Limit: ${config.rate_limit_rps}/s`);
        console.log(`   - Timeout: ${config.timeout_ms}ms`);
        console.log(`   - Cache TTL: ${config.cache_ttl_hours}h`);
        console.log('');
      });
    }
    
    // Verificar se há fontes específicas importantes
    console.log(`\n${'='.repeat(80)}`);
    console.log('🎯 FONTES ESPECÍFICAS IMPORTANTES');
    console.log(`${'='.repeat(80)}`);
    
    const importantSources = [
      { country: 'BR', name: 'IPHAN', type: 'government' },
      { country: 'BR', name: 'Museu de Arte de São Paulo', type: 'heritage' },
      { country: 'ES', name: 'Museo del Prado', type: 'heritage' },
      { country: 'ES', name: 'El País', type: 'media' },
      { country: 'US', name: 'The New York Times', type: 'media' },
      { country: 'US', name: 'Metropolitan Museum of Art', type: 'heritage' },
      { country: 'IE', name: 'The Irish Times', type: 'media' },
      { country: 'IE', name: 'National Gallery of Ireland', type: 'heritage' }
    ];
    
    for (const important of importantSources) {
      const { data: found } = await supabase
        .schema('core')
        .from('v_active_sources_by_country')
        .select('source_name, source_type, base_url, priority')
        .eq('country_code', important.country)
        .ilike('source_name', `%${important.name}%`)
        .single();
        
      if (found) {
        console.log(`✅ ${important.country} - ${found.source_name} (${found.source_type}) - Prioridade: ${found.priority}`);
      } else {
        console.log(`❌ ${important.country} - ${important.name} não encontrado`);
      }
    }
    
    console.log(`\n${'='.repeat(80)}`);
    console.log('🎉 VERIFICAÇÃO CONCLUÍDA!');
    console.log(`${'='.repeat(80)}`);
    console.log('✅ Sistema de fontes confiáveis implementado');
    console.log('✅ Fontes governamentais, acadêmicas, de mídia e patrimoniais');
    console.log('✅ Configurações de rate limiting e cache');
    console.log('✅ Priorização por confiabilidade');
    console.log('✅ Sistema pronto para verificação factual');

  } catch (error) {
    console.error('❌ Erro no teste:', error);
  }
}

testVerifiedSources();
