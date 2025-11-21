import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '.env.local') });
dotenv.config({ path: resolve(process.cwd(), '.env') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('Missing Supabase credentials');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function testTrailAPI() {
    console.log('🧪 Testing Trail Visualization API...');

    // 1. Test getTrails with bounds
    console.log('\n1. Testing getTrails (Service Layer)...');
    try {
        const startTime = Date.now();
        // Bounds for Sao Paulo roughly
        const bounds = {
            north: -23.4,
            south: -23.7,
            east: -46.3,
            west: -46.8
        };

        const { data, error } = await supabase
            .schema('drive')
            .from('route_trail')
            .select('id, user_id, latitude, longitude')
            .gte('latitude', bounds.south)
            .lte('latitude', bounds.north)
            .gte('longitude', bounds.west)
            .lte('longitude', bounds.east)
            .limit(100);

        const duration = Date.now() - startTime;

        if (error) {
            console.error('❌ Error fetching trails:', error);
        } else {
            console.log(`✅ Success (${duration}ms)`);
            console.log(`  - Points returned: ${data?.length || 0}`);
        }
    } catch (err) {
        console.error('❌ Exception:', err);
    }

    // 2. Test Heatmap Data
    console.log('\n2. Testing Heatmap Data (Service Layer)...');
    try {
        const startTime = Date.now();
        // Check if materialized view exists and has data
        const { data, error } = await supabase
            .schema('drive')
            .from('trail_heatmap_grid')
            .select('*', { count: 'exact', head: true });

        const duration = Date.now() - startTime;

        if (error) {
            console.log(`⚠️ Materialized view might not exist or is empty (${duration}ms):`, error.message);
        } else {
            console.log(`✅ Materialized view accessible (${duration}ms)`);
            console.log(`  - Data:`, data);
        }
    } catch (err) {
        console.error('❌ Exception:', err);
    }
}

testTrailAPI();
