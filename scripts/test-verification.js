#!/usr/bin/env node

/**
 * Script para testar o sistema de verificação factual
 * 
 * Uso:
 * node scripts/test-verification.js
 */

const { createClient } = require('@supabase/supabase-js');

// Configuração do Supabase
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Variáveis de ambiente não configuradas');
  console.error('NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são necessárias');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function testVerificationSystem() {
  console.log('🧪 Testando Sistema de Verificação Factual\n');

  try {
    // 1. Verificar se as tabelas existem
    console.log('1️⃣ Verificando estrutura das tabelas...');
    
    const { data: descriptions, error: descError } = await supabase
      .schema('core')
      .from('attraction_descriptions')
      .select('id, description, is_original, verification_status')
      .eq('is_original', true)
      .limit(1);

    if (descError) {
      console.error('❌ Erro ao acessar attraction_descriptions:', descError.message);
      return;
    }

    console.log('✅ Tabela attraction_descriptions acessível');
    console.log(`   - Descrições originais encontradas: ${descriptions?.length || 0}`);

    // 2. Verificar configurações
    console.log('\n2️⃣ Verificando configurações...');
    
    const { data: settings, error: settingsError } = await supabase
      .schema('core')
      .from('verify_settings')
      .select('key, value');

    if (settingsError) {
      console.error('❌ Erro ao acessar verify_settings:', settingsError.message);
      return;
    }

    console.log('✅ Configurações carregadas:');
    settings?.forEach(setting => {
      console.log(`   - ${setting.key}: ${JSON.stringify(setting.value)}`);
    });

    // 3. Verificar view
    console.log('\n3️⃣ Verificando view v_descriptions_with_last_score...');
    
    const { data: viewData, error: viewError } = await supabase
      .schema('core')
      .from('v_descriptions_with_last_score')
      .select('description_id, attraction_name, verification_status, last_score_overall')
      .limit(5);

    if (viewError) {
      console.error('❌ Erro ao acessar view:', viewError.message);
      return;
    }

    console.log('✅ View funcionando:');
    viewData?.forEach(item => {
      console.log(`   - ${item.attraction_name}: ${item.verification_status} (score: ${item.last_score_overall || 'N/A'})`);
    });

    // 4. Testar API de agendamento
    console.log('\n4️⃣ Testando API de agendamento...');
    
    const scheduleResponse = await fetch('http://localhost:3000/api/verify/schedule', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ batch: 1 }),
    });

    if (scheduleResponse.ok) {
      const scheduleResult = await scheduleResponse.json();
      console.log('✅ API de agendamento funcionando:');
      console.log(`   - Scheduled: ${scheduleResult.scheduled}`);
      console.log(`   - Message: ${scheduleResult.message}`);
    } else {
      console.log('⚠️  API de agendamento não disponível (servidor não rodando?)');
    }

    // 5. Estatísticas gerais
    console.log('\n5️⃣ Estatísticas gerais...');
    
    const { data: stats, error: statsError } = await supabase
      .schema('core')
      .from('v_descriptions_with_last_score')
      .select('verification_status');

    if (!statsError && stats) {
      const statusCounts = stats.reduce((acc, item) => {
        acc[item.verification_status] = (acc[item.verification_status] || 0) + 1;
        return acc;
      }, {});

      console.log('✅ Estatísticas:');
      Object.entries(statusCounts).forEach(([status, count]) => {
        console.log(`   - ${status}: ${count}`);
      });
    }

    console.log('\n🎉 Teste concluído com sucesso!');
    console.log('\n📋 Próximos passos:');
    console.log('1. Deploy da Edge Function: supabase functions deploy verify-batch');
    console.log('2. Configurar GEMINI_API_KEY no Supabase');
    console.log('3. Acessar /verification no CMS');
    console.log('4. Agendar verificação de um lote');

  } catch (error) {
    console.error('❌ Erro durante o teste:', error);
  }
}

// Executar teste
testVerificationSystem();
