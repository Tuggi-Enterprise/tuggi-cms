import { getSupabase } from '../lib/core/supabase-client'
import { config } from 'dotenv'

config()

const supabase = getSupabase('service')

async function investigateAttractionData(attractionId?: string) {
  console.log('🔍 INVESTIGATING ATTRACTION DATA')
  console.log('============================================================')

  try {
    let query = supabase
      .schema('core')
      .from('attractions')
      .select(`
        id,
        name,
        google_place_id,
        google_types,
        city,
        country,
        formatted_address,
        vicinity,
        rating,
        user_ratings_total,
        price_level,
        website,
        business_status,
        coordinates:attraction_coordinate!inner(
          latitude,
          longitude,
          location_geography
        )
      `)

    if (attractionId) {
      query = query.eq('id', attractionId)
    } else {
      query = query.limit(5)
    }

    const { data: attractions, error } = await query

    if (error) {
      console.error('❌ Error fetching attractions:', error)
      return
    }

    console.log(`📊 Found ${attractions?.length || 0} attractions`)
    console.log('\n📋 SAMPLE ATTRACTION DATA:')
    console.log('============================================================')

    attractions?.forEach((attraction, index) => {
      console.log(`\n${index + 1}. ${attraction.name}`)
      console.log('   📍 Location:', attraction.city, attraction.country)
      console.log('   🆔 Google Place ID:', attraction.google_place_id || 'NOT AVAILABLE')
      console.log('   🏷️  Google Types:', attraction.google_types || 'NOT AVAILABLE')
      console.log('   📍 Coordinates:', attraction.coordinates?.[0] || 'NOT AVAILABLE')
      console.log('   ⭐ Rating:', attraction.rating || 'NOT AVAILABLE')
      console.log('   👥 User Ratings:', attraction.user_ratings_total || 'NOT AVAILABLE')
      console.log('   💰 Price Level:', attraction.price_level || 'NOT AVAILABLE')
      console.log('   🌐 Website:', attraction.website || 'NOT AVAILABLE')
      console.log('   🏢 Business Status:', attraction.business_status || 'NOT AVAILABLE')
      console.log('   📮 Address:', attraction.formatted_address || 'NOT AVAILABLE')
      console.log('   📍 Vicinity:', attraction.vicinity || 'NOT AVAILABLE')
    })

    // Verificar estatísticas dos dados
    console.log('\n📊 DATA STATISTICS:')
    console.log('============================================================')

    const { data: stats } = await supabase
      .schema('core')
      .from('attractions')
      .select(`
        id,
        google_place_id,
        google_types,
        rating,
        user_ratings_total,
        website
      `)
      .limit(100)

    if (stats) {
      const totalAttractions = stats.length
      const withGooglePlaceId = stats.filter(a => a.google_place_id).length
      const withGoogleTypes = stats.filter(a => a.google_types && a.google_types.length > 0).length
      const withRating = stats.filter(a => a.rating).length
      const withUserRatings = stats.filter(a => a.user_ratings_total).length
      const withWebsite = stats.filter(a => a.website).length

      console.log(`📈 Total attractions analyzed: ${totalAttractions}`)
      console.log(`🆔 With google_place_id: ${withGooglePlaceId} (${Math.round(withGooglePlaceId/totalAttractions*100)}%)`)
      console.log(`🏷️  With google_types: ${withGoogleTypes} (${Math.round(withGoogleTypes/totalAttractions*100)}%)`)
      console.log(`⭐ With rating: ${withRating} (${Math.round(withRating/totalAttractions*100)}%)`)
      console.log(`👥 With user ratings: ${withUserRatings} (${Math.round(withUserRatings/totalAttractions*100)}%)`)
      console.log(`🌐 With website: ${withWebsite} (${Math.round(withWebsite/totalAttractions*100)}%)`)
    }

    // Mostrar exemplos de google_types únicos
    console.log('\n🏷️  UNIQUE GOOGLE TYPES FOUND:')
    console.log('============================================================')
    const allTypes = new Set<string>()
    stats?.forEach(attraction => {
      if (attraction.google_types) {
        attraction.google_types.forEach((type: string) => allTypes.add(type))
      }
    })

    const sortedTypes = Array.from(allTypes).sort()
    console.log('Types found:', sortedTypes.slice(0, 20)) // Primeiros 20 tipos
    if (sortedTypes.length > 20) {
      console.log(`... and ${sortedTypes.length - 20} more types`)
    }

  } catch (error) {
    console.error('❌ Error:', error)
  }
}

// Executar investigação
const attractionId = process.argv[2]
investigateAttractionData(attractionId)
