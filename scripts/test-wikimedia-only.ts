import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

interface TestPOI {
  id: string;
  name: string;
  city: string;
  state: string;
  country: string;
}

interface TestResult {
  poi: TestPOI;
  success: boolean;
  imageUrl?: string;
  imageSource?: string;
  processingTime?: number;
  error?: string;
  imageDimensions?: { width: number; height: number };
}

async function testWikimediaOnly(): Promise<void> {
  console.log('🎯 Testando sistema focado apenas no Wikimedia Commons\n');

  // Test POIs including some that should match specific categories
  const testPOIs: TestPOI[] = [
    {
      id: 'test-1',
      name: 'Castelinho do Flamengo',
      city: 'Rio de Janeiro',
      state: 'RJ',
      country: 'BR'
    },
    {
      id: 'test-2',
      name: 'Cristo Redentor',
      city: 'Rio de Janeiro',
      state: 'RJ',
      country: 'BR'
    },
    {
      id: 'test-3',
      name: 'Pão de Açúcar',
      city: 'Rio de Janeiro',
      state: 'RJ',
      country: 'BR'
    },
    {
      id: 'test-4',
      name: 'Teatro Municipal',
      city: 'São Paulo',
      state: 'SP',
      country: 'BR'
    },
    {
      id: 'test-5',
      name: 'Pelourinho',
      city: 'Salvador',
      state: 'BA',
      country: 'BR'
    }
  ];

  const results: TestResult[] = [];

  for (const poi of testPOIs) {
    console.log(`\n📸 Testando: ${poi.name} (${poi.city}, ${poi.state})`);
    
    try {
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

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      
      const result: TestResult = {
        poi,
        success: data.success,
        imageUrl: data.imageUrl,
        imageSource: data.imageSource,
        processingTime: data.processingTime,
        error: data.error,
        imageDimensions: data.imageDimensions
      };

      results.push(result);

      if (data.success) {
        console.log(`   ✅ Sucesso: ${data.imageUrl}`);
        console.log(`   📏 Dimensões: ${data.imageDimensions?.width || 'N/A'}x${data.imageDimensions?.height || 'N/A'}`);
        console.log(`   ⏱️  Tempo: ${data.processingTime}ms`);
      } else {
        console.log(`   ❌ Falhou: ${data.error}`);
      }

      // Wait between requests to be respectful
      await new Promise(resolve => setTimeout(resolve, 2000));

    } catch (error) {
      console.log(`   💥 Erro: ${error.message}`);
      results.push({
        poi,
        success: false,
        error: error.message
      });
    }
  }

  // Summary
  console.log('\n' + '='.repeat(80));
  console.log('📊 RESUMO DOS TESTES - WIKIMEDIA COMMONS APENAS');
  console.log('='.repeat(80));

  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);

  console.log(`\n✅ Sucessos: ${successful.length}/${results.length}`);
  console.log(`❌ Falhas: ${failed.length}/${results.length}`);
  console.log(`📈 Taxa de sucesso: ${((successful.length / results.length) * 100).toFixed(1)}%`);

  if (successful.length > 0) {
    console.log('\n🎯 POIs com imagens encontradas:');
    successful.forEach(result => {
      console.log(`   • ${result.poi.name}: ${result.imageUrl}`);
      console.log(`     Dimensões: ${result.imageDimensions?.width || 'N/A'}x${result.imageDimensions?.height || 'N/A'}`);
    });
  }

  if (failed.length > 0) {
    console.log('\n❌ POIs sem imagens:');
    failed.forEach(result => {
      console.log(`   • ${result.poi.name}: ${result.error}`);
    });
  }

  console.log('\n📸 Sistema Wikimedia Commons configurado e testado!');
  console.log('💡 Para expandir no futuro, outras fontes podem ser adicionadas facilmente.');
}

// Run the test
testWikimediaOnly().catch(console.error);
