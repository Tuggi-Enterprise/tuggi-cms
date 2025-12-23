// scripts/test-generate-description-function.ts

const PROJECT_REF = "tysnkzmljlmmqpbotkxv";
const FUNCTION_URL = `https://${PROJECT_REF}.supabase.co/functions/v1/generate-description`;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function testGenerateDescription() {
    const poiId = "50cd5835-70db-41be-9084-3adcae63c15e"; // Bragança Paulista

    console.log(`\n🚀 TESTANDO EDGE FUNCTION: generate-description`);
    console.log(`POI ID: ${poiId}`);

    const response = await fetch(FUNCTION_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${SERVICE_ROLE_KEY}`
        },
        body: JSON.stringify({
            poi_id: poiId,
            language: "pt-br",
            raw_context: "Teste de geração mestre com salvamento de fatos."
        })
    });

    const result = await response.json();
    console.log("\n--- RESPOSTA DA FUNÇÃO ---");
    console.log(JSON.stringify(result, null, 2));

    if (result.success) {
        console.log("\n✅ SUCESSO! Conteúdo gerado e salvo no banco.");
    } else {
        console.log("\n❌ ERRO:", result.error);
    }
}

testGenerateDescription();
