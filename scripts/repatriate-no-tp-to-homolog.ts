
import { getSupabase } from '../lib/core/supabase-client';

const supabase = getSupabase('service');

async function main() {
  const MAX_PER_BATCH = 10000;
  console.log('🔍 Identifying target IDs (any status, approved=false, NO trigger points)...');

  // 1. Get all unapproved IDs (This catches the 1,828)
  const { data: unapproved, error: errUn } = await supabase
    .schema('core')
    .from('attractions')
    .select('id')
    .eq('approved', false);
    
  if (errUn) throw errUn;
  const unapprovedIds = unapproved.map(a => a.id);
  console.log(`Found ${unapprovedIds.length} unapproved attractions.`);

  // 2. Identify those WITHOUT Trigger Points
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
  
  const targetIds = unapprovedIds.filter(id => !idsWithTp.has(id)).slice(0, MAX_PER_BATCH);
  console.log(`Confirmed ${targetIds.length} attractions have NO Trigger Points and will be moved back.`);

  if (targetIds.length === 0) {
    console.log('No items left to repatriate.');
    return;
  }

  // Phase 2: Move back
  console.log(`\n--- Phase 2: Moving ${targetIds.length} items back to homolog ---`);
  
  const moveSubBatchSize = 25;
  let successCount = 0;
  
  for (let i = 0; i < targetIds.length; i += moveSubBatchSize) {
    const batch = targetIds.slice(i, i + moveSubBatchSize);
    
    // 1. Fetch
    const { data: attractions } = await supabase.schema('core').from('attractions').select('*').in('id', batch);
    const { data: coords } = await supabase.schema('core').from('attraction_coordinate').select('*').in('attraction_id', batch);

    if (!attractions) continue;
    const coordMap = new Map(coords?.map(c => [c.attraction_id, c]));

    // 2. Map
    const homologPois = attractions.map(a => {
      const c = coordMap.get(a.id);
      return {
        uuid_id: a.id,
        name: a.name,
        city: a.city,
        state: a.state,
        country: a.country,
        category: a.category,
        lat: c?.latitude,
        lon: c?.longitude,
        osm_id: (a.osm_id && /^\d+$/.test(a.osm_id)) ? a.osm_id : null,
        osm_type: a.osm_type,
        place_id: a.place_id,
        importance: a.importance,
        description: a.description,
        primary_category: a.primary_category,
        primary_category_type: a.primary_category_type,
        osm_properties: a.osm_tags,
        source_file: a.source_file,
        source_type: a.source_type,
        processing_status: 'pending',
        approved: false,
        updated_at: new Date().toISOString()
      };
    });

    const homologCoords = attractions.map(a => {
      const c = coordMap.get(a.id);
      if (!c) return null;
      return {
        poi_uuid_id: a.id,
        latitude: c.latitude,
        longitude: c.longitude,
        elevation_m: c.elevation_m,
        boundary_type: c.boundary_type,
        boundary_source: c.boundary_source,
        boundary_geometry: c.boundary_geometry,
        updated_at: new Date().toISOString()
      };
    }).filter(c => c !== null);

    // 3. Upsert
    const { error: errPoi } = await supabase.schema('homolog').from('pois').upsert(homologPois, { onConflict: 'uuid_id' });
    if (errPoi) { console.error(`Error POI ${i}: ${errPoi.message}`); continue; }
    
    const { error: errCoord } = await supabase.schema('homolog').from('coordinates').upsert(homologCoords, { onConflict: 'poi_uuid_id' });
    if (errCoord) { console.error(`Error Coord ${i}: ${errCoord.message}`); continue; }

    // 4. Delete
    const { error: errDel } = await supabase.schema('core').from('attractions').delete().in('id', batch);
    if (errDel) { console.error(`Error Del ${i}: ${errDel.message}`); continue; }

    successCount += batch.length;
    process.stdout.write(`\rProgress: ${successCount}/${targetIds.length}...`);
  }

  console.log(`\n✅ Finished! ${successCount} attractions successfully repatriated to homolog schema.`);
}

main().catch(console.error);
