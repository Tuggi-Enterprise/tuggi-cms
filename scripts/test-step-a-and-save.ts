// scripts/test-step-a-and-save.ts

import { createClient } from '@supabase/supabase-js';
import { generateMasterPack } from '../supabase/functions/_shared/masterPackGenerator.ts';

// Configuração do ambiente
const PROJECT_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const GEMINI_API_KEY = process.env.GOOGLE_GEMINI_API_KEY || process.env.GEMINI_API_KEY;

const supabase = createClient(PROJECT_URL, SERVICE_ROLE_KEY);

async function testStepAAndSave() {
    const poiId = "50cd5835-70db-41be-9084-3adcae63c15e"; // ID do POI de Bragança
    const poiName = "Bragança Paulista";
    const city = "Bragança Paulista";
    const language = "pt-br";

    console.log(`\n🚀 INICIANDO STEP A COM PERSISTÊNCIA - POI: ${poiName}\n`);

    try {
        // 1. Gerar o Conteúdo no Step A
        const result = await generateMasterPack(
            poiName,
            city,
            "Teste de integração com salvamento no banco.",
            language,
            GEMINI_API_KEY!
        );

        console.log("✅ Descrição gerada com sucesso.");

        // 2. Salvar no Supabase (Simulando a lógica da Edge Function)
        console.log(`💾 Salvando no Supabase (Schema: core, Tabela: attraction_descriptions)...`);

        const { error } = await supabase
            .schema('core')
            .from('attraction_descriptions')
            .upsert({
                attraction_id: poiId,
                language: language,
                description: result.description,
                facts_pack_json: result.facts_pack_json,
                last_verified_at: new Date().toISOString(),
                verification_status: 'approved'
            }, {
                onConflict: 'attraction_id,language'
            });

        if (error) {
            console.error("❌ Erro ao salvar no banco:", error.message);
        } else {
            console.log("\n✨ SUCESSO! Os dados foram atualizados no Banco de Dados.");
            console.log(`\nConfira no Dashboard o POI ${poiId}:`);
            console.log(`- Descrição: "${result.description.substring(0, 50)}..."`);
            console.log(`- Fatos: ${result.facts_pack_json.length} itens salvos.`);
        }

    } catch (error) {
        console.error("❌ Falha no processo:", error);
    }
}

testStepAAndSave();
