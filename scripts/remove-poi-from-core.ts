/**
 * Remove POI from core.attractions
 * 
 * Usage: npx tsx scripts/remove-poi-from-core.ts <poi_uuid_id>
 */

import { getSupabase } from '../lib/core/supabase-client'

const supabase = getSupabase('service')

const poiId = process.argv[2]

if (!poiId) {
  console.error('❌ Usage: npx tsx scripts/remove-poi-from-core.ts <poi_uuid_id>')
  process.exit(1)
}

async function removePOI() {
  console.log('🗑️  Removing POI from core.attractions:', poiId)

  // Delete from core (cascade will handle related tables)
  const { error } = await supabase
    .schema('core')
    .from('attractions')
    .delete()
    .eq('id', poiId)

  if (error) {
    console.error('❌ Error:', error)
    process.exit(1)
  }

  console.log('✅ POI removed from core.attractions')
}

removePOI()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ Error:', error)
    process.exit(1)
  })

