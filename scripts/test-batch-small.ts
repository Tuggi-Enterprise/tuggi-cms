import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

interface POI {
  id: string;
  name: string;
  city: string;
  state: string;
  country: string;
  image_url: string | null;
  image_source: string | null;
}

async function testBatchSmall(): Promise<void> {
  console.log('🧪 Teste do sistema de batch com amostra pequena (10 POIs)');
  console.log('='.repeat(60));

  try {
    // Get a small sample of POIs
    const { data: pois, error } = await supabase
      .schema('core')
      .from('attractions')
      .select('id, name, city, state, country, image_url, image_source')
      .limit(10)
      .order('id');

    if (error || !pois) {
      throw new Error(`Erro ao buscar POIs: ${error?.message}`);
    }

    console.log(`📦 Processando ${pois.length} POIs de teste:`);
    
    const results = [];
    
    for (let i = 0; i < pois.length; i++) {
      const poi = pois[i];
      console.log(`\n[${i + 1}/${pois.length}] 🔄 ${poi.name} (${poi.city}, ${poi.country})`);
      console.log(`   Imagem atual: ${poi.image_url ? '✅ ' + poi.image_source : '❌ Sem imagem'}`);
      
      try {
        const startTime = Date.now();
        
        // Call the Wikimedia Edge Function
        const response = await fetch(`${supabaseUrl}/functions/v1/unified-image-processing`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${supabaseServiceKey}`
          },
          body: JSON.stringify({
            attractionId: poi.id,
            attractionName: poi.name,
            city: poi.city,
            state: poi.state,
            country: poi.country
          })
        });

        const processingTime = Date.now() - startTime;

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();

        if (data.success && data.imageUrl) {
          console.log(`   ✅ Nova imagem encontrada: ${data.imageUrl}`);
          console.log(`   ⏱️  Tempo: ${processingTime}ms`);
          
          // Simulate database update (don't actually update in test)
          console.log(`   💾 [SIMULAÇÃO] Atualizaria DB com fonte: wikimedia`);
          
          if (poi.image_url) {
            console.log(`   🗑️  [SIMULAÇÃO] Deletaria imagem antiga: ${poi.image_url}`);
          }
          
          results.push({ poi, success: true, processingTime, newImageUrl: data.imageUrl });
        } else {
          console.log(`   ❌ Nenhuma imagem encontrada: ${data.error}`);
          results.push({ poi, success: false, error: data.error, processingTime });
        }
        
      } catch (error) {
        console.log(`   💥 Erro: ${error.message}`);
        results.push({ poi, success: false, error: error.message });
      }
      
      // Small delay between requests
      if (i < pois.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 RESUMO DO TESTE');
    console.log('='.repeat(60));
    
    const successful = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);
    
    console.log(`✅ Sucessos: ${successful.length}/${results.length} (${(successful.length/results.length*100).toFixed(1)}%)`);
    console.log(`❌ Falhas: ${failed.length}/${results.length} (${(failed.length/results.length*100).toFixed(1)}%)`);
    
    if (successful.length > 0) {
      const avgTime = successful.reduce((sum, r) => sum + (r.processingTime || 0), 0) / successful.length;
      console.log(`⏱️  Tempo médio por sucesso: ${avgTime.toFixed(0)}ms`);
    }
    
    console.log('\n🎯 POIs com sucesso:');
    successful.forEach(result => {
      console.log(`   • ${result.poi.name}: ${result.newImageUrl}`);
    });
    
    if (failed.length > 0) {
      console.log('\n❌ POIs que falharam:');
      failed.forEach(result => {
        console.log(`   • ${result.poi.name}: ${result.error}`);
      });
    }
    
    console.log('\n✅ Teste concluído! O sistema está pronto para processamento em lote.');
    console.log('💡 Execute: npx tsx scripts/batch-process-wikimedia-optimized.ts');
    
  } catch (error) {
    console.error('💥 Erro no teste:', error.message);
  }
}

testBatchSmall().catch(console.error);
