const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Variáveis de ambiente não encontradas');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkExistingSources() {
  console.log('🔍 Verificando fontes existentes em core.country_verification_sources...\n');

  try {
    // Buscar todas as fontes existentes
    const { data: existingSources, error } = await supabase
      .schema('core')
      .from('country_verification_sources')
      .select(`
        id,
        source_name,
        source_type,
        base_url,
        search_endpoint,
        priority,
        is_active,
        created_at,
        countries!inner(
          code,
          name
        )
      `)
      .order('priority', { ascending: true });

    if (error) {
      console.error('❌ Erro ao buscar fontes existentes:', error);
      return;
    }

    if (!existingSources || existingSources.length === 0) {
      console.log('⚠️ Nenhuma fonte encontrada na tabela country_verification_sources');
      return;
    }

    console.log(`📊 Total de fontes existentes: ${existingSources.length}\n`);

    // Agrupar por país
    const sourcesByCountry = {};
    existingSources.forEach(source => {
      const countryCode = source.countries.code;
      if (!sourcesByCountry[countryCode]) {
        sourcesByCountry[countryCode] = [];
      }
      sourcesByCountry[countryCode].push(source);
    });

    // Mostrar fontes por país
    Object.entries(sourcesByCountry).forEach(([countryCode, sources]) => {
      const countryName = sources[0].countries.name;
      console.log(`🇺🇸 ${countryCode} - ${countryName} (${sources.length} fontes):`);
      console.log('─'.repeat(60));
      
      sources.forEach(source => {
        const status = source.is_active ? '✅' : '❌';
        console.log(`${status} ${source.source_name}`);
        console.log(`   Tipo: ${source.source_type}`);
        console.log(`   URL: ${source.base_url}`);
        console.log(`   Prioridade: ${source.priority}`);
        console.log(`   Endpoint: ${source.search_endpoint || 'N/A'}`);
        console.log(`   Criado: ${new Date(source.created_at).toLocaleDateString('pt-BR')}`);
        console.log('');
      });
    });

    // Verificar configurações de busca
    console.log('🔧 Verificando configurações de busca existentes...\n');
    
    const { data: existingConfigs, error: configError } = await supabase
      .schema('core')
      .from('source_search_configs')
      .select(`
        id,
        search_type,
        query_template,
        rate_limit_rps,
        timeout_ms,
        cache_ttl_hours,
        country_verification_sources!inner(
          source_name,
          countries!inner(code, name)
        )
      `);

    if (configError) {
      console.error('❌ Erro ao buscar configurações:', configError);
    } else {
      console.log(`📊 Configurações de busca: ${existingConfigs.length} encontradas\n`);
      
      existingConfigs.forEach(config => {
        const source = config.country_verification_sources;
        console.log(`🔧 ${source.source_name} (${source.countries.code}):`);
        console.log(`   - Tipo de busca: ${config.search_type}`);
        console.log(`   - Template: ${config.query_template}`);
        console.log(`   - Rate limit: ${config.rate_limit_rps} RPS`);
        console.log(`   - Timeout: ${config.timeout_ms}ms`);
        console.log(`   - Cache TTL: ${config.cache_ttl_hours}h`);
        console.log('');
      });
    }

    // Verificar se existem fontes duplicadas
    console.log('🔍 Verificando possíveis duplicidades...\n');
    
    const sourceNames = existingSources.map(s => s.source_name);
    const duplicates = sourceNames.filter((name, index) => sourceNames.indexOf(name) !== index);
    
    if (duplicates.length > 0) {
      console.log('⚠️ Possíveis duplicidades encontradas:');
      duplicates.forEach(name => {
        console.log(`   • ${name}`);
      });
    } else {
      console.log('✅ Nenhuma duplicidade encontrada');
    }

    // Resumo por tipo de fonte
    console.log('\n📊 Resumo por tipo de fonte:');
    console.log('─'.repeat(40));
    
    const typeCount = {};
    existingSources.forEach(source => {
      typeCount[source.source_type] = (typeCount[source.source_type] || 0) + 1;
    });
    
    Object.entries(typeCount).forEach(([type, count]) => {
      console.log(`${type}: ${count} fontes`);
    });

    // Resumo por prioridade
    console.log('\n📊 Resumo por prioridade:');
    console.log('─'.repeat(40));
    
    const priorityCount = {};
    existingSources.forEach(source => {
      priorityCount[source.priority] = (priorityCount[source.priority] || 0) + 1;
    });
    
    Object.entries(priorityCount).sort((a, b) => a[0] - b[0]).forEach(([priority, count]) => {
      console.log(`Prioridade ${priority}: ${count} fontes`);
    });

  } catch (error) {
    console.error('❌ Erro geral:', error);
  }
}

// Executar o script
checkExistingSources();
