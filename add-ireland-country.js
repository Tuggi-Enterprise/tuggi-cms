const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Variáveis de ambiente não encontradas');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function addIrelandCountry() {
  console.log('🇮🇪 Adicionando Irlanda na tabela core.countries...\n');

  try {
    // Verificar se a Irlanda já existe
    const { data: existingIreland, error: checkError } = await supabase
      .schema('core')
      .from('countries')
      .select('*')
      .eq('code', 'IE')
      .single();

    if (checkError && checkError.code !== 'PGRST116') {
      console.error('❌ Erro ao verificar Irlanda:', checkError);
      return;
    }

    if (existingIreland) {
      console.log('✅ Irlanda já existe na tabela:');
      console.log(`   ID: ${existingIreland.id}`);
      console.log(`   Código: ${existingIreland.code}`);
      console.log(`   Nome: ${existingIreland.name}`);
      console.log(`   Emoji: ${existingIreland.flag_emoji}`);
      return;
    }

    // Adicionar Irlanda
    const { data: newIreland, error: insertError } = await supabase
      .schema('core')
      .from('countries')
      .insert({
        code: 'IE',
        name: 'Ireland',
        flag_emoji: '🇮🇪',
        language_code: 'en-ie'
      })
      .select()
      .single();

    if (insertError) {
      console.error('❌ Erro ao adicionar Irlanda:', insertError);
      return;
    }

    console.log('✅ Irlanda adicionada com sucesso:');
    console.log(`   ID: ${newIreland.id}`);
    console.log(`   Código: ${newIreland.code}`);
    console.log(`   Nome: ${newIreland.name}`);
    console.log(`   Emoji: ${newIreland.flag_emoji}`);
    console.log(`   Idioma: ${newIreland.language_code}`);

    // Verificar se foi adicionada corretamente
    const { data: verifyIreland, error: verifyError } = await supabase
      .schema('core')
      .from('countries')
      .select('*')
      .eq('code', 'IE')
      .single();

    if (verifyError) {
      console.error('❌ Erro ao verificar inserção:', verifyError);
      return;
    }

    console.log('\n🎯 Verificação final:');
    console.log(`✅ Irlanda encontrada: ${verifyIreland.name} (${verifyIreland.code})`);

  } catch (error) {
    console.error('❌ Erro geral:', error);
  }
}

// Executar o script
addIrelandCountry();
