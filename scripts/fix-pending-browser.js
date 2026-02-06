// Fix POIs that are approved but still have processing_status = 'pending'
// Run this in the browser console on your CMS pages

async function fixPendingPOIs() {
  console.log('🔍 Finding POIs with approved=true but processing_status=pending...')
  
  const response = await fetch('/api/pois/search?status=approved&limit=1000')
  const result = await response.json()
  
  if (!result.success || !result.pois) {
    console.error('❌ Failed to fetch POIs:', result.error)
    return
  }
  
  // Filter for those with pending status
  const poisToFix = result.pois.filter(poi => 
    poi.approved && poi.processing_status === 'pending'
  )
  
  console.log(`📊 Found ${poisToFix.length} POIs to fix`)
  
  if (poisToFix.length === 0) {
    console.log('✅ No POIs need fixing!')
    return
  }
  
  // Show first few
  console.log('Examples:', poisToFix.slice(0, 5).map(p => `${p.name} (${p.city})`))
  
  // Fix them
  let fixed = 0
  for (const poi of poisToFix) {
    try {
      const updateResponse = await fetch(`/api/pois/${poi.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ processing_status: 'completed' })
      })
      
      if (updateResponse.ok) {
        fixed++
        console.log(`✓ ${poi.name}`)
      } else {
        console.error(`✗ ${poi.name}: ${updateResponse.statusText}`)
      }
    } catch (error) {
      console.error(`✗ ${poi.name}:`, error)
    }
  }
  
  console.log(`✅ Fixed ${fixed}/${poisToFix.length} POIs`)
}

// Run it
fixPendingPOIs()
