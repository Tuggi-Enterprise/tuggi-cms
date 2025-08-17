const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são necessárias');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function testBatchVerification() {
  console.log('🧪 Testando rotas de agendamento e reprocessamento...');
  
  try {
    // 1. Testar rota de agendamento
    console.log('\n📅 Testando /api/verify/schedule...');
    
    const scheduleResponse = await fetch('http://localhost:3000/api/verify/schedule', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ batch: 5 }),
    });

    const scheduleResult = await scheduleResponse.json();
    
    if (scheduleResponse.ok) {
      console.log('✅ Agendamento bem-sucedido:');
      console.log(JSON.stringify(scheduleResult, null, 2));
    } else {
      console.log('❌ Erro no agendamento:');
      console.log(JSON.stringify(scheduleResult, null, 2));
    }

    // 2. Buscar algumas descrições para testar reprocessamento
    console.log('\n🔍 Buscando descrições para reprocessamento...');
    
    const { data: descriptions, error: fetchError } = await supabase
      .schema('core')
      .from('attraction_descriptions')
      .select('id, description, attraction_id, is_original')
      .eq('is_original', true)
      .limit(3);

    if (fetchError) {
      console.error('❌ Erro ao buscar descrições:', fetchError);
      return;
    }

    if (!descriptions || descriptions.length === 0) {
      console.log('❌ Nenhuma descrição encontrada para reprocessamento');
      return;
    }

    console.log(`📋 Encontradas ${descriptions.length} descrições para reprocessamento`);

    // 3. Testar rota de reprocessamento
    console.log('\n🔄 Testando /api/verify/reprocess...');
    
    const descriptionIds = descriptions.map(d => d.id);
    
    const reprocessResponse = await fetch('http://localhost:3000/api/verify/reprocess', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ description_ids: descriptionIds }),
    });

    const reprocessResult = await reprocessResponse.json();
    
    if (reprocessResponse.ok) {
      console.log('✅ Reprocessamento bem-sucedido:');
      console.log(JSON.stringify(reprocessResult, null, 2));
    } else {
      console.log('❌ Erro no reprocessamento:');
      console.log(JSON.stringify(reprocessResult, null, 2));
    }

    // 4. Verificar resultados
    console.log('\n🔍 Verificando resultados...');
    
    for (const description of descriptions) {
      const { data: scores } = await supabase
        .schema('core')
        .from('description_scores')
        .select('*')
        .eq('description_id', description.id)
        .order('created_at', { ascending: false })
        .limit(1);

      if (scores && scores.length > 0) {
        console.log(`✅ Descrição ${description.id}: Score ${scores[0].score_overall}/100`);
      } else {
        console.log(`❌ Descrição ${description.id}: Sem score`);
      }
    }

  } catch (error) {
    console.error('❌ Erro inesperado:', error);
  }
}

testBatchVerification();
