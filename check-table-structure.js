const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Variáveis de ambiente não encontradas');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkTableStructure() {
  console.log('🔍 Verificando estrutura das tabelas...\n');

  try {
    // Verificar estrutura da tabela description_scores
    console.log('📊 Estrutura da tabela description_scores:');
    const { data: scoresSample, error: scoresError } = await supabase
      .schema('core')
      .from('description_scores')
      .select('*')
      .limit(1);

    if (scoresError) {
      console.error('❌ Erro ao verificar description_scores:', scoresError);
    } else if (scoresSample && scoresSample.length > 0) {
      console.log('Colunas disponíveis:', Object.keys(scoresSample[0]));
    }

    // Verificar estrutura da tabela description_claims
    console.log('\n📊 Estrutura da tabela description_claims:');
    const { data: claimsSample, error: claimsError } = await supabase
      .schema('core')
      .from('description_claims')
      .select('*')
      .limit(1);

    if (claimsError) {
      console.error('❌ Erro ao verificar description_claims:', claimsError);
    } else if (claimsSample && claimsSample.length > 0) {
      console.log('Colunas disponíveis:', Object.keys(claimsSample[0]));
    }

    // Verificar se as tabelas existem
    console.log('\n📊 Verificando se as tabelas existem...');
    const { data: tables, error: tablesError } = await supabase
      .rpc('get_table_info', { table_name: 'description_scores' });

    if (tablesError) {
      console.log('Tentando método alternativo...');
      // Tentar buscar alguns registros para ver a estrutura
      const { data: sampleData, error: sampleError } = await supabase
        .schema('core')
        .from('attraction_descriptions')
        .select(`
          id,
          description,
          verification_status,
          description_scores(*)
        `)
        .eq('verification_status', 'rejected')
        .limit(1);

      if (sampleError) {
        console.error('❌ Erro ao buscar dados de exemplo:', sampleError);
      } else if (sampleData && sampleData.length > 0) {
        console.log('Estrutura encontrada:', JSON.stringify(sampleData[0], null, 2));
      }
    }

  } catch (error) {
    console.error('❌ Erro geral:', error);
  }
}

// Executar o script
checkTableStructure();
