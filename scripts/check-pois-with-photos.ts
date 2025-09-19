#!/usr/bin/env tsx

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function checkPOIsWithPhotos() {
  console.log('🔍 Verificando POIs com fotos...');
  
  // Verificar POIs com photos_references
  const { data: poisWithPhotos, error: photosError } = await supabase
    .schema('core')
    .from('attractions')
    .select('id, name, photos_references')
    .not('photos_references', 'is', null)
    .limit(10);

  if (photosError) {
    console.error('❌ Erro ao buscar POIs com photos_references:', photosError);
    return;
  }

  console.log(`📊 POIs com photos_references: ${poisWithPhotos?.length || 0}`);
  
  if (poisWithPhotos && poisWithPhotos.length > 0) {
    console.log('\n📋 Primeiros POIs com fotos:');
    poisWithPhotos.forEach((poi, index) => {
      console.log(`   ${index + 1}. ${poi.name} (${poi.photos_references?.length || 0} fotos)`);
    });
  }

  // Verificar POIs com image_url
  const { data: poisWithImages, error: imagesError } = await supabase
    .schema('core')
    .from('attractions')
    .select('id, name, image_url')
    .not('image_url', 'is', null)
    .limit(10);

  if (imagesError) {
    console.error('❌ Erro ao buscar POIs com image_url:', imagesError);
    return;
  }

  console.log(`\n📊 POIs com image_url: ${poisWithImages?.length || 0}`);
  
  if (poisWithImages && poisWithImages.length > 0) {
    console.log('\n📋 Primeiros POIs com image_url:');
    poisWithImages.forEach((poi, index) => {
      console.log(`   ${index + 1}. ${poi.name}`);
      console.log(`      URL: ${poi.image_url?.substring(0, 80)}...`);
    });
  }

  // Verificar total de POIs
  const { count: totalPOIs, error: totalError } = await supabase
    .schema('core')
    .from('attractions')
    .select('*', { count: 'exact', head: true });

  if (totalError) {
    console.error('❌ Erro ao contar POIs:', totalError);
    return;
  }

  console.log(`\n📊 Total de POIs: ${totalPOIs}`);
}

checkPOIsWithPhotos().catch(console.error);
