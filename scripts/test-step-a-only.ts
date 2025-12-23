// scripts/test-step-a-only.ts

import { generateMasterPack } from '../supabase/functions/_shared/masterPackGenerator.ts';

const GEMINI_API_KEY = process.env.GOOGLE_GEMINI_API_KEY || process.env.GEMINI_API_KEY;

async function testStepA() {
    const poiName = "Bragança Paulista";
    const city = "Bragança Paulista";
    const rawContext = "Informações sobre fundação e cultura local.";

    console.log(`\n🧪 TESTANDO STEP A (MASTER GENERATOR) - POI: ${poiName}\n`);
    console.log(`Objetivo: Validar se a descrição gerada é puramente enciclopédica e estática.\n`);

    try {
        const result = await generateMasterPack(
            poiName,
            city,
            rawContext,
            "pt-br",
            GEMINI_API_KEY!
        );

        console.log("--- RESULTADO DO STEP A ---");
        console.log(`\nDESCRIÇÃO MASTER:\n"${result.description}"\n`);
        console.log("FATOS EXTRAÍDOS (JSON):");
        console.log(JSON.stringify(result.facts_pack_json, null, 2));
        console.log("\n---------------------------");

        if (result.description.includes(city)) {
            console.log("\n⚠️ AVISO: A cidade foi mencionada na descrição (VIOLAÇÃO DE REGRA).");
        } else {
            console.log("\n✅ SUCESSO: A regra de não citar localização foi respeitada.");
        }

    } catch (error) {
        console.error("❌ Erro no Step A:", error);
    }
}

testStepA();
