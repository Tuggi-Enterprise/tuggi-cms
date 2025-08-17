const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Variáveis de ambiente não encontradas');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function testIndividualVerify() {
  console.log('🧪 Testando verificação individual...\n');

  try {
    // 1. Buscar uma descrição rejeitada para testar
    const { data: rejectedItem, error: fetchError } = await supabase
      .schema('core')
      .from('attraction_descriptions')
      .select(`
        id, 
        description, 
        attraction_id, 
        verification_status,
        description_scores(
          score_overall,
          created_at
        )
      `)
      .eq('is_original', true)
      .eq('language', 'pt-br')
      .eq('verification_status', 'rejected')
      .limit(1)
      .single();

    if (fetchError) {
      console.error('❌ Erro ao buscar item:', fetchError);
      return;
    }

    const latestScore = rejectedItem.description_scores
      ?.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];

    console.log(`📊 Testando descrição: ${rejectedItem.id}`);
    console.log(`📄 Descrição: "${rejectedItem.description.substring(0, 100)}..."`);
    console.log(`📊 Score atual: ${latestScore?.score_overall || 0}%`);
    console.log(`🏷️ Status: ${rejectedItem.verification_status}`);

    // 2. Testar API de status
    console.log('\n🔍 Testando API de status...');
    
    const statusResponse = await fetch('http://localhost:3000/api/verify/status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        description_id: rejectedItem.id
      })
    });

    if (statusResponse.ok) {
      const statusData = await statusResponse.json();
      console.log('✅ Status API:', JSON.stringify(statusData, null, 2));
    } else {
      console.error('❌ Erro na API de status:', await statusResponse.text());
    }

    // 3. Testar API de verificação individual
    console.log('\n🔄 Testando API de verificação individual...');
    
    const verifyResponse = await fetch('http://localhost:3000/api/verify/individual', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        description_id: rejectedItem.id
      })
    });

    if (verifyResponse.ok) {
      const verifyData = await verifyResponse.json();
      console.log('✅ Verificação individual:', JSON.stringify(verifyData, null, 2));
    } else {
      const errorData = await verifyResponse.json();
      console.error('❌ Erro na verificação individual:', errorData);
    }

  } catch (error) {
    console.error('❌ Erro geral:', error);
  }
}

testIndividualVerify();
