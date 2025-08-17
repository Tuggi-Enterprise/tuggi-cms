#!/usr/bin/env node

/**
 * Script para testar a verificação em lote usando o sistema de fontes dinâmicas
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Variáveis de ambiente SUPABASE não configuradas');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function testBatchVerification() {
  console.log('\n🚀 TESTANDO VERIFICAÇÃO EM LOTE');
  console.log('================================================================================\n');

  try {
    // 1. Verificar quantas descrições originais existem
    console.log('📊 1. VERIFICANDO DESCRIÇÕES ORIGINAIS DISPONÍVEIS');
    console.log('------------------------------------------------------------');
    
    const { data: originalDescriptions, error: countError } = await supabase
      .schema('core')
      .from('attraction_descriptions')
      .select('id, verification_status, last_score_overall, language, updated_at', { count: 'exact' })
      .eq('is_original', true)
      .eq('language', 'pt-br')
      .order('updated_at', { ascending: false });

    if (countError) {
      console.error('❌ Erro ao buscar descrições:', countError);
      return;
    }

    console.log(`✅ Total de descrições originais PT-BR: ${originalDescriptions?.length || 0}`);
    
    if (originalDescriptions && originalDescriptions.length > 0) {
      const statusCount = originalDescriptions.reduce((acc, desc) => {
        acc[desc.verification_status || 'pending'] = (acc[desc.verification_status || 'pending'] || 0) + 1;
        return acc;
      }, {});
      
      console.log('📈 Status das descrições:');
      Object.entries(statusCount).forEach(([status, count]) => {
        console.log(`   • ${status}: ${count}`);
      });

      const withScores = originalDescriptions.filter(d => d.last_score_overall !== null).length;
      const withoutScores = originalDescriptions.length - withScores;
      
      console.log(`📊 Com scores: ${withScores}`);
      console.log(`📊 Sem scores: ${withoutScores}`);
    }

    // 2. Testar agendamento de lote pequeno
    console.log('\n📋 2. TESTANDO AGENDAMENTO DE LOTE PEQUENO');
    console.log('------------------------------------------------------------');
    
    const batchSize = 3; // Lote pequeno para teste
    
    const response = await fetch(`http://localhost:3000/api/verify/schedule`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${supabaseKey}`
      },
      body: JSON.stringify({
        batch: batchSize
      })
    });

    if (!response.ok) {
      console.error(`❌ Erro HTTP: ${response.status} ${response.statusText}`);
      const errorText = await response.text();
      console.error('❌ Resposta:', errorText);
      return;
    }

    const result = await response.json();
    
    console.log('✅ Resposta do agendamento:');
    console.log(`   • Agendadas: ${result.scheduled}`);
    console.log(`   • Falhas: ${result.failed}`);
    console.log(`   • Total encontradas: ${result.total_found}`);
    console.log(`   • Precisam processamento: ${result.needs_processing}`);
    console.log(`   • Já atualizadas: ${result.already_updated}`);
    console.log(`   • Sem score (prioridade): ${result.priority_descriptions || 0}`);
    console.log(`   • Score desatualizado: ${result.update_descriptions || 0}`);
    console.log(`   • Próximo cursor: ${result.nextCursor}`);

    if (result.tasks && result.tasks.length > 0) {
      console.log('\n📋 Detalhes das tarefas:');
      result.tasks.forEach((task, index) => {
        console.log(`   ${index + 1}. ID: ${task.description_id} - ${task.success ? '✅ Sucesso' : '❌ Falha'}`);
        if (!task.success && task.error) {
          console.log(`      Erro: ${task.error}`);
        }
        if (task.success && task.response) {
          console.log(`      Score: ${task.response.score_overall}%`);
          console.log(`      Claims: ${task.response.total_claims}`);
        }
      });
    }

    // 3. Verificar se os scores foram salvos
    console.log('\n📊 3. VERIFICANDO SCORES SALVOS');
    console.log('------------------------------------------------------------');
    
    if (result.tasks && result.tasks.length > 0) {
      const successfulTasks = result.tasks.filter(t => t.success);
      
      if (successfulTasks.length > 0) {
        const descriptionIds = successfulTasks.map(t => t.description_id);
        
        const { data: updatedDescriptions, error: updateError } = await supabase
          .schema('core')
          .from('attraction_descriptions')
          .select('id, verification_status, last_score_overall, last_verified_at')
          .in('id', descriptionIds);

        if (updateError) {
          console.error('❌ Erro ao verificar scores salvos:', updateError);
        } else {
          console.log('✅ Scores salvos:');
          updatedDescriptions.forEach(desc => {
            console.log(`   • ID ${desc.id}: ${desc.last_score_overall}% (${desc.verification_status}) - ${desc.last_verified_at}`);
          });
        }

        // Verificar claims e evidências salvas
        const { data: scores, error: scoresError } = await supabase
          .schema('core')
          .from('description_scores')
          .select(`
            id,
            description_id,
            score_overall,
            subscores,
            flags,
            confidence,
            created_at
          `)
          .in('description_id', descriptionIds)
          .order('created_at', { ascending: false });

        if (scoresError) {
          console.error('❌ Erro ao buscar scores detalhados:', scoresError);
        } else {
          console.log('\n📈 Scores detalhados:');
          scores.forEach(score => {
            console.log(`   • Descrição ${score.description_id}:`);
            console.log(`     Score: ${score.score_overall}%`);
            console.log(`     Subscores: ${JSON.stringify(score.subscores)}`);
            console.log(`     Flags: ${score.flags?.join(', ') || 'nenhuma'}`);
            console.log(`     Confiança: ${score.confidence}`);
          });
        }

        // Verificar claims
        const { data: claims, error: claimsError } = await supabase
          .schema('core')
          .from('description_claims')
          .select('*')
          .in('description_id', descriptionIds);

        if (claimsError) {
          console.error('❌ Erro ao buscar claims:', claimsError);
        } else {
          console.log(`\n🔍 Claims salvos: ${claims?.length || 0}`);
          if (claims && claims.length > 0) {
            const claimsByStatus = claims.reduce((acc, claim) => {
              acc[claim.status] = (acc[claim.status] || 0) + 1;
              return acc;
            }, {});
            
            Object.entries(claimsByStatus).forEach(([status, count]) => {
              console.log(`   • ${status}: ${count}`);
            });
          }
        }

        // Verificar evidências
        if (claims && claims.length > 0) {
          const claimIds = claims.map(c => c.id);
          
          const { data: evidence, error: evidenceError } = await supabase
            .schema('core')
            .from('description_claim_evidence')
            .select('*')
            .in('claim_id', claimIds);

          if (evidenceError) {
            console.error('❌ Erro ao buscar evidências:', evidenceError);
          } else {
            console.log(`\n💾 Evidências salvas: ${evidence?.length || 0}`);
            if (evidence && evidence.length > 0) {
              const evidenceByVerdict = evidence.reduce((acc, ev) => {
                acc[ev.verdict] = (acc[ev.verdict] || 0) + 1;
                return acc;
              }, {});
              
              Object.entries(evidenceByVerdict).forEach(([verdict, count]) => {
                console.log(`   • ${verdict}: ${count}`);
              });
            }
          }
        }
      }
    }

    console.log('\n🎉 TESTE DE VERIFICAÇÃO EM LOTE CONCLUÍDO!');
    console.log('================================================================================');

  } catch (error) {
    console.error('❌ Erro durante o teste:', error);
  }
}

// Executar teste
testBatchVerification();