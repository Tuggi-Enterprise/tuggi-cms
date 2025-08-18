async function testAudioFix() {
  console.log('🧪 Testing audio generation fix...');
  
  const testAttractionId = '0d94a6db-5c34-4cbf-8afe-3740f2e92ef2';
  
  // Get environment variables from process.env
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    console.error('❌ Missing environment variables');
    process.exit(1);
  }
  
  try {
    const edgeFunctionUrl = `${supabaseUrl}/functions/v1/generate-translated-audio`;
    
    console.log(`📞 Calling Edge Function: ${edgeFunctionUrl}`);
    console.log(`🎯 Testing with attractionId: ${testAttractionId}`);
    
    // Test with en-us
    console.log('\n🔤 Testing English (en-us)...');
    const enResponse = await fetch(edgeFunctionUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${serviceRoleKey}`,
        'apikey': serviceRoleKey
      },
      body: JSON.stringify({
        attractionId: testAttractionId,
        targetLanguage: 'en-us',
        voiceGender: 'female'
      })
    });

    console.log(`📊 English response status: ${enResponse.status}`);
    if (enResponse.ok) {
      const enResult = await enResponse.json();
      console.log('✅ English response structure:', JSON.stringify(enResult, null, 2));
      console.log('✅ English audio URL:', enResult.data?.audioUrl);
    } else {
      const enError = await enResponse.text();
      console.error('❌ English audio generation failed:', enError);
    }

  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

testAudioFix();
