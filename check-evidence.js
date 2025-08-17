const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são necessárias');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkEvidence() {
  console.log('🔍 Verificando evidências e fontes primárias...');
  
  try {
    // Buscar o score mais recente
    const { data: latestScore, error: scoreError } = await supabase
      .schema('core')
      .from('description_scores')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(1);

    if (scoreError) {
      console.error('❌ Erro ao buscar score:', scoreError);
      return;
    }

    if (!latestScore || latestScore.length === 0) {
      console.log('❌ Nenhum score encontrado');
      return;
    }

    const score = latestScore[0];
    console.log('📊 Score mais recente:', {
      description_id: score.description_id,
      score_overall: score.score_overall,
      created_at: score.created_at
    });

    // Buscar claims deste score
    const { data: claims, error: claimsError } = await supabase
      .schema('core')
      .from('description_claims')
      .select('*')
      .eq('score_id', score.id);

    if (claimsError) {
      console.error('❌ Erro ao buscar claims:', claimsError);
      return;
    }

    console.log(`📋 Claims encontrados: ${claims?.length || 0}`);
    
    if (claims && claims.length > 0) {
      for (const claim of claims) {
        console.log(`\n🔍 Claim: ${claim.value}`);
        console.log(`   Status: ${claim.status}`);
        console.log(`   Weight: ${claim.weight}`);
        
        // Buscar evidências deste claim
        const { data: evidence, error: evidenceError } = await supabase
          .schema('core')
          .from('description_claim_evidence')
          .select('*')
          .eq('claim_id', claim.id);

        if (evidenceError) {
          console.error('❌ Erro ao buscar evidências:', evidenceError);
          continue;
        }

        console.log(`   Evidências: ${evidence?.length || 0}`);
        if (evidence && evidence.length > 0) {
          evidence.forEach((ev, index) => {
            console.log(`     ${index + 1}. ${ev.source}: ${ev.page || ev.url} (${ev.verdict})`);
            if (ev.quote) {
              console.log(`        Quote: ${ev.quote.substring(0, 100)}...`);
            }
          });
        } else {
          console.log('     Nenhuma evidência encontrada');
        }
      }
    }

    // Verificar se a atração tem fontes primárias
    const { data: description } = await supabase
      .schema('core')
      .from('attraction_descriptions')
      .select('attraction_id')
      .eq('id', score.description_id)
      .single();

    if (description) {
      const { data: attraction } = await supabase
        .schema('core')
        .from('attractions')
        .select('name, website, reference_links')
        .eq('id', description.attraction_id)
        .single();

      if (attraction) {
        console.log(`\n🏛️ Atração: ${attraction.name}`);
        console.log(`   Website: ${attraction.website || 'N/A'}`);
        console.log(`   Reference Links: ${attraction.reference_links?.length || 0}`);
        
        if (attraction.reference_links && attraction.reference_links.length > 0) {
          attraction.reference_links.forEach((link, index) => {
            console.log(`     ${index + 1}. ${link}`);
          });
        }
      }
    }

  } catch (error) {
    console.error('❌ Erro inesperado:', error);
  }
}

checkEvidence();
