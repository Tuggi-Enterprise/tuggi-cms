const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Variáveis de ambiente não encontradas');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkCountriesTable() {
  console.log('🌍 Verificando países na tabela core.countries...\n');

  try {
    // Buscar todos os países
    const { data: countries, error } = await supabase
      .schema('core')
      .from('countries')
      .select('*')
      .order('name', { ascending: true });

    if (error) {
      console.error('❌ Erro ao buscar países:', error);
      return;
    }

    if (!countries || countries.length === 0) {
      console.log('⚠️ Nenhum país encontrado na tabela countries');
      return;
    }

    console.log(`📊 Total de países: ${countries.length}\n`);

    // Mostrar todos os países
    countries.forEach(country => {
      console.log(`🇺🇸 ${country.code} - ${country.name} ${country.flag_emoji || ''}`);
      console.log(`   ID: ${country.id}`);
      console.log(`   Criado: ${new Date(country.created_at).toLocaleDateString('pt-BR')}`);
      console.log('');
    });

    // Verificar se os países que queremos usar existem
    const requiredCountries = ['BR', 'ES', 'US', 'IE', 'MX', 'CL'];
    console.log('🔍 Verificando países necessários:');
    console.log('─'.repeat(50));
    
    requiredCountries.forEach(code => {
      const country = countries.find(c => c.code === code);
      if (country) {
        console.log(`✅ ${code} - ${country.name} (ID: ${country.id})`);
      } else {
        console.log(`❌ ${code} - NÃO ENCONTRADO`);
      }
    });

    // Verificar se há países com códigos similares
    console.log('\n🔍 Verificando códigos similares:');
    console.log('─'.repeat(50));
    
    const similarCodes = ['IE', 'IR', 'IL', 'IN', 'IT'];
    similarCodes.forEach(code => {
      const country = countries.find(c => c.code === code);
      if (country) {
        console.log(`🔍 ${code} - ${country.name} (ID: ${country.id})`);
      }
    });

  } catch (error) {
    console.error('❌ Erro geral:', error);
  }
}

// Executar o script
checkCountriesTable();
