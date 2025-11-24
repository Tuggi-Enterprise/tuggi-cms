/**
 * Reset POI migration status
 * 
 * Resets the migration status of a POI in homolog.pois to allow reprocessing
 * Usage: npx tsx scripts/reset-poi-migration-status.ts <poi_uuid_id>
 */

import { getSupabase } from '../lib/core/supabase-client'

const supabase = getSupabase('service')

const poiId = process.argv[2]

if (!poiId) {
  console.error('❌ Usage: npx tsx scripts/reset-poi-migration-status.ts <poi_uuid_id>')
  process.exit(1)
}

async function resetStatus() {
  console.log('🔄 Resetting migration status for POI:', poiId)

  const { data, error } = await supabase
    .schema('homolog')
    .from('pois')
    .update({
      processing_status: 'pending',
      migration_attempts: 0,
      last_migration_attempt_at: null,
      migration_error: null
    })
    .eq('uuid_id', poiId)
    .select()

  if (error) {
    console.error('❌ Error:', error)
    process.exit(1)
  }

  if (!data || data.length === 0) {
    console.error('❌ POI not found in homolog.pois')
    process.exit(1)
  }

  console.log('✅ POI status reset successfully:')
  console.log('   - processing_status: pending')
  console.log('   - migration_attempts: 0')
  console.log('   - last_migration_attempt_at: null')
  console.log('   - migration_error: null')
}

resetStatus()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ Error:', error)
    process.exit(1)
  })

