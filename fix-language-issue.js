const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são necessárias');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function fixLanguageIssue() {
  console.log('🔧 INVESTIGANDO E CORRIGINDO PROBLEMA DE IDIOMA\n');
  
  // 1. Verificar todos os valores únicos de language
  const { data: allDescriptions } = await supabase
    .schema('core')
    .from('attraction_descriptions')
    .select('language, is_original')
    .limit(1000);
    
  if (allDescriptions) {
    const languageStats = {};
    allDescriptions.forEach(desc => {
      const lang = desc.language;
      if (!languageStats[lang]) {
        languageStats[lang] = { total: 0, original: 0 };
      }
      languageStats[lang].total++;
      if (desc.is_original) {
        languageStats[lang].original++;
      }
    });
    
    console.log('📊 VALORES DE LANGUAGE ENCONTRADOS:');
    Object.entries(languageStats).forEach(([lang, stats]) => {
      console.log(`   "${lang}": ${stats.total} total, ${stats.original} originais`);
    });
  }
  
  console.log('\n🔍 Testando diferentes variações de pt-BR:');
  
  // Testar diferentes variações
  const variations = ['pt-BR', 'pt-br', 'pt_BR', 'pt_br', 'portuguese', 'pt'];
  
  for (const variation of variations) {
    const { data: descriptions } = await supabase
      .schema('core')
      .from('attraction_descriptions')
      .select('id, language, is_original', { count: 'exact' })
      .eq('language', variation)
      .eq('is_original', true)
      .limit(5);
      
    console.log(`   "${variation}": ${descriptions?.length || 0} descrições originais`);
  }
  
  // 2. Buscar descrições que parecem ser em português (independente do campo language)
  console.log('\n🇧🇷 BUSCANDO DESCRIÇÕES QUE PARECEM SER EM PORTUGUÊS:');
  
  const { data: possiblePtDescriptions } = await supabase
    .schema('core')
    .from('attraction_descriptions')
    .select(`
      id,
      language,
      is_original,
      description,
      attractions:attraction_id (
        name,
        city,
        country
      )
    `)
    .eq('is_original', true)
    .not('description', 'is', null)
    .limit(10);
    
  if (possiblePtDescriptions) {
    const portugueseDescriptions = possiblePtDescriptions.filter(desc => {
      const text = desc.description.toLowerCase();
      // Verificar palavras típicas do português
      return text.includes('construído') || text.includes('construída') || 
             text.includes('inaugurado') || text.includes('inaugurada') ||
             text.includes('localizado') || text.includes('localizada') ||
             text.includes('criado') || text.includes('criada') ||
             text.includes('século') || text.includes('história') ||
             text.includes('patrimônio') || text.includes('museu');
    });
    
    console.log(`✅ Encontradas ${portugueseDescriptions.length} descrições que parecem ser em português:`);
    
    portugueseDescriptions.slice(0, 5).forEach((desc, index) => {
      const attraction = desc.attractions;
      console.log(`\n${index + 1}. ${attraction.name} (${attraction.city}, ${attraction.country})`);
      console.log(`   Language field: "${desc.language}"`);
      console.log(`   Original: ${desc.is_original}`);
      console.log(`   Text: "${desc.description.substring(0, 100)}..."`);
    });
    
    // Se encontramos descrições em português, vamos testá-las
    if (portugueseDescriptions.length > 0) {
      console.log('\n🧪 TESTANDO PRIMEIRA DESCRIÇÃO EM PORTUGUÊS:');
      
      const testDesc = portugueseDescriptions[0];
      console.log(`\n🎯 Testando: ${testDesc.attractions.name}`);
      console.log(`📋 ID: ${testDesc.id}`);
      console.log(`🌐 Language: "${testDesc.language}"`);
      console.log(`📝 Descrição: "${testDesc.description.substring(0, 150)}..."`);
      
      // Testar o sistema de verificação
      console.log(`\n🚀 Executando verificação...`);
      const startTime = Date.now();
      
      const { data, error } = await supabase.functions.invoke('verify-batch', {
        body: {
          description_id: testDesc.id,
          description: testDesc.description,
          attraction_id: testDesc.attractions.id || 'unknown',
          force_reprocess: true
        }
      });

      const endTime = Date.now();
      const duration = (endTime - startTime) / 1000;

      if (error) {
        console.log(`❌ Erro na verificação:`, error);
      } else {
        console.log(`\n✅ SUCESSO! Processado em ${duration}s`);
        console.log(`📊 Score: ${data.score_overall}%`);
        console.log(`🔍 Claims: ${data.claims_processed}`);
        console.log(`🏷️ Flags: ${data.flags?.join(', ') || 'Nenhuma'}`);
        
        if (data.reasoning) {
          console.log(`💡 Claims extraídos: ${data.reasoning.total_claims}`);
          console.log(`💡 Claims suportados: ${data.reasoning.supported_claims}`);
        }
        
        // Verificar se foi salvo
        const { data: savedScore } = await supabase
          .schema('core')
          .from('description_scores')
          .select('score_overall')
          .eq('description_id', testDesc.id)
          .order('created_at', { ascending: false })
          .limit(1);
          
        const { data: savedClaims } = await supabase
          .schema('core')
          .from('description_claims')
          .select('id')
          .eq('description_id', testDesc.id);
          
        console.log(`💾 Score salvo: ${savedScore?.[0]?.score_overall || 'N/A'}%`);
        console.log(`💾 Claims salvos: ${savedClaims?.length || 0}`);
      }
    }
  }
  
  console.log('\n🎯 DIAGNÓSTICO COMPLETO!');
}

fixLanguageIssue();
