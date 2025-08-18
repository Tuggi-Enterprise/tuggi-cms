const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Variáveis de ambiente não encontradas');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkCountries() {
  console.log('🌍 Verificando países na tabela attractions...\n');

  try {
    // Verificar valores únicos de país
    const { data: countries, error: countriesError } = await supabase
      .schema('core')
      .from('attractions')
      .select('country')
      .not('country', 'is', null);

    if (countriesError) {
      console.error('❌ Erro ao buscar países:', countriesError);
      return;
    }

    // Contar ocorrências de cada país
    const countryCounts = {};
    countries.forEach(item => {
      const country = item.country;
      countryCounts[country] = (countryCounts[country] || 0) + 1;
    });

    console.log('📊 Distribuição por país:');
    console.log('─'.repeat(50));
    Object.entries(countryCounts)
      .sort((a, b) => b[1] - a[1])
      .forEach(([country, count]) => {
        console.log(`🌍 ${country}: ${count} atrações`);
      });

    // Verificar itens rejeitados por país
    console.log('\n📊 Itens rejeitados por país:');
    console.log('─'.repeat(50));
    
    for (const country of Object.keys(countryCounts)) {
      const { data: rejectedItems, error: rejectedError } = await supabase
        .schema('core')
        .from('attraction_descriptions')
        .select(`
          id,
          verification_status,
          attractions!inner(country)
        `)
        .eq('is_original', true)
        .eq('language', 'pt-br')
        .eq('verification_status', 'rejected')
        .eq('attractions.country', country);

      if (!rejectedError && rejectedItems) {
        console.log(`🇧🇷 ${country}: ${rejectedItems.length} itens rejeitados`);
      }
    }

    // Verificar estrutura da tabela attractions
    console.log('\n📊 Estrutura da tabela attractions:');
    console.log('─'.repeat(50));
    
    const { data: sampleAttraction, error: sampleError } = await supabase
      .schema('core')
      .from('attractions')
      .select('*')
      .limit(1);

    if (!sampleError && sampleAttraction && sampleAttraction.length > 0) {
      console.log('Colunas disponíveis:', Object.keys(sampleAttraction[0]));
      console.log('\nExemplo de registro:');
      console.log(JSON.stringify(sampleAttraction[0], null, 2));
    }

  } catch (error) {
    console.error('❌ Erro geral:', error);
  }
}

// Executar o script
checkCountries();
