const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são necessárias');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkMirror() {
  console.log('🔍 Verificando se o trigger atualizou a tabela attraction_descriptions...');
  
  try {
    const descriptionId = '64f278e6-f536-45d0-a3ca-777b6549ba92';
    
    // Verificar se a descrição foi atualizada
    const { data: description, error: fetchError } = await supabase
      .schema('core')
      .from('attraction_descriptions')
      .select('id, verification_status, last_score_overall, last_score_version, last_verified_at')
      .eq('id', descriptionId)
      .single();

    if (fetchError) {
      console.error('❌ Erro ao buscar descrição:', fetchError);
      return;
    }

    console.log('📋 Status da descrição após verificação:');
    console.log(JSON.stringify(description, null, 2));

    // Verificar se o score foi salvo corretamente
    const { data: scores, error: scoresError } = await supabase
      .schema('core')
      .from('description_scores')
      .select('*')
      .eq('description_id', descriptionId)
      .order('created_at', { ascending: false })
      .limit(1);

    if (scoresError) {
      console.error('❌ Erro ao buscar scores:', scoresError);
      return;
    }

    if (scores && scores.length > 0) {
      console.log('\n📊 Score mais recente:');
      console.log(JSON.stringify(scores[0], null, 2));
    }

    // Verificar claims
    const { data: claims, error: claimsError } = await supabase
      .schema('core')
      .from('description_claims')
      .select('*')
      .eq('description_id', descriptionId);

    if (claimsError) {
      console.error('❌ Erro ao buscar claims:', claimsError);
      return;
    }

    console.log(`\n📋 Claims encontrados: ${claims?.length || 0}`);
    if (claims && claims.length > 0) {
      claims.forEach((claim, index) => {
        console.log(`  ${index + 1}. ${claim.value} (${claim.status})`);
      });
    }

    // Verificar evidências
    if (claims && claims.length > 0) {
      const { data: evidence, error: evidenceError } = await supabase
        .schema('core')
        .from('description_claim_evidence')
        .select('*')
        .in('claim_id', claims.map(c => c.id));

      if (evidenceError) {
        console.error('❌ Erro ao buscar evidências:', evidenceError);
        return;
      }

      console.log(`\n📋 Evidências encontradas: ${evidence?.length || 0}`);
      if (evidence && evidence.length > 0) {
        evidence.forEach((ev, index) => {
          console.log(`  ${index + 1}. ${ev.source}: ${ev.page} (${ev.verdict})`);
        });
      }
    }

  } catch (error) {
    console.error('❌ Erro inesperado:', error);
  }
}

checkMirror();
