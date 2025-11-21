import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '.env.local') });
dotenv.config({ path: resolve(process.cwd(), '.env') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function testTrailUsersRPC() {
  console.log('🧪 Testing drive.get_trail_users RPC function...\n');

  const testLimits = [10, 50, 100];

  for (const limit of testLimits) {
    console.log(`\n📊 Testing with limit=${limit}`);
    console.log('─'.repeat(50));

    try {
      const startTime = Date.now();
      
      const { data, error } = await supabase
        .schema('drive')
        .rpc('get_trail_users', { user_limit: limit });

      const duration = Date.now() - startTime;

      if (error) {
        console.error(`❌ Error (${duration}ms):`, error);
        console.error('  - Code:', error.code);
        console.error('  - Message:', error.message);
        console.error('  - Details:', error.details);
        console.error('  - Hint:', error.hint);
      } else {
        console.log(`✅ Success (${duration}ms)`);
        console.log(`  - Users returned: ${data?.length || 0}`);
        
        if (data && data.length > 0) {
          console.log('\n  Sample data (first 3 users):');
          data.slice(0, 3).forEach((user: any, index: number) => {
            console.log(`\n  User ${index + 1}:`);
            console.log(`    - user_id: ${user.user_id}`);
            console.log(`    - trail_count: ${user.trail_count}`);
            console.log(`    - trip_count: ${user.trip_count}`);
            console.log(`    - last_activity: ${user.last_activity || 'N/A'}`);
          });
        } else {
          console.log('  ⚠️  No data returned');
        }
      }
    } catch (err) {
      console.error('❌ Exception caught:', err);
    }
  }

  // Test direct query for comparison
  console.log('\n\n📊 Testing direct query (for comparison)...');
  console.log('─'.repeat(50));

  try {
    const startTime = Date.now();
    
    const { data, error } = await supabase
      .schema('drive')
      .from('route_trail')
      .select('user_id')
      .limit(500);

    const duration = Date.now() - startTime;

    if (error) {
      console.error(`❌ Direct query error (${duration}ms):`, error);
    } else {
      console.log(`✅ Direct query success (${duration}ms)`);
      console.log(`  - Rows returned: ${data?.length || 0}`);
      
      if (data && data.length > 0) {
        const uniqueUsers = new Set(data.map((r: any) => r.user_id));
        console.log(`  - Unique users: ${uniqueUsers.size}`);
      }
    }
  } catch (err) {
    console.error('❌ Direct query exception:', err);
  }

  // Test with smaller limit in RPC
  console.log('\n\n📊 Testing RPC with very small limit (5)...');
  console.log('─'.repeat(50));

  try {
    const startTime = Date.now();
    
    const { data, error } = await supabase
      .schema('drive')
      .rpc('get_trail_users', { user_limit: 5 });

    const duration = Date.now() - startTime;

    if (error) {
      console.error(`❌ Error (${duration}ms):`, error);
    } else {
      console.log(`✅ Success (${duration}ms)`);
      console.log(`  - Users returned: ${data?.length || 0}`);
    }
  } catch (err) {
    console.error('❌ Exception:', err);
  }
}

testTrailUsersRPC()
  .then(() => {
    console.log('\n✅ Test completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Test failed:', error);
    process.exit(1);
  });


