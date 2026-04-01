
import dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

async function testOrchestrator() {
  console.log('🚀 Testing daily-gamification-orchestrator (EF-to-EF direct push)...\n');

  const url = `${supabaseUrl}/functions/v1/daily-gamification-orchestrator`;
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${supabaseKey}`,
      'Content-Type': 'application/json'
    }
  });

  const result = await response.json();
  console.log(`Status: ${response.status}`);
  console.log('Result:', JSON.stringify(result, null, 2));
}

testOrchestrator().catch(console.error);
