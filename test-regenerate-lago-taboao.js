const { createClient } = require('@supabase/supabase-js');
const { default: fetch } = require('node-fetch');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Variáveis de ambiente não encontradas');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function regenerateLagoTaboao() {
  console.log('🏛️ Regenerando descrição do Lago do Taboão...\n');

  try {
    // 1. Buscar dados do Lago do Taboão
    console.log('📊 1. Buscando dados do POI...');
    
    const { data: poi, error: poiError } = await supabase
      .schema('core')
      .from('attractions')
      .select(`
        id, name, city, country, google_types, rating, google_place_id,
        attraction_descriptions(id, description, language, is_original, verification_status)
      `)
      .eq('name', 'Lago do Taboão')
      .eq('city', 'Bragança Paulista')
      .single();

    if (poiError || !poi) {
      console.error('❌ Erro ao buscar POI:', poiError);
      return;
    }

    console.log(`✅ POI encontrado: ${poi.name}`);
    console.log(`   📍 Localização: ${poi.city}, ${poi.country}`);
    console.log(`   ⭐ Rating: ${poi.rating}`);
    console.log(`   🏷️ Tipos: ${poi.google_types.join(', ')}`);

    // Mostrar descrição atual
    const currentDesc = poi.attraction_descriptions.find(d => d.language === 'pt-br' && d.is_original);
    if (currentDesc) {
      console.log(`\n📝 Descrição atual (${currentDesc.verification_status || 'não verificada'}):`);
      console.log(`   Texto: "${currentDesc.description.substring(0, 100)}..."`);
    } else {
      console.log('\n⚠️ Nenhuma descrição original em pt-br encontrada');
    }

    // 2. Preparar dados para regeneração
    console.log('\n🔄 2. Preparando dados para regeneração...');
    
    const poiData = {
      id: poi.id,
      name: poi.name,
      city: poi.city,
      country: poi.country,
      google_types: poi.google_types,
      rating: poi.rating,
      google_place_id: poi.google_place_id,
      regenerate: true // Flag para indicar regeneração
    };

    console.log('📦 Dados preparados:', JSON.stringify(poiData, null, 2));

    // 3. Chamar endpoint otimizado
    console.log('\n🚀 3. Chamando endpoint de geração otimizada...');
    
    const response = await fetch('http://localhost:3000/api/descriptions/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(poiData)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ Erro na requisição (${response.status}):`, errorText);
      return;
    }

    const result = await response.json();
    console.log('✅ Resposta recebida:', JSON.stringify(result, null, 2));

    // 4. Mostrar nova descrição
    if (result.success && result.description) {
      console.log('\n🎉 4. Nova descrição gerada com sucesso!');
      console.log('─'.repeat(80));
      console.log(`📝 Nova descrição (${result.description.length} caracteres):`);
      console.log(`"${result.description}"`);
      console.log('─'.repeat(80));

      // Comparar com a anterior
      if (currentDesc) {
        console.log('\n📊 Comparação:');
        console.log(`   Anterior: ${currentDesc.description.length} caracteres`);
        console.log(`   Nova: ${result.description.length} caracteres`);
        console.log(`   Diferença: ${result.description.length - currentDesc.description.length} caracteres`);
      }

      // 5. Verificar se foi salva no banco
      console.log('\n🔍 5. Verificando se foi salva no banco...');
      
      const { data: updatedPoi, error: checkError } = await supabase
        .schema('core')
        .from('attractions')
        .select(`
          attraction_descriptions(id, description, language, is_original, created_at)
        `)
        .eq('id', poi.id)
        .single();

      if (checkError) {
        console.error('❌ Erro ao verificar atualização:', checkError);
      } else {
        const newDesc = updatedPoi.attraction_descriptions
          .filter(d => d.language === 'pt-br' && d.is_original)
          .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];

        if (newDesc && newDesc.description === result.description) {
          console.log('✅ Descrição salva no banco com sucesso!');
          console.log(`   ID da descrição: ${newDesc.id}`);
          console.log(`   Criada em: ${new Date(newDesc.created_at).toLocaleString('pt-BR')}`);
        } else {
          console.log('⚠️ Descrição pode não ter sido salva ou ainda está processando');
        }
      }

      // 6. Sugerir próximos passos
      console.log('\n🎯 6. Próximos passos sugeridos:');
      console.log('   1. Executar verificação factual da nova descrição');
      console.log('   2. Comparar score com a descrição anterior');
      console.log('   3. Analisar claims extraídas');
      console.log('   4. Verificar fontes utilizadas');
      
      console.log('\n🚀 Regeneração concluída com sucesso!');
      
    } else {
      console.error('❌ Falha na geração:', result);
    }

  } catch (error) {
    console.error('❌ Erro geral:', error);
  }
}

// Executar a regeneração
regenerateLagoTaboao();
