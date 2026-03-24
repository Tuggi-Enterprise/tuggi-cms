
import { getSupabase } from '../lib/core/supabase-client';

const supabase = getSupabase('service');

async function main() {
  let pending: any[] = [];
  let from = 0;
  while (true) {
    const { data } = await supabase
      .schema('core')
      .from('attractions')
        .select('id, name')
        .eq('processing_status', 'pending')
        .range(from, from + 999);
    if (!data || data.length === 0) break;
    pending.push(...data);
    from += 1000;
  }

  console.log(`Total remaining pending items in core: ${pending.length} (Fetched using loops)`);

  if (!pending || pending.length === 0) return;

  const ids = pending.map(p => p.id);
  const idsWithTp = new Set<string>();
  
  for (let i = 0; i < ids.length; i += 1000) {
    const batch = ids.slice(i, i + 1000);
    const { data: tps } = await supabase
      .schema('core')
      .from('attraction_trigger_points')
      .select('attraction_id')
      .in('attraction_id', batch);
    tps?.forEach(tp => idsWithTp.add(tp.attraction_id));
  }
  
  console.log(`- With Trigger Points: ${idsWithTp.size}`);
  console.log(`- Without Trigger Points: ${ids.length - idsWithTp.size}`);

  if (ids.length - idsWithTp.size > 0) {
    const withoutTp = pending.filter(p => !idsWithTp.has(p.id));
    console.log(`\nSample of ${withoutTp.length} items WITHOUT TPs that are still pending:`);
    console.table(withoutTp.slice(0, 10));
  }
}

main().catch(console.error);
