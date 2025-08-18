const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function checkCurrentDescription() {
  console.log('🔍 Verificando descrição atual no banco...\n');

  const { data, error } = await supabase
    .schema('core')
    .from('attractions')
    .select(`
      name, city,
      attraction_descriptions(description, updated_at, verification_status)
    `)
    .eq('name', 'Lago do Taboão')
    .eq('city', 'Bragança Paulista')
    .single();

  if (error || !data) {
    console.error('❌ Erro:', error);
    return;
  }

  console.log(`✅ POI: ${data.name} (${data.city})`);
  
  const ptBrDescriptions = data.attraction_descriptions.filter(d => d.description);
  console.log(`📝 Total de descrições: ${ptBrDescriptions.length}`);

  ptBrDescriptions.forEach((desc, index) => {
    const hasHistoricalContent = desc.description.includes('dezembro de 2023') || 
                                desc.description.includes('ponte de estilo japonês') ||
                                desc.description.includes('Tori');
    
    console.log(`\n${index + 1}. Descrição (${desc.description.length} chars):`);
    console.log(`   Status: ${desc.verification_status || 'não verificada'}`);
    console.log(`   Atualizada: ${new Date(desc.updated_at).toLocaleString('pt-BR')}`);
    console.log(`   Conteúdo histórico: ${hasHistoricalContent ? '✅ SIM' : '❌ NÃO'}`);
    console.log(`   Texto: "${desc.description.substring(0, 100)}..."`);
  });

  // Verificar se a nova descrição histórica está lá
  const historicalDesc = ptBrDescriptions.find(d => 
    d.description.includes('dezembro de 2023') && 
    d.description.includes('ponte de estilo japonês')
  );

  if (historicalDesc) {
    console.log('\n🎉 NOVA DESCRIÇÃO HISTÓRICA CONFIRMADA!');
    console.log('─'.repeat(60));
    console.log(historicalDesc.description);
    console.log('─'.repeat(60));
  } else {
    console.log('\n⚠️ Nova descrição histórica NÃO encontrada no banco');
    console.log('❓ Possível problema na atualização');
  }
}

checkCurrentDescription();
