import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

async function testCastelinhoSpecific(): Promise<void> {
  console.log('🏰 Testando especificamente o Castelinho do Flamengo\n');

  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/unified-image-processing`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${supabaseServiceKey}`
      },
      body: JSON.stringify({
        attractionId: 'castelinho-test',
        attractionName: 'Castelinho do Flamengo',
        city: 'Rio de Janeiro',
        state: 'RJ',
        country: 'BR'
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    
    console.log('📊 Resposta completa:', JSON.stringify(data, null, 2));
    
    if (data.success) {
      console.log(`\n✅ Sucesso!`);
      console.log(`📸 URL da imagem: ${data.imageUrl}`);
      console.log(`📦 Fonte: ${data.imageSource}`);
      console.log(`⏱️  Tempo de processamento: ${data.processingTime}ms`);
      console.log(`🔍 Fontes tentadas: ${data.sourcesTried?.join(', ')}`);
      
      // Test if the image is accessible
      console.log(`\n🔗 Testando acesso à imagem...`);
      const imageResponse = await fetch(data.imageUrl, { method: 'HEAD' });
      console.log(`   Status: ${imageResponse.status} ${imageResponse.statusText}`);
      console.log(`   Content-Type: ${imageResponse.headers.get('content-type')}`);
      console.log(`   Content-Length: ${imageResponse.headers.get('content-length')} bytes`);
      
    } else {
      console.log(`❌ Falhou: ${data.error}`);
    }

  } catch (error) {
    console.error(`💥 Erro: ${error.message}`);
  }
}

// Test if the specific category URL works directly
async function testWikimediaCategoryDirect(): Promise<void> {
  console.log('\n🔍 Testando acesso direto à categoria do Wikimedia Commons...\n');
  
  try {
    // Test the category API directly
    const categoryUrl = `https://commons.wikimedia.org/w/api.php?action=query&format=json&list=categorymembers&cmtitle=Category:Castelinho_do_Flamengo&cmnamespace=6&cmlimit=10&origin=*`;
    
    console.log(`📡 URL da categoria: ${categoryUrl}`);
    
    const response = await fetch(categoryUrl);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.json();
    
    console.log('📊 Resposta da categoria:', JSON.stringify(data, null, 2));
    
    if (data.query && data.query.categorymembers && data.query.categorymembers.length > 0) {
      console.log(`\n✅ Categoria encontrada com ${data.query.categorymembers.length} imagens:`);
      
      data.query.categorymembers.forEach((member: any, index: number) => {
        console.log(`   ${index + 1}. ${member.title}`);
      });
      
      // Get info for the first image
      const firstImage = data.query.categorymembers[0];
      const fileName = firstImage.title.replace('File:', '');
      
      console.log(`\n🖼️  Obtendo informações da primeira imagem: ${fileName}`);
      
      const imageInfoUrl = `https://commons.wikimedia.org/w/api.php?action=query&format=json&titles=File:${encodeURIComponent(fileName)}&prop=imageinfo&iiprop=url|size&iiurlwidth=800&origin=*`;
      
      const imageResponse = await fetch(imageInfoUrl);
      const imageData = await imageResponse.json();
      
      console.log('📊 Informações da imagem:', JSON.stringify(imageData, null, 2));
      
    } else {
      console.log('❌ Categoria não encontrada ou vazia');
    }
    
  } catch (error) {
    console.error(`💥 Erro: ${error.message}`);
  }
}

async function main() {
  await testCastelinhoSpecific();
  await testWikimediaCategoryDirect();
}

main().catch(console.error);
