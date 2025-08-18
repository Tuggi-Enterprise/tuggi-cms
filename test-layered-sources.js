const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Variáveis de ambiente não encontradas');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function testLayeredSources() {
  console.log('🏛️ Testando sistema de fontes em camadas...\n');

  try {
    // Testar função de fontes em camadas
    console.log('📊 Testando função get_verification_sources_layered...\n');

    // Teste 1: São Paulo, Brasil
    console.log('🇧🇷 Teste 1: São Paulo, Brasil');
    console.log('─'.repeat(50));
    
    const { data: spSources, error: spError } = await supabase
      .schema('core')
      .rpc('get_verification_sources_layered', {
        p_city_name: 'São Paulo',
        p_country_code: 'BR',
        p_limit: 10
      });

    if (spError) {
      console.error('❌ Erro ao buscar fontes de São Paulo:', spError);
    } else {
      console.log(`✅ Encontradas ${spSources.length} fontes para São Paulo:`);
      
      const nationalSources = spSources.filter(s => s.layer === 'national');
      const citySources = spSources.filter(s => s.layer === 'city');
      
      console.log(`🏛️ Fontes NACIONAIS (${nationalSources.length}):`);
      nationalSources.forEach(source => {
        console.log(`  • ${source.source_name} (${source.source_type}) - Prioridade: ${source.priority}`);
      });
      
      console.log(`🏙️ Fontes de CIDADE (${citySources.length}):`);
      citySources.forEach(source => {
        console.log(`  • ${source.source_name} (${source.source_type}) - Prioridade: ${source.priority}`);
      });
    }

    console.log('\n' + '─'.repeat(50) + '\n');

    // Teste 2: Rio de Janeiro, Brasil
    console.log('🇧🇷 Teste 2: Rio de Janeiro, Brasil');
    console.log('─'.repeat(50));
    
    const { data: rjSources, error: rjError } = await supabase
      .schema('core')
      .rpc('get_verification_sources_layered', {
        p_city_name: 'Rio De Janeiro',
        p_country_code: 'BR',
        p_limit: 10
      });

    if (rjError) {
      console.error('❌ Erro ao buscar fontes do Rio de Janeiro:', rjError);
    } else {
      console.log(`✅ Encontradas ${rjSources.length} fontes para Rio de Janeiro:`);
      
      const nationalSources = rjSources.filter(s => s.layer === 'national');
      const citySources = rjSources.filter(s => s.layer === 'city');
      
      console.log(`🏛️ Fontes NACIONAIS (${nationalSources.length}):`);
      nationalSources.forEach(source => {
        console.log(`  • ${source.source_name} (${source.source_type}) - Prioridade: ${source.priority}`);
      });
      
      console.log(`🏙️ Fontes de CIDADE (${citySources.length}):`);
      citySources.forEach(source => {
        console.log(`  • ${source.source_name} (${source.source_type}) - Prioridade: ${source.priority}`);
      });
    }

    console.log('\n' + '─'.repeat(50) + '\n');

    // Teste 3: Madrid, Espanha
    console.log('🇪🇸 Teste 3: Madrid, Espanha');
    console.log('─'.repeat(50));
    
    const { data: madridSources, error: madridError } = await supabase
      .schema('core')
      .rpc('get_verification_sources_layered', {
        p_city_name: 'Madrid',
        p_country_code: 'ES',
        p_limit: 10
      });

    if (madridError) {
      console.error('❌ Erro ao buscar fontes de Madrid:', madridError);
    } else {
      console.log(`✅ Encontradas ${madridSources.length} fontes para Madrid:`);
      
      const nationalSources = madridSources.filter(s => s.layer === 'national');
      const citySources = madridSources.filter(s => s.layer === 'city');
      
      console.log(`🏛️ Fontes NACIONAIS (${nationalSources.length}):`);
      nationalSources.forEach(source => {
        console.log(`  • ${source.source_name} (${source.source_type}) - Prioridade: ${source.priority}`);
      });
      
      console.log(`🏙️ Fontes de CIDADE (${citySources.length}):`);
      citySources.forEach(source => {
        console.log(`  • ${source.source_name} (${source.source_type}) - Prioridade: ${source.priority}`);
      });
    }

    console.log('\n' + '─'.repeat(50) + '\n');

    // Teste 4: Verificar view de monitoramento
    console.log('📊 Teste 4: View de monitoramento das fontes');
    console.log('─'.repeat(50));
    
    const { data: viewData, error: viewError } = await supabase
      .schema('core')
      .from('v_verification_sources_layered')
      .select('*')
      .in('country_code', ['BR', 'ES', 'US', 'IE'])
      .order('country_code', { ascending: true })
      .order('layer', { ascending: false })
      .order('city_name', { ascending: true });

    if (viewError) {
      console.error('❌ Erro ao buscar view:', viewError);
    } else {
      console.log(`✅ View retornou ${viewData.length} registros:`);
      
      // Agrupar por país e camada
      const grouped = {};
      viewData.forEach(item => {
        if (!grouped[item.country_code]) {
          grouped[item.country_code] = { national: 0, city: 0 };
        }
        grouped[item.country_code][item.layer]++;
      });
      
      Object.entries(grouped).forEach(([country, counts]) => {
        console.log(`  🇺🇸 ${country}: ${counts.national} nacionais, ${counts.city} cidades`);
      });
    }

    console.log('\n' + '─'.repeat(50) + '\n');

    // Teste 5: Verificar configurações de busca
    console.log('🔧 Teste 5: Configurações de busca');
    console.log('─'.repeat(50));
    
    const { data: configs, error: configError } = await supabase
      .schema('core')
      .from('city_source_search_configs')
      .select(`
        *,
        city_verification_sources!inner(
          city_name,
          country_code,
          source_name,
          source_type
        )
      `)
      .limit(5);

    if (configError) {
      console.error('❌ Erro ao buscar configurações:', configError);
    } else {
      console.log(`✅ Encontradas ${configs.length} configurações de busca:`);
      
      configs.forEach(config => {
        const source = config.city_verification_sources;
        console.log(`  • ${source.city_name} (${source.country_code}): ${source.source_name}`);
        console.log(`    - Rate limit: ${config.rate_limit_rps} RPS`);
        console.log(`    - Timeout: ${config.timeout_ms}ms`);
        console.log(`    - Cache TTL: ${config.cache_ttl_hours}h`);
      });
    }

    console.log('\n' + '─'.repeat(50) + '\n');

    // Teste 6: Verificar estrutura das tabelas
    console.log('🗄️ Teste 6: Estrutura das tabelas');
    console.log('─'.repeat(50));
    
    // Verificar tabela de fontes de cidade
    const { data: citySourcesCount, error: cityCountError } = await supabase
      .schema('core')
      .from('city_verification_sources')
      .select('country_code, city_name', { count: 'exact' });

    if (cityCountError) {
      console.error('❌ Erro ao contar fontes de cidade:', cityCountError);
    } else {
      console.log(`✅ Tabela city_verification_sources: ${citySourcesCount.length} registros`);
    }

    // Verificar tabela de configurações de cidade
    const { data: cityConfigsCount, error: cityConfigCountError } = await supabase
      .schema('core')
      .from('city_source_search_configs')
      .select('*', { count: 'exact' });

    if (cityConfigCountError) {
      console.error('❌ Erro ao contar configurações de cidade:', cityConfigCountError);
    } else {
      console.log(`✅ Tabela city_source_search_configs: ${cityConfigsCount.length} registros`);
    }

    console.log('\n🎯 Teste do sistema de fontes em camadas concluído!');

  } catch (error) {
    console.error('❌ Erro geral no teste:', error);
  }
}

// Executar o teste
testLayeredSources();
