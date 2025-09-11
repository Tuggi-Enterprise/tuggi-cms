import dotenv from 'dotenv';
dotenv.config();

async function testWikipediaFunction() {
  console.log('🧪 Testing Wikipedia Edge Function directly...');
  
  try {
    const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/extract-wikipedia-images`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`
      },
      body: JSON.stringify({
        attractionId: 'test-123',
        attractionName: 'Cristo Redentor',
        city: 'Rio de Janeiro',
        country: 'BR'
      })
    });

    console.log(`Response status: ${response.status}`);
    console.log(`Response headers:`, Object.fromEntries(response.headers.entries()));
    
    const data = await response.text();
    console.log(`Response body:`, data);
    
  } catch (error) {
    console.error('Error:', error);
  }
}

async function testWebsiteFunction() {
  console.log('\n🧪 Testing Website Edge Function directly...');
  
  try {
    const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/extract-website-images`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`
      },
      body: JSON.stringify({
        attractionId: 'test-123',
        attractionName: 'Cristo Redentor',
        website: 'https://www.cristoredentoroficial.com.br'
      })
    });

    console.log(`Response status: ${response.status}`);
    console.log(`Response headers:`, Object.fromEntries(response.headers.entries()));
    
    const data = await response.text();
    console.log(`Response body:`, data);
    
  } catch (error) {
    console.error('Error:', error);
  }
}

async function main() {
  await testWikipediaFunction();
  await testWebsiteFunction();
}

main().catch(console.error);
