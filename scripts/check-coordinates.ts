#!/usr/bin/env tsx

import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

const supabase = createClient(supabaseUrl, supabaseAnonKey)

async function checkCoordinates() {
  console.log('🔍 Checking coordinates data...\n')

  try {
    // 1. Check attraction_coordinate table
    const { count: totalCoordinates } = await supabase
      .schema('core')
      .from('attraction_coordinate')
      .select('id', { count: 'exact', head: true })

    console.log(`📍 Total coordinates: ${totalCoordinates}`)

    // 2. Check attractions table
    const { count: totalAttractions } = await supabase
      .schema('core')
      .from('attractions')
      .select('id', { count: 'exact', head: true })

    console.log(`🏛️ Total attractions: ${totalAttractions}`)

    // 3. Check if there are any coordinates at all
    const { data: sampleCoordinates } = await supabase
      .schema('core')
      .from('attraction_coordinate')
      .select('*')
      .limit(5)

    console.log(`\n📍 Sample coordinates:`)
    if (sampleCoordinates && sampleCoordinates.length > 0) {
      sampleCoordinates.forEach((coord, index) => {
        console.log(`   ${index + 1}. Attraction ID: ${coord.attraction_id}`)
        console.log(`      Lat: ${coord.latitude}, Lng: ${coord.longitude}`)
      })
    } else {
      console.log('   No coordinates found!')
    }

    // 4. Check attractions with coordinates using JOIN
    const { data: attractionsWithCoords } = await supabase
      .schema('core')
      .from('attractions')
      .select('id, name, attraction_coordinate!inner(latitude, longitude)')
      .limit(5)

    console.log(`\n🏛️ Sample attractions with coordinates:`)
    if (attractionsWithCoords && attractionsWithCoords.length > 0) {
      attractionsWithCoords.forEach((attraction, index) => {
        const coord = attraction.attraction_coordinate[0]
        console.log(`   ${index + 1}. ${attraction.name}`)
        console.log(`      Lat: ${coord.latitude}, Lng: ${coord.longitude}`)
      })
    } else {
      console.log('   No attractions with coordinates found!')
    }

    // 5. Check if there's a relationship issue
    const { data: relationshipTest } = await supabase
      .schema('core')
      .from('attractions')
      .select('id, name, attraction_coordinate(id, latitude, longitude)')
      .limit(3)

    console.log(`\n🔗 Relationship test:`)
    if (relationshipTest && relationshipTest.length > 0) {
      relationshipTest.forEach((attraction, index) => {
        console.log(`   ${index + 1}. ${attraction.name}`)
        console.log(`      Coordinates: ${attraction.attraction_coordinate ? 'Found' : 'Not found'}`)
        if (attraction.attraction_coordinate && attraction.attraction_coordinate.length > 0) {
          const coord = attraction.attraction_coordinate[0]
          console.log(`      Lat: ${coord.latitude}, Lng: ${coord.longitude}`)
        }
      })
    }

  } catch (error) {
    console.error('💥 Error checking coordinates:', error)
  }
}

checkCoordinates()
