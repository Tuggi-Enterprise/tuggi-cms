const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são necessárias');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function testSimpleVerification() {
  console.log('🧪 Teste simples de verificação...');
  
  try {
    // Usar uma descrição que sabemos que funciona
    const descriptionId = '64f278e6-f536-45d0-a3ca-777b6549ba92';
    
    const { data: description, error: fetchError } = await supabase
      .schema('core')
      .from('attraction_descriptions')
      .select('id, description, attraction_id, is_original')
      .eq('id', descriptionId)
      .single();

    if (fetchError) {
      console.error('❌ Erro ao buscar descrição:', fetchError);
      return;
    }

    console.log('📋 Descrição:', description.description.substring(0, 100) + '...');

    // Testar a Edge Function
    console.log('\n🚀 Chamando Edge Function...');
    const startTime = Date.now();
    
    const { data, error } = await supabase.functions.invoke('verify-batch', {
      body: {
        description_id: description.id,
        description: description.description,
        attraction_id: description.attraction_id,
        force_reprocess: true
      }
    });

    const endTime = Date.now();
    const duration = (endTime - startTime) / 1000;

    if (error) {
      console.error('❌ Erro na Edge Function:', error);
      return;
    }

    console.log(`✅ Verificação concluída em ${duration}s:`, data);

    // Verificar se as evidências foram salvas
    console.log('\n🔍 Verificando evidências...');
    
    const { data: claims } = await supabase
      .schema('core')
      .from('description_claims')
      .select('*')
      .eq('description_id', description.id)
      .order('created_at', { ascending: false })
      .limit(3);

    if (claims && claims.length > 0) {
      console.log(`📊 Claims encontrados: ${claims.length}`);
      
      for (const claim of claims) {
        console.log(`\n🔍 Claim: ${claim.value}`);
        console.log(`   Status: ${claim.status}`);
        console.log(`   Weight: ${claim.weight}`);
        
        // Buscar evidências
        const { data: evidence } = await supabase
          .schema('core')
          .from('description_claim_evidence')
          .select('*')
          .eq('claim_id', claim.id);

        console.log(`   Evidências: ${evidence?.length || 0}`);
        if (evidence && evidence.length > 0) {
          evidence.forEach((ev, index) => {
            console.log(`     ${index + 1}. ${ev.source}: ${ev.page || ev.url} (${ev.verdict})`);
          });
        }
      }
    }

  } catch (error) {
    console.error('❌ Erro inesperado:', error);
  }
}

testSimpleVerification();
