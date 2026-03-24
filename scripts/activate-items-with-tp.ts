
import { getSupabase } from '../lib/core/supabase-client';

const supabase = getSupabase('service');

async function main() {
  console.log('🔄 Checking for unapproved items with TPs in core schema...');
  
  // 1. Get all unapproved IDs
  const { data: unapproved, error: errUn } = await supabase
    .schema('core')
    .from('attractions')
    .select('id, name')
    .eq('approved', false);
    
  if (errUn) throw errUn;
  const unapprovedIds = unapproved.map(a => a.id);
  console.log(`Found ${unapprovedIds.length} unapproved attractions.`);

  // 2. Count how many have TPs
  const idsWithTp = new Set<string>();
  for (let i = 0; i < unapprovedIds.length; i += 1000) {
    const batch = unapprovedIds.slice(i, i + 1000);
    const { data: tps } = await supabase
      .schema('core')
      .from('attraction_trigger_points')
      .select('attraction_id')
      .in('attraction_id', batch);
    tps?.forEach(tp => idsWithTp.add(tp.attraction_id));
  }
  
  const targets = unapprovedIds.filter(id => idsWithTp.has(id));
  console.log(`${targets.length} unapproved attractions HAVE Trigger Points.`);
  console.log(`${unapprovedIds.length - targets.length} unapproved attractions DO NOT HAVE Trigger Points.`);

  if (targets.length > 0) {
    console.log(`\n--- Activating ${targets.length} items ---`);
    // Update to approved = true, processing_status = 'completed'
    const { error: errUp } = await supabase
      .schema('core')
      .from('attractions')
      .update({ 
        approved: true, 
        processing_status: 'completed',
        updated_at: new Date().toISOString()
      })
      .in('id', targets);
      
    if (errUp) {
      console.error('Update error:', errUp.message);
    } else {
      console.log(`✅ Success! Updated ${targets.length} items to approved.`);
    }
  }
}

main().catch(console.error);
