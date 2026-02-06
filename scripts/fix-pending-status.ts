/**
 * Fix POIs that are approved but still have processing_status = 'pending'
 * This is a one-time fix for POIs processed before the pipeline fix
 */

import { getSupabase } from '../lib/core/supabase-client'

const supabase = getSupabase('service')

async function fixPendingStatus() {
  console.log('🔍 Finding POIs with approved=true but processing_status=pending...')
  
  // Find all POIs that are approved but still marked as pending
  const { data: poisToFix, error: findError } = await supabase
    .schema('core')
    .from('attractions')
    .select('id, name, city, approved, processing_status')
    .eq('approved', true)
    .eq('processing_status', 'pending')
  
  if (findError) {
    console.error('❌ Error finding POIs:', findError)
    process.exit(1)
  }
  
  if (!poisToFix || poisToFix.length === 0) {
    console.log('✅ No POIs need fixing!')
    process.exit(0)
  }
  
  console.log(`📊 Found ${poisToFix.length} POIs to fix:`)
  poisToFix.forEach(poi => {
    console.log(`   - ${poi.name} (${poi.city}) - ${poi.id}`)
  })
  
  // Update all of them to 'completed'
  const { data: updated, error: updateError } = await supabase
    .schema('core')
    .from('attractions')
    .update({ processing_status: 'completed' })
    .eq('approved', true)
    .eq('processing_status', 'pending')
    .select('id, name')
  
  if (updateError) {
    console.error('❌ Error updating POIs:', updateError)
    process.exit(1)
  }
  
  console.log(`✅ Successfully updated ${updated?.length || 0} POIs to processing_status='completed'`)
  
  if (updated && updated.length > 0) {
    console.log('Updated POIs:')
    updated.forEach(poi => {
      console.log(`   ✓ ${poi.name} - ${poi.id}`)
    })
  }
}

fixPendingStatus()
  .then(() => {
    console.log('✅ Script completed successfully')
    process.exit(0)
  })
  .catch(error => {
    console.error('❌ Script failed:', error)
    process.exit(1)
  })
