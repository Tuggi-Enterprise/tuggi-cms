const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function testClaimsExtraction() {
  console.log('🔍 Testando extração de claims da descrição otimizada...\n');

  try {
    // 1. Buscar a descrição otimizada
    const { data: poi, error: poiError } = await supabase
      .schema('core')
      .from('attractions')
      .select('id, name, city')
      .eq('name', 'Lago do Taboão')
      .eq('city', 'Bragança Paulista')
      .single();

    if (poiError || !poi) {
      console.error('❌ Erro ao buscar POI:', poiError);
      return;
    }

    const { data: optimizedDesc, error: descError } = await supabase
      .schema('core')
      .from('attraction_descriptions')
      .select('*')
      .eq('attraction_id', poi.id)
      .eq('language', 'pt-br')
      .eq('is_original', true)
      .ilike('description', '%dezembro de 2023%')
      .single();

    if (descError || !optimizedDesc) {
      console.error('❌ Erro ao buscar descrição otimizada:', descError);
      return;
    }

    console.log('✅ Descrição otimizada encontrada:');
    console.log(`   Texto: "${optimizedDesc.description}"`);
    console.log(`   Caracteres: ${optimizedDesc.description.length}`);

    // 2. Analisar dados factuais presentes
    console.log('\n🔍 Análise de dados factuais presentes:');
    
    const factualData = [
      { text: 'dezembro de 2023', type: 'year', category: 'data específica' },
      { text: '23 metros', type: 'dimension', category: 'medida exata' },
      { text: 'ponte japonesa', type: 'architecture', category: 'tipo específico' },
      { text: 'portal Tori', type: 'cultural', category: 'elemento cultural' },
      { text: 'Festival da Linguiça', type: 'event', category: 'evento tradicional' },
      { text: 'cartão-postal de Bragança Paulista', type: 'cultural', category: 'status oficial' },
      { text: 'imigração japonesa', type: 'cultural', category: 'contexto histórico' },
      { text: 'jardim oriental', type: 'architecture', category: 'elemento arquitetônico' },
      { text: 'festas de Ano Novo', type: 'event', category: 'evento tradicional' }
    ];

    factualData.forEach((data, index) => {
      const found = optimizedDesc.description.toLowerCase().includes(data.text.toLowerCase());
      console.log(`   ${index + 1}. "${data.text}" (${data.type}): ${found ? '✅ ENCONTRADO' : '❌ NÃO ENCONTRADO'} - ${data.category}`);
    });

    // 3. Testar validação de entrada
    console.log('\n🛡️ Testando validação de entrada...');
    
    // Função de validação simulada
    function validateInput(description) {
      const suspiciousPatterns = [
        /ignore\s+(the\s+)?(prompt|instruction|system|previous)/i,
        /forget\s+(everything|all|previous)/i,
        /(act\s+as|pretend\s+to\s+be|you\s+are\s+now)/i,
        /write\s+about\s+(?!.*\b(museum|monument|park|attraction|heritage|church|cathedral|palace|castle|building|architecture)\b)/i,
        /(madonna|celebrity|politics|entertainment)/i,
        /system\s*[:=]\s*["\']?/i,
        /role\s*[:=]\s*["\']?/i,
        /(override|bypass|disable)\s+(security|protection|filter)/i,
        /jailbreak|jail\s*break/i,
        /new\s+(instruction|command|prompt|system)/i,
        /end\s+of\s+(prompt|instruction|system)/i
      ];
      
      return !suspiciousPatterns.some(pattern => pattern.test(description));
    }

    function isAttractionRelated(description) {
      const attractionKeywords = [
        'museu', 'museum', 'parque', 'park', 'igreja', 'church', 'catedral', 'cathedral',
        'monumento', 'monument', 'palácio', 'palace', 'castelo', 'castle', 'edifício', 'building',
        'construído', 'construída', 'built', 'inaugurado', 'inaugurada', 'opened',
        'arquitetura', 'architecture', 'patrimônio', 'heritage', 'tombado', 'histórico', 'historic',
        'turístico', 'tourist', 'atração', 'attraction', 'centro', 'centro histórico',
        'praça', 'square', 'avenida', 'rua', 'street', 'localizado', 'localizada', 'located',
        'fundado', 'fundada', 'founded', 'criado', 'criada', 'created', 'lago', 'lake'
      ];
      
      const text = description.toLowerCase();
      return attractionKeywords.some(keyword => text.includes(keyword));
    }

    const isValidInput = validateInput(optimizedDesc.description);
    const isAttraction = isAttractionRelated(optimizedDesc.description);

    console.log(`   Validação de entrada: ${isValidInput ? '✅ PASSOU' : '❌ FALHOU'}`);
    console.log(`   Relacionado a atração: ${isAttraction ? '✅ SIM' : '❌ NÃO'}`);

    // 4. Testar extração direta via Gemini API
    console.log('\n🤖 Testando extração direta via Gemini API...');
    
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.error('❌ GEMINI_API_KEY não encontrada');
      return;
    }

    const { default: fetch } = require('node-fetch');
    
    // Prompt simplificado para teste
    const testPrompt = `Extraia dados factuais verificáveis da seguinte descrição de atração turística. Retorne apenas JSON válido.

Descrição: "${optimizedDesc.description}"

Extraia claims factuais como:
- Datas específicas (ex: "dezembro de 2023")
- Medidas exatas (ex: "23 metros")
- Elementos culturais (ex: "portal Tori", "Festival da Linguiça")
- Status oficial (ex: "cartão-postal")
- Eventos tradicionais

Formato JSON:
{
  "claims": [
    {
      "text": "claim literal",
      "type": "year|person|event|restoration|location|architecture|cultural|dimension|other",
      "confidence": 0.95
    }
  ],
  "total_claims": X
}`;

    const geminiResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: testPrompt }] }],
        generationConfig: {
          temperature: 0.3,
          topK: 40,
          topP: 0.95,
          maxOutputTokens: 500,
        },
      })
    });

    if (!geminiResponse.ok) {
      const errorData = await geminiResponse.json();
      console.error('❌ Erro na API Gemini:', errorData);
      return;
    }

    const geminiData = await geminiResponse.json();
    const responseText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!responseText) {
      console.error('❌ Nenhuma resposta da API');
      return;
    }

    console.log('✅ Resposta da API Gemini:');
    console.log(responseText);

    // 5. Tentar extrair JSON da resposta
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        console.log('\n🎉 Claims extraídas com sucesso!');
        console.log('─'.repeat(60));
        console.log(`Total de claims: ${parsed.total_claims || parsed.claims?.length || 0}`);
        
        if (parsed.claims && parsed.claims.length > 0) {
          parsed.claims.forEach((claim, index) => {
            console.log(`${index + 1}. [${claim.type}] "${claim.text}" (confiança: ${claim.confidence})`);
          });
        }
        console.log('─'.repeat(60));
      } else {
        console.log('\n⚠️ Nenhum JSON encontrado na resposta');
        console.log('Resposta completa:', responseText);
      }
    } catch (parseError) {
      console.error('❌ Erro ao fazer parse do JSON:', parseError);
      console.log('Resposta completa:', responseText);
    }

    // 6. Análise do problema
    console.log('\n🔍 ANÁLISE DO PROBLEMA:');
    console.log('─'.repeat(60));
    console.log('✅ Descrição tem dados factuais abundantes');
    console.log('✅ Validação de entrada passa');
    console.log('✅ Relacionado a atração');
    console.log('⚠️ Sistema não extrai claims');
    console.log('📋 Possíveis causas:');
    console.log('   1. Prompt muito restritivo');
    console.log('   2. Categorias muito específicas');
    console.log('   3. Validação muito rigorosa');
    console.log('   4. Problema no parsing JSON');

  } catch (error) {
    console.error('❌ Erro geral:', error);
  }
}

testClaimsExtraction();
