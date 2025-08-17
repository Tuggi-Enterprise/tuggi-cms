const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são necessárias');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function testPrimarySources() {
  console.log('🔍 Testando sistema com fontes primárias integradas...');
  
  try {
    // 1. Buscar uma atração que tenha website ou reference_links
    console.log('\n📋 Buscando atração com fontes primárias...');
    
    const { data: attractions, error: fetchError } = await supabase
      .schema('core')
      .from('attractions')
      .select('id, name, website, reference_links')
      .or('website.neq.null')
      .limit(5);

    if (fetchError) {
      console.error('❌ Erro ao buscar atrações:', fetchError);
      return;
    }

    if (!attractions || attractions.length === 0) {
      console.log('❌ Nenhuma atração com fontes primárias encontrada');
      return;
    }

    console.log(`✅ Encontradas ${attractions.length} atrações com fontes primárias:`);
    attractions.forEach((attraction, index) => {
      console.log(`  ${index + 1}. ${attraction.name}`);
      console.log(`     Website: ${attraction.website || 'N/A'}`);
      console.log(`     Reference Links: ${attraction.reference_links?.length || 0}`);
    });

    // 2. Buscar uma descrição original dessa atração
    const selectedAttraction = attractions[0];
    console.log(`\n🎯 Testando com atração: ${selectedAttraction.name}`);
    
    const { data: descriptions, error: descError } = await supabase
      .schema('core')
      .from('attraction_descriptions')
      .select('id, description, attraction_id, is_original')
      .eq('attraction_id', selectedAttraction.id)
      .eq('is_original', true)
      .limit(1);

    if (descError || !descriptions || descriptions.length === 0) {
      console.log('❌ Nenhuma descrição original encontrada para esta atração');
      return;
    }

    const description = descriptions[0];
    console.log(`📋 Descrição encontrada: ${description.description.substring(0, 100)}...`);

    // 3. Testar a Edge Function com fontes primárias
    console.log('\n🚀 Testando Edge Function com fontes primárias...');
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

    console.log(`✅ Verificação concluída em ${duration}s:`, {
      success: data.success,
      score_overall: data.score_overall,
      claims_processed: data.claims_processed
    });

    // 4. Verificar resultados
    console.log('\n🔍 Verificando resultados...');
    
    const { data: scores } = await supabase
      .schema('core')
      .from('description_scores')
      .select('*')
      .eq('description_id', description.id)
      .order('created_at', { ascending: false })
      .limit(1);

    if (scores && scores.length > 0) {
      console.log('✅ Score salvo:', {
        score_overall: scores[0].score_overall,
        subscores: scores[0].subscores,
        flags: scores[0].flags
      });
    }

    const { data: claims } = await supabase
      .schema('core')
      .from('description_claims')
      .select('*')
      .eq('description_id', description.id);

    console.log(`📊 Claims encontrados: ${claims?.length || 0}`);
    if (claims && claims.length > 0) {
      claims.forEach((claim, index) => {
        console.log(`  ${index + 1}. ${claim.value} (${claim.status})`);
      });
    }

    // 5. Verificar evidências (para ver se usou fontes primárias)
    if (claims && claims.length > 0) {
      const { data: evidence } = await supabase
        .schema('core')
        .from('description_claim_evidence')
        .select('*')
        .in('claim_id', claims.map(c => c.id));

      console.log(`\n📋 Evidências encontradas: ${evidence?.length || 0}`);
      if (evidence && evidence.length > 0) {
        evidence.forEach((ev, index) => {
          console.log(`  ${index + 1}. ${ev.source}: ${ev.page} (${ev.verdict})`);
        });
      }
    }

    // 6. Testar com uma atração sem fontes primárias (para comparar)
    console.log('\n🔄 Testando com atração sem fontes primárias para comparação...');
    
    const { data: attractionsWithoutSources } = await supabase
      .schema('core')
      .from('attractions')
      .select('id, name, website, reference_links')
      .is('website', null)
      .limit(1);

    if (attractionsWithoutSources && attractionsWithoutSources.length > 0) {
      const attractionWithoutSources = attractionsWithoutSources[0];
      console.log(`🎯 Testando com atração sem fontes: ${attractionWithoutSources.name}`);
      
      const { data: descWithoutSources } = await supabase
        .schema('core')
        .from('attraction_descriptions')
        .select('id, description, attraction_id, is_original')
        .eq('attraction_id', attractionWithoutSources.id)
        .eq('is_original', true)
        .limit(1);

      if (descWithoutSources && descWithoutSources.length > 0) {
        const desc = descWithoutSources[0];
        console.log(`📋 Descrição sem fontes: ${desc.description.substring(0, 100)}...`);
        
        const { data: resultWithoutSources, error: errorWithoutSources } = await supabase.functions.invoke('verify-batch', {
          body: {
            description_id: desc.id,
            description: desc.description,
            attraction_id: desc.attraction_id,
            force_reprocess: true
          }
        });

        if (!errorWithoutSources) {
          console.log(`✅ Verificação sem fontes primárias: Score ${resultWithoutSources.score_overall}`);
        }
      }
    }

    console.log('\n🎉 Teste das fontes primárias concluído!');

  } catch (error) {
    console.error('❌ Erro inesperado:', error);
  }
}

testPrimarySources();
