const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são necessárias');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkDescriptionsStatus() {
  console.log('🔍 INVESTIGANDO STATUS DAS DESCRIÇÕES\n');
  
  // Buscar todas as descrições das atrações que encontramos
  const attractionNames = [
    'Castelinho do Jardim Botânico de São Paulo',
    'Casa do Grito | Museu da Cidade de São Paulo', 
    'Bourbon Resort Atibaia',
    'Museu da Energia de São Paulo',
    'Parque Dom Pedro II',
    'Museo Olímpico y del Deporte Joan Antoni Samaranch',
    'Parque do Povo Mário Pimenta Camargo',
    'Capela Santa Cruz'
  ];
  
  for (const attractionName of attractionNames) {
    console.log(`\n🏛️ ${attractionName}`);
    console.log('-' .repeat(50));
    
    // Buscar atração
    const { data: attractions } = await supabase
      .schema('core')
      .from('attractions')
      .select('id, name')
      .ilike('name', `%${attractionName.split('|')[0].trim()}%`)
      .limit(1);
      
    if (!attractions || attractions.length === 0) {
      console.log('❌ Atração não encontrada');
      continue;
    }
    
    const attraction = attractions[0];
    
    // Buscar TODAS as descrições desta atração
    const { data: descriptions } = await supabase
      .schema('core')
      .from('attraction_descriptions')
      .select('id, language, is_original, description, created_at')
      .eq('attraction_id', attraction.id)
      .order('created_at', { ascending: false });
      
    if (!descriptions || descriptions.length === 0) {
      console.log('❌ Nenhuma descrição encontrada');
      continue;
    }
    
    console.log(`📋 Total de descrições: ${descriptions.length}`);
    
    descriptions.forEach((desc, index) => {
      const preview = desc.description ? desc.description.substring(0, 60) + '...' : 'VAZIA';
      const originalFlag = desc.is_original ? '🟢 ORIGINAL' : '⚪ Não original';
      console.log(`   ${index + 1}. ${desc.language} | ${originalFlag} | "${preview}"`);
    });
    
    // Verificar se há descrições em português
    const ptDescriptions = descriptions.filter(d => d.language === 'pt-BR');
    const originalPtDescriptions = descriptions.filter(d => d.language === 'pt-BR' && d.is_original);
    
    console.log(`🇧🇷 Descrições em português: ${ptDescriptions.length}`);
    console.log(`✅ Descrições originais em português: ${originalPtDescriptions.length}`);
    
    if (ptDescriptions.length > 0 && originalPtDescriptions.length === 0) {
      console.log(`⚠️ PROBLEMA: Tem descrições em PT-BR mas nenhuma marcada como original!`);
      
      // Mostrar a primeira descrição em português para análise
      const firstPtDesc = ptDescriptions[0];
      console.log(`📝 Primeira descrição PT-BR: "${firstPtDesc.description?.substring(0, 120)}..."`);
    }
  }
  
  // Estatísticas gerais
  console.log('\n\n📊 ESTATÍSTICAS GERAIS DO BANCO');
  console.log('=' .repeat(60));
  
  const { data: totalDescriptions } = await supabase
    .schema('core')
    .from('attraction_descriptions')
    .select('language, is_original', { count: 'exact' });
    
  const { data: originalDescriptions } = await supabase
    .schema('core')
    .from('attraction_descriptions')
    .select('language, is_original', { count: 'exact' })
    .eq('is_original', true);
    
  const { data: ptBrDescriptions } = await supabase
    .schema('core')
    .from('attraction_descriptions')
    .select('language, is_original', { count: 'exact' })
    .eq('language', 'pt-BR');
    
  const { data: originalPtBrDescriptions } = await supabase
    .schema('core')
    .from('attraction_descriptions')
    .select('language, is_original', { count: 'exact' })
    .eq('language', 'pt-BR')
    .eq('is_original', true);
  
  console.log(`📋 Total de descrições no banco: ${totalDescriptions?.length || 0}`);
  console.log(`✅ Descrições marcadas como originais: ${originalDescriptions?.length || 0}`);
  console.log(`🇧🇷 Descrições em português: ${ptBrDescriptions?.length || 0}`);
  console.log(`🎯 Descrições originais em português: ${originalPtBrDescriptions?.length || 0}`);
  
  // Sugerir algumas descrições originais existentes para teste
  console.log('\n🎯 SUGESTÃO: Descrições originais existentes para teste');
  console.log('-' .repeat(60));
  
  const { data: existingOriginals } = await supabase
    .schema('core')
    .from('attraction_descriptions')
    .select(`
      id,
      description,
      attractions:attraction_id (
        name,
        city,
        country
      )
    `)
    .eq('language', 'pt-BR')
    .eq('is_original', true)
    .not('description', 'is', null)
    .limit(5);
    
  if (existingOriginals && existingOriginals.length > 0) {
    existingOriginals.forEach((desc, index) => {
      const attraction = desc.attractions;
      const preview = desc.description.substring(0, 80) + '...';
      console.log(`${index + 1}. ${attraction.name} (${attraction.city}, ${attraction.country})`);
      console.log(`   "${preview}"\n`);
    });
  } else {
    console.log('❌ Nenhuma descrição original em português encontrada no banco!');
  }
}

checkDescriptionsStatus();
