const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Variáveis de ambiente não encontradas');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function testClaimChecking() {
  console.log('🔍 Testando sistema de checagem de claims...\n');

  try {
    // 1. Buscar uma descrição recente com claims "not_found"
    const { data: recentScore, error: scoreError } = await supabase
      .schema('core')
      .from('description_scores')
      .select('description_id, subscores, flags')
      .eq('score_overall', 38)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (scoreError) {
      console.error('❌ Erro ao buscar score:', scoreError);
      return;
    }

    console.log(`📊 Testando descrição: ${recentScore.description_id}`);
    console.log(`📊 Subscores: ${JSON.stringify(recentScore.subscores)}`);
    console.log(`📊 Flags: ${JSON.stringify(recentScore.flags)}`);

    // 2. Buscar claims desta descrição
    const { data: claims, error: claimsError } = await supabase
      .schema('core')
      .from('description_claims')
      .select('*')
      .eq('description_id', recentScore.description_id)
      .order('created_at', { ascending: false });

    if (claimsError) {
      console.error('❌ Erro ao buscar claims:', claimsError);
      return;
    }

    console.log(`\n📝 Claims encontrados: ${claims.length}`);
    claims.forEach((claim, idx) => {
      console.log(`   ${idx + 1}. "${claim.value}" (${claim.claim_type}) - Status: ${claim.status}`);
    });

    // 3. Buscar evidências para estes claims
    if (claims.length > 0) {
      const { data: evidence, error: evidenceError } = await supabase
        .schema('core')
        .from('description_claim_evidence')
        .select('*')
        .in('claim_id', claims.map(c => c.id));

      if (evidenceError) {
        console.error('❌ Erro ao buscar evidências:', evidenceError);
      } else {
        console.log(`\n🔍 Evidências encontradas: ${evidence.length}`);
        evidence.forEach((ev, idx) => {
          console.log(`   ${idx + 1}. Source: ${ev.source}, Page: ${ev.page}, Verdict: ${ev.verdict}`);
          console.log(`      Quote: "${ev.quote.substring(0, 100)}..."`);
        });
      }
    }

    // 4. Testar a verificação de um claim específico manualmente
    if (claims.length > 0) {
      const testClaim = claims[0];
      console.log(`\n🧪 Testando verificação manual do claim: "${testClaim.value}"`);
      
      // Simular o que acontece no Edge Function
      const { data: attractionData } = await supabase
        .schema('core')
        .from('attractions')
        .select('name, website, reference_links, city, country')
        .eq('id', testClaim.description_id) // Isso está errado, deveria ser attraction_id
        .single();

      console.log(`🏛️ Dados da atração:`, attractionData);

      // Testar via Edge Function
      const { data: verifyResult, error: verifyError } = await supabase.functions.invoke('verify-batch', {
        body: {
          description_id: recentScore.description_id,
          description: 'Test description',
          attraction_id: 'test-id',
          force_reprocess: true
        }
      });

      if (verifyError) {
        console.error('❌ Erro na verificação:', verifyError);
      } else {
        console.log('✅ Resultado da verificação:', JSON.stringify(verifyResult, null, 2));
      }
    }

  } catch (error) {
    console.error('❌ Erro geral:', error);
  }
}

testClaimChecking();
