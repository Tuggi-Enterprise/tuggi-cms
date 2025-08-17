const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são necessárias');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkDescriptions() {
  console.log('🔍 Verificando dados da tabela attraction_descriptions...');
  
  try {
    // 1. Verificar total de descrições
    const { count: totalCount, error: countError } = await supabase
      .schema('core')
      .from('attraction_descriptions')
      .select('*', { count: 'exact', head: true });

    if (countError) {
      console.error('❌ Erro ao contar descrições:', countError);
      return;
    }

    console.log(`📊 Total de descrições: ${totalCount}`);

    // 2. Verificar descrições originais
    const { count: originalCount, error: originalCountError } = await supabase
      .schema('core')
      .from('attraction_descriptions')
      .select('*', { count: 'exact', head: true })
      .eq('is_original', true);

    if (originalCountError) {
      console.error('❌ Erro ao contar descrições originais:', originalCountError);
      return;
    }

    console.log(`📊 Descrições originais: ${originalCount}`);

    // 3. Buscar algumas descrições para verificar
    const { data: descriptions, error: fetchError } = await supabase
      .schema('core')
      .from('attraction_descriptions')
      .select('id, description, attraction_id, is_original, language, gender')
      .eq('is_original', true)
      .limit(5);

    if (fetchError) {
      console.error('❌ Erro ao buscar descrições:', fetchError);
      return;
    }

    console.log('\n📋 Primeiras 5 descrições originais:');
    descriptions?.forEach((desc, index) => {
      console.log(`${index + 1}. ID: ${desc.id}`);
      console.log(`   Attraction ID: ${desc.attraction_id}`);
      console.log(`   Language: ${desc.language}`);
      console.log(`   Gender: ${desc.gender}`);
      console.log(`   Is Original: ${desc.is_original}`);
      console.log(`   Description: ${desc.description ? `"${desc.description.substring(0, 100)}..."` : 'NULL/EMPTY'}`);
      console.log(`   Description Length: ${desc.description?.length || 0}`);
      console.log('');
    });

    // 4. Verificar se há descrições com texto
    const { data: descriptionsWithText, error: textError } = await supabase
      .schema('core')
      .from('attraction_descriptions')
      .select('id, description, attraction_id, is_original')
      .eq('is_original', true)
      .not('description', 'is', null)
      .neq('description', '')
      .limit(1);

    if (textError) {
      console.error('❌ Erro ao buscar descrições com texto:', textError);
      return;
    }

    if (descriptionsWithText && descriptionsWithText.length > 0) {
      console.log('✅ Encontrada descrição com texto válido para teste:');
      console.log(JSON.stringify(descriptionsWithText[0], null, 2));
    } else {
      console.log('❌ Nenhuma descrição original com texto encontrada');
    }

  } catch (error) {
    console.error('❌ Erro inesperado:', error);
  }
}

checkDescriptions();
