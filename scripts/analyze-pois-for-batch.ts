import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function analyzePOIsForBatch(): Promise<void> {
  console.log('📊 Analisando POIs para processamento em lote...\n');

  try {
    // Get total count
    const { count: totalCount, error: countError } = await supabase
      .schema('core')
      .from('attractions')
      .select('*', { count: 'exact', head: true });

    if (countError) {
      throw new Error(`Erro ao contar POIs: ${countError.message}`);
    }

    console.log(`📈 Total de POIs no banco: ${totalCount?.toLocaleString()}`);

    // Get POIs with existing images
    const { count: withImagesCount, error: withImagesError } = await supabase
      .schema('core')
      .from('attractions')
      .select('*', { count: 'exact', head: true })
      .not('image_url', 'is', null);

    if (withImagesError) {
      throw new Error(`Erro ao contar POIs com imagens: ${withImagesError.message}`);
    }

    console.log(`🖼️  POIs com imagens existentes: ${withImagesCount?.toLocaleString()}`);

    // Get POIs without images
    const { count: withoutImagesCount, error: withoutImagesError } = await supabase
      .schema('core')
      .from('attractions')
      .select('*', { count: 'exact', head: true })
      .is('image_url', null);

    if (withoutImagesError) {
      throw new Error(`Erro ao contar POIs sem imagens: ${withoutImagesError.message}`);
    }

    console.log(`❌ POIs sem imagens: ${withoutImagesCount?.toLocaleString()}`);

    // Get breakdown by country
    const { data: countryBreakdown, error: countryError } = await supabase
      .schema('core')
      .from('attractions')
      .select('country')
      .not('country', 'is', null);

    if (countryError) {
      throw new Error(`Erro ao obter breakdown por país: ${countryError.message}`);
    }

    const countryCounts: { [key: string]: number } = {};
    countryBreakdown?.forEach(item => {
      countryCounts[item.country] = (countryCounts[item.country] || 0) + 1;
    });

    console.log('\n🌍 Breakdown por país:');
    Object.entries(countryCounts)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 10)
      .forEach(([country, count]) => {
        console.log(`   ${country}: ${count.toLocaleString()}`);
      });

    // Get breakdown by image source
    const { data: imageSourceBreakdown, error: imageSourceError } = await supabase
      .schema('core')
      .from('attractions')
      .select('image_source')
      .not('image_url', 'is', null)
      .not('image_source', 'is', null);

    if (imageSourceError) {
      throw new Error(`Erro ao obter breakdown por fonte: ${imageSourceError.message}`);
    }

    const sourceCounts: { [key: string]: number } = {};
    imageSourceBreakdown?.forEach(item => {
      sourceCounts[item.image_source] = (sourceCounts[item.image_source] || 0) + 1;
    });

    console.log('\n📸 Breakdown por fonte de imagem:');
    Object.entries(sourceCounts)
      .sort(([,a], [,b]) => b - a)
      .forEach(([source, count]) => {
        console.log(`   ${source}: ${count.toLocaleString()}`);
      });

    // Sample some POIs for testing
    console.log('\n🔍 Amostra de POIs (primeiros 10):');
    const { data: samplePOIs, error: sampleError } = await supabase
      .schema('core')
      .from('attractions')
      .select('id, name, city, country, image_url, image_source')
      .limit(10);

    if (sampleError) {
      throw new Error(`Erro ao obter amostra: ${sampleError.message}`);
    }

    samplePOIs?.forEach((poi, index) => {
      console.log(`   ${index + 1}. ${poi.name} (${poi.city}, ${poi.country})`);
      console.log(`      Imagem: ${poi.image_url ? '✅' : '❌'} | Fonte: ${poi.image_source || 'N/A'}`);
    });

    // Calculate processing estimates
    console.log('\n⏱️  Estimativas de processamento:');
    console.log(`   Com 1 req/segundo: ~${Math.ceil((totalCount || 0) / 60)} minutos`);
    console.log(`   Com 2 req/segundo: ~${Math.ceil((totalCount || 0) / 120)} minutos`);
    console.log(`   Com batches de 100: ${Math.ceil((totalCount || 0) / 100)} batches`);
    console.log(`   Com batches de 500: ${Math.ceil((totalCount || 0) / 500)} batches`);

  } catch (error) {
    console.error('💥 Erro na análise:', error.message);
  }
}

analyzePOIsForBatch().catch(console.error);
