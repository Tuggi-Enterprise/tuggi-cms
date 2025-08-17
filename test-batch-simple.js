#!/usr/bin/env node

/**
 * Script simples para testar verificação em lote direto na Edge Function
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Variáveis de ambiente SUPABASE não configuradas');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function testBatchSimple() {
  console.log('\n🚀 TESTE SIMPLES DE VERIFICAÇÃO EM LOTE');
  console.log('================================================================================\n');

  try {
    // 1. Buscar 3 descrições originais sem score
    console.log('📊 1. BUSCANDO DESCRIÇÕES SEM SCORE');
    console.log('------------------------------------------------------------');
    
    const { data: descriptions, error: fetchError } = await supabase
      .schema('core')
      .from('attraction_descriptions')
      .select(`
        id,
        description,
        attraction_id,
        description_hash,
        verification_status,
        last_score_overall,
        attractions!inner(name, city, country)
      `)
      .eq('is_original', true)
      .eq('language', 'pt-br')
      .is('last_score_overall', null) // Sem score
      .limit(3)
      .order('updated_at', { ascending: false });

    if (fetchError) {
      console.error('❌ Erro ao buscar descrições:', fetchError);
      return;
    }

    if (!descriptions || descriptions.length === 0) {
      console.log('⚠️ Nenhuma descrição sem score encontrada');
      return;
    }

    console.log(`✅ Encontradas ${descriptions.length} descrições sem score:`);
    descriptions.forEach((desc, index) => {
      console.log(`   ${index + 1}. ${desc.attractions.name} (${desc.attractions.city}, ${desc.attractions.country})`);
      console.log(`      ID: ${desc.id}`);
      console.log(`      Descrição: ${desc.description.substring(0, 100)}...`);
      console.log('');
    });

    // 2. Processar cada descrição individualmente
    console.log('🔄 2. PROCESSANDO DESCRIÇÕES INDIVIDUALMENTE');
    console.log('------------------------------------------------------------');
    
    const results = [];
    
    for (let i = 0; i < descriptions.length; i++) {
      const desc = descriptions[i];
      console.log(`\n📋 Processando ${i + 1}/${descriptions.length}: ${desc.attractions.name}`);
      
      try {
        const startTime = Date.now();
        
        const { data, error } = await supabase.functions.invoke('verify-batch', {
          body: {
            description_id: desc.id,
            description: desc.description,
            attraction_id: desc.attraction_id,
            force_reprocess: false
          }
        });

        const endTime = Date.now();
        const duration = (endTime - startTime) / 1000;

        if (error) {
          console.error(`❌ Erro: ${error.message}`);
          results.push({
            id: desc.id,
            name: desc.attractions.name,
            success: false,
            error: error.message,
            duration
          });
        } else {
          console.log(`✅ Sucesso em ${duration}s`);
          console.log(`   Score: ${data.score_overall}%`);
          console.log(`   Claims: ${data.total_claims}`);
          console.log(`   Status: ${data.verification_status}`);
          
          results.push({
            id: desc.id,
            name: desc.attractions.name,
            success: true,
            score: data.score_overall,
            claims: data.total_claims,
            status: data.verification_status,
            duration
          });
        }

        // Aguardar 3 segundos entre processamentos
        if (i < descriptions.length - 1) {
          console.log('⏳ Aguardando 3s...');
          await new Promise(resolve => setTimeout(resolve, 3000));
        }

      } catch (error) {
        console.error(`❌ Erro inesperado: ${error.message}`);
        results.push({
          id: desc.id,
          name: desc.attractions.name,
          success: false,
          error: error.message
        });
      }
    }

    // 3. Resumo dos resultados
    console.log('\n📊 3. RESUMO DOS RESULTADOS');
    console.log('------------------------------------------------------------');
    
    const successful = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);
    
    console.log(`✅ Sucessos: ${successful.length}`);
    console.log(`❌ Falhas: ${failed.length}`);
    
    if (successful.length > 0) {
      console.log('\n🏆 Processamentos bem-sucedidos:');
      successful.forEach(result => {
        console.log(`   • ${result.name}: ${result.score}% (${result.claims} claims) - ${result.duration}s`);
      });
      
      const avgScore = successful.reduce((sum, r) => sum + r.score, 0) / successful.length;
      const avgDuration = successful.reduce((sum, r) => sum + r.duration, 0) / successful.length;
      
      console.log(`\n📈 Estatísticas:`);
      console.log(`   • Score médio: ${avgScore.toFixed(1)}%`);
      console.log(`   • Duração média: ${avgDuration.toFixed(1)}s`);
    }
    
    if (failed.length > 0) {
      console.log('\n❌ Processamentos que falharam:');
      failed.forEach(result => {
        console.log(`   • ${result.name}: ${result.error}`);
      });
    }

    // 4. Verificar se os dados foram salvos
    console.log('\n💾 4. VERIFICANDO DADOS SALVOS');
    console.log('------------------------------------------------------------');
    
    if (successful.length > 0) {
      const successfulIds = successful.map(r => r.id);
      
      // Verificar scores salvos
      const { data: scores, error: scoresError } = await supabase
        .schema('core')
        .from('description_scores')
        .select('description_id, score_overall, created_at')
        .in('description_id', successfulIds)
        .order('created_at', { ascending: false });

      if (scoresError) {
        console.error('❌ Erro ao verificar scores:', scoresError);
      } else {
        console.log(`✅ Scores salvos: ${scores?.length || 0}`);
      }

      // Verificar claims salvos
      const { data: claims, error: claimsError } = await supabase
        .schema('core')
        .from('description_claims')
        .select('description_id, status')
        .in('description_id', successfulIds);

      if (claimsError) {
        console.error('❌ Erro ao verificar claims:', claimsError);
      } else {
        console.log(`✅ Claims salvos: ${claims?.length || 0}`);
        
        if (claims && claims.length > 0) {
          const claimsByStatus = claims.reduce((acc, claim) => {
            acc[claim.status] = (acc[claim.status] || 0) + 1;
            return acc;
          }, {});
          
          console.log('   Status dos claims:');
          Object.entries(claimsByStatus).forEach(([status, count]) => {
            console.log(`     • ${status}: ${count}`);
          });
        }
      }

      // Verificar evidências salvas
      if (claims && claims.length > 0) {
        const claimIds = claims.map(c => c.id);
        
        const { data: evidence, error: evidenceError } = await supabase
          .schema('core')
          .from('description_claim_evidence')
          .select('verdict')
          .in('claim_id', claimIds);

        if (evidenceError) {
          console.error('❌ Erro ao verificar evidências:', evidenceError);
        } else {
          console.log(`✅ Evidências salvas: ${evidence?.length || 0}`);
        }
      }

      // Verificar atualizações nas descrições
      const { data: updatedDescriptions, error: updateError } = await supabase
        .schema('core')
        .from('attraction_descriptions')
        .select('id, verification_status, last_score_overall, last_verified_at')
        .in('id', successfulIds);

      if (updateError) {
        console.error('❌ Erro ao verificar atualizações:', updateError);
      } else {
        console.log(`✅ Descrições atualizadas: ${updatedDescriptions?.length || 0}`);
        updatedDescriptions?.forEach(desc => {
          console.log(`   • ID ${desc.id}: ${desc.last_score_overall}% (${desc.verification_status})`);
        });
      }
    }

    console.log('\n🎉 TESTE SIMPLES CONCLUÍDO!');
    console.log('================================================================================');

  } catch (error) {
    console.error('❌ Erro durante o teste:', error);
  }
}

// Executar teste
testBatchSimple();
