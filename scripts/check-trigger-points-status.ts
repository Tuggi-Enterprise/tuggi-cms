/**
 * Check Trigger Points status for a POI
 * 
 * Usage: npx tsx scripts/check-trigger-points-status.ts <attraction_id>
 */

import { getSupabase } from '../lib/core/supabase-client'

const supabase = getSupabase('service')

const attractionId = process.argv[2] || '1259e7b9-77c1-3db0-b538-380218aebb77'

async function checkStatus() {
  console.log('🔍 Checking Trigger Points status for:', attractionId)
  console.log('=' .repeat(60))

  // Check trigger points
  const { data: tps, error: tpError } = await supabase
    .schema('core')
    .from('attraction_trigger_points')
    .select('*')
    .eq('attraction_id', attractionId)

  if (tpError) {
    console.error('❌ Error:', tpError)
    process.exit(1)
  }

  if (!tps || tps.length === 0) {
    console.log('❌ No trigger points found')
    process.exit(0)
  }

  const activeCount = tps.filter(tp => tp.is_active === true).length
  const maxConfidence = Math.max(...tps.map(tp => tp.confidence_score || 0))
  const avgConfidence = tps.reduce((sum, tp) => sum + (tp.confidence_score || 0), 0) / tps.length

  console.log('')
  console.log('📊 TRIGGER POINTS STATUS')
  console.log('=' .repeat(60))
  console.log(`✅ Total Trigger Points: ${tps.length}`)
  console.log(`✅ Active Trigger Points: ${activeCount}`)
  console.log(`📈 Max Confidence: ${(maxConfidence * 100).toFixed(1)}%`)
  console.log(`📊 Avg Confidence: ${(avgConfidence * 100).toFixed(1)}%`)
  console.log('')
  
  // Show boundary source
  const boundarySource = tps[0]?.boundary_source || 'unknown'
  console.log(`🗺️  Boundary Source: ${boundarySource}`)
  console.log('')
  
  // Show types
  const types = [...new Set(tps.map(tp => tp.type))]
  console.log(`📋 Types: ${types.join(', ')}`)
  console.log('')
  
  // Show top 5 by confidence
  const top5 = tps
    .sort((a, b) => (b.confidence_score || 0) - (a.confidence_score || 0))
    .slice(0, 5)
  
  console.log('🏆 Top 5 Trigger Points by Confidence:')
  top5.forEach((tp, i) => {
    console.log(`   ${i + 1}. Confidence: ${((tp.confidence_score || 0) * 100).toFixed(1)}% | Type: ${tp.type} | Active: ${tp.is_active ? '✅' : '❌'}`)
  })
}

checkStatus()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ Error:', error)
    process.exit(1)
  })

