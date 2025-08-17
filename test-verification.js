const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são necessárias');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function testVerification() {
  console.log('🔍 Testando verificação com descrição específica...');
  
  try {
    // Usar uma descrição específica que sabemos que tem texto válido
    const descriptionId = '64f278e6-f536-45d0-a3ca-777b6549ba92';
    
    // 1. Buscar a descrição específica
    const { data: descriptions, error: fetchError } = await supabase
      .schema('core')
      .from('attraction_descriptions')
      .select('id, description, attraction_id, is_original')
      .eq('id', descriptionId)
      .single();

    if (fetchError) {
      console.error('❌ Erro ao buscar descrição:', fetchError);
      return;
    }

    if (!descriptions) {
      console.log('❌ Descrição não encontrada');
      return;
    }

    const description = descriptions;
    console.log('📋 Descrição encontrada:', {
      id: description.id,
      attraction_id: description.attraction_id,
      is_original: description.is_original,
      description: description.description,
      description_length: description.description?.length || 0
    });

    if (!description.description) {
      console.log('❌ Descrição está vazia ou nula');
      return;
    }

    // 2. Testar a Edge Function
    console.log('🚀 Chamando Edge Function...');
    const { data, error } = await supabase.functions.invoke('verify-batch', {
      body: {
        description_id: description.id,
        description: description.description,
        attraction_id: description.attraction_id,
        force_reprocess: true
      }
    });

    if (error) {
      console.error('❌ Erro na Edge Function:', error);
      return;
    }

    console.log('✅ Resposta da Edge Function:', data);

    // 3. Verificar se o score foi salvo
    console.log('🔍 Verificando se o score foi salvo...');
    const { data: scores, error: scoresError } = await supabase
      .schema('core')
      .from('description_scores')
      .select('*')
      .eq('description_id', description.id)
      .order('created_at', { ascending: false })
      .limit(1);

    if (scoresError) {
      console.error('❌ Erro ao buscar scores:', scoresError);
      return;
    }

    if (scores && scores.length > 0) {
      console.log('✅ Score salvo com sucesso:', {
        score_overall: scores[0].score_overall,
        subscores: scores[0].subscores,
        flags: scores[0].flags,
        created_at: scores[0].created_at
      });
    } else {
      console.log('❌ Nenhum score encontrado');
    }

    // 4. Verificar claims
    console.log('🔍 Verificando claims...');
    const { data: claims, error: claimsError } = await supabase
      .schema('core')
      .from('description_claims')
      .select('*')
      .eq('description_id', description.id);

    if (claimsError) {
      console.error('❌ Erro ao buscar claims:', claimsError);
      return;
    }

    console.log(`📊 Claims encontrados: ${claims?.length || 0}`);
    if (claims && claims.length > 0) {
      claims.forEach((claim, index) => {
        console.log(`  ${index + 1}. ${claim.value} (${claim.status})`);
      });
    }

  } catch (error) {
    console.error('❌ Erro inesperado:', error);
  }
}

testVerification();
